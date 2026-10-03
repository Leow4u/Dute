import { ACCESS_ADMIN_ROLES, canAccessModule, type ProfileRole } from "./modules";

/**
 * Tema claro/escuro.
 *
 * A troca em si é feita pelo next-themes (classe `dark` no <html>, persistência
 * em localStorage, preferência do sistema). Este módulo guarda o que é regra
 * do produto e precisa de teste: quem pode escolher, qual é o padrão e qual
 * cor a barra do navegador recebe em cada tema.
 *
 * O modo escuro ainda está em construção: os tokens existem em index.css, mas
 * várias telas usam cor fixa (bg-white, text-slate-*). Até essa limpeza
 * terminar, o seletor fica restrito à administração e todo mundo mais segue
 * no claro, independente do que houver salvo no aparelho.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "dute.theme";

/** Claro, e não "system": quem usa o aparelho no escuro não pode ser surpreendido. */
export const DEFAULT_THEME: ThemePreference = "light";

export const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  { value: "light", label: "Claro", description: "Sempre claro, como hoje." },
  { value: "dark", label: "Escuro", description: "Sempre escuro." },
  { value: "system", label: "Sistema", description: "Segue o aparelho." },
];

/**
 * Cor da barra do navegador no celular (meta theme-color). Precisa casar com
 * --background de cada tema em index.css.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#FAFAF8",
  dark: "#060a13",
};

export function canChooseTheme(role: ProfileRole | null | undefined): boolean {
  return canAccessModule(role, ACCESS_ADMIN_ROLES);
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function themeColorFor(theme: ResolvedTheme): string {
  return THEME_COLORS[theme];
}
