import { randomBytes } from "node:crypto";

import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import type { ArquivoDoRegistro } from "./arquivos.js";
import { diaValido, diasAte } from "./dia.js";

/**
 * A ficha do colaborador no RH (docs/plataforma/fase-8-rh.md, parte 8.2a).
 *
 * - Cada documento, exame ou treinamento é um registro em `registros`, no
 *   banco `dute-rh`, ligado ao id do cadastro da Operação (`collaborators`,
 *   no banco padrão). A ficha é o conjunto dos registros de quem.
 * - O registro tem o tipo do catálogo, o dia em que foi emitido ou feito e,
 *   quando vence, o dia do vencimento. O exame guarda o resultado.
 * - Em cada tipo, o vigente é o mais recente; os outros ficam substituídos,
 *   com o histórico. Os exames ocupacionais (admissional, periódico, retorno
 *   ao trabalho e mudança de função) são um grupo só, como na NR-7. O tipo
 *   "outro" é um registro por si.
 * - O vencimento do vigente de quem está ativo entra no Início do RH a
 *   DIAS_PARA_O_VENCIMENTO dias, e o vencido também. A CNH segue na Operação.
 *
 * Tudo aqui é puro: a gravação fica em ficha-gravacao.ts.
 */

export const REGISTROS_COLLECTION = "registros";
export const COLLABORATORS_COLLECTION = "collaborators";

/** Quantos dias antes do vencimento o registro entra no Início do RH. */
export const DIAS_PARA_O_VENCIMENTO = 30;

export const CATEGORIAS = ["documento", "exame", "treinamento"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** O catálogo de cada categoria. A CNH não entra: ela é do cadastro da Operação. */
export const TIPOS_POR_CATEGORIA = {
  documento: ["rg", "cpf", "ctps", "pis", "titulo_de_eleitor", "reservista", "comprovante_de_residencia", "contrato_de_trabalho", "outro"],
  exame: ["admissional", "periodico", "retorno_ao_trabalho", "mudanca_de_funcao", "demissional", "outro"],
  treinamento: ["nr06", "nr10", "nr11", "nr12", "nr18", "nr35", "direcao_defensiva", "primeiros_socorros", "integracao", "outro"],
} as const satisfies Record<Categoria, readonly string[]>;

export const RESULTADOS_DO_EXAME = ["apto", "apto_com_restricao", "inapto"] as const;
export type ResultadoDoExame = (typeof RESULTADOS_DO_EXAME)[number];

export const SITUACOES = ["vigente", "substituido", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];

export type RegistroGravado = {
  id: string;
  colaborador_id: string;
  categoria: Categoria;
  tipo: string;
  /** O nome do registro do tipo "outro"; null nos outros tipos. */
  descricao: string | null;
  emitido_em: string;
  vence_em: string | null;
  /** Só no exame. */
  resultado: ResultadoDoExame | null;
  situacao: Situacao;
  /** O registro que tomou o lugar deste, quando substituído. */
  substituido_por: string | null;
  /** O arquivo escaneado (parte 8.2b), ou null. */
  arquivo: ArquivoDoRegistro | null;
  /** O instante em que o registro foi lançado (UTC): desempata o vigente quando as datas são iguais. */
  criado_em: string;
  edicao: number;
};

export const ID_COLABORADOR = /^col_[a-f0-9]{16}$/;
export const ID_REGISTRO = /^reg_[a-f0-9]{16}$/;

export function novoIdDeRegistro(): string {
  return `reg_${randomBytes(8).toString("hex")}`;
}

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  switch (issue.code) {
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? `Informe ${campo}.` : `${campo}: tipo inválido.` };
    case z.ZodIssueCode.too_small:
      return { message: `${campo}: curto demais.` };
    case z.ZodIssueCode.too_big:
      return { message: `${campo}: longo demais.` };
    default:
      return { message: `${campo}: valor inválido.` };
  }
};

export function parseEntrada<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data ?? {}, { errorMap: mensagens });
  if (parsed.success) return parsed.data;
  throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
}

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const edicao = z.number().int().min(1).max(100_000);
/**
 * O intervalo das datas do RH. O campo de data do navegador aceita o ano de
 * dois dígitos como 0025; fora daqui, a data não entra (e o prazo cabe no
 * evento do vencimento).
 */
export const PRIMEIRO_DIA = "1900-01-01";
export const ULTIMO_DIA = "2100-12-31";

const dia = z
  .string()
  .trim()
  .refine(diaValido, "Data inválida.")
  .refine((valor) => valor >= PRIMEIRO_DIA && valor <= ULTIMO_DIA, "Use uma data entre 1900 e 2100.");
const colaboradorId = z.string().regex(ID_COLABORADOR, "Colaborador inválido.");
const registroId = z.string().regex(ID_REGISTRO, "Registro inválido.");

