import { createHash } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import type { ApiScope, WritePolicy } from "./permissions.js";

export type ApiRequest = { method: string; path: string; headers: Record<string, string | undefined>; query: Record<string, unknown>; body?: unknown };
export type ApiResponse = { status: number; body: Record<string, unknown> };
export type ApiIntegration = { id: string; delegated_by: string; scopes: string[]; customers: string[]; write_policy: WritePolicy };
export type ApiActor = { uid: string; role: "wms" | "comercial" | "financeiro" | "rh" | "interno"; name: string };
export type ApiContext = {
  db: Firestore; project: string; integration: ApiIntegration; actor: ApiActor;
  /** Chave já isolada por integração e rota. Passar ao serviço de domínio. */
  idempotencyKey: string;
};
export type ModuleRoute = {
  method: "GET" | "POST" | "PATCH";
  /** Template completo, por exemplo /api/v1/comercial/clientes/{id}. */
  path: string; scope: ApiScope; role: ApiActor["role"]; summary: string;
  run: (context: ApiContext, params: Record<string, string>, request: ApiRequest) => Promise<unknown>;
};
export type ModuleDefinition = { module: string; released: (project: string) => boolean; routes: ModuleRoute[] };
export type VerifyHuman = (token: string) => Promise<{ uid: string }>;

export function invalid(message: string): never { throw new HttpsError("invalid-argument", message); }
export function denied(message = "Integração sem permissão para esta ação."): never { throw new HttpsError("permission-denied", message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Informe um objeto JSON.");
  return value as Record<string, unknown>;
}
export function requireScope(context: Pick<ApiContext, "integration">, scope: string): void {
  if (!context.integration.scopes.includes(scope)) denied();
}
export function requireCustomer(context: Pick<ApiContext, "integration">, code: unknown): asserts code is string {
  if (typeof code !== "string" || !context.integration.customers.includes(code)) denied("Cliente fora do acesso desta integração.");
}
export function digest(value: unknown): string {
  function stable(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)]));
    return input;
  }
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
/** Projeção explícita: nunca espalhar um documento do banco em resposta da API. */
export function projectFields(id: string, data: Record<string, unknown>, fields: readonly string[]) {
  return { id, ...Object.fromEntries(fields.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])) };
}
export async function readPage(context: ApiContext, collection: string, fields: readonly string[], request: ApiRequest, options: { db?: Firestore; customerField?: string; ownerField?: string } = {}) {
  const query = request.query;
  if (Object.keys(query).some((key) => !["customer_code", "limit", "cursor"].includes(key))) invalid("Filtros disponíveis: customer_code, limit e cursor.");
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid("limit deve ser de 1 a 100.");
  const cursor = query.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))) invalid("Cursor inválido.");
  let selection = (options.db ?? context.db).collection(collection).orderBy(FieldPath.documentId());
  if (options.customerField) {
    requireCustomer(context, query.customer_code);
    selection = selection.where(options.customerField, "==", query.customer_code);
  }
  if (options.ownerField) selection = selection.where(options.ownerField, "==", context.actor.uid);
  if (typeof cursor === "string") selection = selection.startAfter(cursor);
  const result = await selection.limit(limit + 1).get();
  const page = result.docs.slice(0, limit);
  return { data: page.map((doc) => projectFields(doc.id, doc.data(), fields)), next_cursor: result.size > limit ? page.at(-1)!.id : null };
}
