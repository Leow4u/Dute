/** Fonte portátil do catálogo de escopos. Sincronizada pelo build, nunca editada nas cópias. */
export const API_PERMISSIONS = [
  { value: "operacao:ler", module: "operacao", label: "Consultar demandas, OS e agenda", customer: true },
  { value: "operacao:recursos:ler", module: "operacao", label: "Consultar equipe e veículos", customer: false },
  { value: "operacao:demanda:criar", module: "operacao", label: "Criar demandas", customer: true },
  { value: "operacao:os:gravar", module: "operacao", label: "Planejar e agendar OS", customer: true },
  { value: "armazenagem:ler", module: "armazenagem", label: "Consultar catálogo, estoque e pedidos", customer: true },
  { value: "armazenagem:pedidos:gravar", module: "armazenagem", label: "Criar e alterar pedidos", customer: true },
  { value: "armazenagem:recebimentos:gravar", module: "armazenagem", label: "Criar e conferir recebimentos", customer: true },
  { value: "armazenagem:estoque:movimentar", module: "armazenagem", label: "Registrar movimentações de estoque", customer: true },
  { value: "comercial:ler", module: "comercial", label: "Consultar cadastros, contratos e orçamentos", customer: true },
  { value: "comercial:clientes:gravar", module: "comercial", label: "Criar e alterar cadastros comerciais", customer: true },
  { value: "comercial:contratos:gravar", module: "comercial", label: "Criar e alterar contratos e aditivos", customer: true },
  { value: "comercial:orcamentos:gravar", module: "comercial", label: "Criar e alterar rascunhos de orçamento", customer: true },
  { value: "comercial:medicoes:gravar", module: "comercial", label: "Criar e alterar medições", customer: true },
  { value: "financeiro:ler", module: "financeiro", label: "Consultar faturamento e pagamentos", customer: true },
  { value: "financeiro:faturas:gravar", module: "financeiro", label: "Registrar notas emitidas fora do sistema", customer: true },
  { value: "financeiro:cobrancas:gravar", module: "financeiro", label: "Atualizar envio de cobranças", customer: true },
  { value: "financeiro:pagamentos:registrar", module: "financeiro", label: "Registrar pagamentos recebidos", customer: true },
  { value: "rh:ler", module: "rh", label: "Consultar registros e vínculos do RH", customer: false },
  { value: "rh:pessoais:ler", module: "rh", label: "Consultar dados pessoais do RH", customer: false },
  { value: "rh:documentos:ler", module: "rh", label: "Abrir documentos do RH", customer: false },
  { value: "rh:registros:gravar", module: "rh", label: "Criar e alterar registros do RH", customer: false },
  { value: "rh:vinculos:gravar", module: "rh", label: "Criar e alterar vínculos", customer: false },
  { value: "agente:ler", module: "agente", label: "Consultar playbooks e rotinas da integração", customer: true },
  { value: "agente:playbooks:gravar", module: "agente", label: "Criar e alterar playbooks", customer: true },
  { value: "agente:rotinas:gravar", module: "agente", label: "Criar e alterar rotinas da integração", customer: true },
] as const;
export type ApiScope = (typeof API_PERMISSIONS)[number]["value"];
export const API_SCOPES = API_PERMISSIONS.map((permission) => permission.value) as [ApiScope, ...ApiScope[]];
export type WritePolicy = "scoped" | "approval_required";
export function scopesNeedCustomers(scopes: readonly string[]): boolean {
  return API_PERMISSIONS.some((permission) => permission.customer && scopes.includes(permission.value));
}
