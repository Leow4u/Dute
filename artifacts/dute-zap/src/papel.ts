/** O painel lê `users/{uid}.role`, como o app. Só owner e admin. */

export function podeVerZap(role: unknown, accessDisabled: unknown): boolean {
  if (accessDisabled === true) return false;
  return role === "owner" || role === "admin";
}
