import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { assertOwner } from "./system-dashboard.js";

/**
 * Painel do sistema, parte 2 (Configuração > Sistema, só owner): erros de
 * qualquer function (Cloud Logging), functions publicadas e com acesso
 * público (Cloud Functions + Cloud Run, o mesmo que o
 * tools/check_functions_invoker.ps1 confere) e o custo real do Google Cloud
 * (exportação do faturamento para o BigQuery). Só leitura: nada aqui corrige
 * permissão nem publica function; o painel mostra o comando.
 *
 * Cada parte responde sozinha: se uma API negar acesso, as outras aparecem e
 * a que falhou mostra o motivo.
 */

export const INFRA_SETTINGS_DOC = { collection: "system_settings", id: "infra" } as const;
const DAY_MS = 86_400_000;
const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;
const BLOCKED_MESSAGE = "403 antes do código rodar: sem acesso público (invoker)";

export type GcpFetch = (url: string, init?: { method?: string; body?: string }) => Promise<{ status: number; json: unknown }>;
export type Section<T> = ({ status: "ok" } & T) | { status: "error"; message: string } | { status: "not_configured" };

// ------------------------------------------------------------------ erros

export type LogEntry = {
  timestamp?: string;
  severity?: string;
  logName?: string;
  textPayload?: string;
  jsonPayload?: { message?: unknown; [key: string]: unknown };
  resource?: { labels?: { service_name?: string } };
  httpRequest?: { status?: number };
  // Log de auditoria do Google Cloud (deploy, permissão): vem sem service_name.
  protoPayload?: { methodName?: string; resourceName?: string; status?: { message?: string } };
};

export type ErrorGroup = { service: string; message: string; count: number; first_at: string; last_at: string; blocked: boolean; admin: boolean };

export function errorsFilter(since: Date) {
  // Erros das functions e do site, mais as chamadas recusadas com 403 na
  // borda do Cloud Run (falta de invoker: o portal só vê um erro genérico).
  // Os logs de requisição com 5xx ficam de fora: repetem o erro do código.
  return [
    `timestamp>="${since.toISOString()}"`,
    `resource.type="cloud_run_revision"`,
    `((severity>=ERROR AND NOT log_id("run.googleapis.com/requests")) OR (log_id("run.googleapis.com/requests") AND httpRequest.status=403))`,
  ].join(" AND ");
}

export function isBlocked(entry: LogEntry) {
  return (entry.logName ?? "").endsWith("run.googleapis.com%2Frequests") && entry.httpRequest?.status === 403;
}

export function isAdmin(entry: LogEntry) {
  return (entry.logName ?? "").includes("cloudaudit.googleapis.com");
}

/** Serviço do Cloud Run do registro; na auditoria, sai do recurso ou da mensagem. */
export function errorService(entry: LogEntry) {
  const label = entry.resource?.labels?.service_name;
  if (label) return label;
  const proto = entry.protoPayload;
  const fromResource = proto?.resourceName?.match(/services\/([^/]+)/)?.[1];
  const fromMessage = proto?.status?.message?.match(/Resource '([^']+)' of kind 'SERVICE'/)?.[1];
  return fromResource ?? fromMessage ?? "desconhecido";
}

const MESSAGE_LIMIT = 240;

/**
 * Mensagem sem a pilha de chamadas: as linhas "at ..." saem, o resto vira uma
 * linha só (erro de validação do Zod explica o campo nas linhas seguintes).
 */
export function errorMessage(entry: LogEntry) {
  if (isBlocked(entry)) return BLOCKED_MESSAGE;
  const proto = entry.protoPayload;
  if (proto?.status?.message) {
    const method = (proto.methodName ?? "").split(".").at(-1);
    return `${method ? `${method}: ` : ""}${proto.status.message}`.slice(0, MESSAGE_LIMIT);
  }
  const payload = entry.jsonPayload;
  const raw = entry.textPayload ?? (typeof payload?.message === "string" ? payload.message : payload ? JSON.stringify(payload) : "");
  const text = raw
    .split("\n")
    .filter((line) => !/^\s+at\s/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MESSAGE_LIMIT) || "(sem mensagem)";
}

