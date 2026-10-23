import { collection, getDocs, limit, orderBy, query, where, type DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { fetchChatJson, type ChatMessage, type ChatResponse } from "@/components/agent/chat";
import type { ConversationSummary } from "../agent-chat";
import type { Playbook } from "../agent-playbooks";
import type { Routine } from "../agent-routines";
import { firebaseApp, firebaseAuth, firestore } from "../firebase";
import { functionsDoApp } from "../firebase-functions";
import { streamAgentDuteChat, type AgentDuteStreamChunk } from "../functions-api";
import { chamarNucleo } from "../memoria/api";
import { mensagemDoErro } from "../operacao/api";

/**
 * Com quem a tela do Agent Dute fala (parte 5.5i): o agente do WMS, como
 * antes, ou o do núcleo (functions/core), no módulo do shell e no cliente da
 * conversa. A tela, as rotinas, as anotações, os playbooks e os cartões usam
 * só este cliente; quem escolhe o alvo é a página.
 *
 * No núcleo, o servidor confere tudo de novo (o cliente do login, o cliente
 * ativo da equipe, o módulo): o alvo daqui só diz o que a pessoa está vendo.
 */

/** Os módulos do agente do núcleo, os de functions/core (agente-escopo.ts), travados em platform-lists.test.ts. */
export const MODULOS_DO_AGENTE = ["wms", "operacao", "comercial", "financeiro"] as const;
export type ModuloDoAgente = (typeof MODULOS_DO_AGENTE)[number];

export type AlvoDoAgente = { tipo: "wms" } | { tipo: "nucleo"; modulo: ModuloDoAgente; customerCode: string };

export type AnexoDaConversa = { file_name: string; file_url: string; storage_path: string; content_type: string; size_bytes: number };
export type PedidoDaConversa = { message: string; conversation_id: string; attachments?: AnexoDaConversa[] };

export type NotaDoAgente = {
  id: string;
  text: string;
  reason: string | null;
  visibility: "todos" | "equipe";
  status: "pending" | "active";
  suggested_by_name: string | null;
  suggested_by_role: string | null;
  created_at: string | null;
};

export type AcaoDaRevisao = "approve" | "reject" | "archive";

/** O corpo da rotina como a tela monta (lib/agent-routines.ts, routinePayload). */
export type CorpoDaRotina = Record<string, unknown> & { id?: string; modulo?: string };
/** O corpo do playbook como a tela monta (lib/agent-playbooks.ts, playbookPayload). */
export type CorpoDoPlaybook = Record<string, unknown> & { id?: string };

export type ClienteDoAgente = {
  alvo: AlvoDoAgente;
  /** O começo das chaves do cache: cada alvo tem o dele, para um módulo não mostrar a conversa de outro. */
  chave: readonly string[];
  conversas(): Promise<{ conversations: ConversationSummary[] }>;
  mensagens(conversaId: string): Promise<ChatResponse>;
  conversar(pedido: PedidoDaConversa, aoPedaco: (pedaco: AgentDuteStreamChunk) => void, sinal?: AbortSignal): Promise<ChatResponse>;
  rotinas: {
    listar(): Promise<{ routines: Routine[] }>;
    salvar(corpo: CorpoDaRotina): Promise<unknown>;
    excluir(id: string): Promise<unknown>;
    rodar(id: string): Promise<{ conversation_id: string }>;
  };
  anotacoes: {
    listar(): Promise<{ notes: NotaDoAgente[] }>;
    decidir(id: string, acao: AcaoDaRevisao, ajuste?: { text?: string; visibility?: NotaDoAgente["visibility"] }): Promise<unknown>;
    /** O envio do cartão de anotação; o agente do WMS grava a sugestão sozinho e não tem cartão. */
    sugerir: ((mensagemId: string) => Promise<unknown>) | null;
  };
  playbooks: {
    listar(): Promise<{ playbooks: Playbook[] }>;
    salvar(corpo: CorpoDoPlaybook): Promise<{ id: string }>;
    decidir(id: string, acao: AcaoDaRevisao): Promise<unknown>;
    carregar(): Promise<{ created: number }>;
  };
};

/** A chave do cache no alvo: a do WMS fica como sempre foi. */
export function chaveNoAlvo(cliente: Pick<ClienteDoAgente, "chave">, base: readonly unknown[]): unknown[] {
  return [...cliente.chave, ...base];
}

// --- O agente do WMS --------------------------------------------------------------------------

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchChatJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const caminho = (id: string) => encodeURIComponent(id);

export const CLIENTE_DO_WMS: ClienteDoAgente = {
  alvo: { tipo: "wms" },
  chave: [],
  conversas: () => fetchChatJson("/api/agent-dute/conversations"),
  mensagens: (conversaId) => fetchChatJson(`/api/agent-dute/chat?conversation_id=${caminho(conversaId)}`),
  conversar: (pedido, aoPedaco, sinal) => streamAgentDuteChat<ChatResponse>(pedido, aoPedaco, sinal),
  rotinas: {
    listar: () => fetchChatJson("/api/agent-dute/routines"),
    // O WMS não guarda o módulo da rotina.
    salvar: ({ modulo: _modulo, ...corpo }) => postJson("/api/agent-dute/routines", corpo),
    excluir: (id) => postJson(`/api/agent-dute/routines/${caminho(id)}/delete`, {}),
    rodar: (id) => postJson(`/api/agent-dute/routines/${caminho(id)}/run`, {}),
  },
  anotacoes: {
    listar: () => fetchChatJson("/api/agent-dute/notes"),
    decidir: (id, acao, ajuste) => postJson(`/api/agent-dute/notes/${caminho(id)}/${acao}`, { text: ajuste?.text, visibility: ajuste?.visibility }),
    sugerir: null,
  },
  playbooks: {
    listar: () => fetchChatJson("/api/agent-dute/playbooks"),
    salvar: (corpo) => postJson("/api/agent-dute/playbooks", corpo),
    decidir: (id, acao) => postJson(`/api/agent-dute/playbooks/${caminho(id)}/${acao}`, {}),
    carregar: () => postJson("/api/agent-dute/playbooks/seed", {}),
  },
};

// --- O agente do núcleo -----------------------------------------------------------------------

const CONVERSAS_LIDAS = 100;
const MENSAGENS_LIDAS = 100;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** As conversas do módulo, da mais recente para a mais antiga. A de antes do núcleo, sem módulo, é da Armazenagem. */
export function conversasDoModulo(documentos: readonly DocumentData[], modulo: ModuloDoAgente, maximo = 60): ConversationSummary[] {
  return documentos
    .filter((conversa) => (texto(conversa.modulo) || "wms") === modulo)
    .map((conversa) => ({
      id: texto(conversa.id),
      title: texto(conversa.title) || "Conversa",
      last_message_at: texto(conversa.last_message_at),
      ...(texto(conversa.routine_id) ? { routine_id: texto(conversa.routine_id) } : {}),
    }))
    .filter((conversa) => conversa.id && conversa.last_message_at)
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
    .slice(0, maximo);
}

/** As mensagens em ordem, no formato da tela; o contexto da nota lida fica de fora (só o modelo lê). */
export function mensagensDaConversa(documentos: readonly DocumentData[]): ChatMessage[] {
  return documentos
    .map((mensagem) => ({
      id: texto(mensagem.id),
      role: mensagem.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof mensagem.content === "string" ? mensagem.content : "",
      created_at: texto(mensagem.created_at_iso) || null,
      source: texto(mensagem.source) || null,
      tools_used: Array.isArray(mensagem.tools_used) ? mensagem.tools_used.map(String) : [],
      draft: mensagem.draft,
      draft_sent: mensagem.draft_sent,
      attachments: Array.isArray(mensagem.attachments)
        ? (mensagem.attachments as Array<Record<string, unknown>>).map((anexo) => ({ file_name: texto(anexo.file_name) || "anexo", storage_path: texto(anexo.storage_path) }))
        : undefined,
    }))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || (a.role === b.role ? 0 : a.role === "user" ? -1 : 1));
}

