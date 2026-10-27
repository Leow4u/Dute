import {
  FieldPath,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";
import { interpretarDemandaDireta } from "../domain/demanda-direta.js";
import { openDirectDemandFor } from "../domain/demanda-direta-gravacao.js";
import {
  demandaDiretaSemEscopo,
  deMilesimos,
  interpretarOs,
  saldoDoEscopo,
} from "../domain/os.js";
import { lerEscopo, saveServiceOrderFor } from "../domain/os-gravacao.js";
import type { OperacaoProfile } from "../domain/profile.js";
import { requireCustomer, requireScope, type Integration } from "./auth.js";
import { customerFilter } from "./shared/core.js";
import {
  PREFIX,
  invalid,
  object,
  operationKey,
  projectDocument,
  type WriteRoute,
} from "./contract.js";

const Collections = {
  demandas: "demands",
  os: "service_orders",
  agenda: "service_orders",
  colaboradores: "collaborators",
  veiculos: "vehicles",
} as const;
const querySchema = z
  .object({
    customer_code: z.string().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .optional(),
    status: z.string().max(40).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export async function readResource(
  db: Firestore,
  integration: Integration,
  path: string,
  query: unknown,
) {
  const match = new RegExp(
    `^${PREFIX}/operacao/(demandas|os|agenda|colaboradores|veiculos)(?:/(\\d{5,8}(?:-\\d{2})?))?$`,
  ).exec(path);
  if (!match) throw new HttpsError("not-found", "Endpoint não encontrado.");
  const kind = match[1] as keyof typeof Collections;
  const resources = kind === "colaboradores" || kind === "veiculos";
  requireScope(
    integration,
    resources ? "operacao:recursos:ler" : "operacao:ler",
  );
  const parsed = querySchema.safeParse(query);
  if (!parsed.success)
    invalid(
      "Filtros inválidos. Use customer_code, limit (1–100), cursor, status, from e to.",
    );
  const filters = parsed.data;
  if (filters.from && filters.to && filters.from > filters.to)
    invalid("from deve ser anterior ou igual a to.");
  const collection = db.collection(Collections[kind]);
  if (match[2]) {
    if (kind !== "os" && kind !== "demandas")
      throw new HttpsError("not-found", "Endpoint não encontrado.");
    if (kind === "demandas")
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(collection.doc(match[2]));
        if (!snap.exists)
          throw new HttpsError("not-found", "Registro não encontrado.");
        const data = snap.data()!;
        requireCustomer(integration, data.customer_code);
        const result = projectDocument(kind, snap.id, data);
        if (Number.isInteger(data.escopo_rv) || demandaDiretaSemEscopo(data)) {
          const scope = await lerEscopo(tx, db, snap.id, data);
          const balance = saldoDoEscopo(scope.escopo, scope.ordens);
          const projected = projectDocument("os", snap.id, {
            itens: scope.escopo,
          });
          result.itens = (projected.itens as Record<string, unknown>[]).map(
            (item) => ({
              ...item,
              saldo: deMilesimos(balance.get(String(item.id)) ?? 0),
            }),
          );
        } else result.itens = [];
        return { data: result };
      });
    const snap = await collection.doc(match[2]).get();
    if (!snap.exists)
      throw new HttpsError("not-found", "Registro não encontrado.");
    const team = snap.get("equipe_uids");
    if (integration.principal?.role === "campo" && (!Array.isArray(team) || !team.includes(integration.principal.uid)))
      throw new HttpsError("permission-denied", "A OS não está vinculada à sua equipe.");
    requireCustomer(integration, snap.get("customer_code"));
    return { data: projectDocument(kind, snap.id, snap.data()!) };
  }
  let selection: Query = collection.orderBy(FieldPath.documentId());
  if (!resources) {
    const customer = customerFilter({ integration }, filters.customer_code);
    if (customer !== undefined) selection = selection.where("customer_code", "==", customer);
  }
  if (integration.principal?.role === "campo") selection = selection.where("equipe_uids", "array-contains", integration.principal.uid);
  if (filters.cursor) selection = selection.startAfter(filters.cursor);
  // Filter one bounded page in memory: no compound index or unbounded scan.
  // An empty filtered page may still have next_cursor, which consumers follow.
  const snaps = await selection.limit(filters.limit + 1).get();
  const page = snaps.docs.slice(0, filters.limit);
  const rows = page.filter((snap) => {
    if (filters.status && snap.get("status") !== filters.status) return false;
    const day = snap.get("janela.data");
    if (kind === "agenda" && typeof day !== "string") return false;
    if ((filters.from || filters.to) && typeof day !== "string") return false;
    return (
      (!filters.from || day >= filters.from) &&
      (!filters.to || day <= filters.to)
    );
  });
  return {
    data: rows.map((snap) =>
      projectDocument(kind === "agenda" ? "os" : kind, snap.id, snap.data()),
    ),
    next_cursor: snaps.size > filters.limit ? page.at(-1)!.id : null,
  };
}
export async function prepareWrite(
  db: Firestore,
  integration: Integration,
  route: WriteRoute,
  body: unknown,
  key: string,
) {
  requireScope(integration, route.scope);
  if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
    invalid("Informe Idempotency-Key (1 a 200 caracteres ASCII sem espaços).");
  const input = object(body);
  for (const field of ["action", "idempotency_key", "numero"])
    if (field in input) invalid(`O campo ${field} é definido pela API.`);
  const idempotency_key = operationKey(integration.id, key);
  if (route.kind === "demand") {
    const parsed = interpretarDemandaDireta({ ...input, idempotency_key });
    requireCustomer(integration, parsed.customer_code);
    return {
      customer: parsed.customer_code,
      input: { ...input, idempotency_key },
    };
  }
  const action = interpretarOs({
    ...input,
    action: route.kind,
    ...(route.numero ? { numero: route.numero } : {}),
    idempotency_key,
  });
  const target =
    route.kind === "schedule"
      ? db.collection("service_orders").doc(route.numero!)
      : db.collection("demands").doc((action as { demanda: string }).demanda);
  const snap = await target.get();
  if (!snap.exists)
    throw new HttpsError("not-found", "Demanda ou OS não encontrada.");
  const customer = snap.get("customer_code");
  requireCustomer(integration, customer);
  // Keep raw input for the domain's own parsing and normalization.
  return {
    customer,
    input: {
      ...input,
      action: route.kind,
      ...(route.numero ? { numero: route.numero } : {}),
      idempotency_key,
    },
  };
}
export async function executeWrite(
  db: Firestore,
  actor: OperacaoProfile,
  route: WriteRoute,
  input: unknown,
  customer: string,
) {
  return route.kind === "demand"
    ? openDirectDemandFor(db, actor, input)
    : saveServiceOrderFor(db, actor, input, customer);
}
