import { createHash } from "node:crypto";

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { recordOwner } from "./customer-scope.js";
import { nomeComTamanho } from "./nome-do-produto.js";
import { createEvent, readRows, resolveCatalogAggregateTargets, type OperationalActor, type OperationalEventSummary } from "./operations.js";
import { WAREHOUSE_POSITIONS_COLLECTION } from "./warehouse-positions.js";

/**
 * A rodada da contagem (docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md;
 * diagnóstico da Contagem cíclica, seção 6, item 4, e as decisões de 17 e
 * 18/11/2026): a coleção `count_rounds`, uma rodada por documento, com o
 * cliente, o título, o alcance (geral, por rua ou por item), quem e quando
 * iniciou e concluiu e os números do fechamento. O id do documento é o
 * `round_id` que as recontagens por caixa gravam (box-recount.ts).
 *
 * A recontagem geral de 17/11/2026 nasceu antes da coleção, com o id fixo
 * `recontagem-geral-2026-11-17`: enquanto o documento dela não existe, as
 * recontagens com esse id valem como a rodada aberta, e "Concluir contagem"
 * cria o documento já concluído (completeCountRoundTransaction).
 */

export const COUNT_ROUNDS_COLLECTION = "count_rounds";
/** O id fixo da recontagem geral das caixas da BTG (decisão de 17/11/2026, PR 625). */
export const LEGACY_ROUND_ID = "recontagem-geral-2026-11-17";
export const LEGACY_ROUND_TITLE = "Recontagem geral · 17/11/2026";
export const ROUND_STARTED_EVENT_TYPE = "inventory.round_started";
export const ROUND_CLOSED_EVENT_TYPE = "inventory.round_closed";

const OPERATIONS_COLLECTION = "operational_operations";
const CYCLE_COUNTS_COLLECTION = "cycle_counts";
const EVENT_SOURCE = "functions_wms";

export type EscopoDaRodada = "general" | "aisle" | "item";

/** O alcance da rodada: toda prateleira com caixa, as de uma rua ou as com caixa que tem o item. */
export type AlcanceDaRodada = { scope: "general" } | { scope: "aisle"; aisle: string } | { scope: "item"; sku_code: string };

export type NomeDoItem = { client_item_code?: string; product_name?: string; size?: string };

const CONTAGEM_INVALIDA = "Contagem inválida: confira o alcance e tente de novo.";

const Sku = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.toUpperCase());

export const StartCountRoundSchema = z
  .object({
    customer_code: z.string().trim().min(1).max(160),
    scope: z.enum(["general", "aisle", "item"]),
    /** A rua, no alcance por rua: "A". */
    aisle: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{1,4}$/)
      .optional(),
    /** O item, no alcance por item. */
    sku_code: Sku.optional(),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.scope === "aisle") !== Boolean(input.aisle)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aisle"], message: CONTAGEM_INVALIDA });
    if ((input.scope === "item") !== Boolean(input.sku_code)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sku_code"], message: CONTAGEM_INVALIDA });
  });

export type EntradaDoInicio = z.output<typeof StartCountRoundSchema>;

