#!/usr/bin/env python3
"""Massa TESTE UX no cliente BTG, somente no projeto dute-homolog.

200 produtos (TESTE UX Produto 001 a 200), categoria TESTE UX, custo de
R$ 10 em catalog_prices, uma foto e 10 unidades disponíveis em prateleira
cadastrada (nunca em RECEBIMENTO). Não há argumento de projeto: a URL do
Firestore é montada só com a constante abaixo.
"""

from __future__ import annotations

import json
import os
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
from datetime import datetime, timezone
from typing import Any

PROJECT_ID = "dute-homolog"
DATABASE = "(default)"
CUSTOMER = "BTG Pactual"
CONFIRMATION = "HOMOLOG-BTG-TESTE-UX"
SEED_ID = "teste-ux-portal-2026-10-23"
PRODUCT_COUNT = 200
QTY_EACH = 10
UNIT_COST = 10.0
FORBIDDEN_LOCATIONS = {"RECEBIMENTO", "EXPEDICAO"}
BUCKET_CANDIDATES = (
    "dute-homolog.firebasestorage.app",
    "dute-homolog.appspot.com",
)


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def assert_homolog(value: str) -> str:
    if value != PROJECT_ID or "dute-prod" in value or "dute-btg" in value:
        die(f"Recusado: este script só fala com {PROJECT_ID}. Recebi {value!r}.")
    return value


def firestore_root() -> str:
    assert_homolog(PROJECT_ID)
    return (
        "https://firestore.googleapis.com/v1/projects/"
        f"{PROJECT_ID}/databases/{urllib.parse.quote(DATABASE, safe='')}"
    )


def doc_name(collection: str, doc_id: str) -> str:
    if "/" in doc_id or not doc_id:
        die(f"Id de documento inválido: {collection}/{doc_id}")
    return f"{firestore_root()}/documents/{collection}/{urllib.parse.quote(doc_id, safe='')}"


def fs_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [fs_value(item) for item in value]}}
    if isinstance(value, dict):
        stamp = value.get("__timestamp__")
        if isinstance(stamp, str) and len(value) == 1:
            return {"timestampValue": stamp}
        return {
            "mapValue": {
                "fields": {key: fs_value(item) for key, item in value.items()}
            }
        }
    die(f"Tipo não suportado no Firestore: {type(value).__name__}")
    return {}


def fields_of(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: fs_value(value) for key, value in payload.items()}


