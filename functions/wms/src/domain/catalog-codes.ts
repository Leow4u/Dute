import {
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { canonicalSkuPrefix } from "./customer-profile.js";

/**
 * Identidade do produto gerada pelo sistema (docs/multicliente-modelos-de-operacao.md,
 * PR 2). Ninguém digita SKU de produto novo: a contagem de abertura, a chegada
 * avulsa, a confirmação e a conferência de um envio do cliente pedem o próximo
 * código na sigla do cliente (BTG-000001, ITAU-000001), dentro da mesma
 * transação que cria o produto. Transação que falha não grava o contador, então a numeração não
 * pula por erro de validação.
 *
 * O contador é por sigla (`sku_counters/{sigla}`), não por cliente: sigla de
 * cliente arquivado reaproveitada continua a numeração e nunca repete código.
 */

export const SKU_COUNTERS_COLLECTION = "sku_counters";
export const SKU_SEQUENCE_DIGITS = 6;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

export function formatSkuCode(prefix: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Sequência de SKU inválida: ${sequence}`);
  }
  return `${prefix}-${String(sequence).padStart(SKU_SEQUENCE_DIGITS, "0")}`;
}

/** Sigla do SKU do cliente, do cadastro em Configurações › Clientes. */
export async function readCustomerSkuPrefix(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
): Promise<string> {
  // O cadastro grava `code` e `customer_code` iguais; os dois valem para um
  // cadastro antigo que só tenha um deles.
  const [byCode, byCustomerCode] = await Promise.all([
    transaction.get(db.collection("customers").where("code", "==", customerCode).limit(5)),
    transaction.get(db.collection("customers").where("customer_code", "==", customerCode).limit(5)),
  ]);
  const prefix = [...byCode.docs, ...byCustomerCode.docs]
    .filter((row) => row.get("archived") !== true && row.get("status") !== "archived")
    .map((row) => canonicalSkuPrefix(row.get("sku_prefix")))
    .find(Boolean);
  if (!prefix) {
    throw new HttpsError(
      "failed-precondition",
      `Cadastre a sigla do SKU de ${customerCode} em Configurações › Clientes antes de cadastrar produto novo: o SKU é gerado com ela.`,
      { code: "SKU_PREFIX_MISSING" },
    );
  }
  return prefix;
}

export type SkuAllocator = {
  prefix: string;
  /** Códigos entregues por next(), na ordem. */
  readonly allocated: string[];
  /** Próximo código livre. Lê o doc do SKU: um código já existente é pulado. */
  next(): Promise<string>;
  /** Grava o contador. Chamar na fase de escrita, depois de todas as leituras. */
  commit(): void;
};

/** Abre o alocador na fase de leitura da transação (sigla e contador). */
export async function openSkuAllocator(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
): Promise<SkuAllocator> {
  const prefix = await readCustomerSkuPrefix(transaction, db, customerCode);
  const counterRef = db.collection(SKU_COUNTERS_COLLECTION).doc(prefix);
  const counter = await transaction.get(counterRef);
  const stored = Number(counter.get("last") ?? 0);
  let last = Number.isInteger(stored) && stored > 0 ? stored : 0;
  const allocated: string[] = [];
  return {
    prefix,
    allocated,
    async next() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        last += 1;
        const code = formatSkuCode(prefix, last);
        const existing = await transaction.get(db.collection("skus").doc(code));
        if (!existing.exists) {
          allocated.push(code);
          return code;
        }
      }
      throw new HttpsError("aborted", "Não consegui gerar um SKU livre. Tente de novo.");
    },
    commit() {
      if (!allocated.length) return;
      transaction.set(
        counterRef,
        {
          prefix,
          customer_code: customerCode,
          last,
          last_code: allocated[allocated.length - 1],
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    },
  };
}

/** Código de barras comparável: maiúsculas, sem espaços. */
export function normalizeBarcode(value: unknown): string {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

/**
 * Código de barras é único dentro do cliente: produto novo com o código de
 * barras de um produto ativo do mesmo cliente é o mesmo produto. Outro
 * cliente pode ter o mesmo código (o catálogo de cada um é dele).
 */
export async function assertBarcodeAvailable(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
  barcode: unknown,
  legacyCustomerCode: string,
): Promise<void> {
  const key = normalizeBarcode(barcode);
  if (!key) return;
  const [byKey, byRaw] = await Promise.all([
    transaction.get(db.collection("skus").where("barcode_key", "==", key).limit(10)),
    transaction.get(db.collection("skus").where("barcode", "==", text(barcode)).limit(10)),
  ]);
  const owner = (row: QueryDocumentSnapshot) =>
    text(row.get("customer_code")) || legacyCustomerCode;
  const taken = [...byKey.docs, ...byRaw.docs].find(
    (row) =>
      owner(row) === customerCode &&
      row.get("archived") !== true &&
      text(row.get("status")) !== "archived",
  );
  if (taken) {
    const sku = text(taken.get("sku_code") || taken.get("cod_btg") || taken.id);
    const name = text(taken.get("produto") || taken.get("product_name"));
    throw new HttpsError(
      "failed-precondition",
      `O código de barras ${key} já é do SKU ${sku}${name ? ` (${name})` : ""}. Use o cadastro existente para não duplicar o produto.`,
      { code: "BARCODE_ALREADY_USED", sku_code: sku },
    );
  }
}

export function isArchivedCatalogRecord(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return false;
  return data.archived === true || text(data.status) === "archived";
}

/** SKU gravado no cartão (`cod_btg`, `sku_code` ou `cod_sku`). */
export function catalogSkuCode(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  return text(data.cod_btg || data.sku_code || data.cod_sku);
}

function positiveQuantity(value: unknown): boolean {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0;
}

/** Saldo no cartão ou no ledger. Arquivado com quantidade ainda conta. */
export function catalogRecordHasQuantity(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return false;
  return (
    positiveQuantity(data.estoque_btg) ||
    positiveQuantity(data.estoque_atual) ||
    positiveQuantity(data.estoque_reservado) ||
    positiveQuantity(data.qty_on_hand) ||
    positiveQuantity(data.qty_reserved)
  );
}

export type ClientCodeRelease = "sku" | "stock" | "free";

/**
 * O que impede cadastrar de novo um código de cliente.
 * `sku`: ainda há SKU ativo — use o cadastro.
 * `stock`: o SKU ativo sumiu (lançamento cancelado ou item arquivado só no
 * SKU), mas ficou quantidade.
 * `free`: o cartão que sobrou não tem SKU ativo nem saldo. A contagem pode
 * substituí-lo. O Estoque lista SKU, então esse cartão não aparece lá.
 */
export function clientCodeRelease(input: {
  products: Array<Record<string, unknown> | undefined>;
  skus: Array<Record<string, unknown> | undefined>;
  balances?: Array<Record<string, unknown> | undefined>;
}): ClientCodeRelease {
  const skus = input.skus.filter((row): row is Record<string, unknown> => Boolean(row));
  if (skus.some((row) => !isArchivedCatalogRecord(row) && catalogSkuCode(row))) {
    return "sku";
  }
  const rows = [...input.products, ...input.skus, ...(input.balances ?? [])];
  if (rows.some((row) => catalogRecordHasQuantity(row))) return "stock";
  return "free";
}

export function clientCodeStillHasStockMessage(code: string): string {
  return `O código ${code} ficou sem SKU ativo, mas ainda tem saldo. Corrija o saldo antes de cadastrar de novo.`;
}

/**
 * Saldos do código, para a decisão acima. Uma igualdade por campo: não cria
 * índice composto. O teto é de propósito baixo — um código da abertura não
 * chega perto disso, e estourar o teto conta como saldo para não liberar
 * no escuro.
 */
export async function readCatalogQuantities(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
  clientCode: string,
  skuCodes: string[],
): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(skuCodes.map((code) => text(code)).filter(Boolean))];
  const snapshots = await Promise.all([
    transaction.get(
      db.collection("stock_balances").where("client_item_code", "==", clientCode).limit(20),
    ),
    ...unique.map((code) =>
      transaction.get(
        db
          .collection("stock_balances")
          .where("customer_code", "==", customerCode)
          .where("sku_code", "==", code)
          .limit(20),
      ),
    ),
  ]);
  const rows = snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data()));
  if (snapshots.some((snapshot) => snapshot.size >= 20)) {
    rows.push({ qty_on_hand: 1 });
  }
  return rows;
}

/**
 * Produto e SKU novos nascem só no Receber e na Contagem, que geram o SKU do
 * cliente e conferem duplicidade. O cadastro avulso (mutateManagedEntity)
 * continua editando e arquivando, mas não cria.
 */
export function assertManagedCatalogCreateAllowed(resource: string, action: string): void {
  if (["products", "skus"].includes(resource) && action === "create") {
    throw new HttpsError(
      "failed-precondition",
      "Produto novo entra pelo Receber ou pela Contagem: o SKU é gerado na sigla do cliente e a duplicidade é conferida ali.",
      { code: "CATALOG_CREATE_VIA_STOCK_FLOWS" },
    );
  }
}
