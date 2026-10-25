import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
  type QueryConstraint,
} from "firebase/firestore";

import type { ModuloContratavel } from "@workspace/dominio";

import { useAppUser } from "./auth";
import { FINANCE_DOCUMENT_ENTITY_TYPE } from "./document-rows";
import { firestore } from "./firebase";
import { LEGACY_CUSTOMER_CODE } from "./active-customer";
import { INTERNAL_ROLES } from "./modules";
import { useOperationProfile } from "./operation-profile";
import { leiturasDoPortal } from "./operations";

// Perfil de cliente sem código (convites antigos) é da BTG.
const DEFAULT_CUSTOMER_CODE = LEGACY_CUSTOMER_CODE;

type LeituraDoPortal = keyof ReturnType<typeof leiturasDoPortal>;

/**
 * As projeções do portal, cada uma com a leitura que o contrato precisa abrir
 * (as regras pedem o módulo: `isOwnProjectionWith`). Sem módulo, toda conta de
 * cliente lê.
 */
const CUSTOMER_AUTHORIZED_COLLECTIONS: ReadonlyArray<{
  collectionName: string;
  leitura: LeituraDoPortal | null;
  extraEquals?: RealtimeTarget["extraEquals"];
}> = [
  { collectionName: "client_inventory", leitura: "estoque" },
  { collectionName: "client_order_tracking", leitura: "pedidos" },
  { collectionName: "client_request_status", leitura: "solicitacoes" },
  { collectionName: "client_invoices", leitura: "faturas" },
  // A regra só dá o documento publicado: a consulta precisa pedir isso, ou o
  // Firestore nega a lista inteira (a mesma condição de cloud-api.ts).
  { collectionName: "client_documents", leitura: "documentos", extraEquals: [{ field: "customer_visible", value: true }] },
  { collectionName: "client_portal_status", leitura: null },
];

type RealtimeTarget = {
  collectionName: string;
  customerField?: "customer_code" | "cod_cliente";
  userField?: "user_id";
  /** Igualdades que a regra exige na consulta além do cliente. */
  extraEquals?: ReadonlyArray<{ field: string; value: string | boolean }>;
  /**
   * Sinal de mudança: assina só o documento alterado mais recentemente em vez
   * da coleção inteira. O snapshot inicial passa a custar 1 leitura no lugar
   * de N, e qualquer escrita nova (todas carimbam updated_at) chega ao topo e
   * dispara a invalidação.
   */
  changeSignalOnly?: boolean;
};

/** O que a conta do cliente assina: só as projeções que o contrato abre, mais a própria conversa com o agente. */
function customerRealtimeTargets(modules: readonly ModuloContratavel[]): RealtimeTarget[] {
  const leituras = leiturasDoPortal(modules);
  return [
    ...CUSTOMER_AUTHORIZED_COLLECTIONS.filter((item) => !item.leitura || leituras[item.leitura]).map(
      ({ collectionName, extraEquals }): RealtimeTarget => ({
        collectionName,
        customerField: "customer_code",
        ...(extraEquals ? { extraEquals } : {}),
      }),
    ),
    {
      collectionName: "agent_conversations",
      customerField: "customer_code",
      userField: "user_id",
    },
    {
      collectionName: "agent_messages",
      customerField: "customer_code",
      userField: "user_id",
    },
  ];
}

/** Hot subset only — never subscribe to append-only ledgers (movements/events) or full catalogs. */
const INTERNAL_HOT_COLLECTIONS = [
  "customer_requests",
  "inbound_receipts",
  "putaway_tasks",
  "pick_tasks",
  "pack_tasks",
  "shipments",
  "quality_exceptions",
  "returns",
  "ai_agent_inbox",
  "billing_periods",
  "documents",
  "ops_aggregates",
] as const;

/**
 * firestore.rules restringe as coleções operacionais a canReadOperations()
 * (owner/admin/interno/wms/suporte). Assinar o que o papel não pode ler só
 * gera erro de permissão no console e nenhum evento.
 */
const OPERATIONS_ONLY_COLLECTIONS = new Set<string>([
  "customer_requests",
  "inbound_receipts",
  "putaway_tasks",
  "pick_tasks",
  "pack_tasks",
  "shipments",
  "quality_exceptions",
  "returns",
]);

/**
 * canReadBilling() = owner/admin/financeiro/suporte. `wms` nunca leu;
 * `interno` saiu por decisão de produto (30/07/2026): o coordenador não
 * acompanha faturamento. Assinar sem permissão só gera permission-denied
 * contínuo no console — verificado em produção na sessão wms.
 */
const BILLING_ONLY_COLLECTIONS = new Set<string>(["billing_periods"]);
const BILLING_REALTIME_ROLES = new Set(["owner", "admin", "financeiro", "suporte"]);

/**
 * Em `documents`, o financeiro lê só o de faturamento
 * (canReadDocumentInternally), e regra não é filtro: o sinal de mudança da
 * coleção inteira seria negado. Ele assina o que a tela Documentos lista
 * para ele (documentsListUrl).
 */
