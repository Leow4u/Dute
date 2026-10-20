import { randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { NOTE_REVIEWER_ROLES } from "./agent-notes.js";
import { createEvent, type OperationalActor } from "./operations.js";

/**
 * Playbooks do Agent Dute: passo a passo de um procedimento da operação
 * ("Receber mercadoria", "Separar e embalar um pedido"). Quem escreve,
 * aprova e arquiva é a coordenação (os mesmos papéis que aprovam as
 * anotações). Aprovado, o agente segue o passo a passo quando alguém
 * pergunta sobre o assunto: orienta e diz em que tela fazer, mas não executa
 * nada. O cliente só recebe os playbooks marcados para "todos".
 *
 * Os sete iniciais (INITIAL_PLAYBOOKS) foram escritos a partir dos docs do
 * projeto e conferidos nas telas atuais; entram como pendentes e só valem
 * depois de aprovados. "open_points" são as regras da operação que o sistema
 * não conhece: aparecem para a coordenação completar, nunca para o agente.
 */

export const PLAYBOOKS_COLLECTION = "ai_agent_playbooks";
export const PLAYBOOK_REVIEWER_ROLES = NOTE_REVIEWER_ROLES;
const MAX_ACTIVE_IN_PROMPT = 40;

export type PlaybookAudience = "equipe" | "todos";
export type PlaybookStatus = "pending" | "active" | "rejected" | "archived";

export type InitialPlaybook = {
  slug: string;
  title: string;
  audience: PlaybookAudience;
  when: string;
  steps: string[];
  open_points: string[];
};

export const INITIAL_PLAYBOOKS: InitialPlaybook[] = [
  {
    slug: "aprovar",
    title: "Aprovar uma solicitação do cliente",
    audience: "equipe",
    when: "Chegou um pedido ou um aviso de envio do cliente aguardando decisão.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para aprovar. As mais urgentes e mais antigas aparecem primeiro.",
      "Confira cliente, itens, quantidades e a observação (destino, data, NF).",
      "Pedido: confira se há saldo dos itens. Se faltar, o sistema recusa a aprovação com \"Saldo insuficiente\".",
      "Aviso de envio: confira NF, itens esperados e data prevista de chegada.",
      "Clique em Aprovar. O pedido reserva o estoque e vai para Para separar; o aviso de envio vira uma chegada prevista em Estoque › Receber.",
      "Se faltar dado ou saldo, clique em Recusar e escreva o motivo. O cliente vê esse texto no portal.",
    ],
    open_points: [
      "Prazo para decidir uma solicitação (ex.: no mesmo dia útil).",
      "Quem pode aprovar e se há limite (quantidade, item especial).",
      "Quando ligar para o cliente antes de recusar.",
    ],
  },
  {
    slug: "receber",
    title: "Receber mercadoria",
    audience: "equipe",
    when: "A mercadoria chegou na Dutelog, com ou sem aviso de envio do cliente.",
    steps: [
      "Abra Estoque › Receber. Abra a chegada prevista (aviso aprovado) ou registre uma chegada avulsa.",
      "Conte fisicamente cada item e informe a quantidade contada em cada linha.",
      "Salve a conferência. O sistema marca cada linha como OK, falta ou sobra.",
      "Tudo OK: conclua a entrada. Só nesse momento o saldo fica disponível para o cliente.",
      "Se houver falta, sobra ou avaria, siga o playbook Recebimento com divergência.",
    ],
    open_points: [
      "Se a NF é conferida contra o pedido de compra do cliente, e por quem.",
      "Horário de recebimento e quem pode assinar o canhoto.",
      "Onde o volume fica até ser guardado.",
    ],
  },
  {
    slug: "divergencia",
    title: "Recebimento com divergência (falta, sobra ou avaria)",
    audience: "equipe",
    when: "Na conferência, a quantidade não bate com o esperado ou algum volume chegou danificado.",
    steps: [
      "Informe na conferência a quantidade real contada. O sistema sinaliza a falta ou a sobra na linha.",
      "Para concluir uma entrada com divergência, escreva a justificativa de fechamento. Sem ela o sistema não conclui.",
      "O estoque entra só com a quantidade conferida, nunca com a da NF.",
    ],
    open_points: [
      "O que fazer com item avariado: se entra na contagem, se é fotografado e onde fica guardado.",
      "Como e em quanto tempo avisar o cliente (e o fornecedor, se for o caso).",
      "Se sobra é aceita no estoque ou devolvida.",
    ],
  },
  {
    slug: "separar",
    title: "Separar e embalar um pedido",
    audience: "equipe",
    when: "Um pedido aprovado está em Para separar.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para separar.",
      "Separe fisicamente os itens e confira cada quantidade.",
      "Embale e anote o número do lacre.",
      "Clique em Separado e informe o lacre. O sistema registra a separação e a embalagem, e o pedido vai para Para entregar.",
      "Faltou item ou veio avariado: não marque como separado.",
    ],
    open_points: [
      "Quem avisar, e como, quando falta item ou há avaria na separação.",
      "Se a separação é conferida por uma segunda pessoa.",
      "Padrão de embalagem e de lacre.",
    ],
  },
  {
    slug: "entregar",
    title: "Entregar um pedido",
    audience: "equipe",
    when: "O pedido está em Para entregar.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para entregar.",
      "Na saída, informe quem levou e a placa.",
      "Na entrega, informe quem recebeu (opcional) e confirme Entregue.",
      "O sistema baixa o estoque, consome a reserva e fecha o pedido. O cliente vê como entregue no portal.",
    ],
    open_points: [
      "Se o canhoto ou comprovante assinado é obrigatório, e onde fica guardado.",
      "Janelas de entrega por local (ex.: a anotação já aprovada da Faria Lima, até 11h).",
    ],
  },
  {
    slug: "pedido-portal",
    title: "Como fazer um pedido pelo portal",
    audience: "todos",
    when: "O cliente quer retirar itens do estoque dele.",
    steps: [
      "Em Estoque, busque o item, escolha o tamanho e a quantidade e clique em Adicionar.",
      "Abra Pedido, no topo da tela, e preencha o destino (agência, prédio ou centro de custo), Para quando e, na observação, contato e janela de entrega.",
      "Confira e envie. A Dutelog aprova, separa e entrega.",
      "Acompanhe em Pedidos: aguardando aprovação, separando, a caminho e entregue.",
      "Também dá para pedir ao Agent Dute, por exemplo: \"monta um pedido de 10 polos M para a Faria Lima na sexta\". Ele prepara o rascunho; quem confere e envia é você.",
    ],
    open_points: [
      "Antecedência mínima para pedir.",
      "Horários de entrega e como pedir algo urgente.",
    ],
  },
  {
    slug: "envio-portal",
    title: "Como avisar um envio de mercadoria para a Dutelog",
    audience: "todos",
    when: "O cliente vai mandar mercadoria para o estoque da Dutelog.",
    steps: [
      "Em Envios para a Dutelog, crie um aviso: anexe a NF (o sistema lê os itens) ou informe os itens, e a data prevista de chegada.",
      "Envie. A Dutelog aprova o aviso e confere a mercadoria quando ela chega.",
      "Acompanhe em Envios para a Dutelog: avisado, chegou e foi conferido (com quanto chegou de fato e as diferenças) ou recusado com o motivo. Enquanto está só avisado, dá para cancelar.",
      "Também dá para anexar a NF no Agent Dute; ele prepara o aviso para você conferir e enviar.",
    ],
    open_points: [
      "Endereço e horário de recebimento da Dutelog.",
      "Se é preciso agendar a chegada.",
    ],
  },
];

