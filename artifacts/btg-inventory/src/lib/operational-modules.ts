import {
  ArrowDownToLine,
  BarChart3,
  Boxes,
  BrainCircuit,
  ClipboardList,
  FileText,
  HandCoins,
  MapPinned,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type OperationalModuleStatus =
  | "online"
  | "partial"
  | "foundation"
  | "planned";

export type OperationalModuleArea =
  | "cliente"
  | "estoque"
  | "armazem"
  | "operacao"
  | "financeiro"
  | "governanca"
  | "inteligencia";

export type OperationalModule = {
  id: string;
  title: string;
  area: OperationalModuleArea;
  status: OperationalModuleStatus;
  route?: string;
  source: "planilha" | "benchmark" | "existente" | "novo";
  icon: LucideIcon;
  purpose: string;
  collections: string[];
  eventTypes: string[];
  aiFlows: string[];
  mvp: string;
};

export const MODULE_STATUS_LABEL: Record<OperationalModuleStatus, string> = {
  online: "Operando",
  partial: "Parcial",
  foundation: "Infra",
  planned: "Planejado",
};

export const MODULE_STATUS_CLASS: Record<OperationalModuleStatus, string> = {
  online: "border-blue-200 bg-blue-50 text-blue-700",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  foundation: "border-blue-200 bg-blue-50 text-blue-700",
  planned: "border-border bg-white/70 text-muted-foreground",
};

export const OPERATIONAL_MODULES: OperationalModule[] = [
  {
    id: "ai-foundation",
    title: "Fundação AI-native",
    area: "inteligencia",
    status: "foundation",
    route: "/agente",
    source: "novo",
    icon: BrainCircuit,
    purpose: "Registrar tudo que acontece como evento auditável e alimentar memória operacional.",
    collections: ["events", "ai_agent_inbox", "ai_agent_memory"],
    eventTypes: ["operator.note", "data.imported", "event.analyzed"],
    aiFlows: ["analyzeEventFlow", "dailyBriefingFlow", "operatorNoteFlow"],
    mvp: "Ledger, radar, timeline, memória e anotação manual.",
  },
  {
    id: "client-portal",
    title: "Portal do cliente",
    area: "cliente",
    status: "planned",
    source: "benchmark",
    icon: Users,
    purpose: "Permitir que o cliente acompanhe estoque, solicitações, documentos e faturas.",
    collections: ["customers", "customer_accounts", "customer_requests", "documents", "billing_periods"],
    eventTypes: ["portal.request_created", "document.uploaded", "customer.message_sent"],
    aiFlows: ["customerPortalAssistantFlow", "customerAccessSummaryFlow"],
    mvp: "Home do cliente BTG com estoque, solicitações, faturas e chat contextual.",
  },
  {
    id: "catalog",
    title: "Catálogo e SKUs",
    area: "estoque",
    status: "online",
    route: "/products",
    source: "planilha",
    icon: PackageSearch,
    purpose: "Manter produtos, custos, categorias e SKUs reais vindos da planilha consolidada.",
    collections: ["products", "skus"],
    eventTypes: ["produto.created", "produto.updated", "sku.created", "sku.updated"],
    aiFlows: ["inventoryQuestionFlow", "missingCostDetectionFlow"],
    mvp: "Base real BTG importada e consultável por produto/SKU.",
  },
  {
    id: "inventory-ledger",
    title: "Kardex e movimentações",
    area: "estoque",
    status: "partial",
    route: "/movements",
    source: "existente",
    icon: ClipboardList,
    purpose: "Registrar entradas, saídas e ajustes com saldo antes/depois.",
    collections: ["movements", "stock_balances", "events"],
    eventTypes: ["inventory.received", "inventory.shipped", "inventory.adjusted"],
    aiFlows: ["analyzeEventFlow", "inventoryAnomalyFlow"],
    mvp: "Movimentação atualizada com evento e saldo recalculado.",
  },
  {
    id: "receiving",
    title: "Receiving / entrada",
    area: "armazem",
    status: "planned",
    source: "benchmark",
    icon: ArrowDownToLine,
    purpose: "Receber NF/remessa, conferir itens e abrir divergências.",
    collections: ["inbound_receipts", "inbound_items", "quality_exceptions"],
    eventTypes: ["inbound.created", "inbound.checked", "inbound.exception_found"],
    aiFlows: ["receivingCheckFlow", "inboundExceptionFlow"],
    mvp: "Entrada com conferência por SKU, quantidade, NF e fotos/documentos.",
  },
  {
    id: "putaway",
    title: "Putaway / endereçamento",
    area: "armazem",
    status: "planned",
    source: "benchmark",
    icon: MapPinned,
    purpose: "Transformar recebimento em posição física: rua, prateleira, caixa e lote.",
    collections: ["locations", "putaway_tasks", "stock_balances"],
    eventTypes: ["putaway.created", "putaway.completed", "warehouse.location_updated"],
    aiFlows: ["putawaySuggestionFlow", "warehouseOptimizationFlow"],
    mvp: "Sugestão de endereço e confirmação de guarda.",
  },
  {
    id: "warehouse-map",
    title: "Mapa do armazém",
    area: "armazem",
    status: "partial",
    route: "/warehouse",
    source: "existente",
    icon: Boxes,
    purpose: "Visualizar estoque por rua, prateleira, caixa e concentração de SKUs.",
    collections: ["skus", "locations", "stock_balances"],
    eventTypes: ["warehouse.location_viewed", "warehouse.location_updated"],
    aiFlows: ["warehouseSummaryFlow", "slottingRiskFlow"],
    mvp: "Mapa atual por campos de localização já existentes na planilha.",
  },
  {
    id: "orders",
    title: "Pedidos / solicitações",
    area: "operacao",
    status: "partial",
    route: "/orders",
    source: "benchmark",
    icon: ShoppingCart,
    purpose: "Controlar solicitações do cliente e status operacional.",
    collections: ["orders", "order_items"],
    eventTypes: ["order.created", "order.status_changed", "order.cancelled"],
    aiFlows: ["orderRiskFlow", "customerRequestSummaryFlow"],
    mvp: "Pedido com status, quantidade solicitada/separada e histórico.",
  },
  {
    id: "picking",
    title: "Picking",
    area: "armazem",
    status: "planned",
    source: "benchmark",
    icon: PackageOpen,
    purpose: "Gerar tarefas de separação por pedido, endereço e SKU.",
    collections: ["pick_tasks", "pick_lines", "orders", "stock_reservations"],
    eventTypes: ["picking.created", "picking.started", "picking.completed", "picking.shortage_found"],
    aiFlows: ["pickPathSuggestionFlow", "pickingExceptionFlow"],
    mvp: "Fila de separação com baixa controlada e divergência quando faltar item.",
  },
  {
    id: "packing",
    title: "Packing",
    area: "armazem",
    status: "planned",
    source: "benchmark",
    icon: PackageCheck,
    purpose: "Conferir itens separados, embalar e preparar expedição.",
    collections: ["pack_tasks", "packages", "package_items"],
    eventTypes: ["packing.started", "packing.completed", "packing.exception_found"],
    aiFlows: ["packingValidationFlow", "packageDocumentFlow"],
    mvp: "Conferência final por pedido, volumes e observações.",
  },
  {
    id: "shipping",
    title: "Expedição",
    area: "operacao",
    status: "planned",
    source: "benchmark",
    icon: Truck,
    purpose: "Registrar despacho, entrega, NF/romaneio e comprovante.",
    collections: ["shipments", "shipment_items", "delivery_proofs"],
    eventTypes: ["shipment.created", "shipment.dispatched", "shipment.delivered"],
    aiFlows: ["dispatchAdvisorFlow", "deliveryFollowUpFlow"],
    mvp: "Saída com responsável, destino, documento e status de entrega.",
  },
  {
    id: "returns",
    title: "Devoluções",
    area: "operacao",
    status: "planned",
    source: "benchmark",
    icon: PackageX,
    purpose: "Receber retorno, classificar estado e devolver para estoque ou exceção.",
    collections: ["returns", "return_items", "quality_exceptions"],
    eventTypes: ["return.created", "return.received", "return.disposition_set"],
    aiFlows: ["returnTriageFlow", "damageSummaryFlow"],
    mvp: "Fluxo de retorno com condição do item e decisão operacional.",
  },
  {
    id: "billing",
    title: "Billing / faturamento",
    area: "financeiro",
    status: "online",
    route: "/faturamento",
    source: "existente",
    icon: Receipt,
    purpose: "Calcular armazenagem, ad valorem e serviços por competência.",
    collections: ["billing_price_list", "billing_periods", "billing_manual", "billing_config"],
    eventTypes: ["billing.manual_quantities_saved", "billing.invoice_emitted", "billing.invoice_paid"],
    aiFlows: ["billingReviewFlow", "invoiceExplanationFlow"],
    mvp: "Competência, itens automáticos/manuais, emissão e pagamento.",
  },
  {
    id: "documents",
    title: "Documentos",
    area: "governanca",
    status: "planned",
    source: "benchmark",
    icon: FileText,
    purpose: "Guardar NF, fotos, comprovantes, PDFs e anexos ligados a eventos.",
    collections: ["documents", "document_links"],
    eventTypes: ["document.uploaded", "document.linked", "document.reviewed"],
    aiFlows: ["documentSummaryFlow", "documentExtractionFlow"],
    mvp: "Upload por pedido, recebimento, fatura ou movimentação.",
  },
  {
    id: "users-access",
    title: "Usuários e convites",
    area: "governanca",
    status: "online",
    route: "/usuarios",
    source: "existente",
    icon: Users,
    purpose: "Controlar acesso interno/cliente por convite e papel.",
    collections: ["users", "invites"],
    eventTypes: ["access.invite_created", "access.invite_accepted", "usuario.updated"],
    aiFlows: ["accessAuditFlow", "permissionRiskFlow"],
    mvp: "Convite fechado por e-mail/senha e trilha de aceite.",
  },
  {
    id: "analytics",
    title: "Relatórios e briefing",
    area: "inteligencia",
    status: "partial",
    route: "/reports",
    source: "existente",
    icon: BarChart3,
    purpose: "Consolidar indicadores, exportações e resumo executivo da operação.",
    collections: ["products", "skus", "movements", "orders", "billing_periods", "events"],
    eventTypes: ["report.exported", "briefing.generated"],
    aiFlows: ["dailyBriefingFlow", "kpiNarrativeFlow"],
    mvp: "Painel atual + briefing gerado por eventos e dados reais.",
  },
  {
    id: "replenishment",
    title: "Reposição inteligente",
    area: "inteligencia",
    status: "planned",
    source: "novo",
    icon: HandCoins,
    purpose: "Conectar venda/PDV no futuro para sugerir reposição, giro e itens parados.",
    collections: ["store_inventory", "store_sales", "replenishment_suggestions"],
    eventTypes: ["store.sales_imported", "store.stock_low", "replenishment.suggested"],
    aiFlows: ["replenishmentSuggestionFlow", "slowMoverDetectionFlow"],
    mvp: "Futuro: começar por importação CSV/Excel antes de API direta do PDV.",
  },
];

export const MODULES_BY_STATUS = OPERATIONAL_MODULES.reduce(
  (acc, item) => {
    acc[item.status] += 1;
    return acc;
  },
  {
    online: 0,
    partial: 0,
    foundation: 0,
    planned: 0,
  } satisfies Record<OperationalModuleStatus, number>,
);

export const MODULES_BY_AREA = OPERATIONAL_MODULES.reduce(
  (acc, item) => {
    acc[item.area] = (acc[item.area] ?? 0) + 1;
    return acc;
  },
  {} as Record<OperationalModuleArea, number>,
);
