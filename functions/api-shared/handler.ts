import { randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { personalKeyDetails, authorizePersonalRoute } from "./principal.js";
import { API_SCOPES, type WritePolicy } from "./permissions.js";
import { digest, denied, invalid, object, requireScope, type ApiContext, type ApiIntegration, type ApiRequest, type ApiResponse, type ModuleDefinition, type ModuleRoute, type VerifyHuman } from "./core.js";

export function policyOf(value: unknown): WritePolicy {
  if (value === undefined || value === "approval_required") return "approval_required";
  if (value === "scoped") return "scoped";
  return denied("Política de escrita inválida.");
}

async function responsible(db: Firestore, uid: unknown) {
  if (typeof uid !== "string" || !uid || uid.includes("/")) denied("Responsável inválido.");
  const user = (await db.collection("users").doc(uid).get()).data();
  if (!user || user.access_disabled === true || !["owner", "admin"].includes(user.role)) denied("O responsável pela integração perdeu o acesso.");
  return uid;
}

async function load(db: Firestore, id: string): Promise<ApiIntegration> {
  if (!/^[a-f0-9]{32}$/.test(id)) invalid("Integração inválida.");
  const data = (await db.collection("api_integrations").doc(id).get()).data();
  if (!data || data.revoked === true || typeof data.expires_at_ms !== "number" || data.expires_at_ms <= Date.now()) throw new HttpsError("unauthenticated", "Credencial revogada ou expirada.");
  if (!Array.isArray(data.scopes) || data.scopes.some((scope: unknown) => !API_SCOPES.includes(scope as typeof API_SCOPES[number])) || !Array.isArray(data.customers) || data.customers.some((code: unknown) => typeof code !== "string" || !code || code.includes("/") || code === "*")) denied("Configuração da integração inválida.");
  if (data.kind !== undefined && data.kind !== "personal") denied("Tipo de chave inválido.");
  if (data.kind === "personal") return { id, delegated_by: data.delegated_by, write_policy: "scoped", ...await personalKeyDetails(db, data) };
  await responsible(db, data.delegated_by);
  return { id, delegated_by: data.delegated_by, scopes: data.scopes, customers: data.customers, write_policy: policyOf(data.write_policy) };
}

async function authenticate(db: Firestore, token: string): Promise<ApiIntegration> {
  const match = /^dute_([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw new HttpsError("unauthenticated", "Credencial de integração inválida.");
  const ref = db.collection("api_integrations").doc(match[1]);
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const stored = typeof data?.token_hash === "string" && /^[a-f0-9]{64}$/.test(data.token_hash) ? data.token_hash : "0".repeat(64);
    // digest hashes structured JSON; credential hashes are raw SHA256, as in v1.
    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256").update(token).digest("hex");
    if (!data || !timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(actual, "hex")) || data.revoked === true || typeof data.expires_at_ms !== "number" || data.expires_at_ms <= Date.now()) throw new HttpsError("unauthenticated", "Credencial inválida, revogada ou expirada.");
    const window = Math.floor(Date.now() / 60000);
    const count = data.rate_window === window ? Number(data.rate_count) || 0 : 0;
    if (count >= 60) throw new HttpsError("resource-exhausted", "Limite de 60 chamadas por minuto.");
    tx.update(ref, { rate_window: window, rate_count: count + 1, ...(data.kind === "personal" ? { last_used_at_ms: Date.now() } : {}) });
  });
  return load(db, match[1]);
}

