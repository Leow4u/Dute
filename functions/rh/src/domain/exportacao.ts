import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { PRIMEIRO_DIA, TIPOS_POR_CATEGORIA, chaveDoTipo, maisRecentePrimeiro, parseEntrada, type RegistroGravado, type ResultadoDoExame } from "./ficha.js";
import { digest } from "./operations.js";
import { situacaoNoMes, temVinculoNoMes, type SituacaoNoMes } from "./vinculo.js";

/**
 * A exportação do RH para a contabilidade (parte 8.3; pergunta 24: quem faz a
 * folha transmite o eSocial). Uma por competência (AAAA-MM), com duas
 * planilhas:
 *
 * - os exames ocupacionais cujo ASO é da competência, com os códigos do
 *   S-2220 (tpExameOcup e resAso);
 * - os colaboradores próprios com vínculo no mês, pelas datas de admissão e
 *   de desligamento (parte 8.4); quem ainda está sem a admissão entra pela
 *   regra de antes: ativo, ou inativo com exame no mês (o demissional).
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

/** O que a exportação lê do cadastro da Operação (só os de vínculo próprio), com as datas do vínculo do RH. */
export type ColaboradorDaExportacao = {
  id: string;
  nome: string;
  cpf: string;
  funcao: string;
  ativo: boolean;
  /** As datas do vínculo (parte 8.4); null enquanto o RH não grava. */
  admissao: string | null;
  desligamento: string | null;
};

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

export type LinhaDoColaborador = {
  colaborador_id: string;
  nome: string;
  cpf: string;
  funcao: string;
  admissao: string | null;
  desligamento: string | null;
  situacao_no_mes: SituacaoNoMes;
};

/** A linha das versões de antes da parte 8.4 (formato 1): a situação do cadastro na hora de gerar. */
export type LinhaDoColaboradorAntiga = { colaborador_id: string; nome: string; cpf: string; funcao: string; ativo: boolean };

/** O formato das linhas de colaboradores: 1 até a parte 8.4; 2 com as datas do vínculo. */
export const FORMATO_DA_EXPORTACAO = 2;

export type ConteudoDaExportacao = { competencia: string; formato: typeof FORMATO_DA_EXPORTACAO; exames: LinhaDoExame[]; colaboradores: LinhaDoColaborador[] };

/** A versão guardada, de qualquer formato: a planilha sai como foi gerada. */
export type ConteudoGuardado =
  | { competencia: string; formato: 1; exames: LinhaDoExame[]; colaboradores: LinhaDoColaboradorAntiga[] }
  | ConteudoDaExportacao;

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
  // Um por exame: o tipo (o "outro" é um tipo por registro) e a data do ASO. Não o grupo da
  // ficha: o admissional e o periódico do mesmo dia são dois exames, cada um com o seu S-2220.
  const porExame = new Map<string, RegistroGravado & { resultado: ResultadoDoExame }>();
  for (const registro of registros) {
    if (registro.categoria !== "exame" || registro.situacao === "arquivado" || !registro.resultado) continue;
    if (registro.emitido_em.slice(0, 7) !== competencia) continue;
    const chave = `${chaveDoTipo(registro)}/${registro.emitido_em}`;
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
    .flatMap((colaborador): LinhaDoColaborador[] => {
      const datas = colaborador.admissao ? { admissao: colaborador.admissao, desligamento: colaborador.desligamento } : null;
      const entra = datas ? temVinculoNoMes(datas, competencia) : colaborador.ativo || comExame.has(colaborador.id);
      if (!entra) return [];
      return [{
        colaborador_id: colaborador.id,
        nome: colaborador.nome,
        cpf: colaborador.cpf,
        funcao: colaborador.funcao,
        admissao: datas?.admissao ?? null,
        desligamento: datas?.desligamento ?? null,
        situacao_no_mes: situacaoNoMes(datas, colaborador.ativo, competencia),
      }];
    })
    .sort(porNome);
  return { competencia, formato: FORMATO_DA_EXPORTACAO, exames, colaboradores: linhas };
}

/** A linha sem o nome e a função, que o hash não conta. */
function semRotulo<T extends { nome: string; funcao: string }>(linha: T): Omit<T, "nome" | "funcao"> {
  const { nome, funcao, ...resto } = linha;
  return resto;
}

/**
 * O hash do conteúdo: a mesma competência sem mudança tem o mesmo. Conta o
 * que a contabilidade usa: quem está na planilha, o CPF, as datas do vínculo,
 * a situação no mês e os exames. O nome e a função vão na planilha, mas
 * sozinhos não criam versão nova (parte 8.4): o mês passado não muda porque o
 * cadastro mudou depois. Por isso a ordem aqui é a do id, e não a do nome.
 */
export function hashDoConteudo(conteudo: ConteudoDaExportacao): string {
  return digest(
    {
      competencia: conteudo.competencia,
      formato: conteudo.formato,
      exames: conteudo.exames.map(semRotulo).sort((a, b) => a.registro_id.localeCompare(b.registro_id)),
      colaboradores: conteudo.colaboradores.map(semRotulo).sort((a, b) => a.colaborador_id.localeCompare(b.colaborador_id)),
    },
    32,
  );
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

export const CABECALHO_DOS_COLABORADORES = ["Nome", "CPF", "Função", "Admissão", "Desligamento", "Situação no mês"] as const;

/** O cabeçalho das versões de antes da parte 8.4 (formato 1). */
export const CABECALHO_DOS_COLABORADORES_ANTIGO = ["Nome", "CPF", "Função", "Situação"] as const;

const ROTULO_DA_SITUACAO_NO_MES: Record<SituacaoNoMes, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  admissao: "Admissão no mês",
  desligamento: "Desligamento no mês",
  admissao_e_desligamento: "Admissão e desligamento no mês",
};

export type ArquivoGerado = { nome: string; conteudo: string };

export function arquivoDaExportacao(conteudo: ConteudoGuardado, versao: number, arquivo: ArquivoDaExportacao): ArquivoGerado {
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
  if (conteudo.formato === 1) {
    return {
      nome,
      conteudo: csv(
        CABECALHO_DOS_COLABORADORES_ANTIGO,
        conteudo.colaboradores.map((linha) => [linha.nome, cpfBr(linha.cpf), linha.funcao, linha.ativo ? "Ativo" : "Inativo"]),
      ),
    };
  }
  return {
    nome,
    conteudo: csv(
      CABECALHO_DOS_COLABORADORES,
      conteudo.colaboradores.map((linha) => [
        linha.nome,
        cpfBr(linha.cpf),
        linha.funcao,
        diaBr(linha.admissao),
        diaBr(linha.desligamento),
        ROTULO_DA_SITUACAO_NO_MES[linha.situacao_no_mes],
      ]),
    ),
  };
}