export function groupErrors(entries: LogEntry[]) {
  const groups = new Map<string, ErrorGroup>();
  for (const entry of entries) {
    const service = errorService(entry);
    const message = errorMessage(entry);
    const at = entry.timestamp ?? "";
    const key = `${service}\u0000${message}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { service, message, count: 1, first_at: at, last_at: at, blocked: isBlocked(entry), admin: isAdmin(entry) });
      continue;
    }
    current.count += 1;
    if (at && at < current.first_at) current.first_at = at;
    if (at > current.last_at) current.last_at = at;
  }
  const list = [...groups.values()].sort((left, right) => right.last_at.localeCompare(left.last_at));
  const blocked = list.filter((group) => group.blocked).reduce((sum, group) => sum + group.count, 0);
  const total = list.reduce((sum, group) => sum + group.count, 0);
  return {
    total: total - blocked,
    blocked,
    services: new Set(list.filter((group) => !group.blocked).map((group) => group.service)).size,
    groups: list.slice(0, 30),
  };
}

// --------------------------------------------------------------- functions

export type CodeFunction = { name: string; callable: boolean };
export type DeployedFunction = { name: string; state: string; updated_at: string | null; service: string };
export type FunctionStatus = "ok" | "sem_acesso" | "nao_publicada";
export type FunctionRow = { name: string; service: string; status: FunctionStatus; state: string | null; updated_at: string | null; fix: string | null };

/** Exports do index.ts que são functions do Firebase (o SDK marca com __endpoint). */
export function codeFunctions(exports: Record<string, unknown>): CodeFunction[] {
  return Object.entries(exports)
    .filter(([, value]) => typeof value === "function" && (value as { __endpoint?: unknown }).__endpoint)
    .map(([name, value]) => ({ name, callable: Boolean((value as { __endpoint: { callableTrigger?: unknown } }).__endpoint.callableTrigger) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function hasPublicInvoker(policy: unknown) {
  const bindings = (policy as { bindings?: Array<{ role?: string; members?: string[] }> } | null)?.bindings ?? [];
  return bindings.some((binding) => binding.role === "roles/run.invoker" && (binding.members ?? []).includes("allUsers"));
}

/**
 * Mesmo critério do check_functions_invoker.ps1: não publicada (não existe
 * ou o deploy não terminou ACTIVE) pede firebase deploy; callable publicada
 * sem allUsers/roles/run.invoker pede add-iam-policy-binding.
 */
export function functionsStatus(
  code: CodeFunction[],
  deployed: DeployedFunction[],
  invoker: Map<string, boolean>,
  project: string,
  region: string,
) {
  const byName = new Map(deployed.map((fn) => [fn.name, fn]));
  const rows: FunctionRow[] = code.map((fn) => {
    const live = byName.get(fn.name);
    const service = live?.service || fn.name.toLowerCase();
    if (!live || live.state !== "ACTIVE") {
      return {
        name: fn.name,
        service,
        status: "nao_publicada",
        state: live?.state ?? null,
        updated_at: live?.updated_at ?? null,
        fix: `firebase deploy --only functions:${fn.name} --project ${project}`,
      };
    }
    if (fn.callable && invoker.get(service) !== true) {
      return {
        name: fn.name,
        service,
        status: "sem_acesso",
        state: live.state,
        updated_at: live.updated_at,
        fix: `gcloud run services add-iam-policy-binding ${service} --project ${project} --region ${region} --member=allUsers --role=roles/run.invoker`,
      };
    }
    return { name: fn.name, service, status: "ok", state: live.state, updated_at: live.updated_at, fix: null };
  });
  const order: Record<FunctionStatus, number> = { nao_publicada: 0, sem_acesso: 1, ok: 2 };
  rows.sort((left, right) => order[left.status] - order[right.status] || left.name.localeCompare(right.name));
  const updates = deployed.map((fn) => fn.updated_at ?? "").filter(Boolean).sort();
  return {
    total: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    sem_acesso: rows.filter((row) => row.status === "sem_acesso").length,
    nao_publicada: rows.filter((row) => row.status === "nao_publicada").length,
    last_deploy_at: updates.at(-1) ?? null,
    list: rows,
  };
}

// ------------------------------------------------------------ faturamento

// projeto.dataset.tabela, como o BigQuery mostra (ex.: dute-btg.billing_export.gcp_billing_export_v1_0123AB_CDEF45_6789AB).
const BILLING_TABLE = /^[a-z][a-z0-9-]{4,29}\.[A-Za-z0-9_]{1,1024}\.[A-Za-z0-9_]{1,1024}$/;

export const InfraSettingsSchema = z.object({
  billing_table: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || BILLING_TABLE.test(value), "Use projeto.dataset.tabela, como aparece no BigQuery."),
});

export type InfraSettings = { billing_table: string | null };

export function invoiceMonth(now: Date) {
  const local = new Date(now.getTime() + SAO_PAULO_OFFSET_MS);
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Custo do mês da fatura, por serviço, já com créditos (descontos) abatidos. */
export function billingQuery(table: string, now: Date) {
  if (!BILLING_TABLE.test(table)) throw new HttpsError("failed-precondition", "Tabela do faturamento inválida.");
  const local = new Date(now.getTime() + SAO_PAULO_OFFSET_MS);
  // A partição é a data de carga; uma folga de 5 dias pega o que chegou atrasado.
  const since = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 5 * DAY_MS).toISOString().slice(0, 10);
  return {
    query: [
      "SELECT service.description AS service,",
      "  SUM(cost) + SUM(IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS cost,",
      "  ANY_VALUE(currency) AS currency,",
      "  MAX(usage_end_time) AS last_usage",
      `FROM \`${table}\``,
      "WHERE invoice.month = @month AND project.id = @project AND DATE(_PARTITIONTIME) >= @since",
      "GROUP BY service",
      "ORDER BY cost DESC",
    ].join("\n"),
    params: { month: invoiceMonth(now), since },
  };
}