const salvarSchema = z
  .object({
    idempotency_key: chave,
    colaborador_id: colaboradorId,
    id: registroId.optional(),
    expected_edicao: edicao.optional(),
    categoria: z.enum(CATEGORIAS),
    tipo: z.string().trim().min(1).max(40),
    descricao: z.string().trim().max(80, "Use até 80 caracteres no nome do registro.").nullable().optional(),
    emitido_em: dia,
    vence_em: dia.nullable().optional(),
    resultado: z.enum(RESULTADOS_DO_EXAME).nullable().optional(),
  })
  .strict();

export type EntradaDoRegistro = {
  idempotency_key: string;
  colaborador_id: string;
  /** Presente quando altera; ausente quando inclui. */
  id: string | null;
  expected_edicao: number | null;
  categoria: Categoria;
  tipo: string;
  descricao: string | null;
  emitido_em: string;
  vence_em: string | null;
  resultado: ResultadoDoExame | null;
};

/** A entrada de saveRhRecord conferida contra o catálogo e o dia de hoje. */
export function entradaDoRegistro(data: unknown, hoje: string): EntradaDoRegistro {
  const entrada = parseEntrada(salvarSchema, data);
  if ((entrada.id === undefined) !== (entrada.expected_edicao === undefined)) {
    invalid(entrada.id === undefined ? "Informe o registro que muda." : "Informe a edição do registro.");
  }
  const tipos: readonly string[] = TIPOS_POR_CATEGORIA[entrada.categoria];
  if (!tipos.includes(entrada.tipo)) invalid(`tipo: use ${tipos.join(", ")}.`);
  const descricao = entrada.descricao?.replace(/\s+/g, " ") || null;
  if (entrada.tipo === "outro" && (!descricao || descricao.length < 2)) invalid("Informe o nome do registro (ao menos 2 caracteres).");
  if (entrada.tipo !== "outro" && descricao) invalid("Só o tipo outro leva nome.");
  const resultado = entrada.resultado ?? null;
  if (entrada.categoria === "exame" && !resultado) invalid("Informe o resultado do exame.");
  if (entrada.categoria !== "exame" && resultado) invalid("Só o exame tem resultado.");
  if (entrada.emitido_em > hoje) invalid("A data do registro não pode ser depois de hoje.");
  const venceEm = entrada.vence_em ?? null;
  if (venceEm !== null && venceEm <= entrada.emitido_em) invalid("O vencimento vem depois da data do registro.");
  return {
    idempotency_key: entrada.idempotency_key,
    colaborador_id: entrada.colaborador_id,
    id: entrada.id ?? null,
    expected_edicao: entrada.expected_edicao ?? null,
    categoria: entrada.categoria,
    tipo: entrada.tipo,
    descricao,
    emitido_em: entrada.emitido_em,
    vence_em: venceEm,
    resultado,
  };
}

const arquivarSchema = z.object({ idempotency_key: chave, id: registroId, expected_edicao: edicao }).strict();
export type EntradaDoArquivamento = z.infer<typeof arquivarSchema>;

export function entradaDoArquivamento(data: unknown): EntradaDoArquivamento {
  return parseEntrada(arquivarSchema, data);
}

const fichaSchema = z.object({ colaborador_id: colaboradorId }).strict();

export function entradaDaFicha(data: unknown): { colaborador_id: string } {
  return parseEntrada(fichaSchema, data);
}

function edicaoConfere(atual: RegistroGravado, esperada: number | null): void {
  if (atual.edicao !== esperada) throw new HttpsError("failed-precondition", "O registro foi atualizado. Recarregue e tente de novo.");
}

/**
 * O registro depois de incluir ou alterar, ainda sem a situação do grupo
 * (situacoesDoGrupo decide). O tipo não muda: para trocar, arquive e
 * registre de novo.
 */
export function registroSalvo(atual: RegistroGravado | null, entrada: EntradaDoRegistro, id: string, agora: string): RegistroGravado {
  if (atual) {
    edicaoConfere(atual, entrada.expected_edicao);
    if (atual.situacao === "arquivado") throw new HttpsError("failed-precondition", "O registro está arquivado.");
    if (atual.colaborador_id !== entrada.colaborador_id) throw new HttpsError("not-found", "Registro não encontrado.");
    if (atual.categoria !== entrada.categoria || atual.tipo !== entrada.tipo) {
      invalid("O tipo do registro não muda. Arquive e registre de novo.");
    }
  }
  return {
    id,
    colaborador_id: entrada.colaborador_id,
    categoria: entrada.categoria,
    tipo: entrada.tipo,
    descricao: entrada.descricao,
    emitido_em: entrada.emitido_em,
    vence_em: entrada.vence_em,
    resultado: entrada.resultado,
    situacao: atual?.situacao ?? "vigente",
    substituido_por: atual?.substituido_por ?? null,
    arquivo: atual?.arquivo ?? null,
    criado_em: atual?.criado_em ?? agora,
    edicao: (atual?.edicao ?? 0) + 1,
  };
}

