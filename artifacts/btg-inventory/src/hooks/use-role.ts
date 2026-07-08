import { useAppUser } from "@/lib/auth";

export type Role = "interno" | "cliente";

// Papel do usuário vindo do perfil Firebase em users/{uid}.
export function useRole(): { role: Role; isLoaded: boolean } {
  const { user, isLoaded } = useAppUser();
  const raw = (user?.publicMetadata as any)?.role;
  return { role: raw === "cliente" ? "cliente" : "interno", isLoaded };
}
