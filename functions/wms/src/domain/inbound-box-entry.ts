import { createHash } from "node:crypto";

import { HttpsError } from "firebase-functions/https";

import { areaDePassagem } from "./areas-de-passagem.js";

/**
 * A entrada da chegada por caixa (docs/plataforma/recebimento-com-caixas.md,
 * seção 4.4 e parte 4d), sem o banco: o que a conclusão aceita, o que recusa
 * e o que grava em cada linha e em cada guarda. A transação mora em
 * operations.ts (o mesmo ramo da entrada por linha, com a porta própria da
 * chegada por caixa); este módulo não importa operations.ts nem
 * inbound-boxes.ts.
 *
 * As regras: toda caixa da chegada fechada (a vazia ou ainda em conferência
 * recusa, decisão 18), e a chegada com ao menos uma caixa (decisão 19); a
 * quantidade de cada linha da NF é a soma das caixas, conferida contra o que
 * a linha guarda (`boxed_qty` e `box_codes`); a linha que veio a menos precisa
 * da falta marcada para essa quantidade (parte 4c); a divergência pede a
 * justificativa, como na entrada por linha. A caixa fechada sem prateleira
 * conclui e ganha o destino na guarda (decisão 14).
 */

export const AREA_DE_RECEBIMENTO = "RECEBIMENTO";

/**
 * A conclusão da chegada por caixa não avisa o cliente: o aviso de envio
 * vinculado e o rascunho "Estoque atualizado" saem na última guarda (decisão
 * 20). Os eventos da conclusão levam esta marca no payload (`client_notice`),
 * e o rascunho manual (syncOperationalNotifications) os pula.
 */
export const CLIENT_NOTICE_AFTER_PUTAWAY = "after_putaway";

type Row = Record<string, unknown>;

export type LinhaDaChegada = Row & { id: string };
export type CaixaDaChegada = Row & { code: string };

export type ConferenciaDaLinha = {
  received_qty: number;
  difference_qty: number;
  conference_status: "ok" | "short" | "over";
  /** A marca de falta que sobrou numa linha coberta sai na conclusão. */
  clear_shortage: boolean;
};

export type ConteudoDaCaixa = {
  inbound_item_id: string;
  line_number: number;
  sku_code: string;
  client_item_code: string;
  product_name: string;
  size: string | null;
  counted_qty: number;
};

export type GuardaDaCaixa = {
  code: string;
  /** A prateleira reservada (caixa em committing); null na caixa fechada sem prateleira. */
  destination: string | null;
  lines: ConteudoDaCaixa[];
  sku_codes: string[];
  unit_count: number;
};

export type EntradaPorCaixa = {
  linhas: Map<string, ConferenciaDaLinha>;
  caixas: GuardaDaCaixa[];
  qty_received: number;
  qty_difference: number;
  divergence_count: number;
  conference_status: "ok" | "divergence";
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function quantity(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? round(parsed) : 0;
}

function codesOf(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((code) => text(code)).filter(Boolean))].sort() : [];
}

/** O id da tarefa de guarda da caixa: a guarda acha a tarefa sem consulta. */
export function boxPutawayTaskId(receiptId: string, boxCode: string) {
  return `put_box_${createHash("sha256").update(`${receiptId}\u0000${boxCode}`).digest("hex").slice(0, 32)}`;
}

/**
 * A porta da conclusão por caixa: só a chegada por caixa, do cliente ativo,
 * a conferir ou em conferência, que vai direto a received (as caixas nunca
 * escrevem a chegada, então ela pode estar em created).
 */
export function boxEntryTarget(receipt: Row, selectedCustomer?: string): "received" {
  const owner = text(receipt.customer_code);
  const selected = text(selectedCustomer);
  if (selected && owner && selected !== owner) {
    throw new HttpsError("permission-denied", `Chegada de outro cliente. Troque o cliente ativo para ${owner}.`);
  }
  const receiptNumber = text(receipt.receipt_number || receipt.id);
  if (receipt.conference_mode !== "per_box") {
    throw new HttpsError(
      "failed-precondition",
      `A chegada ${receiptNumber} é conferida por linha: use a conferência da chegada.`,
      { code: "RECEIPT_CONFERRED_PER_LINE" },
    );
  }
  const status = text(receipt.status || "created").toLowerCase();
  if (!["created", "checking"].includes(status)) {
    throw new HttpsError(
      "failed-precondition",
      `A chegada ${receiptNumber} não está em conferência (${status}).`,
      { code: "RECEIPT_NOT_OPEN" },
    );
  }
  return "received";
}

