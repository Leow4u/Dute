import { httpsCallable } from "firebase/functions";

import { firebaseApp } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { mensagemDoErro } from "../operacao/api";
import type { SuggestionResult } from "../warehouse-boxes";

/**
 * A chegada por caixa no app (docs/plataforma/recebimento-com-caixas.md,
 * parte 5; mockups aprovados em 03/11/2026): as chamadas às callables do WMS
 * (functions/wms/src/domain/inbound-boxes.ts) e as regras que a tela mostra
 * antes de chamar. As regras espelham as do servidor
 * (functions/wms/src/domain/inbound-box-entry.ts, entradaPorCaixa): a tela só
 * avisa antes; quem recusa é o servidor, com a frase dele.
 */

/** Uma linha da NF dentro da caixa, como a caixa grava (`lines[]`). */
export type LinhaDaCaixa = {
  inbound_item_id: string;
  line_number: number;
  sku_code: string;
  client_item_code: string;
  product_name: string;
  size: string | null;
  counted_qty: number;
};

/** A caixa da chegada, lida de `warehouse_boxes` com o `receipt_id` dela. */
export type CaixaDaChegada = {
  code: string;
  /** counting (em conferência), reviewed (fechada), committing (destino confirmado) ou stored (guardada). */
  status: string;
  /** A prateleira reservada (committing) ou onde a caixa está (stored); vazio antes. */
  location_id: string;
  lines: LinhaDaCaixa[];
  unit_count: number;
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
  gross_weight_kg: number | null;
  allow_tilt: boolean;
  allow_stacking: boolean;
  /** A revisão que a próxima escrita tem de mandar (`expected_revision`). */
  conference_revision: number;
  /** As prateleiras recusadas nesta caixa ("Não cabe aqui"), fora da sugestão. */
  refused_positions: string[];
};

/** A falta marcada na linha da NF (parte 4c): vale para o que estava nas caixas. */
export type FaltaMarcada = {
  qty: number;
  boxed_qty: number;
  expected_qty: number;
  reason: "falta" | "avaria";
  detail?: string;
};

/** O que a tela precisa de uma linha da NF da chegada por caixa. */
export type LinhaDaNf = {
  id: string;
  line_number?: number | null;
  expected_quantity?: number | null;
  quantity?: number | null;
  boxed_qty?: number | null;
  box_codes?: string[] | null;
  shortage?: FaltaMarcada | Record<string, unknown> | null;
};

