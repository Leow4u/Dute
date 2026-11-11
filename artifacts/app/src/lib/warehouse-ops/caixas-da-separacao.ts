import { ordemDeSaida, sugerirCaixas, type CaixaComOItem, type CaixaDaLinha, type CaixasDaLinha } from "@workspace/dominio";

import { boxBalanceUnits, boxNeedsRelabel, boxOriginLabel, type WarehouseBox } from "@/lib/warehouse-boxes";

import { quantidadeDoItem } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";

/**
 * As caixas na bancada do pedido (separação com caixas, parte 3b;
 * docs/mockups/WmsSepararBancada.dc.html e WmsSepararOutraCaixa.dc.html): a
 * linha por separar mostra de qual caixa o sistema vai tirar ("12 de
 * CX-000027", "esvazia", "CX-000029 inteira"), a linha separada mostra de
 * onde saiu, e "Outra caixa" lista as caixas da prateleira que têm o item.
 * A conta é a de lib/dominio (saldo-da-caixa.ts), a mesma do servidor.
 */

/** Uma linha do conteúdo de entrada da caixa da abertura (`opening_inventory_lines`). */
export type LinhaDeEntrada = { box_code: string; sku_code: string; counted_qty: number };

const numero = new Intl.NumberFormat("pt-BR");
const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

function chave(valor: unknown): string {
  return String(valor ?? "").trim().toUpperCase();
}

/** A linha da abertura como a bancada a lê; sem caixa, sem SKU ou sem quantidade não serve. */
export function linhaDeEntrada(_id: string, registro: Record<string, unknown>): LinhaDeEntrada | null {
  const box_code = chave(registro.box_code);
  const sku_code = chave(registro.sku_code);
  const counted_qty = Number(registro.counted_qty ?? 0) || 0;
  return box_code && sku_code && counted_qty > 0 ? { box_code, sku_code, counted_qty } : null;
}

/** O que entrou de cada SKU em cada caixa: a do recebimento traz o conteúdo nela; a da abertura, nas linhas da sessão. */
export function entradaDasCaixas(caixas: readonly WarehouseBox[], abertura: readonly LinhaDeEntrada[]): Map<string, Map<string, number>> {
  const daAbertura = new Map<string, Map<string, number>>();
  for (const linha of abertura) {
    const skus = daAbertura.get(linha.box_code) ?? new Map<string, number>();
    skus.set(linha.sku_code, (skus.get(linha.sku_code) ?? 0) + linha.counted_qty);
    daAbertura.set(linha.box_code, skus);
  }
  const entrada = new Map<string, Map<string, number>>();
  for (const caixa of caixas) {
    if (!caixa.lines.length) {
      entrada.set(caixa.code, daAbertura.get(caixa.code) ?? new Map());
      continue;
    }
    const proprias = new Map<string, number>();
    for (const linha of caixa.lines) {
      const sku = chave(linha.sku_code);
      if (sku) proprias.set(sku, (proprias.get(sku) ?? 0) + linha.counted_qty);
    }
    entrada.set(caixa.code, proprias);
  }
  return entrada;
}

/** A caixa da prateleira que tem o item, com o que "Outra caixa" diz dela. */
export type CaixaDaPrateleira = CaixaComOItem & {
  /** "Abertura" ou "Recebimento · NF 48.377". */
  origem: string;
  /** "22/10/2026", a data da guarda; null sem ela. */
  guardadaEm: string | null;
};

/**
 * As caixas guardadas na prateleira da linha, do cliente do pedido, que têm
 * o item agora, a mais antiga primeiro.
 */
