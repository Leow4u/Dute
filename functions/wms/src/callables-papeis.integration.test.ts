import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

import { WMS_ROLES } from "./domain/platform-roles.js";

/**
 * Quem passa da checagem de papel em cada callable do WMS. A porta (login,
 * perfil ativo, papel que o WMS atende) está em callables-auth.integration.test.ts;
 * aqui, já dentro do WMS, cada callable diz que papéis atende e com que frase
 * recusa os outros. A tabela é escrita à mão, de propósito: não importa as
 * listas do código, e mudar quem passa numa callable é mudar a linha dela.
 * Callable nova sem linha reprova.
 *
 * Passar quer dizer não receber permission-denied: com a entrada da linha,
 * quem passa para na validação, num documento que não existe ou na própria
 * ação, nunca no papel. Onde a checagem de papel vem depois da validação da
 * entrada, a linha leva uma entrada que chega até ela.
 */

const PROJECT_ID = "demo-dute-operations";

type Papel = (typeof WMS_ROLES)[number];

type Entrada = Record<string, unknown>;

type Linha = {
  /** Os papéis que passam; os outros recebem permission-denied com `recusa`. */
  passam: readonly Papel[];
  recusa?: string;
  /** Só onde a checagem de papel vem depois da validação da entrada. */
  entrada?: Entrada | ((papel: Papel) => Entrada);
  /** Só a recusa roda: para quem passa, a callable chamaria um serviço de fora. */
  soRecusa?: true;
};

type Callable = {
  run: (request: never) => Promise<unknown>;
  __endpoint?: { callableTrigger?: unknown };
};

const TODOS: readonly Papel[] = WMS_ROLES;
const INTERNOS: readonly Papel[] = ["owner", "admin", "interno", "wms", "financeiro", "suporte"];
const ARMAZEM: readonly Papel[] = ["owner", "admin", "interno", "wms"];
const COORDENACAO: readonly Papel[] = ["owner", "admin", "interno"];
const DOCUMENTOS: readonly Papel[] = ["owner", "admin", "interno", "wms", "financeiro"];
const LE_FATURAMENTO: readonly Papel[] = ["owner", "admin", "financeiro", "suporte"];
const FATURA: readonly Papel[] = ["owner", "admin", "financeiro"];
const ACESSO: readonly Papel[] = ["owner", "admin"];
const AGENTE: readonly Papel[] = ["owner", "admin", "interno", "suporte"];
const OWNER: readonly Papel[] = ["owner"];
const CLIENTE: readonly Papel[] = ["cliente"];

const SO_ARMAZEM = "Ação permitida somente para administração ou operação de armazém.";
const SO_OPERACAO = "Ação permitida somente para a operação Dutelog.";
const SO_COORDENACAO = "Ação permitida somente para administração ou coordenação operacional.";
const SO_FATURA = "Ação permitida somente para administração ou financeiro.";
const SO_ACESSO = "Ação permitida somente para administradores de acesso.";
const SO_LE_FATURAMENTO = "Faturamento visível somente para administração, financeiro ou suporte.";
const SO_PAINEL = "Painel do sistema disponível só para o owner.";
const SO_POSICOES = "Posições do armazém: somente administração ou coordenação operacional alteram.";
const SO_PLAYBOOKS = "Só a coordenação edita e aprova os playbooks do Agent Dute.";
const SO_ANOTACOES = "Só a coordenação vê e aprova as anotações do Agent Dute.";
const SO_EVENTOS_DO_CLIENTE = "Perfil sem acesso aos eventos do cliente.";
const SO_ANEXAR = "Perfil sem permissao para anexar documentos.";

/** Cadastro em massa (mutateManagedEntity): o papel depende do recurso. */
function cadastro(resource: string, action: string): (papel: Papel) => Entrada {
  return (papel) => ({ resource, action, id: "registro-que-nao-existe", data: {}, idempotency_key: `papeis-${resource}-${papel}` });
}

/** Um tipo de arquivo que a callable recusa depois do papel: quem passa para antes da URL assinada. */
const DOCUMENTO_RECUSADO = { file_name: "programa.exe", content_type: "application/x-msdownload", size_bytes: 10 };

/**
 * A chave é o nome da callable; `nome:variante` quando o papel depende da
 * entrada (o recurso do cadastro, o tipo do documento).
 */
