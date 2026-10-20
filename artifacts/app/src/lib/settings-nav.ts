import {
  Activity,
  Building2,
  Smartphone,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  ACCESS_ADMIN_ROLES,
  ALL_ROLES,
  INTERNAL_ROLES,
  SUPPORT_ROLES,
  canAccessModule,
  getHomePathForProfile,
  normalizePath,
  type ProfileRole,
} from "./modules";

/**
 * Configuração é uma tela à parte (modelo Cursor): ocupa a tela inteira, com
 * menu próprio e "Voltar" para onde a pessoa estava. Administração saiu do
 * menu principal e vive aqui.
 */

export const SETTINGS_ROOT = "/configuracoes";

export type SettingsSection = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: "conta" | "administracao";
  roles: ProfileRole[];
};

const EVERYONE: ProfileRole[] = ALL_ROLES;

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "conta",
    label: "Minha conta",
    href: "/configuracoes/conta",
    icon: UserRound,
    group: "conta",
    roles: EVERYONE,
  },
  {
    id: "aplicativo",
    label: "Aplicativo no celular",
    href: "/configuracoes/aplicativo",
    icon: Smartphone,
    group: "conta",
    roles: EVERYONE,
  },
  {
    id: "pessoas",
    label: "Pessoas e acessos",
    href: "/configuracoes/pessoas",
    icon: Users,
    group: "administracao",
    roles: ACCESS_ADMIN_ROLES,
  },
  // Clientes: cadastro, modelo de operação, sigla do SKU e portal de cada
  // cliente (docs/multicliente-modelos-de-operacao.md).
  {
    id: "clientes",
    label: "Clientes",
    href: "/configuracoes/clientes",
    icon: Building2,
    group: "administracao",
    roles: ACCESS_ADMIN_ROLES,
  },
  {
    id: "sistema",
    label: "Sistema",
    href: "/configuracoes/sistema",
    icon: Activity,
    group: "administracao",
    roles: SUPPORT_ROLES,
  },
];

export const SETTINGS_GROUP_LABEL: Record<SettingsSection["group"], string> = {
  conta: "Sua conta",
  administracao: "Administração",
};

/** Endereços antigos da Administração, preservados para links salvos. */
export const LEGACY_SETTINGS_REDIRECTS: Record<string, string> = {
  "/usuarios": "/configuracoes/pessoas",
  "/clientes": "/configuracoes/clientes",
  // "Cliente BTG" virou Clientes quando o cadastro passou a aceitar vários.
  "/configuracoes/cliente": "/configuracoes/clientes",
  "/suporte": "/configuracoes/sistema",
};

export function getSettingsSections(
  role: ProfileRole | null | undefined,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) =>
    canAccessModule(role, section.roles),
  );
}

export function isSettingsPath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized === SETTINGS_ROOT || normalized.startsWith(`${SETTINGS_ROOT}/`)
  );
}

/** A raiz abre Minha conta no computador (no celular, a lista de seções). */
export function getActiveSettingsSection(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === SETTINGS_ROOT) return "conta";
  return (
    SETTINGS_SECTIONS.find((section) => section.href === normalized)?.id ??
    null
  );
}

const RETURN_KEY = "dute.settings.return";

/** Guarda a última tela do app, para o "Voltar" da Configuração. */
export function rememberReturnPath(path: string) {
  if (isSettingsPath(path)) return;
  try {
    window.sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Sem storage (aba privada): o Voltar cai na tela inicial do perfil.
  }
}

export function getReturnPath(role: ProfileRole | null | undefined): string {
  let saved: string | null = null;
  try {
    saved = window.sessionStorage.getItem(RETURN_KEY);
  } catch {
    saved = null;
  }
  if (saved && saved.startsWith("/") && !isSettingsPath(saved)) return saved;
  return getHomePathForProfile(role);
}
