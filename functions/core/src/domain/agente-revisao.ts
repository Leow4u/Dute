import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { MESSAGES_COLLECTION } from "./agente-conversa.js";
import { cadastroDoClienteAtivo } from "./agente-escopo.js";
import { normalizado, texto } from "./agente-ferramentas.js";
import { INITIAL_PLAYBOOKS } from "./agente-playbooks-iniciais.js";
import { createCoreEvent } from "./eventos.js";
import { revisaoDoAgenteProblem } from "./platform-roles.js";
import type { CoreProfile } from "./profile.js";

/**
 * As anotações e os playbooks do Agent Dute no núcleo (parte 5.5f), do
 * cliente ativo, nas coleções do WMS (`ai_agent_notes`, `ai_agent_playbooks`).
 *
 * - A anotação nasce do cartão da conversa: quem conversou a envia
 *   (`suggestDuteNote`), e ela fica pendente até a coordenação aprovar
 *   (pergunta 34). O agente nunca a grava.
 * - Os playbooks são da coordenação: escrito por ela vale direto; os iniciais
 *   entram pendentes.
 * - Quem revisa é a coordenação (AGENTE_REVISAO_ROLES), sempre do cliente
 *   ativo: a anotação ou o playbook de outro cliente não aparece.
 *
 * Toda gravação vai numa transação com o evento `agente.*`, que leva só o id.
 */

export const NOTES_COLLECTION = "ai_agent_notes";
export const PLAYBOOKS_COLLECTION = "ai_agent_playbooks";
const TAMANHO_DA_NOTA = 300;
const PENDENTES_POR_CLIENTE = 30;

type Registro = Record<string, unknown>;

const codigo = z
  .string()
  .trim()
  .min(1, "Escolha o cliente.")
  .max(80)
  .refine((valor) => !valor.includes("/"), "Cliente inválido.");

function interpretar<T>(schema: z.ZodType<T>, data: unknown): T {
  const lido = schema.safeParse(data && typeof data === "object" ? data : {});
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

function autor(caller: CoreProfile) {
  return { uid: caller.uid, name: caller.name ?? null, role: caller.role };
}

function instanteLido(valor: unknown): string | null {
  return valor && typeof valor === "object" && "toDate" in valor ? (valor as { toDate: () => Date }).toDate().toISOString() : null;
}

/** O cliente da revisão: só a coordenação, do cliente ativo, que precisa estar no cadastro. */
async function clienteDaRevisao(db: Firestore, caller: CoreProfile, customerCode: string): Promise<string> {
  const problema = revisaoDoAgenteProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
  await cadastroDoClienteAtivo(db, customerCode);
  return customerCode;
}

// --- Anotações --------------------------------------------------------------------------------

export function limparNota(valor: string): string {
  return valor.replace(/\s+/g, " ").trim().slice(0, TAMANHO_DA_NOTA);
}

/** O id da anotação sai do cliente e do texto: a mesma anotação nunca vira duas. */
export function idDaNota(customerCode: string, nota: string): string {
  return `note_${createHash("sha256").update(normalizado(`${customerCode}|${nota}`).replace(/\s+/g, " ")).digest("hex").slice(0, 24)}`;
}

const EnvioDaNota = z.object({ agent_message_id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/, "Mensagem inválida.") }).strict();

/**
 * O envio da anotação pelo cartão da conversa. Confere que a mensagem é do
 * agente, de quem envia, do cliente dele e com o cartão de anotação ainda não
 * enviado. A anotação fica pendente; a mensagem guarda que foi enviada.
 */
