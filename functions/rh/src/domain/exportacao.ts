import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { PRIMEIRO_DIA, TIPOS_POR_CATEGORIA, grupoDoRegistro, maisRecentePrimeiro, parseEntrada, type RegistroGravado, type ResultadoDoExame } from "./ficha.js";
import { digest } from "./operations.js";

/**
 * A exportação do RH para a contabilidade (parte 8.3; pergunta 24: quem faz a
 * folha transmite o eSocial). Uma por competência (AAAA-MM), com duas
 * planilhas:
 *
 * - os exames ocupacionais cujo ASO é da competência, com os códigos do
 *   S-2220 (tpExameOcup e resAso);
 * - os colaboradores próprios ativos, e os inativos com exame no mês (o
 *   demissional).
 *
 * Só o vínculo próprio entra: o terceiro e o freelancer não são empregados da
 * Dutelog, e o eSocial deles é de quem os emprega. O CPF entra porque a
 * contabilidade identifica o empregado por ele; é a única leitura do CPF no
 * RH. A mesma competência sem mudança devolve a mesma versão (o conteúdo tem
 * hash); com mudança, nasce a versão seguinte, e a anterior continua.
 */

export const EXPORTACOES_COLLECTION = "exportacoes";

export const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ID_EXPORTACAO = /^exp_\d{4}-\d{2}_v\d{1,4}$/;
export const PRIMEIRA_COMPETENCIA = PRIMEIRO_DIA.slice(0, 7);

/** Quantas versões a tela lista, das mais novas. */
export const EXPORTACOES_NA_LISTA = 24;

export const ARQUIVOS = ["exames", "colaboradores"] as const;
export type ArquivoDaExportacao = (typeof ARQUIVOS)[number];

export type TipoDeExame = (typeof TIPOS_POR_CATEGORIA.exame)[number];

/** tpExameOcup do S-2220. O "outro" da ficha é a monitoração pontual. */
export const EXAME_NO_ESOCIAL: Record<TipoDeExame, 0 | 1 | 2 | 3 | 4 | 9> = {
  admissional: 0,
  periodico: 1,
  retorno_ao_trabalho: 2,
  mudanca_de_funcao: 3,
  outro: 4,
  demissional: 9,
};

/** resAso do S-2220: o apto com restrição é apto. */
export const RESULTADO_NO_ESOCIAL: Record<ResultadoDoExame, 1 | 2> = { apto: 1, apto_com_restricao: 1, inapto: 2 };

const ROTULO_DO_EXAME: Record<TipoDeExame, string> = {
  admissional: "Admissional",
  periodico: "Periódico",
  retorno_ao_trabalho: "Retorno ao trabalho",
  mudanca_de_funcao: "Mudança de função",
  outro: "Outro",
  demissional: "Demissional",
};

const ROTULO_DO_RESULTADO: Record<ResultadoDoExame, string> = { apto: "Apto", apto_com_restricao: "Apto com restrição", inapto: "Inapto" };

/** O que a exportação lê do cadastro da Operação: só os de vínculo próprio. */
export type ColaboradorDaExportacao = { id: string; nome: string; cpf: string; funcao: string; ativo: boolean };

export type LinhaDoExame = {
  registro_id: string;
  colaborador_id: string;
  nome: string;
  cpf: string;
  funcao: string;
  tipo: TipoDeExame;
  /** O nome do registro "outro"; null nos demais. */
  descricao: string | null;
  tp_exame_ocup: number;
  data_do_aso: string;
  resultado: ResultadoDoExame;
  res_aso: number;
  vence_em: string | null;
};

export type LinhaDoColaborador = { colaborador_id: string; nome: string; cpf: string; funcao: string; ativo: boolean };

export type ConteudoDaExportacao = { competencia: string; exames: LinhaDoExame[]; colaboradores: LinhaDoColaborador[] };

export type EntradaDaExportacao = { idempotency_key: string; competencia: string };

const exportarSchema = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    competencia: z.string().regex(COMPETENCIA, "competencia: use AAAA-MM."),
  })
  .strict();

/** A competência vai de 1900 ao mês de hoje; o mês que não começou não tem o que exportar. */
export function entradaDaExportacao(data: unknown, hoje: string): EntradaDaExportacao {
  const entrada = parseEntrada(exportarSchema, data);
  if (entrada.competencia > hoje.slice(0, 7)) throw invalido("A competência ainda não começou.");
  if (entrada.competencia < PRIMEIRA_COMPETENCIA) throw invalido("Use uma competência a partir de 1900.");
  return entrada;
}

const baixarSchema = z
  .object({
    id: z.string().regex(ID_EXPORTACAO, "id: exportação inválida."),
    arquivo: z.enum(ARQUIVOS),
  })
  .strict();

export function entradaDoDownload(data: unknown): { id: string; arquivo: ArquivoDaExportacao } {
  return parseEntrada(baixarSchema, data);
}

function invalido(message: string): HttpsError {
  return new HttpsError("invalid-argument", message);
}

export function idDaExportacao(competencia: string, versao: number): string {
  return `exp_${competencia}_v${versao}`;
}

const POR_NOME = new Intl.Collator("pt-BR", { sensitivity: "base" });

function porNome<T extends { nome: string; colaborador_id: string }>(a: T, b: T): number {
  return POR_NOME.compare(a.nome, b.nome) || a.colaborador_id.localeCompare(b.colaborador_id);
}

