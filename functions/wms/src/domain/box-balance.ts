import { type Firestore, type Transaction } from "firebase-admin/firestore";

import { readRows, type Row } from "./operations.js";
import { saldoDaCaixa, unidadesDaCaixa, type CaixaComOItem, type LinhaDaCaixa } from "./saldo-da-caixa.js";
import { WAREHOUSE_BOXES_COLLECTION } from "./warehouse-boxes.js";

/**
 * O saldo da caixa no banco (docs/plataforma/separacao-com-caixas.md, seção
 * 4.3, parte 3). O conteúdo de entrada continua onde sempre esteve: nas
 * linhas da abertura (`opening_inventory_lines`, pelo `box_code`) ou na
 * própria caixa do recebimento (`lines[]`). O que as separações tiram fica na
 * caixa (`taken_lines`, `taken_units`, `balance_at`), e o saldo é a entrada
 * menos o retirado (a regra sem banco em saldo-da-caixa.ts).
 *
 * Aqui fica só a leitura das caixas de uma prateleira, dentro da transação de
 * quem separa (pick-progress.ts).
 */

const OPENING_LINES_COLLECTION = "opening_inventory_lines";

/** A caixa guardada na prateleira: a que ainda está fechando o destino não conta. */
const STATUS_GUARDADA = "stored";

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** O que as separações já tiraram da caixa, por SKU. */
export function retiradoDaCaixa(box: Row): LinhaDaCaixa[] {
  const lines = Array.isArray(box.data.taken_lines) ? (box.data.taken_lines as Array<Record<string, unknown>>) : [];
  return saldoDaCaixa(
    lines.map((line) => ({ sku_code: text(line.sku_code), qty: quantity(line.qty) })),
    [],
  );
}

export type CaixasDaPrateleira = {
  /** As caixas do cliente na prateleira, pelo código. */
  porCodigo: Map<string, Row>;
  /** O que entrou do item em cada caixa. */
  entradaDoItem: Map<string, number>;
};

/**
 * As caixas do cliente numa prateleira e o que entrou de um item em cada
 * uma. Leitura de transação: quem separa a linha grava o retirado nas mesmas
 * caixas.
 */
export async function lerCaixasDaPrateleira(
  transaction: Transaction,
  db: Firestore,
  alvo: { customerCode: string; locationId: string; skuCode: string },
): Promise<CaixasDaPrateleira> {
  const [boxes, openingLines] = await Promise.all([
    readRows(
      transaction,
      db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", alvo.customerCode).where("location_id", "==", alvo.locationId),
    ),
    readRows(
      transaction,
      db
        .collection(OPENING_LINES_COLLECTION)
        .where("customer_code", "==", alvo.customerCode)
        .where("location_id", "==", alvo.locationId)
        .where("sku_code", "==", alvo.skuCode),
    ),
  ]);
  const daAbertura = new Map<string, number>();
  for (const line of openingLines) {
    const code = text(line.data.box_code).toUpperCase();
    if (code) daAbertura.set(code, (daAbertura.get(code) ?? 0) + Math.max(0, quantity(line.data.counted_qty)));
  }
  const porCodigo = new Map<string, Row>();
  const entradaDoItem = new Map<string, number>();
  for (const box of boxes) {
    const code = (text(box.data.code) || box.id).toUpperCase();
    porCodigo.set(code, box);
    // A caixa do recebimento traz o conteúdo nela; a da abertura, nas linhas da sessão.
    const proprias = Array.isArray(box.data.lines) ? (box.data.lines as Array<Record<string, unknown>>) : [];
    const entrada = proprias.length
      ? proprias.filter((line) => text(line.sku_code) === alvo.skuCode).reduce((soma, line) => soma + Math.max(0, quantity(line.counted_qty)), 0)
      : (daAbertura.get(code) ?? 0);
    if (entrada > 0) entradaDoItem.set(code, entrada);
  }
  return { porCodigo, entradaDoItem };
}

/**
 * As caixas guardadas que têm o item agora. `retirados` é o retirado de cada
 * caixa como a transação o deixou até aqui (a linha que muda devolve antes o
 * que tinha tirado); sem entrada nele, vale o gravado na caixa.
 */
export function caixasComOItem(prateleira: CaixasDaPrateleira, retirados: ReadonlyMap<string, LinhaDaCaixa[]>, skuCode: string): CaixaComOItem[] {
  const caixas: CaixaComOItem[] = [];
  for (const [code, box] of prateleira.porCodigo) {
    if (text(box.data.status) !== STATUS_GUARDADA) continue;
    const entrada = prateleira.entradaDoItem.get(code) ?? 0;
    if (!entrada) continue;
    const retirado = retirados.get(code) ?? retiradoDaCaixa(box);
    const tirouDoItem = retirado.find((line) => line.sku_code === skuCode)?.qty ?? 0;
    const disponivel = Math.max(0, entrada - tirouDoItem);
    if (!disponivel) continue;
    const tirou = unidadesDaCaixa(retirado);
    caixas.push({
      code,
      stored_at: text(box.data.stored_at) || null,
      disponivel,
      saldo: Math.max(0, quantity(box.data.unit_count) - tirou),
      intacta: tirou === 0,
    });
  }
  return caixas;
}