function quemEsta(): string {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error("Faça login para continuar.");
  return uid;
}

async function conversarNoNucleo(dados: Record<string, unknown>, aoPedaco: (pedaco: AgentDuteStreamChunk) => void, sinal?: AbortSignal): Promise<ChatResponse> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<Record<string, unknown>, ChatResponse, AgentDuteStreamChunk>(functionsDoApp(firebaseApp), "chatWithDute", { timeout: 180_000 });
  try {
    const { stream, data } = await callable.stream(dados, { signal: sinal });
    for await (const pedaco of stream) aoPedaco(pedaco);
    return await data;
  } catch (erro) {
    const mensagem = mensagemDoErro(erro);
    throw new Error(mensagem.startsWith("Falha interna") ? "O Agent Dute não respondeu agora. Tente de novo em instantes." : mensagem);
  }
}

/** O agente do núcleo no módulo e no cliente da conversa. */
export function clienteDoNucleo(modulo: ModuloDoAgente, customerCode: string): ClienteDoAgente {
  const doCliente = { customer_code: customerCode };
  const daConversa = { customer_code: customerCode, modulo };
  return {
    alvo: { tipo: "nucleo", modulo, customerCode },
    chave: ["nucleo", modulo, customerCode],
    async conversas() {
      if (!firestore) return { conversations: [] };
      const lidas = await getDocs(
        query(collection(firestore, "agent_conversations"), where("user_id", "==", quemEsta()), where("customer_code", "==", customerCode), orderBy("last_message_at", "desc"), limit(CONVERSAS_LIDAS)),
      );
      return { conversations: conversasDoModulo(lidas.docs.map((doc) => ({ ...doc.data(), id: doc.id })), modulo) };
    },
    async mensagens(conversaId) {
      if (!firestore) return { messages: [] };
      const lidas = await getDocs(
        query(
          collection(firestore, "agent_messages"),
          where("conversation_id", "==", conversaId),
          where("customer_code", "==", customerCode),
          where("user_id", "==", quemEsta()),
          orderBy("created_at_iso", "desc"),
          limit(MENSAGENS_LIDAS),
        ),
      );
      return { conversation: { id: conversaId, customer_code: customerCode, status: "active" }, messages: mensagensDaConversa(lidas.docs.map((doc) => ({ ...doc.data(), id: doc.id }))) };
    },
    conversar: (pedido, aoPedaco, sinal) => conversarNoNucleo({ ...pedido, ...daConversa }, aoPedaco, sinal),
    rotinas: {
      listar: async () => ({ routines: (await chamarNucleo<{ items: Routine[] }>("listDuteRoutines", daConversa)).items }),
      // A rotina alterada fica no módulo em que nasceu.
      salvar: ({ modulo: daRotina, ...corpo }) => chamarNucleo("saveDuteRoutine", { ...corpo, customer_code: customerCode, modulo: daRotina ?? modulo }),
      excluir: (id) => chamarNucleo("deleteDuteRoutine", { id }),
      rodar: (id) => chamarNucleo<{ conversation_id: string }>("runDuteRoutineNow", { id }),
    },
    anotacoes: {
      listar: async () => ({ notes: (await chamarNucleo<{ items: NotaDoAgente[] }>("listDuteNotes", doCliente)).items }),
      decidir: (id, acao, ajuste) =>
        chamarNucleo("decideDuteNote", {
          ...doCliente,
          id,
          action: acao,
          // Só os campos preenchidos: undefined vira null no SDK do Firebase.
          ...(ajuste?.text?.trim() ? { text: ajuste.text } : {}),
          ...(ajuste?.visibility ? { visibility: ajuste.visibility } : {}),
        }),
      sugerir: (mensagemId) => chamarNucleo("suggestDuteNote", { agent_message_id: mensagemId }),
    },
    playbooks: {
      listar: async () => ({ playbooks: (await chamarNucleo<{ items: Playbook[] }>("listDutePlaybooks", doCliente)).items }),
      salvar: (corpo) => chamarNucleo<{ id: string }>("saveDutePlaybook", { ...corpo, ...doCliente, idempotency_key: crypto.randomUUID() }),
      decidir: (id, acao) => chamarNucleo("decideDutePlaybook", { ...doCliente, id, action: acao }),
      carregar: () => chamarNucleo<{ created: number }>("seedDutePlaybooks", doCliente),
    },
  };
}
