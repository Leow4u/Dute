import { useAppUser } from "@/lib/auth";
import { appRoleForProfile } from "@/lib/modules";

export type Role = "interno" | "cliente";

// Papel do usuário vindo do perfil Firebase em users/{uid}.
export function useRole(): { role: Role | null; isLoaded: boolean } {
  const { user, isLoaded } = useAppUser();
  return { role: appRoleForProfile(user?.publicMetadata.role), isLoaded };
}
