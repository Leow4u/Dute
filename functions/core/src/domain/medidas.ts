import { createHash } from "node:crypto";

/**
 * As medidas da memória da Dute (docs/plataforma/fase-5-memoria.md, partes
 * 5.1a e 5.1b): o homem-minuto por unidade de cada item da LPU, o erro do
 * planejamento e os itens que passam do planejado, a partir das OS
 * revisadas, e o prazo de aprovação do orçamento, a partir das demandas
 * fechadas pelo cliente. Funções puras: a rotina (medidas-gravacao.ts) lê,
 * chama estas contas e grava o resultado. Nada aqui tem valor.
 */

export const AI_MEASURES_COLLECTION = "ai_measures";

export const TIPOS_DE_MEDIDA = ["duracao_item", "erro_planejamento", "passa_do_planejado", "prazo_aprovacao"] as const;
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

// --- O erro do planejamento (parte 5.1b) --------------------------------------------------

/** A OS revisada com a janela planejada e o tempo real, os dois em minutos, como a revisão grava. */
export type PlanejamentoDaOs = { numero: string; customerCode: string; revisadaEm: string; planejados: number; reais: number };

function minutosDaRevisao(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

function revisaoDa(dados: Record<string, unknown>): Record<string, unknown> | null {
  if (texto(dados.status) !== "revisada" || texto(dados.tipo) === "vistoria" || !texto(dados.customer_code)) return null;
  return dados.revisao && typeof dados.revisao === "object" ? (dados.revisao as Record<string, unknown>) : null;
}

export function planejamentoDaOs(numero: string, dados: Record<string, unknown>): PlanejamentoDaOs | null {
  const revisao = revisaoDa(dados);
  const planejados = minutosDaRevisao(revisao?.minutos_planejados);
  const reais = minutosDaRevisao(revisao?.minutos_reais);
  if (!revisao || planejados === null || reais === null) return null;
  return { numero, customerCode: texto(dados.customer_code), revisadaEm: texto(revisao.instante), planejados, reais };
}

export type MedidaDoPlanejamento = {
  id: string;
  tipo: "erro_planejamento";
  escopo: EscopoDaMedida;
  customer_code: string | null;
  /** As OS revisadas com a janela e o tempo real. */
  execucoes: number;
  /** A média de (real − planejado) ÷ planejado, em pontos percentuais inteiros; positivo é plano otimista. */
  erro_medio_pct: number;
  /** As OS que passaram da janela. */
  acima_da_janela: number;
  os_recentes: string[];
  calculada_em: string;
};

function porRecencia<T extends { revisadaEm: string; numero: string }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => b.revisadaEm.localeCompare(a.revisadaEm) || b.numero.localeCompare(a.numero));
}

