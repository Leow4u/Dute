/**
 * A exportação do RH para a contabilidade na tela (parte 8.3,
 * docs/plataforma/fase-8-rh.md): a leitura do que listRhExports,
 * exportRhMonth e downloadRhExport devolvem e os textos da competência. As
 * planilhas saem do servidor, da versão guardada; a tela só baixa.
 */

export const ARQUIVOS_DA_EXPORTACAO = ["exames", "colaboradores"] as const;
export type ArquivoDaExportacao = (typeof ARQUIVOS_DA_EXPORTACAO)[number];

export const ROTULO_DO_ARQUIVO: Record<ArquivoDaExportacao, string> = { exames: "Baixar exames", colaboradores: "Baixar colaboradores" };

export type ExportacaoNaLista = {
  id: string;
  competencia: string;
  versao: number;
  exames: number;
  colaboradores: number;
  gerada_em: string;
  gerada_por: string;
};

export type ResultadoDaExportacao = { id: string; versao: number; nova: boolean };

export type ArquivoBaixado = { nome: string; conteudo: string };

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^exp_\d{4}-\d{2}_v\d{1,4}$/;

function inteiro(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0;
}

function exportacaoLida(valor: unknown): ExportacaoNaLista | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Record<string, unknown>;
  if (typeof item.id !== "string" || !ID.test(item.id)) return null;
  if (typeof item.competencia !== "string" || !COMPETENCIA.test(item.competencia)) return null;
  if (!inteiro(item.versao) || !inteiro(item.exames) || !inteiro(item.colaboradores)) return null;
  if (typeof item.gerada_em !== "string" || typeof item.gerada_por !== "string") return null;
  return {
    id: item.id,
    competencia: item.competencia,
    versao: item.versao,
    exames: item.exames,
    colaboradores: item.colaboradores,
    gerada_em: item.gerada_em,
    gerada_por: item.gerada_por,
  };
}

export function exportacoesLidas(valor: unknown): ExportacaoNaLista[] | null {
  if (!valor || typeof valor !== "object") return null;
  const lista = (valor as { exportacoes?: unknown }).exportacoes;
  if (!Array.isArray(lista)) return null;
  const lidas = lista.map(exportacaoLida);
  return lidas.every((item): item is ExportacaoNaLista => item !== null) ? lidas : null;
}

export function resultadoLido(valor: unknown): ResultadoDaExportacao | null {
  if (!valor || typeof valor !== "object") return null;
  const resultado = valor as Record<string, unknown>;
  if (typeof resultado.id !== "string" || !ID.test(resultado.id) || !inteiro(resultado.versao) || typeof resultado.nova !== "boolean") return null;
  return { id: resultado.id, versao: resultado.versao, nova: resultado.nova };
}

export function arquivoLido(valor: unknown): ArquivoBaixado | null {
  if (!valor || typeof valor !== "object") return null;
  const arquivo = valor as Record<string, unknown>;
  if (typeof arquivo.nome !== "string" || !/^dute-rh-[a-z]+-\d{4}-\d{2}-v\d+\.csv$/.test(arquivo.nome) || typeof arquivo.conteudo !== "string") return null;
  return { nome: arquivo.nome, conteudo: arquivo.conteudo };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-10" → "Outubro de 2026". */
export function textoDaCompetencia(competencia: string): string {
  const mes = MESES[Number(competencia.slice(5, 7)) - 1] ?? "";
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${competencia.slice(0, 4)}`;
}

/**
 * A competência que a tela abre: a do mês anterior ao de hoje (AAAA-MM-DD),
 * porque o S-2220 do mês vai até o dia 15 do seguinte.
 */
export function competenciaPadrao(hoje: string): string {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
}

/** O teto do campo de competência: o mês de hoje. */
export function competenciaDeHoje(hoje: string): string {
  return hoje.slice(0, 7);
}

export function competenciaValida(valor: string, hoje: string): boolean {
  return COMPETENCIA.test(valor) && valor >= "1900-01" && valor <= competenciaDeHoje(hoje);
}

/** O retorno da geração, para o aviso da tela. */
export function textoDoResultado(resultado: ResultadoDaExportacao, competencia: string): string {
  const mes = textoDaCompetencia(competencia);
  return resultado.nova ? `${mes}: versão ${resultado.versao} gerada` : `${mes}: nada mudou desde a versão ${resultado.versao}`;
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" });

/** O dia (AAAA-MM-DD) em São Paulo, o fuso das rotinas e das competências do RH. */
export function diaEmSaoPaulo(instante: Date = new Date()): string {
  return DIA_EM_SAO_PAULO.format(instante);
}

/** "2026-10-24T15:00:00.000Z" → "24/10/2026", em São Paulo. */
export function dataDaGeracao(iso: string): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return "";
  const [ano, mes, dia] = diaEmSaoPaulo(instante).split("-");
  return `${dia}/${mes}/${ano}`;
}
