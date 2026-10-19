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

import { useAppUser } from "./auth";
import { firestore } from "./firebase";
import { LEGACY_CUSTOMER_CODE } from "./active-customer";

// Perfil de cliente sem código (convites antigos) é da BTG.
const DEFAULT_CUSTOMER_CODE = LEGACY_CUSTOMER_CODE;

const CUSTOMER_AUTHORIZED_COLLECTIONS = [
  "client_inventory",
  "client_order_tracking",
  "client_request_status",
  "client_invoices",
  "client_documents",
] as const;

type RealtimeTarget = {
  collectionName: string;
  customerField?: "customer_code" | "cod_cliente";
  userField?: "user_id";
  /**
   * Sinal de mudança: assina só o documento alterado mais recentemente em vez
   * da coleção inteira. O snapshot inicial passa a custar 1 leitura no lugar
   * de N, e qualquer escrita nova (todas carimbam updated_at) chega ao topo e
   * dispara a invalidação.
   */
  changeSignalOnly?: boolean;
};

const CUSTOMER_REALTIME_TARGETS: readonly RealtimeTarget[] = [
  ...CUSTOMER_AUTHORIZED_COLLECTIONS.map((collectionName) => ({
    collectionName,
    customerField: "customer_code" as const,
  })),
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

function internalHotCollectionsForRole(role: string) {
  const blocked = new Set<string>();
  if (role === "financeiro") {
    for (const name of OPERATIONS_ONLY_COLLECTIONS) blocked.add(name);
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

    const customerCode =
      user.publicMetadata.customer_code || DEFAULT_CUSTOMER_CODE;
    const customer = isCustomer(role);
    const targets = customer
      ? uniqueTargets(CUSTOMER_REALTIME_TARGETS)
      : uniqueTargets([
          ...internalHotCollectionsForRole(role).map((collectionName) => ({
            collectionName,
            changeSignalOnly: true,
          })),
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
  }, [
    isLoaded,
    queryClient,
    user?.publicMetadata.customer_code,
    user?.publicMetadata.role,
    user?.uid,
  ]);

  return null;
}
