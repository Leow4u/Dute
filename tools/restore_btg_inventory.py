from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reset_btg_inventory import (
    RESET_COLLECTIONS,
    access_token,
    batch_write,
    fetch_snapshot,
    firestore_value,
    guarded_upsert,
    inventory_control,
    utc_now,
)


BACKUP_FORMAT = "firestore-rest-inventory-reset-backup-v1"


def confirmation_phrase(project_id: str, database: str) -> str:
    return f"RESTAURAR ESTOQUE {project_id}/{database}"


def load_backup(path: Path) -> tuple[dict[str, Any], str]:
    resolved = path.expanduser().resolve()
    encoded = resolved.read_bytes()
    digest = hashlib.sha256(encoded).hexdigest()
    checksum_path = resolved.with_suffix(resolved.suffix + ".sha256")
    if not checksum_path.exists():
        raise RuntimeError(f"Checksum ausente: {checksum_path}")
    expected = checksum_path.read_text(encoding="ascii").strip().split()[0]
    if digest.lower() != expected.lower():
        raise RuntimeError(
            "Checksum do backup diverge. A restauração foi interrompida antes "
            "de alterar o Firestore."
        )
    payload = json.loads(encoded)
    if payload.get("format") != BACKUP_FORMAT:
        raise RuntimeError("Formato de backup não reconhecido.")
    return payload, digest


