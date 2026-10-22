"""Testes de tools/full_reset_btg.py contra um Firestore falso em memória.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import full_reset_btg
from reset_btg_inventory import decode_document, firestore_value


PROJECT = "dute-btg"
DATABASE = "(default)"
PREFIX = f"projects/{PROJECT}/databases/{DATABASE}/documents/"
CONFIRM = f"APAGAR TUDO {PROJECT}/{DATABASE}"
# Coleções do Comercial (docs/plataforma/fase-6-comercial.md), escritas aqui por
# extenso para travar a lista do script.
COMERCIAL = (
    "customer_locations",
    "customer_contacts",
    "contracts",
    "lpu_items",
    "price_tables",
    "demands",
    "quotes",
    "client_authorizations",
    "medicoes",
    "demand_counters",
    "comercial_operations",
)
OPERACAO = (
    "collaborators",
    "vehicles",
    "operacao_operations",
)


def raw_document(
    collection: str,
    document_id: str,
    fields: dict[str, Any] | None = None,
    *,
    update_time: str = "2026-10-16T00:00:00.000000Z",
) -> dict[str, Any]:
    return {
        "name": f"{PREFIX}{collection}/{document_id}",
        "fields": {key: firestore_value(value) for key, value in (fields or {}).items()},
        "updateTime": update_time,
    }


class FakeFirestore:
    """Reproduz o mínimo da REST API que o script usa: listar, ler, batchWrite."""

    def __init__(self) -> None:
        self.docs: dict[str, dict[str, dict[str, Any]]] = {}
        self.exports: list[str] = []
        self.batches: list[list[dict[str, Any]]] = []
        self.commits: list[list[dict[str, Any]]] = []
        self.ignore_deletes_in: set[str] = set()
        self.version = 0

    def seed(
        self,
        collection: str,
        document_id: str,
        fields: dict[str, Any] | None = None,
        *,
        update_time: str = "2026-10-16T00:00:00.000000Z",
    ) -> None:
        """`collection` pode ser uma subcoleção: `contracts/ct1/aditivos`."""
        self.docs.setdefault(collection, {})[document_id] = raw_document(
            collection, document_id, fields, update_time=update_time
        )

    def fields(self, collection: str, document_id: str) -> dict[str, Any]:
        return decode_document(self.docs[collection][document_id])

    def collections(self) -> list[str]:
        """Coleções raiz com documento (subcoleções ficam de fora, como no banco)."""
        return sorted(name for name, docs in self.docs.items() if docs and "/" not in name)

    def _parse(self, name: str) -> tuple[str, str]:
        assert name.startswith(PREFIX), name
        collection, document_id = name[len(PREFIX):].rsplit("/", 1)
        return collection, document_id

    # --- substitutos das funções do módulo -----------------------------------
    def list_root_collections(self, *, project_id: str, database: str, token: str) -> list[str]:
        return self.collections()

    def fetch_snapshot(self, collections: Any, *, project_id: str, database: str, token: str):
        # Como a REST API: só os documentos da própria coleção, sem descer nas
        # subcoleções.
        return {
            name: [copy.deepcopy(document) for document in self.docs.get(name, {}).values()]
            for name in collections
        }

    def batch_write(self, writes: list[dict[str, Any]], *, project_id: str, database: str, token: str) -> None:
        self.batches.append(copy.deepcopy(writes))
        refused: list[str] = []
        for write in writes:
            if "delete" in write:
                collection, document_id = self._parse(write["delete"])
                if collection in self.ignore_deletes_in:
                    continue
                current = self.docs.get(collection, {}).get(document_id)
                precondition = write.get("currentDocument", {})
                if "updateTime" in precondition and (
                    current is None or current["updateTime"] != precondition["updateTime"]
                ):
                    # O batchWrite aplica o resto e devolve o status de cada write.
                    refused.append(write["delete"])
                    continue
                self.docs.get(collection, {}).pop(document_id, None)
                continue
            update = write["update"]
            collection, document_id = self._parse(update["name"])
            current = self.docs.get(collection, {}).get(document_id)
            precondition = write.get("currentDocument", {})
            if precondition.get("exists") is False and current is not None:
                raise RuntimeError(f"precondição exists=false falhou: {update['name']}")
            if precondition.get("exists") is True and current is None:
                raise RuntimeError(f"precondição exists=true falhou: {update['name']}")
            if "updateTime" in precondition and (
                current is None or current["updateTime"] != precondition["updateTime"]
            ):
                raise RuntimeError(f"precondição updateTime falhou: {update['name']}")
            if "updateMask" in write and current is not None:
                fields = dict(current["fields"])
                fields.update(update["fields"])
            else:
                fields = dict(update["fields"])
            self.version += 1
            self.docs.setdefault(collection, {})[document_id] = {
                "name": update["name"],
                "fields": fields,
                "updateTime": f"2026-10-16T00:00:00.{self.version:06d}Z",
            }
        if refused:
            raise RuntimeError("Firestore recusou parte do lote: " + json.dumps(refused))

    def commit_writes(self, writes: list[dict[str, Any]], *, project_id: str, database: str, token: str) -> None:
        """Como o :commit: tudo ou nada. Precondição falha = HTTP 400, nada gravado."""
        if not writes:
            return
        self.commits.append(copy.deepcopy(writes))
        for write in writes:
            name = write.get("delete") or write["update"]["name"]
            collection, document_id = self._parse(name)
            current = self.docs.get(collection, {}).get(document_id)
            precondition = write.get("currentDocument", {})
            if "updateTime" in precondition and (
                current is None or current["updateTime"] != precondition["updateTime"]
            ):
                raise RuntimeError("Firestore respondeu HTTP 400: FAILED_PRECONDITION " + name)
        self.batch_write(writes, project_id=project_id, database=database, token=token)

    def run_managed_export(self, destination: str, *, project_id: str, database: str, gcloud: Any = None) -> str:
        self.exports.append(destination)
        return destination


def seeded_production() -> FakeFirestore:
    fake = FakeFirestore()
    fake.seed("users", "u1", {"role": "owner", "customer_code": "BTG Pactual"})
    fake.seed("invites", "i1", {"email": "x@dutelog.com.br"})
    fake.seed("customer_accounts", "a1", {"user_id": "u1"})
    fake.seed("system_settings", "infra", {"alerts": True})
    fake.seed("customers", "btg", {"customer_code": "BTG Pactual"})
    # Perfil de operação publicado para o portal, gravado junto com o cadastro.
    fake.seed("client_profiles", "btg", {"customer_code": "BTG Pactual", "operation_template": "uniformes"})
    # Módulos contratados, pelo código do cliente (Fase 2 da plataforma).
    fake.seed("client_access", "BTG Pactual", {"customer_code": "BTG Pactual", "modules": ["wms", "financeiro"]})
    fake.seed("locations", "l1", {"rua": "A"})
    fake.seed("warehouse_positions", "A-01", {"code": "A-01", "aisle": "A", "shelf": 1})
    fake.seed("billing_price_list", "p1", {"valor_unit": 10})
    fake.seed("billing_config", "default", {"ad_valorem": 0.005})
    fake.seed("products", "prod1", {"produto": "Cadeira"})
    fake.seed("skus", "BTG-1", {"estoque_atual": 3})
    fake.seed("movements", "m1", {"qtde": 3})
    fake.seed("movements", "m2", {"qtde": 1})
    fake.seed("billing_periods", "2026-10", {"status": "aberto"})
    fake.seed("client_invoices", "2026-09", {"total": 100})
    fake.seed("events", "e1", {"type": "inventory.movement"})
    fake.seed("request_counters", "BTG_Pactual_PED", {"last": 43})
    fake.seed("ops_aggregates", "dashboard", {"total_pecas": 4})
    fake.seed("operational_operations", "op1", {"result": {"ok": True}})
    fake.seed("agent_messages", "msg1", {"text": "oi"})
    fake.seed("system_controls", "inventory", {"stock_initialized": True, "movements_frozen": False})
    fake.seed("system_controls", "other", {"flag": True})
    return fake


def seed_comercial(fake: FakeFirestore) -> None:
    """Dados do Comercial, com as subcoleções e os eventos dele em `events`."""
    fake.seed("customer_locations", "loc1", {"customer_code": "Itau", "polo": "CEIC"})
    fake.seed("customer_contacts", "ctt1", {"customer_code": "Itau", "empresa": "Gerenciadora"})
    fake.seed("contracts", "ct1", {"customer_code": "Itau", "regime": "por_demanda"})
    fake.seed("contracts/ct1/aditivos", "ad1", {"numero": 1})
    fake.seed("lpu_items", "lpu1", {"codigo_cliente": "1.01"})
    fake.seed("price_tables", "pt1", {"variante": "Comercial"})
    fake.seed("demands", "10045", {"customer_code": "Itau"})
    fake.seed("quotes", "10045", {"demand_id": "10045"})
    fake.seed("quotes/10045/revisoes", "RV01", {"tipo": "proposta"})
    fake.seed("client_authorizations", "aut1", {"pedido": "4500001"})
    fake.seed("medicoes", "med1", {"competencia": "2026-10"})
    fake.seed("demand_counters", "geral", {"ultimo": 10045})
    fake.seed("comercial_operations", "op1", {"result": {"ok": True}})
    fake.seed("events", "ecom1", {"type": "comercial.demanda_criada", "source": "functions_comercial"})
    fake.seed("events", "ecom2", {"type": "comercial.revisao_enviada", "source": "functions_comercial"})
    # Parecido, mas não é do Comercial: vai embora com os outros eventos.
    fake.seed("events", "e2", {"type": "access.invite", "source": "functions_access"})


def comercial_docs(fake: FakeFirestore) -> dict[str, dict[str, Any]]:
    return {
        name: copy.deepcopy(docs)
        for name, docs in fake.docs.items()
        if name.split("/", 1)[0] in COMERCIAL
    }


@contextlib.contextmanager
def fake_backend(fake: FakeFirestore):
    with mock.patch.object(full_reset_btg, "access_token", return_value="token"), mock.patch.object(
        full_reset_btg, "list_root_collections", fake.list_root_collections
    ), mock.patch.object(full_reset_btg, "fetch_snapshot", fake.fetch_snapshot), mock.patch.object(
        full_reset_btg, "batch_write", fake.batch_write
    ), mock.patch.object(full_reset_btg, "commit_writes", fake.commit_writes), mock.patch.object(
        full_reset_btg, "run_managed_export", fake.run_managed_export
    ):
        yield


def run_main(args: list[str]) -> tuple[int, str]:
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = full_reset_btg.main(args)
    return code, output.getvalue()


class PlanTests(unittest.TestCase):
    def test_default_preserves_access_setup_and_comercial(self) -> None:
        preserved = full_reset_btg.preserved_collections(include_setup=False)
        self.assertEqual(
            preserved,
            set(full_reset_btg.ACCESS_COLLECTIONS)
            | set(full_reset_btg.SETUP_COLLECTIONS)
            | set(COMERCIAL)
            | set(OPERACAO),
        )

    def test_comercial_collections_are_always_preserved(self) -> None:
        # A zeragem é do WMS: nem --include-setup alcança o Comercial.
        self.assertEqual(set(full_reset_btg.COMERCIAL_COLLECTIONS), set(COMERCIAL))
        for include_setup in (False, True):
            with self.subTest(include_setup=include_setup):
                preserved = full_reset_btg.preserved_collections(include_setup=include_setup)
                self.assertTrue(set(COMERCIAL) <= preserved, sorted(set(COMERCIAL) - preserved))
                to_delete, kept = full_reset_btg.split_collections(
                    [*COMERCIAL, "products"], preserved
                )
                self.assertEqual(to_delete, ["products"])
                self.assertEqual(kept, sorted(COMERCIAL))

    def test_operacao_registry_is_always_preserved(self) -> None:
        self.assertEqual(set(full_reset_btg.OPERACAO_COLLECTIONS), set(OPERACAO))
        for include_setup in (False, True):
            preserved = full_reset_btg.preserved_collections(include_setup=include_setup)
            self.assertTrue(set(OPERACAO) <= preserved)
        control = full_reset_btg.control_document_name(PROJECT, DATABASE)
        evento = raw_document("events", "eop1", {"source": "functions_operacao", "type": "collaborator.created"})
        self.assertFalse(full_reset_btg.removable("events", evento, control_name=control))
        wms = raw_document("events", "e1", {"type": "inventory.movement"})
        self.assertTrue(full_reset_btg.removable("events", wms, control_name=control))
        with self.assertRaises(RuntimeError):
            full_reset_btg.delete_writes(
                {"products": [raw_document("collaborators", "col1")]},
                ["products"],
                control_name=control,
            )

    def test_delete_writes_refuse_any_comercial_path(self) -> None:
        # O script só lê documentos das coleções raiz; se um dia descer nas
        # subcoleções, aditivos e revisões continuam fora do alcance.
        control_name = full_reset_btg.control_document_name(PROJECT, DATABASE)
        for path in ("contracts/ct1/aditivos", "quotes/10045/revisoes", "demands"):
            with self.subTest(path=path):
                snapshot = {"products": [raw_document(path, "x")]}
                with self.assertRaises(RuntimeError) as raised:
                    full_reset_btg.delete_writes(snapshot, ["products"], control_name=control_name)
                self.assertIn("Comercial", str(raised.exception))

    def test_comercial_events_stay_and_the_others_go(self) -> None:
        control_name = full_reset_btg.control_document_name(PROJECT, DATABASE)
        snapshot = {
            "events": [
                raw_document("events", "e1", {"type": "inventory.movement", "source": "functions"}),
                raw_document("events", "ecom1", {"source": "functions_comercial"}),
                raw_document("events", "e2", {"source": "functions_comercial_teste"}),
                raw_document("events", "e3"),
            ],
        }
        writes = full_reset_btg.delete_writes(snapshot, ["events"], control_name=control_name)
        self.assertEqual(
            [write["delete"] for write in writes],
            [f"{PREFIX}events/e1", f"{PREFIX}events/e2", f"{PREFIX}events/e3"],
        )
        self.assertEqual(
            full_reset_btg.deletable_counts(snapshot, ["events"], control_name=control_name),
            {"events": 3},
        )
        self.assertEqual(
            full_reset_btg.leftover_counts(
                {"events": snapshot["events"][1:2]}, ["events"], control_name=control_name
            ),
            {},
        )

    def test_customers_delete_only_if_unchanged_since_read(self) -> None:
        # Um cadastro que ganhe `stage` durante o export não pode sair.
        control_name = full_reset_btg.control_document_name(PROJECT, DATABASE)
        customer = raw_document("customers", "btg", update_time="2026-10-20T10:00:00.000000Z")
        writes = full_reset_btg.delete_writes(
            {"customers": [customer]}, ["customers"], control_name=control_name
        )
        self.assertEqual(
            writes,
            [{
                "delete": f"{PREFIX}customers/btg",
                "currentDocument": {"updateTime": "2026-10-20T10:00:00.000000Z"},
            }],
        )

    def test_customers_with_stage_block_only_when_customers_would_go(self) -> None:
        snapshot = {
            "customers": [
                raw_document("customers", "btg", {"customer_code": "BTG Pactual"}),
                raw_document("customers", "prospect-2", {"stage": "prospect"}),
                raw_document("customers", "itau", {"stage": None}),
            ],
        }
        self.assertEqual(
            full_reset_btg.customers_blocking(snapshot, ["customers", "products"]),
            ["itau", "prospect-2"],
        )
        self.assertEqual(full_reset_btg.customers_blocking(snapshot, ["products"]), [])

    def test_contracted_modules_stay_with_the_customer(self) -> None:
        # client_access nasceu na Fase 2: sem estar na lista, a zeragem a
        # apagaria e os clientes voltariam ao contrato padrão.
        self.assertIn("client_access", full_reset_btg.SETUP_COLLECTIONS)
        to_delete, kept = full_reset_btg.split_collections(
            ["customers", "client_profiles", "client_access", "products"],
            full_reset_btg.preserved_collections(include_setup=False),
        )
        self.assertEqual(to_delete, ["products"])
        self.assertEqual(kept, ["client_access", "client_profiles", "customers"])

    def test_include_setup_preserves_only_access_and_comercial(self) -> None:
        preserved = full_reset_btg.preserved_collections(include_setup=True)
        self.assertEqual(
            preserved,
            set(full_reset_btg.ACCESS_COLLECTIONS) | set(COMERCIAL) | set(OPERACAO),
        )

    def test_keep_extends_preserved(self) -> None:
        preserved = full_reset_btg.preserved_collections(
            include_setup=True, keep=["ai_agent_knowledge", " documents ", ""]
        )
        self.assertIn("ai_agent_knowledge", preserved)
        self.assertIn("documents", preserved)
        self.assertNotIn("", preserved)

    def test_unknown_collections_go_to_delete(self) -> None:
        # request_counters e ops_aggregates não existiam quando o reset de
        # julho foi escrito; a descoberta dinâmica precisa pegá-los.
        existing = [
            "users", "products", "request_counters", "ops_aggregates", "events",
            "system_controls", "billing_periods", "customers", "coisa_nova",
        ]
        to_delete, kept = full_reset_btg.split_collections(
            existing, full_reset_btg.preserved_collections(include_setup=False)
        )
        self.assertEqual(
            to_delete,
            ["billing_periods", "coisa_nova", "events", "ops_aggregates",
             "products", "request_counters", "system_controls"],
        )
        self.assertEqual(kept, ["customers", "users"])

    def test_delete_writes_skip_control_doc_and_have_no_preconditions(self) -> None:
        control_name = full_reset_btg.control_document_name(PROJECT, DATABASE)
        snapshot = {
            "system_controls": [
                raw_document("system_controls", "inventory"),
                raw_document("system_controls", "other"),
            ],
            "movements": [raw_document("movements", "m1")],
        }
        writes = full_reset_btg.delete_writes(
            snapshot, ["system_controls", "movements"], control_name=control_name
        )
        self.assertEqual(
            [write["delete"] for write in writes],
            [f"{PREFIX}system_controls/other", f"{PREFIX}movements/m1"],
        )
        self.assertTrue(all("currentDocument" not in write for write in writes))

    def test_replace_write_replaces_whole_document(self) -> None:
        current = raw_document("system_controls", "inventory", {"old": 1})
        write = full_reset_btg.replace_write(
            "system_controls", "inventory", {"new": True}, current,
            project_id=PROJECT, database=DATABASE,
        )
        self.assertNotIn("updateMask", write)
        self.assertEqual(write["currentDocument"], {"updateTime": current["updateTime"]})
        self.assertEqual(list(write["update"]["fields"]), ["new"])

    def test_export_destination_requires_gs_path(self) -> None:
        self.assertEqual(
            full_reset_btg.export_destination("gs://bucket/backups/", "full-reset-x"),
            "gs://bucket/backups/full-reset-x",
        )
        with self.assertRaises(ValueError):
            full_reset_btg.export_destination("bucket/backups", "full-reset-x")
        with self.assertRaises(ValueError):
            full_reset_btg.export_destination("gs://", "full-reset-x")

    def test_run_managed_export_reads_output_uri_from_gcloud(self) -> None:
        operation = json.dumps({"metadata": {"outputUriPrefix": "gs://b/p/full-reset-x"}})
        with mock.patch.object(subprocess, "check_output", return_value=operation) as check:
            uri = full_reset_btg.run_managed_export(
                "gs://b/p/full-reset-x", project_id=PROJECT, database=DATABASE, gcloud="gcloud"
            )
        self.assertEqual(uri, "gs://b/p/full-reset-x")
        argv = check.call_args.args[0]
        self.assertEqual(argv[:4], ["gcloud", "firestore", "export", "gs://b/p/full-reset-x"])
        self.assertIn("--database", argv)


class MainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = seeded_production()
        self.tmp = tempfile.TemporaryDirectory()
        self.backup = Path(self.tmp.name) / "backup.json"
        self.addCleanup(self.tmp.cleanup)

    def apply_args(self, *extra: str, backup: Path | None = None) -> list[str]:
        return [
            "--apply", "--confirm", CONFIRM, "--export-to", "gs://dute-btg-backups/firestore",
            "--backup-path", str(backup or self.backup), *extra,
        ]

    def test_dry_run_lists_plan_and_changes_nothing(self) -> None:
        before = copy.deepcopy(self.fake.docs)
        with fake_backend(self.fake):
            code, output = run_main([])
        self.assertEqual(code, 0)
        plan = json.loads(output.split("\nDry-run")[0])
        self.assertEqual(plan["mode"], "dry-run")
        self.assertEqual(plan["confirmation"], CONFIRM)
        self.assertIn("request_counters", plan["delete"])
        self.assertIn("ops_aggregates", plan["delete"])
        self.assertIn("client_invoices", plan["delete"])
        self.assertEqual(plan["delete"]["movements"], 2)
        self.assertEqual(
            sorted(plan["preserve"]),
            sorted(full_reset_btg.ACCESS_COLLECTIONS + full_reset_btg.SETUP_COLLECTIONS),
        )
        # 13 documentos fora do preservado, menos o controle, que é reescrito.
        self.assertEqual(plan["documents_to_delete"], 12)
        self.assertEqual(plan["delete"]["system_controls"], 1)
        self.assertEqual(self.fake.docs, before)
        self.assertEqual(self.fake.batches, [])
        self.assertEqual(self.fake.exports, [])
        self.assertFalse(self.backup.exists())

    def test_apply_requires_confirmation(self) -> None:
        with fake_backend(self.fake), self.assertRaises(SystemExit):
            run_main(["--apply", "--export-to", "gs://b/p", "--confirm", "errada"])
        self.assertEqual(self.fake.batches, [])

    def test_apply_requires_export_destination(self) -> None:
        with fake_backend(self.fake), self.assertRaises(SystemExit):
            run_main(["--apply", "--confirm", CONFIRM])
        self.assertEqual(self.fake.batches, [])

    def test_keep_cannot_name_the_control_collection(self) -> None:
        with fake_backend(self.fake), self.assertRaises(SystemExit):
            run_main(["--keep", "system_controls"])

    def test_apply_refuses_when_frozen_by_another_operation(self) -> None:
        self.fake.seed(
            "system_controls", "inventory",
            {"movements_frozen": True, "reconciliation_status": "running"},
        )
        with fake_backend(self.fake), self.assertRaises(SystemExit):
            run_main(self.apply_args())
        self.assertEqual(self.fake.batches, [])
        self.assertIn("products", self.fake.collections())

    def test_apply_wipes_everything_but_access_and_setup(self) -> None:
        with fake_backend(self.fake):
            code, output = run_main(self.apply_args())
        self.assertEqual(code, 0)
        self.assertEqual(
            self.fake.collections(),
            sorted(
                list(full_reset_btg.ACCESS_COLLECTIONS)
                + list(full_reset_btg.SETUP_COLLECTIONS)
                + ["events", "system_controls"]
            ),
        )
        # Preservados intactos.
        self.assertEqual(self.fake.fields("users", "u1")["role"], "owner")
        self.assertEqual(self.fake.fields("billing_price_list", "p1")["valor_unit"], 10)
        # Controle reescrito por inteiro: estado de go-live, sem campo antigo.
        control = self.fake.fields("system_controls", "inventory")
        self.assertIs(control["movements_frozen"], False)
        self.assertIs(control["stock_initialized"], False)
        self.assertIs(control["opening_inventory_required"], True)
        self.assertEqual(control["reconciliation_status"], "full_reset_completed")
        self.assertEqual(control["full_reset_deleted_documents"], 12)
        self.assertTrue(control["full_reset_export"].startswith("gs://dute-btg-backups/firestore/full-reset-"))
        self.assertEqual(list(self.fake.docs["system_controls"]), ["inventory"])
        # Um único evento marca o novo início da auditoria.
        events = list(self.fake.docs["events"].values())
        self.assertEqual(len(events), 1)
        event = decode_document(events[0])
        self.assertEqual(event["type"], "system.full_reset_completed")
        self.assertEqual(event["payload"]["deleted_collections"]["movements"], 2)
        self.assertEqual(event["payload"]["deleted_collections"]["request_counters"], 1)
        # Export antes de apagar, backup local com checksum e formato próprio.
        self.assertEqual(len(self.fake.exports), 1)
        self.assertTrue(self.backup.exists())
        self.assertTrue(self.backup.with_suffix(".json.sha256").exists())
        payload = json.loads(self.backup.read_text(encoding="utf-8"))
        self.assertEqual(payload["format"], full_reset_btg.BACKUP_FORMAT)
        self.assertIn("client_invoices", payload["collections"])
        self.assertNotIn("users", payload["collections"])
        result = json.loads(output.rsplit("Export gerenciado concluído", 1)[1].split("\n", 1)[1])
        self.assertTrue(result["ok"])
        self.assertEqual(result["deleted_documents"], 12)

    def test_apply_include_setup_wipes_structure_too(self) -> None:
        with fake_backend(self.fake):
            code, _ = run_main(self.apply_args("--include-setup"))
        self.assertEqual(code, 0)
        self.assertEqual(
            self.fake.collections(),
            sorted(list(full_reset_btg.ACCESS_COLLECTIONS) + ["events", "system_controls"]),
        )

    def test_keep_preserves_extra_collection(self) -> None:
        with fake_backend(self.fake):
            code, _ = run_main(self.apply_args("--keep", "agent_messages"))
        self.assertEqual(code, 0)
        self.assertIn("agent_messages", self.fake.collections())
        self.assertNotIn("products", self.fake.collections())

    def test_export_order_is_before_any_delete(self) -> None:
        with fake_backend(self.fake):
            run_main(self.apply_args())
        delete_batches = [
            index for index, batch in enumerate(self.fake.batches)
            if any("delete" in write for write in batch)
        ]
        # Lote 0 congela; o export acontece antes do primeiro lote com delete.
        self.assertEqual(self.fake.batches[0][0]["update"]["name"], f"{PREFIX}system_controls/inventory")
        self.assertTrue(delete_batches)
        self.assertEqual(len(self.fake.exports), 1)

    def test_export_failure_unfreezes_and_deletes_nothing(self) -> None:
        before = copy.deepcopy(self.fake.docs)

        def failing_export(destination: str, **_: Any) -> str:
            raise subprocess.CalledProcessError(1, ["gcloud", "firestore", "export"])

        with fake_backend(self.fake), mock.patch.object(
            full_reset_btg, "run_managed_export", failing_export
        ), self.assertRaises(SystemExit) as raised:
            run_main(self.apply_args())
        self.assertIn("nada foi apagado", str(raised.exception))
        self.assertEqual(self.fake.fields("system_controls", "inventory"), decode_document(before["system_controls"]["inventory"]))
        self.assertEqual(
            {name: sorted(docs) for name, docs in self.fake.docs.items() if docs},
            {name: sorted(docs) for name, docs in before.items() if docs},
        )

    def test_export_failure_without_previous_control_removes_the_freeze(self) -> None:
        del self.fake.docs["system_controls"]["inventory"]

        def failing_export(destination: str, **_: Any) -> str:
            raise RuntimeError("bucket inexistente")

        with fake_backend(self.fake), mock.patch.object(
            full_reset_btg, "run_managed_export", failing_export
        ), self.assertRaises(SystemExit):
            run_main(self.apply_args())
        self.assertNotIn("inventory", self.fake.docs["system_controls"])
        self.assertIn("products", self.fake.collections())

    def test_leftovers_keep_the_system_frozen(self) -> None:
        self.fake.ignore_deletes_in = {"events"}
        with fake_backend(self.fake), self.assertRaises(RuntimeError) as raised:
            run_main(self.apply_args())
        self.assertIn("events", str(raised.exception))
        control = self.fake.fields("system_controls", "inventory")
        self.assertIs(control["movements_frozen"], True)
        self.assertEqual(control["reconciliation_status"], "full_reset_running")
        self.assertNotIn("products", self.fake.collections())

    def test_dry_run_preserves_comercial_and_counts_its_events(self) -> None:
        seed_comercial(self.fake)
        with fake_backend(self.fake):
            code, output = run_main(["--include-setup"])
        self.assertEqual(code, 0)
        plan = json.loads(output.split("\nDry-run")[0])
        self.assertEqual(sorted(set(COMERCIAL) & set(plan["delete"])), [])
        self.assertTrue(set(COMERCIAL) <= set(plan["preserve"]))
        # e1 (WMS) e e2 (functions_access) saem; os dois do Comercial ficam.
        self.assertEqual(plan["delete"]["events"], 2)
        self.assertEqual(
            plan["preserve_events"],
            {"source": "functions_comercial", "documents": 2},
        )
        self.assertEqual(self.fake.batches, [])

    def test_apply_include_setup_never_touches_comercial(self) -> None:
        seed_comercial(self.fake)
        before = comercial_docs(self.fake)
        with fake_backend(self.fake):
            code, output = run_main(self.apply_args("--include-setup"))
        self.assertEqual(code, 0)
        # Coleções, subcoleções e documentos do Comercial, intactos.
        self.assertEqual(comercial_docs(self.fake), before)
        self.assertNotIn("customers", self.fake.collections())
        self.assertNotIn("products", self.fake.collections())
        # Em events ficam os do Comercial e o evento da zeragem.
        self.assertEqual(
            sorted(self.fake.docs["events"]),
            sorted(["ecom1", "ecom2", next(
                name for name in self.fake.docs["events"] if name.startswith("evt_full-reset-")
            )]),
        )
        self.assertEqual(
            decode_document(self.fake.docs["events"]["ecom1"])["source"], "functions_comercial"
        )
        result = json.loads(output.rsplit("Export gerenciado concluído", 1)[1].split("\n", 1)[1])
        self.assertTrue(result["ok"])
        self.assertEqual(result["preserved_comercial_events"], 2)
        self.assertNotIn("contracts", result["deleted_collections"])
        self.assertEqual(result["deleted_collections"]["events"], 2)
        # 12 do padrão + 7 da estrutura + o evento e2.
        self.assertEqual(result["deleted_documents"], 20)

    def test_apply_keeps_comercial_events_without_include_setup(self) -> None:
        seed_comercial(self.fake)
        with fake_backend(self.fake):
            code, _ = run_main(self.apply_args())
        self.assertEqual(code, 0)
        self.assertIn("ecom1", self.fake.docs["events"])
        self.assertIn("ecom2", self.fake.docs["events"])
        self.assertNotIn("e1", self.fake.docs["events"])
        self.assertNotIn("e2", self.fake.docs["events"])
        self.assertIs(self.fake.fields("system_controls", "inventory")["movements_frozen"], False)

    def test_dry_run_include_setup_stops_when_a_customer_has_stage(self) -> None:
        self.fake.seed("customers", "prospect-1", {"stage": "prospect"})
        with fake_backend(self.fake), self.assertRaises(SystemExit) as raised:
            run_main(["--include-setup"])
        self.assertIn("stage", str(raised.exception))
        self.assertIn("prospect-1", str(raised.exception))
        self.assertEqual(self.fake.batches, [])

    def test_apply_include_setup_with_stage_changes_nothing(self) -> None:
        self.fake.seed("customers", "prospect-1", {"stage": "prospect"})
        before = copy.deepcopy(self.fake.docs)
        with fake_backend(self.fake), self.assertRaises(SystemExit) as raised:
            run_main(self.apply_args("--include-setup"))
        self.assertIn("Nada foi alterado", str(raised.exception))
        self.assertEqual(self.fake.docs, before)
        self.assertEqual(self.fake.batches, [])
        self.assertEqual(self.fake.exports, [])
        self.assertFalse(self.backup.exists())

    def test_stage_does_not_block_when_customers_stays(self) -> None:
        self.fake.seed("customers", "prospect-1", {"stage": "prospect"})
        keep_customer = (
            "--include-setup",
            "--keep", "customers", "--keep", "client_profiles", "--keep", "client_access",
        )
        for index, extra in enumerate(((), keep_customer)):
            with self.subTest(extra=extra):
                fake = copy.deepcopy(self.fake)
                backup = Path(self.tmp.name) / f"backup-{index}.json"
                with fake_backend(fake):
                    code, _ = run_main(self.apply_args(*extra, backup=backup))
                self.assertEqual(code, 0)
                self.assertEqual(fake.fields("customers", "prospect-1")["stage"], "prospect")
                self.assertIn("btg", fake.docs["customers"])
                self.assertIn("btg", fake.docs["client_profiles"])

    def test_prospect_created_after_the_plan_stops_before_export(self) -> None:
        before = copy.deepcopy(self.fake.docs)
        write = self.fake.batch_write

        def freeze_then_create_prospect(writes: list[dict[str, Any]], **kwargs: Any) -> None:
            write(writes, **kwargs)
            if len(self.fake.batches) == 1:
                self.fake.seed("customers", "prospect-9", {"stage": "prospect"})

        with fake_backend(self.fake), mock.patch.object(
            full_reset_btg, "batch_write", freeze_then_create_prospect
        ), self.assertRaises(SystemExit) as raised:
            run_main(self.apply_args("--include-setup"))
        self.assertIn("nada foi apagado", str(raised.exception).lower())
        self.assertIn("prospect-9", self.fake.docs["customers"])
        self.assertIn("products", self.fake.collections())
        self.assertEqual(self.fake.exports, [])
        self.assertEqual(
            self.fake.fields("system_controls", "inventory"),
            decode_document(before["system_controls"]["inventory"]),
        )

    def test_customer_that_gains_stage_during_export_is_not_deleted(self) -> None:
        # O batchWrite não é atômico e client_access e client_profiles vêm antes
        # de customers: a recusa precisa acontecer antes de qualquer delete.
        self.fake.seed("customers", "itau", {"customer_code": "Itau"})
        before = copy.deepcopy(self.fake.docs)
        export = self.fake.run_managed_export

        def export_while_comercial_marks_btg(destination: str, **kwargs: Any) -> str:
            self.fake.seed(
                "customers", "btg", {"customer_code": "BTG Pactual", "stage": "cliente"},
                update_time="2026-10-20T12:00:00.000000Z",
            )
            return export(destination, **kwargs)

        with fake_backend(self.fake), mock.patch.object(
            full_reset_btg, "run_managed_export", export_while_comercial_marks_btg
        ), self.assertRaises(SystemExit) as raised:
            run_main(self.apply_args("--include-setup"))
        self.assertIn("nada foi apagado", str(raised.exception).lower())
        self.assertEqual(self.fake.fields("customers", "btg")["stage"], "cliente")
        # Nenhum cadastro sai, nem o que não mudou, e nada mais é apagado.
        self.assertIn("itau", self.fake.docs["customers"])
        self.assertIn("btg", self.fake.docs["client_profiles"])
        self.assertIn("BTG Pactual", self.fake.docs["client_access"])
        self.assertEqual(
            {name: sorted(docs) for name, docs in self.fake.docs.items() if docs},
            {name: sorted(docs) for name, docs in before.items() if docs},
        )
        # Nada apagado: o controle volta ao estado anterior ao congelamento.
        self.assertEqual(
            self.fake.fields("system_controls", "inventory"),
            decode_document(before["system_controls"]["inventory"]),
        )

    def test_customers_go_first_in_one_atomic_commit(self) -> None:
        self.fake.seed("customers", "itau", {"customer_code": "Itau"})
        with fake_backend(self.fake):
            code, _ = run_main(self.apply_args("--include-setup"))
        self.assertEqual(code, 0)
        delete_calls = [
            [write["delete"] for write in batch if "delete" in write]
            for batch in self.fake.batches
            if any("delete" in write for write in batch)
        ]
        # O primeiro delete é o commit só com customers; o resto vem depois.
        self.assertEqual(
            self.fake.commits,
            [[
                {"delete": f"{PREFIX}customers/btg", "currentDocument": {"updateTime": "2026-10-16T00:00:00.000000Z"}},
                {"delete": f"{PREFIX}customers/itau", "currentDocument": {"updateTime": "2026-10-16T00:00:00.000000Z"}},
            ]],
        )
        self.assertEqual(delete_calls[0], [f"{PREFIX}customers/btg", f"{PREFIX}customers/itau"])
        self.assertTrue(all(f"{PREFIX}customers/" not in name for call in delete_calls[1:] for name in call))
        self.assertNotIn("customers", self.fake.collections())

    def test_commit_error_after_customers_left_keeps_frozen(self) -> None:
        # Erro com o commit já aplicado (prazo estourado, por exemplo): não é
        # "nada apagado", então o estoque segue congelado e nada é desfeito.
        commit = self.fake.commit_writes

        def commit_then_fail(writes: list[dict[str, Any]], **kwargs: Any) -> None:
            commit(writes, **kwargs)
            raise RuntimeError("Firestore respondeu HTTP 504: DEADLINE_EXCEEDED")

        with fake_backend(self.fake), mock.patch.object(
            full_reset_btg, "commit_writes", commit_then_fail
        ), self.assertRaises(RuntimeError):
            run_main(self.apply_args("--include-setup"))
        self.assertNotIn("customers", self.fake.collections())
        control = self.fake.fields("system_controls", "inventory")
        self.assertIs(control["movements_frozen"], True)
        self.assertEqual(control["reconciliation_status"], "full_reset_running")

    def test_keep_events_still_counts_comercial_events(self) -> None:
        # Com --keep events, a leitura depois do congelamento não inclui events.
        seed_comercial(self.fake)
        with fake_backend(self.fake):
            code, output = run_main(self.apply_args("--keep", "events"))
        self.assertEqual(code, 0)
        result = json.loads(output.rsplit("Export gerenciado concluído", 1)[1].split("\n", 1)[1])
        self.assertEqual(result["preserved_comercial_events"], 2)
        self.assertIn("ecom1", self.fake.docs["events"])
        self.assertIn("e1", self.fake.docs["events"])
        event = decode_document(next(
            document for name, document in self.fake.docs["events"].items()
            if name.startswith("evt_full-reset-")
        ))
        self.assertEqual(event["payload"]["preserved_comercial_events"], 2)
        self.assertIn("Eventos do Comercial preservados: 2.", event["description"])

    def test_rerun_is_allowed_while_a_previous_full_reset_is_still_frozen(self) -> None:
        self.fake.seed(
            "system_controls", "inventory",
            {"movements_frozen": True, "reconciliation_status": "full_reset_running"},
        )
        with fake_backend(self.fake):
            code, _ = run_main(self.apply_args())
        self.assertEqual(code, 0)
        self.assertIs(self.fake.fields("system_controls", "inventory")["movements_frozen"], False)


if __name__ == "__main__":
    unittest.main()
