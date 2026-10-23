import { createHash } from "node:crypto";

/**
 * As medidas da memória da Dute (docs/plataforma/fase-5-memoria.md, parte
 * 5.1a): o homem-minuto por unidade de cada item da LPU, a partir das OS
 * revisadas. Funções puras: a rotina (medidas-gravacao.ts) lê as OS, chama
 * estas contas e grava o resultado. Nada aqui tem valor.
 */

export const AI_MEASURES_COLLECTION = "ai_measures";

export const TIPOS_DE_MEDIDA = ["duracao_item"] as const;
export type TipoDeMedida = (typeof TIPOS_DE_MEDIDA)[number];

/** Quantas OS a medida mostra como origem, das mais recentes. */
export const OS_NA_ORIGEM = 10;

/** As voltas do ajuste: ele para antes quando os tempos estabilizam. */
const VOLTAS_DO_AJUSTE = 200;
const ESTAVEL = 1e-9;

// --- Leitura da OS ------------------------------------------------------------------------

/** O item executado na OS, com a quantidade em milésimos. O item livre (sem LPU) ocupa tempo, mas não vira medida. */
export type ItemDaAmostra = { chave: string; lpuItemId: string | null; item: string; unidade: string | null; milesimos: number };

/** Uma OS revisada como amostra: o tempo de trabalho, a equipe e os itens feitos. */
export type AmostraDaOs = {
  numero: string;
  customerCode: string;
  /** Quando a revisão foi feita: ordena as OS mais recentes. */
  revisadaEm: string;
  pessoas: number;
  minutosDeTrabalho: number;
  homemMinutos: number;
  itens: ItemDaAmostra[];
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objetos(valor: unknown): Array<Record<string, unknown>> {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

/** "12.5" em milésimos (12500); o que não for quantidade dá 0. */
export function milesimos(quantidade: unknown): number {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(texto(quantidade));
  return match ? Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0")) : 0;
}

function instanteDa(etapas: ReadonlyArray<Record<string, unknown>>, etapa: string): number | null {
  const achada = etapas.find((registro) => texto(registro.etapa) === etapa);
  const quando = achada ? Date.parse(texto(achada.instante)) : Number.NaN;
  return Number.isFinite(quando) ? quando : null;
}

/**
 * O tempo de trabalho da OS, em minutos: o tempo no local, da chegada na
 * origem ao fim, menos o trajeto da saída da origem à chegada no destino
 * (quando a OS tem destino). Sem essas etapas, null: a OS não é amostra.
 */
export function minutosDeTrabalho(etapas: ReadonlyArray<Record<string, unknown>>): number | null {
  const chegada = instanteDa(etapas, "chegada_origem");
  const fim = instanteDa(etapas, "fim");
  if (chegada === null || fim === null || fim <= chegada) return null;
  const saida = instanteDa(etapas, "saida_origem");
  const destino = instanteDa(etapas, "chegada_destino");
  const trajeto = saida !== null && destino !== null && destino > saida && saida >= chegada && destino <= fim ? destino - saida : 0;
  const minutos = Math.round((fim - chegada - trajeto) / 60_000);
  return minutos > 0 ? minutos : null;
}

/**
 * A OS revisada como amostra, ou null quando ela não serve: a vistoria, a OS
 * sem revisão, sem equipe, sem o tempo de trabalho ou sem item feito.
 */
export function amostraDaOs(numero: string, dados: Record<string, unknown>): AmostraDaOs | null {
  if (texto(dados.status) !== "revisada" || texto(dados.tipo) === "vistoria") return null;
  const customerCode = texto(dados.customer_code);
  const revisao = dados.revisao && typeof dados.revisao === "object" ? (dados.revisao as Record<string, unknown>) : null;
  if (!customerCode || !revisao) return null;
  const pessoas = typeof revisao.pessoas === "number" && Number.isInteger(revisao.pessoas) ? revisao.pessoas : 0;
  const minutos = minutosDeTrabalho(objetos(dados.etapas));
  if (pessoas < 1 || minutos === null) return null;
  const itens = objetos(revisao.linhas).flatMap((linha): ItemDaAmostra[] => {
    // O feito é o corrigido na revisão, senão o registrado no local.
    const feito = milesimos(texto(linha.corrigido) || linha.executado);
    if (feito <= 0) return [];
    const lpuItemId = texto(linha.lpu_item_id) || null;
    return [{ chave: lpuItemId ?? `livre:${texto(linha.linha)}`, lpuItemId, item: texto(linha.item), unidade: texto(linha.unidade) || null, milesimos: feito }];
  });
  if (!itens.length) return null;
  return {
    numero,
    customerCode,
    revisadaEm: texto(revisao.instante),
    pessoas,
    minutosDeTrabalho: minutos,
    homemMinutos: minutos * pessoas,
    itens,
  };
}

// --- O ajuste dos tempos ------------------------------------------------------------------

export type TempoDoItem = {
  /** Homem-minuto por unidade. */
  porUnidade: number;
  /** As OS com o item. */
  execucoes: number;
  milesimos: number;
  homemMinutos: number;
  /** As OS com o item, da revisão mais recente para a mais antiga. */
  os: string[];
};

/**
 * O homem-minuto por unidade de cada item. O tempo de cada OS se reparte
 * pelos itens dela na proporção do tempo típico de cada um, e o tempo típico
 * sai dessa repartição; as duas se ajustam juntas até estabilizar. A OS de um
 * item só dá o tempo dela inteiro a ele. Começa pela repartição por
 * quantidade. O resultado não depende da ordem das amostras.
 */
export function ajustarTempos(amostras: readonly AmostraDaOs[]): Map<string, TempoDoItem> {
  const ordenadas = [...amostras].sort((a, b) => a.numero.localeCompare(b.numero));
  const unidades = new Map<string, number>();
  for (const amostra of ordenadas) for (const item of amostra.itens) unidades.set(item.chave, (unidades.get(item.chave) ?? 0) + item.milesimos / 1000);
  let taxa = new Map<string, number>([...unidades.keys()].map((chave) => [chave, 1]));
  let repartido = new Map<string, number>();
  for (let volta = 0; volta < VOLTAS_DO_AJUSTE; volta += 1) {
    repartido = new Map();
    for (const amostra of ordenadas) {
      const peso = amostra.itens.reduce((soma, item) => soma + (taxa.get(item.chave) ?? 0) * (item.milesimos / 1000), 0);
      if (peso <= 0) continue;
      for (const item of amostra.itens) {
        const parte = (amostra.homemMinutos * (taxa.get(item.chave) ?? 0) * (item.milesimos / 1000)) / peso;
        repartido.set(item.chave, (repartido.get(item.chave) ?? 0) + parte);
      }
    }
    const proxima = new Map([...unidades.entries()].map(([chave, total]) => [chave, (repartido.get(chave) ?? 0) / total]));
    const mudou = [...proxima.entries()].some(([chave, valor]) => Math.abs(valor - (taxa.get(chave) ?? 0)) > ESTAVEL * Math.max(1, valor));
    taxa = proxima;
    if (!mudou) break;
  }
  const recentes = [...ordenadas].sort((a, b) => b.revisadaEm.localeCompare(a.revisadaEm) || b.numero.localeCompare(a.numero));
  const tempos = new Map<string, TempoDoItem>();
  for (const [chave, total] of unidades) {
    const os = recentes.filter((amostra) => amostra.itens.some((item) => item.chave === chave)).map((amostra) => amostra.numero);
    tempos.set(chave, {
      porUnidade: taxa.get(chave) ?? 0,
      execucoes: os.length,
      milesimos: Math.round(total * 1000),
      homemMinutos: repartido.get(chave) ?? 0,
      os,
    });
  }
  return tempos;
}

// --- As medidas ---------------------------------------------------------------------------

export type EscopoDaMedida = "cliente" | "geral";

export type MedidaDeDuracao = {
  id: string;
  tipo: "duracao_item";
  escopo: EscopoDaMedida;
  /** O cliente da medida; null na geral, que junta os clientes e serve só à equipe interna. */
  customer_code: string | null;
  lpu_item_id: string;
  item: string;
  unidade: string | null;
  /** Homem-minuto por unidade, com uma casa. */
  homem_minuto_por_unidade: number;
  /** As OS revisadas com o item. */
  execucoes: number;
  /** As unidades feitas, como a OS grava ("160", "12.5"). */
  unidades: string;
  /** As OS mais recentes com o item, a origem que a sugestão mostra. */
  os_recentes: string[];
  calculada_em: string;
};

/** O id da medida sai do tipo, do escopo e da chave: a mesma medida cai sempre no mesmo documento. */
export function idDaMedida(tipo: TipoDeMedida, customerCode: string | null, chave: string): string {
  return `med_${createHash("sha256").update(JSON.stringify([tipo, customerCode ?? "", chave])).digest("hex").slice(0, 24)}`;
}

function quantidadeEmTexto(total: number): string {
  const inteiro = Math.floor(total / 1000);
  const resto = String(total % 1000).padStart(3, "0").replace(/0+$/, "");
  return resto ? `${inteiro}.${resto}` : String(inteiro);
}

function umaCasa(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function medidasDoEscopo(amostras: readonly AmostraDaOs[], customerCode: string | null, calculadaEm: string): MedidaDeDuracao[] {
  const tempos = ajustarTempos(amostras);
  const descricao = new Map<string, ItemDaAmostra>();
  // O nome e a unidade do item vêm da OS mais recente com ele.
  for (const amostra of [...amostras].sort((a, b) => a.revisadaEm.localeCompare(b.revisadaEm))) for (const item of amostra.itens) descricao.set(item.chave, item);
  return [...tempos.entries()]
    .filter(([chave]) => !chave.startsWith("livre:"))
    .map(([chave, tempo]): MedidaDeDuracao => {
      const item = descricao.get(chave);
      return {
        id: idDaMedida("duracao_item", customerCode, chave),
        tipo: "duracao_item",
        escopo: customerCode ? "cliente" : "geral",
        customer_code: customerCode,
        lpu_item_id: chave,
        item: item?.item ?? "",
        unidade: item?.unidade ?? null,
        homem_minuto_por_unidade: umaCasa(tempo.porUnidade),
        execucoes: tempo.execucoes,
        unidades: quantidadeEmTexto(tempo.milesimos),
        os_recentes: tempo.os.slice(0, OS_NA_ORIGEM),
        calculada_em: calculadaEm,
      };
    })
    .sort((a, b) => a.lpu_item_id.localeCompare(b.lpu_item_id));
}

/**
 * As medidas de duração: uma por item e cliente, ajustada só com as OS dele,
 * e uma geral por item, ajustada com as de todos. A do cliente nunca usa OS
 * de outro.
 */
export function medidasDeDuracao(amostras: readonly AmostraDaOs[], calculadaEm: string): MedidaDeDuracao[] {
  const porCliente = new Map<string, AmostraDaOs[]>();
  for (const amostra of amostras) porCliente.set(amostra.customerCode, [...(porCliente.get(amostra.customerCode) ?? []), amostra]);
  const doCliente = [...porCliente.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([code, lista]) => medidasDoEscopo(lista, code, calculadaEm));
  return [...doCliente, ...medidasDoEscopo(amostras, null, calculadaEm)];
}
