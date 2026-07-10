from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

try:
    from tools import import_btg_firestore as importer
except ImportError:  # Direct execution from tools/.
    import import_btg_firestore as importer


FIRESTORE_COLLECTIONS = (
    "products",
    "skus",
    "movements",
    "stock_balances",
)


def decode_firestore_value(value: dict[str, Any]) -> Any:
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
    if "referenceValue" in value:
        return value["referenceValue"]
    if "bytesValue" in value:
        return value["bytesValue"]
    if "geoPointValue" in value:
        return dict(value["geoPointValue"])
    if "arrayValue" in value:
        return [
            decode_firestore_value(item)
            for item in value["arrayValue"].get("values", [])
        ]
    if "mapValue" in value:
        return {
            key: decode_firestore_value(item)
            for key, item in value["mapValue"].get("fields", {}).items()
        }
    raise ValueError(f"Tipo Firestore desconhecido: {sorted(value)}")


def decode_firestore_document(document: dict[str, Any]) -> dict[str, Any]:
    if "fields" not in document:
        normalized = dict(document)
        normalized.setdefault(
            "_document_id",
            importer.key_text(document.get("id") or document.get("_document_id")),
        )
        return normalized
    normalized = {
        key: decode_firestore_value(value)
        for key, value in document.get("fields", {}).items()
    }
    normalized["_document_id"] = str(document.get("name", "")).rsplit("/", 1)[-1]
    normalized["_document_name"] = document.get("name")
    return normalized