/**
 * O conteúdo da competência, na ordem da planilha: os exames pela data do
 * ASO e pelo nome, os colaboradores pelo nome. O registro arquivado não
 * entra (saiu da ficha); o substituído entra, porque o exame aconteceu.
 * O mesmo exame lançado de novo para corrigir o anterior (o mesmo
 * colaborador, o mesmo tipo e a mesma data do ASO) entra uma vez, o que a
 * ficha deixa vigente no empate: cada linha vira um S-2220.
 */
export function conteudoDaExportacao(
  competencia: string,
  colaboradores: readonly ColaboradorDaExportacao[],
  registros: readonly RegistroGravado[],
): ConteudoDaExportacao {
  const porId = new Map(colaboradores.map((colaborador) => [colaborador.id, colaborador]));
  // Um por exame: o grupo da ficha (o "outro" é um grupo por registro) e a data do ASO.
  const porExame = new Map<string, RegistroGravado & { resultado: ResultadoDoExame }>();
  for (const registro of registros) {
    if (registro.categoria !== "exame" || registro.situacao === "arquivado" || !registro.resultado) continue;
    if (registro.emitido_em.slice(0, 7) !== competencia) continue;
    const chave = `${grupoDoRegistro(registro)}/${registro.emitido_em}`;
    const anterior = porExame.get(chave);
    if (!anterior || maisRecentePrimeiro(registro, anterior) < 0) porExame.set(chave, { ...registro, resultado: registro.resultado });
  }
  const exames: LinhaDoExame[] = [];
  for (const registro of porExame.values()) {
    const colaborador = porId.get(registro.colaborador_id);
    if (!colaborador) continue;
    const tipo = registro.tipo as TipoDeExame;
    exames.push({
      registro_id: registro.id,
      colaborador_id: colaborador.id,
      nome: colaborador.nome,
      cpf: colaborador.cpf,
      funcao: colaborador.funcao,
      tipo,
      descricao: tipo === "outro" ? registro.descricao : null,
      tp_exame_ocup: EXAME_NO_ESOCIAL[tipo],
      data_do_aso: registro.emitido_em,
      resultado: registro.resultado,
      res_aso: RESULTADO_NO_ESOCIAL[registro.resultado],
      vence_em: registro.vence_em,
    });
  }
  exames.sort((a, b) => a.data_do_aso.localeCompare(b.data_do_aso) || porNome(a, b) || a.registro_id.localeCompare(b.registro_id));
  const comExame = new Set(exames.map((linha) => linha.colaborador_id));
  const linhas = colaboradores
    .filter((colaborador) => colaborador.ativo || comExame.has(colaborador.id))
    .map((colaborador) => ({ colaborador_id: colaborador.id, nome: colaborador.nome, cpf: colaborador.cpf, funcao: colaborador.funcao, ativo: colaborador.ativo }));
  linhas.sort(porNome);
  return { competencia, exames, colaboradores: linhas };
}

/** O hash do conteúdo: a mesma competência sem mudança tem o mesmo. */
export function hashDoConteudo(conteudo: ConteudoDaExportacao): string {
  return digest(conteudo, 32);
}

// --- O arquivo -----------------------------------------------------------------------------

const SEPARADOR = ";";

/**
 * Uma célula do CSV. O texto que começa com =, +, -, @ ou tabulação ganha um
 * apóstrofo, para a planilha não ler como fórmula; o que tem separador, aspas
 * ou quebra vai entre aspas.
 */
export function celula(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV para a planilha em português: BOM do UTF-8, ponto e vírgula e CRLF. */
export function csv(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  return `﻿${[cabecalho, ...linhas].map((linha) => linha.map(celula).join(SEPARADOR)).join("\r\n")}\r\n`;
}

export function diaBr(dia: string | null): string {
  return dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : "";
}

export function cpfBr(cpf: string): string {
  return /^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

export const CABECALHO_DOS_EXAMES = [
  "Nome",
  "CPF",
  "Função",
  "Exame",
  "tpExameOcup",
  "Data do ASO",
  "Resultado",
  "resAso",
  "Vence em",
] as const;

export const CABECALHO_DOS_COLABORADORES = ["Nome", "CPF", "Função", "Situação"] as const;

export type ArquivoGerado = { nome: string; conteudo: string };

export function arquivoDaExportacao(
  conteudo: Pick<ConteudoDaExportacao, "competencia" | "exames" | "colaboradores">,
  versao: number,
  arquivo: ArquivoDaExportacao,
): ArquivoGerado {
  const nome = `dute-rh-${arquivo}-${conteudo.competencia}-v${versao}.csv`;
  if (arquivo === "exames") {
    return {
      nome,
      conteudo: csv(
        CABECALHO_DOS_EXAMES,
        conteudo.exames.map((linha) => [
          linha.nome,
          cpfBr(linha.cpf),
          linha.funcao,
          linha.descricao ?? ROTULO_DO_EXAME[linha.tipo],
          String(linha.tp_exame_ocup),
          diaBr(linha.data_do_aso),
          ROTULO_DO_RESULTADO[linha.resultado],
          String(linha.res_aso),
          diaBr(linha.vence_em),
        ]),
      ),
    };
  }
  return {
    nome,
    conteudo: csv(
      CABECALHO_DOS_COLABORADORES,
      conteudo.colaboradores.map((linha) => [linha.nome, cpfBr(linha.cpf), linha.funcao, linha.ativo ? "Ativo" : "Inativo"]),
    ),
  };
}
