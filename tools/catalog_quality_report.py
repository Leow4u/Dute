"""Análise de qualidade do catálogo Firestore (products + skus)."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ID = "dute-btg"
DATABASE = "(default)"
HTTP_TIMEOUT_SECONDS = 60
GCLOUD = (
    shutil.which("gcloud")
    or r"C:\Users\leona\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
)


def token() -> str:
    return subprocess.check_output([GCLOUD, "auth", "print-access-token"], text=True).strip()


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
        return [decode_firestore_value(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {
            key: decode_firestore_value(item)
            for key, item in value["mapValue"].get("fields", {}).items()
        }
    raise ValueError(f"Tipo Firestore desconhecido: {sorted(value)}")


def decode_firestore_document(document: dict[str, Any]) -> dict[str, Any]:
    if "fields" not in document:
        normalized = dict(document)
        normalized.setdefault("_document_id", str(document.get("id") or document.get("_document_id") or ""))
        return normalized
    normalized = {key: decode_firestore_value(value) for key, value in document.get("fields", {}).items()}
    normalized["_document_id"] = str(document.get("name", "")).rsplit("/", 1)[-1]
    normalized["_document_name"] = document.get("name")
    return normalized


def fetch_collection_raw(
    collection_name: str,
    *,
    project_id: str = PROJECT_ID,
    database: str = DATABASE,
    access_token: str | None = None,
) -> list[dict[str, Any]]:
    access_token = access_token or token()
    base_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}/"
        f"databases/{database}/documents/{urllib.parse.quote(collection_name, safe='/')}"
    )
    documents: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        query: dict[str, str] = {"pageSize": "300"}
        if page_token:
            query["pageToken"] = page_token
        request = urllib.request.Request(
            f"{base_url}?{urllib.parse.urlencode(query)}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "x-goog-user-project": project_id,
            },
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
        documents.extend(payload.get("documents", []))
        page_token = payload.get("nextPageToken")
        if not page_token:
            return documents


def norm_code(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().upper()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text[:120]


def is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def num(value: Any, default: float = 0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def completeness(product: dict[str, Any]) -> int:
    key_fields = ["cod_cliente", "produto", "categoria", "genero", "grupo", "preco_unit"]
    filled = sum(1 for field in key_fields if not is_blank(product.get(field)))
    return round(filled / len(key_fields) * 100)


def analyze(
    *,
    project_id: str,
    database: str,
) -> dict[str, Any]:
    access_token = token()
    products_raw = fetch_collection_raw("products", project_id=project_id, database=database, access_token=access_token)
    skus_raw = fetch_collection_raw("skus", project_id=project_id, database=database, access_token=access_token)
    identities_raw = fetch_collection_raw(
        "catalog_identities", project_id=project_id, database=database, access_token=access_token
    )
    ops_raw = fetch_collection_raw("ops_aggregates", project_id=project_id, database=database, access_token=access_token)

    products = [decode_firestore_document(doc) for doc in products_raw]
    skus = [decode_firestore_document(doc) for doc in skus_raw]
    identities = [decode_firestore_document(doc) for doc in identities_raw]
    ops_docs = [decode_firestore_document(doc) for doc in ops_raw]

    sku_by_client: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sku in skus:
        code = norm_code(sku.get("cod_cliente"))
        if code:
            sku_by_client[code].append(sku)

    product_codes: dict[str, dict[str, Any]] = {}
    duplicate_product_codes: list[dict[str, Any]] = []
    for product in products:
        code = norm_code(product.get("cod_cliente"))
        if not code:
            continue
        if code in product_codes:
            duplicate_product_codes.append(
                {
                    "cod_cliente": code,
                    "ids": [product_codes[code]["_document_id"], product["_document_id"]],
                }
            )
        else:
            product_codes[code] = product

    sku_btg_codes: dict[str, dict[str, Any]] = {}
    duplicate_sku_btg: list[dict[str, Any]] = []
    for sku in skus:
        btg = norm_code(sku.get("cod_btg"))
        if not btg:
            continue
        if btg in sku_btg_codes:
            duplicate_sku_btg.append(
                {
                    "cod_btg": btg,
                    "ids": [sku_btg_codes[btg]["_document_id"], sku["_document_id"]],
                }
            )
        else:
            sku_btg_codes[btg] = sku

    missing_cod_cliente = [p["_document_id"] for p in products if is_blank(p.get("cod_cliente"))]
    missing_produto = [p["_document_id"] for p in products if is_blank(p.get("produto"))]
    missing_categoria = [p for p in products if is_blank(p.get("categoria"))]
    missing_genero = [p for p in products if is_blank(p.get("genero"))]
    missing_grupo = [p for p in products if is_blank(p.get("grupo"))]
    missing_preco = [p for p in products if p.get("preco_unit") is None or num(p.get("preco_unit")) == 0]
    zero_stock_products = [p for p in products if num(p.get("estoque_btg")) == 0]
    negative_stock = [p for p in products if num(p.get("estoque_btg")) < 0]

    products_no_skus: list[dict[str, Any]] = []
    for code, product in product_codes.items():
        if code not in sku_by_client:
            products_no_skus.append(
                {
                    "cod_cliente": code,
                    "produto": product.get("produto"),
                    "id": product["_document_id"],
                }
            )

    orphan_skus: list[dict[str, Any]] = []
    for sku in skus:
        code = norm_code(sku.get("cod_cliente"))
        if code and code not in product_codes:
            orphan_skus.append(
                {
                    "cod_btg": sku.get("cod_btg"),
                    "cod_cliente": code,
                    "id": sku["_document_id"],
                }
            )

    num_skus_mismatch: list[dict[str, Any]] = []
    for code, product in product_codes.items():
        declared = int(num(product.get("num_skus"), -1))
        actual = len(sku_by_client.get(code, []))
        if declared >= 0 and declared != actual:
            num_skus_mismatch.append(
                {
                    "cod_cliente": code,
                    "declared": declared,
                    "actual": actual,
                    "produto": product.get("produto"),
                }
            )

    balances_raw = fetch_collection_raw(
        "stock_balances", project_id=project_id, database=database, access_token=access_token
    )
    balances = [decode_firestore_document(doc) for doc in balances_raw]

    def sku_location_keys(sku: dict[str, Any]) -> set[str]:
        keys: set[str] = set()
        for field in ("cod_btg", "cod_cliente", "sku_code", "client_item_code"):
            value = str(sku.get(field) or "").strip()
            if value:
                keys.add(value)
        return keys

    def legacy_location(sku: dict[str, Any]) -> str:
        if not is_blank(sku.get("endereco")):
            return str(sku.get("endereco")).strip()
        parts = [
            f"R{sku['rua']}" if not is_blank(sku.get("rua")) else "",
            f"P{sku['prateleira']}" if not is_blank(sku.get("prateleira")) else "",
            f"C{sku['caixa']}" if not is_blank(sku.get("caixa")) else "",
        ]
        return " ".join(part for part in parts if part).strip()

    located_sku_keys: set[str] = set()
    for balance in balances:
        location = str(balance.get("location_id") or "").strip()
        if not location:
            continue
        for field in ("sku_code", "cod_btg", "client_item_code", "cod_cliente"):
            value = str(balance.get(field) or "").strip()
            if value:
                located_sku_keys.add(value)

    skus_no_location = [
        sku
        for sku in skus
        if not (
            sku_location_keys(sku) & located_sku_keys or legacy_location(sku)
        )
    ]
    skus_zero_stock = [s for s in skus if num(s.get("estoque_atual")) == 0]
    skus_missing_btg = [s["_document_id"] for s in skus if is_blank(s.get("cod_btg"))]

    cat_counts = Counter((p.get("categoria") or "").strip() or "Sem categoria" for p in products)
    gen_counts = Counter((p.get("genero") or "").strip() or "Sem gênero" for p in products)
    grp_counts = Counter((p.get("grupo") or "").strip() or "Sem grupo" for p in products)

    completeness_scores = [completeness(p) for p in products]
    low_completeness = sorted(
        [
            {
                "cod_cliente": p.get("cod_cliente"),
                "produto": p.get("produto"),
                "score": completeness(p),
                "missing": [
                    field
                    for field in ["categoria", "genero", "grupo", "preco_unit"]
                    if is_blank(p.get(field))
                ],
            }
            for p in products
            if completeness(p) < 60
        ],
        key=lambda item: item["score"],
    )

    code_normalization_issues: list[dict[str, Any]] = []
    for product in products:
        raw = str(product.get("cod_cliente") or "")
        if raw and raw != norm_code(raw):
            code_normalization_issues.append(
                {
                    "cod_cliente": raw,
                    "normalized": norm_code(raw),
                    "id": product["_document_id"],
                }
            )

    identity_kinds = Counter(item.get("kind") or "unknown" for item in identities)

    dashboard = next(
        (
            doc
            for doc in ops_docs
            if "dashboard" in str(doc.get("_document_id", "")) or doc.get("_document_id") == "dashboard"
        ),
        ops_docs[0] if ops_docs else None,
    )

    total_custo = sum(num(p.get("custo_total")) for p in products)
    total_estoque = sum(num(p.get("estoque_btg")) for p in products)
    priced = [p for p in products if num(p.get("preco_unit")) > 0]
    avg_preco = sum(num(p.get("preco_unit")) for p in priced) / max(1, len(priced))

    critical = (
        len(duplicate_product_codes)
        + len(duplicate_sku_btg)
        + len(missing_cod_cliente)
        + len(missing_produto)
    )
    warnings = len(products_no_skus) + len(orphan_skus) + len(num_skus_mismatch) + len(negative_stock)
    info = len(missing_categoria) + len(missing_preco) + len(skus_no_location)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_id": project_id,
        "summary": {
            "total_products": len(products),
            "total_skus": len(skus),
            "total_identities": len(identities),
            "products_with_skus": len(product_codes) - len(products_no_skus),
            "products_without_skus": len(products_no_skus),
            "orphan_skus": len(orphan_skus),
            "total_estoque_pecas": int(total_estoque),
            "total_custo": round(total_custo, 2),
            "avg_preco_unit": round(avg_preco, 2),
            "completeness_avg_pct": round(sum(completeness_scores) / max(1, len(completeness_scores)), 1),
            "quality_score": max(0, round(100 - (critical * 5 + warnings * 0.5 + info * 0.1), 1)),
        },
        "severity": {
            "critical_count": critical,
            "warning_count": warnings,
            "info_count": info,
        },
        "taxonomy": {
            "categories": dict(cat_counts.most_common(20)),
            "generos": dict(gen_counts.most_common(10)),
            "grupos": dict(grp_counts.most_common(15)),
            "unique_categories": len(cat_counts),
            "unique_generos": len(gen_counts),
            "unique_grupos": len(grp_counts),
        },
        "issues": {
            "duplicate_product_codes": duplicate_product_codes[:20],
            "duplicate_sku_btg": duplicate_sku_btg[:20],
            "missing_cod_cliente": missing_cod_cliente[:20],
            "missing_produto": missing_produto[:20],
            "products_without_skus": products_no_skus[:30],
            "orphan_skus": orphan_skus[:30],
            "num_skus_mismatch": num_skus_mismatch[:30],
            "negative_stock": [
                {"cod_cliente": p.get("cod_cliente"), "estoque": p.get("estoque_btg")}
                for p in negative_stock[:20]
            ],
            "missing_categoria_count": len(missing_categoria),
            "missing_genero_count": len(missing_genero),
            "missing_grupo_count": len(missing_grupo),
            "missing_preco_count": len(missing_preco),
            "zero_stock_products_count": len(zero_stock_products),
            "skus_no_location_count": len(skus_no_location),
            "skus_zero_stock_count": len(skus_zero_stock),
            "skus_missing_btg_count": len(skus_missing_btg),
            "code_normalization_issues_count": len(code_normalization_issues),
            "low_completeness": low_completeness[:25],
        },
        "ops_dashboard": (
            {key: value for key, value in dashboard.items() if not key.startswith("_")}
            if dashboard
            else None
        ),
        "identity_kinds": dict(identity_kinds),
    }


def render_markdown(report: dict[str, Any]) -> str:
    s = report["summary"]
    sev = report["severity"]
    tax = report["taxonomy"]
    issues = report["issues"]
    lines = [
        "# Relatório de Qualidade do Catálogo — Dutelog",
        "",
        f"**Gerado em:** {report['generated_at']}",
        f"**Projeto:** {report['project_id']}",
        "",
        "## Resumo executivo",
        "",
        f"| Indicador | Valor |",
        f"|-----------|-------|",
        f"| Produtos cadastrados | **{s['total_products']}** |",
        f"| SKUs cadastrados | **{s['total_skus']}** |",
        f"| Produtos com SKU vinculado | {s['products_with_skus']} |",
        f"| Produtos sem SKU | {s['products_without_skus']} |",
        f"| SKUs órfãos (sem produto) | {s['orphan_skus']} |",
        f"| Estoque total (peças) | {s['total_estoque_pecas']:,} |".replace(",", "."),
        f"| Custo total registrado | R$ {s['total_custo']:,.2f} |".replace(",", "X").replace(".", ",").replace("X", "."),
        f"| Preço unitário médio | R$ {s['avg_preco_unit']:,.2f} |".replace(",", "X").replace(".", ",").replace("X", "."),
        f"| Completude média dos cadastros | {s['completeness_avg_pct']}% |",
        f"| **Score de qualidade** | **{s['quality_score']}/100** |",
        "",
        "## Severidade dos achados",
        "",
        f"- **Críticos:** {sev['critical_count']} (duplicatas, campos obrigatórios ausentes)",
        f"- **Atenção:** {sev['warning_count']} (produtos sem SKU, inconsistências, estoque negativo)",
        f"- **Informativos:** {sev['info_count']} (campos opcionais, localização)",
        "",
        "## Taxonomia",
        "",
        f"- Categorias distintas: {tax['unique_categories']}",
        f"- Gêneros distintos: {tax['unique_generos']}",
        f"- Grupos distintos: {tax['unique_grupos']}",
        "",
        "### Top categorias",
        "",
    ]
    for cat, count in tax["categories"].items():
        lines.append(f"- {cat}: **{count}** produtos")
    lines.extend(["", "### Top gêneros", ""])
    for gen, count in tax["generos"].items():
        lines.append(f"- {gen}: **{count}** produtos")
    lines.extend(["", "## Lacunas de preenchimento", ""])
    lines.extend(
        [
            f"| Campo | Produtos afetados |",
            f"|-------|-------------------|",
            f"| Sem categoria | {issues['missing_categoria_count']} |",
            f"| Sem gênero | {issues['missing_genero_count']} |",
            f"| Sem grupo | {issues['missing_grupo_count']} |",
            f"| Sem preço unitário | {issues['missing_preco_count']} |",
            f"| Estoque zerado | {issues['zero_stock_products_count']} |",
            f"| SKUs sem localização | {issues['skus_no_location_count']} |",
            f"| SKUs com estoque zero | {issues['skus_zero_stock_count']} |",
            "",
        ]
    )
    if issues["duplicate_product_codes"]:
        lines.extend(["## Duplicatas de código de produto", ""])
        for item in issues["duplicate_product_codes"]:
            lines.append(f"- `{item['cod_cliente']}` → docs: {', '.join(item['ids'])}")
        lines.append("")
    if issues["duplicate_sku_btg"]:
        lines.extend(["## Duplicatas de código BTG (SKU)", ""])
        for item in issues["duplicate_sku_btg"]:
            lines.append(f"- `{item['cod_btg']}` → docs: {', '.join(item['ids'])}")
        lines.append("")
    if issues["products_without_skus"]:
        lines.extend(["## Produtos sem SKU vinculado (amostra)", ""])
        for item in issues["products_without_skus"][:15]:
            lines.append(f"- `{item['cod_cliente']}` — {item['produto']}")
        if len(issues["products_without_skus"]) > 15:
            lines.append(f"- … e mais {len(issues['products_without_skus']) - 15} produtos")
        lines.append("")
    if issues["low_completeness"]:
        lines.extend(["## Cadastros com baixa completude (<60%)", ""])
        for item in issues["low_completeness"][:15]:
            missing = ", ".join(item["missing"]) or "—"
            lines.append(f"- `{item['cod_cliente']}` ({item['score']}%) — faltam: {missing}")
        lines.append("")
    lines.extend(
        [
            "## Recomendações",
            "",
            "1. **Priorizar produtos sem SKU** — cada produto precisa de ao menos um SKU físico para operação de armazém.",
            "2. **Completar taxonomia** — categoria, gênero e grupo habilitam filtros, relatórios e faturamento.",
            "3. **Revisar preços unitários** — produtos sem preço impedem cálculos de custo e faturamento.",
            "4. **Endereçar SKUs no armazém** — SKUs sem rua/endereço não aparecem no mapa do armazém.",
            "",
            "---",
            "*Relatório gerado automaticamente por `tools/catalog_quality_report.py`*",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Análise de qualidade do catálogo Firestore")
    parser.add_argument("--project-id", default=PROJECT_ID)
    parser.add_argument("--database", default=DATABASE)
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-md", type=Path)
    args = parser.parse_args()

    report = analyze(project_id=args.project_id, database=args.database)
    payload = json.dumps(report, ensure_ascii=False, indent=2)

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(payload, encoding="utf-8")
        print(f"JSON salvo em {args.output_json}", file=sys.stderr)
    else:
        print(payload)

    if args.output_md:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(render_markdown(report), encoding="utf-8")
        print(f"Markdown salvo em {args.output_md}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
