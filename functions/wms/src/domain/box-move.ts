import { createHash } from "node:crypto";

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { areaDePassagem } from "./areas-de-passagem.js";
import { BOX_STATUS_STORED, ajustesDaCaixa, retiradoDaCaixa } from "./box-balance.js";
import { entradaDaCaixa, nomeDe, nomeDoItem, type NomeDoItem } from "./box-recount.js";
import { publishedMoneyDeletes } from "./catalog-prices.js";
import { caixaDaRodada, lerRodadaAberta, prateleiraNoAlcance, type CaixaDaRodada, type RodadaLida } from "./count-rounds.js";
import { diaDeSaoPaulo } from "./datas-do-saldo.js";
import {
  assertInventoryOperationsEnabled,
  createEvent,
  createMovement,
  movementId,
  readRows,
  skuBalancesQuery,
  type OperationalActor,
  type OperationalEventSummary,
  type Row,
} from "./operations.js";
import { saldoDaCaixa, type LinhaDaCaixa } from "./saldo-da-caixa.js";
import {
  WAREHOUSE_BOXES_COLLECTION,
  asPosition,
  buildOccupancy,
  destinosDoMover,
  emptyOccupancy,
  openingSessionDocId,
  placementFor,
  requireDimensions,
  type BoxDimensions,
  type DestinoDoMover,
} from "./warehouse-boxes.js";
import { WAREHOUSE_POSITIONS_COLLECTION } from "./warehouse-positions.js";

/**
 * Mover caixa entre prateleiras (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * decisões do Leonardo em 19/11/2026; mockup em docs/mockups/mover-caixa/).
 * Uma caixa por vez, de uma prateleira para outra da zona do cliente: a
 * coordenação e quem opera (owner, admin, interno e wms). O sistema sugere o
 * destino (o mesmo produto, depois a mais vazia: destinosDoMover, em
 * warehouse-boxes.ts) e a pessoa pode trocar à mão.
 *
 * Aqui ficam a entrada das callables, as frases das recusas e a contagem
 * aberta; a prévia e o mover, que leem e gravam, ficam abaixo delas.
 */

/** A origem do movimento do mover: fora da cobrança (billing-scope.ts) e do relógio dos parados. */
export const BOX_MOVE_SOURCE = "functions_box_move";
export const BOX_MOVED_EVENT_TYPE = "warehouse.box_moved";
/** O motivo gravado nos dois movimentos do mover. */
export const MOTIVO_DO_MOVER = "Mudança de prateleira";

const ENTRADA_INVALIDA = "Caixa inválida: confira o código e tente de novo.";

// ---------------------------------------------------------------- entrada

const CodigoDaCaixa = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CX-\d{6,}$/);
const Prateleira = z.string().trim().min(1).max(40);
const Cliente = z.string().trim().min(1).max(160);

export const PreviewBoxMoveSchema = z.object({ customer_code: Cliente, box_code: CodigoDaCaixa }).strict();

