import { useAppUser } from "@/lib/auth";

export type Role = "interno" | "cliente";

// Papel do usuário via Clerk publicMetadata. Ausência de papel = interno
// (mantém usuários existentes como administradores).
export function useRole(): { role: Role; isLoaded: boolean } {
  const { user, isLoaded } = useAppUser();
  const raw = (user?.publicMetadata as any)?.role;
  return { role: raw === "cliente" ? "cliente" : "interno", isLoaded };
}
