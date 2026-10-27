import { HttpsError } from "firebase-functions/https";
import { digest } from "../domain/operations.js";

export const PREFIX = "/api/v1";
import { API_SCOPES } from "./shared/permissions.js";
export const SCOPES = API_SCOPES;
export type Scope = (typeof SCOPES)[number];
export type WriteRoute = {
  kind: "demand" | "create" | "plan" | "schedule";
  scope: Scope;
  numero?: string;
};
export function writeRoute(method: string, path: string): WriteRoute | null {
  if (method !== "POST") return null;
  if (path === `${PREFIX}/operacao/demandas`)
    return { kind: "demand", scope: "operacao:demanda:criar" };
  if (path === `${PREFIX}/operacao/os`)
    return { kind: "create", scope: "operacao:os:gravar" };
  if (path === `${PREFIX}/operacao/os/planejamento`)
    return { kind: "plan", scope: "operacao:os:gravar" };
  const match = new RegExp(
    `^${PREFIX}/operacao/os/(\\d{5,8}-\\d{2})/agendamento$`,
  ).exec(path);
  return match
    ? { kind: "schedule", numero: match[1], scope: "operacao:os:gravar" }
    : null;
}
export function approvalDigest(
  integration: string,
  method: string,
  path: string,
  key: string,
  body: unknown,
): string {
  return digest({ integration, method, path, key, body }, 64);
}
export function operationKey(integration: string, key: string): string {
  return `api_${digest({ integration, key }, 64)}`;
}
export function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}
export function denied(
  message = "Integração sem permissão para esta ação.",
): never {
  throw new HttpsError("permission-denied", message);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Informe um objeto JSON.");
  return value as Record<string, unknown>;
}
function pick(
  data: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter(
        (field) =>
          data[field] === null ||
          ["string", "number", "boolean"].includes(typeof data[field]) ||
          (Array.isArray(data[field]) &&
            (data[field] as unknown[]).every(
              (value) => typeof value === "string",
            )),
      )
      .map((field) => [field, data[field]]),
  );
}
/** Explicit allowlists at every nesting level: never spread a Firestore document. */
export function projectDocument(
  kind: string,
  id: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === "colaboradores")
    return { id, ...pick(data, ["nome", "funcao", "ativo", "vinculo"]) };
  if (kind === "veiculos")
    return {
      id,
      ...pick(data, [
        "placa",
        "tipo",
        "modelo",
        "ativo",
        "capacidade_kg",
        "capacidade_m3",
      ]),
    };
  if (kind === "demandas")
    return {
      id,
      ...pick(data, [
        "customer_code",
        "customer_name",
        "titulo",
        "tipo",
        "etapa",
        "executar_ate",
        "recebida_em",
        "escopo_rv",
      ]),
    };
  const result: Record<string, unknown> = {
    id,
    ...pick(data, [
      "numero",
      "demanda",
      "customer_code",
      "cliente_nome",
      "tipo",
      "status",
      "edicao",
      "servicos",
    ]),
  };
  if (data.janela && typeof data.janela === "object")
    result.janela = pick(data.janela as Record<string, unknown>, [
      "data",
      "inicio",
      "fim",
    ]);
  for (const [key, fields] of Object.entries({
    itens: [
      "id",
      "lpu_item_id",
      "codigo",
      "item",
      "descricao",
      "servico",
      "unidade",
      "planejado",
      "consumido",
    ],
    equipe: ["colaborador_id", "nome", "papel", "vinculo"],
    veiculos: ["veiculo_id", "placa", "tipo", "modelo"],
  })) {
    if (Array.isArray(data[key]))
      result[key] = (data[key] as unknown[])
        .filter((row) => row && typeof row === "object")
        .map((row) => pick(row as Record<string, unknown>, fields));
  }
  return result;
}
export function publicError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const codes: Record<string, number> = {
    "invalid-argument": 400,
    unauthenticated: 401,
    "permission-denied": 403,
    "not-found": 404,
    "already-exists": 409,
    aborted: 409,
    "failed-precondition": 412,
    "resource-exhausted": 429,
    unavailable: 503,
    "deadline-exceeded": 504,
  };
  if (error instanceof HttpsError && codes[error.code])
    return {
      status: codes[error.code],
      code: error.code,
      message: error.message,
    };
  return {
    status: 500,
    code: "internal",
    message: "Erro interno. Informe o request_id ao suporte.",
  };
}
