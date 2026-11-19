import { boxMovedWithoutLabel, formatBoxDimensions, type BoxOrientation, type SlottingCandidate, type WarehouseBox } from "@/lib/warehouse-boxes";

/**
 * Mover caixa entre prateleiras (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * mockup aprovado em docs/mockups/mover-caixa/): os tipos que a prévia e o
 * mover devolvem (functions/wms, domain/box-move.ts, espelhados aqui, sem
 * importar das Functions) e os textos da página. Funções puras.
 */

/** A página do mover, aberta pelo Mapa: o shell marca o Mapa. */
export const ROTA_DO_MOVER = "/estoque/mapa/mover";
/** Quantas prateleiras a escolha à mão mostra antes de "Ver as N prateleiras". */
export const PRATELEIRAS_A_VISTA = 8;

/** Um item da caixa com o saldo dela e o nome. */
export type ItemMovido = { sku_code: string; qty: number; client_item_code?: string; product_name?: string; size?: string };

/** Uma prateleira para onde a caixa pode ir, na ordem do mover (warehouse-boxes.ts, destinosDoMover). */
export type DestinoDoMover = {
  code: string;
  /** 1: já tem algum item da caixa; 2: as outras, a mais vazia primeiro. */
  tier: 1 | 2;
  reason: string;
  free_front_m: number;
  box_count: number;
  sequence: number;
  /** Como a caixa entra nela: a tela mostra e manda este encaixe; o servidor o confere, sem trocar. */
  placement: SlottingCandidate["placement"];
};

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

/** A resposta de `previewWarehouseBoxMove`. */
export type PreviaDoMover = {
  ok: true;
  box: CaixaDaPrevia;
  /** A recusa que já se sabe, com a frase do servidor; null quando a caixa pode sair. */
  bloqueio: { code: string; message: string } | null;
  /** Na ordem do mover: a primeira é a sugestão; a segunda e a terceira, as alternativas. */
  prateleiras: DestinoDoMover[];
  nao_cabem: string[];
  com_reserva: string[];
  em_contagem: string[];
  rejected: string | null;
};

/** A entrada de `moveWarehouseBox`, sem a chave da tentativa. */
export type EntradaDoMover = {
  customer_code: string;
  box_code: string;
  from_location_id: string;
  to_location_id: string;
  suggestion?: { position: string; alternatives: string[] };
  /** O encaixe que a tela mostrou para o destino; null no apoio é o piso. */
  orientation?: BoxOrientation;
  support_box_code?: string | null;
};

/** A resposta de `moveWarehouseBox`. */
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
  suggestion_followed: boolean | null;
  /** O encaixe gravado no destino. */
  placement: SlottingCandidate["placement"];
  movement_ids: string[];
};

/** O rótulo dos movimentos do mover (a SAÍDA da origem e a ENTRADA do destino) no histórico, sem caixa nem prateleira. */
export const ROTULO_DO_MOVER = "Mudança de prateleira";

/** O movimento é do mover: o servidor grava `movement_kind` box_move_out na origem e box_move_in no destino. */
export function movimentoDoMover(movimento: { movement_kind?: unknown }): boolean {
  return movimento.movement_kind === "box_move_out" || movimento.movement_kind === "box_move_in";
}

const numero = new Intl.NumberFormat("pt-BR");
const metros = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** O endereço da página, com a caixa na busca quando há uma. */
export function moverUrl(code?: string): string {
  return code ? `${ROTA_DO_MOVER}?caixa=${encodeURIComponent(code)}` : ROTA_DO_MOVER;
}

/**
 * O código da caixa como a pessoa digita ou o leitor lê: "CX-000121",
 * "cx-121", "CX121" ou só os algarismos ("121") viram "CX-000121"; o que não é
 * código de caixa, null.
 */
export function codigoDaCaixa(digitado: string): string | null {
  const limpo = String(digitado ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const partes = /^(?:CX-?)?(\d{1,9})$/.exec(limpo);
  if (!partes) return null;
  const sequencia = Number(partes[1]);
  return sequencia > 0 ? `CX-${String(sequencia).padStart(6, "0")}` : null;
}

/** "1,42 m livres · 2 caixas"; sem caixa, "sem caixas". */
export function textoDaPrateleira(livre_m: number, caixas: number): string {
  const quantas = caixas === 0 ? "sem caixas" : caixas === 1 ? "1 caixa" : `${numero.format(caixas)} caixas`;
  return `${metros.format(livre_m)} m livres · ${quantas}`;
}

/** "Não cabe: A-02 · B-11"; sem nenhuma, null. */
export function textoDasForas(rotulo: "Não cabe" | "Com reserva" | "Em contagem", codigos: readonly string[]): string | null {
  return codigos.length ? `${rotulo}: ${codigos.join(" · ")}` : null;
}

function diaEmTexto(instante: string | undefined): string | null {
  const data = instante ? new Date(instante) : null;
  return data && !Number.isNaN(data.getTime()) ? DIA.format(data) : null;
}

/** "Abertura · 22/10/2026 · 40 × 60 × 35 cm · 10 kg"; a do recebimento, com a NF. */
export function textoDaOrigem(box: CaixaDaPrevia): string {
  const origem = box.origin_kind === "receipt" ? (box.invoice_number ? `Recebimento · NF ${box.invoice_number}` : "Recebimento") : box.origin_kind === "opening_inventory" ? "Abertura" : "Manual";
  return [origem, diaEmTexto(box.stored_at), formatBoxDimensions(box)].filter(Boolean).join(" · ");
}

/** "saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo", na hora de São Paulo. */
export function textoDaMovida(resultado: Pick<ResultadoDoMover, "from_location_id" | "units" | "moved_at" | "moved_by_name">): string {
  const data = new Date(resultado.moved_at);
  const partes = Number.isNaN(data.getTime()) ? null : Object.fromEntries(DIA_E_HORA.formatToParts(data).map((parte) => [parte.type, parte.value]));
  const quando = partes ? `${partes.day}/${partes.month} ${partes.hour}:${partes.minute}` : null;
  return [`saiu de ${resultado.from_location_id}`, `${numero.format(resultado.units)} un.`, quando, resultado.moved_by_name].filter(Boolean).join(" · ");
}

/** As caixas do cliente que mudaram de prateleira e ainda estão com a etiqueta antiga, pelo código. */
export function caixasMovidasSemEtiqueta(caixas: readonly WarehouseBox[], cliente: string): string[] {
  return caixas
    .filter((caixa) => caixa.customer_code === cliente && boxMovedWithoutLabel(caixa))
    .map((caixa) => caixa.code)
    .sort();
}
