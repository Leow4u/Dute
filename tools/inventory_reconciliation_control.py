from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any

try:
    from tools import import_btg_firestore as importer
    from tools.reconcile_btg_operational_data import decode_firestore_document
except ImportError:  # Direct execution from tools/.
    import import_btg_firestore as importer
    from reconcile_btg_operational_data import decode_firestore_document


COLLECTION = "system_controls"
DOCUMENT_ID = "inventory"


def current_control(
    *, project_id: str, database: str, access_token: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    documents = importer.fetch_collection_raw(
        COLLECTION,
        project_id=project_id,
        database=database,
        access_token=access_token,
    )
    for document in documents:
        if str(document.get("name", "")).rsplit("/", 1)[-1] == DOCUMENT_ID:
            return decode_firestore_document(document), document
    return None, None


def guarded_write(
    data: dict[str, Any],
    current_raw: dict[str, Any] | None,
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    write = importer.upsert(
        COLLECTION,
        DOCUMENT_ID,
        data,
        project_id=project_id,
        database=database,
    )
    if current_raw and current_raw.get("updateTime"):
        write["currentDocument"] = {"updateTime": current_raw["updateTime"]}
    elif current_raw:
        write["currentDocument"] = {"exists": True}
    else:
        write["currentDocument"] = {"exists": False}
    return write


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Controla o congelamento transacional da reconciliação de estoque."
    )
    result.add_argument("action", choices=["status", "freeze", "complete"])
    result.add_argument("--project-id", default=importer.PROJECT_ID)
    result.add_argument("--database", default=importer.DATABASE)
    result.add_argument("--reconciliation-id")
    result.add_argument("--reason")
    result.add_argument("--catalog-balance", type=int)
    result.add_argument("--sku-balance", type=int)
    result.add_argument("--movement-balance", type=int)
    result.add_argument("--firestore-balance", type=int)
    result.add_argument("--confirm")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    access_token = importer.token()
    current, current_raw = current_control(
        project_id=args.project_id,
        database=args.database,
        access_token=access_token,
    )
    if args.action == "status":
        print(json.dumps(current or {"status": "not-configured"}, ensure_ascii=False, indent=2))
        return 0

    expected = f"{args.action.upper()} {args.project_id}/{args.database}"
    if args.confirm != expected:
        raise SystemExit(f"Confirmação obrigatória: --confirm {expected!r}")
    if not args.reconciliation_id:
        raise SystemExit("--reconciliation-id é obrigatório")

    now = datetime.now(timezone.utc).isoformat()
    if args.action == "freeze":
        if current and current.get("movements_frozen"):
            if current.get("reconciliation_id") != args.reconciliation_id:
                raise SystemExit(
                    "Estoque já congelado por outra reconciliação: "
                    f"{current.get('reconciliation_id')}"
                )
            print(json.dumps(current, ensure_ascii=False, indent=2))
            return 0
        data = {
            "movements_frozen": True,
            "imports_frozen": True,
            "reconciliation_status": "running",
            "reconciliation_id": args.reconciliation_id,
            "reason": args.reason or "Reconciliação dos saldos reais BTG",
            "frozen_at": now,
            "updated_at_iso": now,
        }
    else:
        if not current or current.get("reconciliation_id") != args.reconciliation_id:
            raise SystemExit("A reconciliação informada não é a reconciliação ativa")
        if not current.get("movements_frozen"):
            raise SystemExit("O estoque não está congelado")
        balances = {
            "catalog": args.catalog_balance,
            "skus": args.sku_balance,
            "movements": args.movement_balance,
            "firestore": args.firestore_balance,
        }
        if any(value is None for value in balances.values()):
            raise SystemExit(
                "Informe --catalog-balance, --sku-balance, --movement-balance e --firestore-balance"
            )
        data = {
            "movements_frozen": False,
            "imports_frozen": True,
            "reconciliation_status": "completed",
            "reconciliation_id": args.reconciliation_id,
            "last_reconciliation_id": args.reconciliation_id,
            "last_reconciled_at": now,
            "last_reconciled_balances": balances,
            "updated_at_iso": now,
        }

    importer.batch_write(
        [
            guarded_write(
                data,
                current_raw,
                project_id=args.project_id,
                database=args.database,
            )
        ],
        project_id=args.project_id,
        database=args.database,
        access_token=access_token,
    )
    updated, _ = current_control(
        project_id=args.project_id,
        database=args.database,
        access_token=access_token,
    )
    print(json.dumps(updated, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
