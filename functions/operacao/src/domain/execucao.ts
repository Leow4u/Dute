import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import type { OsGravada } from "./os.js";

/**
 * A execução da OS (docs/plataforma/fase-3-operacao.md, parte 3.7a): as
 * etapas, na ordem do serviço, e as ocorrências. Cada registro guarda o
 * instante em que aconteceu (não o do envio), o canal (escritório ou
 * celular), como a informação chegou ao escritório, quem da equipe informou
 * e quem registrou. A primeira etapa põe a OS Em execução.
 *
 * Etapa fora de ordem é recusada: nenhuma etapa vem antes de uma já
 * registrada, nem na ordem nem na hora. Pular etapa vale (transporte sem
 * montagem, montagem no próprio local). Nenhum campo de valor.
 */

export const ETAPAS_DA_OS = ["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "montagem", "fim"] as const;
export type EtapaDaOs = (typeof ETAPAS_DA_OS)[number];

/** As etapas da vistoria (parte 3.11a): ir, chegar e terminar; não há carga, destino nem montagem. */
export const ETAPAS_DA_VISTORIA = ["saida_patio", "chegada_origem", "fim"] as const satisfies readonly EtapaDaOs[];

export const ETAPA_ROTULO: Record<EtapaDaOs, string> = {
  saida_patio: "Saída do pátio",
  chegada_origem: "Chegada na origem",
  carregamento: "Carregamento",
  saida_origem: "Saída da origem",
  chegada_destino: "Chegada no destino",
  montagem: "Montagem",
  fim: "Fim",
};

/** Onde o registro foi feito: no celular da equipe (parte 3.8) ou no escritório. */
export const CANAIS_DO_REGISTRO = ["escritorio", "celular"] as const;
export type CanalDoRegistro = (typeof CANAIS_DO_REGISTRO)[number];

/** Como a informação chegou ao escritório. */
export const MEIOS_DO_ESCRITORIO = ["telefone", "whatsapp", "presencial"] as const;
export type MeioDoEscritorio = (typeof MEIOS_DO_ESCRITORIO)[number];

export const MAX_OCORRENCIAS = 50;
export const MAX_DESCRICAO = 1000;
/** Quanto o relógio de quem registra pode estar adiantado. */
export const TOLERANCIA_DO_RELOGIO_MS = 5 * 60_000;

const NUMERO = /^\d{5,8}-\d{2}$/;
/** Data, hora e fuso: 2026-10-20T11:05-03:00, 2026-10-20T14:05:00.000Z. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type QuemRegistrou = { uid: string; role: string };

/** O que todo registro da execução guarda: quando, por onde, quem informou e quem registrou. */
export type RegistroDaExecucao = {
  /** Quando aconteceu, em UTC (ISO). */
  instante: string;
  canal: CanalDoRegistro;
  meio: MeioDoEscritorio | null;
  /** O colaborador da equipe que informou (id do cadastro), ou null. */
  informado_por: string | null;
  registrado_por: QuemRegistrou;
  /** Quando o servidor gravou, em UTC (ISO). */
  registrado_em: string;
};

export type EtapaRegistrada = RegistroDaExecucao & { etapa: EtapaDaOs };
export type OcorrenciaRegistrada = RegistroDaExecucao & { id: string; descricao: string };

export type ExecucaoDaOs = { etapas: EtapaRegistrada[]; ocorrencias: OcorrenciaRegistrada[] };

// --- Entrada ------------------------------------------------------------------------------

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  if (issue.code === z.ZodIssueCode.invalid_enum_value) return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
  return { message: `${campo}: valor inválido.` };
};

export function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

export function falha(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

export const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
export const numero = z.string().trim().regex(NUMERO, "Número da OS inválido.");
export const instante = z.string().trim().regex(INSTANTE, "Hora inválida: informe data, hora e fuso.");
export const informadoPor = z
  .string()
  .regex(/^col_[a-f0-9]{16}$/, "Quem informou: colaborador inválido.")
  .nullable()
  .optional()
  .transform((valor) => valor ?? null);
export const meio = z
  .enum(MEIOS_DO_ESCRITORIO)
  .nullable()
  .optional()
  .transform((valor) => valor ?? null);

const RegistrarEtapa = z
  .object({ idempotency_key: chave, numero, etapa: z.enum(ETAPAS_DA_OS), instante, informado_por: informadoPor, meio })
  .strict();

const RegistrarOcorrencia = z
  .object({
    idempotency_key: chave,
    numero,
    descricao: z
      .string()
      .trim()
      .min(3, "Descreva a ocorrência.")
      .max(MAX_DESCRICAO, `Use até ${MAX_DESCRICAO} caracteres na ocorrência.`),
    instante,
    informado_por: informadoPor,
    meio,
  })
  .strict();

export type PedidoDeEtapa = z.infer<typeof RegistrarEtapa>;
export type PedidoDeOcorrencia = z.infer<typeof RegistrarOcorrencia>;

export function interpretar<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data, { errorMap: mensagens });
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Entrada inválida.");
  return parsed.data;
}

