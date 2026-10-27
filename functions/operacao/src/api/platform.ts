import { HttpsError } from "firebase-functions/https";
import type { ApiRequest, ApiResponse } from "./handler.js";

const SERVICES: Record<string, string> = {
  armazenagem: "duteArmazenagemApi", comercial: "duteComercialApi", financeiro: "duteFinanceiroApi", rh: "duteRhApi", agente: "duteAgenteApi",
};
export function platformModule(request: ApiRequest): string | null {
  const path = /^\/api\/v1\/integrations\/[a-f0-9]{32}\/approvals$/.test(request.path) && request.method === "POST"
    ? (request.body as { path?: unknown } | undefined)?.path : request.path;
  if (typeof path !== "string") return null;
  const name = /^\/api\/v1\/([a-z]+)\//.exec(path)?.[1];
  return name && SERVICES[name] ? name : null;
}

/** Destinos fixos do próprio projeto; nunca encaminha cookie ou token a URL do consumidor. */
export async function forwardPlatform(project: string, module: string, request: ApiRequest): Promise<ApiResponse> {
  const service = SERVICES[module];
  if (!service || !["dute-prod", "dute-homolog"].includes(project)) throw new HttpsError("failed-precondition", "API indisponível neste ambiente.");
  // URL normaliza dot-segments antes do fetch. Valide também formas codificadas
  // e não permita que um caminho saia do serviço fixo levando Authorization.
  const segments = request.path.split("/");
  for (const segment of segments.slice(1)) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { throw new HttpsError("invalid-argument", "Caminho inválido."); }
    if (!decoded || decoded === "." || decoded === ".." || /[%\\/\x00-\x20?#]/.test(decoded)) throw new HttpsError("invalid-argument", "Caminho inválido.");
  }
  if (platformModule(request) !== module) throw new HttpsError("invalid-argument", "Caminho inválido.");
  const url = new URL(`https://southamerica-east1-${project}.cloudfunctions.net/${service}${request.path}`);
  if (!url.pathname.startsWith(`/${service}/api/v1/`)) throw new HttpsError("invalid-argument", "Caminho inválido.");
  for (const [name, value] of Object.entries(request.query)) {
    if (typeof value !== "string") throw new HttpsError("invalid-argument", "Parâmetro de consulta inválido.");
    url.searchParams.set(name, value);
  }
  const headers: Record<string, string> = {};
  for (const name of ["authorization", "idempotency-key", "x-approval-id"]) if (request.headers[name]) headers[name] = request.headers[name]!;
  if (["POST", "PATCH"].includes(request.method)) headers["content-type"] = "application/json";
  try {
    const response = await fetch(url, { method: request.method, headers, redirect: "error", signal: AbortSignal.timeout(55000), ...(["POST", "PATCH"].includes(request.method) ? { body: JSON.stringify(request.body ?? null) } : {}) });
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid response");
    return { status: response.status, body: body as Record<string, unknown> };
  } catch { throw new HttpsError("unavailable", "Módulo indisponível. Não repita uma gravação com outra Idempotency-Key; confira os dados e o recibo antes."); }
}