function porCliente<T extends { customerCode: string }>(lista: readonly T[]): Array<[string, T[]]> {
  const grupos = new Map<string, T[]>();
  for (const item of lista) grupos.set(item.customerCode, [...(grupos.get(item.customerCode) ?? []), item]);
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function medidaDoPlanejamento(lista: readonly PlanejamentoDaOs[], customerCode: string | null, calculadaEm: string): MedidaDoPlanejamento {
  const erros = lista.map((os) => (os.reais - os.planejados) / os.planejados);
  return {
    id: idDaMedida("erro_planejamento", customerCode, "os"),
    tipo: "erro_planejamento",
    escopo: customerCode ? "cliente" : "geral",
    customer_code: customerCode,
    execucoes: lista.length,
    erro_medio_pct: Math.round((erros.reduce((soma, erro) => soma + erro, 0) / lista.length) * 100),
    acima_da_janela: lista.filter((os) => os.reais > os.planejados).length,
    os_recentes: porRecencia(lista).slice(0, OS_NA_ORIGEM).map((os) => os.numero),
    calculada_em: calculadaEm,
  };
}

/** O erro do planejamento por cliente e o geral. */
export function medidasDoPlanejamento(lista: readonly PlanejamentoDaOs[], calculadaEm: string): MedidaDoPlanejamento[] {
  if (!lista.length) return [];
  return [...porCliente(lista).map(([code, doCliente]) => medidaDoPlanejamento(doCliente, code, calculadaEm)), medidaDoPlanejamento(lista, null, calculadaEm)];
}

// --- Os itens que passam do planejado (parte 5.1b) ----------------------------------------

/** Uma linha da revisão com o planejado e o feito, em milésimos. Só as linhas da LPU com planejado. */
export type LinhaPlanejada = { lpuItemId: string; item: string; unidade: string | null; planejado: number; feito: number };
export type LinhasDaOs = { numero: string; customerCode: string; revisadaEm: string; linhas: LinhaPlanejada[] };

export function linhasDaOs(numero: string, dados: Record<string, unknown>): LinhasDaOs | null {
  const revisao = revisaoDa(dados);
  if (!revisao) return null;
  const linhas = objetos(revisao.linhas).flatMap((linha): LinhaPlanejada[] => {
    const lpuItemId = texto(linha.lpu_item_id);
    const planejado = milesimos(linha.planejado);
    if (!lpuItemId || planejado <= 0) return [];
    return [{ lpuItemId, item: texto(linha.item), unidade: texto(linha.unidade) || null, planejado, feito: milesimos(texto(linha.corrigido) || linha.executado) }];
  });
  return linhas.length ? { numero, customerCode: texto(dados.customer_code), revisadaEm: texto(revisao.instante), linhas } : null;
}

export type MedidaDoPlanejado = {
  id: string;
  tipo: "passa_do_planejado";
  escopo: EscopoDaMedida;
  customer_code: string | null;
  lpu_item_id: string;
  item: string;
  unidade: string | null;
  /** As OS revisadas com o item planejado. */
  execucoes: number;
  /** Em quantas o feito passou do planejado. */
  passaram: number;
  /** Nas que passaram, a média do excesso sobre o planejado, em pontos percentuais inteiros; 0 quando nenhuma passou. */
  excesso_medio_pct: number;
  /** As OS mais recentes em que o item passou do planejado. */
  os_recentes: string[];
  calculada_em: string;
};

function medidasDoPlanejadoNoEscopo(lista: readonly LinhasDaOs[], customerCode: string | null, calculadaEm: string): MedidaDoPlanejado[] {
  const porItem = new Map<string, Array<{ os: LinhasDaOs; linha: LinhaPlanejada }>>();
  for (const os of lista) for (const linha of os.linhas) porItem.set(linha.lpuItemId, [...(porItem.get(linha.lpuItemId) ?? []), { os, linha }]);
  return [...porItem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lpuItemId, ocorrencias]): MedidaDoPlanejado => {
      const passaram = ocorrencias.filter(({ linha }) => linha.feito > linha.planejado);
      const excessos = passaram.map(({ linha }) => (linha.feito - linha.planejado) / linha.planejado);
      const recente = porRecencia(ocorrencias.map(({ os }) => os))[0];
      const descricao = recente?.linhas.find((linha) => linha.lpuItemId === lpuItemId);
      return {
        id: idDaMedida("passa_do_planejado", customerCode, lpuItemId),
        tipo: "passa_do_planejado",
        escopo: customerCode ? "cliente" : "geral",
        customer_code: customerCode,
        lpu_item_id: lpuItemId,
        item: descricao?.item ?? "",
        unidade: descricao?.unidade ?? null,
        execucoes: new Set(ocorrencias.map(({ os }) => os.numero)).size,
        passaram: new Set(passaram.map(({ os }) => os.numero)).size,
        excesso_medio_pct: excessos.length ? Math.round((excessos.reduce((soma, excesso) => soma + excesso, 0) / excessos.length) * 100) : 0,
        os_recentes: [...new Set(porRecencia(passaram.map(({ os }) => os)).map((os) => os.numero))].slice(0, OS_NA_ORIGEM),
        calculada_em: calculadaEm,
      };
    });
}