/** O registro arquivado: sai da ficha vigente e fica no histórico. */
export function registroArquivado(atual: RegistroGravado, esperada: number): RegistroGravado {
  edicaoConfere(atual, esperada);
  if (atual.situacao === "arquivado") throw new HttpsError("failed-precondition", "O registro já está arquivado.");
  return { ...atual, situacao: "arquivado", substituido_por: null, edicao: atual.edicao + 1 };
}

/**
 * Os exames ocupacionais do PCMSO: o ASO mais recente de qualquer deles é o
 * vigente, como na NR-7 (pergunta 62 do plano). O demissional e o "outro"
 * ficam à parte.
 */
export const EXAMES_OCUPACIONAIS = ["admissional", "periodico", "retorno_ao_trabalho", "mudanca_de_funcao"] as const;

type ChaveDoRegistro = Pick<RegistroGravado, "id" | "colaborador_id" | "categoria" | "tipo">;

/** O mesmo colaborador, a mesma categoria e o mesmo tipo; o "outro" é um tipo por registro. */
export function chaveDoTipo(registro: ChaveDoRegistro): string {
  const tipo = registro.tipo === "outro" ? `outro:${registro.id}` : registro.tipo;
  return `${registro.colaborador_id}/${registro.categoria}/${tipo}`;
}

/** O grupo em que um registro substitui o outro: o tipo, e os exames ocupacionais juntos. */
export function grupoDoRegistro(registro: ChaveDoRegistro): string {
  if (registro.categoria === "exame" && (EXAMES_OCUPACIONAIS as readonly string[]).includes(registro.tipo)) {
    return `${registro.colaborador_id}/exame/ocupacional`;
  }
  return chaveDoTipo(registro);
}

/**
 * A ordem do grupo: o vigente primeiro (situacoesDoGrupo). No empate da
 * emissão, o lançado por último vem antes, vença quando vencer: lançar de
 * novo corrige o vencimento digitado errado (pergunta 61 do plano).
 */
export function maisRecentePrimeiro(a: RegistroGravado, b: RegistroGravado): number {
  return b.emitido_em.localeCompare(a.emitido_em) || b.criado_em.localeCompare(a.criado_em) || b.id.localeCompare(a.id);
}

export type SituacaoNoGrupo = { situacao: Situacao; substituido_por: string | null };

/**
 * A situação de cada registro do mesmo grupo: o mais recente pela data (no
 * empate, o lançado por último) é o vigente; os outros, substituídos por ele.
 * O arquivado fica de fora e continua arquivado. Lançar o exame antigo
 * depois do novo não tira o novo do lugar; arquivar o vigente devolve o
 * anterior.
 */
export function situacoesDoGrupo(registros: readonly RegistroGravado[]): Map<string, SituacaoNoGrupo> {
  const situacoes = new Map<string, SituacaoNoGrupo>();
  const grupos = new Map<string, RegistroGravado[]>();
  for (const registro of registros) {
    if (registro.situacao === "arquivado") {
      situacoes.set(registro.id, { situacao: "arquivado", substituido_por: null });
      continue;
    }
    const chaveDoGrupo = grupoDoRegistro(registro);
    grupos.set(chaveDoGrupo, [...(grupos.get(chaveDoGrupo) ?? []), registro]);
  }
  for (const grupo of grupos.values()) {
    const [vigente, ...anteriores] = [...grupo].sort(maisRecentePrimeiro);
    situacoes.set(vigente.id, { situacao: "vigente", substituido_por: null });
    for (const anterior of anteriores) situacoes.set(anterior.id, { situacao: "substituido", substituido_por: vigente.id });
  }
  return situacoes;
}

export type Vencimento = {
  registro_id: string;
  colaborador_id: string;
  categoria: Categoria;
  tipo: string;
  descricao: string | null;
  vence_em: string;
  /** Dias até o vencimento; negativo quando já venceu. */
  dias: number;
};

export type MarcoDoVencimento = "vencendo" | "vencido";

export function marcoDoVencimento(dias: number): MarcoDoVencimento {
  return dias < 0 ? "vencido" : "vencendo";
}

/**
 * O que vence em até DIAS_PARA_O_VENCIMENTO dias ou já venceu: só o vigente,
 * com vencimento, de quem está ativo. O mais urgente primeiro. É a regra do
 * Início do RH e da rotina diária.
 */
export function vencimentosDoDia(hoje: string, registros: readonly RegistroGravado[], ativos: ReadonlySet<string>): Vencimento[] {
  return registros
    .flatMap((registro): Vencimento[] => {
      if (registro.situacao !== "vigente" || !registro.vence_em || !ativos.has(registro.colaborador_id)) return [];
      const dias = diasAte(hoje, registro.vence_em);
      if (dias > DIAS_PARA_O_VENCIMENTO) return [];
      return [{
        registro_id: registro.id,
        colaborador_id: registro.colaborador_id,
        categoria: registro.categoria,
        tipo: registro.tipo,
        descricao: registro.descricao,
        vence_em: registro.vence_em,
        dias,
      }];
    })
    .sort((a, b) => a.dias - b.dias || a.colaborador_id.localeCompare(b.colaborador_id) || a.registro_id.localeCompare(b.registro_id));
}