export function assertPlaybookReviewer(role: string) {
  if (!PLAYBOOK_REVIEWER_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", "Só a coordenação edita e aprova os playbooks do Agent Dute.");
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const PlaybookInputSchema = z.object({
  id: z.string().trim().max(120).nullish(),
  title: text(120),
  when: text(300),
  steps: z.array(z.string().trim().max(400)).transform((list) => list.filter(Boolean)).pipe(z.array(z.string()).min(1).max(20)),
  open_points: z.array(z.string().trim().max(300)).nullish().transform((list) => (list ?? []).filter(Boolean).slice(0, 10)),
  audience: z.enum(["equipe", "todos"]),
});

export const DecidePlaybookSchema = z.object({
  id: z.string().trim().min(1).max(120),
  action: z.enum(["approve", "reject", "archive"]),
});

export type PlaybookView = {
  id: string;
  title: string;
  when: string;
  steps: string[];
  open_points: string[];
  audience: PlaybookAudience;
  status: PlaybookStatus;
  source: "inicial" | "coordenacao";
  updated_by_name: string | null;
  decided_by_name: string | null;
  updated_at: string | null;
  use_count: number;
};

const iso = (value: unknown) =>
  value && typeof value === "object" && "toDate" in value ? (value as { toDate: () => Date }).toDate().toISOString() : null;

function view(id: string, data: Record<string, unknown>): PlaybookView {
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  return {
    id,
    title: String(data.title ?? ""),
    when: String(data.when ?? ""),
    steps: list(data.steps),
    open_points: list(data.open_points),
    audience: data.audience === "todos" ? "todos" : "equipe",
    status: (["pending", "active", "rejected", "archived"].includes(String(data.status)) ? data.status : "pending") as PlaybookStatus,
    source: data.source === "inicial" ? "inicial" : "coordenacao",
    updated_by_name: (data.updated_by as { name?: string } | undefined)?.name ?? null,
    decided_by_name: (data.decided_by as { name?: string } | undefined)?.name ?? null,
    updated_at: iso(data.updated_at),
    use_count: Number(data.use_count ?? 0),
  };
}

/** Pendentes e valendo do cliente, para a coordenação (Conhecimento). */
export async function listPlaybooks(db: Firestore, customerCode: string, actor: { role: string }) {
  assertPlaybookReviewer(actor.role);
  const snapshot = await db.collection(PLAYBOOKS_COLLECTION).where("customer_code", "==", customerCode).limit(200).get();
  return snapshot.docs
    .map((doc) => view(doc.id, doc.data()))
    .filter((item) => item.status === "pending" || item.status === "active")
    .sort((left, right) => (left.status === right.status ? left.title.localeCompare(right.title, "pt-BR") : left.status === "pending" ? -1 : 1));
}

function actorRef(actor: OperationalActor) {
  return { uid: actor.uid, name: actor.name ?? null, role: actor.role };
}

/**
 * Cria ou edita. Escrito pela coordenação vale direto (ela é quem aprova);
 * editar um pendente mantém pendente até alguém aprovar.
 */
export async function savePlaybook(
  db: Firestore,
  customerCode: string,
  input: z.infer<typeof PlaybookInputSchema>,
  actor: OperationalActor,
) {
  assertPlaybookReviewer(actor.role);
  const playbooks = db.collection(PLAYBOOKS_COLLECTION);
  const id = input.id || `pb_${randomUUID().slice(0, 12)}`;
  return db.runTransaction(async (transaction) => {
    const ref = playbooks.doc(id);
    const existing = await transaction.get(ref);
    if (input.id && !existing.exists) throw new HttpsError("not-found", "Playbook não encontrado.");
    const before = existing.data() ?? {};
    if (existing.exists && before.customer_code !== customerCode) throw new HttpsError("not-found", "Playbook não encontrado.");
    if (existing.exists && (before.status === "rejected" || before.status === "archived")) {
      throw new HttpsError("failed-precondition", "Este playbook foi recusado ou arquivado e não pode mais ser editado.");
    }
    const status: PlaybookStatus = existing.exists ? (before.status as PlaybookStatus) : "active";
    const content = { title: input.title, when: input.when, steps: input.steps, open_points: input.open_points, audience: input.audience };
    if (existing.exists) {
      transaction.update(ref, { ...content, updated_by: actorRef(actor), updated_at: FieldValue.serverTimestamp() });
    } else {
      transaction.set(ref, {
        id,
        customer_code: customerCode,
        ...content,
        status,
        source: "coordenacao",
        use_count: 0,
        created_by: actorRef(actor),
        updated_by: actorRef(actor),
        ...(status === "active" ? { decided_by: actorRef(actor), decided_at: FieldValue.serverTimestamp() } : {}),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    createEvent(
      transaction,
      db,
      `evt_playbook_${existing.exists ? "edited" : "created"}_${id}_${randomUUID().slice(0, 8)}`,
      {
        type: existing.exists ? "agent.playbook_edited" : "agent.playbook_created",
        title: existing.exists ? "Playbook do Agent Dute editado" : "Playbook do Agent Dute criado",
        description: input.title,
        entity_type: "agent_playbook",
        entity_id: id,
        customer_code: customerCode,
        payload: { status, audience: input.audience, steps: input.steps.length },
        inbox: false,
      },
      actor,
    );
    return { id, status };
  });
}

/** Aprova ou recusa um pendente; arquiva um que está valendo. */
export async function decidePlaybook(db: Firestore, customerCode: string, input: z.infer<typeof DecidePlaybookSchema>, actor: OperationalActor) {
  assertPlaybookReviewer(actor.role);
  const ref = db.collection(PLAYBOOKS_COLLECTION).doc(input.id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data?.customer_code !== customerCode) throw new HttpsError("not-found", "Playbook não encontrado.");
    const status = data.status as PlaybookStatus;
    const allowed = input.action === "archive" ? status === "active" : status === "pending";
    if (!allowed) {
      throw new HttpsError("failed-precondition", `Este playbook já está ${status === "active" ? "valendo" : status === "rejected" ? "recusado" : "arquivado"}.`);
    }
    const next: PlaybookStatus = input.action === "approve" ? "active" : input.action === "reject" ? "rejected" : "archived";
    transaction.update(ref, { status: next, decided_by: actorRef(actor), decided_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() });
    createEvent(
      transaction,
      db,
      `evt_playbook_${next}_${input.id}_${randomUUID().slice(0, 8)}`,
      {
        type: `agent.playbook_${next === "active" ? "approved" : next}`,
        title: next === "active" ? "Playbook do Agent Dute aprovado" : next === "rejected" ? "Playbook do Agent Dute recusado" : "Playbook do Agent Dute arquivado",
        description: String(data.title ?? ""),
        entity_type: "agent_playbook",
        entity_id: input.id,
        customer_code: customerCode,
        payload: {},
        inbox: false,
      },
      actor,
    );
    return { id: input.id, status: next };
  });
}

/**
 * Carrega os playbooks iniciais como pendentes. Idempotente: o id é fixo por
 * cliente, e um que já existe (em qualquer status) não é recriado.
 */
export async function seedInitialPlaybooks(db: Firestore, customerCode: string, actor: OperationalActor) {
  assertPlaybookReviewer(actor.role);
  const playbooks = db.collection(PLAYBOOKS_COLLECTION);
  return db.runTransaction(async (transaction) => {
    const refs = INITIAL_PLAYBOOKS.map((item) => ({ item, ref: playbooks.doc(initialPlaybookId(customerCode, item.slug)) }));
    const existing = await Promise.all(refs.map(({ ref }) => transaction.get(ref)));
    const created: string[] = [];
    refs.forEach(({ item, ref }, index) => {
      if (existing[index]!.exists) return;
      transaction.set(ref, {
        id: ref.id,
        customer_code: customerCode,
        title: item.title,
        when: item.when,
        steps: item.steps,
        open_points: item.open_points,
        audience: item.audience,
        status: "pending" satisfies PlaybookStatus,
        source: "inicial",
        use_count: 0,
        created_by: actorRef(actor),
        updated_by: actorRef(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      created.push(ref.id);
    });
    if (created.length) {
      createEvent(
        transaction,
        db,
        `evt_playbook_seeded_${randomUUID().slice(0, 12)}`,
        {
          type: "agent.playbooks_seeded",
          title: "Playbooks iniciais do Agent Dute carregados para aprovação",
          description: `${created.length} playbook(s) aguardando aprovação`,
          entity_type: "agent_playbook",
          entity_id: created[0]!,
          customer_code: customerCode,
          payload: { ids: created },
          inbox: false,
        },
        actor,
      );
    }
    return { created: created.length };
  });
}

export function initialPlaybookId(customerCode: string, slug: string) {
  const key = customerCode.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
  return `pb_ini_${key}_${slug}`;
}

/** Quem é cliente só vê playbook marcado para todos. */
export function playbookVisibleTo(audience: PlaybookAudience, who: "customer" | "internal") {
  return who === "internal" || audience === "todos";
}

/** Índice dos playbooks aprovados para o prompt: id, nome e quando usar (os passos vêm pela ferramenta). */
export async function activePlaybooksForPrompt(db: Firestore, customerCode: string, who: "customer" | "internal") {
  const snapshot = await db
    .collection(PLAYBOOKS_COLLECTION)
    .where("customer_code", "==", customerCode)
    .where("status", "==", "active")
    .limit(MAX_ACTIVE_IN_PROMPT * 2)
    .get();
  return snapshot.docs
    .map((doc) => view(doc.id, doc.data()))
    .filter((item) => playbookVisibleTo(item.audience, who))
    .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"))
    .slice(0, MAX_ACTIVE_IN_PROMPT)
    .map((item) => ({ id: item.id, title: item.title, when: item.when }));
}

export function playbookIndexText(items: Array<{ id: string; title: string; when: string }>) {
  return items.map((item) => `- [${item.id}] ${item.title}: ${item.when}`).join("\n");
}

/** Ferramenta consultar_playbook: os passos de um aprovado, respeitando quem pergunta. */
export async function readPlaybookForAgent(db: Firestore, customerCode: string, id: string, who: "customer" | "internal") {
  const ref = db.collection(PLAYBOOKS_COLLECTION).doc(id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || data.customer_code !== customerCode || data.status !== "active") {
    return { encontrado: false, motivo: "Não há playbook aprovado com esse id." };
  }
  const item = view(snapshot.id, data);
  if (!playbookVisibleTo(item.audience, who)) return { encontrado: false, motivo: "Não há playbook aprovado com esse id." };
  await ref.update({ use_count: FieldValue.increment(1), last_used_at: FieldValue.serverTimestamp() }).catch(() => undefined);
  return {
    encontrado: true,
    nome: item.title,
    quando_usar: item.when,
    passos: item.steps,
    instrucao:
      "Oriente a pessoa com estes passos, adaptados ao caso dela, e diga que é o procedimento aprovado pela coordenação. Use os dados reais das consultas. Você não executa nenhum passo: quem faz é a pessoa, na tela indicada.",
  };
}