const MATRIZ: Record<string, Linha> = {
  addCatalogPhotos: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  advanceWarehouseTask: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  analyzeEvent: { passam: INTERNOS, recusa: SO_OPERACAO },
  applyDocumentOperationalAction: {
    passam: DOCUMENTOS,
    recusa: "Perfil sem permissao para transformar documento em acao operacional.",
  },
  approveDocumentKnowledge: {
    passam: ["owner", "admin", "interno", "financeiro"],
    recusa: "Perfil sem permissao para aprovar conhecimento do Agent Dute.",
  },
  archiveClientEventTemplate: {
    passam: [...COORDENACAO, "cliente"],
    recusa: SO_EVENTOS_DO_CLIENTE,
    entrada: { id: "evento-que-nao-existe" },
  },
  assignRequestNumbers: { passam: OWNER, recusa: "Só o owner roda esta manutenção." },
  cancelCustomerOrder: { passam: CLIENTE, recusa: "Cancelamento disponível no portal do cliente." },
  cancelShipmentNotice: {
    passam: CLIENTE,
    recusa: "Só quem avisou o envio pode cancelar o aviso.",
    entrada: { request_id: "aviso-que-nao-existe" },
  },
  // A entrada válida chamaria o Gemini; a conversa é de todos, sem checagem de papel.
  chatWithAgentDute: { passam: TODOS },
  completeOpeningInventorySession: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  // Qualquer papel do WMS abre solicitação (pergunta 55 do plano de implantação).
  createCustomerRequest: {
    passam: TODOS,
    entrada: (papel) => ({ idempotency_key: `papeis-pedido-${papel}`, title: "Solicitação do teste de papéis" }),
  },
  createDocumentUploadTarget: { passam: DOCUMENTOS, recusa: SO_ANEXAR, entrada: DOCUMENTO_RECUSADO },
  "createDocumentUploadTarget:aviso de recebimento": {
    passam: [...DOCUMENTOS, "cliente"],
    recusa: SO_ANEXAR,
    entrada: { ...DOCUMENTO_RECUSADO, document_type: "aviso_recebimento" },
  },
  createInboundReceipt: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createInventoryMovement: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createOpeningConferenceBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createOpeningInventorySession: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createProductPhotoUploadTarget: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createReturnReceipt: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  createWarehouseAislePositions: {
    passam: COORDENACAO,
    recusa: SO_POSICOES,
    entrada: { aisle: "Z", shelves: 1, length_m: 1, depth_m: 1, height_m: 1 },
  },
  createWarehouseBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  decideAgentNote: { passam: AGENTE, recusa: SO_ANOTACOES },
  decideAgentPlaybook: {
    passam: AGENTE,
    recusa: SO_PLAYBOOKS,
    entrada: { id: "playbook-que-nao-existe", action: "approve" },
  },
  decideCustomerRequest: { passam: COORDENACAO, recusa: SO_COORDENACAO },
  decideOperationalNotification: { passam: INTERNOS, recusa: SO_OPERACAO },
  // As rotinas são de cada pessoa: a recusa é por dono, não por papel.
  deleteAgentRoutine: { passam: TODOS, entrada: { id: "rotina-que-nao-existe" } },
  emitBillingInvoice: { passam: FATURA, recusa: SO_FATURA },
  // O cliente baixa as próprias faturas; da equipe, quem lê o faturamento
  // (o suporte também, pergunta 43 do plano de implantação).
  exportBillingReport: {
    passam: [...LE_FATURAMENTO, "cliente"],
    recusa: SO_LE_FATURAMENTO,
    entrada: { from: "2026-10", to: "2026-10" },
  },
  extractOperationalDocumentContent: {
    passam: DOCUMENTOS,
    recusa: "Perfil sem permissao para extrair conteudo de documentos.",
  },
  generateCatalogPhoto: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  generateDailyBriefing: { passam: INTERNOS, recusa: SO_OPERACAO },
  // O suporte lê a prévia com preço (pergunta 43 do plano de implantação).
  getBillingPreview: { passam: LE_FATURAMENTO, recusa: SO_LE_FATURAMENTO },
  getOpeningConferenceBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  getOpeningInventorySession: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  getSystemDashboard: { passam: OWNER, recusa: SO_PAINEL },
  getSystemHealth: { passam: ["owner", "admin", "suporte"], recusa: "Sistema visível somente para administração ou suporte." },
  // O owner consultaria o Google Cloud; o caminho dele está em domain/system-infra.integration.test.ts.
  getSystemInfra: { passam: OWNER, recusa: SO_PAINEL, soRecusa: true },
  linkInboundNotice: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  listAgentNotes: { passam: AGENTE, recusa: SO_ANOTACOES },
  listAgentPlaybooks: { passam: AGENTE, recusa: SO_PLAYBOOKS },
  listAgentRoutines: { passam: TODOS },
  listClientEventTemplates: { passam: [...COORDENACAO, "cliente"], recusa: SO_EVENTOS_DO_CLIENTE },
  // Pública: o token do convite é a credencial (callables-auth.integration.test.ts).
  lookupInvite: { passam: TODOS },
  manageCatalogPhotos: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  moveOpeningInventoryLine: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  "mutateManagedEntity:products": { passam: COORDENACAO, recusa: SO_COORDENACAO, entrada: cadastro("products", "update") },
  "mutateManagedEntity:skus": { passam: COORDENACAO, recusa: SO_COORDENACAO, entrada: cadastro("skus", "update") },
  "mutateManagedEntity:billing_price_list": { passam: FATURA, recusa: SO_FATURA, entrada: cadastro("billing_price_list", "update") },
  "mutateManagedEntity:billing_config": { passam: FATURA, recusa: SO_FATURA, entrada: cadastro("billing_config", "update") },
  "mutateManagedEntity:ai_agent_inbox": {
    passam: COORDENACAO,
    recusa: "Perfil sem permissão para tratar alertas.",
    entrada: cadastro("ai_agent_inbox", "resolve"),
  },
  "mutateManagedEntity:documents": {
    passam: DOCUMENTOS,
    recusa: "Perfil sem permissao para administrar documentos.",
    entrada: cadastro("documents", "update"),
  },
  "mutateManagedEntity:users": { passam: ACESSO, recusa: SO_ACESSO, entrada: cadastro("users", "set_role") },
  "mutateManagedEntity:invites": { passam: ACESSO, recusa: SO_ACESSO, entrada: cadastro("invites", "archive") },
  "mutateManagedEntity:customers": { passam: ACESSO, recusa: SO_ACESSO, entrada: cadastro("customers", "update") },
  "mutateManagedEntity:customer_accounts": { passam: ACESSO, recusa: SO_ACESSO, entrada: cadastro("customer_accounts", "update") },
  payBillingInvoice: { passam: FATURA, recusa: SO_FATURA },
  readShipmentInvoice: { passam: CLIENTE, recusa: "Leitura de nota disponível no portal do cliente." },
  receiveOrderReturn: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  recordCycleCount: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  // Os tipos que entram à mão estão em eventos-manuais.integration.test.ts.
  recordOperationalEvent: {
    passam: INTERNOS,
    recusa: SO_OPERACAO,
    entrada: { type: "operator.note", title: "Anotação do teste de papéis" },
  },
  recordWarehouseException: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  removeOpeningConferenceLine: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  removeOpeningInventoryLine: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  removeWarehouseBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  removeWarehousePosition: { passam: COORDENACAO, recusa: SO_POSICOES, entrada: { code: "Z-99" } },
  resolveWarehouseException: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  resumeOpeningConferenceBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  reviewOperationalDocument: { passam: DOCUMENTOS, recusa: "Perfil sem permissao para revisar documentos." },
  runAgentRoutineNow: { passam: TODOS, entrada: { id: "rotina-que-nao-existe" } },
  saveAgentCostSettings: { passam: OWNER, recusa: SO_PAINEL, entrada: { input_per_million: 1, output_per_million: 1 } },
  saveAgentPlaybook: {
    passam: AGENTE,
    recusa: SO_PLAYBOOKS,
    entrada: { title: "Recebimento", when: "Quando chega carga", steps: ["Conferir a nota"], audience: "equipe" },
  },
  saveAgentRoutine: {
    passam: TODOS,
    entrada: { name: "Resumo", prompt: "Resumo do dia do estoque", frequency: "daily", time: "08:00" },
  },
  saveBillingManual: { passam: FATURA, recusa: SO_FATURA },
  saveClientEventTemplate: {
    passam: [...COORDENACAO, "cliente"],
    recusa: SO_EVENTOS_DO_CLIENTE,
    entrada: { name: "Feira", venue: "Galpão", items: [{ sku_code: "BTG-000001", product_name: "Camisa", quantity: 1 }] },
  },
  saveOpeningConferenceLine: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  saveSystemInfraSettings: { passam: OWNER, recusa: SO_PAINEL },
  saveWarehousePositions: {
    passam: COORDENACAO,
    recusa: SO_POSICOES,
    entrada: { positions: [{ aisle: "Z", shelf: 1, length_m: 1, depth_m: 1, height_m: 1 }] },
  },
  seedAgentPlaybooks: { passam: AGENTE, recusa: SO_PLAYBOOKS },
  seedWarehouseLayout: { passam: COORDENACAO, recusa: SO_POSICOES },
  setClientItemArchived: {
    passam: [...COORDENACAO, "cliente"],
    recusa: "Perfil sem permissão para arquivar itens do cliente.",
    entrada: { inventory_id: "item-que-nao-existe", archived: true },
  },
  setOpeningConferenceBoxState: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  setOrderDelivery: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  setReturnDisposition: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  setUserAccess: { passam: ACESSO, recusa: SO_ACESSO },
  splitCatalogPrices: { passam: ACESSO, recusa: "Só a administração separa o preço do catálogo." },
  storeOpeningConferenceBox: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  suggestWarehousePosition: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  syncOperationalNotifications: { passam: INTERNOS, recusa: SO_OPERACAO },
  updateInboundReceiptConference: { passam: ARMAZEM, recusa: SO_ARMAZEM },
  uploadOperationalDocument: { passam: DOCUMENTOS, recusa: SO_ANEXAR },
  uploadShipmentAttachment: { passam: CLIENTE, recusa: "Anexo de aviso disponível no portal do cliente." },
};