const FINANCE_SCOPED_TARGETS: readonly RealtimeTarget[] = [
  { collectionName: "documents", extraEquals: [{ field: "entity_type", value: FINANCE_DOCUMENT_ENTITY_TYPE }] },
];

/**
 * Da caixa do agente (`ai_agent_inbox`, canReadObservability), o financeiro
 * lê só o item de faturamento, e nenhuma tela dele mostra a caixa: o sinal
 * da coleção inteira só daria permission-denied.
 */
const FINANCE_UNREAD_COLLECTIONS = new Set<string>(["ai_agent_inbox"]);

function internalHotCollectionsForRole(role: string) {
  const blocked = new Set<string>();
  if (role === "financeiro") {
    for (const name of OPERATIONS_ONLY_COLLECTIONS) blocked.add(name);
    for (const name of FINANCE_UNREAD_COLLECTIONS) blocked.add(name);
    for (const { collectionName } of FINANCE_SCOPED_TARGETS) blocked.add(collectionName);
  }
  if (!BILLING_REALTIME_ROLES.has(role)) {
    for (const name of BILLING_ONLY_COLLECTIONS) blocked.add(name);
  }
  return INTERNAL_HOT_COLLECTIONS.filter((name) => !blocked.has(name));
}

const INTERNAL_USER_SCOPED_TARGETS: readonly RealtimeTarget[] = [
  { collectionName: "agent_conversations", userField: "user_id" },
  { collectionName: "agent_messages", userField: "user_id" },
];

const ACCESS_ADMIN_COLLECTIONS = ["invites", "users"] as const;

const COLLECTION_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  products: [
    ["/api/products"],
    ["/api/dashboard"],
    ["warehouse-ops"],
    ["ai-overview"],
    ["operational-foundation"],
  ],
  skus: [
    ["/api/skus"],
    ["/api/dashboard"],
    ["warehouse-ops"],
    ["ai-overview"],
    ["operational-foundation"],
  ],
  stock_balances: [
    ["stock-balances"],
    ["warehouse-ops"],
    ["ai-overview"],
    ["/api/dashboard"],
    ["client-portal-overview"],
    ["operational-foundation"],
  ],
  movements: [["/api/movements"], ["/api/dashboard"], ["warehouse-ops"], ["ai-overview"]],
  orders: [
    ["/api/orders"],
    ["warehouse-ops"],
    ["ai-overview"],
    ["/api/dashboard"],
    ["client-portal-overview"],
  ],
  order_items: [["/api/orders"], ["warehouse-ops"]],
  stock_reservations: [["warehouse-ops"], ["stock-balances"]],
  customer_requests: [
    ["customer-requests"],
    ["warehouse-ops"],
    ["ai-overview"],
    ["support-customer-requests"],
  ],
  customers: [["admin-customers"], ["documents-customers"], ["support-customers"]],
  customer_accounts: [["admin-customer-accounts"]],
  locations: [["warehouse-ops"], ["operational-foundation"]],
  inbound_receipts: [["warehouse-ops"], ["ai-overview"], ["operational-foundation"]],
  inbound_items: [["warehouse-ops"]],
  putaway_tasks: [["warehouse-ops"], ["ai-overview"]],
  pick_tasks: [["warehouse-ops"], ["ai-overview"]],
  pick_lines: [["warehouse-ops"]],
  pack_tasks: [["warehouse-ops"], ["ai-overview"]],
  shipments: [["warehouse-ops"], ["ai-overview"], ["operational-foundation"]],
  quality_exceptions: [["warehouse-ops"], ["warehouse-exceptions"]],
  returns: [["warehouse-ops"], ["returns-pending"]],
  billing_periods: [["/api/billing/periods"], ["ai-overview"], ["client-portal-overview"]],
  billing_price_list: [["/api/price-list"], ["/api/billing/config"]],
  billing_manual: [["/api/billing/periods"]],
  billing_config: [["/api/billing/config"]],
  events: [["ai-overview"], ["warehouse-ops"]],
  ai_agent_inbox: [["ai-overview"], ["warehouse-ops"], ["support-ai-overview"]],
  ai_agent_memory: [["ai-overview"]],
  ai_agent_knowledge: [["agent-knowledge-documents"], ["ai-overview"]],
  ai_agent_knowledge_chunks: [["agent-knowledge-documents"]],
  ai_agent_knowledge_files: [["agent-knowledge-files"], ["ai-overview"]],
  documents: [["operational-documents"], ["ai-overview"]],
  // Só o dashboard (leitura de 1 doc). Ligar ai-overview aqui fazia cada
  // movimentação de estoque disparar um refetch de ~5 mil documentos.
  ops_aggregates: [["/api/dashboard"]],
  client_inventory: [["client-portal-overview"], ["client-portal-wms"]],
  client_order_tracking: [["client-portal-overview"], ["client-portal-wms"]],
  client_request_status: [["client-portal-overview"]],
  client_invoices: [["client-portal-overview"]],
  client_documents: [["client-portal-overview"]],
  // Trava de saída da abertura: o carrinho do portal libera "Enviar pedido" sem recarregar.
  client_portal_status: [["client-portal-overview"]],
  agent_conversations: [["agent-dute-chat"]],
  agent_messages: [["agent-dute-chat"], ["agent-operational-notifications"]],
  operational_notifications: [["agent-operational-notifications"]],
  invites: [["invites"]],
  users: [["/api/billing/users"], ["invites"]],
};

