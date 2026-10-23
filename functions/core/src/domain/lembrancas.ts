import { milesimos, minutosDeTrabalho } from "./medidas.js";

/**
 * As lembranças da memória da Dute (docs/plataforma/fase-5-memoria.md, parte
 * 5.3a): uma por demanda fechada (validada pelo cliente: A faturar, faturada
 * ou paga), com o que foi orçado e o que foi feito, item a item, o valor dos
 * dois, o tempo de trabalho das OS e um resumo em texto. O vetor de
 * semelhança é o dos itens da LPU (pergunta 29, pela recomendação): o
 * orçamento parecido é o que pede os mesmos itens, em quantidades parecidas.
 */

export const AI_CASE_MEMORY_COLLECTION = "ai_case_memory";

/** As etapas em que a demanda já foi validada pelo cliente: o caso está fechado. */
export const ETAPAS_FECHADAS = ["a_faturar", "faturada", "paga"] as const;

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objetos(valor: unknown): Registro[] {
  return Array.isArray(valor) ? valor.filter((item): item is Registro => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

/** A RV lida do orçamento: as linhas sem o ajuste (que é só dinheiro) e o total. */
export type RevisaoLida = { rv: number; linhas: Array<{ chave: string; lpuItemId: string | null; item: string; unidade: string | null; servico: string | null; milesimos: number }>; totalCents: number | null };

export function revisaoLida(rv: number, dados: Registro | null): RevisaoLida | null {
  if (!dados) return null;
  const linhas = objetos(dados.linhas).flatMap((linha) => {
    if (texto(linha.origem) === "ajuste") return [];
    const quantidade = milesimos(linha.quantidade);
    const item = texto(linha.item) || texto(linha.descricao);
    if (quantidade <= 0 || !item) return [];
    const lpuItemId = texto(linha.lpu_item_id) || null;
    return [{ chave: lpuItemId ?? `livre:${item.toLocaleLowerCase("pt-BR")}`, lpuItemId, item, unidade: texto(linha.unidade) || null, servico: texto(linha.servico) || null, milesimos: quantidade }];
  });
  return { rv, linhas, totalCents: inteiro(dados.total_cents) };
}

/** A OS revisada da demanda: o tempo de trabalho e o homem-minuto. */
export type OsDoCaso = { numero: string; minutos: number | null; pessoas: number };

export function osDoCaso(numero: string, dados: Registro): OsDoCaso | null {
  if (texto(dados.status) !== "revisada" || texto(dados.tipo) === "vistoria") return null;
  const revisao = dados.revisao && typeof dados.revisao === "object" ? (dados.revisao as Registro) : {};
  return { numero, minutos: minutosDeTrabalho(objetos(dados.etapas)), pessoas: inteiro(revisao.pessoas) ?? 0 };
}

export type ItemDoCaso = { lpu_item_id: string | null; item: string; unidade: string | null; orcado: string | null; realizado: string | null };

export type LembrancaDoCaso = {
  demanda: string;
  customer_code: string;
  customer_name: string | null;
  titulo: string | null;
  entrada: string | null;
  servicos: string[];
  itens: ItemDoCaso[];
  /** O vetor de semelhança: o item da LPU e o log da quantidade feita (ou orçada). */
  vetor: Record<string, number>;
  rv_orcada: number | null;
  rv_realizada: number | null;
  /** O valor do orçamento fechado e o da RV validada, em centavos. A lembrança só abre a quem orça. */
  orcado_cents: number | null;
  realizado_cents: number | null;
  executado_de: string | null;
  executado_ate: string | null;
  os: string[];
  minutos_de_trabalho: number | null;
  homem_minutos: number | null;
  resumo: string;
  /** Quando o cliente validou: a entrada na etapa fechada, depois da última reabertura. */
  fechada_em: string | null;
};

function quantidadeEmTexto(total: number): string {
  const inteiroDaQuantidade = Math.floor(total / 1000);
  const resto = String(total % 1000).padStart(3, "0").replace(/0+$/, "");
  return resto ? `${inteiroDaQuantidade}.${resto}` : String(inteiroDaQuantidade);
}

const REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function reais(centavos: number): string {
  return REAIS.format(centavos / 100).replace(/ /g, " ");
}

function duracao(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return horas ? (resto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`) : `${resto} min`;
}

export function etapaFechada(etapa: unknown): boolean {
  return (ETAPAS_FECHADAS as readonly string[]).includes(texto(etapa));
}

/**
 * Quando a demanda fechou: o primeiro marco numa etapa fechada depois do
 * último marco fora delas (a demanda reaberta e validada de novo fecha na
 * segunda vez). Sem marco, a data da validação.
 */
export function fechamentoDaDemanda(demanda: Registro): string | null {
  let fechada: string | null = null;
  for (const marco of objetos(demanda.marcos)) {
    if (!etapaFechada(marco.etapa)) fechada = null;
    else if (fechada === null) fechada = texto(marco.em) || null;
  }
  if (fechada) return fechada;
  const validacao = demanda.validacao && typeof demanda.validacao === "object" ? (demanda.validacao as Registro) : {};
  return texto(validacao.em) || null;
}

/** As RVs que a lembrança lê: a que fechou o escopo e a validada pelo cliente. */
export function rvsDaDemanda(demanda: Registro): { orcada: number | null; realizada: number | null } {
  const validacao = demanda.validacao && typeof demanda.validacao === "object" ? (demanda.validacao as Registro) : {};
  return { orcada: inteiro(demanda.escopo_rv), realizada: inteiro(validacao.rv) };
}

/**
 * A lembrança da demanda fechada, ou null quando ela ainda não foi validada
 * ou não tem cliente. O orçado é a RV que fechou o escopo; o realizado, a RV
 * validada (a mesma, quando o executado não mudou). A demanda direta não tem
 * orçado.
 */
export function lembrancaDaDemanda(
  numero: string,
  demanda: Registro,
  orcada: RevisaoLida | null,
  realizada: RevisaoLida | null,
  ordens: readonly OsDoCaso[],
): LembrancaDoCaso | null {
  const customerCode = texto(demanda.customer_code);
  if (!customerCode || !etapaFechada(demanda.etapa)) return null;

  const porChave = new Map<string, { lpuItemId: string | null; item: string; unidade: string | null; orcado: number; realizado: number }>();
  const somar = (revisao: RevisaoLida | null, campo: "orcado" | "realizado") => {
    for (const linha of revisao?.linhas ?? []) {
      const atual = porChave.get(linha.chave) ?? { lpuItemId: linha.lpuItemId, item: linha.item, unidade: linha.unidade, orcado: 0, realizado: 0 };
      atual[campo] += linha.milesimos;
      porChave.set(linha.chave, atual);
    }
  };
  somar(orcada, "orcado");
  somar(realizada, "realizado");
  const linhas = [...porChave.values()].sort((a, b) => a.item.localeCompare(b.item, "pt-BR"));
  const itens = linhas.map((linha): ItemDoCaso => ({
    lpu_item_id: linha.lpuItemId,
    item: linha.item,
    unidade: linha.unidade,
    orcado: orcada ? quantidadeEmTexto(linha.orcado) : null,
    realizado: realizada ? quantidadeEmTexto(linha.realizado) : null,
  }));
  // O que foi feito: o realizado, quando o cliente validou uma RV; senão, o orçado.
  const feitos = linhas.map((linha) => ({ ...linha, feito: realizada ? linha.realizado : linha.orcado })).filter((linha) => linha.feito > 0);
  const vetor = vetorDosItens(feitos.map((linha) => ({ lpuItemId: linha.lpuItemId, milesimos: linha.feito })));
  const servicos = [...new Set([...(orcada?.linhas ?? []), ...(realizada?.linhas ?? [])].map((linha) => linha.servico).filter((servico): servico is string => Boolean(servico)))].sort();
  const comTempo = ordens.filter((os) => os.minutos !== null);
  const minutos = comTempo.length ? comTempo.reduce((soma, os) => soma + (os.minutos ?? 0), 0) : null;
  const homemMinutos = comTempo.length ? comTempo.reduce((soma, os) => soma + (os.minutos ?? 0) * os.pessoas, 0) : null;
  const orcadoCents = orcada?.totalCents ?? null;
  const realizadoCents = realizada?.totalCents ?? null;

  const nome = texto(demanda.customer_name) || customerCode;
  const titulo = texto(demanda.titulo) || null;
  const resumo = [
    `Demanda ${numero} · ${nome}`,
    titulo,
    servicos.length ? servicos.join(", ") : null,
    feitos.map((linha) => `${quantidadeEmTexto(linha.feito)} ${linha.unidade ? linha.unidade.toLocaleLowerCase("pt-BR") : "un"} de ${linha.item}`).join(", ") || null,
    orcadoCents !== null ? `orçado ${reais(orcadoCents)}` : null,
    realizadoCents !== null ? `realizado ${reais(realizadoCents)}` : null,
    ordens.length ? `${ordens.length} OS${minutos !== null ? `, ${duracao(minutos)} de trabalho` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    demanda: numero,
    customer_code: customerCode,
    customer_name: texto(demanda.customer_name) || null,
    titulo,
    entrada: texto(demanda.entrada) || null,
    servicos,
    itens,
    vetor,
    rv_orcada: orcada?.rv ?? null,
    rv_realizada: realizada?.rv ?? null,
    orcado_cents: orcadoCents,
    realizado_cents: realizadoCents,
    executado_de: texto(demanda.executado_de) || null,
    executado_ate: texto(demanda.executado_ate) || null,
    os: ordens.map((os) => os.numero).sort(),
    minutos_de_trabalho: minutos,
    homem_minutos: homemMinutos,
    resumo,
    fechada_em: fechamentoDaDemanda(demanda),
  };
}

/**
 * O vetor de semelhança dos itens: o item da LPU e o log da quantidade, para a
 * mesa a mais pesar menos que o item que falta. O item avulso fica de fora; o
 * mesmo item em mais de uma linha soma.
 */
export function vetorDosItens(itens: ReadonlyArray<{ lpuItemId: string | null; milesimos: number }>): Record<string, number> {
  const porItem = new Map<string, number>();
  for (const item of itens) {
    if (item.lpuItemId && item.milesimos > 0) porItem.set(item.lpuItemId, (porItem.get(item.lpuItemId) ?? 0) + item.milesimos);
  }
  return Object.fromEntries([...porItem].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([lpu, total]) => [lpu, Math.round(Math.log1p(total / 1000) * 1000) / 1000]));
}

/**
 * A semelhança de dois vetores de itens, de 0 a 1: o cosseno (os mesmos
 * itens, na mesma proporção) vezes a razão dos tamanhos (na mesma escala: 12
 * mesas não são 300). Sem item em comum, 0.
 */
export function semelhanca(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  let produto = 0;
  for (const [chave, valor] of Object.entries(a)) produto += valor * (b[chave] ?? 0);
  const norma = (vetor: Readonly<Record<string, number>>) => Math.sqrt(Object.values(vetor).reduce((soma, valor) => soma + valor * valor, 0));
  const [na, nb] = [norma(a), norma(b)];
  if (!(na > 0 && nb > 0)) return 0;
  return (produto / (na * nb)) * (Math.min(na, nb) / Math.max(na, nb));
}