export function matchRoute(definition: ModuleDefinition, method: string, path: string): { route: ModuleRoute; params: Record<string, string> } | null {
  for (const route of definition.routes) {
    if (route.method !== method) continue;
    const names: string[] = [];
    const expression = route.path.split("/").map((part) => {
      const variable = /^\{([a-z_]+)\}$/.exec(part);
      if (variable) { names.push(variable[1]); return "([^/]+)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("/");
    const match = new RegExp(`^${expression}$`).exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (let n = 0; n < names.length; n++) {
      let value: string;
      try { value = decodeURIComponent(match[n + 1]); } catch { invalid("Identificador inválido."); }
      if (!value || value.length > 200 || value === "." || value === ".." || /[\x00-\x1f/\\]/.test(value)) invalid("Identificador inválido.");
      params[names[n]] = value;
    }
    return { route, params };
  }
  return null;
}

function keyOf(request: ApiRequest) {
  const key = request.headers["idempotency-key"] ?? "";
  if (!/^[\x21-\x7e]{1,200}$/.test(key)) invalid("Informe Idempotency-Key (1 a 200 caracteres sem espaços).");
  return key;
}
function approvalHash(integration: string, method: string, path: string, key: string, body: unknown) {
  return digest({ integration, method, path, key, body });
}
export function publicFailure(error: unknown) {
  const statuses: Record<string, number> = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "already-exists": 409, aborted: 409, "failed-precondition": 412, "resource-exhausted": 429, unavailable: 503 };
  if (error instanceof HttpsError && statuses[error.code]) return { status: statuses[error.code], code: error.code, message: error.message };
  return { status: 500, code: "internal", message: "Falha interna. Informe o request_id ao suporte." };
}

export function createModuleHandler(db: Firestore, project: string, verify: VerifyHuman, definition: ModuleDefinition) {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    const request_id = randomUUID();
    let status = 500;
    let audited = false;
    const audit = db.collection("api_audit").doc(request_id);
    try {
      if (!definition.released(project)) throw new HttpsError("failed-precondition", "Módulo indisponível neste ambiente.");
      if (Buffer.byteLength(JSON.stringify(request.body ?? null)) > 65536) invalid("O corpo passa de 64 KiB.");
      const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? "");
      if (!bearer) throw new HttpsError("unauthenticated", "Informe uma credencial Bearer válida.");
      const approvalRoute = /^\/api\/v1\/integrations\/([a-f0-9]{32})\/approvals$/.exec(request.path);
      if (approvalRoute && request.method === "POST") {
        if (bearer[1].startsWith("dute_")) throw new HttpsError("unauthenticated", "Aprovação exige o login humano.");
        let uid: string;
        try { uid = (await verify(bearer[1])).uid; } catch { throw new HttpsError("unauthenticated", "Login inválido ou expirado."); }
        await responsible(db, uid);
        const input = object(request.body);
        if (Object.keys(input).some((name) => !["method", "path", "body", "idempotency_key"].includes(name)) || !["POST", "PATCH"].includes(String(input.method)) || typeof input.path !== "string" || input.path.length > 200 || typeof input.idempotency_key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(input.idempotency_key)) invalid("Informe method, path, body e idempotency_key da ação exata.");
        object(input.body);
        const match = matchRoute(definition, String(input.method), input.path);
        if (!match) invalid("Ação indisponível neste módulo.");
        const integration = await load(db, approvalRoute[1]);
        if (integration.kind === "personal") denied("Chaves pessoais não usam aprovações de integração.");
        requireScope({ integration }, match.route.scope);
        await audit.create({ request_id, actor_uid: uid, integration_id: integration.id, action: "integration_approval", module: definition.module, status: 0, created_at: FieldValue.serverTimestamp() });
        audited = true;
        const id = randomUUID(); const expires_at_ms = Date.now() + 15 * 60000;
        await db.collection("api_approvals").doc(id).create({ integration_id: integration.id, digest: approvalHash(integration.id, String(input.method), input.path, input.idempotency_key, input.body), target: input.path, approved_by: uid, expires_at_ms, created_at: FieldValue.serverTimestamp() });
        status = 201;
        return { status, body: { data: { id, expires_at: new Date(expires_at_ms).toISOString() }, request_id } };
      }
      const match = matchRoute(definition, request.method, request.path);
      if (!match) throw new HttpsError("not-found", "Endpoint não encontrado.");
      const integration = await authenticate(db, bearer[1]);
      const context: ApiContext = { db, project, integration, actor: { uid: `api:${integration.id}`, role: integration.principal?.role ?? match.route.role, name: integration.principal?.name ?? `Integração ${integration.id}`, ...(integration.principal?.customer_code ? { customer_code: integration.principal.customer_code, customerCode: integration.principal.customer_code } : {}) }, idempotencyKey: "" };
      await audit.create({ request_id, integration_id: integration.id, actor_uid: context.actor.uid, authorized_by: integration.delegated_by, ...(integration.kind === "personal" ? { user_uid: integration.delegated_by } : {}), write_policy: integration.write_policy, module: definition.module, route: match.route.path, method: request.method, status: 0, created_at: FieldValue.serverTimestamp() });
      audited = true;
      requireScope({ integration }, match.route.scope);
      if (integration.principal) authorizePersonalRoute(integration.principal, request.method, request.path, match.route.scope, request.body);
      if (request.method === "GET") {
        const result = object(await match.route.run(context, match.params, request));
        status = 200; return { status, body: { ...result, request_id } };
      }
      const key = keyOf(request);
      if (integration.write_policy === "approval_required") {
        const id = request.headers["x-approval-id"] ?? "";
        if (!/^[a-f0-9-]{36}$/.test(id)) denied("Esta chave exige aprovação humana em X-Approval-Id.");
        const approval = (await db.collection("api_approvals").doc(id).get()).data();
        if (!approval || approval.integration_id !== integration.id || approval.expires_at_ms <= Date.now() || approval.target !== request.path || approval.digest !== approvalHash(integration.id, request.method, request.path, key, request.body)) denied("Aprovação ausente, expirada ou diferente desta ação.");
        await responsible(db, approval.approved_by);
        await audit.update({ approved_by: approval.approved_by, approval_id: id });
      }
      context.idempotencyKey = `api_${digest({ integration: integration.id, method: request.method, path: request.path, key })}`;
      if (integration.principal && match.route.authorize) await match.route.authorize(context, match.params, request);
      const ref = db.collection("api_receipts").doc(context.idempotencyKey);
      const fingerprint = digest({ body: request.body ?? null, query: request.query });
      const replay = await db.runTransaction(async (tx) => {
        const previous = (await tx.get(ref)).data();
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new HttpsError("already-exists", "Idempotency-Key já usada com outro conteúdo.");
          if (previous.state === "done") return previous.result;
          if (previous.state === "failed") throw new HttpsError(previous.error_code ?? "failed-precondition", previous.error_message ?? "A operação anterior falhou.");
          throw new HttpsError("aborted", "Operação anterior ainda pendente ou com resultado incerto. Consulte os dados e informe o request_id ao suporte; não gere outra chave para repetir às cegas.");
        }
        tx.create(ref, { integration_id: integration.id, fingerprint, state: "processing", request_id, created_at: FieldValue.serverTimestamp() });
        return undefined;
      });
      if (replay !== undefined) { status = 200; return { status, body: { data: replay, replayed: true, request_id } }; }
      try {
        const result = await match.route.run(context, match.params, request);
        await ref.update({ state: "done", result, completed_at: FieldValue.serverTimestamp() });
        status = request.method === "POST" ? 201 : 200;
        return { status, body: { data: result, request_id } };
      } catch (error) {
        const failure = publicFailure(error);
        // Unknown failures can follow a committed effect: keep the receipt uncertain.
        if (failure.status < 500) await ref.update({ state: "failed", error_code: failure.code, error_message: failure.message });
        throw error;
      }
    } catch (error) {
      const failure = publicFailure(error); status = failure.status;
      return { status, body: { error: { code: failure.code, message: failure.message }, request_id } };
    } finally {
      if (audited) await audit.update({ status, completed_at: FieldValue.serverTimestamp() });
    }
  };
}

