import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "./firebase";

type FunctionRoute = {
  name: string;
  payload: (
    pathname: string,
    init?: RequestInit,
  ) => Promise<Record<string, unknown>>;
  status?: number;
};

async function readJsonBody(
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === "string") return JSON.parse(init.body || "{}");
  return JSON.parse(await new Response(init.body).text());
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mutationPayload(
  resource: string,
  action: string,
  data: Record<string, unknown>,
  id?: string,
) {
  return {
    resource,
    action,
    ...(id ? { id } : {}),
    data,
    idempotency_key: crypto.randomUUID(),
  };
}

export function functionRoute(pathname: string, method: string): FunctionRoute | null {
  if (method === "POST" && pathname === "/api/client/requests") {
    return {
      name: "createCustomerRequest",
      status: 201,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const requestActionMatch = pathname.match(
    /^\/api\/customer-requests\/([^/]+)\/(approve|reject|close)$/,
  );
  if (method === "POST" && requestActionMatch) {
    return {
      name: "decideCustomerRequest",
      payload: async (_pathname, init) => ({
        request_id: decodeURIComponent(requestActionMatch[1]),
        action: requestActionMatch[2],
        ...(await readJsonBody(init)),
      }),
    };
  }

  const advanceTaskMatch = pathname.match(
    /^\/api\/warehouse\/tasks\/([^/]+)\/advance$/,
  );
  if (method === "POST" && advanceTaskMatch) {
    return {
      name: "advanceWarehouseTask",
      payload: async (_pathname, init) => ({
        task_uid: decodeURIComponent(advanceTaskMatch[1]),
        ...(await readJsonBody(init)),
      }),
    };
  }

  const exceptionTaskMatch = pathname.match(
    /^\/api\/warehouse\/tasks\/([^/]+)\/exception$/,
  );
  if (method === "POST" && exceptionTaskMatch) {
    return {
      name: "recordWarehouseException",
      status: 201,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          task_uid: decodeURIComponent(exceptionTaskMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const exceptionResolutionMatch = pathname.match(
    /^\/api\/warehouse\/exceptions\/([^/]+)\/(resolve|cancel)$/,
  );
  if (method === "POST" && exceptionResolutionMatch) {
    return {
      name: "resolveWarehouseException",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          exception_id: decodeURIComponent(exceptionResolutionMatch[1]),
          action: exceptionResolutionMatch[2],
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const clientArchiveMatch = pathname.match(/^\/api\/client\/inventory\/([^/]+)\/archive$/);
  if (method === "POST" && clientArchiveMatch) {
    return {
      name: "setClientItemArchived",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          inventory_id: decodeURIComponent(clientArchiveMatch[1]),
          archived: body.archived === true,
        };
      },
    };
  }

  const shipmentCancelMatch = pathname.match(/^\/api\/client\/shipments\/([^/]+)\/cancel$/);
  if (method === "POST" && shipmentCancelMatch) {
    return {
      name: "cancelShipmentNotice",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          request_id: decodeURIComponent(shipmentCancelMatch[1]),
          ...(typeof body.reason === "string" && body.reason.trim() ? { reason: body.reason.trim() } : {}),
        };
      },
    };
  }

  if (method === "GET" && pathname === "/api/system/health") {
    return { name: "getSystemHealth", status: 200, payload: async () => ({}) };
  }

  if (method === "POST" && pathname === "/api/ai/events") {
    return {
      name: "recordOperationalEvent",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/warehouse/receipts") {
    return {
      name: "createInboundReceipt",
      status: 201,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const receiptConferenceMatch = pathname.match(
    /^\/api\/warehouse\/receipts\/([^/]+)\/conference$/,
  );
  if (method === "POST" && receiptConferenceMatch) {
    return {
      name: "updateInboundReceiptConference",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          receipt_id: decodeURIComponent(receiptConferenceMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  if (method === "POST" && pathname === "/api/catalog/photos") {
    return {
      name: "addCatalogPhotos",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  if (method === "POST" && pathname === "/api/movements") {
    return {
      name: "createInventoryMovement",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/warehouse/cycle-counts") {
    return {
      name: "recordCycleCount",
      status: 201,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  if (pathname === "/api/warehouse/opening-inventory/session") {
    if (method === "GET") {
      return {
        name: "getOpeningInventorySession",
        payload: async () => ({ customer_code: "BTG Pactual" }),
      };
    }
    if (method === "POST") {
      return {
        name: "createOpeningInventorySession",
        status: 201,
        payload: async (_pathname, init) => {
          const body = await readJsonBody(init);
          return {
            ...body,
            idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
          };
        },
      };
    }
  }

  if (
    method === "POST" &&
    pathname === "/api/warehouse/opening-inventory/session/complete"
  ) {
    return {
      name: "completeOpeningInventorySession",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const openingInventoryLineRemovalMatch = pathname.match(
    /^\/api\/warehouse\/opening-inventory\/lines\/([^/]+)\/remove$/,
  );
  if (method === "POST" && openingInventoryLineRemovalMatch) {
    return {
      name: "removeOpeningInventoryLine",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          opening_line_id: decodeURIComponent(
            openingInventoryLineRemovalMatch[1],
          ),
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  if (method === "POST" && pathname === "/api/warehouse/returns") {
    return {
      name: "createReturnReceipt",
      status: 201,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const returnDispositionMatch = pathname.match(
    /^\/api\/warehouse\/returns\/items\/([^/]+)\/disposition$/,
  );
  if (method === "POST" && returnDispositionMatch) {
    return {
      name: "setReturnDisposition",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          return_item_id: decodeURIComponent(returnDispositionMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  if (method === "POST" && pathname === "/api/agent-dute/chat") {
    return {
      name: "chatWithAgentDute",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/agent-dute/notifications/sync") {
    return {
      name: "syncOperationalNotifications",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  const notificationActionMatch = pathname.match(
    /^\/api\/agent-dute\/notifications\/([^/]+)\/(approve|archive|mark-sent)$/,
  );
  if (method === "POST" && notificationActionMatch) {
    return {
      name: "decideOperationalNotification",
      payload: async (_pathname, init) => ({
        notification_id: decodeURIComponent(notificationActionMatch[1]),
        action:
          notificationActionMatch[2] === "mark-sent"
            ? "mark_sent"
            : notificationActionMatch[2],
        ...(await readJsonBody(init)),
      }),
    };
  }

  if (method === "POST" && pathname === "/api/documents/upload-target") {
    return {
      name: "createDocumentUploadTarget",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/products/photo-upload-target") {
    return {
      name: "createProductPhotoUploadTarget",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  const documentReviewMatch = pathname.match(/^\/api\/documents\/([^/]+)\/review$/);
  if (method === "POST" && documentReviewMatch) {
    return {
      name: "reviewOperationalDocument",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          document_id: decodeURIComponent(documentReviewMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const documentExtractMatch = pathname.match(/^\/api\/documents\/([^/]+)\/extract$/);
  if (method === "POST" && documentExtractMatch) {
    return {
      name: "extractOperationalDocumentContent",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          document_id: decodeURIComponent(documentExtractMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const documentKnowledgeMatch = pathname.match(
    /^\/api\/documents\/([^/]+)\/knowledge\/(approve|reject)$/,
  );
  if (method === "POST" && documentKnowledgeMatch) {
    return {
      name: "approveDocumentKnowledge",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          document_id: decodeURIComponent(documentKnowledgeMatch[1]),
          action: documentKnowledgeMatch[2],
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const documentOperationalActionMatch = pathname.match(
    /^\/api\/documents\/([^/]+)\/operational-action$/,
  );
  if (method === "POST" && documentOperationalActionMatch) {
    return {
      name: "applyDocumentOperationalAction",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          document_id: decodeURIComponent(documentOperationalActionMatch[1]),
          ...body,
          idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
        };
      },
    };
  }

  const managedEntityMatch = pathname.match(
    /^\/api\/(products|skus|billing\/price-list|customers|customer-accounts|documents)(?:\/([^/]+))?$/,
  );
  if (managedEntityMatch) {
    const resource = managedEntityMatch[1].replace(
      "billing/price-list",
      "billing_price_list",
    ).replace("customer-accounts", "customer_accounts");
    const id = managedEntityMatch[2]
      ? decodeURIComponent(managedEntityMatch[2])
      : undefined;
    const action =
      method === "POST"
        ? "create"
        : method === "DELETE"
          ? "archive"
          : method === "PATCH" || method === "PUT"
            ? "update"
            : null;
    if (action) {
      return {
        name: "mutateManagedEntity",
        status: action === "create" ? 201 : 200,
        payload: async (_pathname, init) =>
          mutationPayload(resource, action, await readJsonBody(init), id),
      };
    }
  }

  if (
    pathname === "/api/billing/config" &&
    (method === "PATCH" || method === "PUT")
  ) {
    return {
      name: "mutateManagedEntity",
      payload: async (_pathname, init) =>
        mutationPayload(
          "billing_config",
          "update",
          await readJsonBody(init),
          "default",
        ),
    };
  }

  const inboxMatch = pathname.match(/^\/api\/ai\/inbox\/([^/]+)$/);
  if (inboxMatch && (method === "PATCH" || method === "PUT")) {
    return {
      name: "mutateManagedEntity",
      payload: async () =>
        mutationPayload(
          "ai_agent_inbox",
          "resolve",
          {},
          decodeURIComponent(inboxMatch[1]),
        ),
    };
  }

  const accessMatch = pathname.match(/^\/api\/billing\/users\/([^/]+)\/access$/);
  if (accessMatch && method === "POST") {
    return {
      name: "setUserAccess",
      payload: async (_pathname, init) => ({
        ...(await readJsonBody(init)),
        user_id: decodeURIComponent(accessMatch[1]),
      }),
    };
  }

  const roleMatch = pathname.match(/^\/api\/billing\/users\/([^/]+)\/role$/);
  if (roleMatch && method === "PATCH") {
    return {
      name: "mutateManagedEntity",
      payload: async (_pathname, init) =>
        mutationPayload(
          "users",
          "set_role",
          await readJsonBody(init),
          decodeURIComponent(roleMatch[1]),
        ),
    };
  }

  if (pathname === "/api/invites" && method === "POST") {
    return {
      name: "mutateManagedEntity",
      status: 201,
      payload: async (_pathname, init) =>
        mutationPayload("invites", "create", await readJsonBody(init)),
    };
  }

  const inviteMatch = pathname.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteMatch && method === "DELETE") {
    return {
      name: "mutateManagedEntity",
      payload: async () =>
        mutationPayload(
          "invites",
          "archive",
          {},
          decodeURIComponent(inviteMatch[1]),
        ),
    };
  }

  // Prévia da competência: o mesmo cálculo da emissão, no servidor.
  const billingPreviewMatch = pathname.match(
    /^\/api\/billing\/periods\/(\d{4}-\d{2})$/,
  );
  if (billingPreviewMatch && method === "GET") {
    const competencia = billingPreviewMatch[1];
    return {
      name: "getBillingPreview",
      payload: async () => ({ competencia }),
    };
  }

  const billingPeriodMatch = pathname.match(
    /^\/api\/billing\/periods\/([^/]+)\/(manual|emit|pay)$/,
  );
  if (billingPeriodMatch) {
    const competencia = decodeURIComponent(billingPeriodMatch[1]);
    const action = billingPeriodMatch[2];
    if (method === "PUT" && action === "manual") {
      return {
        name: "saveBillingManual",
        payload: async (_pathname, init) => {
          const body = await readJsonBody(init);
          return {
            competencia,
            ...body,
            idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
          };
        },
      };
    }
    if (method === "POST" && action === "emit") {
      return {
        name: "emitBillingInvoice",
        payload: async () => ({ competencia }),
      };
    }
    if (method === "POST" && action === "pay") {
      return {
        name: "payBillingInvoice",
        payload: async () => ({ competencia }),
      };
    }
  }

  return null;
}

const FUNCTIONS_ERROR_STATUS: Record<string, number> = {
  "invalid-argument": 400,
  "failed-precondition": 400,
  "out-of-range": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  aborted: 409,
  "already-exists": 409,
  "resource-exhausted": 429,
  unimplemented: 501,
  unavailable: 503,
  "deadline-exceeded": 504,
};

function functionsErrorStatus(error: unknown) {
  const rawCode =
    typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code)
      : "";
  const code = rawCode.replace(/^functions\//, "");
  return { code, status: FUNCTIONS_ERROR_STATUS[code] ?? 500 };
}

/**
 * Toda rota de /api/* que possui backend em Cloud Functions é atendida
 * exclusivamente por ele — sem gate de build (VITE_API_MODE) e sem fallback
 * client-side. Retorna null apenas quando não existe rota de função, caso em
 * que o chamador decide o que fazer com a requisição.
 */
export async function callFunctionsApi(
  pathname: string,
  method: string,
  init?: RequestInit,
) {
  if (!firebaseApp) return null;
  const route = functionRoute(pathname, method);
  if (!route) return null;

  try {
    const callable = httpsCallable(
      getFunctions(firebaseApp, "southamerica-east1"),
      route.name,
    );
    const result = await callable(await route.payload(pathname, init));
    return response(result.data, route.status ?? 200);
  } catch (error) {
    const { code, status } = functionsErrorStatus(error);
    const rawMessage =
      error instanceof Error
        ? error.message
        : "Erro ao chamar Firebase Functions.";
    const message =
      rawMessage === "INTERNAL" || code === "internal"
        ? "Falha interna no servidor. Tente novamente ou avise o time técnico."
        : rawMessage;
    return response(compactError({ message, code }), status);
  }
}

function compactError(body: { message: string; code?: string }) {
  return body.code ? body : { message: body.message };
}

/** Pedaço que o chatWithAgentDute envia enquanto escreve a resposta. */
export type AgentDuteStreamChunk =
  | { type: "text"; index: number; text: string }
  | { type: "tool"; name: string }
  | { type: "reset" };

/**
 * Conversa com o Agent Dute recebendo a resposta aos pedaços. Devolve o
 * mesmo resultado da chamada comum (conversa e as duas mensagens gravadas).
 */
export async function streamAgentDuteChat<T>(
  payload: { message: string; conversation_id?: string },
  onChunk: (chunk: AgentDuteStreamChunk) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<typeof payload, T, AgentDuteStreamChunk>(
    getFunctions(firebaseApp, "southamerica-east1"),
    "chatWithAgentDute",
    { timeout: 180_000 },
  );
  try {
    const { stream, data } = await callable.stream(payload, { signal });
    for await (const chunk of stream) onChunk(chunk);
    return await data;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    throw new Error(
      !rawMessage || rawMessage === "INTERNAL"
        ? "O Agent Dute não respondeu agora. Tente de novo em instantes."
        : rawMessage,
    );
  }
}
