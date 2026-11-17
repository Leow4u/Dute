import { createHash } from "node:crypto";

import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { PUTAWAY_TASKS_COLLECTION } from "./area-putaway.js";
import { areaDePassagem } from "./areas-de-passagem.js";
import { BOX_STATUS_EMPTIED, BOX_STATUS_STORED, ajustesDaCaixa, caixasComOItem, retiradoDaCaixa } from "./box-balance.js";
import { publishedMoneyDeletes } from "./catalog-prices.js";
import { isArchivedCatalogRecord } from "./catalog-codes.js";
import { recordOwner } from "./customer-scope.js";
import { problemaDaQuantidadeContada } from "./cycle-count-input.js";
import { diaDeSaoPaulo } from "./datas-do-saldo.js";
import { nomeComTamanho } from "./nome-do-produto.js";
import {
  applyCatalogStockAggregates,
  assertInventoryOperationsEnabled,
  balancesAfter,
  clientSplit,
  createEvent,
  createMovement,
  movementId,
  pickLineIdOf,
  readRows,
  resolveCatalogAggregateTargets,
  skuBalancesQuery,
  updateClientInventory,
  type CatalogAggregateTarget,
  type OperationalActor,
  type OperationalEventSummary,
  type Row,
} from "./operations.js";
import { ajusteParaOContado, ordemDeSaida, saldoDaCaixa, type LinhaDaCaixa } from "./saldo-da-caixa.js";
import { WAREHOUSE_BOXES_COLLECTION } from "./warehouse-boxes.js";
import { WAREHOUSE_POSITIONS_COLLECTION } from "./warehouse-positions.js";

/**
 * Recontar uma caixa (docs/plataforma/diagnostico-contagem-ciclica.md, seção
 * 6, item 4; pranchas docs/mockups/WmsContagem*.dc.html, aprovadas em
 * 17/11/2026). A pessoa conta a caixa inteira, item por item, e manda o
 * número já conferido (a segunda contagem é da operação, fora do sistema).
 * Numa transação só:
 *
 * - O esperado de cada item é o saldo da caixa (saldo-da-caixa.ts): a
 *   entrada menos o retirado mais os ajustes de recontagens anteriores. A
 *   lista contada tem de trazer todos os itens que a caixa tem; o que a
 *   caixa não tem vem como "fora da lista".
 * - A diferença de cada item da lista acerta a caixa (um ajuste em
 *   `count_adjustments`, com o id da contagem; a entrada e o retirado ficam
 *   como estão) e o saldo da prateleira (`stock_balances`), com o movimento
 *   da contagem cíclica (`functions_cycle_count`: fora da cobrança e do
 *   relógio dos parados), a projeção do portal, um `cycle_counts` por item
 *   e os agregados do catálogo. Nunca grava preço (o custo não entra).
 * - O item fora da lista (decisões de 17/11/2026) consome, nesta ordem: o
 *   saldo do item na prateleira que nenhuma caixa guardada cobre (o "sem
 *   caixa" do relatório Caixas × saldo), sem mexer no saldo da prateleira;
 *   as outras caixas guardadas da prateleira que o têm, da mais antiga para
 *   a mais nova (um ajuste em cada uma, e o saldo da prateleira não muda; a
 *   caixa já recontada na mesma rodada não cede peça); e só o resto entra
 *   na prateleira. A resposta diz a origem de cada peça, com a quantidade.
 *   O item tem de estar no cadastro do cliente: o arquivado volta a ativo,
 *   como a abertura faz; produto novo nasce no Receber.
 * - A ENTRADA da contagem vale o dia que o FIFO já dá ao conteúdo da caixa
 *   (a peça achada a mais sempre esteve nela): na caixa da abertura, o dia
 *   da sessão (o movimento leva `fifo_opening_session_id`); nas outras, o
 *   do stored_at (`fifo_day`). A conta é a de datas-do-saldo.ts.
 * - Contado zero em tudo deixa a caixa vazia (`emptied`), com o evento
 *   `warehouse.box_emptied`, como a separação faz.
 * - Um evento por caixa recontada (`inventory.box_recounted`), com a caixa e
 *   a prateleira só no payload; `attention` só com diferença. O rascunho de
 *   aviso que nasce dele é interno (index.ts).
 *
 * As recusas da contagem cíclica continuam (estoque congelado, prateleira
 * fora do cadastro, abaixo da reserva, separado esperando a entrega, linha
 * já separada), e entra a da prateleira com guarda aberta chegando ou
 * saindo, ou com caixa a caminho (achados G01 a G03). A recontagem não
 * espera aprovação: a diferença grava na hora e vai para a revisão do admin,
 * que vem com a rodada (fora daqui).
 */

const OPERATIONS_COLLECTION = "operational_operations";
const OPENING_LINES_COLLECTION = "opening_inventory_lines";
const CYCLE_COUNTS_COLLECTION = "cycle_counts";
const STOCK_BALANCES_COLLECTION = "stock_balances";
const STOCK_RESERVATIONS_COLLECTION = "stock_reservations";
const PICK_LINES_COLLECTION = "pick_lines";
const EVENT_SOURCE = "functions_wms";

/** A origem do movimento e do `cycle_counts`: a mesma da contagem cíclica, com as mesmas regras de cobrança e de dias parado. */
export const BOX_RECOUNT_SOURCE = "functions_cycle_count";
/** O evento da caixa recontada: o rascunho de aviso dele é interno (index.ts). */
export const BOX_RECOUNT_EVENT_TYPE = "inventory.box_recounted";
/** Os itens de uma caixa: a do recebimento guarda até 100 linhas. */
export const ITENS_DA_CAIXA_MAXIMO = 100;
export const ITENS_FORA_DA_LISTA_MAXIMO = 20;
/** O motivo da recontagem sem a rodada: a rodada (fora daqui) manda o dela. */
export const MOTIVO_DA_RECONTAGEM = "Recontagem por caixa";
/** A guarda que ainda vai mexer na prateleira (area-putaway.ts). */
const GUARDA_ABERTA = new Set(["planned", "in_progress"]);

