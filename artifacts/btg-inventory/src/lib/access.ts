import { normalizeProfileRole, type ProfileRole } from "./modules";

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
  { role: "cliente", label: "Cliente", description: "Portal da BTG: estoque, pedidos e faturas." },
];

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

/** Perfis que quem administra pode atribuir: só o owner cria administradores. */
export function assignableRoles(actorRole: ProfileRole | null | undefined): ProfileRole[] {
  const base: ProfileRole[] = ["interno", "wms", "financeiro", "suporte", "cliente"];
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