def plain(value: dict[str, Any] | None) -> Any:
    if not value:
        return None
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [plain(item) for item in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {
            key: plain(item)
            for key, item in value["mapValue"].get("fields", {}).items()
        }
    return None


def document_data(document: dict[str, Any] | None) -> dict[str, Any]:
    if not document:
        return {}
    return {
        key: plain(value) for key, value in document.get("fields", {}).items()
    }


class Firestore:
    def __init__(self, token: str) -> None:
        self.token = token

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        if "dute-prod" in url or "dute-btg" in url or f"/projects/{PROJECT_ID}/" not in url:
            die(f"URL fora do {PROJECT_ID}: {url}")
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "x-goog-user-project": PROJECT_ID,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            die(f"HTTP {error.code} em {method} {url}\n{body[:2000]}")
        return {}

    def assert_database(self) -> None:
        database = self.request(firestore_root())
        name = str(database.get("name", ""))
        expected = f"projects/{PROJECT_ID}/databases/{DATABASE}"
        if name != expected:
            die(f"Banco inesperado: {name or '(vazio)'}. Esperado {expected}.")

    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        url = doc_name(collection, doc_id)
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {self.token}",
                "x-goog-user-project": PROJECT_ID,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            body = error.read().decode("utf-8", errors="replace")
            die(f"HTTP {error.code} ao ler {collection}/{doc_id}\n{body[:2000]}")
        return None

    def batch_get(self, names: list[str]) -> dict[str, dict[str, Any] | None]:
        found: dict[str, dict[str, Any] | None] = {name: None for name in names}
        for start in range(0, len(names), 100):
            chunk = names[start : start + 100]
            payload = self.request(
                f"{firestore_root()}/documents:batchGet",
                method="POST",
                payload={"documents": chunk},
            )
            for item in payload if isinstance(payload, list) else payload.get("found", []):
                # A API devolve uma lista na raiz.
                pass
            rows = payload if isinstance(payload, list) else []
            if not rows and isinstance(payload, dict):
                die(f"batchGet inesperado: {json.dumps(payload)[:500]}")
            for item in rows:
                document = item.get("found")
                missing = item.get("missing")
                if document and document.get("name"):
                    found[document["name"]] = document
                elif missing:
                    found[missing] = None
        return found

    def query(self, collection: str, field: str, value: str) -> list[dict[str, Any]]:
        payload = self.request(
            f"{firestore_root()}/documents:runQuery",
            method="POST",
            payload={
                "structuredQuery": {
                    "from": [{"collectionId": collection}],
                    "where": {
                        "fieldFilter": {
                            "field": {"fieldPath": field},
                            "op": "EQUAL",
                            "value": {"stringValue": value},
                        }
                    },
                    "limit": 20,
                }
            },
        )
        rows = payload if isinstance(payload, list) else []
        return [row["document"] for row in rows if row.get("document")]

    def list_collection(self, collection: str) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        page_token = ""
        while True:
            query = urllib.parse.urlencode(
                {"pageSize": "300", **({"pageToken": page_token} if page_token else {})}
            )
            payload = self.request(
                f"{firestore_root()}/documents/{collection}?{query}"
            )
            documents.extend(payload.get("documents", []))
            page_token = str(payload.get("nextPageToken") or "")
            if not page_token:
                return documents

    def commit(self, writes: list[dict[str, Any]]) -> None:
        if not writes:
            return
        for start in range(0, len(writes), 400):
            self.request(
                f"{firestore_root()}/documents:commit",
                method="POST",
                payload={"writes": writes[start : start + 400]},
                timeout=120,
            )


def png(width: int, height: int) -> bytes:
    """Retângulo azul, genérico, sem texto: a vitrine mostra o nome ao lado."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            edge = x < 8 or y < 8 or x >= width - 8 or y >= height - 8
            if edge:
                raw.extend((11, 58, 106))
            elif 28 <= x <= 92 and 36 <= y <= 84:
                raw.extend((232, 238, 244))
            else:
                raw.extend((27, 92, 158))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def upload_photo(token: str) -> str:
    image = png(120, 120)
    download_token = str(uuid.uuid5(uuid.NAMESPACE_URL, SEED_ID))
    object_name = "product-photos/teste-ux/generica.png"
    encoded = urllib.parse.quote(object_name, safe="")
    boundary = "testeuxboundary"
    metadata = json.dumps(
        {
            "name": object_name,
            "contentType": "image/png",
            "metadata": {"firebaseStorageDownloadTokens": download_token},
        }
    )
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + metadata.encode()
        + b"\r\n"
        + f"--{boundary}\r\nContent-Type: image/png\r\n\r\n".encode()
        + image
        + f"\r\n--{boundary}--\r\n".encode()
    )
    last_error = "nenhum bucket tentado"
    for bucket in BUCKET_CANDIDATES:
        if not bucket.startswith("dute-homolog"):
            die(f"Bucket recusado: {bucket}")
        url = (
            "https://storage.googleapis.com/upload/storage/v1/b/"
            f"{bucket}/o?uploadType=multipart"
        )
        headers = {
            "Authorization": f"Bearer {token}",
            "x-goog-user-project": PROJECT_ID,
            "Content-Type": f"multipart/related; boundary={boundary}",
        }
        request = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read()[:300]
            if error.code == 409:
                delete = urllib.request.Request(
                    "https://storage.googleapis.com/storage/v1/b/"
                    f"{bucket}/o/{encoded}",
                    method="DELETE",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "x-goog-user-project": PROJECT_ID,
                    },
                )
                try:
                    with urllib.request.urlopen(delete, timeout=30):
                        pass
                except urllib.error.HTTPError as delete_error:
                    last_error = (
                        f"{bucket}: já existia e o apagar respondeu "
                        f"HTTP {delete_error.code}"
                    )
                    continue
                retry = urllib.request.Request(
                    url,
                    data=body,
                    method="POST",
                    headers=headers,
                )
                try:
                    with urllib.request.urlopen(retry, timeout=60) as response:
                        json.loads(response.read())
                except urllib.error.HTTPError as retry_error:
                    last_error = f"{bucket}: HTTP {retry_error.code} após substituir"
                    continue
            else:
                last_error = f"{bucket}: HTTP {error.code} {detail!r}"
                continue
        file_url = (
            "https://firebasestorage.googleapis.com/v0/b/"
            f"{bucket}/o/{encoded}?alt=media&token={download_token}"
        )
        probe = urllib.request.Request(file_url, method="GET")
        try:
            with urllib.request.urlopen(probe, timeout=30) as response:
                if response.status == 200 and response.read(8).startswith(b"\x89PNG"):
                    return file_url
        except urllib.error.HTTPError as error:
            last_error = f"download {bucket}: HTTP {error.code}"
            continue
    die(f"Não consegui publicar a foto no Storage da homologação. {last_error}")
    return ""


def product_name(index: int) -> str:
    return f"TESTE UX Produto {index:03d}"


def client_code(index: int) -> str:
    return f"TUX-{index:03d}"


def sku_code(sequence: int) -> str:
    return f"BTG-{sequence:06d}"


def safe_id(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "_.-" else "_" for char in value)
    return cleaned[:900]


def choose_positions(documents: list[dict[str, Any]]) -> tuple[list[str], str]:
    active: list[tuple[str, str]] = []
    for document in documents:
        data = document_data(document)
        code = str(data.get("code") or document["name"].rsplit("/", 1)[-1]).strip().upper()
        status = str(data.get("status") or "active").strip() or "active"
        zone = str(data.get("customer_code") or "").strip()
        if status != "active" or code in FORBIDDEN_LOCATIONS:
            continue
        active.append((code, zone))
    zoned = sorted(code for code, zone in active if zone == CUSTOMER)
    if zoned:
        return zoned, "zona da BTG Pactual"
    unzoned = sorted(code for code, zone in active if not zone)
    if unzoned:
        return unzoned, "prateleiras ativas sem zona (nenhuma estava atribuída à BTG)"
    return [], ""


def opening_blocks(control: dict[str, Any], session: dict[str, Any] | None) -> bool:
    if session and str(session.get("status") or "") == "open":
        return True
    return control.get("stock_initialized") is False or control.get("opening_inventory_required") is True


def create_write(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "update": {"name": name, "fields": fields_of(payload)},
        "currentDocument": {"exists": False},
    }


def selftest() -> None:
    image = png(120, 120)
    if not image.startswith(b"\x89PNG"):
        die("PNG inválido")
    encoded = fs_value({"qty": 10, "cost": 10.0, "name": "TESTE UX", "ok": True})
    if encoded["mapValue"]["fields"]["qty"] != {"integerValue": "10"}:
        die("encoder de inteiro falhou")
    positions, reason = choose_positions(
        [
            {"name": "x/RECEBIMENTO", "fields": {"code": {"stringValue": "RECEBIMENTO"}, "status": {"stringValue": "active"}, "customer_code": {"stringValue": CUSTOMER}}},
            {"name": "x/A-01", "fields": {"code": {"stringValue": "A-01"}, "status": {"stringValue": "active"}, "customer_code": {"stringValue": CUSTOMER}}},
            {"name": "x/A-02", "fields": {"code": {"stringValue": "A-02"}, "status": {"stringValue": "blocked"}, "customer_code": {"stringValue": CUSTOMER}}},
        ]
    )
    if positions != ["A-01"] or "zona" not in reason:
        die(f"escolha de posição falhou: {positions} {reason}")
    assert_homolog(PROJECT_ID)
    print("selftest ok")


def main() -> None:
    if os.environ.get("SEED_SELFTEST") == "1":
        selftest()
        return
    if os.environ.get("SEED_CONFIRM") != CONFIRMATION:
        die(
            "Confirmação ausente. A gravação só segue com "
            f"SEED_CONFIRM={CONFIRMATION}."
        )
    token = os.environ.get("ACCESS_TOKEN", "").strip()
    if not token:
        die("ACCESS_TOKEN ausente.")
    account = os.environ.get("GCP_SERVICE_ACCOUNT", "")
    if account != f"github-actions-functions@{PROJECT_ID}.iam.gserviceaccount.com":
        die(f"Conta recusada: {account or '(vazia)'}.")
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        die("FIRESTORE_EMULATOR_HOST está definido. Este script não usa emulador.")

    db = Firestore(token)
    db.assert_database()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    stamp = {"__timestamp__": now}

    customers = db.query("customers", "code", CUSTOMER)
    if len(customers) != 1:
        die(f"Esperava um cadastro com code {CUSTOMER!r}; achei {len(customers)}.")
    customer = document_data(customers[0])
    if customer.get("archived") is True or customer.get("status") == "archived":
        die("O cadastro da BTG está arquivado. Nada foi gravado.")
    if str(customer.get("customer_code") or customer.get("code")) != CUSTOMER:
        die("O customer_code da BTG não é o esperado. Nada foi gravado.")

    control_doc = db.get("system_controls", "inventory")
    control = document_data(control_doc)
    if control.get("movements_frozen") is True or control.get("reconciliation_status") == "running":
        die("Movimentações congeladas para reconciliação. Nada foi gravado.")
    session_id = safe_id(f"opening_{CUSTOMER}")
    session_doc = db.get("opening_inventory_sessions", session_id)
    session = document_data(session_doc) if session_doc else None
    session_open = bool(session and session.get("status") == "open")

    positions, position_reason = choose_positions(db.list_collection("warehouse_positions"))
    if not positions:
        die(
            "Nenhuma prateleira ativa fora de RECEBIMENTO/EXPEDICAO. "
            "Nada foi gravado."
        )

    counter_doc = db.get("sku_counters", "BTG")
    counter = document_data(counter_doc)
    last = counter.get("last") if isinstance(counter.get("last"), int) else 0

    candidates = list(range(last + 1, last + PRODUCT_COUNT + 1))
    existing_skus = db.batch_get([doc_name("skus", sku_code(sequence)) for sequence in candidates])
    free_sequences: list[int] = []
    cursor = last
    while len(free_sequences) < PRODUCT_COUNT:
        cursor += 1
        if cursor > last + 5000 or cursor > 999999:
            die("Não achei 200 SKUs livres na sigla BTG. Nada foi gravado.")
        name = doc_name("skus", sku_code(cursor))
        exists = existing_skus.get(name) if name in existing_skus else db.get("skus", sku_code(cursor))
        if exists is None:
            free_sequences.append(cursor)

    items: list[dict[str, Any]] = []
    for index, sequence in enumerate(free_sequences, start=1):
        items.append(
            {
                "index": index,
                "name": product_name(index),
                "client_code": client_code(index),
                "sku": sku_code(sequence),
                "sequence": sequence,
                "location": positions[(index - 1) % len(positions)],
            }
        )

    names = []
    for item in items:
        names.extend(
            [
                doc_name("products", item["client_code"]),
                doc_name("skus", item["sku"]),
                doc_name("stock_balances", safe_id(f"bal_{CUSTOMER}__{item['sku']}__{item['location']}")),
                doc_name("client_inventory", safe_id(f"cinv_{CUSTOMER}__{item['sku']}")),
                doc_name("catalog_prices", safe_id(f"cprice_{CUSTOMER}__{item['sku']}")),
                doc_name("movements", f"mov_{SEED_ID}_{item['client_code']}"),
            ]
        )
    present = db.batch_get(names)

    def already(name: str) -> dict[str, Any] | None:
        document = present.get(name)
        return document_data(document) if document else None

    for item in items:
        product = already(doc_name("products", item["client_code"]))
        if product and (
            product.get("customer_code") != CUSTOMER
            or product.get("produto") != item["name"]
            or product.get("seed_id") != SEED_ID
        ):
            die(
                f"{item['client_code']} já existe e não é esta massa. Nada foi gravado."
            )
        sku = already(doc_name("skus", item["sku"]))
        if sku and sku.get("seed_id") != SEED_ID:
            die(f"SKU {item['sku']} já existe fora desta massa. Nada foi gravado.")

    photo_url = upload_photo(token)
    writes: list[dict[str, Any]] = []
    created = 0
    actor = {
        "uid": "seed-teste-ux",
        "name": "Massa TESTE UX",
        "role": "seed",
    }
    for item in items:
        balance_id = safe_id(f"bal_{CUSTOMER}__{item['sku']}__{item['location']}")
        inventory_id = safe_id(f"cinv_{CUSTOMER}__{item['sku']}")
        price_id = safe_id(f"cprice_{CUSTOMER}__{item['sku']}")
        movement_id = f"mov_{SEED_ID}_{item['client_code']}"
        catalog = {
            "customer_code": CUSTOMER,
            "cod_cliente": item["client_code"],
            "cod_cliente_key": item["client_code"],
            "produto": item["name"],
            "product_name": item["name"],
            "category": "TESTE UX",
            "categoria": "TESTE UX",
            "photo_urls": [photo_url],
            "primary_photo_url": photo_url,
            "photo_storage_paths": ["product-photos/teste-ux/generica.png"],
            "status": "active",
            "archived": False,
            "source": "homolog_teste_ux",
            "seed_id": SEED_ID,
            "updated_at": stamp,
        }
        specs = [
            (
                doc_name("products", item["client_code"]),
                {
                    "id": item["client_code"],
                    **catalog,
                    "estoque_btg": QTY_EACH,
                    "num_skus": 1,
                    "created_at": stamp,
                    "created_by": actor,
                },
            ),
            (
                doc_name("skus", item["sku"]),
                {
                    "id": item["sku"],
                    **catalog,
                    "cod_btg": item["sku"],
                    "sku_code": item["sku"],
                    "sku_code_key": item["sku"],
                    "estoque_atual": QTY_EACH,
                    "estoque_reservado": 0,
                    "estoque_disponivel": QTY_EACH,
                    "created_at": stamp,
                    "created_by": actor,
                },
            ),
            (
                doc_name("stock_balances", balance_id),
                {
                    "id": balance_id,
                    "customer_code": CUSTOMER,
                    "sku_code": item["sku"],
                    "client_item_code": item["client_code"],
                    "product_name": item["name"],
                    "location_id": item["location"],
                    "category": "TESTE UX",
                    "photo_urls": [photo_url],
                    "primary_photo_url": photo_url,
                    "qty_on_hand": QTY_EACH,
                    "qty_reserved": 0,
                    "qty_available": QTY_EACH,
                    "status": "available",
                    "source": "homolog_teste_ux",
                    "seed_id": SEED_ID,
                    "created_at": stamp,
                    "updated_at": stamp,
                },
            ),
            (
                doc_name("client_inventory", inventory_id),
                {
                    "id": inventory_id,
                    "customer_code": CUSTOMER,
                    "sku_code": item["sku"],
                    "client_item_code": item["client_code"],
                    "product_name": item["name"],
                    "category": "TESTE UX",
                    "photo_urls": [photo_url],
                    "primary_photo_url": photo_url,
                    "qty_on_hand": QTY_EACH,
                    "qty_reserved": 0,
                    "qty_available": QTY_EACH,
                    "status": "active",
                    "source": "operational_projection",
                    "seed_id": SEED_ID,
                    "published_at": stamp,
                    "updated_at": stamp,
                },
            ),
            (
                doc_name("catalog_prices", price_id),
                {
                    "id": price_id,
                    "customer_code": CUSTOMER,
                    "sku_code": item["sku"],
                    "item_code": item["client_code"],
                    "preco_unit": UNIT_COST,
                    "total_cost": float(QTY_EACH * UNIT_COST),
                    "seed_id": SEED_ID,
                    "updated_at": stamp,
                },
            ),
            (
                doc_name("movements", movement_id),
                {
                    "id": movement_id,
                    "data": now,
                    "occurred_at": now,
                    "type": "inventory.received",
                    "tipo_mov": "ENTRADA",
                    "sign": 1,
                    "sinal": 1,
                    "quantity": QTY_EACH,
                    "qtde": QTY_EACH,
                    "customer_code": CUSTOMER,
                    "sku_code": item["sku"],
                    "cod_sku": item["sku"],
                    "client_item_code": item["client_code"],
                    "product_name": item["name"],
                    "produto": item["name"],
                    "location_id": item["location"],
                    "qty_before": 0,
                    "qty_after": QTY_EACH,
                    "saldo_delta": QTY_EACH,
                    "source": "homolog_teste_ux",
                    "seed_id": SEED_ID,
                    "actor": actor,
                    "created_at": stamp,
                },
            ),
        ]
        missing = [spec for spec in specs if already(spec[0]) is None]
        if missing:
            created += 1
        for name, payload in missing:
            location = payload.get("location_id")
            if isinstance(location, str) and location.upper() in FORBIDDEN_LOCATIONS:
                die(f"Local proibido em {name}. Nada mais será gravado.")
            writes.append(create_write(name, payload))

    highest = items[-1]["sequence"]
    if not counter_doc:
        writes.append(
            create_write(
                doc_name("sku_counters", "BTG"),
                {
                    "prefix": "BTG",
                    "customer_code": CUSTOMER,
                    "last": highest,
                    "last_code": sku_code(highest),
                    "updated_at": stamp,
                    "seed_id": SEED_ID,
                },
            )
        )
    elif isinstance(counter.get("last"), int) and counter["last"] < highest:
        writes.append(
            {
                "update": {
                    "name": doc_name("sku_counters", "BTG"),
                    "fields": fields_of(
                        {
                            "prefix": "BTG",
                            "customer_code": CUSTOMER,
                            "last": highest,
                            "last_code": sku_code(highest),
                            "updated_at": stamp,
                        }
                    ),
                },
                "updateMask": {
                    "fieldPaths": ["prefix", "customer_code", "last", "last_code", "updated_at"]
                },
                "currentDocument": {"exists": True},
            }
        )

    gate_before = {
        "stock_initialized": control.get("stock_initialized"),
        "opening_inventory_required": control.get("opening_inventory_required"),
        "session_status": None if session is None else session.get("status"),
    }
    gate_changed = False
    if opening_blocks(control, session) and not session_open and control_doc:
        writes.append(
            {
                "update": {
                    "name": doc_name("system_controls", "inventory"),
                    "fields": fields_of(
                        {
                            "stock_initialized": True,
                            "opening_inventory_required": False,
                            "updated_at": stamp,
                        }
                    ),
                },
                "updateMask": {
                    "fieldPaths": [
                        "stock_initialized",
                        "opening_inventory_required",
                        "updated_at",
                    ]
                },
                "currentDocument": {"exists": True},
            }
        )
        gate_changed = True

    event_id = f"evt_{SEED_ID}"
    if db.get("events", event_id) is None:
        writes.append(
            create_write(
                doc_name("events", event_id),
                {
                    "id": event_id,
                    "type": "inventory.teste_ux_seeded",
                    "title": "Massa TESTE UX publicada na homologação",
                    "description": (
                        f"{PRODUCT_COUNT} produtos, {PRODUCT_COUNT * QTY_EACH} unidades, "
                        "categoria TESTE UX, custo unitário de R$ 10."
                    ),
                    "severity": "info",
                    "entity_type": "catalogo",
                    "entity_id": SEED_ID,
                    "customer_code": CUSTOMER,
                    "payload": {
                        "seed_id": SEED_ID,
                        "products": PRODUCT_COUNT,
                        "qty_each": QTY_EACH,
                        "unit_cost": UNIT_COST,
                        "positions": position_reason,
                        "portal_gate_opened": gate_changed,
                    },
                    "occurred_at": now,
                    "source": "homolog_teste_ux",
                    "actor": actor,
                    "created_at": stamp,
                },
            )
        )

    db.commit(writes)

    checked = db.batch_get(
        [
            name
            for item in items
            for name in (
                doc_name("client_inventory", safe_id(f"cinv_{CUSTOMER}__{item['sku']}")),
                doc_name(
                    "stock_balances",
                    safe_id(f"bal_{CUSTOMER}__{item['sku']}__{item['location']}"),
                ),
                doc_name("catalog_prices", safe_id(f"cprice_{CUSTOMER}__{item['sku']}")),
            )
        ]
    )
    qty = 0
    bad_location = 0
    for item in items:
        inventory = document_data(
            checked.get(doc_name("client_inventory", safe_id(f"cinv_{CUSTOMER}__{item['sku']}")))
        )
        balance = document_data(
            checked.get(
                doc_name(
                    "stock_balances",
                    safe_id(f"bal_{CUSTOMER}__{item['sku']}__{item['location']}"),
                )
            )
        )
        price = document_data(
            checked.get(doc_name("catalog_prices", safe_id(f"cprice_{CUSTOMER}__{item['sku']}")))
        )
        if (
            inventory.get("qty_available") != QTY_EACH
            or inventory.get("category") != "TESTE UX"
            or inventory.get("product_name") != item["name"]
            or not inventory.get("primary_photo_url")
        ):
            die(f"Conferência falhou em {item['sku']} na projeção do portal.")
        if balance.get("location_id") in FORBIDDEN_LOCATIONS or balance.get("qty_available") != QTY_EACH:
            bad_location += 1
        if price.get("preco_unit") != UNIT_COST or price.get("total_cost") != QTY_EACH * UNIT_COST:
            die(f"Custo divergente em {item['sku']}.")
        qty += int(inventory.get("qty_on_hand") or 0)
    if bad_location or qty != PRODUCT_COUNT * QTY_EACH:
        die(f"Conferência falhou: {qty} unidades, {bad_location} endereços inválidos.")

    summary = {
        "project": PROJECT_ID,
        "customer": CUSTOMER,
        "products": PRODUCT_COUNT,
        "created_or_completed": created,
        "already_present": PRODUCT_COUNT - created,
        "qty_each": QTY_EACH,
        "qty_total": qty,
        "unit_cost_brl": UNIT_COST,
        "category": "TESTE UX",
        "sku_from": items[0]["sku"],
        "sku_to": items[-1]["sku"],
        "client_code_from": items[0]["client_code"],
        "client_code_to": items[-1]["client_code"],
        "positions": positions,
        "position_reason": position_reason,
        "photo_url": photo_url,
        "portal_gate_before": gate_before,
        "portal_gate_opened": gate_changed,
        "portal_orders_blocked_by_open_count": session_open,
        "seed_id": SEED_ID,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    destination = os.environ.get("SEED_SUMMARY_PATH")
    if destination:
        with open(destination, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
