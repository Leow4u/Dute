import { httpsCallable } from "firebase/functions";
import { functionsDoApp } from "./firebase-functions";

import { activeCustomerStorageKey, LEGACY_CUSTOMER_CODE } from "./active-customer";
import { firebaseApp, firebaseAuth } from "./firebase";

function billingCustomerCode() {
  try {
    const stored = globalThis.localStorage?.getItem(
      activeCustomerStorageKey(firebaseAuth?.currentUser?.uid),
    );
    const code = stored?.trim();
    if (code) return code;
  } catch {
    // O teste da rota roda sem navegador.
  }
  return LEGACY_CUSTOMER_CODE;
}

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

  // Portal › Eventos: modelos de pedido do cliente (só pelo backend).
  if (method === "GET" && pathname === "/api/client/events") {
    return { name: "listClientEventTemplates", payload: async () => ({}) };
  }
  if (method === "POST" && pathname === "/api/client/events") {
    return { name: "saveClientEventTemplate", payload: async (_pathname, init) => readJsonBody(init) };
  }
  const clientEventArchiveMatch = pathname.match(/^\/api\/client\/events\/([^/]+)\/archive$/);
  if (method === "POST" && clientEventArchiveMatch) {
    return {
      name: "archiveClientEventTemplate",
      payload: async () => ({ id: decodeURIComponent(clientEventArchiveMatch[1]) }),
    };
  }

  if (method === "POST" && pathname === "/api/client/billing/report") {
    return {
      name: "exportBillingReport",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { from: String(body.from ?? ""), to: String(body.to ?? "") };
      },
    };
  }

  if (method === "POST" && pathname === "/api/system/request-numbers") {
    return {
      name: "assignRequestNumbers",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { apply: body.apply === true };
      },
    };
  }

  // Devoluções › o retorno do pedido de saída (parte 4.5d): o pedido vem do caminho, o que voltou do corpo.
  const orderReturnMatch = pathname.match(/^\/api\/orders\/([^/]+)\/return$/);
  if (method === "POST" && orderReturnMatch) {
    return {
      name: "receiveOrderReturn",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          order_id: decodeURIComponent(orderReturnMatch[1]),
          items: Array.isArray(body.items) ? body.items : [],
          ...(typeof body.notes === "string" && body.notes.trim() ? { notes: body.notes.trim() } : {}),
          ...(typeof body.idempotency_key === "string" ? { idempotency_key: body.idempotency_key } : {}),
        };
      },
    };
  }

  // Expedição › a entrega do pedido de saída (parte 4.5a): o pedido vem do caminho, a escolha do corpo.
  const orderDeliveryMatch = pathname.match(/^\/api\/orders\/([^/]+)\/delivery$/);
  if (method === "POST" && orderDeliveryMatch) {
    return {
      name: "setOrderDelivery",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          order_id: decodeURIComponent(orderDeliveryMatch[1]),
          entrega: body.entrega ?? null,
          ...(typeof body.idempotency_key === "string" ? { idempotency_key: body.idempotency_key } : {}),
        };
      },
    };
  }

  const orderCancelMatch = pathname.match(/^\/api\/client\/orders\/([^/]+)\/cancel$/);
  if (method === "POST" && orderCancelMatch) {
    return {
      name: "cancelCustomerOrder",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        const reason = String(body.reason ?? "").trim();
        return { request_id: decodeURIComponent(orderCancelMatch[1]), ...(reason ? { reason } : {}) };
      },
    };
  }

  if (method === "POST" && pathname === "/api/client/shipments/attachments") {
    return {
      name: "uploadShipmentAttachment",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          file_name: String(body.file_name ?? ""),
          content_type: String(body.content_type ?? ""),
          data_base64: String(body.data_base64 ?? ""),
          entity_id: String(body.entity_id ?? ""),
        };
      },
    };
  }

  if (method === "POST" && pathname === "/api/client/shipments/read-invoice") {
    return {
      name: "readShipmentInvoice",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { storage_path: String(body.storage_path ?? ""), content_type: String(body.content_type ?? "") };
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

  // Painel do sistema (só owner): custo e uso do Agent Dute, rotinas e falhas.
  if (method === "GET" && pathname === "/api/system/dashboard") {
    return { name: "getSystemDashboard", payload: async () => ({}) };
  }
  if (method === "POST" && pathname === "/api/system/agent-costs") {
    return { name: "saveAgentCostSettings", payload: async (_pathname, init) => readJsonBody(init) };
  }
  // Infraestrutura (só owner): erros do servidor, functions publicadas, custo real.
  if (method === "GET" && pathname === "/api/system/infra") {
    return { name: "getSystemInfra", payload: async () => ({}) };
  }
  if (method === "POST" && pathname === "/api/system/infra-settings") {
    return { name: "saveSystemInfraSettings", payload: async (_pathname, init) => readJsonBody(init) };
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

  const receiptNoticeMatch = pathname.match(/^\/api\/warehouse\/receipts\/([^/]+)\/notice$/);
  if (method === "POST" && receiptNoticeMatch) {
    return {
      name: "linkInboundNotice",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { ...body, receipt_id: decodeURIComponent(receiptNoticeMatch[1] ?? "") };
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

  if (method === "POST" && pathname === "/api/catalog/photos/manage") {
    return {
      name: "manageCatalogPhotos",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { ...body, idempotency_key: body.idempotency_key ?? crypto.randomUUID() };
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

  // Caixas do armazém: o motor sugere a prateleira, a caixa nasce já guardada.
  if (method === "POST" && pathname === "/api/warehouse/boxes/suggest") {
    return {
      name: "suggestWarehousePosition",
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }
  if (method === "POST" && pathname === "/api/warehouse/boxes") {
    return {
      name: "createWarehouseBox",
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
  const boxRemovalMatch = pathname.match(/^\/api\/warehouse\/boxes\/([^/]+)\/remove$/);
  if (method === "POST" && boxRemovalMatch) {
    return {
      name: "removeWarehouseBox",
      payload: async (_pathname, init) => ({
        ...(await readJsonBody(init)),
        code: decodeURIComponent(boxRemovalMatch[1]!),
      }),
    };
  }

  // Posições do armazém (mapa do galpão): cadastro mantido pelas Functions.
  if (method === "POST" && pathname === "/api/warehouse/positions") {
    return {
      name: "saveWarehousePositions",
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }
  if (method === "POST" && pathname === "/api/warehouse/positions/seed") {
    return {
      name: "seedWarehouseLayout",
      status: 201,
      payload: async () => ({}),
    };
  }
  if (method === "POST" && pathname === "/api/warehouse/positions/aisles") {
    return {
      name: "createWarehouseAislePositions",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }
  const positionRemovalMatch = pathname.match(
    /^\/api\/warehouse\/positions\/([^/]+)\/remove$/,
  );
  if (method === "POST" && positionRemovalMatch) {
    return {
      name: "removeWarehousePosition",
      payload: async () => ({ code: decodeURIComponent(positionRemovalMatch[1]!) }),
    };
  }

  // Sessão de abertura do cliente ativo: o código do cliente vai no caminho.
  const openingSessionMatch = pathname.match(
    /^\/api\/warehouse\/opening-inventory\/session\/([^/]+)$/,
  );
  if (openingSessionMatch && method === "GET") {
    return {
      name: "getOpeningInventorySession",
      payload: async () => ({ customer_code: decodeURIComponent(openingSessionMatch[1]!) }),
    };
  }

  if (pathname === "/api/warehouse/opening-inventory/session") {
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

  if (method === "POST" && pathname === "/api/warehouse/opening-inventory/boxes") {
    return { name: "createOpeningConferenceBox", status: 201, payload: async (_pathname, init) => {
      const body = await readJsonBody(init);
      return { ...body, idempotency_key: body.idempotency_key ?? crypto.randomUUID() };
    } };
  }
  const conferenceBoxMatch = pathname.match(/^\/api\/warehouse\/opening-inventory\/boxes\/([^/]+)\/(read|lines|state|store|resume)$/);
  if (method === "POST" && conferenceBoxMatch) {
    const names: Record<string, string> = {
      read: "getOpeningConferenceBox", lines: "saveOpeningConferenceLine",
      state: "setOpeningConferenceBoxState", store: "storeOpeningConferenceBox", resume: "resumeOpeningConferenceBox",
    };
    return {
      name: names[conferenceBoxMatch[2]]!,
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { ...body, box_code: decodeURIComponent(conferenceBoxMatch[1]),
          ...(["read", "resume"].includes(conferenceBoxMatch[2]) ? {} : { idempotency_key: body.idempotency_key ?? crypto.randomUUID() }) };
      },
    };
  }
  const conferenceLineRemovalMatch = pathname.match(/^\/api\/warehouse\/opening-inventory\/boxes\/([^/]+)\/lines\/([^/]+)\/remove$/);
  if (method === "POST" && conferenceLineRemovalMatch) {
    return {
      name: "removeOpeningConferenceLine",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return { ...body, box_code: decodeURIComponent(conferenceLineRemovalMatch[1]), line_id: decodeURIComponent(conferenceLineRemovalMatch[2]),
          idempotency_key: body.idempotency_key ?? crypto.randomUUID() };
      },
    };
  }

  const openingInventoryLineMoveMatch = pathname.match(
    /^\/api\/warehouse\/opening-inventory\/lines\/([^/]+)\/move$/,
  );
  if (method === "POST" && openingInventoryLineMoveMatch) {
    return {
      name: "moveOpeningInventoryLine",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        return {
          ...body,
          opening_line_id: decodeURIComponent(openingInventoryLineMoveMatch[1]),
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

  // Rotinas do Agent Dute: cada pessoa lista, cria, altera, apaga e roda as suas.
  if (method === "GET" && pathname === "/api/agent-dute/routines") {
    return { name: "listAgentRoutines", payload: async () => ({}) };
  }
  if (method === "POST" && pathname === "/api/agent-dute/routines") {
    return { name: "saveAgentRoutine", payload: async (_pathname, init) => readJsonBody(init) };
  }
  const routineActionMatch = pathname.match(/^\/api\/agent-dute\/routines\/([^/]+)\/(delete|run)$/);
  if (method === "POST" && routineActionMatch) {
    return {
      name: routineActionMatch[2] === "delete" ? "deleteAgentRoutine" : "runAgentRoutineNow",
      payload: async () => ({ id: decodeURIComponent(routineActionMatch[1]!) }),
    };
  }

  // Anotações sugeridas pelo Agent Dute: a coordenação lista e decide.
  // Playbooks do Agent Dute (Conhecimento, só coordenação).
  if (method === "GET" && pathname === "/api/agent-dute/playbooks") {
    return { name: "listAgentPlaybooks", payload: async () => ({}) };
  }
  if (method === "POST" && pathname === "/api/agent-dute/playbooks") {
    return { name: "saveAgentPlaybook", payload: async (_pathname, init) => readJsonBody(init) };
  }
  if (method === "POST" && pathname === "/api/agent-dute/playbooks/seed") {
    return { name: "seedAgentPlaybooks", payload: async () => ({}) };
  }
  const playbookDecisionMatch = pathname.match(/^\/api\/agent-dute\/playbooks\/([^/]+)\/(approve|reject|archive)$/);
  if (method === "POST" && playbookDecisionMatch) {
    return {
      name: "decideAgentPlaybook",
      payload: async () => ({ id: decodeURIComponent(playbookDecisionMatch[1]), action: playbookDecisionMatch[2] }),
    };
  }

  if (method === "GET" && pathname === "/api/agent-dute/notes") {
    return { name: "listAgentNotes", payload: async () => ({}) };
  }

  const noteDecisionMatch = pathname.match(/^\/api\/agent-dute\/notes\/([^/]+)\/(approve|reject|archive)$/);
  if (method === "POST" && noteDecisionMatch) {
    return {
      name: "decideAgentNote",
      payload: async (_pathname, init) => {
        const body = await readJsonBody(init);
        // Só os campos preenchidos: undefined vira null no SDK do Firebase.
        return {
          ...(typeof body.text === "string" && body.text.trim() ? { text: body.text } : {}),
          ...(body.visibility === "equipe" || body.visibility === "todos" ? { visibility: body.visibility } : {}),
          id: decodeURIComponent(noteDecisionMatch[1]),
          action: noteDecisionMatch[2],
        };
      },
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

  if (method === "POST" && pathname === "/api/documents/upload") {
    return {
      name: "uploadOperationalDocument",
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/documents/upload-target") {
    return {
      name: "createDocumentUploadTarget",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/products/generate-photo") {
    return {
      name: "generateCatalogPhoto",
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
      payload: async () => ({
        competencia,
        customer_code: billingCustomerCode(),
      }),
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
            customer_code: billingCustomerCode(),
            ...body,
            idempotency_key: body.idempotency_key ?? crypto.randomUUID(),
          };
        },
      };
    }
    if (method === "POST" && action === "emit") {
      return {
        name: "emitBillingInvoice",
        payload: async () => ({
          competencia,
          customer_code: billingCustomerCode(),
        }),
      };
    }
    if (method === "POST" && action === "pay") {
      return {
        name: "payBillingInvoice",
        payload: async () => ({
          competencia,
          customer_code: billingCustomerCode(),
        }),
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
      functionsDoApp(firebaseApp),
      route.name,
      { timeout: route.name === "generateCatalogPhoto" ? 180_000 : 70_000 },
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
  payload: {
    message: string;
    conversation_id?: string;
    attachments?: Array<{ file_name: string; file_url: string; storage_path: string; content_type: string; size_bytes: number }>;
  },
  onChunk: (chunk: AgentDuteStreamChunk) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!firebaseApp) throw new Error("Firebase não configurado.");
  const callable = httpsCallable<typeof payload, T, AgentDuteStreamChunk>(
    functionsDoApp(firebaseApp),
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