/** O cliente da varredura tem armazenagem e faturas no contrato (sem client_access, vale o padrão). */
const CLIENTE_CODE = "BTG Pactual";

let callables: Map<string, Callable>;

function callablesDe(module: Record<string, unknown>): Map<string, Callable> {
  const found = new Map<string, Callable>();
  for (const [name, value] of Object.entries(module)) {
    const candidate = value as Callable;
    if (typeof value === "function" && typeof candidate.run === "function" && candidate.__endpoint?.callableTrigger) {
      found.set(name, candidate);
    }
  }
  return found;
}

function entradaDe(linha: Linha, papel: Papel): Entrada {
  if (typeof linha.entrada === "function") return linha.entrada(papel);
  return linha.entrada ?? {};
}

async function chamar(callable: Callable, papel: Papel, data: Entrada) {
  try {
    await callable.run({
      auth: { uid: `papel-${papel}`, token: { email: `papel-${papel}@dutelog.com.br` } },
      data,
      rawRequest: { headers: {} },
    } as never);
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { code, message };
  }
  return { code: "aceitou", message: "" };
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  callables = callablesDe(await import("./index.js"));
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const users = getFirestore().collection("users");
  for (const papel of WMS_ROLES) {
    await users.doc(`papel-${papel}`).set({ role: papel, nome: papel, ...(papel === "cliente" ? { customer_code: CLIENTE_CODE } : {}) });
  }
});