export type BillingRow = { service: string; cost: number; currency: string; last_usage: string | null };

export function summarizeBilling(rows: BillingRow[]) {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const services = rows.map((row) => ({ service: row.service, cost: round2(row.cost) })).filter((row) => row.cost !== 0);
  const vertex = rows.filter((row) => /vertex ai|gemini/i.test(row.service)).reduce((sum, row) => sum + row.cost, 0);
  const lastUsage = rows.map((row) => row.last_usage ?? "").filter(Boolean).sort().at(-1) ?? null;
  return {
    total: round2(rows.reduce((sum, row) => sum + row.cost, 0)),
    currency: rows[0]?.currency ?? "BRL",
    vertex_ai: round2(vertex),
    data_until: lastUsage,
    services,
  };
}

/** Linhas do jobs.query do BigQuery (f/v) para BillingRow. */
export function parseBillingResponse(json: unknown): BillingRow[] {
  const rows = (json as { rows?: Array<{ f: Array<{ v: unknown }> }> }).rows ?? [];
  return rows.map((row) => {
    const [service, cost, currency, lastUsage] = row.f.map((cell) => cell.v);
    const seconds = Number(lastUsage);
    return {
      service: String(service ?? "Outros"),
      cost: Number(cost) || 0,
      currency: String(currency ?? "BRL"),
      // TIMESTAMP vem como segundos desde 1970 (com fração).
      last_usage: lastUsage == null ? null : Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : String(lastUsage),
    };
  });
}

// ----------------------------------------------------------- leitura geral

function apiError(what: string, status: number, json: unknown) {
  const detail = (json as { error?: { message?: string } } | null)?.error?.message ?? "";
  if (status === 403) return `Sem permissão para ${what}. ${detail}`.trim();
  return `Falha ao ${what} (${status}). ${detail}`.trim();
}

