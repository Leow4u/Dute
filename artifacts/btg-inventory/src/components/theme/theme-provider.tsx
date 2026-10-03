import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";

import { useAppUser } from "@/lib/auth";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  canChooseTheme,
  themeColorFor,
} from "@/lib/theme";

/**
 * Liga o next-themes ao perfil. Qualquer perfil logado usa o tema que escolheu
 * em Configuração > Minha conta; sem perfil (login, convite) o tema é forçado
 * para o claro, sem apagar o que estiver salvo no aparelho.
 *
 * Precisa ficar dentro do AuthProvider. Enquanto o perfil não carregou, não
 * força nada: quem usa escuro não vê a tela piscar em claro.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useAppUser();
  const role = user?.publicMetadata.role;
  const forcedTheme = isLoaded && !canChooseTheme(role) ? DEFAULT_THEME : undefined;

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      forcedTheme={forcedTheme}
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

/** Barra do navegador no celular acompanha o fundo do tema em uso. */
function ThemeColorSync() {
  const { resolvedTheme, forcedTheme } = useTheme();

  useEffect(() => {
    const theme = forcedTheme === "dark" || (!forcedTheme && resolvedTheme === "dark")
      ? "dark"
      : "light";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = themeColorFor(theme);
  }, [resolvedTheme, forcedTheme]);

  return null;
}