describe("quem passa da checagem de papel em cada callable do WMS", () => {
  it("os papéis do WMS são os da tabela", () => {
    assert.deepEqual([...WMS_ROLES].sort(), ["admin", "cliente", "financeiro", "interno", "owner", "suporte", "wms"]);
  });

  it("toda callable do index.ts tem linha na tabela, e toda linha é de uma callable", () => {
    const nomes = new Set(Object.keys(MATRIZ).map((chave) => chave.split(":")[0]));
    assert.deepEqual([...nomes].sort(), [...callables.keys()].sort());
  });

  it("toda linha que recusa alguém diz com que frase", () => {
    const semFrase = Object.entries(MATRIZ)
      .filter(([, linha]) => linha.passam.length < TODOS.length && !linha.recusa)
      .map(([chave]) => chave);
    assert.deepEqual(semFrase, []);
  });

  for (const [chave, linha] of Object.entries(MATRIZ)) {
    it(`${chave}: ${linha.passam.length === TODOS.length ? "todos passam" : `passam ${linha.passam.join(", ")}`}`, async () => {
      const callable = callables.get(chave.split(":")[0]);
      assert.ok(callable, `${chave} não é callable do index.ts`);
      const erradas: string[] = [];
      for (const papel of WMS_ROLES) {
        const passa = linha.passam.includes(papel);
        if (passa && linha.soRecusa) continue;
        const got = await chamar(callable, papel, entradaDe(linha, papel));
        const certo = passa ? got.code !== "permission-denied" : got.code === "permission-denied" && got.message === linha.recusa;
        if (!certo) erradas.push(`${papel}: ${String(got.code)} ${String(got.message)}`);
      }
      assert.deepEqual(erradas, []);
    });
  }
});