async function readErrors(gcp: GcpFetch, project: string, now: Date): Promise<Section<ReturnType<typeof groupErrors>>> {
  const entries: LogEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const response = await gcp("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      body: JSON.stringify({
        resourceNames: [`projects/${project}`],
        filter: errorsFilter(new Date(now.getTime() - DAY_MS)),
        orderBy: "timestamp desc",
        pageSize: 1000,
        pageToken,
      }),
    });
    if (response.status !== 200) return { status: "error", message: apiError("ler os logs", response.status, response.json) };
    const body = response.json as { entries?: LogEntry[]; nextPageToken?: string };
    entries.push(...(body.entries ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return { status: "ok", ...groupErrors(entries) };
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}

async function readFunctions(
  gcp: GcpFetch,
  code: CodeFunction[],
  project: string,
  region: string,
): Promise<Section<ReturnType<typeof functionsStatus>>> {
  const deployed: DeployedFunction[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const response = await gcp(url);
    if (response.status !== 200) return { status: "error", message: apiError("listar as functions", response.status, response.json) };
    const body = response.json as {
      functions?: Array<{ name?: string; state?: string; updateTime?: string; serviceConfig?: { service?: string } }>;
      nextPageToken?: string;
    };
    for (const fn of body.functions ?? []) {
      deployed.push({
        name: (fn.name ?? "").split("/").at(-1) ?? "",
        state: fn.state ?? "STATE_UNSPECIFIED",
        updated_at: fn.updateTime ?? null,
        service: (fn.serviceConfig?.service ?? "").split("/").at(-1) ?? "",
      });
    }
    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }
  const byName = new Map(deployed.map((fn) => [fn.name, fn]));
  const callables = code.filter((fn) => fn.callable && byName.get(fn.name)?.state === "ACTIVE");
  const invoker = new Map<string, boolean>();
  let denied: string | null = null;
  await mapLimit(callables, 8, async (fn) => {
    const service = byName.get(fn.name)!.service || fn.name.toLowerCase();
    const response = await gcp(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}:getIamPolicy`);
    if (response.status === 403) denied = apiError("ler o acesso do Cloud Run", response.status, response.json);
    invoker.set(service, response.status === 200 && hasPublicInvoker(response.json));
  });
  if (denied) return { status: "error", message: denied };
  return { status: "ok", ...functionsStatus(code, deployed, invoker, project, region) };
}

async function readBilling(gcp: GcpFetch, table: string | null, project: string, now: Date): Promise<Section<ReturnType<typeof summarizeBilling> & { table: string }>> {
  if (!table) return { status: "not_configured" };
  const { query, params } = billingQuery(table, now);
  const response = await gcp(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: "POST",
    body: JSON.stringify({
      query,
      useLegacySql: false,
      timeoutMs: 25_000,
      parameterMode: "NAMED",
      queryParameters: [
        { name: "month", parameterType: { type: "STRING" }, parameterValue: { value: params.month } },
        { name: "project", parameterType: { type: "STRING" }, parameterValue: { value: project } },
        { name: "since", parameterType: { type: "DATE" }, parameterValue: { value: params.since } },
      ],
    }),
  });
  if (response.status !== 200) return { status: "error", message: apiError("consultar o faturamento no BigQuery", response.status, response.json) };
  if ((response.json as { jobComplete?: boolean }).jobComplete === false) {
    return { status: "error", message: "O BigQuery demorou para responder. Tente de novo em instantes." };
  }
  return { status: "ok", table, ...summarizeBilling(parseBillingResponse(response.json)) };
}

export async function readInfraSettings(db: Firestore): Promise<InfraSettings> {
  const data = (await db.collection(INFRA_SETTINGS_DOC.collection).doc(INFRA_SETTINGS_DOC.id).get()).data() ?? {};
  return { billing_table: typeof data.billing_table === "string" && data.billing_table ? data.billing_table : null };
}

export async function saveInfraSettings(db: Firestore, actor: { uid: string; role: string }, input: z.infer<typeof InfraSettingsSchema>) {
  assertOwner(actor.role);
  const settings: InfraSettings = { billing_table: input.billing_table };
  await db
    .collection(INFRA_SETTINGS_DOC.collection)
    .doc(INFRA_SETTINGS_DOC.id)
    .set({ ...settings, updated_by: actor.uid, updated_at_iso: new Date().toISOString() });
  return settings;
}

/** Erros de 24 h, functions publicadas e custo real do mês. Só owner. */
export async function readSystemInfra(
  db: Firestore,
  actor: { role: string },
  options: { gcp: GcpFetch; code: CodeFunction[]; project: string; region: string; now?: Date },
) {
  assertOwner(actor.role);
  const now = options.now ?? new Date();
  const settings = await readInfraSettings(db);
  const guard = async <T>(what: string, run: () => Promise<Section<T>>): Promise<Section<T>> => {
    try {
      return await run();
    } catch (error) {
      return { status: "error", message: `Falha ao ${what}: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
  const [errors, functions, billing] = await Promise.all([
    guard("ler os logs", () => readErrors(options.gcp, options.project, now)),
    guard("listar as functions", () => readFunctions(options.gcp, options.code, options.project, options.region)),
    guard("consultar o faturamento", () => readBilling(options.gcp, settings.billing_table, options.project, now)),
  ]);
  return { checked_at: now.toISOString(), settings, errors, functions, billing };
}