/** Os itens que passam do planejado, por item e cliente e geral. */
export function medidasDoPlanejado(lista: readonly LinhasDaOs[], calculadaEm: string): MedidaDoPlanejado[] {
  return [...porCliente(lista).flatMap(([code, doCliente]) => medidasDoPlanejadoNoEscopo(doCliente, code, calculadaEm)), ...medidasDoPlanejadoNoEscopo(lista, null, calculadaEm)];
}

// --- O prazo de aprovação do orçamento (parte 5.1b) ---------------------------------------

/**
 * A demanda fechada pelo cliente (`demand.won`, do Comercial): os segundos
 * desde que ela passou a esperar o cliente, que é o envio da RV que fechou.
 */
export type AprovacaoDoOrcamento = { demanda: string; customerCode: string; fechadaEm: string; segundos: number };

export function aprovacaoDoEvento(dados: Record<string, unknown>): AprovacaoDoOrcamento | null {
  if (texto(dados.type) !== "demand.won" || texto(dados.source) !== "functions_comercial") return null;
  const payload = dados.payload && typeof dados.payload === "object" ? (dados.payload as Record<string, unknown>) : {};
  const segundos = payload.segundos_desde_anterior;
  const customerCode = texto(dados.customer_code);
  const demanda = texto(payload.numero);
  if (!customerCode || !demanda || typeof segundos !== "number" || !Number.isFinite(segundos) || segundos < 0) return null;
  return { demanda, customerCode, fechadaEm: texto(dados.occurred_at), segundos };
}

export type MedidaDoPrazo = {
  id: string;
  tipo: "prazo_aprovacao";
  escopo: EscopoDaMedida;
  customer_code: string | null;
  /** As demandas fechadas pelo cliente. */
  execucoes: number;
  /** A mediana e a média dos dias entre o envio e o fechamento, com uma casa. */
  mediana_dias: number;
  media_dias: number;
  demandas_recentes: string[];
  calculada_em: string;
};

function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function medidaDoPrazo(lista: readonly AprovacaoDoOrcamento[], customerCode: string | null, calculadaEm: string): MedidaDoPrazo {
  const dias = lista.map((aprovacao) => aprovacao.segundos / 86_400);
  return {
    id: idDaMedida("prazo_aprovacao", customerCode, "orcamento"),
    tipo: "prazo_aprovacao",
    escopo: customerCode ? "cliente" : "geral",
    customer_code: customerCode,
    execucoes: lista.length,
    mediana_dias: umaCasa(mediana(dias)),
    media_dias: umaCasa(dias.reduce((soma, valor) => soma + valor, 0) / dias.length),
    demandas_recentes: [...lista].sort((a, b) => b.fechadaEm.localeCompare(a.fechadaEm) || b.demanda.localeCompare(a.demanda)).slice(0, OS_NA_ORIGEM).map((aprovacao) => aprovacao.demanda),
    calculada_em: calculadaEm,
  };
}

/** O prazo de aprovação por cliente e o geral. A demanda fechada duas vezes (reaberta) conta a última. */
export function medidasDoPrazo(eventos: readonly AprovacaoDoOrcamento[], calculadaEm: string): MedidaDoPrazo[] {
  const ultima = new Map<string, AprovacaoDoOrcamento>();
  for (const aprovacao of [...eventos].sort((a, b) => a.fechadaEm.localeCompare(b.fechadaEm))) ultima.set(aprovacao.demanda, aprovacao);
  const lista = [...ultima.values()];
  if (!lista.length) return [];
  return [...porCliente(lista).map(([code, doCliente]) => medidaDoPrazo(doCliente, code, calculadaEm)), medidaDoPrazo(lista, null, calculadaEm)];
}

// --- Todas ------------------------------------------------------------------------------

export type Medida = MedidaDeDuracao | MedidaDoPlanejamento | MedidaDoPlanejado | MedidaDoPrazo;