export const QUANTIDADE_NEGATIVA = "A contagem física não pode ser negativa.";
export const FORA_DA_LISTA_SEM_PECA = "O item fora da lista precisa de 1 unidade ou mais: sem peça, ele não entra.";
const RECONTAGEM_INVALIDA = "Contagem da caixa inválida: confira os campos e tente de novo.";

// ---------------------------------------------------------------- entrada

const Sku = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.toUpperCase());

const LinhaContada = z.object({ sku_code: Sku, counted_qty: z.number() }).strict();

/** O problema da quantidade de uma linha, com a frase para quem opera; null quando ela serve. */
export function problemaDaLinhaContada(qty: number, foraDaLista: boolean): string | null {
  if (!Number.isFinite(qty) || qty < 0) return QUANTIDADE_NEGATIVA;
  const problema = problemaDaQuantidadeContada("cycle", qty);
  if (problema) return problema;
  if (foraDaLista && qty < 1) return FORA_DA_LISTA_SEM_PECA;
  return null;
}

export const RecountWarehouseBoxSchema = z
  .object({
    customer_code: z.string().trim().min(1).max(160),
    box_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^CX-\d{6,}$/),
    /** A prateleira onde a caixa está, como a etiqueta dela diz. */
    location_id: z.string().trim().min(1).max(40),
    /** Os itens que a caixa tem, todos, com o contado (zero quando não achou). */
    lines: z.array(LinhaContada).max(ITENS_DA_CAIXA_MAXIMO),
    /** Os itens achados na caixa que ela não tem ("fora da lista"). */
    extra_lines: z.array(LinhaContada).max(ITENS_FORA_DA_LISTA_MAXIMO).optional(),
    reason: z.string().trim().min(3).max(300).optional(),
    reference: z.string().trim().max(300).optional(),
    /** A rodada de recontagem (a coleção vem depois): a caixa recontada nela não cede peça ao fora da lista. */
    round_id: z.string().trim().min(1).max(200).optional(),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict()
  .superRefine((input, ctx) => {
    const conferir = (linhas: Array<{ counted_qty: number }>, campo: string, foraDaLista: boolean) =>
      linhas.forEach((linha, index) => {
        const problema = problemaDaLinhaContada(linha.counted_qty, foraDaLista);
        if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo, index, "counted_qty"], message: problema });
      });
    conferir(input.lines, "lines", false);
    conferir(input.extra_lines ?? [], "extra_lines", true);
  });

export type EntradaDaRecontagem = z.output<typeof RecountWarehouseBoxSchema>;

/**
 * A entrada da callable. Fora do formato, recusa com a frase para quem opera:
 * a quantidade diz o que corrigir; o resto, que a tela não manda errado, é
 * genérico, com os campos no detalhe. O ZodError cru viraria INTERNAL.
 */
export function entradaDaRecontagem(raw: unknown): EntradaDaRecontagem {
  const parsed = RecountWarehouseBoxSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const quantidade = parsed.error.issues.find((issue) => issue.code === "custom" && issue.path[issue.path.length - 1] === "counted_qty");
  throw new HttpsError("invalid-argument", quantidade?.message ?? RECONTAGEM_INVALIDA, {
    issues: parsed.error.issues.map((issue) => issue.path.join(".")),
  });
}

// ----------------------------------------------------------------- apoio

type Data = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function chave(value: unknown): string {
  return text(value).toUpperCase();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Data)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
}

function clean<T extends Data>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Sem undefined em nível nenhum: o Firestore não grava undefined. */
function semIndefinidos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semIndefinidos);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Data)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, semIndefinidos(entry)]),
    );
  }
  return value;
}

function actorFields(actor: OperationalActor) {
  return clean({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name });
}

function recusa(code: "invalid-argument" | "failed-precondition" | "not-found" | "permission-denied", message: string, detail: string, extra: Data = {}): never {
  throw new HttpsError(code, message, { code: detail, ...extra });
}

const unidades = new Intl.NumberFormat("pt-BR");

function comSinal(qty: number): string {
  if (qty > 0) return `+${unidades.format(qty)}`;
  if (qty < 0) return `−${unidades.format(-qty)}`;
  return "0";
}

/** O nome do item como a etiqueta e o evento dizem: "Polo Masculino Piquet Preto · GG"; sem nome, o SKU. */
function nomeDoItem(nome: NomeDoItem | undefined, sku: string): string {
  const base = text(nome?.product_name);
  if (!base) return sku;
  return nomeComTamanho({ nome: base, codigo: nome?.client_item_code, tamanho: nome?.size }) || base;
}

type NomeDoItem = { client_item_code?: string; product_name?: string; size?: string };

function nomeDe(data: Data): NomeDoItem {
  return clean({
    client_item_code: text(data.client_item_code || data.cod_cliente) || undefined,
    product_name: text(data.product_name || data.produto) || undefined,
    size: text(data.size || data.tamanho) || undefined,
  });
}

/** A entrada da caixa por SKU: a do recebimento traz o conteúdo nela (`lines[]`); a da abertura, nas linhas da sessão. */
function entradaDaCaixa(box: Data, linhasDaAbertura: Row[]): Array<LinhaDaCaixa & NomeDoItem> {
  const proprias = Array.isArray(box.lines) ? (box.lines as unknown[]) : [];
  const fonte: Data[] = proprias.length
    ? proprias.filter((line): line is Data => Boolean(line) && typeof line === "object")
    : linhasDaAbertura.map((row) => row.data);
  return fonte.flatMap((line) => {
    const sku_code = chave(line.sku_code);
    const qty = Math.max(0, number(line.counted_qty));
    return sku_code && qty > 0 ? [{ sku_code, qty, ...nomeDe(line) }] : [];
  });
}

