import type { Papel } from "@workspace/dominio";

import type { TabelaDoRelatorio, ValorDaCelula } from "../operacao/relatorios";

/**
 * O painel de acerto da memória (parte 5.6, docs/plataforma/fase-5-memoria.md):
 * das sugestões de duração da OS gravadas em `ai_suggestions`, a taxa de
 * aceite e o erro médio contra o tempo real da OS revisada, da sugestão e do
 * que a pessoa planejou. É um relatório da Operação, só para owner e admin
 * (as regras abrem a lista inteira só a eles), onde a memória roda.
 *
 * O erro é o desvio absoluto contra o real, em porcentagem do previsto: 30
 * minutos a mais ou a menos numa OS de 3 horas contam 17%. Os dois erros
 * contam só a sugestão completa (todos os itens com base), a mesma base para
 * comparar a memória com o planejamento: a parcial soma só os itens com
 * base, e o real é o da OS inteira.
 */

/** Quem vê o painel: as regras de `ai_suggestions` abrem a lista inteira só a owner e admin. */
export const ACERTO_ROLES = ["owner", "admin"] as const satisfies readonly Papel[];

export const RELATORIO_DO_ACERTO = "acerto";
export const ROTULO_DO_ACERTO = "Acerto da memória";

export function veAcerto(role: string | null | undefined, memoria: boolean): boolean {
  return memoria && (ACERTO_ROLES as readonly string[]).includes(role ?? "");
}

export type Decisao = "aceitou" | "mudou" | "recusou";

export type SugestaoDoAcerto = {
  id: string;
  customerCode: string;
  criadaEm: string;
  decisao: Decisao;
  /** Os minutos sugeridos. */
  sugeridos: number;
  /** Todos os itens tinham base: o sugerido cobre a OS inteira. */
  completa: boolean;
  /** Os minutos que a pessoa planejou; null sem o número. */
  planejados: number | null;
  /** O tempo de trabalho da OS revisada; null até a revisão. */
  reais: number | null;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function positivo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** O documento de `ai_suggestions` para o painel; só a duração da OS, com o sugerido e a decisão. */
export function sugestaoDoAcerto(id: string, dados: Registro): SugestaoDoAcerto | null {
  if (texto(dados.tipo) !== "duracao_os") return null;
  const decisao = texto(dados.decisao);
  if (decisao !== "aceitou" && decisao !== "mudou" && decisao !== "recusou") return null;
  const sugestao = dados.sugestao && typeof dados.sugestao === "object" ? (dados.sugestao as Registro) : {};
  const sugeridos = positivo(sugestao.minutos_total);
  const customerCode = texto(dados.customer_code);
  if (sugeridos === null || !customerCode) return null;
  return {
    id,
    customerCode,
    criadaEm: texto(dados.criada_em),
    decisao,
    sugeridos,
    completa: sugestao.completa === true,
    planejados: positivo(dados.minutos_escolhidos),
    reais: typeof dados.valor_real === "number" && Number.isFinite(dados.valor_real) && dados.valor_real >= 0 ? dados.valor_real : null,
  };
}

function porcento(parte: number, todo: number): number | null {
  return todo ? Math.round((parte / todo) * 100) : null;
}

function erroMedio(pares: ReadonlyArray<[previsto: number, real: number]>): number | null {
  if (!pares.length) return null;
  const soma = pares.reduce((total, [previsto, real]) => total + Math.abs(real - previsto) / previsto, 0);
  return Math.round((soma / pares.length) * 100);
}

export type NumerosDoAcerto = {
  sugestoes: number;
  aceitas: number;
  mudadas: number;
  recusadas: number;
  aceite: number | null;
  /** As completas com o tempo real: a base dos dois erros. */
  comReal: number;
  erroDaSugestao: number | null;
  erroDoPlanejado: number | null;
};

export function numerosDoAcerto(sugestoes: readonly SugestaoDoAcerto[]): NumerosDoAcerto {
  // A base dos dois erros: a sugestão completa com o tempo real (ver o topo).
  const comReal = sugestoes.filter((sugestao): sugestao is SugestaoDoAcerto & { reais: number } => sugestao.completa && sugestao.reais !== null);
  const aceitas = sugestoes.filter((sugestao) => sugestao.decisao === "aceitou").length;
  return {
    sugestoes: sugestoes.length,
    aceitas,
    mudadas: sugestoes.filter((sugestao) => sugestao.decisao === "mudou").length,
    recusadas: sugestoes.filter((sugestao) => sugestao.decisao === "recusou").length,
    aceite: porcento(aceitas, sugestoes.length),
    comReal: comReal.length,
    erroDaSugestao: erroMedio(comReal.map((sugestao) => [sugestao.sugeridos, sugestao.reais])),
    erroDoPlanejado: erroMedio(comReal.flatMap((sugestao) => (sugestao.planejados === null ? [] : [[sugestao.planejados, sugestao.reais] as [number, number]]))),
  };
}

const COLUNAS = ["Cliente", "Sugestões", "Aceitas", "Mudadas", "Recusadas", "Aceite (%)", "Com o tempo real", "Erro da sugestão (%)", "Erro do planejado (%)"];

function celulas(numeros: NumerosDoAcerto): ValorDaCelula[] {
  return [numeros.sugestoes, numeros.aceitas, numeros.mudadas, numeros.recusadas, numeros.aceite, numeros.comReal, numeros.erroDaSugestao, numeros.erroDoPlanejado];
}

/** Uma linha por cliente, da que tem mais sugestões, e o total. */
export function tabelaDoAcerto(sugestoes: readonly SugestaoDoAcerto[], nomeDoCliente: (codigo: string) => string): TabelaDoRelatorio {
  const porCliente = new Map<string, SugestaoDoAcerto[]>();
  for (const sugestao of sugestoes) porCliente.set(sugestao.customerCode, [...(porCliente.get(sugestao.customerCode) ?? []), sugestao]);
  const grupos = [...porCliente.entries()]
    .map(([codigo, lista]) => ({ codigo, nome: nomeDoCliente(codigo), lista }))
    .sort((a, b) => b.lista.length - a.lista.length || a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    colunas: COLUNAS,
    linhas: grupos.map((grupo) => ({ chave: grupo.codigo, celulas: [grupo.nome, ...celulas(numerosDoAcerto(grupo.lista))] })),
    total: sugestoes.length ? ["Total", ...celulas(numerosDoAcerto(sugestoes))] : null,
  };
}

const COMO_PORCENTO = (valor: number | null) => (valor === null ? "—" : `${valor}%`);

/** Os números do topo: as sugestões, o aceite e os dois erros. */
export function resumoDoAcerto(sugestoes: readonly SugestaoDoAcerto[]): Array<{ rotulo: string; valor: string }> {
  const numeros = numerosDoAcerto(sugestoes);
  return [
    { rotulo: "Sugestões", valor: String(numeros.sugestoes) },
    { rotulo: "Aceite", valor: COMO_PORCENTO(numeros.aceite) },
    { rotulo: "Erro da sugestão", valor: COMO_PORCENTO(numeros.erroDaSugestao) },
    { rotulo: "Erro do planejado", valor: COMO_PORCENTO(numeros.erroDoPlanejado) },
  ];
}