export async function suggestDuteNoteFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const { agent_message_id: mensagemId } = interpretar(EnvioDaNota, data);
  const mensagemRef = db.collection(MESSAGES_COLLECTION).doc(mensagemId);
  return db.runTransaction(async (transaction) => {
    const mensagem = (await transaction.get(mensagemRef)).data();
    const customerCode = texto(mensagem?.customer_code);
    if (!mensagem || mensagem.role !== "assistant" || mensagem.user_id !== caller.uid || !customerCode || (caller.role === "cliente" && customerCode !== caller.customerCode)) {
      throw new HttpsError("permission-denied", "Este cartão não é desta conversa.");
    }
    const cartao = (mensagem.draft ?? {}) as Registro;
    if (cartao.tipo !== "anotacao") throw new HttpsError("failed-precondition", "Esta mensagem não tem anotação para enviar.");
    const enviada = (mensagem.draft_sent ?? null) as Registro | null;
    if (enviada?.request_id) return { id: texto(enviada.request_id), status: "pending", replayed: true as const };
    const nota = limparNota(texto(cartao.texto));
    if (nota.length < 8) throw new HttpsError("invalid-argument", "Anotação curta demais.");
    const id = idDaNota(customerCode, nota);
    const notaRef = db.collection(NOTES_COLLECTION).doc(id);
    const existente = await transaction.get(notaRef);
    const status = texto(existente.get("status"));
    const marcar = () => transaction.update(mensagemRef, { draft_sent: { request_id: id, request_number: "", sent_at: new Date().toISOString() } });
    if (status === "pending" || status === "active") {
      marcar();
      return { id, status, ja_existia: true as const };
    }
    const pendentes = await transaction.get(db.collection(NOTES_COLLECTION).where("customer_code", "==", customerCode).where("status", "==", "pending").limit(PENDENTES_POR_CLIENTE));
    if (pendentes.size >= PENDENTES_POR_CLIENTE) throw new HttpsError("resource-exhausted", "Há muitas anotações aguardando aprovação; tente depois.");
    const agora = new Date().toISOString();
    transaction.set(notaRef, {
      id,
      customer_code: customerCode,
      text: nota,
      reason: texto(cartao.motivo) ? limparNota(texto(cartao.motivo)) : null,
      // Do cliente vale para todos; da equipe, só para a equipe. A coordenação ajusta ao aprovar.
      visibility: caller.role === "cliente" ? "todos" : cartao.visibilidade === "todos" ? "todos" : "equipe",
      status: "pending",
      source_conversation_id: texto(mensagem.conversation_id) || null,
      source_message_id: mensagemId,
      suggested_by: autor(caller),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    marcar();
    createCoreEvent(transaction, db, { type: "agente.anotacao_sugerida", payload: { id, conversa: texto(mensagem.conversation_id) || mensagemId }, customer_code: customerCode, actor: caller, occurred_at: agora, chave: mensagemId });
    return { id, status: "pending" };
  });
}

const ListaDoCliente = z.object({ customer_code: codigo }).strict();

/** As pendentes e as que valem, do cliente ativo, para a coordenação. */
export async function listDuteNotesFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const customerCode = await clienteDaRevisao(db, caller, interpretar(ListaDoCliente, data).customer_code);
  const lidas = await db.collection(NOTES_COLLECTION).where("customer_code", "==", customerCode).limit(300).get();
  return {
    items: lidas.docs
      .map((doc) => {
        const dados = doc.data();
        return {
          id: doc.id,
          text: texto(dados.text),
          reason: texto(dados.reason) || null,
          visibility: dados.visibility === "equipe" ? "equipe" : "todos",
          status: texto(dados.status),
          suggested_by_name: (dados.suggested_by as Registro | undefined)?.name ?? null,
          suggested_by_role: (dados.suggested_by as Registro | undefined)?.role ?? null,
          decided_by_name: (dados.decided_by as Registro | undefined)?.name ?? null,
          created_at: instanteLido(dados.created_at),
          decided_at: instanteLido(dados.decided_at),
        };
      })
      .filter((nota) => nota.status === "pending" || nota.status === "active")
      .sort((a, b) => (a.status === b.status ? String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) : a.status === "pending" ? -1 : 1)),
  };
}

const DecisaoDaNota = z
  .object({
    customer_code: codigo,
    id: z.string().trim().regex(/^note_[a-f0-9]{24}$/, "Anotação inválida."),
    action: z.enum(["approve", "reject", "archive"]),
    text: z.string().trim().max(TAMANHO_DA_NOTA).nullish(),
    visibility: z.enum(["todos", "equipe"]).nullish(),
  })
  .strict();

const PROXIMO = { approve: "active", reject: "rejected", archive: "archived" } as const;
const EVENTO_DA_NOTA = { active: "agente.anotacao_aprovada", rejected: "agente.anotacao_recusada", archived: "agente.anotacao_arquivada" } as const;
const ESTADO_EM_TEXTO: Record<string, string> = { active: "valendo", rejected: "recusada", archived: "arquivada", pending: "pendente" };