function uniqueTargets(targets: readonly RealtimeTarget[]) {
  const byKey = new Map<string, RealtimeTarget>();
  for (const target of targets) {
    byKey.set(
      `${target.collectionName}:${target.customerField ?? "all"}:${target.userField ?? "all"}`,
      target,
    );
  }
  return [...byKey.values()];
}

function isAccessAdmin(role?: string) {
  return role === "owner" || role === "admin";
}

function isCustomer(role?: string) {
  return role === "cliente";
}

function buildRealtimeQuery(
  target: RealtimeTarget,
  customerCode: string,
  userId: string,
): Query<DocumentData> | null {
  if (!firestore) return null;

  const ref = collection(firestore, target.collectionName);
  const filters: QueryConstraint[] = [];

  if (target.customerField) {
    filters.push(where(target.customerField, "==", customerCode));
  }
  if (target.userField) {
    filters.push(where(target.userField, "==", userId));
  }
  for (const igual of target.extraEquals ?? []) {
    filters.push(where(igual.field, "==", igual.value));
  }

  // Sem filtros, orderBy de campo único usa o índice automático — não exige
  // índice composto declarado.
  if (target.changeSignalOnly && !filters.length) {
    return query(ref, orderBy("updated_at", "desc"), fsLimit(1));
  }

  return filters.length ? query(ref, ...filters) : ref;
}

function invalidateForCollections(
  queryClient: ReturnType<typeof useQueryClient>,
  collections: Set<string>,
) {
  const seen = new Set<string>();
  for (const collectionName of collections) {
    const keys = COLLECTION_QUERY_KEYS[collectionName] ?? [];
    for (const key of keys) {
      const token = key.join("::");
      if (seen.has(token)) continue;
      seen.add(token);
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  }
}

export function RealtimeSyncBridge() {
  const { user, isLoaded } = useAppUser();
  const { profile } = useOperationProfile();
  const contrato = profile?.modules ?? null;
  const contratoKey = contrato ? contrato.join(",") : null;
  const queryClient = useQueryClient();
  const timerRef = useRef<number | null>(null);
  const changedCollectionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !user || !firestore) return;

    const role = user.publicMetadata.role;
    if (!role) return;
    // Papel da plataforma que o WMS não atende não assina nada: as regras
    // negariam todas as coleções.
    if (!isCustomer(role) && !INTERNAL_ROLES.includes(role)) return;

    const customerCode =
      user.publicMetadata.customer_code || DEFAULT_CUSTOMER_CODE;
    const customer = isCustomer(role);
    // O cliente espera o contrato: assinar o que ele não abre só daria
    // permission-denied contínuo.
    if (customer && !contrato) return;
    const targets = customer
      ? uniqueTargets(customerRealtimeTargets(contrato ?? []))
      : uniqueTargets([
          ...internalHotCollectionsForRole(role).map((collectionName) => ({
            collectionName,
            changeSignalOnly: true,
          })),
          ...(role === "financeiro" ? FINANCE_SCOPED_TARGETS : []),
          ...INTERNAL_USER_SCOPED_TARGETS,
          ...(isAccessAdmin(role) ? ACCESS_ADMIN_COLLECTIONS : []).map(
            (collectionName) => ({ collectionName }),
          ),
        ]);

    function scheduleInvalidation(collectionName: string) {
      changedCollectionsRef.current.add(collectionName);

      if (timerRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const changed = new Set(changedCollectionsRef.current);
        changedCollectionsRef.current.clear();
        invalidateForCollections(queryClient, changed);
      }, 350);
    }

    const unsubscribers = targets
      .map((target) => {
        const realtimeQuery = buildRealtimeQuery(
          target,
          customerCode,
          user.uid,
        );

        if (!realtimeQuery) return null;

        let initialized = false;
        return onSnapshot(
          realtimeQuery,
          (snapshot) => {
            if (!initialized) {
              initialized = true;
              return;
            }

            if (snapshot.docChanges().length > 0) {
              scheduleInvalidation(target.collectionName);
            }
          },
          (error) => {
            console.warn(
              `[realtime] ${target.collectionName} não pôde ser acompanhado em tempo real.`,
              error,
            );
          },
        );
      })
      .filter(Boolean) as Array<() => void>;

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      changedCollectionsRef.current.clear();
    };
    // `contrato` muda junto com `contratoKey`, que é o que a dependência compara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoaded,
    queryClient,
    user?.publicMetadata.customer_code,
    user?.publicMetadata.role,
    user?.uid,
    contratoKey,
  ]);

  return null;
}