/** Três casas, como o estoque e o servidor contam. */
export function emTresCasas(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function quantidade(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? emTresCasas(parsed) : 0;
}

/**
 * O modo que a chegada avulsa pede (parte 5g, decisão 1): por caixa só onde a
 * liberação vale (RECEBIMENTO_POR_CAIXA_LIBERADO, lib/liberacao.ts) e para o
 * cliente cujo modelo confere por caixa; senão, por linha (sem o campo). O
 * servidor confere os dois de novo na criação.
 */
export function modoDaChegadaAvulsa(
  liberado: boolean,
  modelo: { inboundConference?: string | null } | null | undefined,
): "per_box" | undefined {
  return liberado && modelo?.inboundConference === "per_box" ? "per_box" : undefined;
}

/** A chegada é conferida por caixa: a tela da parte 5, não a conferência por linha. */
export function chegadaPorCaixa(task: { conference_mode?: string | null } | null | undefined): boolean {
  return task?.conference_mode === "per_box";
}

export type SituacaoDaLinha =
  | { tipo: "ok" }
  | { tipo: "faltam"; quantidade: number }
  | { tipo: "sobram"; quantidade: number }
  | { tipo: "falta_marcada"; quantidade: number; motivo: "falta" | "avaria"; detalhe: string }
  /** A marca foi feita para outra quantidade nas caixas: o servidor não a aceita mais. */
  | { tipo: "marca_velha"; quantidade: number };

/**
 * A situação da linha da NF (o "Físico" derivado e a divergência automática
 * da parte 5): o que está nas caixas contra o que a NF pede, e a falta
 * marcada só vale se foi feita para o que está nas caixas agora.
 */
export function situacaoDaLinha(linha: LinhaDaNf): SituacaoDaLinha {
  const nasCaixas = quantidade(linha.boxed_qty);
  const previsto = quantidade(linha.expected_quantity ?? linha.quantity);
  const diferenca = emTresCasas(nasCaixas - previsto);
  if (diferenca === 0) return { tipo: "ok" };
  if (diferenca > 0) return { tipo: "sobram", quantidade: diferenca };
  const marca = linha.shortage && typeof linha.shortage === "object" ? (linha.shortage as Record<string, unknown>) : null;
  if (!marca) return { tipo: "faltam", quantidade: -diferenca };
  if (quantidade(marca.boxed_qty) !== nasCaixas) return { tipo: "marca_velha", quantidade: -diferenca };
  return {
    tipo: "falta_marcada",
    quantidade: -diferenca,
    motivo: marca.reason === "avaria" ? "avaria" : "falta",
    detalhe: typeof marca.detail === "string" ? marca.detail : "",
  };
}

/**
 * O que ainda impede "Concluir entrada", na ordem em que o servidor recusa:
 * nenhuma caixa (decisão 19), a caixa vazia (decisão 18), a caixa em
 * conferência e a linha a menos sem a falta marcada para o que está nas
 * caixas. A caixa sem prateleira não impede (decisão 14), e a justificativa
 * da divergência é pedida à parte (`pedeJustificativa`).
 */
export function bloqueiosDaConclusao(caixas: readonly CaixaDaChegada[], linhas: readonly LinhaDaNf[]): string[] {
  if (!caixas.length) return ["Nenhuma caixa"];
  const bloqueios: string[] = [];
  for (const caixa of [...caixas].sort((esquerda, direita) => esquerda.code.localeCompare(direita.code))) {
    if (!caixa.lines.length) bloqueios.push(`${caixa.code} vazia`);
    else if (caixa.status === "counting") bloqueios.push(`${caixa.code} em conferência`);
  }
  for (const linha of [...linhas].sort((esquerda, direita) => (Number(esquerda.line_number) || 0) - (Number(direita.line_number) || 0))) {
    const situacao = situacaoDaLinha(linha);
    if (situacao.tipo === "faltam" || situacao.tipo === "marca_velha") {
      bloqueios.push(`linha ${Number(linha.line_number) || "?"} sem falta marcada`);
    }
  }
  return bloqueios;
}

/** Com falta ou sobra em alguma linha, o servidor só conclui com a justificativa. */
export function pedeJustificativa(linhas: readonly LinhaDaNf[]): boolean {
  return linhas.some((linha) => situacaoDaLinha(linha).tipo !== "ok");
}

/** O rótulo do motivo da falta marcada (parte 4c). */
export const MOTIVO_DA_FALTA: Record<FaltaMarcada["reason"], string> = { falta: "Falta", avaria: "Avaria" };

export type TotaisDaChegada = {
  esperado: number;
  emCaixas: number;
  /** O que a NF pede e não está em caixa nem tem a falta marcada. */
  semCaixa: number;
  faltaMarcada: number;
};

/**
 * Os totais da chegada, linha a linha: a sobra de uma linha não cobre a
 * falta de outra, e a falta marcada sai do que está sem caixa.
 */
export function totaisDaChegada(linhas: readonly LinhaDaNf[]): TotaisDaChegada {
  const totais: TotaisDaChegada = { esperado: 0, emCaixas: 0, semCaixa: 0, faltaMarcada: 0 };
  for (const linha of linhas) {
    totais.esperado += quantidade(linha.expected_quantity ?? linha.quantity);
    totais.emCaixas += quantidade(linha.boxed_qty);
    const situacao = situacaoDaLinha(linha);
    if (situacao.tipo === "faltam" || situacao.tipo === "marca_velha") totais.semCaixa += situacao.quantidade;
    if (situacao.tipo === "falta_marcada") totais.faltaMarcada += situacao.quantidade;
  }
  return {
    esperado: emTresCasas(totais.esperado),
    emCaixas: emTresCasas(totais.emCaixas),
    semCaixa: emTresCasas(totais.semCaixa),
    faltaMarcada: emTresCasas(totais.faltaMarcada),
  };
}

/** A chegada só espera a justificativa: as caixas e as linhas já estão tratadas, e há falta ou sobra. */
export function esperaJustificativa(caixas: readonly CaixaDaChegada[], linhas: readonly LinhaDaNf[]): boolean {
  return bloqueiosDaConclusao(caixas, linhas).length === 0 && pedeJustificativa(linhas);
}

/**
 * O que impede o "Concluir entrada" na tela: o que o servidor recusa e,
 * quando só falta isso, a justificativa da divergência em branco (mockups
 * WmsRecebimentoCaixa e WmsRecebimentoConcluir).
 */
export function bloqueiosDaTela(caixas: readonly CaixaDaChegada[], linhas: readonly LinhaDaNf[], justificativa: string): string[] {
  const bloqueios = bloqueiosDaConclusao(caixas, linhas);
  if (esperaJustificativa(caixas, linhas) && !justificativa.trim()) bloqueios.push("divergência sem justificativa");
  return bloqueios;
}

export type EstadoDaCaixa = {
  /** O texto do selo da caixa na ficha. */
  rotulo: string;
  tom: "amb" | "grn" | "mut";
};

/** O selo da caixa na ficha da chegada (mockups WmsRecebimentoCaixa e WmsRecebimentoConcluir). */
export function estadoDaCaixa(caixa: Pick<CaixaDaChegada, "status" | "location_id">): EstadoDaCaixa {
  if (["cancelled", "canceled"].includes(caixa.status)) return { rotulo: "cancelada", tom: "mut" };
  if (caixa.status === "counting") return { rotulo: "em conferência", tom: "amb" };
  if (caixa.status === "reviewed") return { rotulo: "sem prateleira", tom: "amb" };
  if (caixa.status === "committing") return { rotulo: "destino confirmado", tom: "grn" };
  if (caixa.status === "stored") return { rotulo: caixa.location_id ? `guardada em ${caixa.location_id}` : "guardada", tom: "mut" };
  return { rotulo: caixa.status || "sem estado", tom: "mut" };
}

/** "0 de 2 caixas guardadas": a chegada recebida fica em aberto até a última guarda (decisão 5). */
export function caixasGuardadas(task: { box_count?: number | null; boxes_stored?: number | null }): string {
  const total = Number(task.box_count) || 0;
  const guardadas = Math.min(total, Number(task.boxes_stored) || 0);
  return `${guardadas} de ${total} ${total === 1 ? "caixa guardada" : "caixas guardadas"}`;
}

// ------------------------------------------------------------- chamadas

type NomeDaCallable =
  | "startInboundBox"
  | "saveInboundBoxLine"
  | "setInboundBoxState"
  | "suggestInboundBoxPosition"
  | "refuseInboundBoxPosition"
  | "confirmInboundBoxDestination"
  | "removeInboundBox"
  | "markInboundBoxShortage"
  | "completeInboundBoxReceipt"
  | "storeInboundBox"
  | "refuseInboundBoxShelf";

async function chamarWms<T>(nome: NomeDaCallable, dados: Record<string, unknown>): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, T>(functionsDoApp(firebaseApp), nome);
  try {
    return (await callable(dados)).data;
  } catch (error) {
    // A UI precisa distinguir recusa do servidor de resposta perdida no transporte:
    // só a primeira permite substituir a chave da tentativa após reler a revisão.
    throw Object.assign(new Error(mensagemDoErro(error), { cause: error }), {
      code: String((error as { code?: unknown } | null)?.code ?? ""),
    });
  }
}

