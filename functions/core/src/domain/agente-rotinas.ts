import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { conversarComDute, MESSAGES_COLLECTION, type OpcoesDaConversa } from "./agente-conversa.js";
import { escopoDoAgente, type EscopoDoAgente } from "./agente-escopo.js";
import { texto } from "./agente-ferramentas.js";
import { agenteProblem } from "./platform-roles.js";
import { loadProfile, type CoreProfile } from "./profile.js";

/**
 * As rotinas do Agent Dute no núcleo (parte 5.5g): uma pergunta que o agente
 * responde sozinho no horário marcado, na coleção do WMS (`agent_routines`),
 * no formato dele, mais o módulo da conversa. A rotina só consulta: roda com
 * o perfil ATUAL de quem criou (sem acesso, pausa), pelo mesmo fluxo da
 * conversa, numa conversa própria (`routine_<id>`).
 *
 * A rotina agendada do núcleo (`runDuteRoutines`) pega as vencidas numa
 * transação por rotina; onde o agente do núcleo está liberado, a do WMS não
 * roda, para uma rotina rodar por um só.
 */

export const ROUTINES_COLLECTION = "agent_routines";
export const ROTINAS_POR_PESSOA = 5;
/** São Paulo não tem horário de verão desde 2019. */
const FUSO_DE_SAO_PAULO_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 86_400_000;
const INTERVALO_MINIMO_MS = 5 * 60_000;

export const FREQUENCIAS = ["daily", "weekdays", "weekly", "monthly"] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];

export type AgendaDaRotina = {
  frequency: Frequencia;
  /** 0 = domingo … 6 = sábado (toda semana). */
  days: number[];
  /** 1 a 28 (todo mês). */
  day_of_month: number | null;
  /** HH:MM, de 15 em 15 minutos, horário de São Paulo. */
  time: string;
};

const HORARIO = /^([01]\d|2[0-3]):(00|15|30|45)$/;

/** A agenda que vale: só os dias da semana na semanal, só o dia do mês na mensal. A mesma do WMS. */
export function agendaDe(entrada: { frequency: Frequencia; days?: number[] | null; day_of_month?: number | null; time: string }): AgendaDaRotina {
  return {
    frequency: entrada.frequency,
    days: entrada.frequency === "weekly" ? [...new Set(entrada.days ?? [])].sort() : [],
    day_of_month: entrada.frequency === "monthly" ? (entrada.day_of_month ?? 1) : null,
    time: entrada.time,
  };
}

function cai(agenda: AgendaDaRotina, local: Date): boolean {
  const diaDaSemana = local.getUTCDay();
  if (agenda.frequency === "weekdays") return diaDaSemana >= 1 && diaDaSemana <= 5;
  if (agenda.frequency === "weekly") return agenda.days.includes(diaDaSemana);
  if (agenda.frequency === "monthly") return local.getUTCDate() === agenda.day_of_month;
  return true;
}

/** O próximo horário da agenda depois de `depois`, em UTC. */
export function proximaVez(agenda: AgendaDaRotina, depois: Date): Date {
  const [horas, minutos] = agenda.time.split(":").map(Number) as [number, number];
  const agoraLocal = new Date(depois.getTime() + FUSO_DE_SAO_PAULO_MS);
  const inicioDoDia = Date.UTC(agoraLocal.getUTCFullYear(), agoraLocal.getUTCMonth(), agoraLocal.getUTCDate());
  for (let dias = 0; dias <= 62; dias += 1) {
    const candidatoLocal = new Date(inicioDoDia + dias * DIA_MS + (horas * 60 + minutos) * 60_000);
    const utc = new Date(candidatoLocal.getTime() - FUSO_DE_SAO_PAULO_MS);
    if (utc.getTime() > depois.getTime() && cai(agenda, candidatoLocal)) return utc;
  }
  throw new Error("Agenda sem próxima execução.");
}