function emMaiusculas(linhas: LinhaDaCaixa[]): LinhaDaCaixa[] {
  return linhas.map((linha) => ({ sku_code: chave(linha.sku_code), qty: linha.qty }));
}

/** Os ajustes gravados na caixa, como estão (com o id da contagem e o resto): a recontagem acrescenta sem apagar. */
function ajustesGravados(box: Data): unknown[] {
  return Array.isArray(box.count_adjustments) ? [...(box.count_adjustments as unknown[])] : [];
}

type PlanoDoItem = {
  sku: string;
  foraDaLista: boolean;
  esperado: number;
  contado: number;
  /** contado − esperado: o que a caixa ganhou ou perdeu na recontagem. */
  diferenca: number;
  /** O ajuste gravado na caixa: o que leva a conta dela ao contado (saldo-da-caixa.ts, ajusteParaOContado). */
  ajusteNaCaixa: number;
  /** Do item fora da lista: de quais caixas da prateleira as peças saíram. */
  movidas: Array<{ box_code: string; qty: number }>;
  /** Do item fora da lista: de onde veio cada peça, com a quantidade (o saldo solto, as caixas, a entrada nova). */
  origens: OrigemDaPeca[];
  /** Do item fora da lista: o que veio do saldo da prateleira que nenhuma caixa cobria. */
  doSolto: number;
  /** O que o saldo da prateleira ganha ou perde. */
  naPrateleira: number;
  nome: NomeDoItem;
};

/**
 * De onde veio a peça fora da lista: o saldo da prateleira que nenhuma caixa
 * cobria (`loose`), outra caixa da prateleira (`box`) ou a entrada nova na
 * prateleira (`entry`).
 */
export type OrigemDaPeca = { kind: "loose"; qty: number } | { kind: "box"; box_code: string; qty: number } | { kind: "entry"; qty: number };

/** O cadastro do item fora da lista: tem de existir e ser do cliente; o arquivado volta a ativo. */
type CadastroDoItem = { skuRef: DocumentReference<DocumentData>; sku: Data; productRef?: DocumentReference<DocumentData>; product?: Data; alvo: CatalogAggregateTarget };

async function lerCadastro(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string): Promise<CadastroDoItem> {
  const doSku = await resolveCatalogAggregateTargets(transaction, db, skuCode);
  const skuSnapshot = doSku.skuRef ? await transaction.get(doSku.skuRef) : undefined;
  if (!doSku.skuRef || !skuSnapshot?.exists) {
    recusa(
      "failed-precondition",
      `O produto ${skuCode} não está no cadastro de ${customerCode}: produto novo entra pelo Receber. Confira o código ou registre a peça à parte.`,
      "BOX_RECOUNT_PRODUCT_NOT_FOUND",
      { sku_code: skuCode },
    );
  }
  const sku = skuSnapshot.data() ?? {};
  if (recordOwner(sku) !== customerCode) {
    recusa(
      "failed-precondition",
      `O produto ${skuCode} é do cadastro de ${recordOwner(sku)}, não de ${customerCode}: confira o cliente ativo.`,
      "CATALOG_OWNED_BY_OTHER_CUSTOMER",
      { owner: recordOwner(sku) },
    );
  }
  const clientCode = text(sku.cod_cliente || sku.client_item_code || sku.cod_cliente_key);
  const alvo = clientCode ? await resolveCatalogAggregateTargets(transaction, db, skuCode, clientCode) : doSku;
  const productSnapshot = alvo.productRef ? await transaction.get(alvo.productRef) : undefined;
  return {
    skuRef: doSku.skuRef,
    sku,
    productRef: productSnapshot?.exists ? alvo.productRef : undefined,
    product: productSnapshot?.exists ? productSnapshot.data() : undefined,
    alvo: { skuRef: doSku.skuRef, productRef: productSnapshot?.exists ? alvo.productRef : undefined },
  };
}

/** O que a prateleira tem do item: o saldo exato nela e todos os saldos do SKU (o portal sai deles). */
async function lerSaldo(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string, locationId: string): Promise<{ rows: Row[]; todos: Row[] }> {
  const todos = await readRows(transaction, skuBalancesQuery(db, customerCode, skuCode));
  return { rows: todos.filter((row) => text(row.data.location_id) === locationId), todos };
}

/**
 * As recusas da reserva da contagem cíclica, na prateleira, para o item: o
 * separado esperando a entrega (reserva `picked`) e a linha já separada de
 * um pedido em separação. Só lê.
 */
async function conferirSeparacao(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string, locationId: string, nome: string) {
  const reservas = db
    .collection(STOCK_RESERVATIONS_COLLECTION)
    .where("customer_code", "==", customerCode)
    .where("sku_code", "==", skuCode)
    .where("location_id", "==", locationId);
  const [separadas, reservadas] = await Promise.all([
    readRows(transaction, reservas.where("status", "==", "picked").limit(1)),
    readRows(transaction, reservas.where("status", "==", "reserved")),
  ]);
  if (separadas.length) {
    const pedido = text(separadas[0]!.data.order_number);
    recusa(
      "failed-precondition",
      `${nome} na prateleira ${locationId} tem itens separados esperando a entrega${pedido ? ` (pedido ${pedido})` : ""}. Reconte a caixa depois da entrega.`,
      "BOX_RECOUNT_PICKED_AWAITING_DELIVERY",
      { sku_code: skuCode, order_number: pedido || null },
    );
  }
  for (const reserva of reservadas) {
    const pickLineId = pickLineIdOf(reserva.data);
    if (!pickLineId) continue;
    const linha = await transaction.get(db.collection(PICK_LINES_COLLECTION).doc(pickLineId));
    // A linha separada com zero (falta total) não tirou nada da prateleira.
    if (linha.exists && linha.get("separated_at") && number(linha.get("separated_qty")) > 0) {
      const pedido = text(reserva.data.order_number);
      recusa(
        "failed-precondition",
        `${nome} na prateleira ${locationId} tem itens já separados de um pedido em separação${pedido ? ` (pedido ${pedido})` : ""}. Reconte a caixa depois da entrega.`,
        "BOX_RECOUNT_LINE_SEPARATED",
        { sku_code: skuCode, order_number: pedido || null },
      );
    }
  }
}