export const MoveWarehouseBoxSchema = z
  .object({
    customer_code: Cliente,
    box_code: CodigoDaCaixa,
    /** A prateleira em que a tela viu a caixa: a que mudou desde então recusa. */
    from_location_id: Prateleira,
    to_location_id: Prateleira,
    /** A sugestão que a tela mostrou: o evento diz se a pessoa a seguiu. */
    suggestion: z.object({ position: Prateleira, alternatives: z.array(Prateleira).max(5) }).strict().optional(),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict();

export type EntradaDaPreviaDoMover = z.output<typeof PreviewBoxMoveSchema>;
export type EntradaDoMover = z.output<typeof MoveWarehouseBoxSchema>;

function entradaValida<T>(parsed: z.SafeParseReturnType<unknown, T>): T {
  if (parsed.success) return parsed.data;
  // Fora do formato, a frase para quem opera; o ZodError cru viraria INTERNAL.
  throw new HttpsError("invalid-argument", ENTRADA_INVALIDA, { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
}

export function entradaDaPreviaDoMover(raw: unknown): EntradaDaPreviaDoMover {
  return entradaValida(PreviewBoxMoveSchema.safeParse(raw ?? {}));
}

export function entradaDoMover(raw: unknown): EntradaDoMover {
  return entradaValida(MoveWarehouseBoxSchema.safeParse(raw ?? {}));
}

// ---------------------------------------------------------------- recusas

/** Uma recusa do mover: o código (em `details.code`), a frase para quem opera e o tipo do erro. */
export type RecusaDoMover = {
  code: string;
  message: string;
  status: "failed-precondition" | "not-found";
  extra?: Record<string, unknown>;
};

const unidades = new Intl.NumberFormat("pt-BR");

const recusa = (code: string, message: string, extra?: Record<string, unknown>, status: RecusaDoMover["status"] = "failed-precondition"): RecusaDoMover => ({
  code,
  message,
  status,
  ...(extra ? { extra } : {}),
});

/** As frases das recusas: as mesmas na prévia (o bloqueio) e no mover (o erro). */
export const RECUSAS_DO_MOVER = {
  caixaNaoExiste: (caixa: string) => recusa("BOX_MOVE_BOX_NOT_FOUND", `A caixa ${caixa} não está cadastrada. Confira o código na etiqueta da caixa.`, undefined, "not-found"),
  caixaNaoGuardada: (caixa: string) => recusa("BOX_MOVE_BOX_NOT_STORED", `A caixa ${caixa} não está guardada numa prateleira: só a caixa guardada muda de prateleira.`),
  outraPrateleira: (caixa: string, atual: string, vista: string) =>
    recusa("BOX_MOVE_WRONG_SHELF", `A caixa ${caixa} está em ${atual || "nenhuma prateleira"}, não em ${vista}: atualize a tela.`, { location_id: atual || null }),
  prateleiraNaoExiste: (prateleira: string) => recusa("BOX_MOVE_SHELF_NOT_FOUND", `A prateleira ${prateleira} não está cadastrada em Estoque › Posições.`, undefined, "not-found"),
  areaDePassagem: (area: string) => recusa("BOX_MOVE_NOT_A_SHELF", `${area} é área de passagem, não prateleira: a caixa muda só entre prateleiras.`),
  mesmaPrateleira: (caixa: string, prateleira: string) => recusa("BOX_MOVE_SAME_SHELF", `A caixa ${caixa} já está em ${prateleira}.`),
  prateleiraIndisponivel: (prateleira: string, status: string) =>
    recusa("BOX_MOVE_SHELF_UNAVAILABLE", `A prateleira ${prateleira} está ${status === "blocked" ? "bloqueada" : "em verificação"}: escolha outra.`, { status }),
  outraZona: (prateleira: string, cliente: string) => recusa("BOX_MOVE_OTHER_ZONE", `A prateleira ${prateleira} não é da zona de ${cliente}.`),
  naoCabe: (caixa: string, prateleira: string) => recusa("BOX_MOVE_DOES_NOT_FIT", `A caixa ${caixa} não cabe em ${prateleira}: escolha outra prateleira.`),
  outraEmCima: (caixa: string, deCima: string) => recusa("BOX_MOVE_SUPPORTS_ANOTHER", `A caixa ${deCima} está em cima da ${caixa}: mova a de cima primeiro.`, { box_code: deCima }),
  reservadoNaOrigem: (item: string, origem: string, pedido: string) =>
    recusa(
      "BOX_MOVE_RESERVED",
      `${item} está reservado em ${origem}${pedido ? ` para o pedido ${pedido}` : ""}: mova a caixa depois da entrega.`,
      { order_number: pedido || null },
    ),
  reservadoNoDestino: (item: string, destino: string, pedido: string) =>
    recusa(
      "BOX_MOVE_DESTINATION_RESERVED",
      `${item} está reservado em ${destino}${pedido ? ` para o pedido ${pedido}` : ""}: escolha outra prateleira ou mova depois da entrega.`,
      { order_number: pedido || null },
    ),
  naContagem: (prateleira: string, titulo: string, roundId: string) =>
    recusa("BOX_MOVE_COUNT_ROUND_OPEN", `${prateleira} está na contagem «${titulo}»: conclua a contagem antes de mover.`, { round_id: roundId }),
  aberturaAberta: (cliente: string) => recusa("BOX_MOVE_OPENING_OPEN", `A abertura de ${cliente} está em andamento: na abertura, use Corrigir caixa.`),
  prateleiraComMenos: (origem: string, naPrateleira: number, item: string, caixa: string, naCaixa: number) =>
    recusa(
      "BOX_MOVE_SHELF_SHORT",
      `A prateleira ${origem} tem ${unidades.format(naPrateleira)} un. de ${item} e a caixa ${caixa} diz ${unidades.format(naCaixa)}: a prateleira precisa do acerto antes (Caixas × saldo, na Contagem).`,
    ),
  saldoDuplicado: (sku: string, prateleira: string) => recusa("BOX_MOVE_DUPLICATED_BALANCE", `Mais de um saldo existe para ${sku} em ${prateleira}.`, { sku_code: sku }),
} as const;

/** A recusa vira o erro da callable, com o código em `details.code`. */
export function recusar(recusaDoMover: RecusaDoMover): never {
  throw new HttpsError(recusaDoMover.status, recusaDoMover.message, { code: recusaDoMover.code, ...recusaDoMover.extra });
}

// ------------------------------------------------------ a contagem aberta

function chave(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * A origem e o destino na contagem aberta: a origem como está, com a caixa
 * nela; o destino como ficaria, com a caixa. Conferir a origem depois do
 * mover deixaria, numa contagem por rua, a última caixa de uma prateleira da
 * rua sair sem ter sido contada. `caixas` traz a caixa movida.
 */
export function prateleirasNaContagem(
  rodada: Pick<RodadaLida, "id" | "alcance"> | null,
  caixas: readonly CaixaDaRodada[],
  mover: { box_code: string; origem: string; destino: string },
): { origem: boolean; destino: boolean } {
  if (!rodada) return { origem: false, destino: false };
  const movida = chave(mover.box_code);
  const destino = chave(mover.destino);
  const depois = caixas.map((caixa) => (chave(caixa.code) === movida ? { ...caixa, location_id: destino } : caixa));
  return {
    origem: prateleiraNoAlcance(rodada.alcance, mover.origem, caixas, rodada.id),
    destino: prateleiraNoAlcance(rodada.alcance, destino, depois, rodada.id),
  };
}

// ------------------------------------------------------------------ apoio

const OPERATIONS_COLLECTION = "operational_operations";
const OPENING_LINES_COLLECTION = "opening_inventory_lines";
const OPENING_SESSIONS_COLLECTION = "opening_inventory_sessions";
const STOCK_BALANCES_COLLECTION = "stock_balances";
const STOCK_RESERVATIONS_COLLECTION = "stock_reservations";
const EVENT_SOURCE = "functions_wms";

type Data = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
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

// ------------------------------------------------------------- a caixa lida

/** Um item da caixa com o saldo dela (a entrada menos o retirado mais os ajustes) e o nome. */
export type ItemMovido = { sku_code: string; qty: number; client_item_code?: string; product_name?: string; size?: string };

type CaixaLida = { ref: DocumentReference; data: Data; linhasDaAbertura: Row[]; itens: ItemMovido[]; units: number };

function emMaiusculas(linhas: LinhaDaCaixa[]): LinhaDaCaixa[] {
  return linhas.map((linha) => ({ sku_code: chave(linha.sku_code), qty: linha.qty }));
}

/**
 * A caixa do cliente, com o saldo de cada item pela regra de
 * saldo-da-caixa.ts, como a recontagem (box-recount.ts) e a separação
 * (box-balance.ts) a leem: a entrada é a da própria caixa (`lines[]`, a do
 * recebimento) ou a das linhas da abertura (pelo `box_code`).
 */
async function lerCaixa(transaction: Transaction, db: Firestore, customerCode: string, boxCode: string): Promise<CaixaLida> {
  const ref = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(boxCode);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) recusar(RECUSAS_DO_MOVER.caixaNaoExiste(boxCode));
  const data = snapshot.data() ?? {};
  if (text(data.customer_code) !== customerCode) throw new HttpsError("permission-denied", "A caixa pertence a outro cliente.");
  const linhasDaAbertura = await readRows(transaction, db.collection(OPENING_LINES_COLLECTION).where("customer_code", "==", customerCode).where("box_code", "==", boxCode));
  const entrada = entradaDaCaixa(data, linhasDaAbertura);
  const nomes = new Map<string, NomeDoItem>();
  for (const linha of entrada) if (!nomes.has(linha.sku_code)) nomes.set(linha.sku_code, nomeDe(linha));
  // O item que só a recontagem pôs na caixa leva o nome no ajuste.
  for (const ajuste of Array.isArray(data.count_adjustments) ? (data.count_adjustments as unknown[]) : []) {
    if (!ajuste || typeof ajuste !== "object") continue;
    const sku = chave((ajuste as Data).sku_code);
    if (sku && !nomes.has(sku)) nomes.set(sku, nomeDe(ajuste as Data));
  }
  const saldo = saldoDaCaixa(entrada, emMaiusculas(retiradoDaCaixa({ id: boxCode, ref, data })), emMaiusculas(ajustesDaCaixa(data)));
  const itens = saldo.map((linha) => clean({ sku_code: linha.sku_code, qty: linha.qty, ...nomes.get(linha.sku_code) }) as ItemMovido);
  return { ref, data, linhasDaAbertura, itens, units: itens.reduce((soma, item) => soma + item.qty, 0) };
}

/** O pedido da reserva do item na prateleira, para a frase; "" sem ele. */
async function pedidoDaReserva(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string, locationId: string): Promise<string> {
  const reservas = db.collection(STOCK_RESERVATIONS_COLLECTION).where("customer_code", "==", customerCode).where("sku_code", "==", skuCode).where("location_id", "==", locationId);
  const [reservada] = await readRows(transaction, reservas.where("status", "==", "reserved").limit(1));
  if (reservada) return text(reservada.data.order_number);
  const [separada] = await readRows(transaction, reservas.where("status", "==", "picked").limit(1));
  return separada ? text(separada.data.order_number) : "";
}

// ----------------------------------------------------------------- o mover

export type ResultadoDoMover = {
  ok: true;
  box_move_id: string;
  box_code: string;
  from_location_id: string;
  to_location_id: string;
  units: number;
  items: ItemMovido[];
  moved_at: string;
  moved_by_name?: string;
  /** null sem a sugestão na entrada. */
  suggestion_followed: boolean | null;
  movement_ids: string[];
  events: OperationalEventSummary[];
};

/**
 * Muda a caixa guardada de prateleira, numa transação só: a caixa (a
 * prateleira, o encaixe no destino e o registro do mover; o `stored_at` não
 * muda), as linhas da abertura dela, o saldo de cada item nas duas
 * prateleiras, o razão (a SAÍDA na origem e a ENTRADA no destino, fora da
 * cobrança, a ENTRADA com o dia FIFO da caixa e a origem), o evento e o
 * recibo. O portal e o catálogo não mudam: as duas pontas são prateleiras.
 * Recusa o que o desenho lista (RECUSAS_DO_MOVER).
 */
export async function moveWarehouseBoxTransaction(db: Firestore, input: EntradaDoMover, actor: OperationalActor): Promise<ResultadoDoMover> {
  const customerCode = text(input.customer_code);
  const boxCode = chave(input.box_code);
  const vista = chave(input.from_location_id);
  const area = areaDePassagem(input.to_location_id);
  if (area) recusar(RECUSAS_DO_MOVER.areaDePassagem(area));
  const destino = chave(input.to_location_id);
  const operationId = `op_box_move_${digest({ customer: customerCode, box: boxCode, nonce: input.idempotency_key })}`;
  const inputHash = digest(input, 64);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(operationId);
  const moveId = `bmv_${digest({ operationId })}`;
  const destinoRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(destino);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as ResultadoDoMover;
    }
    await assertInventoryOperationsEnabled(transaction, db);
    const movedAt = new Date().toISOString();

    // A caixa: do cliente, guardada e onde a tela a viu.
    const caixa = await lerCaixa(transaction, db, customerCode, boxCode);
    const box = caixa.data;
    if (text(box.status) !== BOX_STATUS_STORED) recusar(RECUSAS_DO_MOVER.caixaNaoGuardada(boxCode));
    const origem = chave(box.location_id);
    if (origem !== vista) recusar(RECUSAS_DO_MOVER.outraPrateleira(boxCode, origem, vista));
    if (destino === origem) recusar(RECUSAS_DO_MOVER.mesmaPrateleira(boxCode, origem));
    const origemRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(origem);

    const [destinoSnapshot, origemSnapshot, sessao, rodada, emCima, noDestino, daOrigem, doDestino] = await Promise.all([
      transaction.get(destinoRef),
      transaction.get(origemRef),
      transaction.get(db.collection(OPENING_SESSIONS_COLLECTION).doc(openingSessionDocId(customerCode))),
      lerRodadaAberta(transaction, db, customerCode),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("support_box_code", "==", boxCode)),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("location_id", "==", destino).where("status", "in", ["stored", "committing"])),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode).where("location_id", "==", origem)),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode).where("location_id", "==", destino)),
    ]);

    // O destino: em Posições, ativo e da zona do cliente.
    if (!destinoSnapshot.exists) recusar(RECUSAS_DO_MOVER.prateleiraNaoExiste(destino));
    const posicao = asPosition(destinoSnapshot.data() ?? {});
    const situacao = posicao.status ?? "active";
    if (situacao !== "active") recusar(RECUSAS_DO_MOVER.prateleiraIndisponivel(destino, situacao));
    if (text(posicao.customer_code) !== customerCode) recusar(RECUSAS_DO_MOVER.outraZona(destino, customerCode));
    // A abertura em andamento tem o "Corrigir caixa".
    if (sessao.exists && text(sessao.get("status")) === "open" && text(sessao.get("customer_code")) === customerCode) {
      recusar(RECUSAS_DO_MOVER.aberturaAberta(customerCode));
    }
    // A caixa de cima sai antes.
    const deCima = emCima.find((row) => ["stored", "committing"].includes(text(row.data.status)));
    if (deCima) recusar(RECUSAS_DO_MOVER.outraEmCima(boxCode, chave(deCima.data.code) || deCima.id));
    // A contagem aberta: a origem como está, o destino como ficaria.
    const naContagem = prateleirasNaContagem(rodada, [...daOrigem, ...doDestino].map((row) => caixaDaRodada(row.id, row.data)), { box_code: boxCode, origem, destino });
    if (rodada && naContagem.origem) recusar(RECUSAS_DO_MOVER.naContagem(origem, rodada.title, rodada.id));
    if (rodada && naContagem.destino) recusar(RECUSAS_DO_MOVER.naContagem(destino, rodada.title, rodada.id));
    // O encaixe estrito do motor, com as caixas guardadas e a caminho no destino.
    const medidas = requireDimensions(box as unknown as BoxDimensions);
    const ocupacao = buildOccupancy(noDestino.map((row) => row.data), []).get(destino) ?? emptyOccupancy();
    const encaixe = placementFor(posicao, medidas, ocupacao, { allow_tilt: box.allow_tilt === true, allow_stacking: box.allow_stacking === true });
    if (!encaixe) recusar(RECUSAS_DO_MOVER.naoCabe(boxCode, destino));

    // O saldo de cada item nas duas prateleiras, a reserva e o que a prateleira tem.
    const planos: Array<{ item: ItemMovido; origemRow: Row; destinoRow: Row | undefined; antesNaOrigem: number; antesNoDestino: number }> = [];
    for (const item of caixa.itens) {
      const saldos = await readRows(transaction, skuBalancesQuery(db, customerCode, item.sku_code));
      const naOrigem = saldos.filter((row) => text(row.data.location_id) === origem);
      const noDestinoDoItem = saldos.filter((row) => text(row.data.location_id) === destino);
      if (naOrigem.length > 1) recusar(RECUSAS_DO_MOVER.saldoDuplicado(item.sku_code, origem));
      if (noDestinoDoItem.length > 1) recusar(RECUSAS_DO_MOVER.saldoDuplicado(item.sku_code, destino));
      const nome = nomeDoItem(item, item.sku_code);
      const origemRow = naOrigem[0];
      const destinoRow = noDestinoDoItem[0];
      if (origemRow && number(origemRow.data.qty_reserved) > 0) {
        recusar(RECUSAS_DO_MOVER.reservadoNaOrigem(nome, origem, await pedidoDaReserva(transaction, db, customerCode, item.sku_code, origem)));
      }
      if (destinoRow && number(destinoRow.data.qty_reserved) > 0) {
        recusar(RECUSAS_DO_MOVER.reservadoNoDestino(nome, destino, await pedidoDaReserva(transaction, db, customerCode, item.sku_code, destino)));
      }
      const antesNaOrigem = number(origemRow?.data.qty_on_hand);
      if (!origemRow || antesNaOrigem < item.qty) recusar(RECUSAS_DO_MOVER.prateleiraComMenos(origem, antesNaOrigem, nome, boxCode, item.qty));
      planos.push({ item, origemRow, destinoRow, antesNaOrigem, antesNoDestino: number(destinoRow?.data.qty_on_hand) });
    }

    // ------------------------------------------------------------ escritas
    const by = actorFields(actor);
    transaction.update(caixa.ref, {
      location_id: destino,
      front_m: encaixe.front_m,
      depth_m: encaixe.depth_m,
      placed_height_m: encaixe.height_m,
      orientation: encaixe.orientation,
      support_box_code: encaixe.support_box_code ?? null,
      base_height_m: encaixe.base_height_m ?? 0,
      // No destino, o encaixe é o do motor: a marca da abertura sem o encaixe calculado sai.
      opening_model_fit: FieldValue.delete(),
      moved_at: movedAt,
      moved_from_location_id: origem,
      moved_by: by,
      move_count: FieldValue.increment(1),
      last_move_id: moveId,
      updated_at: FieldValue.serverTimestamp(),
    });
    // A revisão da ocupação das duas prateleiras, como a guarda e a remoção.
    transaction.update(destinoRef, { occupancy_revision: FieldValue.increment(1) });
    if (origemSnapshot.exists) transaction.update(origemRef, { occupancy_revision: FieldValue.increment(1) });
    // As linhas da abertura vão com a caixa: a separação e a recontagem as acham pela prateleira.
    for (const linha of caixa.linhasDaAbertura) {
      transaction.update(linha.ref, {
        location_id: destino,
        opening_location_id: text(linha.data.opening_location_id) || text(linha.data.location_id),
        last_box_move_id: moveId,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    // O dia que o FIFO dá ao conteúdo da caixa, como a recontagem: o da sessão na caixa da abertura, o da guarda nas outras.
    const diaDaCaixa = diaDeSaoPaulo(text(box.stored_at));
    const origemDaCaixa = box.origin && typeof box.origin === "object" ? (box.origin as Data) : {};
    const sessaoDaCaixa = text(origemDaCaixa.kind) === "opening_inventory" ? text(origemDaCaixa.session_id) : "";
    const movementIds: string[] = [];
    for (const { item, origemRow, destinoRow, antesNaOrigem, antesNoDestino } of planos) {
      const identidade = {
        client_item_code: text(origemRow.data.client_item_code) || item.client_item_code,
        product_name: text(origemRow.data.product_name) || item.product_name || item.sku_code,
        size: text(origemRow.data.size) || item.size,
      };
      const depoisNaOrigem = antesNaOrigem - item.qty;
      transaction.update(origemRow.ref, {
        qty_on_hand: depoisNaOrigem,
        qty_available: depoisNaOrigem - number(origemRow.data.qty_reserved),
        status: depoisNaOrigem > 0 ? "available" : "empty",
        source: BOX_MOVE_SOURCE,
        updated_at: FieldValue.serverTimestamp(),
        ...publishedMoneyDeletes(),
      });
      const depoisNoDestino = antesNoDestino + item.qty;
      const noDestinoPayload = clean({
        customer_code: customerCode,
        sku_code: item.sku_code,
        ...identidade,
        location_id: destino,
        qty_on_hand: depoisNoDestino,
        qty_reserved: number(destinoRow?.data.qty_reserved),
        qty_available: depoisNoDestino - number(destinoRow?.data.qty_reserved),
        status: "available",
        source: BOX_MOVE_SOURCE,
        updated_at: FieldValue.serverTimestamp(),
      });
      if (destinoRow) {
        transaction.update(destinoRow.ref, { ...noDestinoPayload, ...publishedMoneyDeletes() });
      } else {
        const balanceId = `bal_${digest({ customerCode, skuCode: item.sku_code, locationId: destino }, 48)}`;
        transaction.set(db.collection(STOCK_BALANCES_COLLECTION).doc(balanceId), { id: balanceId, ...noDestinoPayload, created_at: FieldValue.serverTimestamp() });
      }
      const comum = { reason: MOTIVO_DO_MOVER, box_code: boxCode, from_location_id: origem, to_location_id: destino, box_move_id: moveId, operational_operation_id: operationId };
      const saida = movementId(operationId, `box_move_out_${item.sku_code}`);
      const entrada = movementId(operationId, `box_move_in_${item.sku_code}`);
      createMovement(
        transaction,
        db,
        saida,
        {
          type: "SAIDA",
          quantity: item.qty,
          customerCode,
          skuCode: item.sku_code,
          clientItemCode: identidade.client_item_code,
          productName: identidade.product_name,
          locationId: origem,
          beforeQty: antesNaOrigem,
          afterQty: depoisNaOrigem,
          source: BOX_MOVE_SOURCE,
          occurredAt: movedAt,
          entity: { ...comum, movement_kind: "box_move_out" },
        },
        actor,
      );
      createMovement(
        transaction,
        db,
        entrada,
        {
          type: "ENTRADA",
          quantity: item.qty,
          customerCode,
          skuCode: item.sku_code,
          clientItemCode: identidade.client_item_code,
          productName: identidade.product_name,
          locationId: destino,
          beforeQty: antesNoDestino,
          afterQty: depoisNoDestino,
          source: BOX_MOVE_SOURCE,
          occurredAt: movedAt,
          // A ENTRADA vale o dia da caixa (datas-do-saldo.ts) e diz de onde ela veio: a conta tira essas peças da origem.
          entity: clean({
            ...comum,
            movement_kind: "box_move_in",
            fifo_day: diaDaCaixa ?? undefined,
            fifo_opening_session_id: sessaoDaCaixa || undefined,
            fifo_from_location_id: origem,
          }),
        },
        actor,
      );
      movementIds.push(saida, entrada);
    }

    // O evento: a caixa e as prateleiras no título (o rascunho, se houver, é interno: o cliente não vê caixa).
    const sugerida = input.suggestion ? chave(input.suggestion.position) : "";
    const seguiu = input.suggestion ? sugerida === destino : null;
    const events: OperationalEventSummary[] = [
      createEvent(
        transaction,
        db,
        `evt_${digest({ operationId, suffix: "box_moved" })}`,
        {
          type: BOX_MOVED_EVENT_TYPE,
          title: `Caixa ${boxCode} movida de ${origem} para ${destino}`,
          description: [`${unidades.format(caixa.units)} un.`, seguiu === null ? "" : seguiu ? "sugestão do sistema" : "escolhida à mão"].filter(Boolean).join(" · "),
          severity: "info",
          inbox: false,
          entity_type: WAREHOUSE_BOXES_COLLECTION,
          entity_id: boxCode,
          customer_code: customerCode,
          occurred_at: movedAt,
          source: EVENT_SOURCE,
          payload: clean({
            box_move_id: moveId,
            box_code: boxCode,
            from_location_id: origem,
            to_location_id: destino,
            units: caixa.units,
            items: caixa.itens,
            suggestion: input.suggestion ? { position: sugerida, alternatives: input.suggestion.alternatives.map(chave), followed: seguiu } : undefined,
            movement_ids: movementIds,
          }),
        },
        actor,
      ),
    ];

    const result = clean({
      ok: true as const,
      box_move_id: moveId,
      box_code: boxCode,
      from_location_id: origem,
      to_location_id: destino,
      units: caixa.units,
      items: caixa.itens,
      moved_at: movedAt,
      moved_by_name: actor.name || undefined,
      suggestion_followed: seguiu,
      movement_ids: movementIds,
      events,
    }) as ResultadoDoMover;
    transaction.create(opRef, {
      id: opRef.id,
      kind: "warehouse.box.move",
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

// ----------------------------------------------------------------- a prévia

/** A caixa como a página do mover a mostra. */
export type CaixaDaPrevia = {
  code: string;
  status: string;
  location_id: string;
  units: number;
  items: ItemMovido[];
  origin_kind: "opening_inventory" | "receipt" | "manual";
  invoice_number?: string;
  stored_at?: string;
  length_m: number;
  width_m: number;
  height_m: number;
  gross_weight_kg: number | null;
};

export type PreviaDoMover = {
  ok: true;
  box: CaixaDaPrevia;
  /** A recusa que já se sabe, com o código e a frase do mover; null quando a caixa pode sair. */
  bloqueio: { code: string; message: string } | null;
  /** Na ordem do mover: a primeira é a sugestão; a segunda e a terceira, as alternativas. Vazia com o bloqueio. */
  prateleiras: DestinoDoMover[];
  nao_cabem: string[];
  com_reserva: string[];
  em_contagem: string[];
  rejected: string | null;
};

function caixaDaPrevia(boxCode: string, caixa: CaixaLida): CaixaDaPrevia {
  const box = caixa.data;
  const origem = box.origin && typeof box.origin === "object" ? (box.origin as Data) : {};
  const tipo = text(origem.kind);
  const peso = box.gross_weight_kg == null ? null : number(box.gross_weight_kg);
  return clean({
    code: boxCode,
    status: text(box.status),
    location_id: chave(box.location_id),
    units: caixa.units,
    items: caixa.itens,
    origin_kind: tipo === "receipt" ? "receipt" : tipo === "opening_inventory" || text(origem.session_id) ? "opening_inventory" : "manual",
    invoice_number: text(origem.invoice_number) || undefined,
    stored_at: text(box.stored_at) || undefined,
    length_m: number(box.length_m),
    width_m: number(box.width_m),
    height_m: number(box.height_m),
    gross_weight_kg: peso,
  }) as CaixaDaPrevia;
}

/**
 * O que a página do mover mostra antes de mover (só lê): a caixa, a recusa
 * que já se sabe (na ordem: não guardada, abertura em andamento, caixa com
 * outra em cima, item reservado na origem, origem na contagem aberta), a
 * sugestão e a lista das prateleiras na ordem do mover (destinosDoMover), e
 * as que ficam de fora: as que não cabem, as com reserva de algum item da
 * caixa (decisão 5) e as da contagem aberta. As frases são as do mover.
 */
export async function previewBoxMoveTransaction(db: Firestore, input: EntradaDaPreviaDoMover): Promise<PreviaDoMover> {
  const customerCode = text(input.customer_code);
  const boxCode = chave(input.box_code);
  return db.runTransaction(async (transaction) => {
    const caixa = await lerCaixa(transaction, db, customerCode, boxCode);
    const box = caixa.data;
    const origem = chave(box.location_id);
    const [posicoes, caixas, saldos, sessao, rodada, emCima] = await Promise.all([
      readRows(transaction, db.collection(WAREHOUSE_POSITIONS_COLLECTION).where("customer_code", "==", customerCode)),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode)),
      readRows(transaction, db.collection(STOCK_BALANCES_COLLECTION).where("customer_code", "==", customerCode)),
      transaction.get(db.collection(OPENING_SESSIONS_COLLECTION).doc(openingSessionDocId(customerCode))),
      lerRodadaAberta(transaction, db, customerCode),
      readRows(transaction, db.collection(WAREHOUSE_BOXES_COLLECTION).where("support_box_code", "==", boxCode)),
    ]);
    const previa = caixaDaPrevia(boxCode, caixa);
    const semLista = { prateleiras: [], nao_cabem: [], com_reserva: [], em_contagem: [], rejected: null };
    const bloqueada = (recusaDoMover: RecusaDoMover): PreviaDoMover => ({ ok: true, box: previa, bloqueio: { code: recusaDoMover.code, message: recusaDoMover.message }, ...semLista });

    if (text(box.status) !== BOX_STATUS_STORED) return bloqueada(RECUSAS_DO_MOVER.caixaNaoGuardada(boxCode));
    if (sessao.exists && text(sessao.get("status")) === "open" && text(sessao.get("customer_code")) === customerCode) return bloqueada(RECUSAS_DO_MOVER.aberturaAberta(customerCode));
    const deCima = emCima.find((row) => ["stored", "committing"].includes(text(row.data.status)));
    if (deCima) return bloqueada(RECUSAS_DO_MOVER.outraEmCima(boxCode, chave(deCima.data.code) || deCima.id));
    // A reserva por item e prateleira: a do cliente, lida uma vez.
    const reservados = new Map<string, Set<string>>();
    for (const row of saldos) {
      if (number(row.data.qty_reserved) <= 0) continue;
      const local = text(row.data.location_id);
      reservados.set(local, new Set([...(reservados.get(local) ?? []), chave(row.data.sku_code)]));
    }
    const itemReservadoNaOrigem = caixa.itens.find((item) => reservados.get(origem)?.has(item.sku_code));
    if (itemReservadoNaOrigem) {
      const pedido = await pedidoDaReserva(transaction, db, customerCode, itemReservadoNaOrigem.sku_code, origem);
      return bloqueada(RECUSAS_DO_MOVER.reservadoNaOrigem(nomeDoItem(itemReservadoNaOrigem, itemReservadoNaOrigem.sku_code), origem, pedido));
    }
    const caixasDaRodada = caixas.map((row) => caixaDaRodada(row.id, row.data));
    if (rodada && prateleirasNaContagem(rodada, caixasDaRodada, { box_code: boxCode, origem, destino: origem }).origem) {
      return bloqueada(RECUSAS_DO_MOVER.naContagem(origem, rodada.title, rodada.id));
    }

    // As prateleiras da zona que ficam de fora antes do encaixe: a com reserva de algum item e a da contagem.
    const zona = posicoes
      .map((row) => asPosition(row.data))
      .filter((posicao) => (posicao.status ?? "active") === "active" && chave(posicao.code) !== origem)
      .sort((left, right) => Number(left.sequence ?? Number.MAX_SAFE_INTEGER) - Number(right.sequence ?? Number.MAX_SAFE_INTEGER) || left.code.localeCompare(right.code));
    const comReserva = zona.filter((posicao) => caixa.itens.some((item) => reservados.get(posicao.code)?.has(item.sku_code))).map((posicao) => posicao.code);
    const emContagem = rodada
      ? zona.filter((posicao) => prateleirasNaContagem(rodada, caixasDaRodada, { box_code: boxCode, origem, destino: posicao.code }).destino).map((posicao) => posicao.code)
      : [];
    const ocupacao = buildOccupancy(
      caixas.filter((row) => ["stored", "committing"].includes(text(row.data.status))).map((row) => row.data),
      saldos.map((row) => row.data),
    );
    const porSku = new Map(caixa.itens.map((item) => [item.sku_code, item] as const));
    const destinos = destinosDoMover(
      { ...requireDimensions(box as unknown as BoxDimensions), allow_tilt: box.allow_tilt === true, allow_stacking: box.allow_stacking === true, customer_code: customerCode, sku_codes: caixa.itens.map((item) => item.sku_code) },
      posicoes.map((row) => asPosition(row.data)),
      ocupacao,
      { origem, fora: new Set([...comReserva, ...emContagem]), nomeDoItem: (sku) => nomeDoItem(porSku.get(sku), sku) },
    );
    return {
      ok: true,
      box: previa,
      bloqueio: null,
      prateleiras: destinos.prateleiras,
      nao_cabem: destinos.nao_cabem,
      com_reserva: comReserva,
      em_contagem: emContagem,
      rejected: destinos.rejected,
    };
  });
}