def documents_by_name(
    snapshot: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    return {
        str(document["name"]): document
        for documents in snapshot.values()
        for document in documents
        if document.get("name")
    }


def raw_create_write(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "update": {
            "name": document["name"],
            "fields": document.get("fields", {}),
        },
        "currentDocument": {"exists": False},
    }


def raw_replace_write(
    document: dict[str, Any],
    current: dict[str, Any] | None,
) -> dict[str, Any]:
    write: dict[str, Any] = {
        "update": {
            "name": document["name"],
            "fields": document.get("fields", {}),
        }
    }
    if current and current.get("updateTime"):
        write["currentDocument"] = {"updateTime": current["updateTime"]}
    elif current:
        write["currentDocument"] = {"exists": True}
    else:
        write["currentDocument"] = {"exists": False}
    return write


def event_write(
    event_id: str,
    data: dict[str, Any],
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    return {
        "update": {
            "name": (
                f"projects/{project_id}/databases/{database}/documents/"
                f"events/{event_id}"
            ),
            "fields": {
                key: firestore_value(value)
                for key, value in data.items()
            },
        },
        "currentDocument": {"exists": False},
    }


def verify_document_scope(
    payload: dict[str, Any],
    *,
    project_id: str,
    database: str,
) -> None:
    prefix = f"projects/{project_id}/databases/{database}/documents/"
    for collection, documents in payload.get("collections", {}).items():
        for document in documents:
            name = str(document.get("name", ""))
            if not name.startswith(prefix + collection + "/"):
                raise RuntimeError(
                    f"Documento fora do escopo esperado no backup: {name!r}"
                )


def verify_compatible_target(
    backup: dict[str, list[dict[str, Any]]],
    current: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    backup_by_name = documents_by_name(backup)
    current_by_name = documents_by_name(current)
    unexpected = sorted(set(current_by_name) - set(backup_by_name))
    if unexpected:
        raise RuntimeError(
            "O destino possui documentos que não existem no backup. "
            "Restauração recusada: " + ", ".join(unexpected[:10])
        )
    conflicts = [
        name
        for name in sorted(set(current_by_name) & set(backup_by_name))
        if current_by_name[name].get("fields", {})
        != backup_by_name[name].get("fields", {})
    ]
    if conflicts:
        raise RuntimeError(
            "O destino possui documentos diferentes do backup. Restauração "
            "recusada: " + ", ".join(conflicts[:10])
        )
    return [
        raw_create_write(document)
        for name, document in backup_by_name.items()
        if name not in current_by_name
    ]


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Valida e restaura um backup criado por reset_btg_inventory.py. "
            "Sem --apply, apenas audita o arquivo e o destino."
        )
    )
    result.add_argument("backup", type=Path)
    result.add_argument("--project-id", default="dute-btg")
    result.add_argument("--database", default="(default)")
    result.add_argument("--apply", action="store_true")
    result.add_argument("--confirm")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    payload, digest = load_backup(args.backup)
    if payload.get("project_id") != args.project_id:
        raise SystemExit("O project_id do backup não corresponde ao destino.")
    if payload.get("database") != args.database:
        raise SystemExit("O database do backup não corresponde ao destino.")
    verify_document_scope(
        payload,
        project_id=args.project_id,
        database=args.database,
    )

    backup_snapshot = {
        collection: payload.get("collections", {}).get(collection, [])
        for collection in RESET_COLLECTIONS
    }
    token = access_token()
    current_snapshot = fetch_snapshot(
        (*RESET_COLLECTIONS, "system_controls"),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    restore_writes = verify_compatible_target(
        backup_snapshot,
        {
            collection: current_snapshot.get(collection, [])
            for collection in RESET_COLLECTIONS
        },
    )
    backup_counts = {
        collection: len(backup_snapshot.get(collection, []))
        for collection in RESET_COLLECTIONS
    }
    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "project_id": args.project_id,
                "database": args.database,
                "backup": str(args.backup.expanduser().resolve()),
                "backup_sha256": digest,
                "documents_in_backup": sum(backup_counts.values()),
                "documents_to_restore": len(restore_writes),
                "collections": backup_counts,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not args.apply:
        print(
            "\nDry-run concluído. Nenhum dado foi alterado. Para restaurar, "
            f"use --apply --confirm {confirmation_phrase(args.project_id, args.database)!r}."
        )
        return 0

    expected_confirmation = confirmation_phrase(args.project_id, args.database)
    if args.confirm != expected_confirmation:
        raise SystemExit(
            f"Confirmação obrigatória: --confirm {expected_confirmation!r}"
        )

    control_raw = inventory_control(current_snapshot)
    restore_id = "inventory-restore-" + datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    frozen_at = utc_now()
    batch_write(
        [
            guarded_upsert(
                "system_controls",
                "inventory",
                {
                    "movements_frozen": True,
                    "imports_frozen": True,
                    "reconciliation_status": "restoring",
                    "reconciliation_id": restore_id,
                    "reason": "Restauração controlada do backup de estoque",
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
    print("Movimentações congeladas durante a restauração.")

    current_after_freeze = fetch_snapshot(
        RESET_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    restore_writes = verify_compatible_target(
        backup_snapshot,
        current_after_freeze,
    )
    batch_write(
        restore_writes,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    restored = fetch_snapshot(
        RESET_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    missing_after_restore = verify_compatible_target(backup_snapshot, restored)
    if missing_after_restore:
        raise RuntimeError(
            "A verificação final encontrou documentos ausentes. O estoque "
            "permanece congelado."
        )

    controls_now = fetch_snapshot(
        ("system_controls",),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    current_control = inventory_control(controls_now)
    backup_control = inventory_control(
        {"system_controls": payload.get("collections", {}).get("system_controls", [])}
    )
    completed_at = utc_now()
    final_writes: list[dict[str, Any]] = []
    if backup_control:
        final_writes.append(raw_replace_write(backup_control, current_control))
    else:
        final_writes.append(
            guarded_upsert(
                "system_controls",
                "inventory",
                {
                    "movements_frozen": False,
                    "imports_frozen": True,
                    "reconciliation_status": "restore_completed",
                    "reconciliation_id": restore_id,
                    "updated_at_iso": completed_at,
                },
                current_control,
                project_id=args.project_id,
                database=args.database,
            )
        )
    event_id = "evt_" + restore_id
    final_writes.append(
        event_write(
            event_id,
            {
                "id": event_id,
                "type": "inventory.restore_completed",
                "title": "Backup de estoque restaurado",
                "description": "Catálogo, saldos e fluxos físicos foram restaurados e verificados.",
                "severity": "attention",
                "entity_type": "inventory_restore",
                "entity_id": restore_id,
                "source": "tools/restore_btg_inventory.py",
                "restored_documents": sum(backup_counts.values()),
                "backup_sha256": digest,
                "occurred_at": completed_at,
            },
            project_id=args.project_id,
            database=args.database,
        )
    )
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
                "restore_id": restore_id,
                "restored_documents": sum(backup_counts.values()),
                "backup_sha256": digest,
                "inventory_control_restored": bool(backup_control),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