type HttpRequest = { method: string; path: string; query: Record<string, unknown>; body: unknown; rawBody?: { byteLength: number }; get(name: string): string | undefined; is(type: string): string | false | null };
type HttpResponse = { set(name: string, value: string): unknown; status(code: number): { json(value: unknown): unknown } };
export function httpModuleHandler(handler: (request: ApiRequest) => Promise<ApiResponse>) {
  return async (request: HttpRequest, response: HttpResponse): Promise<void> => {
    response.set("Cache-Control", "no-store"); response.set("X-Content-Type-Options", "nosniff");
    if ((request.rawBody?.byteLength ?? 0) > 65536) { response.status(413).json({ error: { code: "invalid-argument", message: "O corpo passa de 64 KiB." } }); return; }
    if (["POST", "PATCH"].includes(request.method) && !request.is("application/json")) { response.status(415).json({ error: { code: "invalid-argument", message: "Use Content-Type: application/json." } }); return; }
    try {
      const result = await handler({ method: request.method, path: request.path, query: request.query, body: request.body, headers: { authorization: request.get("authorization"), "idempotency-key": request.get("idempotency-key"), "x-approval-id": request.get("x-approval-id") } });
      if (typeof result.body.request_id === "string") response.set("X-Request-Id", result.body.request_id);
      if (result.status === 429) response.set("Retry-After", "60");
      response.status(result.status).json(result.body);
    } catch { response.status(503).json({ error: { code: "unavailable", message: "API indisponível. Repita somente com a mesma Idempotency-Key." } }); }
  };
}