/** Rejeições explícitas não confirmam escrita; erro de rede/timeout mantém o pedido exato. */
export function pedidoFoiRejeitado(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  return ["failed-precondition", "aborted", "invalid-argument", "permission-denied", "unauthenticated", "not-found", "already-exists", "out-of-range"].includes(code);
}

/** A chegada e seu cliente (o servidor recusa quando o cliente informado não é o dono). */
export type DaChegada = { receipt_id: string; customer_code?: string };

/** A caixa e a revisão que a tela viu: a escrita com revisão velha é recusada. */
export type DaCaixa = DaChegada & { box_code: string; expected_revision: number; idempotency_key: string };

export type Resultado = Record<string, unknown> & { ok?: boolean };

/** Devolve a caixa criada (`box.code`), já em conferência. */
export function iniciarCaixa(input: DaChegada & { idempotency_key: string }) {
  return chamarWms<Resultado & { box?: { code?: string } }>("startInboundBox", input);
}

/** Lança (ou acerta) a quantidade de uma linha da NF na caixa; 0 tira o produto da caixa. */
export function lancarNaCaixa(input: DaCaixa & { inbound_item_id: string; counted_qty: number }) {
  return chamarWms<Resultado>("saveInboundBoxLine", input);
}

/** Fecha a caixa com as medidas (em metros) e o peso da balança (em quilos). */
export function fecharCaixa(
  input: DaCaixa & {
    length_m: number;
    width_m: number;
    height_m: number;
    gross_weight_kg: number;
    allow_tilt: boolean;
    allow_stacking: boolean;
  },
) {
  return chamarWms<Resultado>("setInboundBoxState", { ...input, action: "close" });
}

