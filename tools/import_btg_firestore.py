from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

PROJECT_ID = "dute-f7480"
DATABASE = "(default)"
ROOT = Path(__file__).resolve().parents[1]
INVENTORY_XLSX = ROOT / "attached_assets" / "Inventário_BTG_Consolidado_1783512047835.xlsx"
BILLING_XLSX = ROOT / "attached_assets" / "Armazenamento_BTG_Fechamento_mensal_1783520952576.xlsx"
GCLOUD = (
    os.environ.get("GCLOUD")
    or shutil.which("gcloud")
    or r"C:\Users\leona\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
)


def token() -> str:
    return subprocess.check_output(
        [GCLOUD, "auth", "print-access-token"],
        text=True,
    ).strip()


def clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def number(value: Any, default: float = 0) -> float:
    value = clean(value)
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def integer(value: Any, default: int = 0) -> int:
    return int(number(value, default))


def row_dict(headers: list[str], row: tuple[Any, ...]) -> dict[str, Any]:
    return {headers[i]: clean(row[i]) for i in range(min(len(headers), len(row)))}


def sheet_rows(ws, header_row: int) -> list[dict[str, Any]]:
    headers = [clean(cell.value) for cell in ws[header_row]]
    headers = [str(header) if header else f"col_{index}" for index, header in enumerate(headers)]
    rows = []
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        item = row_dict(headers, row)
        if any(value is not None for value in item.values()):
            rows.append(item)
    return rows


def load_inventory() -> dict[str, list[dict[str, Any]]]:
    wb = load_workbook(INVENTORY_XLSX, data_only=True, read_only=True)

    products = []
    for index, row in enumerate(sheet_rows(wb["Catálogo"], 7), start=1):
        cod_cliente = row.get("CÓD. CLIENTE")
        produto = row.get("PRODUTO")
        if not cod_cliente or not produto:
            continue
        estoque = integer(row.get("ESTOQUE BTG"))
        preco = number(row.get("PREÇO UNIT."))
        products.append(
            {
                "id": index,
                "cod_cliente": cod_cliente,
                "genero": row.get("GÊNERO"),
                "categoria": row.get("CATEGORIA"),
                "grupo": row.get("GRUPO"),
                "produto": produto,
                "cor": row.get("COR"),
                "tamanho": row.get("TAM"),
                "preco_unit": preco,
                "estoque_btg": estoque,
                "custo_total": number(row.get("CUSTO TOTAL"), estoque * preco),
                "num_skus": integer(row.get("# SKUs")),
            }
        )

    skus = []
    for index, row in enumerate(sheet_rows(wb["SKUs"], 5), start=1):
        cod_btg = row.get("CÓD. BTG")
        if not cod_btg:
            continue
        skus.append(
            {
                "id": index,
                "cod_btg": cod_btg,
                "estoque_tipo": row.get("ESTOQUE"),
                "cod_cliente": row.get("CÓD. CLIENTE"),
                "genero": row.get("GÊNERO"),
                "categoria": row.get("CATEGORIA"),
                "produto": row.get("PRODUTO"),
                "cor": row.get("COR"),
                "tamanho": row.get("TAM"),
                "estoque_atual": integer(row.get("ESTOQUE ATUAL")),
                "estado": row.get("ESTADO"),
                "rua": row.get("RUA"),
                "prateleira": row.get("PRATELEIRA"),
                "caixa": row.get("CAIXA"),
                "endereco": row.get("ENDEREÇO"),
            }
        )

    movements = []
    for index, row in enumerate(sheet_rows(wb["Movimentações"], 5), start=1):
        cod_sku = row.get("CÓD. SKU")
        if not cod_sku:
            continue
        movements.append(
            {
                "id": index,
                "data": clean(row.get("DATA")),
                "tipo_mov": row.get("TIPO MOV."),
                "cod_sku": cod_sku,
                "produto": row.get("PRODUTO"),
                "qtde": integer(row.get("QTDE")),
                "sinal": integer(row.get("SINAL (±)")),
                "estoque_tipo": row.get("ESTOQUE"),
                "origem": row.get("ORIGEM"),
                "destino": row.get("DESTINO"),
                "evento_ref": row.get("EVENTO/REF"),
                "doc_nf": row.get("DOC/NF"),
                "responsavel": row.get("RESPONSÁVEL"),
                "caixa_origem": row.get("CAIXA ORIGEM"),
            }
        )

    orders = []
    for index, row in enumerate(sheet_rows(wb["Pedidos"], 5), start=1):
        num_pedido = row.get("Nº PEDIDO")
        if not num_pedido:
            continue
        orders.append(
            {
                "id": index,
                "num_pedido": num_pedido,
                "data_solic": clean(row.get("DATA SOLIC.")),
                "canal": row.get("CANAL"),
                "solicitante": row.get("SOLICITANTE"),
                "cod_cliente": row.get("CÓD. CLIENTE"),
                "produto": row.get("PRODUTO"),
                "qtd_solic": integer(row.get("QTD SOLIC.")),
                "qtd_sep": integer(row.get("QTD SEP.")),
                "estoque": row.get("ESTOQUE"),
                "status": row.get("STATUS"),
                "data_exped": clean(row.get("DATA EXPED.")),
                "nf": row.get("NF"),
                "po_btg": row.get("PO BTG"),
                "obs": row.get("OBS"),
            }
        )

    return {
        "products": products,
        "skus": skus,
        "movements": movements,
        "orders": orders,
    }


