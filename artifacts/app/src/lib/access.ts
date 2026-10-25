import { PLATAFORMA_LIBERADA } from "./liberacao";
import { INTERNAL_ROLES, normalizeProfileRole, type ProfileRole } from "./modules";

/**
 * Situação do perfil em users/{uid}. "removed" = acesso removido em Pessoas e
 * acessos (access_disabled); as Rules e as Functions já recusam esse perfil,
 * o app só precisa explicar em vez de dizer que falta convite.
 */
export type ProfileAccess =
  | { state: "active"; role: ProfileRole }
  | { state: "removed" }
  | { state: "none" };

export function profileAccess(data: Record<string, unknown> | undefined): ProfileAccess {
  if (!data) return { state: "none" };
  if (data.access_disabled === true) return { state: "removed" };
  const role = normalizeProfileRole(data.role);
  return role ? { state: "active", role } : { state: "none" };
}

export const ROLE_INFO: Array<{ role: ProfileRole; label: string; description: string }> = [
  { role: "admin", label: "Administração", description: "Tudo, inclusive pessoas, acessos e faturamento." },
  { role: "interno", label: "Coordenação", description: "Aprova pedidos, cuida do cadastro e do estoque." },
  { role: "wms", label: "Operação WMS", description: "Separa e entrega pedidos, recebe, conta e fotografa itens." },
  { role: "financeiro", label: "Financeiro", description: "Fecha o mês, emite e acompanha faturas." },
  { role: "suporte", label: "Suporte", description: "Acompanha a saúde do sistema e os incidentes." },
  { role: "cliente", label: "Cliente", description: "Portal da própria empresa: estoque, pedidos, OS e faturas do contrato." },
  // Papéis da plataforma (Fase 2). Aparecem no convite e neste quadro só onde
  // a plataforma está liberada (lib/liberacao.ts).
  { role: "campo", label: "Campo", description: "Executa pelo celular as OS em que está escalado." },
  { role: "comercial", label: "Comercial", description: "Orçamentos, clientes e preços de venda." },
  { role: "rh", label: "RH", description: "Colaboradores, documentos e treinamentos." },
  { role: "painel", label: "Painel", description: "TV da sala de operações, só leitura." },
];

/** Papéis que o WMS atende hoje; os demais dependem da liberação. */
function isWmsRole(role: ProfileRole) {
  return role === "cliente" || INTERNAL_ROLES.includes(role);
}

/** Quadro "O que cada perfil faz": sem os papéis da plataforma fora da liberação. */
export function visibleRoleInfo(platform = PLATAFORMA_LIBERADA) {
  return ROLE_INFO.filter((item) => platform || isWmsRole(item.role));
}

export function roleLabel(role: unknown) {
  const normalized = normalizeProfileRole(role);
  if (normalized === "owner") return "Administração (owner)";
  return ROLE_INFO.find((item) => item.role === normalized)?.label ?? "Sem perfil";
}

export function roleDescription(role: unknown) {
  const normalized = normalizeProfileRole(role);
  const key = normalized === "owner" ? "admin" : normalized;
  return ROLE_INFO.find((item) => item.role === key)?.description ?? "";
}

/**
 * Perfis que quem administra pode atribuir: só o owner cria administradores.
 * Os papéis da plataforma entram só onde ela está liberada.
 */
export function assignableRoles(
  actorRole: ProfileRole | null | undefined,
  platform = PLATAFORMA_LIBERADA,
): ProfileRole[] {
  const wms: ProfileRole[] = ["interno", "wms", "financeiro", "suporte", "cliente"];
  const base: ProfileRole[] = platform ? [...wms, "campo", "comercial", "rh", "painel"] : wms;
  return actorRole === "owner" ? ["admin", ...base] : base;
}

/** Admin não altera nem remove owner/admin; o servidor recusa do mesmo jeito. */
export function canManagePerson(
  actorRole: ProfileRole | null | undefined,
  targetRole: unknown,
): boolean {
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  const target = normalizeProfileRole(targetRole);
  return target !== "owner" && target !== "admin";
}
