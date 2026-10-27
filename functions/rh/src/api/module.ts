import { authorizePersonalRoute } from "./shared/principal.js";
import { getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "../domain/banco.js";
import { armazemDoBucket, openRhFileFor } from "../domain/arquivos-gravacao.js";
import { COLLABORATORS_COLLECTION, ID_COLABORADOR, ID_REGISTRO, REGISTROS_COLLECTION } from "../domain/ficha.js";
import { saveRhRecordFor } from "../domain/ficha-gravacao.js";
import { rhLiberado } from "../domain/liberacao.js";
import { saveRhVinculoFor } from "../domain/vinculo-gravacao.js";
import { VINCULOS_COLLECTION } from "../domain/vinculo.js";
import { denied, invalid, object, projectFields, readPage, requireScope, type ApiContext, type ApiRequest, type ModuleDefinition, type ModuleRoute } from "./shared/core.js";

const collaboratorFields = ["nome", "funcao", "vinculo", "ativo", "edicao"] as const;
// Free text, medical results and storage paths never belong to the base scope.
const recordFields = ["colaborador_id", "categoria", "tipo", "emitido_em", "vence_em", "situacao", "substituido_por", "edicao"] as const;
const personalFields = ["nome", "cpf", "telefone"] as const;
const linkFields = ["colaborador_id", "admissao", "desligamento", "edicao"] as const;

function firebaseApp(ctx: ApiContext) {
  // Admin caches its Firestore instances per App/database. Recover the App
  // from the actual default DB, without relying on unsupported db.app fields.
  const app = getApps().find((candidate) => getFirestore(candidate) === ctx.db);
  if (!app) throw new HttpsError("failed-precondition", "Banco padrão não vinculado a um aplicativo Firebase.");
  return app;
}
function rhDb(ctx: ApiContext): Firestore { return getFirestore(firebaseApp(ctx), RH_DATABASE); }
function caller(ctx: ApiContext) {
  if ((ctx.integration.kind === "personal" ? !["owner", "admin", "rh"].includes(ctx.actor.role) : ctx.actor.role !== "rh") || ctx.actor.uid !== `api:${ctx.integration.id}`) denied();
  return ctx.actor;
}
function id(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) invalid("Identificador inválido.");
  return value;
}
function noQuery(request: ApiRequest) {
  if (Object.keys(request.query).length) invalid("Esta consulta não aceita filtros.");
}
async function detail(db: Firestore, collection: string, key: string, fields: readonly string[]) {
  const snapshot = await db.collection(collection).doc(key).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
  return { data: projectFields(snapshot.id, snapshot.data()!, fields) };
}
function globalPage(ctx: ApiContext, collection: string, fields: readonly string[], request: ApiRequest, db = ctx.db) {
  if (request.query.customer_code !== undefined) invalid("RH é global e não aceita filtro por cliente.");
  return readPage(ctx, collection, fields, request, { db });
}
function route(method: ModuleRoute["method"], path: string, scope: ModuleRoute["scope"], summary: string, run: ModuleRoute["run"]): ModuleRoute {
  return { method, path: `/api/v1/rh/${path}`, scope, role: "rh", summary, async run(ctx, params, request) {
    requireScope(ctx, scope);
    if (ctx.integration.kind === "personal") { if (!ctx.integration.principal) denied(); authorizePersonalRoute(ctx.integration.principal, method, `/api/v1/rh/${path}`, scope, request.body); }
    caller(ctx);
    return run(ctx, params, request);
  } };
}
function writeBody(ctx: ApiContext, request: ApiRequest, forbidden: string[]): Record<string, unknown> {
  noQuery(request);
  const body = object(request.body);
  if (["idempotency_key", ...forbidden].some((key) => key in body)) invalid("Identidade e chave são definidas pela rota e pelo cabeçalho.");
  return { ...body, idempotency_key: ctx.idempotencyKey };
}

export const rhApi: ModuleDefinition = {
  module: "rh", released: rhLiberado,
  routes: [
    route("GET", "colaboradores", "rh:ler", "Listar colaboradores sem dados pessoais", (ctx, _params, request) => globalPage(ctx, COLLABORATORS_COLLECTION, collaboratorFields, request)),
    route("GET", "colaboradores/{id}", "rh:ler", "Consultar colaborador sem dados pessoais", async (ctx, params, request) => {
      noQuery(request);
      return detail(ctx.db, COLLABORATORS_COLLECTION, id(params.id, ID_COLABORADOR), collaboratorFields);
    }),
    route("GET", "colaboradores/{id}/pessoais", "rh:pessoais:ler", "Consultar CPF e telefone do colaborador", async (ctx, params, request) => {
      noQuery(request);
      return detail(ctx.db, COLLABORATORS_COLLECTION, id(params.id, ID_COLABORADOR), personalFields);
    }),
    route("GET", "registros", "rh:ler", "Listar registros e vencimentos sem arquivos ou resultados clínicos", (ctx, _params, request) => globalPage(ctx, REGISTROS_COLLECTION, recordFields, request, rhDb(ctx))),
    route("GET", "registros/{id}", "rh:ler", "Consultar registro sem arquivo ou resultado clínico", async (ctx, params, request) => {
      noQuery(request);
      return detail(rhDb(ctx), REGISTROS_COLLECTION, id(params.id, ID_REGISTRO), recordFields);
    }),
    route("GET", "vinculos", "rh:ler", "Listar datas dos vínculos", (ctx, _params, request) => globalPage(ctx, VINCULOS_COLLECTION, linkFields, request, rhDb(ctx))),
    route("GET", "vinculos/{id}", "rh:ler", "Consultar datas do vínculo pelo colaborador", async (ctx, params, request) => {
      noQuery(request);
      return detail(rhDb(ctx), VINCULOS_COLLECTION, id(params.id, ID_COLABORADOR), linkFields);
    }),
    route("POST", "registros", "rh:registros:gravar", "Criar registro da ficha", async (ctx, _params, request) => saveRhRecordFor(ctx.db, rhDb(ctx), caller(ctx), writeBody(ctx, request, ["id", "expected_edicao"]))),
    route("PATCH", "registros/{id}", "rh:registros:gravar", "Alterar registro pela edição esperada", async (ctx, params, request) => saveRhRecordFor(ctx.db, rhDb(ctx), caller(ctx), { ...writeBody(ctx, request, ["id"]), id: id(params.id, ID_REGISTRO) })),
    route("POST", "vinculos", "rh:vinculos:gravar", "Criar datas do vínculo próprio", async (ctx, _params, request) => saveRhVinculoFor(ctx.db, rhDb(ctx), caller(ctx), writeBody(ctx, request, ["expected_edicao"]))),
    route("PATCH", "vinculos/{id}", "rh:vinculos:gravar", "Alterar datas do vínculo pela edição esperada", async (ctx, params, request) => {
      const body = writeBody(ctx, request, ["colaborador_id"]);
      if (!Number.isInteger(body.expected_edicao) || Number(body.expected_edicao) < 1) invalid("Informe expected_edicao.");
      return saveRhVinculoFor(ctx.db, rhDb(ctx), caller(ctx), { ...body, colaborador_id: id(params.id, ID_COLABORADOR) });
    }),
    route("GET", "registros/{id}/arquivo", "rh:documentos:ler", "Abrir arquivo por URL temporária com auditoria", async (ctx, params, request) => {
      noQuery(request);
      const result = await openRhFileFor(rhDb(ctx), caller(ctx), { registro_id: id(params.id, ID_REGISTRO) }, armazemDoBucket(getStorage(firebaseApp(ctx)).bucket()));
      return { data: result };
    }),
  ],
};
