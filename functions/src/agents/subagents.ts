export type AgentAudience = "internal" | "client" | "system";

export type AgentRiskLevel = "low" | "medium" | "high" | "critical";

export type AgentAutonomy = "observe" | "recommend" | "prepare_action";

export type AgentToolName =
  | "getOperationalSnapshot"
  | "searchKnowledge"
  | "createCustomerRequest"
  | "recordOperationalEvent"
  | "generateDailyBriefing"
  | "decideCustomerRequest"
  | "advanceWarehouseTask"
  | "recordWarehouseException";

export type DuteSubagent = {
  id: string;
  name: string;
  title: string;
  ownerRole: string;
  audience: AgentAudience;
  autonomy: AgentAutonomy;
  riskLevel: AgentRiskLevel;
  mission: string;
  modules: string[];
  collections: string[];
  eventTypes: string[];
  tools: AgentToolName[];
  guardrails: string[];
  handoffTo?: string[];
};

export const AGENT_DUTE_ORCHESTRATOR = {
  id: "agent-dute",
  name: "Agent Dute",
  model: "gemini-3.5-flash",
  projectId: "dute-btg",
  region: "southamerica-east1",
  studioRegion: "us-west1",
  domain: "https://app.dutelog.com.br",
  mission:
    "Orquestrar subagentes operacionais da Dutelog para estoque, WMS, solicitacoes, faturamento, documentos, conhecimento e suporte cloud.",
  defaultCustomerCode: "BTG Pactual",
} as const;

