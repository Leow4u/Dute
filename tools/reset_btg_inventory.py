from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_ID = "dute-btg"
DATABASE = "(default)"
CUSTOMER_CODE = "BTG Pactual"
HTTP_TIMEOUT_SECONDS = 90
ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / ".backups"

# Dados de catálogo, saldo e fluxos físicos. Usuários, acessos, documentos,
# conhecimento, faturamento e estrutura de endereços são preservados.
RESET_COLLECTIONS = (
    "products",
    "skus",
    "catalog_identities",
    "stock_balances",
    "client_inventory",
    "movements",
    "cycle_counts",
    "opening_inventory_sessions",
    "opening_inventory_lines",
    "inbound_receipts",
    "inbound_items",
    "putaway_tasks",
    "customer_requests",
    "client_request_status",
    "orders",
    "order_items",
    "stock_reservations",
    "client_order_tracking",
    "pick_tasks",
    "pick_lines",
    "pack_tasks",
    "packages",
    "package_items",
    "shipments",
    "shipment_items",
    "returns",
    "return_items",
    "quality_exceptions",
    "ai_agent_inbox",
    "operational_notifications",
)
BACKUP_COLLECTIONS = (
    *RESET_COLLECTIONS,
    "billing_operational_snapshots",
    "system_controls",
)

GCLOUD = (
    os.environ.get("GCLOUD")
    or shutil.which("gcloud")
    or r"C:\Users\leona\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def access_token() -> str:
    if not GCLOUD:
        raise RuntimeError("Google Cloud CLI não encontrado.")
    return subprocess.check_output(
        [GCLOUD, "auth", "print-access-token"],
        text=True,
    ).strip()


def request_json(
    url: str,
    *,
    token: str,
    project_id: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "x-goog-user-project": project_id,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=HTTP_TIMEOUT_SECONDS,
        ) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Firestore respondeu HTTP {error.code}: {body}"
        ) from error


def fetch_collection_raw(
    collection: str,
    *,
    project_id: str,
    database: str,
    token: str,
) -> list[dict[str, Any]]:
    base_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}/"
        f"databases/{database}/documents/"
        f"{urllib.parse.quote(collection, safe='/')}"
    )
    documents: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        query = {"pageSize": "300"}
        if page_token:
            query["pageToken"] = page_token
        payload = request_json(
            f"{base_url}?{urllib.parse.urlencode(query)}",
            token=token,
            project_id=project_id,
        )
        documents.extend(payload.get("documents", []))
        page_token = payload.get("nextPageToken")
        if not page_token:
            return documents


def fetch_snapshot(
    collections: Iterable[str],
    *,
    project_id: str,
    database: str,
    token: str,
) -> dict[str, list[dict[str, Any]]]:
    return {
        collection: fetch_collection_raw(
            collection,
            project_id=project_id,
            database=database,
            token=token,
        )
        for collection in collections
    }


def decode_value(value: dict[str, Any]) -> Any:
    if "nullValue" in value:
        return None
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "stringValue" in value:
        return value["stringValue"]
    if "timestampValue" in value:
        return value["timestampValue"]
    if "arrayValue" in value:
        return [decode_value(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {
            key: decode_value(item)
            for key, item in value["mapValue"].get("fields", {}).items()
        }
    return None


def decode_document(document: dict[str, Any] | None) -> dict[str, Any]:
    if not document:
        return {}
    return {
        key: decode_value(value)
        for key, value in document.get("fields", {}).items()
    }


def firestore_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [firestore_value(item) for item in value]}}
    if isinstance(value, dict):
        return {
            "mapValue": {
                "fields": {
                    str(key): firestore_value(item)
                    for key, item in value.items()
                    if item is not None
                }
            }
        }
    return {"stringValue": str(value)}


def document_name(
    collection: str,
    document_id: str,
    *,
    project_id: str,
    database: str,
) -> str:
    return (
        f"projects/{project_id}/databases/{database}/documents/"
        f"{collection}/{document_id}"
    )


def guarded_upsert(
    collection: str,
    document_id: str,
    data: dict[str, Any],
    current: dict[str, Any] | None,
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    write: dict[str, Any] = {
        "update": {
            "name": document_name(
                collection,
                document_id,
                project_id=project_id,
                database=database,
            ),
            "fields": {
                key: firestore_value(value)
                for key, value in data.items()
            },
        },
        "updateMask": {"fieldPaths": sorted(data)},
    }
    if current and current.get("updateTime"):
        write["currentDocument"] = {"updateTime": current["updateTime"]}
    elif current:
        write["currentDocument"] = {"exists": True}
    else:
        write["currentDocument"] = {"exists": False}
    return write


def batch_write(
    writes: list[dict[str, Any]],
    *,
    project_id: str,
    database: str,
    token: str,
) -> None:
    url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}/"
        f"databases/{database}/documents:batchWrite"
    )
    for index in range(0, len(writes), 400):
        chunk = writes[index : index + 400]
        result = request_json(
            url,
            token=token,
            project_id=project_id,
            method="POST",
            payload={"writes": chunk},
        )
        failures = [
            status
            for status in result.get("status", [])
            if status.get("code", 0) != 0
        ]
        if failures:
            raise RuntimeError(
                "Firestore recusou parte do lote: "
                + json.dumps(failures, ensure_ascii=False)
            )


