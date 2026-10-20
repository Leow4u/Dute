"""Migração do Firestore e do Auth entre projetos (Fase 1: dute-btg -> dute-prod).

Comandos (usam o token do gcloud de quem roda; nada é gravado sem --aplicar):

  inventario      Lê o banco inteiro, em qualquer profundidade (consulta sem
                  coleção, com allDescendants), num instante só (readTime), e
                  grava um manifesto JSON: por documento, o caminho, o hash dos
                  campos e o updateTime; por coleção, a contagem; e em que
                  campos aparece cada texto de --procurar (sem o valor).
  comparar        Compara o manifesto da origem com o do destino: contagem por
                  coleção e hash por documento. Sai com 1 se houver diferença.
  trocar-bucket   Troca o bucket antigo pelo novo em todo texto do banco (links
                  de download das fotos e anexos, campos `bucket`), com
                  precondição de updateTime por documento.
  importar-auth   Importa o export do Firebase Auth (firebase auth:export
                  --format=json) no destino com o hash SCRYPT da origem, lido da
                  configuração da origem na hora: a chave não vai para o disco.
  comparar-auth   Compara dois exports do Auth: contas, e-mail, desativado,
                  claims e se há hash de senha.

Manifestos e exports têm caminhos e contas de produção: ficam em tmp/ e
.secrets/ (fora do git). Roteiro: docs/plataforma/fase-1-corte.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from reset_btg_inventory import access_token, request_json


DATABASE = "(default)"
FIRESTORE_API = "https://firestore.googleapis.com/v1"
IDENTITY_API = "https://identitytoolkit.googleapis.com/admin/v2"
PAGE_SIZE = 1000
# Máximo de escritas por chamada do batchWrite do Firestore.
BATCH_WRITE_LIMIT = 500
MANIFEST_FORMAT = "dute-migracao-firestore-v1"
REFERENCE_PREFIX = re.compile(r"^projects/[^/]+/databases/[^/]+/documents/")
SIMPLE_FIELD = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")
FIREBASE = (
    os.environ.get("FIREBASE")
    or shutil.which("firebase")
    or r"C:\Users\leona\AppData\Roaming\npm\firebase.cmd"
)

# (url, corpo) -> resposta JSON. Nos testes, um Firestore falso em memória.
Fetch = Callable[[str, dict[str, Any] | None], Any]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def documents_root(project_id: str, database: str = DATABASE) -> str:
    return f"projects/{project_id}/databases/{database}/documents"


def relative_path(name: str) -> str:
    """projects/p/databases/d/documents/a/b -> a/b"""
    return name.split("/documents/", 1)[1]


def collection_pattern(path: str) -> str:
    """Coleção do documento, sem os IDs: produtos/abc/fotos/f1 -> produtos/*/fotos."""
    parts = path.split("/")[:-1]
    return "/".join(part if index % 2 == 0 else "*" for index, part in enumerate(parts))


def normalize_value(value: dict[str, Any]) -> dict[str, Any]:
    """Forma canônica de um valor do Firestore para o hash.

    A referência perde o prefixo do projeto (muda de projeto para projeto) e
    mapa ou lista vazios têm uma forma só.
    """
    if "referenceValue" in value:
        return {"referenceValue": REFERENCE_PREFIX.sub("", value["referenceValue"])}
    if "mapValue" in value:
        fields = value["mapValue"].get("fields", {})
        return {"mapValue": {"fields": {key: normalize_value(item) for key, item in fields.items()}}}
    if "arrayValue" in value:
        values = value["arrayValue"].get("values", [])
        return {"arrayValue": {"values": [normalize_value(item) for item in values]}}
    return value


def fields_hash(fields: dict[str, Any]) -> str:
    canonical = json.dumps(
        {key: normalize_value(value) for key, value in fields.items()},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def text_mentions(fields: dict[str, Any], needles: list[str]) -> Iterator[tuple[str, str]]:
    """(campo, texto procurado) de cada texto que contém um dos procurados."""

    def walk(value: dict[str, Any], path: str) -> Iterator[tuple[str, str]]:
        if "stringValue" in value:
            for needle in needles:
                if needle in value["stringValue"]:
                    yield path, needle
        elif "referenceValue" in value:
            for needle in needles:
                if needle in REFERENCE_PREFIX.sub("", value["referenceValue"]):
                    yield path, needle
        elif "mapValue" in value:
            for key, item in sorted(value["mapValue"].get("fields", {}).items()):
                yield from walk(item, f"{path}.{key}")
        elif "arrayValue" in value:
            for index, item in enumerate(value["arrayValue"].get("values", [])):
                yield from walk(item, f"{path}[{index}]")

    for key, value in sorted(fields.items()):
        yield from walk(value, key)


def generic_field(field: str) -> str:
    """fotos[3].url -> fotos[].url, para agrupar no relatório."""
    return re.sub(r"\[\d+\]", "[]", field)


def scan_documents(
    fetch: Fetch,
    project_id: str,
    *,
    database: str = DATABASE,
    read_time: str | None = None,
    page_size: int = PAGE_SIZE,
) -> Iterator[tuple[dict[str, Any], str]]:
    """Todos os documentos do banco, em ordem de caminho, no mesmo readTime.

    Sem read_time, a primeira página fixa o instante e as outras o repetem:
    o inventário inteiro é um retrato só, mesmo com escrita acontecendo.
    """
    url = f"{FIRESTORE_API}/{documents_root(project_id, database)}:runQuery"
    last_name: str | None = None
    while True:
        query: dict[str, Any] = {
            "from": [{"allDescendants": True}],
            "orderBy": [{"field": {"fieldPath": "__name__"}, "direction": "ASCENDING"}],
            "limit": page_size,
        }
        if last_name:
            query["startAt"] = {"values": [{"referenceValue": last_name}], "before": False}
        payload: dict[str, Any] = {"structuredQuery": query}
        if read_time:
            payload["readTime"] = read_time
        rows = fetch(url, payload)
        documents = [row["document"] for row in rows if "document" in row]
        if read_time is None:
            read_time = next((row["readTime"] for row in rows if row.get("readTime")), None)
        for document in documents:
            yield document, read_time or ""
        if len(documents) < page_size:
            return
        last_name = documents[-1]["name"]


def build_manifest(
    fetch: Fetch,
    project_id: str,
    *,
    database: str = DATABASE,
    read_time: str | None = None,
    needles: list[str] | None = None,
    page_size: int = PAGE_SIZE,
) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    documents: dict[str, dict[str, str]] = {}
    mentions: list[dict[str, str]] = []
    snapshot_time = read_time
    for document, row_read_time in scan_documents(
        fetch, project_id, database=database, read_time=read_time, page_size=page_size
    ):
        snapshot_time = snapshot_time or row_read_time
        path = relative_path(document["name"])
        fields = document.get("fields", {})
        counts[collection_pattern(path)] += 1
        documents[path] = {
            "hash": fields_hash(fields),
            "update_time": document.get("updateTime", ""),
        }
        for field, needle in text_mentions(fields, needles or []):
            mentions.append({"path": path, "field": field, "needle": needle})
    return {
        "format": MANIFEST_FORMAT,
        "project": project_id,
        "database": database,
        "read_time": snapshot_time,
        "generated_at": utc_now(),
        "total": sum(counts.values()),
        "counts": dict(sorted(counts.items())),
        "documents": documents,
        "mentions": mentions,
    }


def mention_summary(manifest: dict[str, Any]) -> list[tuple[str, str, str, int]]:
    """(coleção, campo, texto procurado, quantos) a partir das menções."""
    grouped: Counter[tuple[str, str, str]] = Counter()
    for mention in manifest.get("mentions", []):
        grouped[
            (
                collection_pattern(mention["path"]),
                generic_field(mention["field"]),
                mention["needle"],
            )
        ] += 1
    return [(*key, count) for key, count in sorted(grouped.items())]


def compare_manifests(source: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    patterns = sorted(set(source["counts"]) | set(target["counts"]))
    counts = [
        (pattern, source["counts"].get(pattern, 0), target["counts"].get(pattern, 0))
        for pattern in patterns
    ]
    source_docs = source["documents"]
    target_docs = target["documents"]
    missing = sorted(set(source_docs) - set(target_docs))
    extra = sorted(set(target_docs) - set(source_docs))
    changed = sorted(
        path
        for path in set(source_docs) & set(target_docs)
        if source_docs[path]["hash"] != target_docs[path]["hash"]
    )
    return {
        "counts": counts,
        "missing": missing,
        "extra": extra,
        "changed": changed,
        "equal": not missing and not extra and not changed,
    }


def replace_in_value(value: dict[str, Any], old: str, new: str) -> tuple[dict[str, Any], bool]:
    if "stringValue" in value:
        text = value["stringValue"]
        if old in text:
            return {"stringValue": text.replace(old, new)}, True
        return value, False
    if "mapValue" in value:
        changed = False
        fields: dict[str, Any] = {}
        for key, item in value["mapValue"].get("fields", {}).items():
            fields[key], item_changed = replace_in_value(item, old, new)
            changed = changed or item_changed
        return ({"mapValue": {"fields": fields}}, True) if changed else (value, False)
    if "arrayValue" in value:
        changed = False
        values: list[dict[str, Any]] = []
        for item in value["arrayValue"].get("values", []):
            new_item, item_changed = replace_in_value(item, old, new)
            values.append(new_item)
            changed = changed or item_changed
        return ({"arrayValue": {"values": values}}, True) if changed else (value, False)
    return value, False


def rewrite_fields(document: dict[str, Any], old: str, new: str) -> dict[str, Any]:
    """Campos de primeiro nível que mudam, já com o valor novo inteiro."""
    changes: dict[str, Any] = {}
    for key, value in document.get("fields", {}).items():
        new_value, changed = replace_in_value(value, old, new)
        if changed:
            changes[key] = new_value
    return changes


def quote_field(name: str) -> str:
    if SIMPLE_FIELD.match(name):
        return name
    return "`" + name.replace("\\", "\\\\").replace("`", "\\`") + "`"


def rewrite_write(document: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    """Atualiza só os campos trocados, e só se o documento não mudou desde a leitura."""
    return {
        "update": {"name": document["name"], "fields": changes},
        "updateMask": {"fieldPaths": [quote_field(key) for key in sorted(changes)]},
        "currentDocument": {"updateTime": document["updateTime"]},
    }


def plan_bucket_rewrite(
    fetch: Fetch,
    project_id: str,
    old: str,
    new: str,
    *,
    database: str = DATABASE,
    page_size: int = PAGE_SIZE,
) -> list[dict[str, Any]]:
    writes: list[dict[str, Any]] = []
    for document, _ in scan_documents(fetch, project_id, database=database, page_size=page_size):
        changes = rewrite_fields(document, old, new)
        if changes:
            writes.append(rewrite_write(document, changes))
    return writes


def apply_writes(
    fetch: Fetch,
    project_id: str,
    writes: list[dict[str, Any]],
    *,
    database: str = DATABASE,
) -> list[tuple[str, str]]:
    """Grava em lotes; devolve (documento, erro) do que o Firestore recusou."""
    url = f"{FIRESTORE_API}/{documents_root(project_id, database)}:batchWrite"
    failures: list[tuple[str, str]] = []
    for start in range(0, len(writes), BATCH_WRITE_LIMIT):
        batch = writes[start : start + BATCH_WRITE_LIMIT]
        response = fetch(url, {"writes": batch})
        for write, status in zip(batch, response.get("status", [{}] * len(batch))):
            if status.get("code", 0) != 0:
                failures.append(
                    (relative_path(write["update"]["name"]), status.get("message", str(status)))
                )
    return failures


def load_auth_export(path: Path) -> dict[str, dict[str, Any]]:
    users = json.loads(path.read_text(encoding="utf-8")).get("users", [])
    return {user["localId"]: user for user in users}


def claims(user: dict[str, Any]) -> Any:
    raw = user.get("customAttributes")
    return json.loads(raw) if raw else None


def compare_auth(source: dict[str, dict[str, Any]], target: dict[str, dict[str, Any]]) -> dict[str, Any]:
    missing = sorted(set(source) - set(target))
    extra = sorted(set(target) - set(source))
    different: list[tuple[str, str]] = []
    for uid in sorted(set(source) & set(target)):
        a, b = source[uid], target[uid]
        # O hash da senha não entra aqui: o export do destino não traz hash
        # importado com a chave de outro projeto. A senha é conferida pela API
        # (passwords_missing).
        for label, left, right in (
            ("email", a.get("email"), b.get("email")),
            ("desativado", bool(a.get("disabled")), bool(b.get("disabled"))),
            ("claims", claims(a), claims(b)),
            (
                "provedores",
                sorted(p.get("providerId", "") for p in a.get("providerUserInfo", [])),
                sorted(p.get("providerId", "") for p in b.get("providerUserInfo", [])),
            ),
        ):
            if left != right:
                different.append((uid, label))
    return {
        "source": len(source),
        "target": len(target),
        "with_password": sum(1 for user in source.values() if user.get("passwordHash")),
        "missing": missing,
        "extra": extra,
        "different": different,
        "equal": not missing and not extra and not different,
    }


def passwords_missing(fetch: Fetch, project_id: str, uids: list[str], *, chunk: int = 100) -> list[str]:
    """Contas do destino sem senha gravada (sem o provedor password)."""
    url = f"https://identitytoolkit.googleapis.com/v1/projects/{project_id}/accounts:lookup"
    found: dict[str, bool] = {}
    for start in range(0, len(uids), chunk):
        response = fetch(url, {"localId": uids[start : start + chunk]})
        for user in response.get("users", []):
            providers = {p.get("providerId") for p in user.get("providerUserInfo", [])}
            found[user["localId"]] = "password" in providers and bool(user.get("passwordUpdatedAt"))
    return sorted(uid for uid in uids if not found.get(uid))


def scrypt_config(fetch: Fetch, project_id: str) -> dict[str, Any]:
    config = fetch(f"{IDENTITY_API}/projects/{project_id}/config", None)
    hash_config = config.get("signIn", {}).get("hashConfig", {})
    required = ("algorithm", "signerKey", "saltSeparator", "rounds", "memoryCost")
    if hash_config.get("algorithm") != "SCRYPT" or any(key not in hash_config for key in required):
        raise RuntimeError(f"{project_id}: configuração de hash sem os parâmetros do SCRYPT.")
    return hash_config


def auth_import_command(path: Path, target: str, hash_config: dict[str, Any]) -> list[str]:
    return [
        FIREBASE,
        "auth:import",
        str(path),
        "--hash-algo=SCRYPT",
        f"--hash-key={hash_config['signerKey']}",
        f"--salt-separator={hash_config['saltSeparator']}",
        f"--rounds={hash_config['rounds']}",
        f"--mem-cost={hash_config['memoryCost']}",
        "--project",
        target,
        "--non-interactive",
    ]


def gcloud_fetch(project_id: str) -> Fetch:
    token = access_token()

    def fetch(url: str, payload: dict[str, Any] | None) -> Any:
        return request_json(
            url,
            token=token,
            project_id=project_id,
            method="GET" if payload is None else "POST",
            payload=payload,
        )

    return fetch


def print_counts(rows: list[tuple[str, int, int]], source: str, target: str) -> None:
    width = max([len("coleção"), *(len(row[0]) for row in rows)])
    print(f"{'coleção':<{width}}  {source:>12}  {target:>12}")
    for pattern, left, right in rows:
        flag = "" if left == right else "  <- diferente"
        print(f"{pattern:<{width}}  {left:>12}  {right:>12}{flag}")
    print(f"{'total':<{width}}  {sum(r[1] for r in rows):>12}  {sum(r[2] for r in rows):>12}")


def print_list(title: str, items: list[Any], limit: int = 20) -> None:
    if not items:
        return
    print(f"{title}: {len(items)}")
    for item in items[:limit]:
        print(f"  {item}")
    if len(items) > limit:
        print(f"  ... e mais {len(items) - limit}")


def command_inventario(args: argparse.Namespace) -> int:
    manifest = build_manifest(
        gcloud_fetch(args.projeto),
        args.projeto,
        database=args.banco,
        read_time=args.read_time,
        needles=args.procurar,
    )
    out = Path(args.saida)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.projeto}: {manifest['total']} documentos em {len(manifest['counts'])} coleções, readTime {manifest['read_time']}")
    for pattern, count in manifest["counts"].items():
        print(f"  {pattern}: {count}")
    for pattern, field, needle, count in mention_summary(manifest):
        print(f"  cita {needle}: {pattern} . {field} ({count})")
    print(f"Manifesto: {out}")
    return 0


def command_comparar(args: argparse.Namespace) -> int:
    source = json.loads(Path(args.origem).read_text(encoding="utf-8"))
    target = json.loads(Path(args.destino).read_text(encoding="utf-8"))
    result = compare_manifests(source, target)
    print_counts(result["counts"], source["project"], target["project"])
    print_list("Faltam no destino", result["missing"])
    print_list("Sobram no destino", result["extra"])
    print_list("Conteúdo diferente", result["changed"])
    print("Iguais." if result["equal"] else "DIFERENTES.")
    return 0 if result["equal"] else 1


def command_trocar_bucket(args: argparse.Namespace) -> int:
    fetch = gcloud_fetch(args.projeto)
    writes = plan_bucket_rewrite(fetch, args.projeto, args.de, args.para, database=args.banco)
    by_collection = Counter(collection_pattern(relative_path(w["update"]["name"])) for w in writes)
    fields = sum(len(w["updateMask"]["fieldPaths"]) for w in writes)
    print(f"{args.projeto}: {len(writes)} documentos e {fields} campos citam {args.de}")
    for pattern, count in sorted(by_collection.items()):
        print(f"  {pattern}: {count}")
    if not args.aplicar:
        print("Só o plano. Para gravar, rode de novo com --aplicar.")
        return 0
    failures = apply_writes(fetch, args.projeto, writes, database=args.banco)
    print(f"Gravados: {len(writes) - len(failures)} de {len(writes)}")
    print_list("Recusados (rode de novo)", failures)
    return 0 if not failures else 1


def command_importar_auth(args: argparse.Namespace) -> int:
    path = Path(args.arquivo)
    users = load_auth_export(path)
    hash_config = scrypt_config(gcloud_fetch(args.origem), args.origem)
    print(f"{len(users)} contas de {path.name}: importando em {args.destino} com o SCRYPT de {args.origem}")
    # A chave do hash vai só na linha de comando do firebase, nunca no disco.
    completed = subprocess.run(auth_import_command(path, args.destino, hash_config), check=False)
    return completed.returncode


def command_comparar_auth(args: argparse.Namespace) -> int:
    source = load_auth_export(Path(args.origem))
    result = compare_auth(source, load_auth_export(Path(args.destino)))
    print(f"Contas: origem {result['source']}, destino {result['target']}; com senha na origem: {result['with_password']}")
    print_list("Faltam no destino (uid)", result["missing"])
    print_list("Sobram no destino (uid)", result["extra"])
    print_list("Diferentes (uid, campo)", result["different"])
    equal = result["equal"]
    with_password = sorted(uid for uid, user in source.items() if user.get("passwordHash"))
    without = passwords_missing(gcloud_fetch(args.projeto_destino), args.projeto_destino, with_password)
    print(f"Senha gravada no {args.projeto_destino}: {len(with_password) - len(without)} de {len(with_password)}")
    print_list("Sem senha no destino (uid)", without)
    equal = equal and not without
    print("Iguais." if equal else "DIFERENTES.")
    return 0 if equal else 1


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = root.add_subparsers(dest="comando", required=True)

    inventario = commands.add_parser("inventario", help="manifesto do banco inteiro")
    inventario.add_argument("--projeto", required=True)
    inventario.add_argument("--banco", default=DATABASE)
    inventario.add_argument("--saida", required=True, help="arquivo JSON, em tmp/")
    inventario.add_argument("--read-time", help="instante da leitura (até 1 hora atrás, sem PITR)")
    inventario.add_argument("--procurar", action="append", default=[], help="texto a localizar, ex.: dute-btg")
    inventario.set_defaults(run=command_inventario)

    comparar = commands.add_parser("comparar", help="compara dois manifestos")
    comparar.add_argument("--origem", required=True)
    comparar.add_argument("--destino", required=True)
    comparar.set_defaults(run=command_comparar)

    trocar = commands.add_parser("trocar-bucket", help="troca o bucket nos textos do banco")
    trocar.add_argument("--projeto", required=True)
    trocar.add_argument("--banco", default=DATABASE)
    trocar.add_argument("--de", required=True, help="bucket antigo, ex.: dute-btg.firebasestorage.app")
    trocar.add_argument("--para", required=True, help="bucket novo, ex.: dute-prod.firebasestorage.app")
    trocar.add_argument("--aplicar", action="store_true")
    trocar.set_defaults(run=command_trocar_bucket)

    importar = commands.add_parser("importar-auth", help="importa usuários com o hash da origem")
    importar.add_argument("--arquivo", required=True, help="export do firebase auth:export, em .secrets/")
    importar.add_argument("--origem", required=True)
    importar.add_argument("--destino", required=True)
    importar.set_defaults(run=command_importar_auth)

    comparar_auth = commands.add_parser("comparar-auth", help="compara dois exports do Auth")
    comparar_auth.add_argument("--origem", required=True)
    comparar_auth.add_argument("--destino", required=True)
    comparar_auth.add_argument("--projeto-destino", required=True, help="onde conferir a senha de cada conta")
    comparar_auth.set_defaults(run=command_comparar_auth)
    return root


def main(argv: list[str] | None = None) -> int:
    # O console do Windows nem sempre está em UTF-8; sem isso os acentos saem trocados.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parser().parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
