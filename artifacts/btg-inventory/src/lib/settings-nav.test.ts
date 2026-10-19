import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouteAppRoles, getRouteProfileRoles, type ProfileRole } from "./modules";
import {
  LEGACY_SETTINGS_REDIRECTS,
  SETTINGS_SECTIONS,
  getActiveSettingsSection,
  getReturnPath,
  getSettingsSections,
  isSettingsPath,
  rememberReturnPath,
} from "./settings-nav";

const labels = (role: ProfileRole) => getSettingsSections(role).map((section) => section.label);

describe("seções da Configuração por perfil", () => {
  it.each<ProfileRole>(["owner", "admin"])("%s vê conta e Administração inteira", (role) => {
    expect(labels(role)).toEqual([
      "Minha conta",
      "Aplicativo no celular",
      "Pessoas e acessos",
      "Clientes",
      "Sistema",
    ]);
  });

  it("suporte vê Sistema, mas não pessoas nem cliente", () => {
    expect(labels("suporte")).toEqual(["Minha conta", "Aplicativo no celular", "Sistema"]);
  });

  it.each<ProfileRole>(["wms", "interno", "financeiro", "cliente"])(
    "%s vê só a própria conta",
    (role) => {
      expect(labels(role)).toEqual(["Minha conta", "Aplicativo no celular"]);
    },
  );

  it("cada seção abre uma rota com os mesmos papéis do menu", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect([...getRouteProfileRoles(section.href)].sort()).toEqual([...section.roles].sort());
    }
  });

  it("o portal do cliente também entra na própria conta", () => {
    expect(getRouteAppRoles("/configuracoes/conta")).toContain("cliente");
    expect(getRouteAppRoles("/configuracoes/pessoas")).not.toContain("cliente");
  });
});

describe("endereços antigos da Administração", () => {
  it("redirecionam para a seção com os mesmos papéis", () => {
    for (const [from, to] of Object.entries(LEGACY_SETTINGS_REDIRECTS)) {
      expect(getRouteProfileRoles(from)).toEqual(getRouteProfileRoles(to));
    }
  });
});

describe("rotas e seção ativa", () => {
  it("reconhece a Configuração", () => {
    expect(isSettingsPath("/configuracoes")).toBe(true);
    expect(isSettingsPath("/configuracoes/sistema")).toBe(true);
    expect(isSettingsPath("/configuracoes?x=1")).toBe(true);
    expect(isSettingsPath("/faturamento")).toBe(false);
  });

  it("a raiz acende Minha conta", () => {
    expect(getActiveSettingsSection("/configuracoes")).toBe("conta");
    expect(getActiveSettingsSection("/configuracoes/clientes")).toBe("clientes");
    expect(getActiveSettingsSection("/configuracoes/pessoas?convidar=cliente")).toBe("pessoas");
  });
});

describe("Voltar", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("volta para a última tela do app", () => {
    rememberReturnPath("/faturamento?competencia=2026-08");
    expect(getReturnPath("admin")).toBe("/faturamento?competencia=2026-08");
  });

  it("ignora telas da própria Configuração", () => {
    rememberReturnPath("/estoque");
    rememberReturnPath("/configuracoes/sistema");
    expect(getReturnPath("admin")).toBe("/estoque");
  });

  it("sem storage (aba privada), cai na tela inicial do perfil", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    rememberReturnPath("/estoque");
    expect(getReturnPath("financeiro")).toBe("/faturamento");
  });

  it("sem histórico, cai na tela inicial do perfil", () => {
    expect(getReturnPath("wms")).toBe("/pedidos");
    expect(getReturnPath("cliente")).toBe("/portal");
  });
});
