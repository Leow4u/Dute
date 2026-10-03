import { describe, expect, it } from "vitest";

import type { ProfileRole } from "./modules";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  canChooseTheme,
  normalizeThemePreference,
  resolveTheme,
  themeColorFor,
} from "./theme";

describe("quem pode escolher o tema", () => {
  // Todas as telas leem tokens de tema (trava em theme-colors.test.ts), então
  // qualquer perfil logado escolhe o tema em Configuração > Minha conta.
  it.each<ProfileRole>(["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"])(
    "%s vê o seletor",
    (role) => {
      expect(canChooseTheme(role)).toBe(true);
    },
  );

  it("sem perfil carregado (login, convite), não escolhe", () => {
    expect(canChooseTheme(null)).toBe(false);
    expect(canChooseTheme(undefined)).toBe(false);
  });
});

describe("preferência de tema", () => {
  it("padrão é claro, para não mudar a tela de quem já usa o sistema", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("aceita só os três valores conhecidos", () => {
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("system")).toBe("system");
  });

  it("qualquer outro valor (storage antigo, lixo) vira o padrão", () => {
    expect(normalizeThemePreference("blue")).toBe(DEFAULT_THEME);
    expect(normalizeThemePreference(null)).toBe(DEFAULT_THEME);
    expect(normalizeThemePreference(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeThemePreference(1)).toBe(DEFAULT_THEME);
  });

  it("as opções do seletor cobrem exatamente os valores aceitos", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([
      "light",
      "dark",
      "system",
    ]);
    for (const option of THEME_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("a chave do storage tem o prefixo do app", () => {
    expect(THEME_STORAGE_KEY.startsWith("dute.")).toBe(true);
  });
});

describe("tema resolvido", () => {
  it("claro e escuro ignoram o sistema", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("sistema segue a preferência do aparelho", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("cor da barra do navegador (theme-color)", () => {
  // Precisa casar com --background de cada tema em index.css, senão a barra
  // do celular fica de uma cor e a tela de outra.
  it("claro usa o fundo do app", () => {
    expect(themeColorFor("light")).toBe("#FAFAF8");
  });

  it("escuro usa o fundo escuro", () => {
    expect(themeColorFor("dark")).toBe("#060a13");
  });
});
