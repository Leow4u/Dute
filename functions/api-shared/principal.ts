import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { API_PERMISSIONS, API_SCOPES, type ApiScope } from "./permissions.js";

export const PERSONAL_ROLES = ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"] as const;
export type PersonalRole = typeof PERSONAL_ROLES[number];
export type PersonalPermission = "full" | "read_only" | "custom";
export type PersonalPrincipal = { uid: string; role: PersonalRole; name?: string; customer_code?: string; modules: string[]; portal_active: boolean };
function denied(message = "Sua conta não permite esta operação da API."): never { throw new HttpsError("permission-denied", message); }
const customerCode = (code: unknown): code is string => typeof code === "string" && code.length > 0 && code.length <= 80 && !/[\\/*]/.test(code) && code !== "." && code !== ".." && !/^__.*__$/.test(code);

export async function loadPersonalPrincipal(db: Firestore, uid: unknown): Promise<PersonalPrincipal> {
  if (typeof uid !== "string" || !uid || uid.includes("/")) denied("Usuário inválido.");
  const user = (await db.collection("users").doc(uid).get()).data();
  if (!user || user.access_disabled === true || !PERSONAL_ROLES.includes(user.role)) denied("A conta da chave perdeu o acesso.");
  const principal: PersonalPrincipal = { uid, role: user.role, modules: [], portal_active: true, ...(typeof user.nome === "string" ? { name: user.nome } : {}) };
  if (principal.role === "cliente") {
    const code = typeof user.customer_code === "string" ? user.customer_code.trim() : "";
    if (!customerCode(code)) denied("Seu acesso não está ligado a um cliente válido.");
    const access = (await db.collection("client_access").doc(code).get()).data();
    const known = ["wms", "operacao", "financeiro"].filter(key => Array.isArray(access?.modules) && access.modules.includes(key));
    principal.customer_code = code;
    principal.modules = access?.modules === undefined ? ["wms", "financeiro"] : known;
    principal.portal_active = access?.portal_ativo !== false;
  }
  return principal;
}

/** Escopos elegíveis; a autorização por rota continua obrigatória nos agregados. */
export function personalScopes(principal: PersonalPrincipal): ApiScope[] {
  const role = principal.role;
  if (role === "owner" || role === "admin") return API_SCOPES.filter(s => !["rh:registros:gravar", "rh:vinculos:gravar"].includes(s));
  if (role === "rh") return API_SCOPES.filter(s => s.startsWith("rh:"));
  const allow = new Set<string>();
  const add = (...scopes: string[]) => scopes.forEach(scope => allow.add(scope));
  if (["interno", "wms", "suporte", "financeiro"].includes(role)) add("armazenagem:ler");
  if (["interno", "wms", "suporte", "financeiro"].includes(role)) add("armazenagem:pedidos:gravar");
  if (["interno", "wms"].includes(role)) add("armazenagem:recebimentos:gravar", "armazenagem:estoque:movimentar");
  if (["interno", "campo", "comercial", "financeiro", "suporte"].includes(role)) add("operacao:ler");
  if (role === "interno") add("operacao:recursos:ler", "operacao:demanda:criar", "operacao:os:gravar");
  if (["interno", "comercial", "financeiro"].includes(role)) add("comercial:ler");
  if (role === "comercial") API_SCOPES.filter(s => s.startsWith("comercial:")).forEach(s => allow.add(s));
  if (["comercial", "suporte"].includes(role)) add("financeiro:ler");
  if (role === "financeiro") API_SCOPES.filter(s => s.startsWith("financeiro:")).forEach(s => allow.add(s));
  if (["interno", "wms", "suporte"].includes(role)) add("agente:ler");
  if (["interno", "suporte"].includes(role)) add("agente:playbooks:gravar");
  if (["interno", "wms", "suporte"].includes(role)) add("agente:rotinas:gravar");
  if (role === "cliente" && principal.portal_active) {
    if (principal.modules.includes("wms")) add("armazenagem:ler", "armazenagem:pedidos:gravar");
    if (principal.modules.includes("operacao")) add("operacao:ler");
    if (principal.modules.includes("financeiro")) add("financeiro:ler");
    if (principal.modules.some(m => m === "wms" || m === "operacao")) add("agente:ler");
    if (principal.modules.some(m => m === "wms" || m === "operacao")) add("agente:rotinas:gravar");
  }
  return API_SCOPES.filter(scope => allow.has(scope));
}
export function personalCapabilities(principal: PersonalPrincipal) {
  const scopes = personalScopes(principal);
  const customer = scopes.some(scope => API_PERMISSIONS.some(p => p.value === scope && p.customer));
  return { scopes, role: principal.role, ...(principal.customer_code ? { customer_code: principal.customer_code } : {}), customer_access: (customer ? principal.role === "cliente" ? "own" : "all" : "none") as "all" | "own" | "none" };
}
export function personalEffectiveScopes(principal: PersonalPrincipal, permission: PersonalPermission, selected: readonly string[]): ApiScope[] {
  if (!["full", "read_only", "custom"].includes(permission)) return denied("Permissão da chave inválida.");
  return personalScopes(principal).filter(scope => permission === "full" || (permission === "read_only" ? scope.endsWith(":ler") : selected.includes(scope)));
}
export function personalCustomerAllowed(principal: PersonalPrincipal, code: unknown): boolean {
  if (!customerCode(code)) return false;
  const access = personalCapabilities(principal).customer_access;
  return access === "all" || (access === "own" && code === principal.customer_code);
}

/** As rotas agregadas não concedem direitos que o serviço humano não oferece. */
export function authorizePersonalRoute(principal: PersonalPrincipal, method: string, path: string, scope: ApiScope, body?: unknown): void {
  if (!personalScopes(principal).includes(scope)) denied();
  if (method !== "GET" && body && typeof body === "object" && "customer_code" in body && !personalCustomerAllowed(principal, (body as Record<string, unknown>).customer_code)) denied("Cliente fora do acesso atual da sua conta.");
  const role = principal.role;
  const admin = role === "owner" || role === "admin";
  const segments = path.split("/");
  const module = segments[3]; const resource = segments[4];
  if (!["operacao", "armazenagem", "comercial", "financeiro", "rh", "agente"].includes(module) || scope.split(":")[0] !== module) denied();
  if (module === "rh" && method !== "GET" && role !== "rh") denied();
  if (module === "armazenagem") {
    if (role === "cliente" && !(method === "GET" && ["estoque", "pedidos"].includes(resource) || method === "POST" && resource === "pedidos")) denied();
    if (role === "financeiro" && !(method === "GET" && ["estoque", "movimentacoes"].includes(resource) || method === "POST" && resource === "pedidos")) denied();
    if (method === "PATCH" && resource === "pedidos" && !admin && role !== "interno") denied();
  }
  if (module === "operacao") {
    if (method !== "GET" && !admin && role !== "interno") denied();
    if (method === "GET" && resource === "demandas" && !admin && !["interno", "comercial", "financeiro"].includes(role)) denied();
    if (method === "GET" && ["os", "agenda"].includes(resource) && !admin && !["interno", "suporte", "campo", "cliente"].includes(role)) denied();
    if (method === "GET" && ["colaboradores", "veiculos"].includes(resource) && !admin && role !== "interno") denied();
  }
  if (module === "comercial" && method === "GET") {
    if (["clientes", "contatos"].includes(resource) && !admin && role !== "comercial") denied();
    if (resource === "locais" && !admin && !["interno", "comercial"].includes(role)) denied();
    if (!["clientes", "contatos", "locais", "demandas"].includes(resource) && !admin && !["comercial", "financeiro"].includes(role)) denied();
  }
  if (module === "financeiro") {
    if (role === "cliente" && !(method === "GET" && resource === "faturas")) denied();
    if (role === "suporte" && !(method === "GET" && resource === "a-faturar" && segments[5] === "armazenagem")) denied();
    if (role === "comercial" && (method !== "GET" || resource === "a-faturar" && segments[5] === "armazenagem")) denied();
  }
  if (module === "agente" && resource === "playbooks" && !admin && !["interno", "suporte"].includes(role)) denied();
  if (module === "agente" && method !== "GET") {
    if (resource === "playbooks" && !admin && !["interno", "suporte"].includes(role)) denied();
    if (resource === "rotinas") {
      const modulo = body && typeof body === "object" ? (body as Record<string,unknown>).modulo : undefined;
      if (modulo !== "wms" && modulo !== "operacao") denied("A API cadastra rotinas pausadas de Armazenagem ou Operação.");
      if (!personalScopes(principal).includes(modulo === "wms" ? "armazenagem:ler" : "operacao:ler")) denied();
    }
  }
}

/** Campos pessoais são discriminados explicitamente; ausência continua no ramo legado. */
export async function personalKeyDetails(db: Firestore, data: Record<string, any>) {
  if (data.kind !== "personal" || !["full", "read_only", "custom"].includes(data.permission) || data.write_policy !== "scoped" || !Array.isArray(data.scopes) || data.scopes.some((scope: unknown) => !API_SCOPES.includes(scope as ApiScope)) || !Array.isArray(data.customers) || data.customers.length || data.permission === "custom" && !data.scopes.length || data.permission !== "custom" && data.scopes.length) denied("Configuração da chave pessoal inválida.");
  const principal = await loadPersonalPrincipal(db, data.delegated_by);
  return { kind: "personal" as const, permission: data.permission as PersonalPermission, principal, scopes: personalEffectiveScopes(principal, data.permission, data.scopes), customers: principal.customer_code ? [principal.customer_code] : [] };
}
