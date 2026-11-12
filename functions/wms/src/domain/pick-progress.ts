import { createHash } from "node:crypto";

import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import {
  advanceWarehouseTaskTransaction,
  assertInventoryOperationsEnabled,
  createEvent,
  type OperationalActor,
} from "./operations.js";
import { BOX_STATUS_EMPTIED, BOX_STATUS_STORED, caixasComOItem, lerCaixasDaPrateleira, retiradoDaCaixa } from "./box-balance.js";
import {
  caixaViraVolume,
  dividirNoVolumeAberto,
  fecharVolume,
  porNoVolumeAberto,
  problemaParaFechar,
  tirarDosVolumes,
  volumesDaLinha,
  volumesDaTarefa,
  volumesParaConcluir,
  type EstadoDosVolumes,
  type LinhaNosVolumes,
  type NoVolume,
  type VolumeDoPedido,
} from "./order-volumes.js";
import { conferirCaixasInformadas, retiradoCom, sugerirCaixas, unidadesDaCaixa, type CaixaDaLinha, type LinhaDaCaixa } from "./saldo-da-caixa.js";
import { DETALHE_DA_DIFERENCA_MAXIMO, MOTIVOS_DA_DIFERENCA, concluiComDiferenca, type MotivoDaDiferenca } from "./short-pick.js";
import { WAREHOUSE_BOXES_COLLECTION } from "./warehouse-boxes.js";

/**
 * Separar com o progresso salvo (docs/plataforma/separacao-com-caixas.md,
 * seção 4.2, parte 2a; decisão 9 de 10/11/2026). O pedido da BTG leva dias
 * para separar: cada linha separada fica gravada na hora, a pessoa para e
 * continua depois, e outra pessoa pode continuar.
 *
 * - `setPickLineSeparated` marca ou desmarca uma linha como separada. A
 *   primeira linha começa a separação (a tarefa vai a `in_progress` pela
 *   porta de sempre, `advanceWarehouseTaskTransaction`, com o evento e o
 *   "Em separação" do portal). Quem opera também registra o separado a menos
 *   na linha, com o motivo (parte 5, decisão 14): "Separar menos".
 * - `completeOrderSeparation` conclui a separação e a embalagem numa chamada:
 *   as mesmas transições que a tela encadeava (separação concluída, embalagem
 *   iniciada e fechada com o lacre), na mesma ordem e pela mesma porta. O
 *   pedido com diferença só conclui com a coordenação.
 *
 * O progresso é só o registro de quem separou o quê: mora na linha
 * (`separated_qty`, `separated_at`, `separated_by` e, na linha a menos,
 * `separated_shortage_reason` e `separated_shortage_detail`), sem tocar a
 * reserva, o saldo nem o `qty_picked`, que continuam mudando só na conclusão.
 * A linha com progresso é o que a contagem cíclica consulta para não contar
 * a prateleira de onde o item já saiu (operations.ts, recordCycleCount).
 *
 * A caixa (parte 3b, seção 4.3): separar a linha baixa o saldo das caixas da
 * prateleira na mesma transação. Sem a pessoa dizer nada, sai da caixa mais
 * antiga que tem o item, e a seguinte completa; "Outra caixa" informa de
 * quais saiu (`boxes`), e a soma tem de fechar com a linha. A linha guarda de
 * onde saiu (`separated_boxes`), e "Desfazer" devolve às mesmas caixas. O que
 * as caixas da prateleira não têm sai sem caixa, como antes.
 *
 * A caixa vazia (parte 3c): a caixa de que a separação tirou tudo fica
 * `emptied`, com a data, o pedido e se saiu inteira; o Mapa, "Posições
 * ocupadas" e o encaixe da prateleira só olham a guardada. Desfazer a linha
 * devolve a caixa à prateleira. Cada mudança grava `warehouse.box_emptied`
 * ou `warehouse.box_reopened`.
 *
 * Os volumes (parte 4a, seção 4.4; a regra em order-volumes.ts): a linha
 * separada entra no volume aberto da tarefa (`pick_tasks.volumes`) e guarda
 * em quais volumes foi (`separated_volumes`); "Levar a caixa" (`take_boxes`)
 * faz da caixa que sai inteira um volume fechado, com o peso de entrada;
 * `closeOrderVolume` fecha o volume aberto com o peso, opcional. "Desfazer"
 * tira a linha dos volumes. Na conclusão, cada volume vira um `packages`
 * com os itens dele; o lacre continua um por pedido.
 *
 * "Dividir em volumes" (parte 7a, seção 11; decisões 27 a 30): com
 * `split_volumes`, a linha se reparte em dois ou mais volumes; cada parte,
 * menos a última, fecha um volume (`picking.volume_closed`, como o "Fechar
 * volume"), e a última fica aberta. Na linha por separar, a chamada separa
 * como "Separar" e divide; na já separada, só divide o que ela pôs no volume
 * aberto (`picking.line_divided`), sem tocar as caixas nem a diferença. O
 * volume aberto que a tela mostrou (`open_volume_id`, `open_volume_units`),
 * a linha como ela estava (`line_separated_at`) e os números têm de ser os
 * de agora; senão, nada é gravado. "Desfazer" diz também o volume fechado
 * que saiu (`removed_volumes`), para tirar a etiqueta dele.
 */

export const PICK_TASKS_COLLECTION = "pick_tasks";
export const PICK_LINES_COLLECTION = "pick_lines";
const PACK_TASKS_COLLECTION = "pack_tasks";
const ORDER_ITEMS_COLLECTION = "order_items";
const SHIPMENTS_COLLECTION = "shipments";
const OPERATIONS_COLLECTION = "operational_operations";
const EVENT_SOURCE = "functions_wms";

type Row = Record<string, unknown>;

const id = z.string().trim().min(1).max(300);
const idempotencyKey = z.string().trim().min(8).max(200);

/** O peso do volume, em quilos: opcional (decisão 15), com duas casas. */
export const PESO_DO_VOLUME_MAXIMO_KG = 2000;

/** "Dividir em volumes" (parte 7a): de 2 a 20 volumes de uma vez. */
export const PARTES_DA_DIVISAO_MAXIMO = 20;

