import { formatarDecimal, linhaDaTabela, type ItemDaTabela, type LinhaForm } from "./montar";

/**
 * A vistoria que a Operação enviou ao Comercial (docs/plataforma/fase-3-operacao.md,
 * partes 3.11a e 3.11e): o resumo `demands/{numero}.vistoria`, que só a
 * Operação escreve. O Comercial lê, vê as fotos e carrega os itens
 * levantados no orçamento, pela tabela, sem redigitar. O orçamento guarda a
 * vistoria que carregou (`quotes/{numero}.vistoria_os`): enquanto não
 * carrega, a vistoria espera no Início. Sem valor: o preço sai da tabela.
 */

export type ItemDaVistoria = { lpuItemId: string; item: string; unidade: string | null; quantidade: string };

export type VistoriaNoComercial = {
  os: string;
  enviadaEm: string;
  ambientes: Array<{ nome: string; itens: ItemDaVistoria[]; fotos: string[] }>;
  /** Os itens somados de todos os ambientes. */
  itens: ItemDaVistoria[];
  medidas: Array<{ nome: string; valor: string }>;
  acesso: { horarioDeCarga: string | null; vagaDeCarga: string | null };
  observacoes: string | null;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objetos(valor: unknown): Registro[] {
  return Array.isArray(valor) ? valor.filter((item): item is Registro => Boolean(item) && typeof item === "object") : [];
}

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function itensLidos(valor: unknown): ItemDaVistoria[] {
  return objetos(valor).flatMap((item) => {
    const lpuItemId = texto(item.lpu_item_id);
    const quantidade = texto(item.quantidade);
    if (!lpuItemId || !QUANTIDADE.test(quantidade)) return [];
    return [{ lpuItemId, item: texto(item.item) || lpuItemId, unidade: texto(item.unidade) || null, quantidade }];
  });
}

/** O resumo da vistoria na demanda, ou null antes de a Operação enviar. */
export function vistoriaDaDemanda(demanda: Registro | null | undefined): VistoriaNoComercial | null {
  const bruto = demanda?.vistoria;
  if (!bruto || typeof bruto !== "object") return null;
  const vistoria = bruto as Registro;
  const os = texto(vistoria.os);
  const enviadaEm = texto(vistoria.enviada_em);
  if (!/^\d{5,8}-\d{2}$/.test(os) || !enviadaEm) return null;
  const acesso = vistoria.acesso && typeof vistoria.acesso === "object" ? (vistoria.acesso as Registro) : {};
  return {
    os,
    enviadaEm,
    ambientes: objetos(vistoria.ambientes).map((ambiente) => ({
      nome: texto(ambiente.nome),
      itens: itensLidos(ambiente.itens),
      fotos: Array.isArray(ambiente.fotos) ? ambiente.fotos.filter((caminho): caminho is string => typeof caminho === "string" && caminho.startsWith(`os/${os}/fotos/`)) : [],
    })),
    itens: itensLidos(vistoria.itens),
    medidas: objetos(vistoria.medidas).flatMap((medida) => (texto(medida.nome) ? [{ nome: texto(medida.nome), valor: texto(medida.valor) }] : [])),
    acesso: { horarioDeCarga: texto(acesso.horario_de_carga) || null, vagaDeCarga: texto(acesso.vaga_de_carga) || null },
    observacoes: texto(vistoria.observacoes) || null,
  };
}

// --- O Início ------------------------------------------------------------------------------

/** As etapas em que a vistoria espera o orçamento: a montagem. */
export const ETAPAS_COM_VISTORIA_A_USAR = ["em_montagem"] as const;

export type VistoriaAUsar = { numero: string; cliente: string; os: string; enviadaEm: string; itens: number };

/** A vistoria que o orçamento ainda não carregou, na montagem; ou null. */
export function vistoriaAUsar(numero: string, demanda: Registro, quote: Registro | null): VistoriaAUsar | null {
  const vistoria = vistoriaDaDemanda(demanda);
  if (!vistoria) return null;
  if (!(ETAPAS_COM_VISTORIA_A_USAR as readonly string[]).includes(texto(demanda.etapa))) return null;
  if (quote && texto(quote.vistoria_os) === vistoria.os) return null;
  return { numero, cliente: texto(demanda.customer_name) || texto(demanda.customer_code), os: vistoria.os, enviadaEm: vistoria.enviadaEm, itens: vistoria.itens.length };
}

// --- A montagem ----------------------------------------------------------------------------

/** "24 Transporte de cadeira · 12 Desmontagem de estação". */
export function itensDaVistoriaEmTexto(itens: readonly ItemDaVistoria[]): string {
  return itens.map((item) => `${formatarDecimal(item.quantidade, 0)}${item.unidade && item.unidade.toUpperCase() !== "UN" ? ` ${item.unidade.toLocaleLowerCase("pt-BR")}` : ""} ${item.item}`).join(" · ");
}

/** Os itens da vistoria que a tabela do orçamento não precifica: o Comercial lança à mão. */
export function foraDaTabelaDaVistoria(vistoria: Pick<VistoriaNoComercial, "itens">, catalogo: readonly ItemDaTabela[]): ItemDaVistoria[] {
  const naTabela = new Set(catalogo.map((item) => item.lpuItemId));
  return vistoria.itens.filter((item) => !naTabela.has(item.lpuItemId));
}

/**
 * Carrega os itens da vistoria nas linhas: o item que já está numa linha da
 * tabela fica com a quantidade levantada; o outro entra numa linha nova pela
 * tabela. O que a tabela não tem fica de fora (foraDaTabelaDaVistoria).
 */
export function carregarVistoria(
  linhas: readonly LinhaForm[],
  vistoria: Pick<VistoriaNoComercial, "itens">,
  catalogo: readonly ItemDaTabela[],
  novaChave: () => string,
): LinhaForm[] {
  const porId = new Map(catalogo.map((item) => [item.lpuItemId, item]));
  let resultado = [...linhas];
  for (const levantado of vistoria.itens) {
    const daTabela = porId.get(levantado.lpuItemId);
    if (!daTabela) continue;
    const quantidade = formatarDecimal(levantado.quantidade, 0);
    const existente = resultado.find((linha) => linha.origem === "tabela" && linha.lpuItemId === levantado.lpuItemId);
    resultado = existente
      ? resultado.map((linha) => (linha.chave === existente.chave ? { ...linha, quantidade } : linha))
      : [...resultado, linhaDaTabela(daTabela, novaChave(), quantidade)];
  }
  return resultado;
}