export function interpretarEtapa(data: unknown): PedidoDeEtapa {
  return interpretar(RegistrarEtapa, data);
}

export function interpretarOcorrencia(data: unknown): PedidoDeOcorrencia {
  return interpretar(RegistrarOcorrencia, data);
}

// --- Regras -------------------------------------------------------------------------------

/**
 * Quem registra: o canal, quem gravou e, no celular, o colaborador ligado ao
 * login (é ele quem informa; parte 3.8a).
 */
export type ContextoDoRegistro = { agora: Date; canal: CanalDoRegistro; registrado_por: QuemRegistrou; informante?: string | null };

function dataEmSaoPaulo(instanteUtc: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(instanteUtc);
}

function horaEmSaoPaulo(instanteUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instanteUtc));
}

function dataBrasileira(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
}

/** Por que a OS não recebe andamento, ou null: só a agendada e a em execução. */
export function problemaParaRegistrar(os: Pick<OsGravada, "status">): string | null {
  switch (os.status) {
    case "agendada":
    case "em_execucao":
      return null;
    case "aberta":
      return "Agende a OS antes de registrar o andamento.";
    case "cancelada":
      return "A OS está cancelada.";
    case "em_revisao":
    case "revisada":
      return "A OS já foi concluída.";
  }
}

/** O instante pedido em UTC, conferido: nem no futuro, nem antes do dia da OS. */
export function instanteDoRegistro(pedido: string, os: Pick<OsGravada, "janela">, agora: Date): string {
  const quando = new Date(pedido);
  if (Number.isNaN(quando.getTime())) invalid("Hora inválida: informe data, hora e fuso.");
  if (quando.getTime() > agora.getTime() + TOLERANCIA_DO_RELOGIO_MS) invalid("A hora informada ainda não chegou.");
  const dia = os.janela?.data;
  if (dia && dataEmSaoPaulo(quando) < dia) invalid(`A hora é de antes do dia da OS (${dataBrasileira(dia)}).`);
  return quando.toISOString();
}

/**
 * Quem informou e o meio. No escritório, quem informou precisa estar na
 * equipe da OS. No celular, quem informa é o colaborador do login (o pedido
 * não escolhe outro) e não há meio.
 */
export function origemDoRegistro(
  os: Pick<OsGravada, "equipe">,
  pedido: { informado_por: string | null; meio: MeioDoEscritorio | null },
  contexto: Pick<ContextoDoRegistro, "canal" | "informante">,
) {
  if (contexto.canal === "celular") {
    if (pedido.meio) invalid("O registro do celular não leva o meio.");
    const informante = contexto.informante ?? null;
    if (pedido.informado_por && pedido.informado_por !== informante) invalid("No celular, quem informa é quem registra.");
    return { informado_por: informante, meio: null };
  }
  if (pedido.informado_por && !os.equipe.some((pessoa) => pessoa.colaborador_id === pedido.informado_por)) {
    invalid("Quem informou não está na equipe da OS.");
  }
  return { informado_por: pedido.informado_por, meio: pedido.meio };
}

export type EtapaNaOs = { etapas: EtapaRegistrada[]; registro: EtapaRegistrada; iniciou: boolean };

/**
 * Registra a etapa. A primeira põe a OS Em execução (e pede a equipe
 * escalada); a etapa já registrada, a que vem antes de uma registrada e a
 * hora antes da última são recusadas.
 */
