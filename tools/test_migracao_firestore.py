"""Testes de tools/migracao_firestore.py contra um Firestore falso em memória.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

import migracao_firestore as m


READ_TIME = "2026-10-20T00:57:34.062740Z"


def doc(project: str, path: str, fields: dict[str, Any], update_time: str = "2026-10-19T10:00:00Z") -> dict[str, Any]:
    return {
        "name": f"projects/{project}/databases/(default)/documents/{path}",
        "fields": fields,
        "updateTime": update_time,
    }


def text(value: str) -> dict[str, Any]:
    return {"stringValue": value}


class FakeFirestore:
    """runQuery com allDescendants, startAt e limit; batchWrite com precondição."""

    def __init__(self, documents: list[dict[str, Any]]):
        self.documents = {d["name"]: copy.deepcopy(d) for d in documents}
        self.queries: list[dict[str, Any]] = []
        self.batches: list[list[dict[str, Any]]] = []

    def __call__(self, url: str, payload: dict[str, Any] | None) -> Any:
        if url.endswith(":runQuery"):
            return self.run_query(payload or {})
        if url.endswith(":batchWrite"):
            return self.batch_write(payload or {})
        raise AssertionError(f"chamada inesperada: {url}")

    def run_query(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.queries.append(payload)
        query = payload["structuredQuery"]
        assert query["from"] == [{"allDescendants": True}]
        names = sorted(self.documents)
        cursor = query.get("startAt")
        if cursor:
            after = cursor["values"][0]["referenceValue"]
            names = [name for name in names if name > after]
        names = names[: query["limit"]]
        read_time = payload.get("readTime", READ_TIME)
        if not names:
            return [{"readTime": read_time}]
        return [{"document": copy.deepcopy(self.documents[name]), "readTime": read_time} for name in names]

    def batch_write(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.batches.append(payload["writes"])
        statuses = []
        for write in payload["writes"]:
            name = write["update"]["name"]
            current = self.documents[name]
            if current["updateTime"] != write["currentDocument"]["updateTime"]:
                statuses.append({"code": 9, "message": "FAILED_PRECONDITION"})
                continue
            for field_path in write["updateMask"]["fieldPaths"]:
                key = field_path.strip("`")
                current["fields"][key] = write["update"]["fields"][key]
            current["updateTime"] = "2026-10-20T02:00:00Z"
            statuses.append({})
        return {"writeResults": [{} for _ in statuses], "status": statuses}


class PathTests(unittest.TestCase):
    def test_collection_pattern_drops_document_ids(self) -> None:
        self.assertEqual(m.collection_pattern("users/u1"), "users")
        self.assertEqual(m.collection_pattern("products/abc/history/h1"), "products/*/history")

    def test_relative_path(self) -> None:
        self.assertEqual(
            m.relative_path("projects/dute-btg/databases/(default)/documents/users/u1"),
            "users/u1",
        )


class HashTests(unittest.TestCase):
    def test_same_fields_in_any_order_have_same_hash(self) -> None:
        a = {"a": text("1"), "b": {"mapValue": {"fields": {"x": text("2"), "y": text("3")}}}}
        b = {"b": {"mapValue": {"fields": {"y": text("3"), "x": text("2")}}}, "a": text("1")}
        self.assertEqual(m.fields_hash(a), m.fields_hash(b))

    def test_reference_hash_ignores_project(self) -> None:
        btg = {"ref": {"referenceValue": "projects/dute-btg/databases/(default)/documents/users/u1"}}
        prod = {"ref": {"referenceValue": "projects/dute-prod/databases/(default)/documents/users/u1"}}
        self.assertEqual(m.fields_hash(btg), m.fields_hash(prod))

    def test_empty_map_and_array_have_one_form(self) -> None:
        self.assertEqual(
            m.fields_hash({"m": {"mapValue": {}}, "a": {"arrayValue": {}}}),
            m.fields_hash({"m": {"mapValue": {"fields": {}}}, "a": {"arrayValue": {"values": []}}}),
        )

    def test_any_value_change_changes_hash(self) -> None:
        self.assertNotEqual(m.fields_hash({"a": text("1")}), m.fields_hash({"a": text("2")}))
        self.assertNotEqual(
            m.fields_hash({"n": {"integerValue": "1"}}),
            m.fields_hash({"n": {"stringValue": "1"}}),
        )


class MentionTests(unittest.TestCase):
    def test_finds_text_in_nested_maps_and_lists(self) -> None:
        fields = {
            "photo_urls": {"arrayValue": {"values": [text("x"), text("https://.../b/dute-btg.firebasestorage.app/o/a")]}},
            "file": {"mapValue": {"fields": {"bucket": text("dute-btg.firebasestorage.app")}}},
            "name": text("nada aqui"),
        }
        found = list(m.text_mentions(fields, ["dute-btg"]))
        self.assertEqual(found, [("file.bucket", "dute-btg"), ("photo_urls[1]", "dute-btg")])
        self.assertEqual(m.generic_field("photo_urls[1]"), "photo_urls[]")


class ManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.firestore = FakeFirestore(
            [
                doc("dute-btg", "users/u1", {"email": text("a@x")}),
                doc("dute-btg", "users/u2", {"email": text("b@x")}),
                doc("dute-btg", "products/p1", {"photo": text("gs://dute-btg.firebasestorage.app/p1.jpg")}),
                doc("dute-btg", "products/p1/history/h1", {"n": {"integerValue": "1"}}),
                doc("dute-btg", "events/e1", {"t": text("x")}),
            ]
        )

    def test_reads_every_document_at_one_read_time_across_pages(self) -> None:
        manifest = m.build_manifest(self.firestore, "dute-btg", needles=["dute-btg"], page_size=2)
        self.assertEqual(manifest["total"], 5)
        self.assertEqual(
            manifest["counts"],
            {"events": 1, "products": 1, "products/*/history": 1, "users": 2},
        )
        self.assertEqual(manifest["read_time"], READ_TIME)
        # A primeira página fixa o instante; as outras o repetem.
        self.assertNotIn("readTime", self.firestore.queries[0])
        self.assertTrue(all(q.get("readTime") == READ_TIME for q in self.firestore.queries[1:]))
        self.assertEqual(manifest["mentions"], [{"path": "products/p1", "field": "photo", "needle": "dute-btg"}])

    def test_uses_given_read_time_on_every_page(self) -> None:
        m.build_manifest(self.firestore, "dute-btg", read_time="2026-10-20T01:00:00Z", page_size=2)
        self.assertTrue(all(q["readTime"] == "2026-10-20T01:00:00Z" for q in self.firestore.queries))

    def test_compare_finds_missing_extra_and_changed(self) -> None:
        source = m.build_manifest(self.firestore, "dute-btg")
        target_store = copy.deepcopy(self.firestore.documents)
        target_docs = [
            {**d, "name": d["name"].replace("dute-btg", "dute-prod", 1)} for d in target_store.values()
        ]
        target = FakeFirestore(target_docs)
        self.assertTrue(m.compare_manifests(source, m.build_manifest(target, "dute-prod"))["equal"])

        del target.documents["projects/dute-prod/databases/(default)/documents/events/e1"]
        target.documents["projects/dute-prod/databases/(default)/documents/users/u2"]["fields"]["email"] = text("c@x")
        extra = doc("dute-prod", "users/u3", {"email": text("d@x")})
        target.documents[extra["name"]] = extra
        result = m.compare_manifests(source, m.build_manifest(target, "dute-prod"))
        self.assertFalse(result["equal"])
        self.assertEqual(result["missing"], ["events/e1"])
        self.assertEqual(result["extra"], ["users/u3"])
        self.assertEqual(result["changed"], ["users/u2"])
        self.assertIn(("events", 1, 0), result["counts"])


OLD = "dute-btg.firebasestorage.app"
NEW = "dute-prod.firebasestorage.app"


class RewriteTests(unittest.TestCase):
    def test_replaces_bucket_in_nested_values_and_keeps_the_rest(self) -> None:
        url = f"https://firebasestorage.googleapis.com/v0/b/{OLD}/o/product-photos%2Fa.jpg?alt=media&token=t1"
        document = doc(
            "dute-prod",
            "products/p1",
            {
                "photo_urls": {"arrayValue": {"values": [text(url), text("https://outro/x.jpg")]}},
                "attachment": {"mapValue": {"fields": {"bucket": text(OLD), "storage_path": text("a/b.pdf")}}},
                "name": text("Camisa"),
            },
        )
        changes = m.rewrite_fields(document, OLD, NEW)
        self.assertEqual(sorted(changes), ["attachment", "photo_urls"])
        self.assertEqual(
            changes["photo_urls"]["arrayValue"]["values"][0]["stringValue"],
            url.replace(OLD, NEW),
        )
        self.assertEqual(changes["photo_urls"]["arrayValue"]["values"][1], text("https://outro/x.jpg"))
        self.assertEqual(changes["attachment"]["mapValue"]["fields"]["storage_path"], text("a/b.pdf"))
        self.assertEqual(changes["attachment"]["mapValue"]["fields"]["bucket"], text(NEW))

    def test_write_updates_only_changed_fields_with_precondition(self) -> None:
        document = doc("dute-prod", "x/1", {"odd-name": text(OLD)}, update_time="2026-10-20T01:00:00Z")
        write = m.rewrite_write(document, m.rewrite_fields(document, OLD, NEW))
        self.assertEqual(write["updateMask"], {"fieldPaths": ["`odd-name`"]})
        self.assertEqual(write["currentDocument"], {"updateTime": "2026-10-20T01:00:00Z"})
        self.assertEqual(m.quote_field("a`b"), "`a\\`b`")
        self.assertEqual(m.quote_field("photo_urls"), "photo_urls")

    def test_plan_and_apply_rewrite_every_document_once(self) -> None:
        firestore = FakeFirestore(
            [
                doc("dute-prod", f"products/p{i}", {"photo": text(f"gs://{OLD}/p{i}.jpg"), "n": text("x")})
                for i in range(3)
            ]
            + [doc("dute-prod", "users/u1", {"email": text("a@x")})]
        )
        writes = m.plan_bucket_rewrite(firestore, "dute-prod", OLD, NEW, page_size=2)
        self.assertEqual(len(writes), 3)
        self.assertEqual(m.apply_writes(firestore, "dute-prod", writes), [])
        self.assertEqual(m.plan_bucket_rewrite(firestore, "dute-prod", OLD, NEW), [])
        self.assertEqual(
            firestore.documents["projects/dute-prod/databases/(default)/documents/products/p0"]["fields"]["photo"],
            text(f"gs://{NEW}/p0.jpg"),
        )

    def test_document_changed_after_reading_is_refused(self) -> None:
        firestore = FakeFirestore([doc("dute-prod", "products/p1", {"photo": text(f"gs://{OLD}/p1.jpg")})])
        writes = m.plan_bucket_rewrite(firestore, "dute-prod", OLD, NEW)
        firestore.documents["projects/dute-prod/databases/(default)/documents/products/p1"]["updateTime"] = "2026-10-20T03:00:00Z"
        failures = m.apply_writes(firestore, "dute-prod", writes)
        self.assertEqual(failures, [("products/p1", "FAILED_PRECONDITION")])

    def test_batches_respect_the_write_limit(self) -> None:
        firestore = FakeFirestore(
            [doc("dute-prod", f"p/{i:04d}", {"u": text(OLD)}) for i in range(m.BATCH_WRITE_LIMIT + 3)]
        )
        writes = m.plan_bucket_rewrite(firestore, "dute-prod", OLD, NEW)
        self.assertEqual(m.apply_writes(firestore, "dute-prod", writes), [])
        self.assertEqual([len(b) for b in firestore.batches], [m.BATCH_WRITE_LIMIT, 3])


class AuthTests(unittest.TestCase):
    def export(self, users: list[dict[str, Any]]) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        with handle:
            json.dump({"users": users}, handle)
        self.addCleanup(Path(handle.name).unlink)
        return Path(handle.name)

    def test_compare_ignores_missing_hash_and_absent_disabled(self) -> None:
        source = m.load_auth_export(
            self.export(
                [
                    {"localId": "u1", "email": "a@x", "passwordHash": "h", "salt": "s", "customAttributes": '{"r": 1}'},
                    {"localId": "u2", "email": "b@x", "passwordHash": "h", "disabled": True},
                ]
            )
        )
        target = m.load_auth_export(
            self.export(
                [
                    {"localId": "u1", "email": "a@x", "disabled": False, "customAttributes": '{ "r" : 1 }'},
                    {"localId": "u2", "email": "b@x", "disabled": True},
                ]
            )
        )
        result = m.compare_auth(source, target)
        self.assertTrue(result["equal"])
        self.assertEqual(result["with_password"], 2)

    def test_compare_reports_missing_extra_and_different(self) -> None:
        source = {"u1": {"localId": "u1", "email": "a@x"}, "u2": {"localId": "u2", "email": "b@x"}}
        target = {"u1": {"localId": "u1", "email": "z@x", "disabled": True}, "u3": {"localId": "u3"}}
        result = m.compare_auth(source, target)
        self.assertEqual(result["missing"], ["u2"])
        self.assertEqual(result["extra"], ["u3"])
        self.assertEqual(result["different"], [("u1", "email"), ("u1", "desativado")])

    def test_password_check_uses_the_password_provider(self) -> None:
        calls: list[dict[str, Any]] = []

        def fetch(url: str, payload: dict[str, Any] | None) -> Any:
            assert url.endswith("/projects/dute-prod/accounts:lookup")
            calls.append(payload or {})
            users = {
                "u1": {"localId": "u1", "passwordUpdatedAt": 1, "providerUserInfo": [{"providerId": "password"}]},
                "u2": {"localId": "u2", "providerUserInfo": []},
            }
            return {"users": [users[uid] for uid in payload["localId"] if uid in users]}

        self.assertEqual(m.passwords_missing(fetch, "dute-prod", ["u1", "u2", "u3"], chunk=2), ["u2", "u3"])
        self.assertEqual([c["localId"] for c in calls], [["u1", "u2"], ["u3"]])

    def test_import_command_carries_the_source_scrypt_parameters(self) -> None:
        def fetch(url: str, payload: dict[str, Any] | None) -> Any:
            assert url.endswith("/projects/dute-btg/config")
            return {
                "signIn": {
                    "hashConfig": {
                        "algorithm": "SCRYPT",
                        "signerKey": "chave==",
                        "saltSeparator": "Bw==",
                        "rounds": 8,
                        "memoryCost": 14,
                    }
                }
            }

        command = m.auth_import_command(Path("contas.json"), "dute-prod", m.scrypt_config(fetch, "dute-btg"))
        self.assertIn("--hash-algo=SCRYPT", command)
        self.assertIn("--hash-key=chave==", command)
        self.assertIn("--salt-separator=Bw==", command)
        self.assertIn("--rounds=8", command)
        self.assertIn("--mem-cost=14", command)
        self.assertEqual(command[command.index("--project") + 1], "dute-prod")

    def test_import_refuses_a_config_without_scrypt(self) -> None:
        with self.assertRaises(RuntimeError):
            m.scrypt_config(lambda url, payload: {"signIn": {"hashConfig": {"algorithm": "HMAC_SHA256"}}}, "x")


if __name__ == "__main__":
    unittest.main()
