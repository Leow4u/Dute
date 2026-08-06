"""Backfill em lote de genero/grupo no catálogo Firestore (products + skus)."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from tools import import_btg_firestore as importer
    from tools.reconcile_btg_operational_data import decode_firestore_document
except ImportError:
    import import_btg_firestore as importer
    from reconcile_btg_operational_data import decode_firestore_document


GENERO_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("A.01", "Masculino"),
    ("A.02", "Feminino"),
    ("A.03", "Outros"),
    ("MAT-", "—"),
)

GRUPO_BY_PRODUTO: tuple[tuple[str, str], ...] = (
    ("POLO", "VESTUÁRIO"),
    ("JAQUETA", "VESTUÁRIO"),
    ("CAMISETA", "VESTUÁRIO"),
    ("TRICO", "VESTUÁRIO"),
    ("SUÉTER", "VESTUÁRIO"),
    ("SUETER", "VESTUÁRIO"),
    ("LEGGING", "VESTUÁRIO"),
    ("BLUSA", "VESTUÁRIO"),
    ("CAMISA", "VESTUÁRIO"),
    ("REGATA", "VESTUÁRIO"),
    ("MOLETOM", "VESTUÁRIO"),
    ("MOCHILA", "BOLSAS E MALAS"),
    ("SACOLA", "BOLSAS E MALAS"),
    ("MALA", "BOLSAS E MALAS"),
    ("CESTO", "ACESSÓRIOS"),
    ("BONÉ", "ACESSÓRIOS"),
    ("BONE", "ACESSÓRIOS"),
    ("TOALHA", "ACESSÓRIOS"),
    ("GUARDA CHUVA", "ACESSÓRIOS"),
    ("BANDANA", "ACESSÓRIOS"),
    ("ORGANIZADOR", "ACESSÓRIOS"),
    ("PORTA", "ACESSÓRIOS"),
    ("LANCHEIRA", "ACESSÓRIOS"),
    ("ANTIVIBRADOR", "ACESSÓRIOS"),
    ("MOLESKINE", "ESCRITÓRIOS E PAPELARIA"),
    ("COPO", "BEBIDAS E MESA"),
    ("GARRAFA", "BEBIDAS E MESA"),
    ("PORTA VINHO", "BEBIDAS E MESA"),
)


def is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def norm_code(value: Any) -> str:
    return importer.key_text(value).upper()


def load_excel_taxonomy(
    inventory_xlsx: Path,
) -> dict[str, dict[str, str]]:
    physical = importer.load_inventory_physical(inventory_xlsx)
    taxonomy: dict[str, dict[str, str]] = {}
    for row in physical["products"]:
        code = norm_code(row.get("cod_cliente"))
        if not code:
            continue
        genero = importer.clean(row.get("genero"))
        grupo = importer.clean(row.get("grupo"))
        if not genero and not grupo:
            continue
        taxonomy[code] = {
            "genero": genero or "",
            "grupo": grupo or "",
        }
    return taxonomy


def infer_genero(code: str) -> tuple[str | None, str | None]:
    normalized = norm_code(code)
    for prefix, genero in GENERO_BY_PREFIX:
        if normalized.startswith(prefix):
            return genero, f"prefix:{prefix}"
    return None, None


def infer_grupo(produto: str) -> tuple[str | None, str | None]:
    normalized = (produto or "").strip().upper()
    if not normalized:
        return None, None
    for needle, grupo in GRUPO_BY_PRODUTO:
        if needle in normalized:
            return grupo, f"produto:{needle}"
    return "OUTROS", "produto:default"


def resolve_taxonomy(
    product: dict[str, Any],
    excel: dict[str, dict[str, str]],
) -> dict[str, Any] | None:
    current_genero = importer.clean(product.get("genero"))
    current_grupo = importer.clean(product.get("grupo"))
    if current_genero and current_grupo:
        return None

    code = norm_code(product.get("cod_cliente"))
    produto = importer.clean(product.get("produto")) or ""
    genero = current_genero
    grupo = current_grupo
    genero_source = "existing" if genero else None
    grupo_source = "existing" if grupo else None

    excel_row = excel.get(code)
    if excel_row:
        if not genero and excel_row.get("genero"):
            genero = excel_row["genero"]
            genero_source = "excel"
        if not grupo and excel_row.get("grupo"):
            grupo = excel_row["grupo"]
            grupo_source = "excel"

    if not genero:
        inferred, source = infer_genero(code)
        if inferred:
            genero = inferred
            genero_source = source

    if not grupo:
        inferred, source = infer_grupo(produto)
        if inferred:
            grupo = inferred
            grupo_source = source

    if not genero or not grupo:
        return {
            "cod_cliente": code,
            "produto": produto,
            "document_id": product.get("_document_id"),
            "genero": genero or "",
            "grupo": grupo or "",
            "genero_source": genero_source,
            "grupo_source": grupo_source,
            "status": "needs_review",
        }

    if genero == current_genero and grupo == current_grupo:
        return None

    return {
        "cod_cliente": code,
        "produto": produto,
        "document_id": product.get("_document_id"),
        "genero": genero,
        "grupo": grupo,
        "genero_source": genero_source,
        "grupo_source": grupo_source,
        "status": "ready",
    }


def load_firestore_catalog(
    *,
    project_id: str,
    database: str,
    access_token: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    products = [
        decode_firestore_document(document)
        for document in importer.fetch_collection_raw(
            "products",
            project_id=project_id,
            database=database,
            access_token=access_token,
        )
    ]
    skus = [
        decode_firestore_document(document)
        for document in importer.fetch_collection_raw(
            "skus",
            project_id=project_id,
            database=database,
            access_token=access_token,
        )
    ]
    return products, skus


def build_plan(
    products: list[dict[str, Any]],
    skus: list[dict[str, Any]],
    excel: dict[str, dict[str, str]],
) -> dict[str, Any]:
    updates: list[dict[str, Any]] = []
    skipped = 0
    needs_review: list[dict[str, Any]] = []

    product_by_code = {norm_code(product.get("cod_cliente")): product for product in products}
    skus_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sku in skus:
        code = norm_code(sku.get("cod_cliente"))
        if code:
            skus_by_code[code].append(sku)

    for product in products:
        resolved = resolve_taxonomy(product, excel)
        if not resolved:
            skipped += 1
            continue
        if resolved["status"] == "needs_review":
            needs_review.append(resolved)
            continue

        code = resolved["cod_cliente"]
        payload = {
            "genero": resolved["genero"],
            "grupo": resolved["grupo"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updates.append(
            {
                **resolved,
                "collection": "products",
                "document_id": product.get("_document_id"),
                "payload": payload,
            }
        )
        for sku in skus_by_code.get(code, []):
            updates.append(
                {
                    **resolved,
                    "collection": "skus",
                    "document_id": sku.get("_document_id"),
                    "payload": payload,
                }
            )

    sources = Counter()
    for item in updates:
        if item.get("genero_source"):
            sources[f"genero:{item['genero_source']}"] += 1
        if item.get("grupo_source"):
            sources[f"grupo:{item['grupo_source']}"] += 1

    unique_products = {item["cod_cliente"] for item in updates if item["collection"] == "products"}

    return {
        "summary": {
            "products_total": len(products),
            "skus_total": len(skus),
            "products_to_update": len(unique_products),
            "documents_to_update": len(updates),
            "skipped_already_complete": skipped,
            "needs_review": len(needs_review),
            "sources": dict(sources),
        },
        "updates": updates,
        "needs_review": needs_review,
    }


def write_preview_csv(path: Path, plan: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        item
        for item in plan["updates"]
        if item["collection"] == "products"
    ]
    rows.extend(plan["needs_review"])
    fieldnames = [
        "status",
        "cod_cliente",
        "produto",
        "genero",
        "grupo",
        "genero_source",
        "grupo_source",
        "document_id",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def apply_plan(
    plan: dict[str, Any],
    *,
    project_id: str,
    database: str,
    access_token: str,
) -> int:
    writes: list[dict[str, Any]] = []
    for item in plan["updates"]:
        document_id = importer.key_text(item.get("document_id"))
        collection = importer.key_text(item.get("collection"))
        payload = item.get("payload") or {}
        if not document_id or not collection or not payload:
            continue
        writes.append(
            importer.upsert(
                collection,
                document_id,
                payload,
                project_id=project_id,
                database=database,
            )
        )
    importer.batch_write(
        writes,
        project_id=project_id,
        database=database,
        access_token=access_token,
    )
    return len(writes)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill genero/grupo no catálogo Firestore")
    parser.add_argument("--project-id", default=importer.PROJECT_ID)
    parser.add_argument("--database", default=importer.DATABASE)
    parser.add_argument(
        "--inventory-xlsx",
        type=Path,
        default=importer.INVENTORY_XLSX,
        help="Planilha BTG com colunas GÊNERO e GRUPO",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("deliverables/catalog-taxonomy-backfill-plan.json"),
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=Path("deliverables/catalog-taxonomy-backfill-preview.csv"),
    )
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm")
    args = parser.parse_args(argv)

    if args.apply:
        args.dry_run = False

    expected_confirmation = importer.confirmation_phrase(args.project_id, args.database)
    if args.apply and args.confirm != expected_confirmation:
        parser.error(f"--apply exige --confirm {expected_confirmation!r}")

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

    access_token = importer.token()
    excel = load_excel_taxonomy(args.inventory_xlsx)
    products, skus = load_firestore_catalog(
        project_id=args.project_id,
        database=args.database,
        access_token=access_token,
    )
    plan = build_plan(products, skus, excel)
    plan["generated_at"] = datetime.now(timezone.utc).isoformat()
    plan["project_id"] = args.project_id
    plan["database"] = args.database
    plan["inventory_xlsx"] = str(args.inventory_xlsx)
    plan["apply"] = {"requested": args.apply, "writes_applied": 0}

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    write_preview_csv(args.output_csv, plan)

    if args.apply:
        if plan["needs_review"]:
            print(
                json.dumps(
                    {
                        "error": "Backfill bloqueado: há produtos sem taxonomia resolvida.",
                        "needs_review": plan["needs_review"],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                file=sys.stderr,
            )
            return 2
        applied = apply_plan(
            plan,
            project_id=args.project_id,
            database=args.database,
            access_token=access_token,
        )
        plan["apply"]["writes_applied"] = applied
        args.output_json.write_text(
            json.dumps(plan, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(json.dumps(plan["summary"], ensure_ascii=False, indent=2))
    print(f"Plano salvo em {args.output_json}", file=sys.stderr)
    print(f"Preview salvo em {args.output_csv}", file=sys.stderr)
    if args.dry_run:
        print(
            f"Dry-run concluído. Para aplicar: --apply --confirm {expected_confirmation!r}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