// --- A rotina da pessoa -----------------------------------------------------------------------

const EntradaDaRotina = z
  .object({
    customer_code: z.string().trim().max(80).nullish(),
    modulo: z.string().trim().max(20),
    id: z.string().trim().regex(/^rot_[a-f0-9]{20}$/, "Rotina inválida.").nullish(),
    name: z.string().trim().min(2).max(80),
    prompt: z.string().trim().min(5).max(600),
    frequency: z.enum(FREQUENCIAS),
    days: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
    day_of_month: z.number().int().min(1).max(28).nullish(),
    time: z.string().regex(HORARIO, "Use um horário de 15 em 15 minutos (ex.: 08:00, 08:15)."),
    active: z.boolean().nullish(),
    // Criada pelo cartão da conversa: a mensagem que trouxe a sugestão.
    agent_message_id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/).nullish(),
  })
  .strict()
  .superRefine((entrada, contexto) => {
    if (entrada.frequency === "weekly" && !entrada.days?.length) contexto.addIssue({ code: "custom", path: ["days"], message: "Escolha ao menos um dia da semana." });
    if (entrada.frequency === "monthly" && !entrada.day_of_month) contexto.addIssue({ code: "custom", path: ["day_of_month"], message: "Escolha o dia do mês." });
    if (entrada.id && entrada.agent_message_id) contexto.addIssue({ code: "custom", path: ["agent_message_id"], message: "O cartão cria uma rotina nova." });
  });