export const CompleteCountRoundSchema = z
  .object({
    customer_code: z.string().trim().min(1).max(160),
    round_id: z.string().trim().min(1).max(200),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict();

export type EntradaDaConclusao = z.output<typeof CompleteCountRoundSchema>;

function entradaValida<T>(parsed: z.SafeParseReturnType<unknown, T>): T {
  if (parsed.success) return parsed.data;
  // Fora do formato, a frase para quem opera; o ZodError cru viraria INTERNAL.
  throw new HttpsError("invalid-argument", CONTAGEM_INVALIDA, { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
}

export function entradaDoInicio(raw: unknown): EntradaDoInicio {
  return entradaValida(StartCountRoundSchema.safeParse(raw ?? {}));
}

export function entradaDaConclusao(raw: unknown): EntradaDaConclusao {
  return entradaValida(CompleteCountRoundSchema.safeParse(raw ?? {}));
}

/** O alcance da entrada de iniciar. */
export function alcanceDaEntrada(input: Pick<EntradaDoInicio, "scope" | "aisle" | "sku_code">): AlcanceDaRodada {
  if (input.scope === "aisle") return { scope: "aisle", aisle: input.aisle ?? "" };
  if (input.scope === "item") return { scope: "item", sku_code: input.sku_code ?? "" };
  return { scope: "general" };
}

// ------------------------------------------------------------------ o título

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/** "Contagem geral · 19/11/2026", "Contagem da rua A · 19/11/2026", "Contagem de Polo Masculino Piquet Preto · P · 19/11/2026". */
export function tituloDaRodada(alcance: AlcanceDaRodada, item: NomeDoItem | undefined, iniciadaEm: string): string {
  const dia = DIA_EM_SAO_PAULO.format(new Date(iniciadaEm));
  if (alcance.scope === "aisle") return `Contagem da rua ${alcance.aisle} · ${dia}`;
  if (alcance.scope === "item") {
    const nome = item?.product_name ? nomeComTamanho({ nome: item.product_name, codigo: item.client_item_code, tamanho: item.size }) : "";
    return `Contagem de ${nome || alcance.sku_code} · ${dia}`;
  }
  return `Contagem geral · ${dia}`;
}

// ----------------------------------------------------------------- o alcance

function chave(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** A rua de uma posição: o que vem antes do hífen ("A-03" → "A"); sem hífen, "". */
export function ruaDaPosicao(locationId: string): string {
  const [rua, resto] = chave(locationId).split("-");
  return resto !== undefined && rua ? rua : "";
}

/** Uma caixa do cliente, no que a rodada confere: guardada, ou esvaziada por esta rodada. */
export type CaixaDaRodada = { code: string; status: string; location_id: string; sku_codes: string[]; last_recount_round_id: string | null };

/** A caixa que conta na rodada: a guardada e a que a própria rodada esvaziou. */
function contaNaRodada(caixa: CaixaDaRodada, roundId: string): boolean {
  return caixa.status === "stored" || (caixa.status === "emptied" && Boolean(roundId) && caixa.last_recount_round_id === roundId);
}

/**
 * A prateleira está no alcance da rodada: tem caixa que conta e, por rua, é
 * da rua; por item, alguma dessas caixas tem o item. `caixas` pode ser a
 * lista inteira do cliente: a função separa as da prateleira.
 */
export function prateleiraNoAlcance(alcance: AlcanceDaRodada, locationId: string, caixas: readonly CaixaDaRodada[], roundId: string): boolean {
  const alvo = chave(locationId);
  const daPrateleira = caixas.filter((caixa) => chave(caixa.location_id) === alvo && contaNaRodada(caixa, roundId));
  if (!daPrateleira.length) return false;
  if (alcance.scope === "aisle") return ruaDaPosicao(alvo) === chave(alcance.aisle);
  if (alcance.scope === "item") {
    const sku = chave(alcance.sku_code);
    return daPrateleira.some((caixa) => caixa.sku_codes.some((code) => chave(code) === sku));
  }
  return true;
}

// ---------------------------------------------------------------- os números

/** Uma linha de `cycle_counts` da recontagem por caixa (`mode: "box"`), no que o fechamento conta. */
export type LinhaDaRodada = {
  box_recount_id: string;
  box_code: string;
  location_id: string;
  occurred_at: string;
  adjustment_delta: number;
  round_id: string;
  actor?: { uid?: string; role?: string; email?: string; name?: string };
};

export type NumerosDaRodada = {
  /** As prateleiras do alcance com caixa, e as com todas as caixas confirmadas. */
  shelves_total: number;
  shelves_counted: number;
  /** As caixas dessas prateleiras, e as confirmadas (a última recontagem de cada uma, na própria prateleira). */
  boxes_total: number;
  boxes_counted: number;
  /** As confirmadas com diferença em algum item. */
  boxes_with_difference: number;
  /** A soma das diferenças das últimas recontagens. */
  difference_units: number;
  /** As recontagens gravadas na rodada. */
  recount_count: number;
};

type Recontagem = { id: string; box: string; location: string; at: string; deltas: number[] };

/**
 * Os números do fechamento, a mesma conta da tela (recontagem-por-caixa.ts,
 * rodadaDaContagem): a última recontagem de cada caixa vale; a prateleira
 * está contada com todas as caixas confirmadas; a caixa tem diferença pelos
 * itens (M −2 e GG +2 somam zero e mudam a caixa). `primeira` é a linha mais
 * antiga da rodada: o começo da recontagem geral sem documento.
 */
export function numerosDaRodada(linhas: readonly LinhaDaRodada[], caixas: readonly CaixaDaRodada[], alcance: AlcanceDaRodada, roundId: string): NumerosDaRodada & { primeira: LinhaDaRodada | null } {
  const porLocal = new Map<string, CaixaDaRodada[]>();
  for (const caixa of caixas) {
    if (!contaNaRodada(caixa, roundId)) continue;
    const local = chave(caixa.location_id);
    if (local) porLocal.set(local, [...(porLocal.get(local) ?? []), caixa]);
  }
  const prateleiras = [...porLocal].filter(([local, daPrateleira]) => prateleiraNoAlcance(alcance, local, daPrateleira, roundId));

  const recontagens = new Map<string, Recontagem>();
  let primeira: LinhaDaRodada | null = null;
  for (const linha of linhas) {
    if (linha.round_id !== roundId) continue;
    if (!primeira || linha.occurred_at < primeira.occurred_at) primeira = linha;
    const atual = recontagens.get(linha.box_recount_id);
    if (atual) {
      atual.deltas.push(linha.adjustment_delta);
      if (linha.occurred_at > atual.at) atual.at = linha.occurred_at;
    } else {
      recontagens.set(linha.box_recount_id, { id: linha.box_recount_id, box: chave(linha.box_code), location: chave(linha.location_id), at: linha.occurred_at, deltas: [linha.adjustment_delta] });
    }
  }
  const ultima = new Map<string, Recontagem>();
  for (const recontagem of recontagens.values()) {
    const atual = ultima.get(recontagem.box);
    if (!atual || recontagem.at > atual.at || (recontagem.at === atual.at && recontagem.id > atual.id)) ultima.set(recontagem.box, recontagem);
  }

  const numeros: NumerosDaRodada = { shelves_total: prateleiras.length, shelves_counted: 0, boxes_total: 0, boxes_counted: 0, boxes_with_difference: 0, difference_units: 0, recount_count: recontagens.size };
  for (const [local, daPrateleira] of prateleiras) {
    const confirmadas = daPrateleira.flatMap((caixa) => {
      const recontagem = ultima.get(chave(caixa.code));
      return recontagem && recontagem.location === local ? [recontagem] : [];
    });
    numeros.boxes_total += daPrateleira.length;
    numeros.boxes_counted += confirmadas.length;
    if (confirmadas.length >= daPrateleira.length) numeros.shelves_counted += 1;
    for (const recontagem of confirmadas) {
      if (recontagem.deltas.some((delta) => delta !== 0)) numeros.boxes_with_difference += 1;
      numeros.difference_units += recontagem.deltas.reduce((soma, delta) => soma + delta, 0);
    }
  }
  return { ...numeros, primeira };
}

// ------------------------------------------------------------------- apoio

type Data = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
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

function recusa(code: "failed-precondition" | "not-found" | "permission-denied", message: string, detail: string, extra: Data = {}): never {
  throw new HttpsError(code, message, { code: detail, ...extra });
}

/** O item do alcance por item: tem de existir e ser do cliente; o nome vai ao título e ao documento. */
async function lerItem(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string): Promise<NomeDoItem> {
  const alvo = await resolveCatalogAggregateTargets(transaction, db, skuCode);
  const snapshot = alvo.skuRef ? await transaction.get(alvo.skuRef) : undefined;
  if (!alvo.skuRef || !snapshot?.exists) {
    recusa("failed-precondition", `O produto ${skuCode} não está no cadastro de ${customerCode}: confira o código.`, "COUNT_ROUND_PRODUCT_NOT_FOUND", { sku_code: skuCode });
  }
  const sku = snapshot.data() ?? {};
  if (recordOwner(sku) !== customerCode) {
    recusa("failed-precondition", `O produto ${skuCode} é do cadastro de ${recordOwner(sku)}, não de ${customerCode}: confira o cliente ativo.`, "CATALOG_OWNED_BY_OTHER_CUSTOMER", { owner: recordOwner(sku) });
  }
  return clean({
    client_item_code: text(sku.cod_cliente || sku.client_item_code) || undefined,
    product_name: text(sku.produto || sku.product_name) || undefined,
    size: text(sku.tamanho || sku.size) || undefined,
  });
}

// ------------------------------------------------------------------ iniciar

export type ResultadoDoInicio = {
  ok: true;
  round_id: string;
  title: string;
  scope: EscopoDaRodada;
  aisle?: string;
  sku_code?: string;
  status: "open";
  started_at: string;
  events: OperationalEventSummary[];
};

/**
 * Inicia a rodada do cliente: uma aberta por cliente de cada vez (a
 * recontagem geral de 17/11 sem documento conta como aberta), com o alvo do
 * alcance conferido (a rua em Posições, o item no cadastro do cliente), o
 * título do servidor, o recibo e o evento. Não é escrita de saldo: não
 * confere o congelamento do estoque.
 */
export async function startCountRoundTransaction(db: Firestore, input: EntradaDoInicio, actor: OperationalActor): Promise<ResultadoDoInicio> {
  const customerCode = text(input.customer_code);
  const alcance = alcanceDaEntrada(input);
  const operationId = `op_count_round_start_${digest({ customer: customerCode, nonce: input.idempotency_key })}`;
  const inputHash = digest(input, 64);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(operationId);
  const roundId = `cr_${digest({ customer: customerCode, nonce: input.idempotency_key }, 24)}`;
  const roundRef = db.collection(COUNT_ROUNDS_COLLECTION).doc(roundId);
  const by = actorFields(actor);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as ResultadoDoInicio;
    }
    const startedAt = new Date().toISOString();

    const abertas = await readRows(transaction, db.collection(COUNT_ROUNDS_COLLECTION).where("customer_code", "==", customerCode).where("status", "==", "open"));
    if (abertas.length) {
      const aberta = abertas[0]!;
      recusa("failed-precondition", `A contagem «${text(aberta.data.title)}» está em andamento: conclua-a antes de iniciar outra.`, "COUNT_ROUND_ALREADY_OPEN", { round_id: aberta.id });
    }
    // A recontagem geral de 17/11 sem documento: as recontagens com o id fixo valem como a rodada aberta.
    const legada = await transaction.get(db.collection(COUNT_ROUNDS_COLLECTION).doc(LEGACY_ROUND_ID));
    if (!legada.exists) {
      const recontagens = await readRows(transaction, db.collection(CYCLE_COUNTS_COLLECTION).where("customer_code", "==", customerCode).where("round_id", "==", LEGACY_ROUND_ID).limit(1));
      if (recontagens.length) {
        recusa("failed-precondition", `A ${LEGACY_ROUND_TITLE} está em andamento: conclua-a antes de iniciar outra.`, "COUNT_ROUND_LEGACY_OPEN", { round_id: LEGACY_ROUND_ID });
      }
    }
    let item: NomeDoItem | undefined;
    if (alcance.scope === "aisle") {
      const posicoes = await readRows(transaction, db.collection(WAREHOUSE_POSITIONS_COLLECTION).where("aisle", "==", alcance.aisle).limit(1));
      if (!posicoes.length) recusa("failed-precondition", `A rua ${alcance.aisle} não está no cadastro de Posições.`, "COUNT_ROUND_AISLE_NOT_FOUND", { aisle: alcance.aisle });
    }
    if (alcance.scope === "item") item = await lerItem(transaction, db, customerCode, alcance.sku_code);
    const title = tituloDaRodada(alcance, item, startedAt);
    const aisle = alcance.scope === "aisle" ? alcance.aisle : undefined;
    const skuCode = alcance.scope === "item" ? alcance.sku_code : undefined;

    transaction.create(
      roundRef,
      clean({
        id: roundId,
        customer_code: customerCode,
        title,
        scope: alcance.scope,
        aisle,
        sku_code: skuCode,
        item: item && Object.keys(item).length ? item : undefined,
        status: "open",
        started_at: startedAt,
        started_by: by,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    const events: OperationalEventSummary[] = [
      createEvent(
        transaction,
        db,
        `evt_${digest({ operationId, suffix: "round_started" })}`,
        {
          type: ROUND_STARTED_EVENT_TYPE,
          title: "Contagem iniciada",
          description: title,
          severity: "info",
          inbox: false,
          entity_type: "count_round",
          entity_id: roundId,
          customer_code: customerCode,
          occurred_at: startedAt,
          source: EVENT_SOURCE,
          payload: clean({ round_id: roundId, title, scope: alcance.scope, aisle, sku_code: skuCode }),
        },
        actor,
      ),
    ];
    const result = clean({ ok: true as const, round_id: roundId, title, scope: alcance.scope, aisle, sku_code: skuCode, status: "open" as const, started_at: startedAt, events });
    transaction.create(opRef, {
      id: opRef.id,
      kind: "inventory.count_round.start",
      target_id: roundId,
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