/** A coordenação aprova (podendo ajustar o texto e para quem vale) ou recusa a pendente, ou arquiva a que vale. */
export async function decideDuteNoteFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const pedido = interpretar(DecisaoDaNota, data);
  const customerCode = await clienteDaRevisao(db, caller, pedido.customer_code);
  const ref = db.collection(NOTES_COLLECTION).doc(pedido.id);
  return db.runTransaction(async (transaction) => {
    const nota = (await transaction.get(ref)).data();
    if (!nota || nota.customer_code !== customerCode) throw new HttpsError("not-found", "Anotação não encontrada.");
    const atual = texto(nota.status);
    const proximo = PROXIMO[pedido.action];
    if (atual === proximo) return { id: pedido.id, status: proximo, replayed: true as const };
    const permitido = pedido.action === "archive" ? atual === "active" : atual === "pending";
    if (!permitido) throw new HttpsError("failed-precondition", `Esta anotação já está ${ESTADO_EM_TEXTO[atual] ?? atual}.`);
    const textoFinal = pedido.action === "approve" && pedido.text ? limparNota(pedido.text) : texto(nota.text);
    if (pedido.action === "approve" && textoFinal.length < 8) throw new HttpsError("invalid-argument", "Anotação curta demais.");
    transaction.update(ref, {
      status: proximo,
      text: textoFinal,
      visibility: pedido.action === "approve" && pedido.visibility ? pedido.visibility : nota.visibility,
      decided_by: autor(caller),
      decided_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    // A anotação arquivada pode voltar como sugestão: cada decisão tem o evento dela. A repetição já parou acima, pelo estado.
    createCoreEvent(transaction, db, { type: EVENTO_DA_NOTA[proximo], payload: { id: pedido.id }, customer_code: customerCode, actor: caller, occurred_at: new Date().toISOString(), chave: randomUUID() });
    return { id: pedido.id, status: proximo };
  });
}

// --- Playbooks ----------------------------------------------------------------------------------

type PlaybookLido = {
  id: string;
  title: string;
  when: string;
  steps: string[];
  open_points: string[];
  audience: "equipe" | "todos";
  status: string;
  source: "inicial" | "coordenacao";
  updated_by_name: string | null;
  decided_by_name: string | null;
  updated_at: string | null;
  use_count: number;
};

function playbookLido(id: string, dados: Registro): PlaybookLido {
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor.map((item) => texto(item)).filter(Boolean) : []);
  return {
    id,
    title: texto(dados.title),
    when: texto(dados.when),
    steps: lista(dados.steps),
    open_points: lista(dados.open_points),
    audience: dados.audience === "todos" ? "todos" : "equipe",
    status: texto(dados.status) || "pending",
    source: dados.source === "inicial" ? "inicial" : "coordenacao",
    updated_by_name: ((dados.updated_by as Registro | undefined)?.name as string | undefined) ?? null,
    decided_by_name: ((dados.decided_by as Registro | undefined)?.name as string | undefined) ?? null,
    updated_at: instanteLido(dados.updated_at),
    use_count: Number(dados.use_count ?? 0),
  };
}

export async function listDutePlaybooksFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const customerCode = await clienteDaRevisao(db, caller, interpretar(ListaDoCliente, data).customer_code);
  const lidos = await db.collection(PLAYBOOKS_COLLECTION).where("customer_code", "==", customerCode).limit(200).get();
  return {
    items: lidos.docs
      .map((doc) => playbookLido(doc.id, doc.data()))
      .filter((item) => item.status === "pending" || item.status === "active")
      .sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title, "pt-BR") : a.status === "pending" ? -1 : 1)),
  };
}

const linha = (maximo: number) => z.string().trim().min(1).max(maximo);

const PlaybookEntrada = z
  .object({
    customer_code: codigo,
    idempotency_key: z.string().trim().min(8).max(200),
    id: z.string().trim().regex(/^pb_[a-z0-9_-]{6,120}$/, "Playbook inválido.").nullish(),
    title: linha(120),
    when: linha(300),
    steps: z
      .array(z.string().trim().max(400))
      .transform((lista) => lista.filter(Boolean))
      .pipe(z.array(z.string()).min(1, "Escreva ao menos um passo.").max(20)),
    open_points: z
      .array(z.string().trim().max(300))
      .nullish()
      .transform((lista) => (lista ?? []).filter(Boolean).slice(0, 10)),
    audience: z.enum(["equipe", "todos"]),
  })
  .strict();

/**
 * Cria ou edita. O escrito pela coordenação vale direto (ela é quem aprova);
 * editar um pendente mantém pendente. A mesma chave não cria dois.
 */