export function caixasComOItem(
  item: WarehouseTaskItem,
  caixas: readonly WarehouseBox[],
  entrada: ReadonlyMap<string, ReadonlyMap<string, number>>,
  cliente?: string | null,
): CaixaDaPrateleira[] {
  const posicao = chave(item.location);
  const sku = chave(item.sku_code ?? item.sku);
  if (!posicao || !sku) return [];
  const dono = chave(cliente);
  const candidatas: CaixaDaPrateleira[] = [];
  for (const caixa of caixas) {
    if (caixa.status !== "stored" || chave(caixa.location_id) !== posicao || (dono && chave(caixa.customer_code) !== dono)) continue;
    const entrou = entrada.get(caixa.code)?.get(sku) ?? 0;
    const saiu = (caixa.taken_lines ?? []).filter((linha) => chave(linha.sku_code) === sku).reduce((soma, linha) => soma + linha.qty, 0);
    const disponivel = Math.max(0, entrou - saiu);
    if (!disponivel) continue;
    const guardada = caixa.stored_at ? new Date(caixa.stored_at) : null;
    candidatas.push({
      code: caixa.code,
      stored_at: caixa.stored_at,
      disponivel,
      saldo: boxBalanceUnits(caixa),
      intacta: (caixa.taken_units ?? 0) === 0,
      origem: boxOriginLabel(caixa),
      guardadaEm: guardada && !Number.isNaN(guardada.getTime()) ? data.format(guardada) : null,
    });
  }
  return ordemDeSaida(candidatas);
}

/** A sugestão do sistema para a linha por separar: a caixa mais antiga, e a seguinte completa. */
export function sugestaoDaLinha(item: WarehouseTaskItem, candidatas: readonly CaixaComOItem[]): CaixasDaLinha {
  return sugerirCaixas(quantidadeDoItem(item), candidatas);
}

/** De onde a linha separada saiu, como ela guarda. */
export function caixasGravadas(item: WarehouseTaskItem): CaixaDaLinha[] {
  return (item.separated_boxes ?? []).map((caixa) => ({ box_code: caixa.box_code, qty: caixa.qty, inteira: caixa.whole === true, esvazia: caixa.emptied === true }));
}

/** "30 de CX-000027"; a caixa que sai toda, "CX-000029 inteira". */
export function textoDaCaixa(caixa: Pick<CaixaDaLinha, "box_code" | "qty" | "inteira">): string {
  return caixa.inteira ? `${caixa.box_code} inteira` : `${numero.format(caixa.qty)} de ${caixa.box_code}`;
}

/** "Abertura · 22/10/2026 · tem 20 un.": o que "Outra caixa" diz da caixa. */
export function textoDaCandidata(caixa: Pick<CaixaDaPrateleira, "origem" | "guardadaEm" | "disponivel">): string {
  return [caixa.origem, caixa.guardadaEm, `tem ${numero.format(caixa.disponivel)} un.`].filter(Boolean).join(" · ");
}

/** O que a pessoa informou em "Outra caixa": a quantidade de cada caixa da prateleira. */
export type CaixasInformadas = Record<string, number>;

/** A soma do que foi informado. */
export function somaDasInformadas(informadas: CaixasInformadas): number {
  return Object.values(informadas).reduce((soma, qty) => soma + (Number(qty) || 0), 0);
}

/** O que a linha tira das caixas desta prateleira: a linha inteira, ou tudo o que as caixas têm. */
export function separadoNasCaixas(quantidade: number, candidatas: readonly CaixaComOItem[]): number {
  return Math.min(quantidade, candidatas.reduce((soma, caixa) => soma + caixa.disponivel, 0));
}

/** As caixas informadas como a callable espera, sem as zeradas. */
export function caixasParaEnviar(informadas: CaixasInformadas): Array<{ box_code: string; qty: number }> {
  return Object.entries(informadas)
    .filter(([, qty]) => qty > 0)
    .map(([box_code, qty]) => ({ box_code, qty }));
}

/** Uma caixa que o pedido abriu e que está com a etiqueta velha (parte 3d). */
export type EtiquetaParaTrocar = { code: string; posicao: string; saldo: number };

/** As caixas de onde as linhas do pedido saíram, com a que saiu inteira marcada e a prateleira de onde saiu. */
function caixasTocadas(itens: readonly WarehouseTaskItem[]): Map<string, { inteira: boolean; posicao: string }> {
  const tocadas = new Map<string, { inteira: boolean; posicao: string }>();
  for (const item of itens) {
    for (const caixa of item.separated_boxes ?? []) {
      const codigo = chave(caixa.box_code);
      if (!codigo) continue;
      const antes = tocadas.get(codigo);
      tocadas.set(codigo, { inteira: (antes?.inteira ?? false) || caixa.whole === true, posicao: antes?.posicao || String(item.location ?? "").trim() });
    }
  }
  return tocadas;
}

