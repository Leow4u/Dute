import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { camposDaEntrada, parseEntrada } from "./ficha.js";

/**
 * As datas do vínculo (parte 8.4; pergunta 63 do plano): a admissão e o
 * desligamento do colaborador de vínculo próprio. Ficam no banco `dute-rh`,
 * em `vinculos`, um documento por colaborador, com o id do cadastro da
 * Operação. Só o rh grava, com o recibo e o evento, como o resto da ficha.
 *
 * Decisões do alinhamento de 26/10/2026 (docs/plataforma/fase-8-rh.md):
 * - só o vínculo próprio tem as datas: freelancer e terceiro não estão na
 *   folha da Dutelog;
 * - o desligamento não mexe no cadastro da Operação: quem tira a pessoa da
 *   escala é a coordenação;
 * - a planilha de colaboradores do mês lista quem tinha vínculo no mês; quem
 *   ainda está sem a admissão entra pela regra de antes (ativo, ou inativo com
 *   exame no mês).
 *
 * Tudo aqui é puro: a gravação fica em vinculo-gravacao.ts.
 */

export const VINCULOS_COLLECTION = "vinculos";

export type DatasDoVinculo = { admissao: string; desligamento: string | null };

export type VinculoGravado = DatasDoVinculo & { colaborador_id: string; edicao: number };

const { chave, edicao, dia, colaboradorId } = camposDaEntrada;

const vinculoSchema = z
  .object({
    idempotency_key: chave,
    colaborador_id: colaboradorId,
    /** A edição que a tela leu; ausente (ou null) quando ainda não há datas. */
    expected_edicao: edicao.nullable().optional(),
    admissao: dia,
    desligamento: dia.nullable().optional(),
  })
  .strict();

export type EntradaDoVinculo = DatasDoVinculo & { idempotency_key: string; colaborador_id: string; expected_edicao: number | null };

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

/** A entrada de saveRhVinculo: a admissão é obrigatória, e o desligamento não vem antes dela. */
export function entradaDoVinculo(data: unknown): EntradaDoVinculo {
  const entrada = parseEntrada(vinculoSchema, data);
  const desligamento = entrada.desligamento ?? null;
  if (desligamento !== null && desligamento < entrada.admissao) invalid("O desligamento não pode ser antes da admissão.");
  return {
    idempotency_key: entrada.idempotency_key,
    colaborador_id: entrada.colaborador_id,
    expected_edicao: entrada.expected_edicao ?? null,
    admissao: entrada.admissao,
    desligamento,
  };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function ilegivel(): never {
  throw new HttpsError("failed-precondition", "Datas do vínculo ilegíveis.");
}

/** As datas gravadas, conferidas campo a campo; o que não confere é ilegível. */
export function vinculoLido(id: string, data: Record<string, unknown>): VinculoGravado {
  if (data.colaborador_id !== id || typeof data.admissao !== "string" || !DIA.test(data.admissao)) ilegivel();
  const desligamento = data.desligamento ?? null;
  if (desligamento !== null && (typeof desligamento !== "string" || !DIA.test(desligamento))) ilegivel();
  if (typeof data.edicao !== "number" || !Number.isInteger(data.edicao) || data.edicao < 1) ilegivel();
  return { colaborador_id: id, admissao: data.admissao, desligamento: desligamento as string | null, edicao: data.edicao };
}

/** As datas de todos, pelo id do colaborador; o ilegível fica de fora da leitura (a gravação recusa). */
export function vinculosPorColaborador(docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>): Map<string, VinculoGravado> {
  const vinculos = new Map<string, VinculoGravado>();
  for (const doc of docs) {
    try {
      vinculos.set(doc.id, vinculoLido(doc.id, doc.data()));
    } catch {
      // O ilegível não entra.
    }
  }
  return vinculos;
}

/**
 * As datas depois de gravar. A edição esperada confere com a gravada: a tela
 * que leu sem datas não grava por cima das de outra pessoa, e a que leu uma
 * edição velha recarrega.
 */
export function vinculoSalvo(atual: VinculoGravado | null, entrada: EntradaDoVinculo): VinculoGravado {
  if ((atual?.edicao ?? null) !== entrada.expected_edicao) {
    throw new HttpsError("failed-precondition", "As datas do vínculo foram atualizadas. Recarregue e tente de novo.");
  }
  return {
    colaborador_id: entrada.colaborador_id,
    admissao: entrada.admissao,
    desligamento: entrada.desligamento,
    edicao: (atual?.edicao ?? 0) + 1,
  };
}

/** O primeiro e o último dia da competência (AAAA-MM). */
export function diasDaCompetencia(competencia: string): { primeiro: string; ultimo: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { primeiro: `${competencia}-01`, ultimo: `${competencia}-${String(ultimo).padStart(2, "0")}` };
}

/** Teve vínculo na competência: admitido até o último dia e, se desligado, desligado a partir do primeiro. */
export function temVinculoNoMes(datas: DatasDoVinculo, competencia: string): boolean {
  const { primeiro, ultimo } = diasDaCompetencia(competencia);
  return datas.admissao <= ultimo && (datas.desligamento === null || datas.desligamento >= primeiro);
}

export const SITUACOES_NO_MES = ["ativo", "inativo", "admissao", "desligamento", "admissao_e_desligamento"] as const;
export type SituacaoNoMes = (typeof SITUACOES_NO_MES)[number];

/**
 * A situação na planilha da competência. Com a admissão, sai das datas: a
 * admissão, o desligamento ou os dois dentro do mês, senão ativo. Sem ela,
 * vale o cadastro da Operação na hora de gerar, como antes da parte 8.4.
 */
export function situacaoNoMes(datas: DatasDoVinculo | null, ativo: boolean, competencia: string): SituacaoNoMes {
  if (!datas) return ativo ? "ativo" : "inativo";
  const noMes = (dia: string | null) => dia !== null && dia.slice(0, 7) === competencia;
  const admitido = noMes(datas.admissao);
  const desligado = noMes(datas.desligamento);
  if (admitido && desligado) return "admissao_e_desligamento";
  if (admitido) return "admissao";
  if (desligado) return "desligamento";
  return "ativo";
}