export function registrarEtapa(os: OsGravada, atuais: readonly EtapaRegistrada[], pedido: PedidoDeEtapa, contexto: ContextoDoRegistro): EtapaNaOs {
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  if (os.tipo === "vistoria" && !(ETAPAS_DA_VISTORIA as readonly string[]).includes(pedido.etapa)) {
    invalid(`A vistoria não tem a etapa ${ETAPA_ROTULO[pedido.etapa]}.`);
  }
  const iniciou = os.status === "agendada";
  if (iniciou && os.equipe.length === 0) falha("Escale a equipe antes de iniciar a OS.");
  if (atuais.some((etapa) => etapa.etapa === pedido.etapa)) falha(`${ETAPA_ROTULO[pedido.etapa]} já foi registrada.`);
  const ordem = ETAPAS_DA_OS.indexOf(pedido.etapa);
  const depois = atuais.find((etapa) => ETAPAS_DA_OS.indexOf(etapa.etapa) > ordem);
  if (depois) falha(`${ETAPA_ROTULO[pedido.etapa]} vem antes de ${ETAPA_ROTULO[depois.etapa]}, que já foi registrada.`);
  const quando = instanteDoRegistro(pedido.instante, os, contexto.agora);
  const ultima = atuais.at(-1);
  if (ultima && quando < ultima.instante) {
    falha(`A hora vem antes de ${ETAPA_ROTULO[ultima.etapa]} (${horaEmSaoPaulo(ultima.instante)}).`);
  }
  const registro: EtapaRegistrada = {
    etapa: pedido.etapa,
    instante: quando,
    canal: contexto.canal,
    ...origemDoRegistro(os, pedido, contexto),
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };
  return { etapas: [...atuais, registro], registro, iniciou };
}

export type OcorrenciaNaOs = { ocorrencias: OcorrenciaRegistrada[]; registro: OcorrenciaRegistrada };

/** Registra a ocorrência (agendada ou em execução), numerada na OS: oc_01, oc_02... */
export function registrarOcorrencia(
  os: OsGravada,
  atuais: readonly OcorrenciaRegistrada[],
  pedido: PedidoDeOcorrencia,
  contexto: ContextoDoRegistro,
): OcorrenciaNaOs {
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  if (atuais.length >= MAX_OCORRENCIAS) falha(`A OS já tem ${MAX_OCORRENCIAS} ocorrências.`);
  const registro: OcorrenciaRegistrada = {
    id: `oc_${String(atuais.length + 1).padStart(2, "0")}`,
    descricao: pedido.descricao,
    instante: instanteDoRegistro(pedido.instante, os, contexto.agora),
    canal: contexto.canal,
    ...origemDoRegistro(os, pedido, contexto),
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };
  return { ocorrencias: [...atuais, registro], registro };
}

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function registroLido(bruto: Record<string, unknown>): RegistroDaExecucao | null {
  const instanteLido = texto(bruto.instante);
  if (!instanteLido || Number.isNaN(new Date(instanteLido).getTime())) return null;
  const quem = bruto.registrado_por && typeof bruto.registrado_por === "object" ? (bruto.registrado_por as Record<string, unknown>) : {};
  return {
    instante: instanteLido,
    canal: bruto.canal === "celular" ? "celular" : "escritorio",
    meio: (MEIOS_DO_ESCRITORIO as readonly string[]).includes(texto(bruto.meio)) ? (texto(bruto.meio) as MeioDoEscritorio) : null,
    informado_por: texto(bruto.informado_por) || null,
    registrado_por: { uid: texto(quem.uid), role: texto(quem.role) },
    registrado_em: texto(bruto.registrado_em),
  };
}

/** As etapas e as ocorrências gravadas na OS; o que não se lê fica de fora. */
export function execucaoLida(data: Record<string, unknown>): ExecucaoDaOs {
  const objetos = (valor: unknown) => (Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : []);
  const etapas = objetos(data.etapas).flatMap((bruto): EtapaRegistrada[] => {
    const registro = registroLido(bruto);
    const etapa = texto(bruto.etapa);
    return registro && (ETAPAS_DA_OS as readonly string[]).includes(etapa) ? [{ ...registro, etapa: etapa as EtapaDaOs }] : [];
  });
  const ocorrencias = objetos(data.ocorrencias).flatMap((bruto): OcorrenciaRegistrada[] => {
    const registro = registroLido(bruto);
    return registro && texto(bruto.id) ? [{ ...registro, id: texto(bruto.id), descricao: texto(bruto.descricao) }] : [];
  });
  return { etapas, ocorrencias };
}