def inventory_control(
    snapshot: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    for document in snapshot.get("system_controls", []):
        if str(document.get("name", "")).rsplit("/", 1)[-1] == "inventory":
            return document
    return None


def snapshot_signature(
    snapshot: dict[str, list[dict[str, Any]]],
    collections: Iterable[str],
) -> dict[str, list[tuple[str, str]]]:
    return {
        collection: sorted(
            (
                str(document.get("name", "")),
                str(document.get("updateTime", "")),
            )
            for document in snapshot.get(collection, [])
        )
        for collection in collections
    }


def foreign_customers(
    snapshot: dict[str, list[dict[str, Any]]],
    expected_customer: str,
) -> dict[str, list[str]]:
    found: dict[str, set[str]] = {}
    for collection in RESET_COLLECTIONS:
        for document in snapshot.get(collection, []):
            value = document.get("fields", {}).get("customer_code")
            customer = decode_value(value) if isinstance(value, dict) else None
            if customer and str(customer).strip() != expected_customer:
                found.setdefault(collection, set()).add(str(customer).strip())
    return {collection: sorted(values) for collection, values in found.items()}


INVENTORY_BACKUP_FORMAT = "firestore-rest-inventory-reset-backup-v1"


def create_backup(
    path: Path,
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    project_id: str,
    database: str,
    backup_format: str = INVENTORY_BACKUP_FORMAT,
) -> tuple[Path, str]:
    path = path.expanduser().resolve()
    checksum_path = path.with_suffix(path.suffix + ".sha256")
    if path.exists() or checksum_path.exists():
        raise FileExistsError(f"Backup já existe; recusando sobrescrever: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": backup_format,
        "created_at": utc_now(),
        "project_id": project_id,
        "database": database,
        "collections": snapshot,
    }
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode(
        "utf-8"
    )
    with path.open("xb") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    persisted = path.read_bytes()
    if persisted != encoded:
        raise RuntimeError(
            "O backup persistido difere do conteúdo preparado; reset abortado."
        )
    json.loads(persisted)
    digest = hashlib.sha256(persisted).hexdigest()
    with checksum_path.open("x", encoding="ascii", newline="\n") as handle:
        handle.write(f"{digest}  {path.name}\n")
        handle.flush()
        os.fsync(handle.fileno())
    return path, digest


def delete_writes(
    snapshot: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    writes: list[dict[str, Any]] = []
    for collection in RESET_COLLECTIONS:
        for document in snapshot.get(collection, []):
            name = str(document.get("name", ""))
            if not name:
                continue
            write: dict[str, Any] = {"delete": name}
            if document.get("updateTime"):
                write["currentDocument"] = {
                    "updateTime": document["updateTime"]
                }
            else:
                write["currentDocument"] = {"exists": True}
            writes.append(write)
    return writes


def confirmation_phrase(project_id: str, database: str) -> str:
    return f"ZERAR ESTOQUE {project_id}/{database}"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Faz backup e zera somente catálogo, saldo e fluxos físicos do BTG. "
            "Sem --apply, apenas audita e exibe o plano."
        )
    )
    result.add_argument("--project-id", default=PROJECT_ID)
    result.add_argument("--database", default=DATABASE)
    result.add_argument("--customer-code", default=CUSTOMER_CODE)
    result.add_argument("--backup-path", type=Path)
    result.add_argument("--apply", action="store_true")
    result.add_argument("--confirm")
    result.add_argument("--allow-foreign-customer", action="store_true")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    token = access_token()
    snapshot = fetch_snapshot(
        BACKUP_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    counts = {
        collection: len(snapshot.get(collection, []))
        for collection in RESET_COLLECTIONS
    }
    control_raw = inventory_control(snapshot)
    control = decode_document(control_raw)
    foreign = foreign_customers(snapshot, args.customer_code)
    plan = {
        "mode": "apply" if args.apply else "dry-run",
        "project_id": args.project_id,
        "database": args.database,
        "customer_code": args.customer_code,
        "documents_to_delete": sum(counts.values()),
        "collections": counts,
        "foreign_customers": foreign,
        "inventory_control": control,
        "preserved": [
            "authentication and access",
            "customers",
            "documents and knowledge",
            "billing",
            "locations",
            "events and operational audit",
            "product photos in Cloud Storage",
        ],
    }
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.apply:
        print(
            "\nDry-run concluído. Nenhum dado foi alterado. Para aplicar, use "
            f"--apply --confirm {confirmation_phrase(args.project_id, args.database)!r}."
        )
        return 0

    expected_confirmation = confirmation_phrase(args.project_id, args.database)
    if args.confirm != expected_confirmation:
        raise SystemExit(
            f"Confirmação obrigatória: --confirm {expected_confirmation!r}"
        )
    if foreign and not args.allow_foreign_customer:
        raise SystemExit(
            "Foram encontrados dados de outro cliente nas coleções de estoque. "
            "Revise o dry-run; para incluir conscientemente esses registros, use "
            "--allow-foreign-customer."
        )
    if control.get("movements_frozen") is True or control.get(
        "reconciliation_status"
    ) == "running":
        raise SystemExit(
            "O estoque já está congelado por outra operação. Resolva o controle "
            "system_controls/inventory antes de continuar."
        )

    reset_id = "inventory-reset-" + datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    default_backup = BACKUP_DIR / f"{reset_id}.json"
    backup_path, backup_hash = create_backup(
        args.backup_path or default_backup,
        snapshot,
        project_id=args.project_id,
        database=args.database,
    )
    print(f"Backup criado: {backup_path}")
    print(f"SHA-256: {backup_hash}")

    frozen_at = utc_now()
    batch_write(
        [
            guarded_upsert(
                "system_controls",
                "inventory",
                {
                    "movements_frozen": True,
                    "imports_frozen": True,
                    "reconciliation_status": "running",
                    "reconciliation_id": reset_id,
                    "reason": "Zeragem autorizada para inventário físico de abertura",
                    "frozen_at": frozen_at,
                    "updated_at_iso": frozen_at,
                },
                control_raw,
                project_id=args.project_id,
                database=args.database,
            )
        ],
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    print("Movimentações congeladas durante a zeragem.")

    frozen_snapshot = fetch_snapshot(
        RESET_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    if snapshot_signature(snapshot, RESET_COLLECTIONS) != snapshot_signature(
        frozen_snapshot, RESET_COLLECTIONS
    ):
        raise RuntimeError(
            "Os dados mudaram entre o backup e o congelamento. Nada foi apagado; "
            "o estoque permanece congelado para revisão segura."
        )

    writes = delete_writes(snapshot)
    batch_write(
        writes,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    remaining = fetch_snapshot(
        RESET_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    remaining_counts = {
        collection: len(remaining.get(collection, []))
        for collection in RESET_COLLECTIONS
    }
    if any(remaining_counts.values()):
        raise RuntimeError(
            "A verificação encontrou registros remanescentes. O estoque permanece "
            "congelado. Contagens: "
            + json.dumps(remaining_counts, ensure_ascii=False)
        )

    controls_after_delete = fetch_snapshot(
        ("system_controls",),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    current_control_raw = inventory_control(controls_after_delete)
    completed_at = utc_now()
    event_id = "evt_" + reset_id
    final_writes = [
        guarded_upsert(
            "system_controls",
            "inventory",
            {
                "movements_frozen": False,
                "imports_frozen": True,
                "reconciliation_status": "reset_completed",
                "reconciliation_id": reset_id,
                "last_reconciliation_id": reset_id,
                "last_reconciled_at": completed_at,
                "stock_initialized": False,
                "opening_inventory_required": True,
                "stock_reset_at": completed_at,
                "stock_reset_backup": str(backup_path),
                "stock_reset_backup_sha256": backup_hash,
                "stock_reset_deleted_documents": len(writes),
                "updated_at_iso": completed_at,
            },
            current_control_raw,
            project_id=args.project_id,
            database=args.database,
        ),
        guarded_upsert(
            "events",
            event_id,
            {
                "id": event_id,
                "type": "inventory.reset_completed",
                "title": "Estoque zerado para inventário de abertura",
                "description": (
                    "Catálogo, saldos e fluxos físicos anteriores foram removidos "
                    "após backup verificado."
                ),
                "severity": "attention",
                "entity_type": "inventory_reset",
                "entity_id": reset_id,
                "customer_code": args.customer_code,
                "source": "tools/reset_btg_inventory.py",
                "deleted_documents": len(writes),
                "backup_sha256": backup_hash,
                "occurred_at": completed_at,
            },
            None,
            project_id=args.project_id,
            database=args.database,
        ),
    ]
    batch_write(
        final_writes,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "reset_id": reset_id,
                "deleted_documents": len(writes),
                "backup": str(backup_path),
                "backup_sha256": backup_hash,
                "remaining": remaining_counts,
                "movements_frozen": False,
                "opening_inventory_required": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
