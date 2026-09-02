from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from reset_btg_inventory import (
    BACKUP_DIR,
    access_token,
    batch_write,
    create_backup,
    decode_document,
    fetch_snapshot,
    firestore_value,
    guarded_upsert,
    inventory_control,
    request_json,
    snapshot_signature,
    utc_now,
)


PROJECT_ID = "dute-btg"
DATABASE = "(default)"
CUSTOMER_CODE = "BTG Pactual"
TIME_ZONE = ZoneInfo("America/Sao_Paulo")
SOURCE_COLLECTIONS = (
    "billing_periods",
    "billing_manual",
    "billing_price_list",
    "billing_config",
    "billing_operational_snapshots",
    "client_invoices",
    "products",
    "client_inventory",
    "movements",
    "system_controls",
)


def current_competencia() -> str:
    return datetime.now(TIME_ZONE).strftime("%Y-%m")


def document_id(document: dict[str, Any]) -> str:
    return str(document.get("name", "")).rsplit("/", 1)[-1]


def non_negative_number(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed >= 0 else 0.0


def absolute_number(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return abs(parsed)


def movement_date(movement: dict[str, Any]) -> str:
    return str(
        movement.get("occurred_at")
        or movement.get("data")
        or movement.get("created_at")
        or ""
    )


def usage_for_competencia(
    competencia: str,
    *,
    inventory_value: float,
    movements: list[dict[str, Any]],
) -> dict[str, float | int]:
    selected = [
        movement
        for movement in movements
        if movement_date(movement).startswith(competencia)
    ]
    incoming = sum(
        absolute_number(movement.get("qtde") or movement.get("quantity"))
        for movement in selected
        if non_negative_number(movement.get("sinal") or movement.get("sign")) > 0
        or str(movement.get("tipo_mov", "")).upper() == "ENTRADA"
    )
    outgoing = sum(
        absolute_number(movement.get("qtde") or movement.get("quantity"))
        for movement in selected
        if float(movement.get("sinal") or movement.get("sign") or 0) < 0
        or str(movement.get("tipo_mov", "")).upper() == "SAIDA"
    )
    return {
        "custo_estoque": inventory_value,
        "entradas_pecas": incoming,
        "saidas_pecas": outgoing,
        "movimentacoes": len(selected),
    }


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def delete_write(document: dict[str, Any]) -> dict[str, Any]:
    write: dict[str, Any] = {"delete": document["name"]}
    if document.get("updateTime"):
        write["currentDocument"] = {"updateTime": document["updateTime"]}
    else:
        write["currentDocument"] = {"exists": True}
    return write


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


def commit_writes(
    writes: list[dict[str, Any]],
    *,
    project_id: str,
    database: str,
    token: str,
) -> None:
    if not writes:
        return
    if len(writes) > 500:
        raise RuntimeError("O corte de faturamento excedeu o limite transacional.")
    request_json(
        (
            f"https://firestore.googleapis.com/v1/projects/{project_id}/"
            f"databases/{database}/documents:commit"
        ),
        token=token,
        project_id=project_id,
        method="POST",
        payload={"writes": writes},
    )


def confirmation_phrase(project_id: str, database: str) -> str:
    return f"SNAPSHOT FATURAMENTO {project_id}/{database}"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Preserva as fontes operacionais das competências válidas antes "
            "da zeragem e remove competências futuras. Sem --apply, audita."
        )
    )
    result.add_argument("--project-id", default=PROJECT_ID)
    result.add_argument("--database", default=DATABASE)
    result.add_argument("--customer-code", default=CUSTOMER_CODE)
    result.add_argument("--backup-path", type=Path)
    result.add_argument("--apply", action="store_true")
    result.add_argument("--confirm")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    token = access_token()
    snapshot = fetch_snapshot(
        SOURCE_COLLECTIONS,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    current = current_competencia()
    periods = [
        (document, decode_document(document))
        for document in snapshot["billing_periods"]
    ]
    valid_periods = [
        (document, data)
        for document, data in periods
        if str(data.get("competencia") or document_id(document)) <= current
    ]
    future_periods = [
        (document, data)
        for document, data in periods
        if str(data.get("competencia") or document_id(document)) > current
    ]
    existing_snapshots = snapshot["billing_operational_snapshots"]
    if existing_snapshots:
        raise SystemExit(
            "Já existem snapshots operacionais de faturamento. Revise-os "
            "antes de executar um novo corte."
        )

    inventory = [decode_document(item) for item in snapshot["client_inventory"]]
    products = [decode_document(item) for item in snapshot["products"]]
    customer_inventory = [
        item
        for item in inventory
        if str(item.get("customer_code", "")).strip() == args.customer_code
    ]
    inventory_value = (
        sum(
            non_negative_number(item.get("total_cost") or item.get("custo_total"))
            for item in customer_inventory
        )
        if customer_inventory
        else sum(
            non_negative_number(item.get("custo_total"))
            for item in products
        )
    )
    movements = [
        item
        for item in (decode_document(raw) for raw in snapshot["movements"])
        if str(item.get("customer_code", args.customer_code)).strip()
        == args.customer_code
    ]
    cutover_at = utc_now()
    snapshots_to_create: list[tuple[str, dict[str, Any]]] = []
    for document, data in sorted(
        valid_periods,
        key=lambda item: str(item[1].get("competencia") or document_id(item[0])),
    ):
        competencia = str(data.get("competencia") or document_id(document))
        usage = usage_for_competencia(
            competencia,
            inventory_value=inventory_value,
            movements=movements,
        )
        mode = "baseline" if competencia == current else "replace"
        snapshots_to_create.append(
            (
                competencia,
                {
                    "id": competencia,
                    "competencia": competencia,
                    "customer_code": args.customer_code,
                    "mode": mode,
                    "cutover_at": cutover_at,
                    "created_at_iso": cutover_at,
                    "usage": usage,
                    "source_counts": {
                        "client_inventory": len(customer_inventory),
                        "movements": int(usage["movimentacoes"]),
                    },
                    "source_hash": canonical_hash(
                        {
                            "competencia": competencia,
                            "mode": mode,
                            "usage": usage,
                        }
                    ),
                    "source": "tools/snapshot_btg_billing_before_reset.py",
                },
            )
        )

    future_ids = {
        str(data.get("competencia") or document_id(document))
        for document, data in future_periods
    }
    future_related = {
        collection: [
            document
            for document in snapshot[collection]
            if document_id(document) in future_ids
        ]
        for collection in ("billing_manual", "client_invoices")
    }
    plan = {
        "mode": "apply" if args.apply else "dry-run",
        "project_id": args.project_id,
        "database": args.database,
        "current_competencia": current,
        "inventory_value_preserved": inventory_value,
        "snapshots": [data for _, data in snapshots_to_create],
        "future_periods_to_delete": sorted(future_ids),
        "future_related_to_delete": {
            collection: len(documents)
            for collection, documents in future_related.items()
        },
    }
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.apply:
        print(
            "\nDry-run concluído. Nenhum dado foi alterado. Para aplicar, use "
            f"--apply --confirm {confirmation_phrase(args.project_id, args.database)!r}."
        )
        return 0

    expected = confirmation_phrase(args.project_id, args.database)
    if args.confirm != expected:
        raise SystemExit(f"Confirmação obrigatória: --confirm {expected!r}")
    control_raw = inventory_control(snapshot)
    control = decode_document(control_raw)
    if control.get("movements_frozen") is True:
        raise SystemExit("As movimentações já estão congeladas por outra operação.")

    cutover_id = "billing-cutover-" + datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    backup_path, backup_hash = create_backup(
        args.backup_path or BACKUP_DIR / f"{cutover_id}.json",
        snapshot,
        project_id=args.project_id,
        database=args.database,
    )
    print(f"Backup criado e relido: {backup_path}")
    print(f"SHA-256: {backup_hash}")

    frozen_at = utc_now()
    batch_write(
        [
            guarded_upsert(
                "system_controls",
                "inventory",
                {
                    "movements_frozen": True,
                    "billing_cutover_status": "running",
                    "billing_cutover_id": cutover_id,
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
    frozen_snapshot = fetch_snapshot(
        SOURCE_COLLECTIONS[:-1],
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    compared = tuple(collection for collection in SOURCE_COLLECTIONS if collection != "system_controls")
    if snapshot_signature(snapshot, compared) != snapshot_signature(
        frozen_snapshot, compared
    ):
        raise RuntimeError(
            "As fontes mudaram durante o corte. Nada do faturamento foi "
            "alterado; as movimentações permanecem congeladas para revisão."
        )

    writes: list[dict[str, Any]] = []
    period_by_id = {document_id(document): document for document, _ in valid_periods}
    for competencia, data in snapshots_to_create:
        writes.append(
            guarded_upsert(
                "billing_operational_snapshots",
                competencia,
                data,
                None,
                project_id=args.project_id,
                database=args.database,
            )
        )
        writes.append(
            guarded_upsert(
                "billing_periods",
                competencia,
                {
                    "operational_snapshot_id": competencia,
                    "operational_snapshot_mode": data["mode"],
                    "operational_snapshot_at": cutover_at,
                    "updated_at_iso": cutover_at,
                },
                period_by_id[competencia],
                project_id=args.project_id,
                database=args.database,
            )
        )
    for document, _ in future_periods:
        writes.append(delete_write(document))
    for documents in future_related.values():
        writes.extend(delete_write(document) for document in documents)
    event_id = "evt_" + cutover_id
    writes.append(
        guarded_upsert(
            "events",
            event_id,
            {
                "id": event_id,
                "type": "billing.operational_sources_snapshotted",
                "title": "Fontes do faturamento preservadas antes do inventário",
                "description": (
                    "Competências válidas receberam snapshot operacional e "
                    "competências futuras foram removidas."
                ),
                "severity": "attention",
                "entity_type": "billing_cutover",
                "entity_id": cutover_id,
                "customer_code": args.customer_code,
                "payload": {
                    "competencias": [key for key, _ in snapshots_to_create],
                    "future_removed": sorted(future_ids),
                    "backup_sha256": backup_hash,
                },
                "occurred_at": cutover_at,
                "source": "tools/snapshot_btg_billing_before_reset.py",
            },
            None,
            project_id=args.project_id,
            database=args.database,
        )
    )
    commit_writes(
        writes,
        project_id=args.project_id,
        database=args.database,
        token=token,
    )

    controls_now = fetch_snapshot(
        ("system_controls",),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    current_control = inventory_control(controls_now)
    if control_raw:
        commit_writes(
            [raw_replace_write(control_raw, current_control)],
            project_id=args.project_id,
            database=args.database,
            token=token,
        )
    else:
        batch_write(
            [
                guarded_upsert(
                    "system_controls",
                    "inventory",
                    {
                        "movements_frozen": False,
                        "billing_cutover_status": "completed",
                        "billing_cutover_id": cutover_id,
                        "updated_at_iso": utc_now(),
                    },
                    current_control,
                    project_id=args.project_id,
                    database=args.database,
                )
            ],
            project_id=args.project_id,
            database=args.database,
            token=token,
        )

    verification = fetch_snapshot(
        ("billing_operational_snapshots", "billing_periods"),
        project_id=args.project_id,
        database=args.database,
        token=token,
    )
    restored_snapshot_ids = {
        document_id(document)
        for document in verification["billing_operational_snapshots"]
    }
    remaining_future = [
        document_id(document)
        for document in verification["billing_periods"]
        if document_id(document) > current
    ]
    expected_snapshot_ids = {key for key, _ in snapshots_to_create}
    if restored_snapshot_ids != expected_snapshot_ids or remaining_future:
        raise RuntimeError(
            "A verificação do corte de faturamento falhou. Revise os snapshots "
            "antes da zeragem."
        )
    print(
        json.dumps(
            {
                "ok": True,
                "cutover_id": cutover_id,
                "snapshots_created": sorted(restored_snapshot_ids),
                "future_periods_removed": sorted(future_ids),
                "backup": str(backup_path),
                "backup_sha256": backup_hash,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