export const SetPickLineSeparatedSchema = z
  .object({
    pick_task_id: id,
    pick_line_id: id,
    /** true separa a linha; false desfaz. */
    separated: z.boolean(),
    /**
     * "Separar menos" (parte 5): o que foi separado de fato, de 0 ao pedido.
     * Sem ele, a linha inteira. A menos, pede o motivo.
     */
    separated_qty: z.number().nonnegative().optional(),
    shortage_reason: z.string().trim().max(40).optional(),
    shortage_detail: z.string().trim().max(DETALHE_DA_DIFERENCA_MAXIMO).optional(),
    /**
     * "Outra caixa" (parte 3b): de quais caixas da prateleira o item saiu.
     * Sem ele, o sistema baixa da mais antiga.
     */
    boxes: z
      .array(z.object({ box_code: z.string().trim().min(1).max(40), qty: z.number().positive() }).strict())
      .max(50)
      .optional(),
    /**
     * "Levar a caixa" (parte 4a): a caixa que sai inteira nesta linha vira o
     * volume, sem reembalar. Sem ele, o separado entra no volume aberto.
     */
    take_boxes: z.boolean().optional(),
    /**
     * "Dividir em volumes" (parte 7a): as partes da linha, na ordem, a partir
     * do volume aberto, com o número que a tela mostrou. Cada uma, menos a
     * última, fecha o volume, com o peso opcional; a última fica aberta, sem
     * peso. Na linha por separar, separa e divide; na já separada, só divide
     * o que ela pôs no volume aberto.
     */
    split_volumes: z
      .array(
        z
          .object({
            number: z.number().int().min(1),
            qty: z.number().int().min(1),
            weight_kg: z.number().positive().max(PESO_DO_VOLUME_MAXIMO_KG).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(PARTES_DA_DIVISAO_MAXIMO)
      .optional(),
    /** Com a divisão: o volume aberto que a tela mostrou (null sem volume aberto) e as unidades gravadas nele. */
    open_volume_id: z.string().trim().min(1).max(20).nullable().optional(),
    open_volume_units: z.number().nonnegative().optional(),
    /** Com a divisão: a linha como a tela mostrou, o `separated_at` dela (null na linha por separar). */
    line_separated_at: z.string().trim().min(1).max(40).nullable().optional(),
    idempotency_key: idempotencyKey,
  })
  .strict();

export type EntradaDaSeparacao = z.infer<typeof SetPickLineSeparatedSchema>;

/** As partes de "Dividir em volumes", como a tela manda. */
type PartesDaDivisao = NonNullable<EntradaDaSeparacao["split_volumes"]>;

export const CloseOrderVolumeSchema = z
  .object({
    pick_task_id: id,
    volume_id: z.string().trim().min(1).max(20),
    weight_kg: z.number().positive().max(PESO_DO_VOLUME_MAXIMO_KG).optional(),
    idempotency_key: idempotencyKey,
  })
  .strict();

export const CompleteOrderSeparationSchema = z
  .object({
    pick_task_id: id,
    seal_code: z.string().trim().min(1).max(60),
    idempotency_key: idempotencyKey,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Entrada inválida para a separação.", { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }
  return parsed.data;
}

/**
 * A entrada de `setPickLineSeparated`. "Dividir em volumes" (parte 7a) só
 * vale para separar, sem "Outra caixa", "Levar a caixa" nem "Separar menos",
 * e leva o volume aberto e a linha como a tela mostrou; o último volume fica
 * aberto, sem peso. Sem a divisão, o volume aberto e a linha não vêm. A
 * recusa diz os campos, como a do formato.
 */
export function entradaDaSeparacao(raw: unknown): EntradaDaSeparacao {
  const input = parse(SetPickLineSeparatedSchema, raw);
  const issues: string[] = [];
  if (input.split_volumes) {
    if (!input.separated) issues.push("separated");
    for (const campo of ["take_boxes", "boxes", "separated_qty", "shortage_reason", "shortage_detail"] as const) {
      if (input[campo] !== undefined) issues.push(campo);
    }
    if (input.open_volume_id === undefined) issues.push("open_volume_id");
    if (input.open_volume_units === undefined) issues.push("open_volume_units");
    if (input.line_separated_at === undefined) issues.push("line_separated_at");
    const ultima = input.split_volumes.length - 1;
    if (input.split_volumes[ultima]!.weight_kg !== undefined) issues.push(`split_volumes.${ultima}.weight_kg`);
  } else {
    if (input.open_volume_id !== undefined) issues.push("open_volume_id");
    if (input.open_volume_units !== undefined) issues.push("open_volume_units");
    if (input.line_separated_at !== undefined) issues.push("line_separated_at");
  }
  if (issues.length) throw new HttpsError("invalid-argument", "Entrada inválida para a separação.", { issues });
  return input;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Row)
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

/** Tira as chaves sem valor, só no primeiro nível (mantém o serverTimestamp). */
function clean<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function actorFields(actor: OperationalActor) {
  return clean({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name });
}

/** A linha da separação com o que o progresso precisa. */
export type LinhaDoProgresso = {
  id: string;
  /** O nome do produto, ou o SKU, para a mensagem. */
  produto: string;
  /** O que o pedido pede na linha. */
  pedido: number;
  /** O que já foi separado e gravado; null sem progresso. */
  separado: number | null;
  /** Quando foi separada: a versão do progresso que a conclusão confere. */
  separadoEm?: string;
  /** Na linha separada a menos: o motivo e o detalhe. */
  motivo?: string;
  detalhe?: string;
};

/** A linha como a conclusão da separação a recebe (operations.ts, `picking_lines`). */
export type LinhaConferida = {
  pick_line_id: string;
  qty_picked: number;
  status: "confirmed";
  shortage_reason?: string;
  shortage_detail?: string;
  /** O `separated_at` lido: a transação recusa se a linha mudou depois. */
  separated_at?: string;
};

/** "10 de 116 itens · 665 de 3.335 un.": o que a bancada e a fila mostram. */
export function progressoDaSeparacao(linhas: readonly LinhaDoProgresso[]) {
  const separadas = linhas.filter((linha) => linha.separado !== null);
  return {
    lines: linhas.length,
    separated_lines: separadas.length,
    units: linhas.reduce((soma, linha) => soma + linha.pedido, 0),
    separated_units: separadas.reduce((soma, linha) => soma + (linha.separado ?? 0), 0),
    /** As linhas separadas a menos: o pedido com diferença só conclui com a coordenação. */
    short_lines: separadas.filter((linha) => (linha.separado ?? 0) < linha.pedido).length,
  };
}

/**
 * O separado de uma linha: de 0 ao pedido, nunca mais; a menos, com o motivo
 * (falta ou avaria) e, se quiser, o detalhe. É a mesma conferência da
 * conclusão (short-pick.ts), feita já na linha.
 */
export function separadoDaLinha(
  pedido: number,
  entrada: { separated_qty?: number; shortage_reason?: string; shortage_detail?: string },
  produto: string,
): { separado: number; motivo?: MotivoDaDiferenca; detalhe?: string } {
  const separado = entrada.separated_qty ?? pedido;
  if (!Number.isFinite(separado) || separado < 0) {
    throw new HttpsError("invalid-argument", `Quantidade separada de ${produto} inválida.`);
  }
  if (separado > pedido) {
    throw new HttpsError("failed-precondition", `${produto}: o pedido é de ${pedido} un. e o separado informado é ${separado}.`);
  }
  if (separado === pedido) return { separado };
  const motivo = text(entrada.shortage_reason).toLowerCase();
  if (!(MOTIVOS_DA_DIFERENCA as readonly string[]).includes(motivo)) {
    throw new HttpsError("invalid-argument", `Informe o motivo da diferença em ${produto}.`);
  }
  const detalhe = text(entrada.shortage_detail).replace(/\s+/g, " ");
  return { separado, motivo: motivo as MotivoDaDiferenca, detalhe: detalhe || undefined };
}

/**
 * As linhas para concluir a separação: cada uma com o separado gravado (a
 * menos, com o motivo). A linha que ninguém tratou barra a conclusão, e o
 * pedido com diferença só conclui com a coordenação (decisão 14).
 */
export function linhasParaConcluir(linhas: readonly LinhaDoProgresso[], papel: string): LinhaConferida[] {
  const semTratar = linhas.filter((linha) => linha.separado === null);
  if (semTratar.length) {
    throw new HttpsError(
      "failed-precondition",
      semTratar.length === 1 ? `Falta separar 1 item: ${semTratar[0]!.produto}.` : `Faltam ${semTratar.length} itens por separar.`,
      { code: "SEPARATION_PENDING_LINES", pending: semTratar.length },
    );
  }
  const comDiferenca = linhas.filter((linha) => (linha.separado ?? 0) < linha.pedido);
  if (comDiferenca.length && !concluiComDiferenca(papel)) {
    throw new HttpsError(
      "permission-denied",
      comDiferenca.length === 1 ? "O pedido tem 1 linha com diferença: só a coordenação conclui." : `O pedido tem ${comDiferenca.length} linhas com diferença: só a coordenação conclui.`,
      { code: "SEPARATION_SHORT_LINES", short: comDiferenca.length },
    );
  }
  return linhas.map((linha) =>
    clean({
      pick_line_id: linha.id,
      qty_picked: linha.separado ?? 0,
      status: "confirmed" as const,
      shortage_reason: (linha.separado ?? 0) < linha.pedido ? linha.motivo : undefined,
      shortage_detail: (linha.separado ?? 0) < linha.pedido ? linha.detalhe : undefined,
      separated_at: linha.separadoEm,
    }),
  );
}

function linhaDoProgresso(lineId: string, data: Row): LinhaDoProgresso {
  return clean({
    id: lineId,
    produto: text(data.product_name) || text(data.sku_code) || lineId,
    pedido: quantity(data.qty_to_pick),
    separado: data.separated_at ? quantity(data.separated_qty) : null,
    separadoEm: text(data.separated_at) || undefined,
    motivo: text(data.separated_shortage_reason) || undefined,
    detalhe: text(data.separated_shortage_detail) || undefined,
  });
}

/** A tarefa cancelada ou concluída não aceita mais progresso. */
function assertSeparating(status: string) {
  if (status === "cancelled") throw new HttpsError("failed-precondition", "Pedido cancelado.");
  if (status === "completed") throw new HttpsError("failed-precondition", "A separação deste pedido já foi concluída.");
  if (status !== "in_progress") throw new HttpsError("failed-precondition", "A separação ainda não começou. Atualize e tente de novo.");
}

/** Outra pessoa fez a mesma transição no mesmo instante: a tarefa já saiu do status esperado. */
function statusMudou(error: unknown): boolean {
  return error instanceof HttpsError && error.code === "failed-precondition" && /^Status divergente/.test(error.message);
}

/** De onde a linha saiu, como ela guarda (`separated_boxes`). */
type CaixaGravada = { box_code: string; qty: number; whole?: boolean; emptied?: boolean };

function caixasGravadas(value: unknown): CaixaGravada[] {
  if (!Array.isArray(value)) return [];
  return (value as Row[])
    .map((caixa) =>
      clean({ box_code: text(caixa.box_code).toUpperCase(), qty: quantity(caixa.qty), whole: caixa.whole === true || undefined, emptied: caixa.emptied === true || undefined }),
    )
    .filter((caixa) => caixa.box_code && caixa.qty > 0);
}

function paraGravar(caixas: readonly CaixaDaLinha[]): CaixaGravada[] {
  return caixas.map((caixa) => clean({ box_code: caixa.box_code, qty: caixa.qty, whole: caixa.inteira || undefined, emptied: caixa.esvazia || undefined }));
}

function mesmasCaixas(antes: readonly CaixaGravada[], depois: readonly CaixaDaLinha[]): boolean {
  const chave = (caixas: ReadonlyArray<{ box_code: string; qty: number }>) =>
    caixas
      .map((caixa) => `${caixa.box_code}:${caixa.qty}`)
      .sort()
      .join("|");
  return chave(antes) === chave(depois);
}

/** Os volumes como a tarefa os guarda (`volumes`, `volume_seq`). */
function volumesDe(task: Row): EstadoDosVolumes {
  return { volumes: volumesDaTarefa(task.volumes), seq: quantity(task.volume_seq) };
}

/** Os volumes da linha para a resposta: o número e, na caixa levada, a caixa. */
function emQuaisVolumes(entradas: readonly NoVolume[], estado: EstadoDosVolumes) {
  const porId = new Map(estado.volumes.map((volume) => [volume.id, volume]));
  const lista = entradas
    .filter((entrada) => porId.has(entrada.volume_id))
    .map((entrada) => clean({ volume_id: entrada.volume_id, number: porId.get(entrada.volume_id)!.number, qty: entrada.qty, box_code: porId.get(entrada.volume_id)!.box_code }));
  return lista.length ? lista : undefined;
}

/** O fechado de que saiu uma parte, com o número de agora (ele pode ter mudado na mesma operação). */
function volumesMudados(alterados: ReadonlyArray<{ id: string }>, estado: EstadoDosVolumes) {
  const porId = new Map(estado.volumes.map((volume) => [volume.id, volume.number]));
  const lista = alterados.filter((volume) => porId.has(volume.id)).map((volume) => ({ volume_id: volume.id, number: porId.get(volume.id)! }));
  return lista.length ? lista : undefined;
}

/** O peso do volume com duas casas, como "Fechar volume" e a divisão gravam. */
function pesoDoVolume(peso: number | undefined): number | undefined {
  return peso === undefined ? undefined : Math.round(peso * 100) / 100 || undefined;
}

/** De qual pedido é o volume que fechou. */
type PedidoDoVolume = { pickTaskId: string; orderId: string; orderNumber: string; customerCode: string; occurredAt: string };

/** `picking.volume_closed`: o mesmo evento no "Fechar volume" e em cada volume que a divisão fecha. */
function eventoDoVolumeFechado(
  transaction: Transaction,
  db: Firestore,
  eventId: string,
  volume: VolumeDoPedido,
  pedido: PedidoDoVolume,
  actor: OperationalActor,
) {
  return createEvent(
    transaction,
    db,
    eventId,
    {
      type: "picking.volume_closed",
      title: `Volume ${volume.number} fechado no pedido ${pedido.orderNumber}`,
      description: `${volume.units} un.${volume.weight_kg ? ` · ${String(volume.weight_kg).replace(".", ",")} kg` : ""}`,
      severity: "info",
      // Um pedido grande tem dezenas de volumes: o evento fica na trilha, fora da caixa de avisos.
      inbox: false,
      entity_type: PICK_TASKS_COLLECTION,
      entity_id: pedido.pickTaskId,
      customer_code: pedido.customerCode,
      occurred_at: pedido.occurredAt,
      payload: clean({
        order_id: pedido.orderId || undefined,
        order_number: pedido.orderNumber || undefined,
        volume_id: volume.id,
        volume_number: volume.number,
        units: volume.units,
        weight_kg: volume.weight_kg,
      }),
      source: EVENT_SOURCE,
    },
    actor,
  );
}

/** Os volumes que a divisão fechou, para o aviso "Volume 16 fechado". */
function volumesFechados(fechados: readonly VolumeDoPedido[]) {
  return fechados.length ? fechados.map((volume) => clean({ volume_id: volume.id, number: volume.number, units: volume.units, weight_kg: volume.weight_kg })) : undefined;
}

/** A divisão pedida sobre o que a tela mostrou, e isso já mudou: a tela confere e tenta de novo. */
function volumesMudaram() {
  return new HttpsError("failed-precondition", "Os volumes mudaram. Confira e tente de novo.", { code: "SEPARATION_VOLUMES_CHANGED" });
}

/**
 * A tela dividiu a linha como ela está: por separar (null) ou separada
 * naquele instante (`separated_at`). Se outra pessoa separou ou desfez a
 * linha depois, a divisão faria outra coisa (separar e dividir, ou só
 * dividir): recusa sem gravar nada, como o volume aberto que mudou.
 */
function conferirALinhaDaTela(input: EntradaDaSeparacao, line: Row) {
  if ((input.line_separated_at ?? null) !== (text(line.separated_at) || null)) throw volumesMudaram();
}

/**
 * Confere a divisão pedida e divide (parte 7a). O volume aberto gravado (o id
 * e as unidades) e os números que o servidor dá são os que a tela mostrou.
 * Senão, recusa sem gravar nada: outra pessoa pode estar separando no mesmo
 * volume aberto. Com a tela em dia, as partes somam o que se divide. A soma
 * vem depois: com os volumes mudados, o que a linha tem neles também muda, e
 * a recusa é a dos volumes. `gravados` são os volumes como a tarefa os
 * guarda; `estado`, de onde a divisão parte.
 */
function dividirConferido(
  gravados: EstadoDosVolumes,
  estado: EstadoDosVolumes,
  input: EntradaDaSeparacao,
  partes: PartesDaDivisao,
  total: { qty: number; noVolumeAberto: boolean },
  fechamento: { at: string; by: Row },
) {
  const aberto = gravados.volumes.find((volume) => volume.status === "open");
  const divisao = dividirNoVolumeAberto(
    estado,
    partes.map((parte) => ({ qty: parte.qty, weight_kg: pesoDoVolume(parte.weight_kg) })),
    fechamento,
  );
  const numeroDe = new Map(divisao.volumes.map((volume) => [volume.id, volume.number]));
  const comoATelaMostrou =
    (aberto?.id ?? null) === (input.open_volume_id ?? null) &&
    (aberto?.units ?? 0) === input.open_volume_units &&
    divisao.entradas.every((entrada, index) => numeroDe.get(entrada.volume_id) === partes[index]!.number);
  if (!comoATelaMostrou) throw volumesMudaram();
  const soma = partes.reduce((acumulado, parte) => acumulado + parte.qty, 0);
  if (soma !== total.qty) {
    throw new HttpsError("failed-precondition", `As partes somam ${soma} un., e a linha tem ${total.qty} un.${total.noVolumeAberto ? " no volume aberto." : ""}`, {
      code: "SEPARATION_SPLIT_MISMATCH",
    });
  }
  return divisao;
}

/** O que a transação já leu da linha já separada, para dividir. */
type LinhaParaDividir = {
  input: EntradaDaSeparacao;
  partes: PartesDaDivisao;
  task: Row;
  line: Row;
  refs: { task: DocumentReference<DocumentData>; line: DocumentReference<DocumentData>; op: DocumentReference<DocumentData> };
  inputHash: string;
  occurredAt: string;
  pedido: number;
  produto: string;
};

/**
 * "Dividir em volumes" na linha já separada (parte 7a, decisão 30): só o que
 * ela pôs no volume aberto se reparte. As caixas, o separado, a diferença e o
 * `separated_at` ficam como estão (nada de caixa é lido nem gravado), e as
 * outras entradas da linha (a caixa levada inteira, por exemplo) também. O
 * que a linha tem no volume aberto sai dele sem tirar o volume, e a primeira
 * parte o completa de novo. A mesma divisão mandada de novo, com outra chave,
 * não muda nada; a tela que mostrou a linha por separar, ou separada em outro
 * instante, recusa.
 */
function dividirALinhaSeparada(transaction: Transaction, db: Firestore, linha: LinhaParaDividir, actor: OperationalActor): Row {
  const { input, partes, task, line, refs, occurredAt } = linha;
  const customerCode = text(task.customer_code) || text(line.customer_code);
  const pedidoNumero = text(task.order_number) || text(line.order_number);
  const volumesAntes = volumesDe(task);
  const volumeAntes = new Map(volumesAntes.volumes.map((volume) => [volume.id, volume]));
  const daLinha = volumesDaLinha(line.separated_volumes);
  // A repetição (a resposta que se perdeu, o toque dobrado): as últimas entradas da linha, com o número de agora, já
  // são as partes pedidas, e vieram de uma divisão: cada volume, menos o último, fechado com o peso pedido, e nenhum é
  // caixa levada. "Levar a caixa" dá os mesmos números e quantidades, e não é a divisão: segue para as conferências.
  const ultimas = daLinha.slice(-partes.length);
  const repetida =
    ultimas.length === partes.length &&
    ultimas.every((entrada, index) => {
      const volume = volumeAntes.get(entrada.volume_id);
      const parte = partes[index]!;
      if (!volume || volume.box_code || volume.number !== parte.number || entrada.qty !== parte.qty) return false;
      return index === partes.length - 1 || (volume.status === "closed" && volume.weight_kg === pesoDoVolume(parte.weight_kg));
    });

  let volumesDepois = volumesAntes;
  let naLinha = daLinha;
  let fechados: VolumeDoPedido[] = [];
  const events: unknown[] = [];
  if (!repetida) {
    // A linha confere depois da repetição: a divisão que separou a linha, mandada de novo, chega com ela por separar.
    conferirALinhaDaTela(input, line);
    const aberto = volumesAntes.volumes.find((volume) => volume.status === "open");
    const noAberto = aberto ? daLinha.filter((entrada) => entrada.volume_id === aberto.id).reduce((soma, entrada) => soma + entrada.qty, 0) : 0;
    if (!aberto || !(noAberto > 0)) {
      throw new HttpsError("failed-precondition", "Esta linha não está no volume aberto. Atualize e tente de novo.", { code: "SEPARATION_LINE_NOT_IN_OPEN_VOLUME" });
    }
    // O volume aberto fica sem o que a linha tinha nele, mas não sai: a primeira parte o completa de novo.
    const semALinha: EstadoDosVolumes = {
      seq: volumesAntes.seq,
      volumes: volumesAntes.volumes.map((volume) => (volume.id === aberto.id ? { ...volume, units: Math.max(0, volume.units - noAberto) } : volume)),
    };
    const divisao = dividirConferido(volumesAntes, semALinha, input, partes, { qty: noAberto, noVolumeAberto: true }, { at: occurredAt, by: actorFields(actor) });
    volumesDepois = { volumes: divisao.volumes, seq: divisao.seq };
    naLinha = [...daLinha.filter((entrada) => entrada.volume_id !== aberto.id), ...divisao.entradas];
    fechados = divisao.fechados;
    const numeroDepois = new Map(volumesDepois.volumes.map((volume) => [volume.id, volume.number]));

    transaction.update(refs.line, { separated_volumes: naLinha, updated_at: FieldValue.serverTimestamp() });
    transaction.update(refs.task, { volumes: volumesDepois.volumes, volume_seq: volumesDepois.seq, updated_at: FieldValue.serverTimestamp() });
    const orderId = text(task.order_id) || text(line.order_id);
    events.push(
      createEvent(
        transaction,
        db,
        `evt_${digest({ operationId: refs.op.id, suffix: "line_divided" })}`,
        {
          type: "picking.line_divided",
          title: `Linha dividida em volumes no pedido ${pedidoNumero}`,
          description: `${noAberto} un. de ${linha.produto} em ${partes.length} volumes`,
          severity: "info",
          // Como a linha separada: na trilha, fora da caixa de avisos.
          inbox: false,
          entity_type: PICK_TASKS_COLLECTION,
          entity_id: input.pick_task_id,
          customer_code: customerCode,
          occurred_at: occurredAt,
          payload: clean({
            order_id: orderId || undefined,
            order_number: pedidoNumero || undefined,
            pick_line_id: input.pick_line_id,
            line_number: quantity(line.line_number) || undefined,
            sku_code: text(line.sku_code) || undefined,
            client_item_code: text(line.client_item_code) || undefined,
            location_id: text(line.location_id) || undefined,
            from_volume_number: aberto.number,
            volumes: divisao.entradas.map((entrada) => ({ volume_number: numeroDepois.get(entrada.volume_id), qty: entrada.qty })),
          }),
          source: EVENT_SOURCE,
        },
        actor,
      ),
    );
    const doPedido: PedidoDoVolume = { pickTaskId: input.pick_task_id, orderId, orderNumber: pedidoNumero, customerCode, occurredAt };
    for (const volume of fechados) {
      events.push(eventoDoVolumeFechado(transaction, db, `evt_${digest({ operationId: refs.op.id, suffix: "volume_closed", volume: volume.id })}`, volume, doPedido, actor));
    }
  }

  const anteriores = caixasGravadas(line.separated_boxes);
  const result = clean({
    ok: true,
    pick_task_id: input.pick_task_id,
    pick_line_id: input.pick_line_id,
    separated: true,
    changed: !repetida,
    expected_qty: linha.pedido,
    separated_qty: quantity(line.separated_qty),
    shortage_reason: text(line.separated_shortage_reason) || undefined,
    separated_at: text(line.separated_at),
    // As caixas não mudam: as de onde a linha saiu.
    boxes: anteriores.length ? anteriores : undefined,
    // Em quais volumes a linha está, com o número de agora.
    volumes: emQuaisVolumes(naLinha, volumesDepois),
    closed_volumes: volumesFechados(fechados),
    events,
  });
  transaction.create(refs.op, {
    id: refs.op.id,
    kind: "picking.line.divide",
    target_id: input.pick_line_id,
    customer_code: customerCode,
    input_hash: linha.inputHash,
    status: "completed",
    actor: actorFields(actor),
    result,
    created_at: FieldValue.serverTimestamp(),
    completed_at: FieldValue.serverTimestamp(),
  });
  return result;
}

/**
 * Separar (ou desfazer) uma linha do pedido. Idempotente pela chave e pelo
 * estado: separar a linha já separada, ou desfazer a que não está, não muda
 * nada e não grava evento. Com `split_volumes`, a linha também se divide em
 * volumes (parte 7a).
 */
export async function setPickLineSeparated(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = entradaDaSeparacao(raw);
  const taskRef = db.collection(PICK_TASKS_COLLECTION).doc(input.pick_task_id);
  const lineRef = db.collection(PICK_LINES_COLLECTION).doc(input.pick_line_id);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_pick_line_${digest({ task: input.pick_task_id, line: input.pick_line_id, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);

  // A primeira linha separada começa a separação, pela porta de sempre.
  if (input.separated && !(await opRef.get()).exists) {
    const before = await taskRef.get();
    if (!before.exists) throw new HttpsError("not-found", "Separação não encontrada.");
    if (text(before.get("status")).toLowerCase() === "planned") {
      try {
        await advanceWarehouseTaskTransaction(
          db,
          { task_uid: `picking:${input.pick_task_id}`, expected_status: "planned", idempotency_key: `${input.idempotency_key}:start` },
          actor,
        );
      } catch (error) {
        if (!statusMudou(error)) throw error;
      }
    }
  }

  const occurredAt = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Row;
    }
    await assertInventoryOperationsEnabled(transaction, db);
    const [taskSnapshot, lineSnapshot] = await Promise.all([transaction.get(taskRef), transaction.get(lineRef)]);
    if (!taskSnapshot.exists) throw new HttpsError("not-found", "Separação não encontrada.");
    const task = taskSnapshot.data() ?? {};
    assertSeparating(text(task.status).toLowerCase());
    const line = lineSnapshot.data() ?? {};
    if (!lineSnapshot.exists || text(line.pick_task_id) !== input.pick_task_id) {
      throw new HttpsError("not-found", "Linha da separação não encontrada.");
    }
    if (text(line.status) !== "open") {
      throw new HttpsError("failed-precondition", "A linha já foi concluída.");
    }
    const pedido = quantity(line.qty_to_pick);
    if (!(pedido > 0)) throw new HttpsError("failed-precondition", "Linha da separação sem quantidade.");
    const produto = text(line.product_name) || text(line.sku_code) || input.pick_line_id;
    // "Dividir em volumes" na linha já separada (parte 7a, decisão 30): só os volumes mudam.
    if (input.split_volumes && line.separated_at) {
      return dividirALinhaSeparada(
        transaction,
        db,
        { input, partes: input.split_volumes, task, line, refs: { task: taskRef, line: lineRef, op: opRef }, inputHash, occurredAt, pedido, produto },
        actor,
      );
    }
    const novo = input.separated ? separadoDaLinha(pedido, input, produto) : null;
    const estava = Boolean(line.separated_at);
    // Separar de novo a linha já separada só muda algo se a quantidade, o motivo ou as caixas informadas mudaram.
    const mudouALinha = novo
      ? !estava ||
        quantity(line.separated_qty) !== novo.separado ||
        text(line.separated_shortage_reason) !== (novo.motivo ?? "") ||
        text(line.separated_shortage_detail) !== (novo.detalhe ?? "")
      : estava;
    const customerCode = text(task.customer_code) || text(line.customer_code);
    // "Dividir em volumes" na linha por separar (parte 7a): separa como
    // "Separar", e a linha vai nos volumes pedidos em vez de ir toda no
    // aberto. Ela ainda não está em volume nenhum: a divisão parte dos
    // volumes gravados, e é conferida antes de ler as caixas. A tela que
    // mostrou a linha separada recusa: outra pessoa a desfez depois.
    if (input.split_volumes) conferirALinhaDaTela(input, line);
    const divisao = input.split_volumes
      ? dividirConferido(volumesDe(task), volumesDe(task), input, input.split_volumes, { qty: pedido, noVolumeAberto: false }, { at: occurredAt, by: actorFields(actor) })
      : null;

    // A caixa (parte 3b): o que a linha tinha tirado volta às caixas, e o
    // novo separado sai delas de novo. Tudo lido antes de qualquer escrita.
    const skuCode = text(line.sku_code);
    const locationId = text(line.location_id);
    const anteriores = estava ? caixasGravadas(line.separated_boxes) : [];
    const tira = novo ? novo.separado : 0;
    const informadas = novo !== null && input.boxes !== undefined ? input.boxes : undefined;
    const informou = informadas !== undefined;
    const naPrateleira = Boolean(skuCode && locationId && customerCode);
    if (informadas?.length && !naPrateleira) {
      throw new HttpsError("failed-precondition", "Esta linha não tem prateleira para informar a caixa.");
    }
    let caixas: CaixaDaLinha[] = [];
    let semCaixa = tira;
    let mudaramAsCaixas = false;
    const retirados = new Map<string, LinhaDaCaixa[]>();
    const tocadas = new Map<string, { ref: DocumentReference<DocumentData>; data: Row }>();
    if ((mudouALinha || informou) && naPrateleira && (tira > 0 || anteriores.length || informadas?.length)) {
      const prateleira = await lerCaixasDaPrateleira(transaction, db, { customerCode, locationId, skuCode });
      const tirar = (codigo: string, qty: number) => {
        const box = prateleira.porCodigo.get(codigo);
        // A caixa que saiu do cadastro não tem mais o que devolver.
        if (!box) return;
        retirados.set(codigo, retiradoCom(retirados.get(codigo) ?? retiradoDaCaixa(box), skuCode, qty));
        tocadas.set(codigo, { ref: box.ref, data: box.data });
      };
      for (const anterior of anteriores) tirar(anterior.box_code, -anterior.qty);
      if (tira > 0 || informadas?.length) {
        const candidatas = caixasComOItem(prateleira, retirados, skuCode);
        const conta = informadas ? conferirCaixasInformadas(tira, informadas, candidatas) : sugerirCaixas(tira, candidatas);
        if ("problema" in conta) {
          throw new HttpsError("failed-precondition", conta.problema, { code: "SEPARATION_BOXES_MISMATCH" });
        }
        caixas = conta.caixas;
        semCaixa = conta.sem_caixa;
        for (const caixa of caixas) tirar(caixa.box_code, caixa.qty);
      }
      mudaramAsCaixas = !mesmasCaixas(anteriores, caixas);
    }
    const changed = mudouALinha || (informou && mudaramAsCaixas);
    // "Levar a caixa": só a caixa que sai inteira nesta linha vira volume.
    if (novo && changed && input.take_boxes && !caixas.some((caixa) => caixa.inteira)) {
      throw new HttpsError("failed-precondition", "Nenhuma caixa sai inteira nesta linha. Atualize e tente de novo.", { code: "SEPARATION_BOX_NOT_WHOLE" });
    }

    // Os volumes (parte 4a): o que a linha tinha posto neles sai, e o novo
    // separado entra no volume aberto; a caixa levada inteira vira um volume.
    const volumesAntes = volumesDe(task);
    const numeroAntes = new Map(volumesAntes.volumes.map((volume) => [volume.id, volume.number]));
    const nosVolumesAntes = estava ? volumesDaLinha(line.separated_volumes) : [];
    const semALinha = tirarDosVolumes(volumesAntes, changed ? nosVolumesAntes : []);
    let volumesDepois: EstadoDosVolumes = { volumes: semALinha.volumes, seq: semALinha.seq };
    const nosVolumes: NoVolume[] = [];
    if (changed && novo && novo.separado > 0) {
      let noAberto = novo.separado;
      if (input.take_boxes) {
        for (const caixa of caixas) {
          if (!caixa.inteira) continue;
          const levada = caixaViraVolume(volumesDepois, {
            box_code: caixa.box_code,
            qty: caixa.qty,
            weight_kg: quantity(tocadas.get(caixa.box_code)?.data.gross_weight_kg),
            at: occurredAt,
            by: actorFields(actor),
          });
          volumesDepois = { volumes: levada.volumes, seq: levada.seq };
          nosVolumes.push({ volume_id: levada.volume_id, qty: caixa.qty });
          noAberto -= caixa.qty;
        }
      }
      if (divisao) {
        // As partes da divisão: cada uma, menos a última, fechou um volume; a última ficou aberta.
        volumesDepois = { volumes: divisao.volumes, seq: divisao.seq };
        nosVolumes.push(...divisao.entradas);
      } else if (noAberto > 0) {
        const aberto = porNoVolumeAberto(volumesDepois, noAberto);
        volumesDepois = { volumes: aberto.volumes, seq: aberto.seq };
        nosVolumes.push({ volume_id: aberto.volume_id, qty: noAberto });
      }
    }
    const numeroDepois = new Map(volumesDepois.volumes.map((volume) => [volume.id, volume]));
    const mudaramOsVolumes = volumesDepois.seq !== volumesAntes.seq || JSON.stringify(volumesDepois.volumes) !== JSON.stringify(volumesAntes.volumes);
    // A caixa que virou volume guarda o número dele (o Mapa diz "PED-0001,
    // volume 11"): a do volume que mudou de número acompanha. Lida antes de
    // qualquer escrita; a que saiu do cadastro fica de fora.
    const caixasRenumeradas = (
      await Promise.all(
        semALinha.renumerados.flatMap((renumerado) => {
          const volume = numeroDepois.get(renumerado.id);
          return volume?.box_code
            ? [transaction.get(db.collection(WAREHOUSE_BOXES_COLLECTION).doc(volume.box_code)).then((snapshot) => ({ snapshot, number: volume.number }))]
            : [];
        }),
      )
    ).filter(({ snapshot }) => snapshot.exists);

    const events: unknown[] = [];
    if (changed) {
      const pedidoDaCaixa = clean({ order_id: text(task.order_id) || text(line.order_id) || undefined, order_number: text(task.order_number) || text(line.order_number) || undefined });
      // O saldo das caixas: o retirado de cada uma como ficou. A caixa a que tudo voltou fica intacta de novo.
      for (const [codigo, box] of tocadas) {
        const retirado = retirados.get(codigo) ?? [];
        const tirou = unidadesDaCaixa(retirado);
        const entrou = quantity(box.data.unit_count);
        const estavaVazia = text(box.data.status) === BOX_STATUS_EMPTIED;
        const vazia = entrou > 0 && tirou >= entrou;
        const inteira = caixas.some((caixa) => caixa.box_code === codigo && caixa.inteira);
        const update: Row = retirado.length
          ? { taken_lines: retirado, taken_units: tirou, balance_at: occurredAt, updated_at: FieldValue.serverTimestamp() }
          : { taken_lines: FieldValue.delete(), taken_units: FieldValue.delete(), balance_at: FieldValue.delete(), updated_at: FieldValue.serverTimestamp() };
        if (vazia && !estavaVazia) {
          // A caixa levada como volume ("Levar a caixa") diz qual volume ela é.
          const doVolume = volumesDepois.volumes.find((volume) => volume.box_code === codigo);
          // A caixa vazia sai da prateleira: fica o registro de quando, em qual pedido e se saiu inteira.
          Object.assign(update, {
            status: BOX_STATUS_EMPTIED,
            emptied_at: occurredAt,
            emptied_by: actorFields(actor),
            emptied_whole: inteira,
            emptied_pick_line_id: input.pick_line_id,
            emptied_order_id: pedidoDaCaixa.order_id ?? FieldValue.delete(),
            emptied_order_number: pedidoDaCaixa.order_number ?? FieldValue.delete(),
            emptied_volume_id: doVolume?.id ?? FieldValue.delete(),
            emptied_volume_number: doVolume?.number ?? FieldValue.delete(),
          });
        } else if (!vazia && estavaVazia) {
          Object.assign(update, {
            status: BOX_STATUS_STORED,
            emptied_at: FieldValue.delete(),
            emptied_by: FieldValue.delete(),
            emptied_whole: FieldValue.delete(),
            emptied_pick_line_id: FieldValue.delete(),
            emptied_order_id: FieldValue.delete(),
            emptied_order_number: FieldValue.delete(),
            emptied_volume_id: FieldValue.delete(),
            emptied_volume_number: FieldValue.delete(),
          });
        }
        transaction.update(box.ref, update);
        if (vazia !== estavaVazia) {
          events.push(
            createEvent(
              transaction,
              db,
              `evt_${digest({ operationId: opRef.id, suffix: vazia ? "box_emptied" : "box_reopened", box: codigo })}`,
              {
                type: vazia ? "warehouse.box_emptied" : "warehouse.box_reopened",
                title: vazia ? (inteira ? `Caixa ${codigo} saiu inteira` : `Caixa ${codigo} vazia`) : `Caixa ${codigo} de volta à prateleira`,
                description: [codigo, locationId, pedidoDaCaixa.order_number ? `pedido ${pedidoDaCaixa.order_number}` : ""].filter(Boolean).join(" · "),
                severity: "info",
                inbox: false,
                entity_type: "warehouse_boxes",
                entity_id: codigo,
                customer_code: customerCode,
                occurred_at: occurredAt,
                payload: clean({ box_code: codigo, location_id: locationId, ...pedidoDaCaixa, pick_line_id: input.pick_line_id, whole: vazia ? inteira : undefined }),
                source: EVENT_SOURCE,
              },
              actor,
            ),
          );
        }
      }
      transaction.update(
        lineRef,
        novo
          ? {
              separated_qty: novo.separado,
              separated_at: occurredAt,
              separated_by: actorFields(actor),
              separated_shortage_reason: novo.motivo ?? FieldValue.delete(),
              separated_shortage_detail: novo.detalhe ?? FieldValue.delete(),
              separated_boxes: caixas.length ? paraGravar(caixas) : FieldValue.delete(),
              separated_volumes: nosVolumes.length ? nosVolumes : FieldValue.delete(),
              updated_at: FieldValue.serverTimestamp(),
            }
          : {
              separated_qty: FieldValue.delete(),
              separated_at: FieldValue.delete(),
              separated_by: FieldValue.delete(),
              separated_shortage_reason: FieldValue.delete(),
              separated_shortage_detail: FieldValue.delete(),
              separated_boxes: FieldValue.delete(),
              separated_volumes: FieldValue.delete(),
              updated_at: FieldValue.serverTimestamp(),
            },
      );
      const naTarefa: Row = {};
      // "em separação desde 10/11": a primeira linha separada data o começo.
      if (novo && !task.separation_started_at) {
        Object.assign(naTarefa, { separation_started_at: occurredAt, separation_started_by: actorFields(actor) });
      }
      if (mudaramOsVolumes) Object.assign(naTarefa, { volumes: volumesDepois.volumes, volume_seq: volumesDepois.seq });
      if (Object.keys(naTarefa).length) transaction.update(taskRef, { ...naTarefa, updated_at: FieldValue.serverTimestamp() });
      for (const { snapshot, number } of caixasRenumeradas) {
        transaction.update(snapshot.ref, { emptied_volume_number: number, updated_at: FieldValue.serverTimestamp() });
      }
      const pedidoNumero = text(task.order_number) || text(line.order_number);
      const aMenos = novo && novo.separado < pedido ? pedido - novo.separado : 0;
      events.push(
        createEvent(
          transaction,
          db,
          `evt_${digest({ operationId: opRef.id, suffix: novo ? "line_separated" : "line_unseparated" })}`,
          {
            type: novo ? "picking.line_separated" : "picking.line_unseparated",
            title: novo ? `Linha separada do pedido ${pedidoNumero}` : `Separação da linha desfeita no pedido ${pedidoNumero}`,
            description: novo
              ? `${novo.separado}${aMenos ? ` de ${pedido}` : ""} un. de ${produto} · ${text(line.location_id) || "sem endereço"}`
              : `${produto} · ${text(line.location_id) || "sem endereço"}`,
            severity: "info",
            // Um pedido tem mais de cem linhas: o evento fica na trilha, fora da caixa de avisos.
            inbox: false,
            entity_type: PICK_TASKS_COLLECTION,
            entity_id: input.pick_task_id,
            customer_code: customerCode,
            occurred_at: occurredAt,
            payload: clean({
              order_id: text(task.order_id) || text(line.order_id) || undefined,
              order_number: pedidoNumero || undefined,
              pick_line_id: input.pick_line_id,
              line_number: quantity(line.line_number) || undefined,
              sku_code: text(line.sku_code) || undefined,
              client_item_code: text(line.client_item_code) || undefined,
              location_id: text(line.location_id) || undefined,
              expected_qty: pedido,
              quantity: novo ? novo.separado : undefined,
              short_qty: aMenos || undefined,
              shortage_reason: novo?.motivo,
              shortage_detail: novo?.detalhe,
              // De quais caixas saiu (ou, no desfazer, a quais voltou).
              boxes: (novo ? caixas : anteriores).length ? (novo ? caixas : anteriores).map((caixa) => ({ box_code: caixa.box_code, qty: caixa.qty })) : undefined,
              // Em quais volumes entrou (ou, no desfazer, de quais saiu), com o número de então.
              volumes: novo
                ? nosVolumes.length
                  ? nosVolumes.map((entrada) => ({ volume_number: numeroDepois.get(entrada.volume_id)?.number, qty: entrada.qty }))
                  : undefined
                : nosVolumesAntes.length
                  ? nosVolumesAntes.map((entrada) => ({ volume_number: numeroAntes.get(entrada.volume_id), qty: entrada.qty }))
                  : undefined,
            }),
            source: EVENT_SOURCE,
          },
          actor,
        ),
      );
      // Cada volume que a divisão fechou grava o mesmo evento do "Fechar volume".
      if (divisao) {
        const doPedido: PedidoDoVolume = {
          pickTaskId: input.pick_task_id,
          orderId: text(task.order_id) || text(line.order_id),
          orderNumber: pedidoNumero,
          customerCode,
          occurredAt,
        };
        for (const volume of divisao.fechados) {
          events.push(eventoDoVolumeFechado(transaction, db, `evt_${digest({ operationId: opRef.id, suffix: "volume_closed", volume: volume.id })}`, volume, doPedido, actor));
        }
      }
    }

    const result = clean({
      ok: true,
      pick_task_id: input.pick_task_id,
      pick_line_id: input.pick_line_id,
      separated: input.separated,
      changed,
      expected_qty: pedido,
      separated_qty: novo ? novo.separado : 0,
      shortage_reason: novo?.motivo,
      separated_at: novo ? (changed ? occurredAt : text(line.separated_at)) : undefined,
      // De onde saiu: as caixas e o que saiu sem caixa.
      boxes: novo && changed ? (caixas.length ? paraGravar(caixas) : undefined) : novo && anteriores.length ? anteriores : undefined,
      loose_qty: novo && changed && semCaixa > 0 ? semCaixa : undefined,
      // Em quais volumes a linha está, com o número de agora.
      volumes: novo ? emQuaisVolumes(changed ? nosVolumes : nosVolumesAntes, volumesDepois) : undefined,
      // O volume fechado que mudou de número, e o fechado de que saiu uma parte: a etiqueta deles precisa sair de novo.
      renumbered_volumes: semALinha.renumerados.length ? semALinha.renumerados.map((volume) => ({ volume_id: volume.id, from: volume.de, to: volume.para })) : undefined,
      changed_volumes: volumesMudados(semALinha.alterados, volumesDepois),
      // O volume fechado que esvaziou e saiu, com o número que tinha: a etiqueta dele sai junto.
      removed_volumes: semALinha.removidos.length ? semALinha.removidos.map((volume) => ({ volume_id: volume.id, number: volume.number })) : undefined,
      // Os volumes que a divisão fechou (parte 7a).
      closed_volumes: volumesFechados(divisao?.fechados ?? []),
      events,
    });
    transaction.create(opRef, {
      id: opRef.id,
      kind: input.separated ? "picking.line.separate" : "picking.line.unseparate",
      target_id: input.pick_line_id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

/**
 * "Fechar volume": o volume aberto fecha com o que tem, e o peso é opcional
 * (decisão 15). O volume seguinte abre sozinho, na próxima linha separada. A
 * etiqueta do volume sai aqui, sem o total (decisão 12). Não é escrita de
 * saldo: não confere o congelamento do estoque.
 */
export async function closeOrderVolume(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = parse(CloseOrderVolumeSchema, raw);
  const taskRef = db.collection(PICK_TASKS_COLLECTION).doc(input.pick_task_id);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_pick_volume_${digest({ task: input.pick_task_id, volume: input.volume_id, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);
  const occurredAt = new Date().toISOString();
  const weightKg = pesoDoVolume(input.weight_kg);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Row;
    }
    const taskSnapshot = await transaction.get(taskRef);
    if (!taskSnapshot.exists) throw new HttpsError("not-found", "Separação não encontrada.");
    const task = taskSnapshot.data() ?? {};
    assertSeparating(text(task.status).toLowerCase());
    const antes = volumesDe(task);
    const problema = problemaParaFechar(antes.volumes, input.volume_id);
    if (problema) throw new HttpsError("failed-precondition", problema, { code: "VOLUME_NOT_CLOSABLE" });
    const depois = fecharVolume(antes, input.volume_id, { weight_kg: weightKg, at: occurredAt, by: actorFields(actor) });
    const volume = depois.volumes.find((candidate) => candidate.id === input.volume_id)!;
    transaction.update(taskRef, { volumes: depois.volumes, volume_seq: depois.seq, updated_at: FieldValue.serverTimestamp() });

    const customerCode = text(task.customer_code);
    const event = eventoDoVolumeFechado(
      transaction,
      db,
      `evt_${digest({ operationId: opRef.id, suffix: "volume_closed" })}`,
      volume,
      { pickTaskId: input.pick_task_id, orderId: text(task.order_id), orderNumber: text(task.order_number), customerCode, occurredAt },
      actor,
    );
    const result = clean({
      ok: true,
      pick_task_id: input.pick_task_id,
      volume_id: volume.id,
      volume_number: volume.number,
      units: volume.units,
      weight_kg: volume.weight_kg,
      closed_at: occurredAt,
      events: [event],
    });
    transaction.create(opRef, {
      id: opRef.id,
      kind: "picking.volume.close",
      target_id: input.pick_task_id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

/**
 * A conclusão anda por três transições (separação concluída, embalagem
 * iniciada e fechada). Cada volta lê o ponto em que o pedido está e faz o que
 * falta; a transição que outra pessoa fez no mesmo instante recusa pelo status,
 * e a volta seguinte continua do que encontrou. Cada recusa dessas é um passo
 * que já andou, então quatro voltas bastam.
 */
const VOLTAS_DA_CONCLUSAO = 4;

/**
 * Concluir a separação: a separação e a embalagem numa chamada. Cada passo é
 * a transição de sempre, com a chave derivada da chave da chamada; se um passo
 * falha, repetir a chamada continua de onde parou (o passo já feito é pulado
 * pelo status). O pedido que outra pessoa já concluiu só responde "feito" a
 * quem informou o mesmo lacre; com outro, recusa e diz o lacre gravado.
 */
export async function completeOrderSeparation(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = parse(CompleteOrderSeparationSchema, raw);
  for (let volta = 1; ; volta += 1) {
    try {
      return await concluirDeOndeEsta(db, input, actor);
    } catch (error) {
      if (volta >= VOLTAS_DA_CONCLUSAO || !statusMudou(error)) throw error;
    }
  }
}

async function concluirDeOndeEsta(db: Firestore, input: z.infer<typeof CompleteOrderSeparationSchema>, actor: OperationalActor) {
  const taskRef = db.collection(PICK_TASKS_COLLECTION).doc(input.pick_task_id);
  const taskSnapshot = await taskRef.get();
  if (!taskSnapshot.exists) throw new HttpsError("not-found", "Separação não encontrada.");
  const task = taskSnapshot.data() ?? {};
  const orderId = text(task.order_id);
  const status = text(task.status).toLowerCase();
  if (status === "cancelled") throw new HttpsError("failed-precondition", "Pedido cancelado.");
  if (status === "planned") throw new HttpsError("failed-precondition", "A separação ainda não começou.");
  if (!orderId) throw new HttpsError("failed-precondition", "Separação sem pedido válido.");
  const step = (name: string) => `${input.idempotency_key}:${name}`;

  if (status === "in_progress") {
    const lines = await db.collection(PICK_LINES_COLLECTION).where("pick_task_id", "==", input.pick_task_id).get();
    const conferidas = linhasParaConcluir(
      lines.docs.map((doc) => linhaDoProgresso(doc.id, doc.data())),
      actor.role,
    );
    await advanceWarehouseTaskTransaction(
      db,
      { task_uid: `picking:${input.pick_task_id}`, expected_status: "in_progress", idempotency_key: step("picking"), operation: { picking_lines: conferidas } },
      actor,
    );
  }

  // A embalagem nasce quando a separação termina.
  const packs = await db.collection(PACK_TASKS_COLLECTION).where("order_id", "==", orderId).get();
  const pack = packs.docs.find((doc) => text(doc.get("status")).toLowerCase() !== "cancelled");
  if (!pack) throw new HttpsError("failed-precondition", "A embalagem do pedido não foi criada. Atualize e tente de novo.");
  const packUid = `packing:${pack.id}`;
  let packStatus = text(pack.get("status")).toLowerCase();
  let shipmentId: string | undefined;
  if (packStatus === "completed") {
    // A remessa nasceu com a embalagem fechada: a repetição da chamada a devolve também.
    const remessas = await db.collection(SHIPMENTS_COLLECTION).where("order_id", "==", orderId).get();
    shipmentId = remessas.docs.find((doc) => text(doc.get("status")).toLowerCase() !== "cancelled")?.id;
    // Já concluído: é a repetição da mesma chamada, ou outra pessoa concluiu antes.
    const lacre = text(pack.get("seal_code"));
    if (lacre !== input.seal_code) {
      throw new HttpsError("failed-precondition", `A separação deste pedido já foi concluída${lacre ? `, com o lacre ${lacre}` : ""}.`, {
        code: "SEPARATION_ALREADY_COMPLETED",
      });
    }
  }
  if (packStatus === "ready") {
    await advanceWarehouseTaskTransaction(db, { task_uid: packUid, expected_status: "ready", idempotency_key: step("packing-start") }, actor);
    packStatus = "in_progress";
  }
  if (packStatus === "in_progress") {
    // O item que a separação a menos zerou não se embala.
    const [items, lines, concluida] = await Promise.all([
      db.collection(ORDER_ITEMS_COLLECTION).where("order_id", "==", orderId).get(),
      db.collection(PICK_LINES_COLLECTION).where("pick_task_id", "==", input.pick_task_id).get(),
      // Com a separação concluída, os volumes não mudam mais: é a leitura que vale.
      taskRef.get(),
    ]);
    const packingLines = items.docs
      .map((doc) => ({ order_item_id: doc.id, qty_packed: quantity(doc.get("picked_qty")), status: "confirmed" }))
      .filter((line) => line.qty_packed > 0);
    // Os volumes da bancada (parte 4a): a linha e o item do pedido andam pelo
    // número da linha. A conta parte dos itens que a embalagem confere: o que um
    // item separou e a linha dele não pôs em volume vai no volume aberto, e os
    // volumes sempre fecham com o separado.
    const volumesDaLinhaDe = new Map(lines.docs.map((doc) => [quantity(doc.get("line_number")), volumesDaLinha(doc.get("separated_volumes"))]));
    const nosVolumes: LinhaNosVolumes[] = items.docs
      .map((doc) => ({
        order_item_id: doc.id,
        qty: quantity(doc.get("picked_qty")),
        volumes: volumesDaLinhaDe.get(quantity(doc.get("line_number"))) ?? [],
      }))
      .filter((linha) => linha.qty > 0);
    const volumes = volumesParaConcluir(volumesDe(concluida.data() ?? {}), nosVolumes, { at: new Date().toISOString(), by: actorFields(actor) });
    const packed = (await advanceWarehouseTaskTransaction(
      db,
      {
        task_uid: packUid,
        expected_status: "in_progress",
        idempotency_key: step("packing"),
        operation: volumes.length
          ? {
              packing_lines: packingLines,
              seal_code: input.seal_code,
              volumes: volumes.map((volume) =>
                clean({ number: volume.number, weight_kg: volume.weight_kg, box_code: volume.box_code, closed_at: volume.closed_at, closed_by: volume.closed_by, items: volume.items }),
              ),
            }
          : // O pedido separado antes dos volumes fecha no volume único de sempre.
            { packing_lines: packingLines, package_count: 1, volume_label: "VOL-1", seal_code: input.seal_code },
      },
      actor,
    )) as Row;
    shipmentId = text(packed.shipment_id) || shipmentId;
  }

  return clean({
    ok: true,
    pick_task_id: input.pick_task_id,
    order_id: orderId,
    pack_task_id: pack.id,
    shipment_id: shipmentId,
    seal_code: input.seal_code,
  });
}