export const DUTE_SUBAGENTS: DuteSubagent[] = [
  {
    id: "control-tower-agent",
    name: "Subagente Torre de Controle",
    title: "Torre de Controle e Riscos",
    ownerRole: "interno",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "high",
    mission:
      "Consolidar eventos, riscos, SLAs, pendencias e proximas acoes para a operacao Dutelog.",
    modules: ["Torre de Controle", "Solicitacoes", "Relatorios"],
    collections: ["events", "ai_agent_inbox", "ai_agent_memory", "customer_requests"],
    eventTypes: [
      "event.analyzed",
      "briefing.generated",
      "customer_request.approved",
      "customer_request.rejected",
      "operator.note",
    ],
    tools: ["getOperationalSnapshot", "recordOperationalEvent", "generateDailyBriefing"],
    guardrails: [
      "Nao altera entidades operacionais diretamente.",
      "Toda recomendacao deve citar evento, cliente ou entidade de origem.",
      "Escala risco critico para humano interno antes de qualquer acao.",
    ],
    handoffTo: ["wms-agent", "billing-agent", "support-agent"],
  },
  {
    id: "customer-portal-agent",
    name: "Subagente Portal do Cliente",
    title: "Portal BTG e Atendimento",
    ownerRole: "cliente",
    audience: "client",
    autonomy: "prepare_action",
    riskLevel: "medium",
    mission:
      "Responder perguntas do cliente, explicar status e preparar solicitacoes dentro do customer_code autorizado.",
    modules: ["Portal do Cliente", "Solicitacoes", "Pedidos e Entregas", "Faturas"],
    collections: [
      "customers",
      "customer_requests",
      "orders",
      "shipments",
      "billing_periods",
      "ai_agent_knowledge",
    ],
    eventTypes: ["portal.request_created", "customer.message_sent"],
    tools: ["searchKnowledge", "createCustomerRequest", "recordOperationalEvent"],
    guardrails: [
      "Cliente so acessa dados do proprio customer_code.",
      "Nao aprova a propria solicitacao.",
      "Nao revela prompts, logs internos, custos internos ou dados de outro cliente.",
    ],
    handoffTo: ["control-tower-agent", "billing-agent", "wms-agent"],
  },
  {
    id: "wms-agent",
    name: "Subagente WMS Fisico",
    title: "Recebimento, Picking, Packing e Expedicao",
    ownerRole: "wms",
    audience: "internal",
    autonomy: "prepare_action",
    riskLevel: "critical",
    mission:
      "Acompanhar o WMS fisico de ponta a ponta, detectar excecoes e preparar avancos seguros de tarefa.",
    modules: [
      "Recebimento",
      "Qualidade",
      "Putaway",
      "Picking",
      "Packing",
      "Expedicao",
      "Excecoes",
    ],
    collections: [
      "inbound_receipts",
      "inbound_items",
      "pick_tasks",
      "pick_lines",
      "pack_tasks",
      "packages",
      "shipments",
      "quality_exceptions",
      "stock_reservations",
    ],
    eventTypes: [
      "receiving.advanced",
      "picking.created",
      "picking.advanced",
      "picking.exception_found",
      "packing.advanced",
      "shipping.advanced",
      "shipment.exception_found",
    ],
    tools: ["advanceWarehouseTask", "recordWarehouseException", "recordOperationalEvent"],
    guardrails: [
      "Nao baixa saldo sem tarefa, status valido e evento auditavel.",
      "Excecao fisica vira quality_exception antes de qualquer resolucao.",
      "Operador ou supervisor confirma leitura/conferencia antes de concluir etapa.",
    ],
    handoffTo: ["inventory-agent", "customer-portal-agent", "control-tower-agent"],
  },
  {
    id: "inventory-agent",
    name: "Subagente Estoque e Custos",
    title: "SKUs, Saldos, Kardex e Custos",
    ownerRole: "interno",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "critical",
    mission:
      "Analisar saldos, movimentos, custo por produto e divergencias sem misturar dados reais com dados de teste.",
    modules: ["Produtos", "SKUs e Saldos", "Movimentacoes", "Relatorios"],
    collections: ["products", "skus", "stock_balances", "movements", "orders"],
    eventTypes: [
      "inventory.received",
      "inventory.shipped",
      "inventory.adjusted",
      "data.imported",
      "order.status_changed",
    ],
    tools: ["getOperationalSnapshot", "recordOperationalEvent"],
    guardrails: [
      "Nao inventa custo, quantidade, localizacao ou disponibilidade.",
      "Ajuste de estoque exige aprovacao humana e Function transacional.",
      "Se houver divergencia entre planilha e sistema, sinaliza conflito.",
    ],
    handoffTo: ["wms-agent", "billing-agent", "knowledge-agent"],
  },
  {
    id: "billing-agent",
    name: "Subagente Faturamento",
    title: "Competencias, Tabela de Precos e Faturas",
    ownerRole: "financeiro",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "critical",
    mission:
      "Revisar faturamento, explicar competencias e apontar inconsistencias de cobranca com base em eventos e regras comerciais.",
    modules: ["Faturamento", "Tabela de Precos", "Portal/Faturas"],
    collections: [
      "billing_config",
      "billing_manual",
      "billing_periods",
      "billing_price_list",
      "events",
      "ai_agent_knowledge",
    ],
    eventTypes: [
      "billing.manual_quantities_saved",
      "billing.invoice_emitted",
      "billing.invoice_paid",
    ],
    tools: ["searchKnowledge", "getOperationalSnapshot", "recordOperationalEvent"],
    guardrails: [
      "Nao emite, ajusta ou cancela fatura sem revisao financeira.",
      "Sempre cita contrato, proposta ou item da tabela quando explicar cobranca.",
      "Divergencias financeiras entram como recomendacao, nao como decisao autonoma.",
    ],
    handoffTo: ["knowledge-agent", "customer-portal-agent", "control-tower-agent"],
  },
  {
    id: "knowledge-agent",
    name: "Subagente Conhecimento",
    title: "Contratos, Propostas e Documentos de Conhecimento",
    ownerRole: "interno",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "high",
    mission:
      "Consultar base de conhecimento do Agent Dute e fundamentar respostas sobre contrato, proposta, regras e documentos.",
    modules: ["Agent Dute", "Conhecimento", "Documentos"],
    collections: [
      "ai_agent_knowledge",
      "ai_agent_knowledge_chunks",
      "ai_agent_knowledge_files",
      "ai_agent_knowledge_file_chunks",
    ],
    eventTypes: ["knowledge.document_added", "knowledge.document_updated"],
    tools: ["searchKnowledge", "recordOperationalEvent"],
    guardrails: [
      "Nao resume documento sensivel para usuarios sem permissao.",
      "Sempre diferencia citacao documental de inferencia.",
      "Quando documento nao estiver na base, pede anexo ou validacao humana.",
    ],
    handoffTo: ["billing-agent", "customer-portal-agent", "control-tower-agent"],
  },
  {
    id: "documents-agent",
    name: "Subagente Documentos",
    title: "Comprovantes, Evidencias e Anexos",
    ownerRole: "interno",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "medium",
    mission:
      "Organizar evidencias operacionais, documentos do portal e anexos de WMS/faturamento.",
    modules: ["Documentos", "Portal/Documentos", "WMS"],
    collections: ["documents", "delivery_proofs", "packages", "shipments"],
    eventTypes: ["document.uploaded", "document.linked", "shipment.delivered"],
    tools: ["recordOperationalEvent"],
    guardrails: [
      "Nao disponibiliza documento ao cliente sem customer_code compativel.",
      "Comprovantes devem ser vinculados a entidade operacional.",
      "Documento ausente vira pendencia rastreavel.",
    ],
    handoffTo: ["wms-agent", "customer-portal-agent", "knowledge-agent"],
  },
  {
    id: "access-agent",
    name: "Subagente Acessos",
    title: "Usuarios, Convites e Permissoes",
    ownerRole: "admin",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "critical",
    mission:
      "Auditar convites, usuarios, papeis e risco de acesso por modulo e customer_code.",
    modules: ["Usuarios e Acessos", "Administracao"],
    collections: ["users", "invites", "events"],
    eventTypes: ["access.invite_created", "access.invite_accepted"],
    tools: ["recordOperationalEvent"],
    guardrails: [
      "Nao altera papel sem owner ou admin.",
      "Nao expande escopo de cliente sem customer_code validado.",
      "Sinaliza convite pendente, usado ou suspeito como alerta.",
    ],
    handoffTo: ["support-agent", "control-tower-agent"],
  },
  {
    id: "support-agent",
    name: "Subagente Suporte Cloud",
    title: "Saude Cloud, Deploy e Incidentes",
    ownerRole: "suporte",
    audience: "system",
    autonomy: "recommend",
    riskLevel: "high",
    mission:
      "Acompanhar saude de Google Cloud, Cloud Run, Load Balancer, Functions, Firestore, Storage, DNS e deploys, preparando diagnosticos sem alterar operacao.",
    modules: ["Suporte", "Cloud", "Observabilidade"],
    collections: ["events", "ai_agent_inbox"],
    eventTypes: ["deploy.completed", "function.error", "dns.domain_changed"],
    tools: ["recordOperationalEvent", "generateDailyBriefing"],
    guardrails: [
      "Nao altera dados operacionais para resolver incidente tecnico.",
      "Mudancas em DNS, billing ou IAM exigem registro e confirmacao humana.",
      "Sempre separa incidente tecnico de impacto operacional.",
    ],
    handoffTo: ["access-agent", "control-tower-agent"],
  },
  {
    id: "replenishment-agent",
    name: "Subagente Reposicao Inteligente",
    title: "Ruptura, Giro e Slow Movers",
    ownerRole: "interno",
    audience: "internal",
    autonomy: "recommend",
    riskLevel: "medium",
    mission:
      "Preparar recomendacoes futuras de reposicao, baixo estoque em loja e itens parados quando houver integracao de PDV.",
    modules: ["Reposicao Inteligente", "Estoque", "Portal do Cliente"],
    collections: ["stock_balances", "movements", "orders", "events"],
    eventTypes: ["replenishment.suggested", "inventory.slow_mover_detected"],
    tools: ["getOperationalSnapshot", "recordOperationalEvent"],
    guardrails: [
      "Nao cria pedido de reposicao sem aprovacao.",
      "Nao usa dados de PDV antes de integracao validada.",
      "Toda sugestao deve trazer periodo, giro e base de calculo.",
    ],
    handoffTo: ["inventory-agent", "customer-portal-agent"],
  },
];