// ------------------------------------------------------------ a recontagem

export async function recountWarehouseBoxTransaction(db: Firestore, input: EntradaDaRecontagem, actor: OperationalActor) {
  const customerCode = text(input.customer_code);
  const boxCode = chave(input.box_code);
  const locationTyped = text(input.location_id);
  const area = areaDePassagem(locationTyped);
  if (area) {
    recusa(
      "failed-precondition",
      `O local ${area} é área de passagem, não prateleira: a caixa guardada fica numa prateleira. Confira o código na etiqueta da prateleira.`,
      "BOX_RECOUNT_NOT_A_SHELF",
    );
  }
  const locationId = locationTyped.toUpperCase();
  const lines = input.lines;
  const extra = input.extra_lines ?? [];
  const vistos = new Set<string>();
  for (const linha of [...lines, ...extra]) {
    if (vistos.has(linha.sku_code)) {
      recusa("invalid-argument", `O item ${linha.sku_code} aparece duas vezes na contagem da caixa ${boxCode}: some as peças numa linha só.`, "BOX_RECOUNT_DUPLICATED_ITEM", { sku_code: linha.sku_code });
    }
    vistos.add(linha.sku_code);
  }
  const reason = input.reason ?? MOTIVO_DA_RECONTAGEM;
  const reference = input.reference || undefined;
  const roundId = input.round_id || undefined;
  const operationId = `op_box_recount_${digest({ customer: customerCode, box: boxCode, nonce: input.idempotency_key })}`;
  const inputHash = digest(input, 64);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(operationId);
  const recountId = `brc_${digest({ operationId })}`;
  const boxRef = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(boxCode);
  const positionRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(locationId);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Data;
    }
    await assertInventoryOperationsEnabled(transaction, db);
    // A hora é a do servidor, como na contagem cíclica (F12).
    const occurredAt = new Date().toISOString();

    // A caixa: existe, é do cliente e está guardada nesta prateleira (o molde é a abertura, operations.ts).
    const [boxSnapshot, positionSnapshot] = await Promise.all([transaction.get(boxRef), transaction.get(positionRef)]);
    if (!boxSnapshot.exists) {
      recusa("not-found", `A caixa ${boxCode} não está cadastrada. Confira o código na etiqueta da caixa.`, "BOX_RECOUNT_BOX_NOT_FOUND");
    }
    const box = boxSnapshot.data() ?? {};
    if (text(box.customer_code) !== customerCode) {
      throw new HttpsError("permission-denied", "A caixa pertence a outro cliente.");
    }
    const status = text(box.status);
    if (status === "committing") {
      recusa(
        "failed-precondition",
        `A caixa ${boxCode} ainda está a caminho da prateleira: conclua a guarda dela antes de recontar.`,
        "BOX_RECOUNT_BOX_COMMITTING",
      );
    }
    if (status === BOX_STATUS_EMPTIED) {
      recusa(
        "failed-precondition",
        `A caixa ${boxCode} está registrada como vazia, fora da prateleira. Se ela tem peças, avise a coordenação.`,
        "BOX_RECOUNT_BOX_EMPTIED",
      );
    }
    if (status !== BOX_STATUS_STORED) {
      recusa(
        "failed-precondition",
        `A caixa ${boxCode} não está guardada (ainda em conferência ou sem prateleira): só a caixa guardada se reconta.`,
        "BOX_RECOUNT_BOX_NOT_STORED",
      );
    }
    const boxLocation = chave(box.location_id);
    if (boxLocation !== locationId) {
      recusa(
        "failed-precondition",
        `A caixa ${boxCode} está em ${boxLocation || "nenhuma prateleira"}, não em ${locationTyped}.`,
        "BOX_RECOUNT_WRONG_SHELF",
        { location_id: boxLocation || null },
      );
    }
    // A prateleira existe no mapa do armazém (Estoque › Posições), como na contagem cíclica.
    if (!positionSnapshot.exists) {
      recusa(
        "not-found",
        `A posição ${locationTyped} não está cadastrada no mapa do armazém. Confira o código na etiqueta da prateleira ou cadastre a posição em Estoque › Posições.`,
        "BOX_RECOUNT_SHELF_NOT_FOUND",
      );
    }

    // A prateleira: as caixas do cliente, as linhas da abertura e as guardas abertas.
    const [caixasDaPrateleira, linhasDaCaixa, linhasDaPrateleira, chegando, saindo] = await Promise.all([
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode).where("location_id", "==", locationId)),
      readRows(transaction, db.collection(OPENING_LINES_COLLECTION).where("customer_code", "==", customerCode).where("box_code", "==", boxCode)),
      readRows(transaction, db.collection(OPENING_LINES_COLLECTION).where("customer_code", "==", customerCode).where("location_id", "==", locationId)),
      readRows(transaction, db.collection(PUTAWAY_TASKS_COLLECTION).where("customer_code", "==", customerCode).where("destination_location_id", "==", locationId)),
      readRows(transaction, db.collection(PUTAWAY_TASKS_COLLECTION).where("customer_code", "==", customerCode).where("source_location_id", "==", locationId)),
    ]);
    // A guarda chegando ou saindo, e a caixa a caminho, ainda vão mexer na prateleira (achados G01 a G03).
    const aCaminho = caixasDaPrateleira.find((row) => text(row.data.status) === "committing");
    const guarda = [...chegando, ...saindo].find((row) => GUARDA_ABERTA.has(text(row.data.status).toLowerCase()));
    if (aCaminho || guarda) {
      const qual = aCaminho ? `a caixa ${chave(aCaminho.data.code) || aCaminho.id} a caminho` : "uma guarda chegando ou saindo";
      recusa(
        "failed-precondition",
        `A prateleira ${locationId} tem ${qual}: conclua a guarda antes de recontar as caixas dela.`,
        "BOX_RECOUNT_PUTAWAY_OPEN",
        { box_code: aCaminho ? chave(aCaminho.data.code) || aCaminho.id : null, putaway_task_id: guarda?.id ?? null },
      );
    }

    // O esperado de cada item: o saldo da caixa (entrada − retirado + ajustes).
    const entrada = entradaDaCaixa(box, linhasDaCaixa);
    const retirado = emMaiusculas(retiradoDaCaixa({ id: boxCode, ref: boxRef, data: box }));
    const ajustes = emMaiusculas(ajustesDaCaixa(box));
    const esperado = new Map(saldoDaCaixa(entrada, retirado, ajustes).map((linha) => [linha.sku_code, linha.qty]));
    const nomes = new Map<string, NomeDoItem>();
    for (const linha of entrada) if (!nomes.has(linha.sku_code)) nomes.set(linha.sku_code, nomeDe(linha));

    // A lista contada é a da caixa: todos os itens dela, e o fora da lista é só o que ela não tem. A tela
    // desatualizada recusa com o que mudou, a começar pelo fora da lista que a caixa já tem.
    for (const linha of extra) {
      if (esperado.has(linha.sku_code)) {
        recusa(
          "failed-precondition",
          `O item ${linha.sku_code} já está na lista da caixa ${boxCode}: conte-o na lista, não como fora da lista. Se a lista da tela mudou, atualize e conte de novo.`,
          "BOX_RECOUNT_LIST_CHANGED",
          { sku_code: linha.sku_code },
        );
      }
    }
    for (const linha of lines) {
      if (!esperado.has(linha.sku_code)) {
        recusa(
          "failed-precondition",
          `O item ${linha.sku_code} não está mais na lista da caixa ${boxCode} (outra contagem ou a separação mudou a caixa): atualize a tela e conte de novo.`,
          "BOX_RECOUNT_LIST_CHANGED",
          { sku_code: linha.sku_code },
        );
      }
    }
    const naLista = new Set(lines.map((linha) => linha.sku_code));
    for (const [sku, qty] of esperado) {
      if (!naLista.has(sku)) {
        recusa(
          "failed-precondition",
          `Conte todos os itens da caixa ${boxCode}: falta ${nomeDoItem(nomes.get(sku), sku)}, com ${unidades.format(qty)} un. esperadas. Se a lista da tela mudou, atualize e conte de novo.`,
          "BOX_RECOUNT_LIST_CHANGED",
          { sku_code: sku },
        );
      }
    }

    // O cadastro do item fora da lista (tem de existir e ser do cliente).
    const cadastros = new Map<string, CadastroDoItem>();
    for (const linha of extra) {
      const cadastro = await lerCadastro(transaction, db, customerCode, linha.sku_code);
      cadastros.set(linha.sku_code, cadastro);
      nomes.set(linha.sku_code, nomeDe(cadastro.sku));
    }

    // As outras caixas guardadas da prateleira, para o fora da lista: todas cobrem o saldo do item; a recontada
    // na mesma rodada não cede peça.
    const guardadas = caixasDaPrateleira.filter((row) => row.id !== boxCode && text(row.data.status) === BOX_STATUS_STORED);
    const cedem = guardadas.filter((row) => !(roundId && text(row.data.last_recount_round_id) === roundId));
    const daAberturaPorCaixa = new Map<string, Row[]>();
    for (const row of linhasDaPrateleira) {
      const codigo = chave(row.data.box_code);
      if (codigo) daAberturaPorCaixa.set(codigo, [...(daAberturaPorCaixa.get(codigo) ?? []), row]);
    }
    /** As caixas, como a separação as lê (box-balance.ts), com a entrada do item em cada uma. */
    const prateleiraDoItem = (rows: Row[], sku: string) => ({
      porCodigo: new Map(rows.map((row) => [chave(row.data.code) || row.id, row] as const)),
      entradaDoItem: new Map(
        rows.map((row) => {
          const codigo = chave(row.data.code) || row.id;
          const doItem = entradaDaCaixa(row.data, daAberturaPorCaixa.get(codigo) ?? []).filter((entrou) => entrou.sku_code === sku);
          return [codigo, doItem.reduce((soma, entrou) => soma + entrou.qty, 0)] as const;
        }),
      ),
    });
    const movidasDe = new Map<string, { row: Row; entradas: Data[] }>();
    const saldos = new Map<string, { rows: Row[]; todos: Row[] }>();
    const lerOSaldo = async (sku: string) => {
      const lido = saldos.get(sku) ?? (await lerSaldo(transaction, db, customerCode, sku, locationId));
      if (lido.rows.length > 1) {
        recusa("failed-precondition", `Mais de um saldo existe para SKU ${sku} no local ${locationId}.`, "BOX_RECOUNT_DUPLICATED_BALANCE", { sku_code: sku });
      }
      saldos.set(sku, lido);
      return lido;
    };

    const planos: PlanoDoItem[] = [];
    for (const linha of lines) {
      const qtyEsperada = esperado.get(linha.sku_code) ?? 0;
      const diferenca = linha.counted_qty - qtyEsperada;
      planos.push({
        sku: linha.sku_code,
        foraDaLista: false,
        esperado: qtyEsperada,
        contado: linha.counted_qty,
        diferenca,
        ajusteNaCaixa: ajusteParaOContado(entrada, retirado, ajustes, linha.sku_code, linha.counted_qty),
        movidas: [],
        origens: [],
        doSolto: 0,
        naPrateleira: diferenca,
        nome: nomes.get(linha.sku_code) ?? {},
      });
    }
    for (const linha of extra) {
      const sku = linha.sku_code;
      let falta = linha.counted_qty;
      const origens: OrigemDaPeca[] = [];
      // (a) O saldo do item na prateleira que nenhuma caixa guardada cobre: a peça é dele, e a prateleira não muda.
      const lido = await lerOSaldo(sku);
      const cobertas = caixasComOItem(prateleiraDoItem(guardadas, sku), new Map(), sku).reduce((soma, caixa) => soma + caixa.disponivel, 0);
      const solto = Math.max(0, number(lido.rows[0]?.data.qty_on_hand) - cobertas);
      const doSolto = Math.min(falta, solto);
      if (doSolto > 0) {
        origens.push({ kind: "loose", qty: doSolto });
        falta -= doSolto;
      }
      // (b) As outras caixas da prateleira, da mais antiga para a mais nova: a prateleira não muda.
      const prateleira = prateleiraDoItem(cedem, sku);
      const movidas: Array<{ box_code: string; qty: number }> = [];
      for (const candidata of ordemDeSaida(caixasComOItem(prateleira, new Map(), sku))) {
        if (falta <= 0) break;
        const qty = Math.min(falta, candidata.disponivel);
        if (qty <= 0) continue;
        movidas.push({ box_code: candidata.code, qty });
        origens.push({ kind: "box", box_code: candidata.code, qty });
        falta -= qty;
        const fonte = movidasDe.get(candidata.code) ?? { row: prateleira.porCodigo.get(candidata.code)!, entradas: [] };
        fonte.entradas.push(clean({ recount_id: recountId, sku_code: sku, qty: -qty, moved_to: boxCode, at: occurredAt, round_id: roundId }));
        movidasDe.set(candidata.code, fonte);
      }
      // (c) Só o resto entra na prateleira.
      if (falta > 0) origens.push({ kind: "entry", qty: falta });
      planos.push({
        sku,
        foraDaLista: true,
        esperado: 0,
        contado: linha.counted_qty,
        diferenca: linha.counted_qty,
        ajusteNaCaixa: ajusteParaOContado(entrada, retirado, ajustes, sku, linha.counted_qty),
        movidas,
        origens,
        doSolto,
        naPrateleira: falta,
        nome: nomes.get(sku) ?? {},
      });
    }

    // O saldo da prateleira de cada item contado, e as travas da reserva e da separação.
    for (const plano of planos) {
      const lido = await lerOSaldo(plano.sku);
      const saldo = lido.rows[0]?.data ?? {};
      const antes = number(saldo.qty_on_hand);
      const reservado = number(saldo.qty_reserved);
      const nome = nomeDoItem(Object.keys(plano.nome).length ? plano.nome : nomeDe(saldo), plano.sku);
      if (reservado > 0) await conferirSeparacao(transaction, db, customerCode, plano.sku, locationId, nome);
      if (!plano.naPrateleira) continue;
      const depois = antes + plano.naPrateleira;
      if (depois < 0) {
        recusa(
          "failed-precondition",
          `A prateleira ${locationId} tem ${unidades.format(antes)} un. de ${nome} no saldo, e a caixa ${boxCode} esperava ${unidades.format(plano.esperado)}: as caixas dizem mais do que a prateleira. A prateleira precisa do acerto antes da recontagem: veja a diferença no relatório "Caixas × saldo", na Contagem.`,
          "BOX_RECOUNT_SHELF_SHORT",
          { sku_code: plano.sku, shelf_qty: antes, box_expected: plano.esperado },
        );
      }
      if (depois < reservado) {
        recusa(
          "failed-precondition",
          `Com esta contagem, a prateleira ${locationId} ficaria com ${unidades.format(depois)} un. de ${nome}, menos que a reserva ativa (${unidades.format(reservado)}). Resolva as reservas antes de recontar a caixa.`,
          "BOX_RECOUNT_BELOW_RESERVED",
          { sku_code: plano.sku, qty_after: depois, qty_reserved: reservado },
        );
      }
    }

    // Os documentos do catálogo dos itens que mudam a prateleira (os agregados do estoque).
    const alvos = new Map<string, CatalogAggregateTarget>();
    for (const plano of planos) {
      if (!plano.naPrateleira) continue;
      const cadastro = cadastros.get(plano.sku);
      if (cadastro) {
        alvos.set(plano.sku, cadastro.alvo);
        continue;
      }
      const saldo = saldos.get(plano.sku)?.rows[0]?.data ?? {};
      alvos.set(plano.sku, await resolveCatalogAggregateTargets(transaction, db, plano.sku, text(plano.nome.client_item_code || saldo.client_item_code) || undefined));
    }

    // ------------------------------------------------------------ escritas
    // O dia que o FIFO dá ao conteúdo da caixa: o da sessão na caixa da abertura (datas-do-saldo.ts), o da guarda nas outras.
    const diaDaCaixa = diaDeSaoPaulo(text(box.stored_at));
    const origemDaCaixa = box.origin && typeof box.origin === "object" ? (box.origin as Data) : {};
    const sessaoDaCaixa = text(origemDaCaixa.kind) === "opening_inventory" ? text(origemDaCaixa.session_id) : "";
    const by = actorFields(actor);
    const cycleCountIds: string[] = [];
    const movementIds: string[] = [];
    const itens: Data[] = [];
    for (const plano of planos) {
      const lido = saldos.get(plano.sku)!;
      const row = lido.rows[0];
      const saldo = row?.data ?? {};
      const nome = Object.keys(plano.nome).length ? plano.nome : nomeDe(saldo);
      const antes = number(saldo.qty_on_hand);
      const reservado = number(saldo.qty_reserved);
      const depois = antes + plano.naPrateleira;
      const cycleCountId = `cc_${digest({ operationId, customerCode, skuCode: plano.sku, locationId, boxCode })}`;
      cycleCountIds.push(cycleCountId);
      let movimento: string | undefined;
      if (plano.naPrateleira) {
        const balanceId = row?.id ?? `bal_${digest({ customerCode, skuCode: plano.sku, locationId }, 48)}`;
        const balanceRef = row?.ref ?? db.collection(STOCK_BALANCES_COLLECTION).doc(balanceId);
        const balancePayload: Data = clean({
          customer_code: customerCode,
          sku_code: plano.sku,
          client_item_code: text(saldo.client_item_code) || nome.client_item_code,
          product_name: text(saldo.product_name) || nome.product_name || plano.sku,
          size: text(saldo.size) || nome.size,
          location_id: locationId,
          qty_on_hand: depois,
          qty_reserved: reservado,
          qty_available: depois - reservado,
          status: depois > 0 ? "available" : "empty",
          source: BOX_RECOUNT_SOURCE,
          last_cycle_count_id: cycleCountId,
          last_cycle_count_at: occurredAt,
          updated_at: FieldValue.serverTimestamp(),
        });
        if (row) {
          transaction.update(balanceRef, { ...balancePayload, ...publishedMoneyDeletes() });
        } else {
          transaction.set(balanceRef, { id: balanceId, ...balancePayload, created_at: FieldValue.serverTimestamp() });
        }
        movimento = movementId(operationId, `box_recount_${plano.sku}`);
        movementIds.push(movimento);
        const tipo = plano.naPrateleira > 0 ? "ENTRADA" : "SAIDA";
        createMovement(
          transaction,
          db,
          movimento,
          {
            type: tipo,
            quantity: Math.abs(plano.naPrateleira),
            customerCode,
            skuCode: plano.sku,
            clientItemCode: text(balancePayload.client_item_code) || undefined,
            productName: text(balancePayload.product_name) || undefined,
            locationId,
            beforeQty: antes,
            afterQty: depois,
            source: BOX_RECOUNT_SOURCE,
            occurredAt,
            entity: clean({
              reason,
              reference,
              box_code: boxCode,
              cycle_count_id: cycleCountId,
              box_recount_id: recountId,
              round_id: roundId,
              movement_kind: plano.foraDaLista ? "box_recount_out_of_list" : "box_recount",
              // A peça achada a mais vale no FIFO o dia do conteúdo da caixa (datas-do-saldo.ts).
              fifo_day: tipo === "ENTRADA" ? diaDaCaixa ?? undefined : undefined,
              fifo_opening_session_id: tipo === "ENTRADA" && sessaoDaCaixa ? sessaoDaCaixa : undefined,
              operational_operation_id: operationId,
            }),
          },
          actor,
        );
        updateClientInventory(transaction, db, {
          customerCode,
          skuCode: plano.sku,
          clientItemCode: text(balancePayload.client_item_code) || undefined,
          productName: text(balancePayload.product_name) || undefined,
          size: text(balancePayload.size) || undefined,
          onHandDelta: plano.naPrateleira,
          split: clientSplit(balancesAfter(lido.todos, [{ ref: balanceRef, data: balancePayload }])),
        });
        applyCatalogStockAggregates(transaction, alvos.get(plano.sku) ?? {}, { onHand: plano.naPrateleira });
      }
      transaction.create(
        db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId),
        clean({
          id: cycleCountId,
          customer_code: customerCode,
          sku_code: plano.sku,
          client_item_code: nome.client_item_code,
          product_name: nome.product_name,
          size: nome.size,
          location_id: locationId,
          box_code: boxCode,
          mode: "box",
          box_recount_id: recountId,
          round_id: roundId,
          out_of_list: plano.foraDaLista || undefined,
          // Na caixa: o esperado, o contado e a diferença.
          qty_before: plano.esperado,
          counted_qty: plano.contado,
          adjustment_delta: plano.diferenca,
          adjustment_qty: Math.abs(plano.diferenca),
          adjustment_type: plano.diferenca === 0 ? "SEM_DIVERGENCIA" : plano.diferenca > 0 ? "ENTRADA" : "SAIDA",
          // Na prateleira: o saldo antes e depois, e de onde veio cada peça do fora da lista.
          shelf_qty_before: antes,
          shelf_qty_after: depois,
          shelf_delta: plano.naPrateleira,
          qty_reserved: reservado,
          origins: plano.origens.length ? plano.origens : undefined,
          reason,
          reference,
          movement_id: movimento,
          status: "completed",
          source: BOX_RECOUNT_SOURCE,
          actor: by,
          occurred_at: occurredAt,
          created_at: FieldValue.serverTimestamp(),
        }),
      );
      itens.push(
        clean({
          sku_code: plano.sku,
          client_item_code: nome.client_item_code,
          product_name: nome.product_name,
          size: nome.size,
          out_of_list: plano.foraDaLista || undefined,
          expected: plano.esperado,
          counted: plano.contado,
          difference: plano.diferenca,
          shelf_delta: plano.naPrateleira,
          // De onde veio cada peça do fora da lista: o saldo solto, as caixas, a entrada nova.
          origins: plano.origens.length ? plano.origens : undefined,
          cycle_count_id: cycleCountId,
          movement_id: movimento,
        }),
      );
    }

    // O cadastro arquivado do item fora da lista volta a ativo, como na abertura.
    const reativados: string[] = [];
    for (const [sku, cadastro] of cadastros) {
      if (isArchivedCatalogRecord(cadastro.sku)) {
        transaction.update(cadastro.skuRef, { archived: false, status: "active", reactivated_by_recount_id: recountId, updated_by: by, updated_at: FieldValue.serverTimestamp() });
        reativados.push(sku);
      }
      if (cadastro.productRef && isArchivedCatalogRecord(cadastro.product)) {
        transaction.update(cadastro.productRef, { archived: false, status: "active", reactivated_by_recount_id: recountId, updated_by: by, updated_at: FieldValue.serverTimestamp() });
      }
    }

    // A caixa: os ajustes ficam ao lado da entrada e do retirado, com o id da contagem.
    const novosAjustes = planos
      .filter((plano) => plano.ajusteNaCaixa !== 0)
      .map((plano) =>
        clean({
          recount_id: recountId,
          sku_code: plano.sku,
          qty: plano.ajusteNaCaixa,
          at: occurredAt,
          round_id: roundId,
          // O item fora da lista leva o nome: a etiqueta e o Mapa não o acham na entrada da caixa.
          ...(plano.foraDaLista ? plano.nome : {}),
          from_loose: plano.doSolto || undefined,
          moved_from: plano.movidas.length ? plano.movidas : undefined,
        }),
      );
    const contadas = planos.reduce((soma, plano) => soma + plano.contado, 0);
    const esperadas = planos.reduce((soma, plano) => soma + plano.esperado, 0);
    const vazia = contadas === 0;
    const anterior = text(box.last_recount_id)
      ? clean({ recount_id: text(box.last_recount_id), at: text(box.last_recounted_at) || undefined, by_name: text((box.last_recounted_by as Data | undefined)?.name) || undefined })
      : undefined;
    const naCaixa: Data = {
      last_recount_id: recountId,
      last_recounted_at: occurredAt,
      last_recounted_by: by,
      last_recount_round_id: roundId ?? FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (novosAjustes.length) Object.assign(naCaixa, { count_adjustments: [...ajustesGravados(box), ...novosAjustes], balance_at: occurredAt });
    if (extra.length) naCaixa.sku_codes = FieldValue.arrayUnion(...extra.map((linha) => linha.sku_code));
    if (vazia) {
      // A caixa vazia sai da prateleira, como a que a separação esvazia: fica o registro de quando e de qual contagem.
      Object.assign(naCaixa, { status: BOX_STATUS_EMPTIED, emptied_at: occurredAt, emptied_by: by, emptied_whole: false, emptied_recount_id: recountId });
    }
    transaction.update(boxRef, naCaixa);
    for (const [, fonte] of movidasDe) {
      transaction.update(fonte.row.ref, {
        count_adjustments: [...ajustesGravados(fonte.row.data), ...fonte.entradas],
        balance_at: occurredAt,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    // O evento da caixa recontada: a caixa e a prateleira só no payload (o cliente nunca vê caixa nem prateleira).
    const diferenca = planos.reduce((soma, plano) => soma + plano.diferenca, 0);
    const naPrateleira = planos.reduce((soma, plano) => soma + plano.naPrateleira, 0);
    const comDiferenca = planos.some((plano) => plano.diferenca !== 0);
    const events: OperationalEventSummary[] = [
      createEvent(
        transaction,
        db,
        `evt_${digest({ operationId, suffix: "box_recounted" })}`,
        {
          type: BOX_RECOUNT_EVENT_TYPE,
          title: comDiferenca ? "Caixa recontada com diferença" : "Caixa recontada sem diferença",
          description: [
            `${planos.length} ${planos.length === 1 ? "item contado" : "itens contados"}`,
            `${unidades.format(contadas)} un.`,
            comDiferenca ? `diferença ${comSinal(diferenca)} un.` : "",
            extra.length ? `${extra.length} fora da lista` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          severity: comDiferenca ? "attention" : "info",
          entity_type: "box_recount",
          entity_id: recountId,
          customer_code: customerCode,
          occurred_at: occurredAt,
          source: EVENT_SOURCE,
          payload: {
            box_recount_id: recountId,
            round_id: roundId,
            box_code: boxCode,
            location_id: locationId,
            reason,
            reference,
            expected_units: esperadas,
            counted_units: contadas,
            difference_units: diferenca,
            shelf_delta_units: naPrateleira,
            emptied: vazia || undefined,
            items: itens,
            reactivated_skus: reativados.length ? reativados : undefined,
            cycle_count_ids: cycleCountIds,
            movement_ids: movementIds.length ? movementIds : undefined,
          },
        },
        actor,
      ),
    ];
    if (vazia) {
      events.push(
        createEvent(
          transaction,
          db,
          `evt_${digest({ operationId, suffix: "box_emptied", box: boxCode })}`,
          {
            type: "warehouse.box_emptied",
            title: `Caixa ${boxCode} vazia`,
            description: `${boxCode} · ${locationId} · recontagem`,
            severity: "info",
            inbox: false,
            entity_type: WAREHOUSE_BOXES_COLLECTION,
            entity_id: boxCode,
            customer_code: customerCode,
            occurred_at: occurredAt,
            source: EVENT_SOURCE,
            payload: clean({ box_code: boxCode, location_id: locationId, box_recount_id: recountId, round_id: roundId }),
          },
          actor,
        ),
      );
    }

    const result = clean({
      ok: true,
      box_recount_id: recountId,
      box_code: boxCode,
      location_id: locationId,
      round_id: roundId,
      status: vazia ? BOX_STATUS_EMPTIED : BOX_STATUS_STORED,
      expected_units: esperadas,
      counted_units: contadas,
      difference_units: diferenca,
      shelf_delta_units: naPrateleira,
      emptied: vazia,
      lines: itens,
      reactivated_skus: reativados.length ? reativados : undefined,
      // A contagem anterior desta caixa: a tela avisa quando outra pessoa acabou de contá-la.
      previous_recount: anterior,
      cycle_count_ids: cycleCountIds,
      movement_ids: movementIds,
      events,
    });
    transaction.create(opRef, {
      id: opRef.id,
      kind: "inventory.box_recount",
      target_id: boxCode,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: by,
      result: semIndefinidos(result),
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}