/**
 * "Etiquetas para trocar": as caixas guardadas que as linhas do pedido
 * abriram e cuja etiqueta não é a do saldo de agora, por prateleira e código.
 * A caixa sai da lista quando a impressão da etiqueta com o saldo é registrada.
 */
export function etiquetasParaTrocar(itens: readonly WarehouseTaskItem[], guardadas: readonly WarehouseBox[]): EtiquetaParaTrocar[] {
  const tocadas = caixasTocadas(itens);
  return guardadas
    .filter((caixa) => tocadas.has(caixa.code) && boxNeedsRelabel(caixa))
    .map((caixa) => ({ code: caixa.code, posicao: caixa.location_id, saldo: boxBalanceUnits(caixa) }))
    .sort((esquerda, direita) => esquerda.posicao.localeCompare(direita.posicao, "pt-BR", { numeric: true }) || esquerda.code.localeCompare(direita.code, "pt-BR", { numeric: true }));
}

/** "2 caixas abertas" */
export function textoDasAbertas(caixas: number): string {
  return `${numero.format(caixas)} ${caixas === 1 ? "caixa aberta" : "caixas abertas"}`;
}

/** "A-04 · saldo 10 un." */
export function textoDaEtiqueta(etiqueta: Pick<EtiquetaParaTrocar, "posicao" | "saldo">): string {
  return [etiqueta.posicao, `saldo ${numero.format(etiqueta.saldo)} un.`].filter(Boolean).join(" · ");
}

/** "5 etiquetas de caixa para trocar": o aviso do pedido em Para entregar. */
export function textoDeEtiquetasParaTrocar(caixas: number): string {
  return `${numero.format(caixas)} ${caixas === 1 ? "etiqueta de caixa para trocar" : "etiquetas de caixa para trocar"}`;
}

/** Uma caixa que o pedido esvaziou: saiu da prateleira sem ter saído inteira. */
export type CaixaVazia = { code: string; posicao: string };

/**
 * "Caixas vazias": as caixas já abertas que as linhas do pedido esvaziaram,
 * por prateleira e código. A que saiu inteira não entra (ela é a caixa do
 * volume, ou foi desmontada cheia), nem a que continua guardada.
 */
export function caixasVaziasDoPedido(itens: readonly WarehouseTaskItem[], guardadas: readonly WarehouseBox[]): CaixaVazia[] {
  const naPrateleira = new Set(guardadas.filter((caixa) => caixa.status === "stored").map((caixa) => caixa.code));
  return [...caixasTocadas(itens)]
    .filter(([codigo, caixa]) => !caixa.inteira && !naPrateleira.has(codigo))
    .map(([codigo, caixa]) => ({ code: codigo, posicao: caixa.posicao }))
    .sort((esquerda, direita) => esquerda.posicao.localeCompare(direita.posicao, "pt-BR", { numeric: true }) || esquerda.code.localeCompare(direita.code, "pt-BR", { numeric: true }));
}

/** "4 encerradas" */
export function textoDasVazias(caixas: number): string {
  return `${numero.format(caixas)} ${caixas === 1 ? "encerrada" : "encerradas"}`;
}

/** As caixas do pedido, como o diálogo de concluir as conta. */
export type CaixasDoPedido = { inteiras: number; abertas: number; vazias: number };

/**
 * As caixas de onde o pedido saiu: a que continua guardada está aberta; das
 * que saíram da prateleira, a que saiu toda numa linha é inteira, e a outra,
 * vazia.
 */
export function caixasDoPedido(itens: readonly WarehouseTaskItem[], guardadas: readonly WarehouseBox[]): CaixasDoPedido {
  const naPrateleira = new Set(guardadas.filter((caixa) => caixa.status === "stored").map((caixa) => caixa.code));
  const conta: CaixasDoPedido = { inteiras: 0, abertas: 0, vazias: 0 };
  for (const [codigo, caixa] of caixasTocadas(itens)) {
    if (naPrateleira.has(codigo)) conta.abertas += 1;
    else if (caixa.inteira) conta.inteiras += 1;
    else conta.vazias += 1;
  }
  return conta;
}