/** Só a caixa fechada e sem destino reabre. */
export function reabrirCaixa(input: DaCaixa) {
  return chamarWms<Resultado>("setInboundBoxState", { ...input, action: "reopen" });
}

/** Só lê: a prateleira que o motor sugere, ou a prévia de uma escolhida. */
export function sugerirPrateleira(input: DaChegada & { box_code: string; location_id?: string; exclude?: string[] }) {
  return chamarWms<SuggestionResult & { refused?: string[] }>("suggestInboundBoxPosition", input);
}

/** "Não cabe aqui" antes de confirmar: a prateleira sai da escolha desta caixa. */
export function recusarSugestao(input: DaCaixa & { position: string; reason: string }) {
  return chamarWms<Resultado>("refuseInboundBoxPosition", input);
}

export function confirmarDestino(
  input: DaCaixa & {
    location_id: string;
    orientation?: string;
    support_box_code?: string;
    suggestion?: { position?: string | null; reason?: string | null; alternatives?: string[]; tier?: number };
  },
) {
  return chamarWms<Resultado>("confirmInboundBoxDestination", input);
}

/** Antes do destino; as linhas voltam a faltar caixa. */
export function removerCaixa(input: DaCaixa) {
  return chamarWms<Resultado>("removeInboundBox", input);
}

export function marcarFalta(
  input: DaChegada & {
    inbound_item_id: string;
    reason: "falta" | "avaria";
    detail?: string;
    /** O que a tela viu nas caixas: a marca vale para essa quantidade. */
    expected_boxed_qty: number;
    idempotency_key: string;
  },
) {
  return chamarWms<Resultado>("markInboundBoxShortage", { ...input, action: "mark" });
}

export function desmarcarFalta(input: DaChegada & { inbound_item_id: string; idempotency_key: string }) {
  return chamarWms<Resultado>("markInboundBoxShortage", { ...input, action: "clear" });
}

/** A porta própria da entrada da chegada por caixa (parte 4d). */
export function concluirEntradaPorCaixa(
  input: DaChegada & { expected_status: "created" | "checking"; note?: string; idempotency_key: string },
) {
  return chamarWms<Resultado>("completeInboundBoxReceipt", input);
}

/** Guarda a caixa inteira na prateleira reservada para ela (parte 4f). */
export function guardarCaixa(input: DaCaixa & { location_id: string }) {
  return chamarWms<Resultado>("storeInboundBox", input);
}

/** "Não cabe aqui" na prateleira, na guarda (parte 4h): a reserva sai e a coordenação é avisada. */
export function naoCabeNaPrateleira(input: DaCaixa & { reason: string }) {
  return chamarWms<Resultado>("refuseInboundBoxShelf", input);
}