def normalize_firestore_payload(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    source = payload.get("collections", payload)
    normalized: dict[str, list[dict[str, Any]]] = {}
    for collection in FIRESTORE_COLLECTIONS:
        items = source.get(collection, [])
        if isinstance(items, dict):
            items = items.get("documents", [])
        if not isinstance(items, list):
            raise ValueError(f"Coleção {collection!r} não é uma lista no snapshot")
        normalized[collection] = [decode_firestore_document(item) for item in items]
    return normalized


def load_firestore_snapshot(path: Path | str) -> dict[str, list[dict[str, Any]]]:
    with Path(path).open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Snapshot Firestore deve ser um objeto JSON")
    return normalize_firestore_payload(payload)


def load_live_firestore(
    *,
    project_id: str,
    database: str,
) -> dict[str, list[dict[str, Any]]]:
    access_token = importer.token()
    return {
        collection: [
            decode_firestore_document(document)
            for document in importer.fetch_collection_raw(
                collection,
                project_id=project_id,
                database=database,
                access_token=access_token,
            )
        ]
        for collection in FIRESTORE_COLLECTIONS
    }


def _distinct(rows: Iterable[dict[str, Any]], field: str) -> list[str]:
    return sorted(
        {
            importer.key_text(row.get(field))
            for row in rows
            if importer.clean(row.get(field)) is not None
        }
    )


def _anomaly(
    severity: str,
    kind: str,
    message: str,
    **context: Any,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "type": kind,
        "message": message,
        **context,
    }


def _target_firestore_rows(
    firestore: dict[str, list[dict[str, Any]]],
    customer_code: str,
    anomalies: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    target: dict[str, list[dict[str, Any]]] = {}
    for collection, rows in firestore.items():
        missing_customer = [
            importer.key_text(row.get("_document_id"))
            for row in rows
            if not importer.clean(row.get("customer_code"))
        ]
        if missing_customer:
            anomalies.append(
                _anomaly(
                    "warning",
                    "firestore_missing_customer_code",
                    f"{len(missing_customer)} documento(s) de {collection} sem customer_code.",
                    collection=collection,
                    count=len(missing_customer),
                    sample_document_ids=missing_customer[:10],
                )
            )
        target[collection] = [
            row
            for row in rows
            if importer.key_text(row.get("customer_code")) == customer_code
        ]
    return target


def reconcile(
    physical: dict[str, list[dict[str, Any]]],
    firestore: dict[str, list[dict[str, Any]]] | None,
    *,
    customer_code: str = importer.DEFAULT_CUSTOMER,
    include_details: bool = True,
) -> dict[str, Any]:
    logical = importer.build_inventory_documents(physical)
    anomalies: list[dict[str, Any]] = []

    catalog_rows_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in physical["products"]:
        catalog_rows_by_code[importer.key_text(row.get("cod_cliente"))].append(row)

    for client_code, rows in catalog_rows_by_code.items():
        if len(rows) <= 1:
            continue
        balances = sorted({importer.integer(row.get("estoque_btg")) for row in rows})
        names = _distinct(rows, "produto")
        anomalies.append(
            _anomaly(
                "warning" if len(balances) == 1 and len(names) == 1 else "critical",
                "duplicate_catalog_logical_product",
                "Linhas físicas repetem o mesmo produto lógico no Catálogo.",
                client_item_code=client_code,
                source_rows=sorted(importer.integer(row["source_row"]) for row in rows),
                balances=balances,
                product_names=names,
            )
        )

    sku_rows_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sku_codes_by_client: dict[str, set[str]] = defaultdict(set)
    for row in physical["skus"]:
        sku_code = importer.key_text(row.get("cod_btg"))
        client_code = importer.key_text(row.get("cod_cliente"))
        sku_rows_by_code[sku_code].append(row)
        if client_code:
            sku_codes_by_client[client_code].add(sku_code)

    sku_to_clients: dict[str, set[str]] = {}
    for sku_code, rows in sku_rows_by_code.items():
        client_codes = {
            importer.key_text(row.get("cod_cliente"))
            for row in rows
            if row.get("cod_cliente")
        }
        sku_to_clients[sku_code] = client_codes
        if len(client_codes) > 1:
            anomalies.append(
                _anomaly(
                    "critical",
                    "sku_maps_to_multiple_products",
                    "O mesmo código BTG aponta para mais de um código de produto.",
                    sku_code=sku_code,
                    client_item_codes=sorted(client_codes),
                    source_rows=sorted(
                        importer.integer(row["source_row"]) for row in rows
                    ),
                )
            )
        names = _distinct(rows, "produto")
        if len(names) > 1:
            anomalies.append(
                _anomaly(
                    "warning",
                    "sku_has_conflicting_names",
                    "Linhas do mesmo SKU possuem nomes de produto diferentes.",
                    sku_code=sku_code,
                    product_names=names,
                )
            )

    catalog_codes = set(catalog_rows_by_code)
    sku_client_codes = set(sku_codes_by_client)
    for client_code in sorted(catalog_codes - sku_client_codes):
        anomalies.append(
            _anomaly(
                "warning",
                "catalog_product_without_sku",
                "Produto do Catálogo não possui SKU físico associado.",
                client_item_code=client_code,
            )
        )
    for client_code in sorted(sku_client_codes - catalog_codes):
        anomalies.append(
            _anomaly(
                "warning",
                "sku_product_synthesized_from_real_skus",
                "Código ausente do Catálogo será sintetizado somente a partir das linhas reais da aba SKUs.",
                client_item_code=client_code,
                sku_codes=sorted(sku_codes_by_client[client_code]),
            )
        )

    movements_by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in physical["movements"]:
        movements_by_sku[importer.key_text(row.get("cod_sku"))].append(row)
    for sku_code, rows in movements_by_sku.items():
        if sku_code not in sku_rows_by_code:
            anomalies.append(
                _anomaly(
                    "warning",
                    "historical_movement_sku_missing_from_current_stock",
                    "Movimentação histórica aponta para SKU que não existe mais no saldo atual; será preservada no ledger sem compor o saldo.",
                    sku_code=sku_code,
                    movement_count=len(rows),
                    signed_balance=sum(importer.integer(row.get("sinal")) for row in rows),
                )
            )
        elif len(sku_to_clients[sku_code]) > 1:
            anomalies.append(
                _anomaly(
                    "critical",
                    "movement_has_ambiguous_product_mapping",
                    "Movimentações não podem ser alocadas porque o SKU é ambíguo.",
                    sku_code=sku_code,
                    client_item_codes=sorted(sku_to_clients[sku_code]),
                    movement_count=len(rows),
                    signed_balance=sum(importer.integer(row.get("sinal")) for row in rows),
                )
            )

    catalog_balance_by_client = {
        importer.key_text(row["client_item_code"]): importer.integer(
            row.get("estoque_btg")
        )
        for row in logical["products"]
    }
    sku_balance_by_client: dict[str, int] = defaultdict(int)
    for row in physical["skus"]:
        client_code = importer.key_text(row.get("cod_cliente"))
        if client_code:
            sku_balance_by_client[client_code] += importer.integer(
                row.get("estoque_atual")
            )

    movement_balance_by_client: dict[str, int] = defaultdict(int)
    unallocated_movement_balance = 0
    for row in physical["movements"]:
        sku_code = importer.key_text(row.get("cod_sku"))
        client_codes = sku_to_clients.get(sku_code, set())
        signed = importer.integer(row.get("sinal"))
        if len(client_codes) == 1:
            movement_balance_by_client[next(iter(client_codes))] += signed
        else:
            unallocated_movement_balance += signed

    firestore_available = firestore is not None
    firestore_balance_by_client: dict[str, int] = defaultdict(int)
    unallocated_firestore_balance = 0
    target_firestore: dict[str, list[dict[str, Any]]] = {
        collection: [] for collection in FIRESTORE_COLLECTIONS
    }
    if firestore_available:
        target_firestore = _target_firestore_rows(
            firestore or {},
            customer_code,
            anomalies,
        )

        firestore_products_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in target_firestore["products"]:
            client_code = importer.key_text(
                row.get("client_item_code") or row.get("cod_cliente")
            )
            if client_code:
                firestore_products_by_code[client_code].append(row)
        duplicate_products = {
            code: rows
            for code, rows in firestore_products_by_code.items()
            if len(rows) > 1
        }
        if duplicate_products:
            anomalies.append(
                _anomaly(
                    "warning",
                    "firestore_duplicate_logical_products",
                    "Firestore contém vários documentos para o mesmo produto lógico.",
                    count=len(duplicate_products),
                    sample_client_item_codes=sorted(duplicate_products)[:20],
                )
            )

        firestore_skus_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in target_firestore["skus"]:
            sku_code = importer.key_text(row.get("sku_code") or row.get("cod_btg"))
            if sku_code:
                firestore_skus_by_code[sku_code].append(row)
        duplicate_skus = {
            code: rows
            for code, rows in firestore_skus_by_code.items()
            if len(rows) > 1
        }
        if duplicate_skus:
            anomalies.append(
                _anomaly(
                    "warning",
                    "firestore_duplicate_logical_skus",
                    "Firestore contém vários documentos para o mesmo SKU lógico.",
                    count=len(duplicate_skus),
                    sample_sku_codes=sorted(duplicate_skus)[:20],
                )
            )

        for sku_code, rows in firestore_skus_by_code.items():
            firestore_clients = {
                importer.key_text(
                    row.get("client_item_code") or row.get("cod_cliente")
                )
                for row in rows
                if row.get("client_item_code") or row.get("cod_cliente")
            }
            if len(firestore_clients) > 1:
                anomalies.append(
                    _anomaly(
                        "warning",
                        "firestore_sku_maps_to_multiple_products",
                        "O snapshot anterior do Firestore diverge no produto lógico e será substituído pela projeção reconciliada.",
                        sku_code=sku_code,
                        client_item_codes=sorted(firestore_clients),
                    )
                )
            source_clients = sku_to_clients.get(sku_code, set())
            if source_clients and firestore_clients and source_clients != firestore_clients:
                anomalies.append(
                    _anomaly(
                        "warning",
                        "firestore_sku_mapping_differs_from_source",
                        "Mapeamento do snapshot Firestore diverge da planilha atual e será reconciliado.",
                        sku_code=sku_code,
                        source_client_item_codes=sorted(source_clients),
                        firestore_client_item_codes=sorted(firestore_clients),
                    )
                )

        for row in target_firestore["stock_balances"]:
            quantity = importer.integer(
                row.get("qty_on_hand"),
                importer.integer(row.get("estoque_atual")),
            )
            client_code = importer.key_text(
                row.get("client_item_code") or row.get("cod_cliente")
            )
            if not client_code:
                sku_code = importer.key_text(row.get("sku_code") or row.get("cod_btg"))
                source_clients = sku_to_clients.get(sku_code, set())
                if len(source_clients) == 1:
                    client_code = next(iter(source_clients))
                else:
                    unallocated_firestore_balance += quantity
                    continue
            firestore_balance_by_client[client_code] += quantity

        if unallocated_firestore_balance:
            anomalies.append(
                _anomaly(
                    "warning",
                    "firestore_balance_without_product_mapping",
                    "Parte do saldo Firestore não possui mapeamento inequívoco de produto.",
                    balance=unallocated_firestore_balance,
                )
            )

    all_client_codes = (
        set(catalog_balance_by_client)
        | set(sku_balance_by_client)
        | set(movement_balance_by_client)
        | set(firestore_balance_by_client)
    )
    product_name_by_client = {
        code: rows[0].get("produto") for code, rows in catalog_rows_by_code.items()
    }
    details: list[dict[str, Any]] = []
    for client_code in sorted(all_client_codes):
        catalog_balance = catalog_balance_by_client.get(client_code, 0)
        sku_balance = sku_balance_by_client.get(client_code, 0)
        movement_balance = movement_balance_by_client.get(client_code, 0)
        firestore_balance = (
            firestore_balance_by_client.get(client_code, 0)
            if firestore_available
            else None
        )
        detail = {
            "client_item_code": client_code,
            "product_name": product_name_by_client.get(client_code),
            "sku_codes": sorted(sku_codes_by_client.get(client_code, set())),
            "catalog_balance": catalog_balance,
            "sku_balance": sku_balance,
            "movement_balance": movement_balance,
            "firestore_balance": firestore_balance,
            "sku_minus_catalog": sku_balance - catalog_balance,
            "movements_minus_sku": movement_balance - sku_balance,
            "firestore_minus_sku": (
                firestore_balance - sku_balance
                if firestore_balance is not None
                else None
            ),
        }
        details.append(detail)
        if catalog_balance != sku_balance or movement_balance != sku_balance:
            anomalies.append(
                _anomaly(
                    "warning",
                    "source_balance_mismatch",
                    "Os três saldos de origem não coincidem para o produto.",
                    client_item_code=client_code,
                    catalog_balance=catalog_balance,
                    sku_balance=sku_balance,
                    movement_balance=movement_balance,
                )
            )
        if firestore_balance is not None and firestore_balance != sku_balance:
            anomalies.append(
                _anomaly(
                    "warning",
                    "firestore_balance_mismatch",
                    "Saldo Firestore diverge do saldo físico da aba SKUs.",
                    client_item_code=client_code,
                    sku_balance=sku_balance,
                    firestore_balance=firestore_balance,
                )
            )

    severity_counts = Counter(anomaly["severity"] for anomaly in anomalies)
    duplicate_physical_sku_rows = sum(
        max(0, len(rows) - 1) for rows in sku_rows_by_code.values()
    )
    report: dict[str, Any] = {
        "mode": "dry-run",
        "customer_code": customer_code,
        "firestore_compared": firestore_available,
        "sources": {
            "catalog_physical_rows": len(physical["products"]),
            "catalog_logical_products": len(logical["products"]),
            "sku_physical_rows": len(physical["skus"]),
            "sku_logical_codes": len(logical["skus"]),
            "sku_extra_physical_rows": duplicate_physical_sku_rows,
            "movement_rows": len(physical["movements"]),
            "firestore_documents": {
                collection: len(rows)
                for collection, rows in (firestore or {}).items()
            },
            "firestore_customer_documents": {
                collection: len(rows)
                for collection, rows in target_firestore.items()
            },
        },
        "balances": {
            "three_source_balances": {
                "catalog": sum(catalog_balance_by_client.values()),
                "skus": sum(sku_balance_by_client.values()),
                "movements": sum(
                    importer.integer(row.get("sinal"))
                    for row in physical["movements"]
                ),
            },
            "allocated_movements": sum(movement_balance_by_client.values()),
            "unallocated_movements": unallocated_movement_balance,
            "firestore_snapshot": (
                sum(firestore_balance_by_client.values())
                + unallocated_firestore_balance
                if firestore_available
                else None
            ),
            "firestore_allocated": (
                sum(firestore_balance_by_client.values())
                if firestore_available
                else None
            ),
            "firestore_unallocated": (
                unallocated_firestore_balance if firestore_available else None
            ),
        },
        "anomaly_summary": {
            "total": len(anomalies),
            "critical": severity_counts["critical"],
            "warning": severity_counts["warning"],
        },
        "anomalies": anomalies,
        "planned_inventory_writes": len(importer.build_inventory_writes(logical)),
    }
    if include_details:
        report["products"] = details
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Reconcilia Catálogo, SKUs, Movimentações e Firestore; "
            "dry-run é o padrão."
        )
    )
    parser.add_argument("--inventory-xlsx", type=Path, default=importer.INVENTORY_XLSX)
    parser.add_argument("--project-id", default=importer.PROJECT_ID)
    parser.add_argument("--database", default=importer.DATABASE)
    parser.add_argument("--customer-code", default=importer.DEFAULT_CUSTOMER)
    firestore_source = parser.add_mutually_exclusive_group()
    firestore_source.add_argument(
        "--firestore-json",
        type=Path,
        help="snapshot JSON local em vez de leitura da produção",
    )
    firestore_source.add_argument(
        "--skip-firestore",
        action="store_true",
        help="valida somente as três fontes da planilha",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="omite a matriz detalhada por produto",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument(
        "--apply",
        action="store_true",
        help="aplica apenas o plano operacional, após backup e confirmação",
    )
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--confirm")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    expected_confirmation = importer.confirmation_phrase(args.project_id, args.database)
    if args.apply:
        if args.backup is None:
            parser.error("--apply exige --backup apontando para um arquivo novo")
        if args.confirm != expected_confirmation:
            parser.error(f"--apply exige --confirm {expected_confirmation!r}")
        if args.backup.expanduser().exists():
            parser.error("--backup deve apontar para um arquivo que ainda não existe")
        if args.skip_firestore or args.firestore_json:
            parser.error("--apply exige reconciliação ao vivo com o Firestore")

    if not args.inventory_xlsx.exists():
        print(
            json.dumps(
                {
                    "error": "Planilha de inventário não encontrada.",
                    "path": str(args.inventory_xlsx),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1

    physical = importer.load_inventory_physical(args.inventory_xlsx)
    if args.skip_firestore:
        firestore = None
    elif args.firestore_json:
        firestore = load_firestore_snapshot(args.firestore_json)
    else:
        firestore = load_live_firestore(
            project_id=args.project_id,
            database=args.database,
        )

    report = reconcile(
        physical,
        firestore,
        customer_code=args.customer_code,
        include_details=not args.summary_only,
    )
    report["project_id"] = args.project_id
    report["database"] = args.database
    report["confirmation_required"] = expected_confirmation
    report["apply"] = {
        "requested": args.apply,
        "status": "not-requested",
        "backup": None,
        "writes_applied": 0,
    }

    if args.apply:
        if report["anomaly_summary"]["critical"]:
            report["apply"]["status"] = "blocked-critical-anomalies"
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 2
        inventory = importer.build_inventory_documents(physical)
        writes = importer.build_inventory_writes(
            inventory,
            project_id=args.project_id,
            database=args.database,
        )
        access_token = importer.token()
        backup = importer.create_backup(
            args.backup,
            importer.INVENTORY_COLLECTIONS,
            project_id=args.project_id,
            database=args.database,
            access_token=access_token,
        )
        stale_deletes = importer.build_stale_inventory_deletes(inventory, backup)
        guarded_writes = [
            *stale_deletes,
            *importer.writes_with_backup_preconditions(writes, backup),
        ]
        importer.batch_write(
            guarded_writes,
            project_id=args.project_id,
            database=args.database,
            access_token=access_token,
        )
        report["mode"] = "apply"
        report["apply"] = {
            "requested": True,
            "status": "applied",
            "backup": str(backup),
            "writes_applied": len(guarded_writes),
            "stale_documents_deleted": len(stale_deletes),
        }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