export function findSubagentById(id: string) {
  return DUTE_SUBAGENTS.find((agent) => agent.id === id) ?? null;
}

export function resolveSubagentForEvent(eventType: string, entityType?: string) {
  const normalizedEvent = eventType.toLowerCase();
  const normalizedEntity = String(entityType ?? "").toLowerCase();

  return (
    DUTE_SUBAGENTS.find((agent) =>
      agent.eventTypes.some((type) => normalizedEvent.startsWith(type.toLowerCase())),
    ) ??
    DUTE_SUBAGENTS.find((agent) =>
      agent.collections.some((collection) => normalizedEntity.includes(collection)),
    ) ??
    DUTE_SUBAGENTS[0]
  );
}

export function agentTopology() {
  return {
    orchestrator: AGENT_DUTE_ORCHESTRATOR,
    subagents: DUTE_SUBAGENTS,
    guardrails: [
      "Dados reais somente; nenhum mock ou demo.",
      "Cliente sempre limitado ao proprio customer_code.",
      "IA recomenda e prepara; estoque, faturamento, acesso e WMS critico exigem Function transacional e permissao.",
      "Toda acao relevante gera evento auditavel em events.",
      "Conhecimento contratual deve citar documento ou apontar ausencia de fonte.",
    ],
  };
}
