import { clerkClient } from "@clerk/express";

export type Role = "interno" | "cliente";

// Cache curto de papéis para evitar uma chamada ao Clerk por requisição.
const cache = new Map<string, { role: Role; exp: number }>();
const TTL_MS = 60_000;

// Resolve o papel do usuário. IMPORTANTE: em caso de falha na consulta ao
// Clerk, lança erro (fail-closed) em vez de assumir "interno" — do contrário
// uma falha transitória poderia conceder acesso interno a um cliente. Um
// lookup bem-sucedido sem papel definido é tratado como "interno" (equipe
// Dutelog que ainda não teve papel atribuído).
export async function getUserRole(userId: string): Promise<Role> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.exp > now) return cached.role;

  const user = await clerkClient.users.getUser(userId);
  const role: Role = (user.publicMetadata as any)?.role === "cliente" ? "cliente" : "interno";
  cache.set(userId, { role, exp: now + TTL_MS });
  return role;
}

export function invalidateRole(userId: string): void {
  cache.delete(userId);
}
