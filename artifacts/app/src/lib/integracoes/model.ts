import { API_PERMISSIONS, scopesNeedCustomers, type ApiScope, type WritePolicy } from "@workspace/dominio";

export const PERMISSOES = API_PERMISSIONS;
export const MODULOS = [
  { value: "operacao", label: "Operação" },
  { value: "armazenagem", label: "Armazenagem" },
  { value: "comercial", label: "Comercial" },
  { value: "financeiro", label: "Financeiro" },
  { value: "rh", label: "RH" },
  { value: "agente", label: "Agent Dute" },
] as const;
export type IntegrationScope = ApiScope;
export type IntegrationInput = { name: string; customers: string[]; scopes: IntegrationScope[]; expires_in_days: number; write_policy: "scoped" };
export type IntegrationRow = {
  id: string; name: string; customers: string[]; scopes: IntegrationScope[];
  expires_at: string; revoked: boolean; delegated_by: string; write_policy?: WritePolicy;
};
export type CreatedIntegration = { id: string; token: string; expires_at: string };

export function integrationProblem(input: { name: string; customers: string[]; scopes: string[]; expires_in_days: number }): string | null {
  if (input.name.trim().length < 2 || input.name.trim().length > 80) return "Informe um nome de 2 a 80 caracteres.";
  if ((scopesNeedCustomers(input.scopes) && !input.customers.length) || input.customers.length > 50 || input.customers.some((code) => !code.trim() || code.length > 80 || code.includes("/") || code.includes("\\") || code.includes("*"))) return "Autorize até 50 clientes; permissões por cliente exigem pelo menos um.";
  if (!input.scopes.length || input.scopes.some((scope) => !PERMISSOES.some((p) => p.value === scope))) return "Selecione pelo menos uma permissão.";
  if (!Number.isInteger(input.expires_in_days) || input.expires_in_days < 1 || input.expires_in_days > 90) return "A validade deve ser de 1 a 90 dias.";
  return null;
}

export function integrationStatus(row: Pick<IntegrationRow, "revoked" | "expires_at">, now = Date.now()): "Ativa" | "Revogada" | "Expirada" {
  if (row.revoked) return "Revogada";
  return Date.parse(row.expires_at) > now ? "Ativa" : "Expirada";
}