function interpretar<T>(schema: z.ZodType<T>, data: unknown): T {
  const lido = schema.safeParse(data && typeof data === "object" ? data : {});
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

function idDaRotina(semente: string): string {
  return `rot_${createHash("sha256").update(semente).digest("hex").slice(0, 20)}`;
}

function daPessoa(dados: Record<string, unknown>, escopo: Pick<EscopoDoAgente, "uid" | "customerCode">): boolean {
  return dados.user_id === escopo.uid && dados.customer_code === escopo.customerCode;
}

/**
 * Cria ou altera a rotina da própria pessoa, no cliente e no módulo da
 * conversa. Pelo cartão, a mesma mensagem não cria duas, e a mensagem guarda
 * a rotina criada.
 */
export async function saveDuteRoutineFor(db: Firestore, caller: CoreProfile, data: unknown, agora: () => Date = () => new Date()) {
  const entrada = interpretar(EntradaDaRotina, data);
  const escopo = await escopoDoAgente(db, caller, data);
  const agenda = agendaDe(entrada);
  const ativa = entrada.active ?? true;
  const mensagemRef = entrada.agent_message_id ? db.collection(MESSAGES_COLLECTION).doc(entrada.agent_message_id) : null;
  return db.runTransaction(async (transaction) => {
    if (mensagemRef) {
      const mensagem = (await transaction.get(mensagemRef)).data();
      if (!mensagem || mensagem.role !== "assistant" || !daPessoa(mensagem, escopo)) throw new HttpsError("permission-denied", "Este cartão não é desta conversa.");
      if ((mensagem.draft as Record<string, unknown> | undefined)?.tipo !== "rotina") throw new HttpsError("failed-precondition", "Esta mensagem não tem rotina para criar.");
      const enviada = mensagem.draft_sent as Record<string, unknown> | undefined;
      if (enviada?.request_id) return { id: texto(enviada.request_id), name: entrada.name, created: false, replayed: true as const };
    }
    const id = entrada.id ?? idDaRotina(mensagemRef ? `agent_draft_${mensagemRef.id}` : `${escopo.uid}|${randomUUID()}`);
    const ref = db.collection(ROUTINES_COLLECTION).doc(id);
    const existente = await transaction.get(ref);
    if (existente.exists) {
      const dados = existente.data() ?? {};
      if (!daPessoa(dados, escopo)) throw new HttpsError("permission-denied", "Esta rotina é de outra pessoa.");
      // A conversa da rotina é do módulo em que ela nasceu.
      if ((texto(dados.modulo) || "wms") !== escopo.modulo) throw new HttpsError("failed-precondition", "Esta rotina é de outro módulo.");
    } else {
      if (entrada.id) throw new HttpsError("not-found", "Rotina não encontrada.");
      const minhas = await transaction.get(db.collection(ROUTINES_COLLECTION).where("user_id", "==", escopo.uid).where("customer_code", "==", escopo.customerCode).limit(ROTINAS_POR_PESSOA + 1));
      if (minhas.size >= ROTINAS_POR_PESSOA) throw new HttpsError("failed-precondition", `Você já tem ${ROTINAS_POR_PESSOA} rotinas. Exclua uma para criar outra.`);
    }
    const instante = agora();
    const agoraIso = instante.toISOString();
    transaction.set(
      ref,
      {
        id,
        user_id: escopo.uid,
        user_name: caller.name ?? null,
        customer_code: escopo.customerCode,
        modulo: escopo.modulo,
        name: entrada.name,
        prompt: entrada.prompt,
        ...agenda,
        active: ativa,
        next_run_at: ativa ? proximaVez(agenda, instante).toISOString() : null,
        conversation_id: `routine_${id}`,
        retry_pending: false,
        updated_at_iso: agoraIso,
        ...(existente.exists ? {} : { created_at_iso: agoraIso, last_run_at: null, last_status: null }),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // O cartão mostra "criada" em qualquer aparelho, como o do WMS.
    if (mensagemRef) transaction.update(mensagemRef, { draft_sent: { request_id: id, request_number: entrada.name, sent_at: agoraIso } });
    return { id, name: entrada.name, created: !existente.exists };
  });
}

const PedidoDaRotina = z.object({ id: z.string().trim().regex(/^rot_[a-f0-9]{20}$/, "Rotina inválida.") }).strict();

async function rotinaDaPessoa(db: Firestore, caller: CoreProfile, id: string) {
  const ref = db.collection(ROUTINES_COLLECTION).doc(id);
  const dados = (await ref.get()).data();
  if (!dados) throw new HttpsError("not-found", "Rotina não encontrada.");
  // A rotina é de quem criou; a do cliente, também do cliente do login.
  if (dados.user_id !== caller.uid || (caller.role === "cliente" && dados.customer_code !== caller.customerCode)) throw new HttpsError("permission-denied", "Esta rotina é de outra pessoa.");
  return { ref, dados };
}

export async function deleteDuteRoutineFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const { id } = interpretar(PedidoDaRotina, data);
  const { ref } = await rotinaDaPessoa(db, caller, id);
  await ref.delete();
  return { id };
}

const ListaDasRotinas = z.object({ customer_code: z.string().trim().max(80).nullish(), modulo: z.string().trim().max(20) }).strict();

/** As rotinas da pessoa no cliente da conversa, de todos os módulos. */
export async function listDuteRoutinesFor(db: Firestore, caller: CoreProfile, data: unknown) {
  interpretar(ListaDasRotinas, data);
  const escopo = await escopoDoAgente(db, caller, data);
  const lidas = await db.collection(ROUTINES_COLLECTION).where("user_id", "==", escopo.uid).where("customer_code", "==", escopo.customerCode).limit(20).get();
  return {
    items: lidas.docs
      .map((doc) => {
        const dados = doc.data();
        return {
          id: doc.id,
          name: texto(dados.name),
          prompt: texto(dados.prompt),
          modulo: texto(dados.modulo) || "wms",
          ...agendaDe({ frequency: FREQUENCIAS.includes(dados.frequency) ? dados.frequency : "daily", days: dados.days, day_of_month: dados.day_of_month, time: texto(dados.time) || "08:00" }),
          active: dados.active === true,
          next_run_at: typeof dados.next_run_at === "string" ? dados.next_run_at : null,
          last_run_at: typeof dados.last_run_at === "string" ? dados.last_run_at : null,
          last_status: ["ok", "failed", "no_access"].includes(dados.last_status) ? dados.last_status : null,
          conversation_id: texto(dados.conversation_id) || `routine_${doc.id}`,
          created_at: texto(dados.created_at_iso),
        };
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

// --- A execução ---------------------------------------------------------------------------------

export type RotinaVencida = {
  id: string;
  user_id: string;
  customer_code: string;
  modulo: string;
  name: string;
  prompt: string;
  conversation_id: string;
  retry_pending: boolean;
};

function vencidaLida(id: string, dados: Record<string, unknown>): RotinaVencida {
  return {
    id,
    user_id: texto(dados.user_id),
    customer_code: texto(dados.customer_code),
    modulo: texto(dados.modulo) || "wms",
    name: texto(dados.name),
    prompt: texto(dados.prompt),
    conversation_id: texto(dados.conversation_id) || `routine_${id}`,
    retry_pending: dados.retry_pending === true,
  };
}

/**
 * Pega as rotinas vencidas e já marca a próxima vez, numa transação por
 * rotina: duas rodadas ao mesmo tempo não rodam a mesma rotina duas vezes. A
 * pausada fica sem próxima vez e não entra.
 */
export async function pegarRotinasVencidas(db: Firestore, agora: Date, limite = 20): Promise<RotinaVencida[]> {
  const agoraIso = agora.toISOString();
  const lidas = await db.collection(ROUTINES_COLLECTION).where("next_run_at", "<=", agoraIso).limit(limite).get();
  const pegas: RotinaVencida[] = [];
  for (const doc of lidas.docs) {
    const rotina = await db.runTransaction(async (transaction) => {
      const dados = (await transaction.get(doc.ref)).data();
      if (!dados || dados.active !== true || typeof dados.next_run_at !== "string" || dados.next_run_at > agoraIso) return null;
      const agenda = agendaDe({ frequency: dados.frequency, days: dados.days, day_of_month: dados.day_of_month, time: texto(dados.time) });
      transaction.update(doc.ref, { next_run_at: proximaVez(agenda, agora).toISOString(), running_since: agoraIso });
      return vencidaLida(doc.id, dados);
    });
    if (rotina) pegas.push(rotina);
  }
  return pegas;
}

/**
 * O resultado da execução. A primeira falha tenta de novo em 15 minutos; a
 * segunda fica como "não rodou" e volta à agenda. Sem acesso, pausa.
 */
export async function registrarExecucao(db: Firestore, rotina: RotinaVencida, resultado: { status: "ok" | "failed" | "no_access"; error?: string }, agora = new Date()) {
  const ref = db.collection(ROUTINES_COLLECTION).doc(rotina.id);
  const base = { running_since: FieldValue.delete(), last_error: resultado.error?.slice(0, 500) ?? null, last_attempt_at: agora.toISOString() };
  if (resultado.status === "no_access") return ref.update({ ...base, active: false, next_run_at: null, last_status: "no_access", retry_pending: false });
  if (resultado.status === "failed" && !rotina.retry_pending) return ref.update({ ...base, retry_pending: true, next_run_at: new Date(agora.getTime() + 15 * 60_000).toISOString() });
  return ref.update({ ...base, retry_pending: false, last_status: resultado.status, ...(resultado.status === "ok" ? { last_run_at: agora.toISOString() } : {}) });
}

export type DependenciasDaRotina = Pick<OpcoesDaConversa, "gerar" | "agora" | "novoId">;

/**
 * Roda a rotina com o perfil ATUAL de quem criou, pelo mesmo fluxo da
 * conversa. Perdeu o acesso ao agente, ao cliente ou ao módulo: pausa.
 */
export async function rodarRotina(db: Firestore, rotina: RotinaVencida, dependencias: DependenciasDaRotina): Promise<"ok" | "failed" | "no_access"> {
  const agora = dependencias.agora ?? (() => new Date());
  let perfil: CoreProfile;
  try {
    perfil = await loadProfile(db, rotina.user_id);
    if (agenteProblem(perfil.role)) throw new Error("sem o agente");
    // O cliente só roda a rotina do próprio cadastro; o escopo confere o resto.
    if (perfil.role === "cliente" && perfil.customerCode !== rotina.customer_code) throw new Error("outro cliente");
    await escopoDoAgente(db, perfil, { customer_code: rotina.customer_code, modulo: rotina.modulo });
  } catch {
    await registrarExecucao(db, rotina, { status: "no_access" }, agora());
    return "no_access";
  }
  try {
    await conversarComDute(db, perfil, { message: rotina.prompt, conversation_id: rotina.conversation_id, customer_code: rotina.customer_code, modulo: rotina.modulo }, { ...dependencias, rotina: { id: rotina.id, nome: rotina.name } });
    await registrarExecucao(db, rotina, { status: "ok" }, agora());
    return "ok";
  } catch (erro) {
    await registrarExecucao(db, rotina, { status: "failed", error: erro instanceof Error ? erro.message : String(erro) }, agora());
    return "failed";
  }
}

/** A rodada agendada: as vencidas, uma de cada vez, com folga antes do fim do tempo da tarefa. */
export async function rodarRotinasVencidas(db: Firestore, dependencias: DependenciasDaRotina, folgaMs = 420_000) {
  const agora = dependencias.agora ?? (() => new Date());
  const inicio = Date.now();
  const resultado = { rodadas: 0, ok: 0, falhas: 0, sem_acesso: 0, adiadas: 0 };
  for (const rotina of await pegarRotinasVencidas(db, agora())) {
    if (Date.now() - inicio > folgaMs) {
      await registrarExecucao(db, { ...rotina, retry_pending: false }, { status: "failed", error: "Sem tempo nesta rodada." }, agora());
      resultado.adiadas += 1;
      continue;
    }
    // A rotina excluída no meio da rodada não para as outras.
    const status = await rodarRotina(db, rotina, dependencias).catch((erro) => {
      console.error("runDuteRoutines: rotina falhou", { id: rotina.id, erro });
      return "failed" as const;
    });
    resultado.rodadas += 1;
    if (status === "ok") resultado.ok += 1;
    else if (status === "failed") resultado.falhas += 1;
    else resultado.sem_acesso += 1;
  }
  return resultado;
}

/** "Rodar agora", pela pessoa: no máximo uma vez a cada 5 minutos. */
export async function runDuteRoutineNowFor(db: Firestore, caller: CoreProfile, data: unknown, dependencias: DependenciasDaRotina) {
  const { id } = interpretar(PedidoDaRotina, data);
  const { dados } = await rotinaDaPessoa(db, caller, id);
  const agora = (dependencias.agora ?? (() => new Date()))();
  const ultima = typeof dados.last_run_at === "string" ? Date.parse(dados.last_run_at) : NaN;
  if (Number.isFinite(ultima) && agora.getTime() - ultima < INTERVALO_MINIMO_MS) throw new HttpsError("failed-precondition", "Esta rotina rodou há pouco. Espere alguns minutos.");
  // Como se já tivesse tentado de novo: a falha do "rodar agora" não mexe na agenda.
  const status = await rodarRotina(db, { ...vencidaLida(id, dados), retry_pending: true }, dependencias);
  if (status === "no_access") throw new HttpsError("permission-denied", "Você não tem mais acesso a esta rotina: ela foi pausada.");
  if (status === "failed") throw new HttpsError("unavailable", "A rotina não rodou agora. Tente de novo em alguns minutos.");
  return { id, conversation_id: texto(dados.conversation_id) || `routine_${id}` };
}
