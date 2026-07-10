import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "./firebase";

type FunctionRoute = {
  name: string;
  payload: (pathname: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  status?: number;
};

async function readJsonBody(init?: RequestInit): Promise<Record<string, unknown>> {
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

function functionRoute(pathname: string, method: string): FunctionRoute | null {
  if (method === "POST" && pathname === "/api/client/requests") {
    return {
      name: "createCustomerRequest",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
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

  const advanceTaskMatch = pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/advance$/);
  if (method === "POST" && advanceTaskMatch) {
    return {
      name: "advanceWarehouseTask",
      payload: async (_pathname, init) => ({
        task_uid: decodeURIComponent(advanceTaskMatch[1]),
        ...(await readJsonBody(init)),
      }),
    };
  }

  const exceptionTaskMatch = pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/exception$/);
  if (method === "POST" && exceptionTaskMatch) {
    return {
      name: "recordWarehouseException",
      status: 201,
      payload: async (_pathname, init) => ({
        task_uid: decodeURIComponent(exceptionTaskMatch[1]),
        ...(await readJsonBody(init)),
      }),
    };
  }

  if (method === "POST" && pathname === "/api/ai/events") {
    return {
      name: "recordOperationalEvent",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/movements") {
    return {
      name: "createInventoryMovement",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
    };
  }

  if (method === "POST" && pathname === "/api/agent-dute/chat") {
    return {
      name: "chatWithAgentDute",
      status: 201,
      payload: async (_pathname, init) => readJsonBody(init),
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
        payload: async (_pathname, init) => ({
          competencia,
          ...(await readJsonBody(init)),
        }),
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

export function shouldUseFunctionsApi(pathname?: string, method?: string) {
  const isAgentChatWrite =
    method === "POST" && pathname === "/api/agent-dute/chat";
  return (
    (isAgentChatWrite || import.meta.env.VITE_API_MODE === "functions") &&
    Boolean(firebaseApp)
  );
}

export async function callFunctionsApi(
  pathname: string,
  method: string,
  init?: RequestInit,
) {
  if (!firebaseApp) return null;
  const route = functionRoute(pathname, method);
  if (!route) {
    if (method !== "GET" && import.meta.env.VITE_API_MODE === "functions") {
      return response(
        {
          message:
            "Esta alteração exige uma Cloud Function autorizada e não possui rota de backend.",
          code: "FUNCTION_ROUTE_REQUIRED",
        },
        501,
      );
    }
    return null;
  }

  try {
    const callable = httpsCallable(getFunctions(firebaseApp, "southamerica-east1"), route.name);
    const result = await callable(await route.payload(pathname, init));
    return response(result.data, route.status ?? 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao chamar Firebase Functions.";
    return response({ message }, 500);
  }
}