def month_to_competencia(sheet_name: str) -> str | None:
    months = {
        "JANEIRO": "01",
        "FEVEREIRO": "02",
        "MARÇO": "03",
        "MARCO": "03",
        "ABRIL": "04",
        "MAIO": "05",
        "JUNHO": "06",
        "JULHO": "07",
        "AGOSTO": "08",
        "SETEMBRO": "09",
        "OUTUBRO": "10",
        "NOVEMBRO": "11",
        "DEZEMBRO": "12",
    }
    parts = sheet_name.split()
    if len(parts) != 2:
        return None
    month = months.get(parts[0].upper())
    if not month:
        return None
    return f"20{parts[1]}-{month}"


def load_billing() -> dict[str, list[dict[str, Any]]]:
    wb = load_workbook(BILLING_XLSX, data_only=True, read_only=True)
    price_list_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    manual = []
    periods = []

    for ws in wb.worksheets:
        competencia = month_to_competencia(ws.title)
        if not competencia:
            continue
        rows = sheet_rows(ws, 5)
        total = 0.0
        for row in rows:
            item = row.get("SERVIÇO / ITEM")
            unidade = row.get("UNIDADE")
            if not item or not unidade:
                continue
            qtde = number(row.get("QTDE"))
            valor = number(row.get("VALOR UNIT. LPU (R$)"))
            linha_total = number(row.get("TOTAL (R$)"), qtde * valor)
            total += linha_total
            key = (str(item), str(unidade))
            if key not in price_list_by_key:
                price_list_by_key[key] = {
                    "id": len(price_list_by_key) + 1,
                    "grupo": "armazenamento",
                    "item": item,
                    "unidade": unidade,
                    "valor_unit": valor,
                    "auto_source": None,
                    "ordem": len(price_list_by_key) + 1,
                    "ativo": True,
                }
            manual.append(
                {
                    "competencia": competencia,
                    "price_list_id": price_list_by_key[key]["id"],
                    "qtde": qtde,
                    "observacao": row.get("OBSERVAÇÃO"),
                }
            )
        periods.append({"competencia": competencia, "status": "aberto", "total_planilha": total})

    price_list = list(price_list_by_key.values())
    price_list.append(
        {
            "id": len(price_list) + 1,
            "grupo": "ad_valorem",
            "item": "Ad Valorem sobre estoque",
            "unidade": "% estoque",
            "valor_unit": 0,
            "auto_source": "ad_valorem",
            "ordem": len(price_list) + 1,
            "ativo": True,
        }
    )

    return {
        "price_list": price_list,
        "manual": manual,
        "periods": periods,
    }


def firestore_value(value: Any) -> dict[str, Any]:
    value = clean(value)
    if value is None:
        return {"nullValue": None}
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
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    return {"stringValue": str(value)}


def firestore_doc(data: dict[str, Any]) -> dict[str, Any]:
    return {"fields": {key: firestore_value(value) for key, value in data.items()}}


def batch_write(writes: list[dict[str, Any]]) -> None:
    if not writes:
        return
    access_token = token()
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{DATABASE}/documents:batchWrite"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-goog-user-project": PROJECT_ID,
        "Content-Type": "application/json",
    }
    for i in range(0, len(writes), 400):
        payload = json.dumps({"writes": writes[i : i + 400]}).encode()
        request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(request) as response:
            response.read()


def doc_name(collection_name: str, doc_id: str) -> str:
    return f"projects/{PROJECT_ID}/databases/{DATABASE}/documents/{collection_name}/{doc_id}"


def upsert(collection_name: str, doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "update": {
            "name": doc_name(collection_name, doc_id),
            **firestore_doc(data),
        }
    }


def main() -> int:
    if not INVENTORY_XLSX.exists() or not BILLING_XLSX.exists():
        print("Planilhas de origem não encontradas.", file=sys.stderr)
        return 1

    inventory = load_inventory()
    billing = load_billing()

    writes: list[dict[str, Any]] = []
    for name, rows in inventory.items():
        for row in rows:
            writes.append(upsert(name, str(row["id"]), row))

    for row in billing["price_list"]:
        writes.append(upsert("billing_price_list", str(row["id"]), row))

    for period in billing["periods"]:
        writes.append(upsert("billing_periods", period["competencia"], period))

    manual_by_period: dict[str, list[dict[str, Any]]] = {}
    for item in billing["manual"]:
        manual_by_period.setdefault(item.pop("competencia"), []).append(item)
    for competencia, items in manual_by_period.items():
        writes.append(upsert("billing_manual", competencia, {"items": items}))

    writes.append(
        upsert(
            "billing_config",
            "default",
            {
                "cliente_nome": "BTG Pactual",
                "cliente_email": "",
                "ad_valorem_rate": 0.005,
            },
        )
    )

    batch_write(writes)
    print(
        json.dumps(
            {
                "products": len(inventory["products"]),
                "skus": len(inventory["skus"]),
                "movements": len(inventory["movements"]),
                "orders": len(inventory["orders"]),
                "price_list": len(billing["price_list"]),
                "periods": len(billing["periods"]),
                "writes": len(writes),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
