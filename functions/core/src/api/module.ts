import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { agenteLiberado } from "../domain/liberacao.js";
import { PLAYBOOKS_COLLECTION, saveDutePlaybookFor } from "../domain/agente-revisao.js";
import { ROUTINES_COLLECTION, saveDuteRoutineFor } from "../domain/agente-rotinas.js";
import { denied, invalid, object, readPage, requireCustomer, requireScope, type ApiContext, type ApiRequest, type ModuleDefinition, type ModuleRoute } from "./shared/core.js";

const playbookFields = ["customer_code", "title", "when", "steps", "open_points", "audience", "status"] as const;
const routineFields = ["customer_code", "modulo", "name", "prompt", "frequency", "days", "day_of_month", "time", "active"] as const;
const routineInput = ["customer_code", "modulo", "name", "prompt", "frequency", "days", "day_of_month", "time", "active"];
const playbookInput = ["customer_code", "title", "when", "steps", "open_points", "audience"];
type Resource = "playbooks" | "rotinas";
const collection = (resource: Resource) => resource === "playbooks" ? PLAYBOOKS_COLLECTION : ROUTINES_COLLECTION;
const ownerField = (resource: Resource) => resource === "playbooks" ? "created_by.uid" : "user_id";
function identity(ctx: ApiContext) {
  if (ctx.actor.uid !== `api:${ctx.integration.id}` || ctx.actor.role !== "interno") denied();
  return { uid: ctx.actor.uid, role: "interno" as const, name: ctx.actor.name };
}
function moduleAccess(ctx: ApiContext, modulo: unknown) {
  if (modulo !== "wms" && modulo !== "operacao") denied("Rotinas da API atendem Armazenagem e Operação.");
  requireScope(ctx, modulo === "wms" ? "armazenagem:ler" : "operacao:ler");
}
/** Somente valores escalares documentados; objetos aninhados nunca atravessam a projeção. */
function version(data: Record<string, unknown>): string | null {
  const timestamp = data.updated_at as { seconds?: unknown; nanoseconds?: unknown } | undefined;
  return typeof timestamp?.seconds === "number" && typeof timestamp.nanoseconds === "number" ? `${timestamp.seconds}:${timestamp.nanoseconds}` : null;
}
/** O CAS acontece no mesmo transaction.get que o domínio usa antes de escrever. */
function withVersion(ctx: ApiContext, resource: Resource, id: string, expected: string, customer: unknown): Firestore {
  return new Proxy(ctx.db, { get(target, property) {
    if (property === "runTransaction") return <T>(work: (transaction: Transaction) => Promise<T>) => target.runTransaction((transaction) => work(new Proxy(transaction, { get(tx, name) {
      if (name === "get") return async (ref: { path?: string }, ...args: unknown[]) => {
        const snapshot = await Reflect.apply(tx.get, tx, [ref, ...args]);
        if (ref.path === `${collection(resource)}/${id}`) {
          const data = snapshot.data() as Record<string, unknown> | undefined;
          const owner = resource === "rotinas" ? data?.user_id : (data?.created_by as Record<string, unknown> | undefined)?.uid;
          if (!data || data.customer_code !== customer || owner !== ctx.actor.uid) throw new HttpsError("not-found", "Registro não encontrado.");
          if (version(data) !== expected) throw new HttpsError("aborted", "O registro foi alterado. Consulte novamente antes de editar.");
        }
        return snapshot;
      };
      const value = Reflect.get(tx, name, tx); return typeof value === "function" ? value.bind(tx) : value;
    } })));
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
function projected(resource: Resource, data: Record<string, unknown>) {
  const result: Record<string, unknown> = { version: version(data) };
  for (const key of ["id", ...(resource === "playbooks" ? playbookFields : routineFields)]) {
    const value = data[key];
    if (key === "steps" || key === "open_points") result[key] = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    else if (key === "days") result[key] = Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v) && v >= 0 && v <= 6) : [];
    else if (key === "active") result[key] = value === true;
    else if (key === "day_of_month") result[key] = typeof value === "number" && Number.isInteger(value) ? value : null;
    else if (typeof value === "string") result[key] = value;
  }
  return result;
}
async function owned(ctx: ApiContext, resource: Resource, id: string, customer: unknown) {
  identity(ctx);
  requireCustomer(ctx, customer);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) invalid("Identificador inválido.");
  const doc = await ctx.db.collection(collection(resource)).doc(id).get();
  const data = doc.data();
  const owner = resource === "rotinas" ? data?.user_id : (data?.created_by as Record<string, unknown> | undefined)?.uid;
  if (!data || data.customer_code !== customer || owner !== ctx.actor.uid) throw new HttpsError("not-found", "Registro não encontrado.");
  if (resource === "rotinas") moduleAccess(ctx, data.modulo);
  return { ...data, id: doc.id };
}
function routes(resource: Resource): ModuleRoute[] {
  const prefix = `/api/v1/agente/${resource}`;
  const read: ModuleRoute = { method: "GET", path: prefix, scope: "agente:ler", role: "interno", summary: `Listar ${resource} da integração`, async run(ctx, _, request) {
    identity(ctx); requireScope(ctx, "agente:ler");
    const page = await readPage(ctx, collection(resource), [...(resource === "playbooks" ? playbookFields : routineFields), "updated_at"], request, { customerField: "customer_code", ownerField: ownerField(resource) });
    return { ...page, data: page.data.filter((row) => {
      if (resource !== "rotinas") return true;
      const modulo = (row as Record<string, unknown>).modulo;
      return (modulo === "wms" && ctx.integration.scopes.includes("armazenagem:ler")) || (modulo === "operacao" && ctx.integration.scopes.includes("operacao:ler"));
    }).map((row) => projected(resource, row)) };
  } };
  const detail: ModuleRoute = { ...read, path: `${prefix}/{id}`, summary: `Consultar ${resource} da integração`, async run(ctx, params, request) {
    requireScope(ctx, "agente:ler");
    if (Object.keys(request.query).some((key) => key !== "customer_code")) invalid("Filtro disponível: customer_code.");
    return { data: projected(resource, await owned(ctx, resource, params.id, request.query.customer_code)) };
  } };
  const save = async (ctx: ApiContext, params: Record<string, string>, request: ApiRequest) => {
    const caller = identity(ctx);
    requireScope(ctx, resource === "playbooks" ? "agente:playbooks:gravar" : "agente:rotinas:gravar");
    const body = object(request.body);
    requireCustomer(ctx, body.customer_code);
    if (Object.keys(body).some((key) => ![...(resource === "playbooks" ? playbookInput : routineInput), ...(params.id ? ["expected_version"] : [])].includes(key))) invalid("Campo não permitido.");
    if (params.id) {
      if (typeof body.expected_version !== "string" || !/^\d+:\d+$/.test(body.expected_version)) invalid("Informe expected_version da consulta anterior.");
      await owned(ctx, resource, params.id, body.customer_code);
    }
    const { expected_version, ...content } = body;
    const db = params.id ? withVersion(ctx, resource, params.id, expected_version as string, body.customer_code) : ctx.db;
    if (resource === "playbooks") return saveDutePlaybookFor(db, caller, { ...content, ...(params.id ? { id: params.id } : {}), idempotency_key: ctx.idempotencyKey });
    // Cadastrar não autoriza executar um modelo; a API só persiste rotinas pausadas.
    if (body.active !== false) invalid("Rotinas da API devem ser cadastradas pausadas (active: false).");
    moduleAccess(ctx, body.modulo);
    return saveDuteRoutineFor(db, caller, { ...content, ...(params.id ? { id: params.id } : {}), active: false });
  };
  return [read, detail, { method: "POST", path: prefix, scope: resource === "playbooks" ? "agente:playbooks:gravar" : "agente:rotinas:gravar", role: "interno", summary: `Criar ${resource}`, run: save }, { method: "PATCH", path: `${prefix}/{id}`, scope: resource === "playbooks" ? "agente:playbooks:gravar" : "agente:rotinas:gravar", role: "interno", summary: `Alterar ${resource} da integração`, run: save }];
}
export const agenteApi: ModuleDefinition = { module: "agente", released: agenteLiberado, routes: [...routes("playbooks"), ...routes("rotinas")] };
