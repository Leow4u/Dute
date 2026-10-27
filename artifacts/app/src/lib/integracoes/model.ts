export const PERMISSOES = [
  { value: "operacao:ler", label: "Consultar demandas, OS e agenda" },
  { value: "operacao:recursos:ler", label: "Consultar equipe e veículos", hint: "Recursos compartilhados entre clientes." },
  { value: "operacao:demanda:criar", label: "Criar demandas", hint: "Exige aprovação humana a cada ação." },
  { value: "operacao:os:gravar", label: "Planejar e agendar OS", hint: "Exige aprovação humana a cada ação." },
] as const;
export type IntegrationScope = (typeof PERMISSOES)[number]["value"];
export type IntegrationInput = { name: string; customers: string[]; scopes: IntegrationScope[]; expires_in_days: number };
export type IntegrationRow = {
  id: string; name: string; customers: string[]; scopes: IntegrationScope[];
  expires_at: string; revoked: boolean; delegated_by: string;
};
export type CreatedIntegration = { id: string; token: string; expires_at: string };

export function integrationProblem(input: { name: string; customers: string[]; scopes: string[]; expires_in_days: number }): string | null {
  if (input.name.trim().length < 2 || input.name.trim().length > 80) return "Informe um nome de 2 a 80 caracteres.";
  if (!input.customers.length || input.customers.length > 50 || input.customers.some((code) => !code.trim() || code.length > 80 || code.includes("/") || code.trim() === "*")) return "Selecione de 1 a 50 clientes autorizados.";
  if (!input.scopes.length || input.scopes.some((scope) => !PERMISSOES.some((p) => p.value === scope))) return "Selecione pelo menos uma permissão da Operação.";
  if (!Number.isInteger(input.expires_in_days) || input.expires_in_days < 1 || input.expires_in_days > 90) return "A validade deve ser de 1 a 90 dias.";
  return null;
}

export function integrationStatus(row: Pick<IntegrationRow, "revoked" | "expires_at">, now = Date.now()): "Ativa" | "Revogada" | "Expirada" {
  if (row.revoked) return "Revogada";
  return Date.parse(row.expires_at) > now ? "Ativa" : "Expirada";
}