export async function saveDutePlaybookFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const pedido = interpretar(PlaybookEntrada, data);
  const customerCode = await clienteDaRevisao(db, caller, pedido.customer_code);
  const id = pedido.id ?? `pb_${createHash("sha256").update(JSON.stringify([customerCode, caller.uid, pedido.idempotency_key])).digest("hex").slice(0, 12)}`;
  const ref = db.collection(PLAYBOOKS_COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const existente = await transaction.get(ref);
    const antes = existente.data() ?? {};
    if (pedido.id && !existente.exists) throw new HttpsError("not-found", "Playbook não encontrado.");
    if (existente.exists && antes.customer_code !== customerCode) throw new HttpsError("not-found", "Playbook não encontrado.");
    if (existente.exists && antes.last_idempotency_key === pedido.idempotency_key) return { id, status: texto(antes.status), replayed: true as const };
    if (existente.exists && (antes.status === "rejected" || antes.status === "archived")) throw new HttpsError("failed-precondition", "Este playbook foi recusado ou arquivado e não pode mais ser editado.");
    const status = existente.exists ? texto(antes.status) : "active";
    const conteudo = { title: pedido.title, when: pedido.when, steps: pedido.steps, open_points: pedido.open_points, audience: pedido.audience, last_idempotency_key: pedido.idempotency_key };
    if (existente.exists) {
      transaction.update(ref, { ...conteudo, updated_by: autor(caller), updated_at: FieldValue.serverTimestamp() });
    } else {
      transaction.set(ref, {
        id,
        customer_code: customerCode,
        ...conteudo,
        status,
        source: "coordenacao",
        use_count: 0,
        created_by: autor(caller),
        updated_by: autor(caller),
        decided_by: autor(caller),
        decided_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    createCoreEvent(transaction, db, {
      type: existente.exists ? "agente.playbook_editado" : "agente.playbook_criado",
      payload: { id, passos: pedido.steps.length, publico: pedido.audience },
      customer_code: customerCode,
      actor: caller,
      occurred_at: new Date().toISOString(),
      chave: pedido.idempotency_key,
    });
    return { id, status };
  });
}

const DecisaoDoPlaybook = z
  .object({
    customer_code: codigo,
    id: z.string().trim().regex(/^pb_[a-z0-9_-]{6,120}$/, "Playbook inválido."),
    action: z.enum(["approve", "reject", "archive"]),
  })
  .strict();

const EVENTO_DO_PLAYBOOK = { active: "agente.playbook_aprovado", rejected: "agente.playbook_recusado", archived: "agente.playbook_arquivado" } as const;

/** Aprova ou recusa o pendente; arquiva o que vale. */
export async function decideDutePlaybookFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const pedido = interpretar(DecisaoDoPlaybook, data);
  const customerCode = await clienteDaRevisao(db, caller, pedido.customer_code);
  const ref = db.collection(PLAYBOOKS_COLLECTION).doc(pedido.id);
  return db.runTransaction(async (transaction) => {
    const playbook = (await transaction.get(ref)).data();
    if (!playbook || playbook.customer_code !== customerCode) throw new HttpsError("not-found", "Playbook não encontrado.");
    const atual = texto(playbook.status);
    const proximo = PROXIMO[pedido.action];
    if (atual === proximo) return { id: pedido.id, status: proximo, replayed: true as const };
    const permitido = pedido.action === "archive" ? atual === "active" : atual === "pending";
    if (!permitido) throw new HttpsError("failed-precondition", `Este playbook já está ${{ active: "valendo", rejected: "recusado", archived: "arquivado" }[atual] ?? atual}.`);
    transaction.update(ref, { status: proximo, decided_by: autor(caller), decided_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    createCoreEvent(transaction, db, { type: EVENTO_DO_PLAYBOOK[proximo], payload: { id: pedido.id }, customer_code: customerCode, actor: caller, occurred_at: new Date().toISOString(), chave: randomUUID() });
    return { id: pedido.id, status: proximo };
  });
}

/** O id fixo do playbook inicial no cliente: o mesmo do WMS, para não repetir o que ele já carregou. */
export function idDoPlaybookInicial(customerCode: string, slug: string): string {
  const chave = customerCode
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  return `pb_ini_${chave}_${slug}`;
}

/** Carrega os playbooks iniciais no cliente ativo, pendentes. O que já existe, em qualquer estado, não volta. */
export async function seedDutePlaybooksFor(db: Firestore, caller: CoreProfile, data: unknown) {
  const customerCode = await clienteDaRevisao(db, caller, interpretar(ListaDoCliente, data).customer_code);
  return db.runTransaction(async (transaction) => {
    const refs = INITIAL_PLAYBOOKS.map((item) => ({ item, ref: db.collection(PLAYBOOKS_COLLECTION).doc(idDoPlaybookInicial(customerCode, item.slug)) }));
    const lidos = await Promise.all(refs.map(({ ref }) => transaction.get(ref)));
    const criados: string[] = [];
    refs.forEach(({ item, ref }, indice) => {
      if (lidos[indice]!.exists) return;
      transaction.set(ref, {
        id: ref.id,
        customer_code: customerCode,
        title: item.title,
        when: item.when,
        steps: item.steps,
        open_points: item.open_points,
        audience: item.audience,
        status: "pending",
        source: "inicial",
        use_count: 0,
        created_by: autor(caller),
        updated_by: autor(caller),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      criados.push(ref.id);
    });
    if (criados.length) createCoreEvent(transaction, db, { type: "agente.playbooks_carregados", payload: { id: criados[0]!, ids: criados }, customer_code: customerCode, actor: caller, occurred_at: new Date().toISOString() });
    return { created: criados.length };
  });
}
