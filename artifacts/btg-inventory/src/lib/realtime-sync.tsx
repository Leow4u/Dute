import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";

import { useAppUser } from "./auth";
import { firestore } from "./firebase";

const DEFAULT_CUSTOMER_CODE = "BTG Pactual";

const CUSTOMER_AUTHORIZED_COLLECTIONS = [
  "client_inventory",
  "client_order_tracking",
  "client_request_status",
  "client_invoices",
  "client_documents",
  "agent_conversations",
  "agent_messages",
] as const;

type RealtimeTarget = {
  collectionName: string;
  customerField?: "customer_code" | "cod_cliente";
};

const CUSTOMER_REALTIME_TARGETS: readonly RealtimeTarget[] = [
  ...CUSTOMER_AUTHORIZED_COLLECTIONS.map((collectionName) => ({
    collectionName,
    customerField: "customer_code" as const,
  })),
];

const INTERNAL_OPERATION_COLLECTIONS = [
  "products",
  "skus",
  "stock_balances",
  "movements",
  "customers",
  "customer_accounts",
  "customer_requests",
  "locations",
  "orders",
  "order_items",
  "stock_reservations",
  "billing_periods",
  "billing_price_list",
  "billing_manual",
  "billing_config",
  "events",
  "ai_agent_inbox",
  "ai_agent_memory",
  "ai_agent_knowledge",
  "ai_agent_knowledge_chunks",
  "ai_agent_knowledge_files",
  "ai_agent_knowledge_file_chunks",
  "users",
  "inbound_receipts",
  "inbound_items",
  "putaway_tasks",
  "quality_exceptions",
  "pick_tasks",
  "pick_lines",
  "pack_tasks",
  "packages",
  "package_items",
  "shipments",
  "shipment_items",
  "delivery_proofs",
  "documents",
  ...CUSTOMER_AUTHORIZED_COLLECTIONS,
] as const;

const ACCESS_ADMIN_COLLECTIONS = ["invites"] as const;

function uniqueTargets(targets: readonly RealtimeTarget[]) {
  const byKey = new Map<string, RealtimeTarget>();
  for (const target of targets) {
    byKey.set(
      `${target.collectionName}:${target.customerField ?? "all"}`,
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
): Query<DocumentData> | null {
  if (!firestore) return null;

  const ref = collection(firestore, target.collectionName);
  if (!target.customerField) return ref;

  return query(ref, where(target.customerField, "==", customerCode));
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
    const customerCode =
      user.publicMetadata.customer_code || DEFAULT_CUSTOMER_CODE;
    const customer = isCustomer(role);
    const targets = customer
      ? uniqueTargets(CUSTOMER_REALTIME_TARGETS)
      : uniqueTargets(
          [
            ...INTERNAL_OPERATION_COLLECTIONS,
            ...(isAccessAdmin(role) ? ACCESS_ADMIN_COLLECTIONS : []),
          ].map((collectionName) => ({ collectionName })),
        );

    function scheduleInvalidation(collectionName: string) {
      changedCollectionsRef.current.add(collectionName);

      if (timerRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        changedCollectionsRef.current.clear();
        void queryClient.invalidateQueries();
      }, 350);
    }

    const unsubscribers = targets
      .map((target) => {
        const realtimeQuery = buildRealtimeQuery(target, customerCode);

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