/** O que a conclusão grava e as tarefas que abre; recusa antes de qualquer escrita. */
export function entradaPorCaixa(input: {
  receiptId: string;
  receiptNumber: string;
  owner: string;
  linhas: LinhaDaChegada[];
  caixas: CaixaDaChegada[];
  nota?: string;
}): EntradaPorCaixa {
  const { receiptId, receiptNumber, owner } = input;
  if (!input.caixas.length) {
    throw new HttpsError(
      "failed-precondition",
      `A chegada ${receiptNumber} não tem nenhuma caixa: a entrada pede ao menos uma caixa fechada.`,
      { code: "BOX_RECEIPT_WITHOUT_BOXES" },
    );
  }
  const linhasPorId = new Map(input.linhas.map((linha) => [linha.id, linha]));
  const somaPorLinha = new Map<string, number>();
  const caixasPorLinha = new Map<string, Set<string>>();
  const caixas: GuardaDaCaixa[] = [];

  for (const caixa of [...input.caixas].sort((left, right) => left.code.localeCompare(right.code))) {
    const origin = (caixa.origin ?? {}) as Row;
    if (origin.kind !== "receipt" || text(origin.receipt_id) !== receiptId || text(caixa.customer_code) !== owner) {
      throw new HttpsError("permission-denied", `A caixa ${caixa.code} é de outra chegada.`);
    }
    const lines = Array.isArray(caixa.lines) ? (caixa.lines as Row[]) : [];
    if (!lines.length) {
      throw new HttpsError(
        "failed-precondition",
        `Remova a caixa ${caixa.code}, vazia, antes de concluir a entrada.`,
        { code: "BOX_STILL_COUNTING", box_code: caixa.code },
      );
    }
    const status = text(caixa.status);
    if (status === "counting") {
      throw new HttpsError(
        "failed-precondition",
        `Feche a caixa ${caixa.code} (medidas e peso) antes de concluir a entrada.`,
        { code: "BOX_STILL_COUNTING", box_code: caixa.code },
      );
    }
    if (status !== "reviewed" && status !== "committing") {
      throw new HttpsError("failed-precondition", `A caixa ${caixa.code} está ${status || "sem estado"}: confira a caixa antes de concluir a entrada.`);
    }
    const conteudo: ConteudoDaCaixa[] = [];
    for (const line of lines) {
      const itemId = text(line.inbound_item_id);
      if (!linhasPorId.has(itemId)) {
        throw new HttpsError(
          "failed-precondition",
          `A caixa ${caixa.code} tem um produto que não está na NF da chegada ${receiptNumber}.`,
          { code: "BOX_LINE_OUTSIDE_RECEIPT", box_code: caixa.code },
        );
      }
      const counted = quantity(line.counted_qty);
      somaPorLinha.set(itemId, round((somaPorLinha.get(itemId) ?? 0) + counted));
      caixasPorLinha.set(itemId, (caixasPorLinha.get(itemId) ?? new Set()).add(caixa.code));
      const skuCode = text(line.sku_code);
      conteudo.push({
        inbound_item_id: itemId,
        line_number: Number(line.line_number) || 0,
        sku_code: skuCode,
        client_item_code: text(line.client_item_code) || skuCode,
        product_name: text(line.product_name) || skuCode,
        size: text(line.size) || null,
        counted_qty: counted,
      });
    }
    caixas.push({
      code: caixa.code,
      destination: status === "committing" ? text(caixa.destination_location_id || caixa.location_id).toUpperCase() || null : null,
      lines: conteudo,
      sku_codes: [...new Set(conteudo.map((line) => line.sku_code).filter(Boolean))].sort(),
      unit_count: round(conteudo.reduce((sum, line) => sum + line.counted_qty, 0)),
    });
  }

  const linhas = new Map<string, ConferenciaDaLinha>();
  let divergencias = 0;
  let qtyReceived = 0;
  let qtyDifference = 0;
  for (const linha of [...input.linhas].sort((left, right) => (Number(left.line_number) || 0) - (Number(right.line_number) || 0))) {
    const lineNumber = Number(linha.line_number) || 0;
    const local = text(linha.location_id);
    if (local && areaDePassagem(local) !== AREA_DE_RECEBIMENTO) {
      throw new HttpsError(
        "failed-precondition",
        `A linha ${lineNumber} vai direto para ${local.toUpperCase()}: na chegada por caixa, toda linha passa pela área de recebimento.`,
        { code: "BOX_RECEIPT_LINE_OUTSIDE_RECEIVING" },
      );
    }
    const recebido = somaPorLinha.get(linha.id) ?? 0;
    const naLinha = quantity(linha.boxed_qty);
    const codigos = [...(caixasPorLinha.get(linha.id) ?? [])].sort();
    if (naLinha !== recebido || codesOf(linha.box_codes).join(",") !== codigos.join(",")) {
      throw new HttpsError(
        "failed-precondition",
        `A linha ${lineNumber} não confere com as caixas (${naLinha} na linha, ${recebido} nas caixas). Atualize a tela e confira as caixas.`,
        { code: "BOXED_QTY_MISMATCH" },
      );
    }
    const previsto = quantity(linha.expected_qty);
    const diferenca = round(recebido - previsto);
    const status = diferenca === 0 ? "ok" : diferenca < 0 ? "short" : "over";
    const marca = linha.shortage && typeof linha.shortage === "object" ? (linha.shortage as Row) : null;
    if (status === "short" && (!marca || quantity(marca.boxed_qty) !== recebido)) {
      throw new HttpsError(
        "failed-precondition",
        `A linha ${lineNumber} tem ${recebido} de ${previsto}: complete as caixas ou marque a falta.`,
        { code: "SHORTAGE_NOT_MARKED" },
      );
    }
    if (status !== "ok") divergencias += 1;
    qtyReceived = round(qtyReceived + recebido);
    qtyDifference = round(qtyDifference + diferenca);
    linhas.set(linha.id, {
      received_qty: recebido,
      difference_qty: diferenca,
      conference_status: status,
      clear_shortage: Boolean(marca) && status !== "short",
    });
  }
  if (divergencias > 0 && !text(input.nota)) {
    throw new HttpsError(
      "failed-precondition",
      `Recebimento possui ${divergencias} linha(s) com divergência. Informe a justificativa operacional antes de concluir.`,
    );
  }
  return {
    linhas,
    caixas,
    qty_received: qtyReceived,
    qty_difference: qtyDifference,
    divergence_count: divergencias,
    conference_status: divergencias > 0 ? "divergence" : "ok",
  };
}
