import { randomBytes, createHash } from "node:crypto";
import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";
import { API_SCOPES } from "./shared/permissions.js";
import { loadPersonalPrincipal, personalCapabilities, type PersonalPermission } from "./shared/principal.js";
import { policyOf, publicFailure } from "./shared/handler.js";
import type { ApiRequest, ApiResponse } from "./handler.js";
import type { VerifyHuman } from "./auth.js";

const Create = z.object({
  name: z.string().trim().min(2).max(80), permission: z.enum(["full", "read_only", "custom"]),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).optional(),
  expires_in_days: z.number().int().min(1).max(90).default(90),
}).strict();
const Page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict();
function fail(message: string): never { throw new HttpsError("invalid-argument", message); }
const iso = (value: unknown): string | null => {
  const millis = typeof value === "number" ? value : value && typeof (value as { toMillis?: unknown }).toMillis === "function" ? (value as { toMillis(): number }).toMillis() : NaN;
  return Number.isFinite(millis) && Math.abs(millis) < 8640000000000000 ? new Date(millis).toISOString() : null;
};
export async function personalKeyManagement(db: Firestore, verify: VerifyHuman, request: ApiRequest, request_id: string): Promise<ApiResponse> {
  const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? "");
  if (!bearer || bearer[1].startsWith("dute_")) throw new HttpsError("unauthenticated", "Use seu login para gerenciar suas chaves.");
  let uid: string;
  try { uid = (await verify(bearer[1])).uid; } catch { throw new HttpsError("unauthenticated", "Login inválido ou expirado."); }
  const principal = await loadPersonalPrincipal(db, uid);
  const audit = db.collection("api_audit").doc(request_id);
  await audit.create({ request_id, actor_uid: uid, user_uid: uid, action: "personal_key_management", method: request.method, status: 0, created_at: FieldValue.serverTimestamp() });
  let status = 500;
  try {
    if (request.path === "/api/v1/api-keys/capabilities" && request.method === "GET") {
      if (Object.keys(request.query).length) fail("Esta consulta não aceita filtros.");
      status = 200; return { status, body: { data: personalCapabilities(principal), request_id } };
    }
    if (request.path === "/api/v1/api-keys" && request.method === "POST") {
      const parsed = Create.safeParse(request.body);
      if (!parsed.success) fail("Informe nome, permissão e validade de 1 a 90 dias.");
      const input = parsed.data;
      const selected = [...new Set(input.scopes ?? [])];
      if (input.permission === "custom" && !selected.length || input.permission !== "custom" && selected.length) fail("Selecione escopos somente para a permissão personalizada.");
      const capabilities = personalCapabilities(principal);
      if (selected.some(scope => !capabilities.scopes.includes(scope))) throw new HttpsError("permission-denied", "Sua conta não permite os escopos selecionados.");
      const id = randomBytes(16).toString("hex"); const token = `dute_${id}.${randomBytes(32).toString("base64url")}`;
      const expires_at_ms = Date.now() + input.expires_in_days * 86400000;
      await db.collection("api_integrations").doc(id).create({
        kind: "personal", permission: input.permission, name: input.name, delegated_by: uid,
        scopes: selected, customers: [], write_policy: "scoped", token_hash: createHash("sha256").update(token).digest("hex"),
        expires_at_ms, revoked: false, created_at: FieldValue.serverTimestamp(), last_used_at_ms: null,
      });
      await audit.update({ integration_id: id });
      status = 201; return { status, body: { data: { id, token, expires_at: new Date(expires_at_ms).toISOString() }, request_id } };
    }
    if (request.path === "/api/v1/api-keys" && request.method === "GET") {
      const parsed = Page.safeParse(request.query);
      if (!parsed.success) fail("Informe limit (1 a 100) e cursor válido.");
      const { limit, cursor } = parsed.data;
      let query = db.collection("api_integrations").where("delegated_by", "==", uid)
        .select("name", "permission", "kind", "scopes", "created_at", "expires_at_ms", "last_used_at_ms", "revoked", "write_policy")
        .orderBy(FieldPath.documentId()).limit(limit + 1);
      if (cursor) query = query.startAfter(cursor);
      const rows = await query.get(); const page = rows.docs.slice(0, limit);
      const data = page.map(doc => {
        const data = doc.data();
        if (data.kind !== undefined && data.kind !== "personal") throw new HttpsError("permission-denied", "Tipo de chave inválido.");
        const permission: PersonalPermission | "legacy" = data.kind === "personal" ? data.permission : "legacy";
        if (!["full", "read_only", "custom", "legacy"].includes(permission)) throw new HttpsError("permission-denied", "Permissão da chave inválida.");
        return { id: doc.id, name: String(data.name ?? "Chave de API"), token_prefix: `dute_${doc.id.slice(0, 8)}…`, permission,
          scopes: Array.isArray(data.scopes) ? data.scopes.filter(s => API_SCOPES.includes(s)) : [],
          kind: data.kind ?? "legacy", created_at: iso(data.created_at), expires_at: iso(data.expires_at_ms), last_used_at: iso(data.last_used_at_ms),
          revoked: data.revoked === true, write_policy: policyOf(data.write_policy),
        };
      });
      status = 200; return { status, body: { data, next_cursor: rows.size > limit ? page.at(-1)!.id : null, request_id } };
    }
    const match = /^\/api\/v1\/api-keys\/([a-f0-9]{32})$/.exec(request.path);
    if (match && request.method === "DELETE") {
      const ref = db.collection("api_integrations").doc(match[1]);
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        if (!data || data.delegated_by !== uid) throw new HttpsError("not-found", "Chave não encontrada.");
        tx.update(ref, { revoked: true, revoked_by: uid, revoked_at: FieldValue.serverTimestamp() });
      });
      await audit.update({ integration_id: match[1] });
      status = 200; return { status, body: { data: { id: match[1], revoked: true }, request_id } };
    }
    throw new HttpsError("not-found", "Endpoint não encontrado.");
  } catch (error) { status = publicFailure(error).status; throw error; }
  finally { await audit.update({ status, completed_at: FieldValue.serverTimestamp() }); }
}
