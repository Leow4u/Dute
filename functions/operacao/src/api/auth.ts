import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";
import { loadProfile, type OperacaoProfile } from "../domain/profile.js";
import { SCOPES, denied, invalid, type Scope } from "./contract.js";

export const API_INTEGRATIONS_COLLECTION = "api_integrations";
export const API_APPROVALS_COLLECTION = "api_approvals";
export const API_AUDIT_COLLECTION = "api_audit";
export type Integration = {
  id: string;
  delegated_by: string;
  scopes: Scope[];
  customers: string[];
};
export type VerifyHuman = (token: string) => Promise<{ uid: string }>;
const KEY = /^dute_([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/;
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function bearer(headers: Record<string, string | undefined>): string {
  const match = /^Bearer ([^\s]+)$/.exec(headers.authorization ?? "");
  if (!match)
    throw new HttpsError(
      "unauthenticated",
      "Informe uma credencial Bearer válida.",
    );
  return match[1];
}
export async function humanCaller(
  db: Firestore,
  token: string,
  verify: VerifyHuman,
): Promise<OperacaoProfile> {
  if (token.startsWith("dute_"))
    throw new HttpsError(
      "unauthenticated",
      "A gestão exige o login humano do Firebase.",
    );
  let uid: string;
  try {
    uid = (await verify(token)).uid;
  } catch {
    throw new HttpsError("unauthenticated", "Login inválido ou expirado.");
  }
  const profile = await loadProfile(db, uid);
  if (profile.role !== "owner" && profile.role !== "admin")
    denied("Somente owner/admin gerencia integrações e aprova ações.");
  return profile;
}
export async function delegatedProfile(
  db: Firestore,
  integration: Integration,
): Promise<OperacaoProfile> {
  const profile = await loadProfile(db, integration.delegated_by);
  if (profile.role !== "owner" && profile.role !== "admin")
    denied("O responsável pela integração perdeu a permissão.");
  // The integration gets a distinct audit actor and the minimum operations role,
  // never the owner's administrative role.
  return {
    uid: `api:${integration.id}`,
    role: "interno",
    name: `Integração ${integration.id}`,
  };
}
export async function loadIntegration(
  db: Firestore,
  id: string,
): Promise<Integration> {
  if (!/^[a-f0-9]{32}$/.test(id))
    invalid("Identificador de integração inválido.");
  const snapshot = await db
    .collection(API_INTEGRATIONS_COLLECTION)
    .doc(id)
    .get();
  if (!snapshot.exists)
    throw new HttpsError("not-found", "Integração não encontrada.");
  const data = snapshot.data()!;
  if (
    data.revoked ||
    typeof data.expires_at_ms !== "number" ||
    data.expires_at_ms <= Date.now()
  )
    throw new HttpsError("unauthenticated", "Credencial revogada ou expirada.");
  if (
    !Array.isArray(data.scopes) ||
    data.scopes.some((scope: unknown) => !SCOPES.includes(scope as Scope)) ||
    !Array.isArray(data.customers) ||
    data.customers.some((code: unknown) => typeof code !== "string" || !code)
  )
    denied("Configuração da integração inválida.");
  return {
    id,
    delegated_by: data.delegated_by,
    scopes: data.scopes,
    customers: data.customers,
  };
}
export async function authenticate(
  db: Firestore,
  token: string,
): Promise<Integration> {
  const match = KEY.exec(token);
  if (!match)
    throw new HttpsError(
      "unauthenticated",
      "Credencial de integração inválida.",
    );
  const ref = db.collection(API_INTEGRATIONS_COLLECTION).doc(match[1]);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const expected =
      typeof data?.token_hash === "string" &&
      /^[a-f0-9]{64}$/.test(data.token_hash)
        ? data.token_hash
        : "0".repeat(64);
    if (
      !timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(hash(token), "hex"),
      ) ||
      !data ||
      data.revoked ||
      data.expires_at_ms <= Date.now()
    )
      throw new HttpsError(
        "unauthenticated",
        "Credencial inválida, revogada ou expirada.",
      );
    const window = Math.floor(Date.now() / 60000);
    const count =
      data.rate_window === window ? Number(data.rate_count) || 0 : 0;
    if (count >= 60)
      throw new HttpsError(
        "resource-exhausted",
        "Limite de 60 chamadas por minuto. Tente novamente no próximo minuto.",
      );
    tx.update(ref, { rate_window: window, rate_count: count + 1 });
  });
  const integration = await loadIntegration(db, match[1]);
  await delegatedProfile(db, integration);
  return integration;
}
export function requireScope(integration: Integration, scope: Scope): void {
  if (!integration.scopes.includes(scope)) denied();
}
export function requireCustomer(
  integration: Integration,
  code: unknown,
): asserts code is string {
  if (typeof code !== "string" || !integration.customers.includes(code))
    denied("Cliente fora do acesso desta integração.");
}
const Create = z
  .object({
    name: z.string().trim().min(2).max(80),
    scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
    customers: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((code) => !code.includes("/") && code !== "*"),
      )
      .min(1)
      .max(50),
    expires_in_days: z.number().int().min(1).max(90).default(30),
  })
  .strict();
export async function createIntegration(
  db: Firestore,
  human: OperacaoProfile,
  input: unknown,
) {
  const parsed = Create.safeParse(input);
  if (!parsed.success)
    invalid("Informe name, scopes, customers e expires_in_days (1 a 90 dias).");
  const id = randomBytes(16).toString("hex");
  const token = `dute_${id}.${randomBytes(32).toString("base64url")}`;
  const expires_at_ms = Date.now() + parsed.data.expires_in_days * 86400000;
  await db
    .collection(API_INTEGRATIONS_COLLECTION)
    .doc(id)
    .create({
      name: parsed.data.name,
      scopes: [...new Set(parsed.data.scopes)],
      customers: [...new Set(parsed.data.customers)],
      delegated_by: human.uid,
      token_hash: hash(token),
      expires_at_ms,
      revoked: false,
      created_at: FieldValue.serverTimestamp(),
    });
  return { id, token, expires_at: new Date(expires_at_ms).toISOString() };
}

const List = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().regex(/^[a-f0-9]{32}$/).optional(),
}).strict();

/** Somente metadados; credenciais e contadores não saem do servidor. */
export async function listIntegrations(db: Firestore, input: unknown) {
  const parsed = List.safeParse(input);
  if (!parsed.success) invalid("Informe limit (1 a 100) e cursor válido.");
  const { limit, cursor } = parsed.data;
  let query = db.collection(API_INTEGRATIONS_COLLECTION)
    .select("name", "scopes", "customers", "delegated_by", "expires_at_ms", "revoked")
    .orderBy(FieldPath.documentId()).limit(limit + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, limit);
  return {
    data: docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.name ?? "Integração"),
        scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope: unknown) => SCOPES.includes(scope as Scope)) : [],
        customers: Array.isArray(data.customers) ? data.customers.filter((code: unknown) => typeof code === "string") : [],
        delegated_by: String(data.delegated_by ?? ""),
        expires_at: new Date(data.expires_at_ms).toISOString(),
        revoked: data.revoked === true,
      };
    }),
    next_cursor: snapshot.docs.length > limit ? docs[docs.length - 1].id : null,
  };
}
