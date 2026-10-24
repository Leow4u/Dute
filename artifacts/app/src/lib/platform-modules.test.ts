import { MODULOS_POR_PAPEL, PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { getHomePathForProfile, getRouteProfileRoles } from "./modules";
import { PLATFORM_MODULES, entrada, modulesForPerson } from "./platform-modules";
import { ROTA_MINHAS_OS } from "./portal/navegacao";

// Comercial desligado, como na produção: o Comercial liberado está em comercial/navegacao.test.ts.
const labels = (role: Papel, modules?: string[]) =>
  modulesForPerson(role, modules ? { modules: modules as never } : null, false, false).map((entry) => entry.module.label);

describe("tela de entrada por módulo (Fase 2, parte 2)", () => {
  it("owner e admin veem os cards de Armazenagem e Financeiro", () => {
    for (const role of ["owner", "admin"] as const) {
      const decision = entrada(role, null, false, false);
      expect(decision.kind).toBe("cards");
      expect(labels(role)).toEqual(["Armazenagem", "Financeiro"]);
    }
  });

  it.each<[Papel, string]>([
    ["interno", "/dashboard"],
    ["suporte", "/dashboard"],
    ["wms", "/pedidos"],
    ["financeiro", "/faturamento"],
  ])("%s tem um módulo só e vai direto para %s, a aterrissagem de antes", (role, path) => {
    expect(entrada(role, null, false, false)).toEqual({ kind: "redirect", to: path });
    expect(path).toBe(getHomePathForProfile(role));
  });

  it("cliente só com armazenagem cai direto no portal do WMS", () => {
    expect(entrada("cliente", { modules: ["wms"] })).toEqual({ kind: "redirect", to: "/portal" });
  });

  it("cliente BTG, sem o campo ou sem perfil carregado, cai direto no portal", () => {
    expect(entrada("cliente", null)).toEqual({ kind: "redirect", to: "/portal" });
    expect(entrada("cliente", { modules: ["wms", "financeiro"] })).toEqual({ kind: "redirect", to: "/portal" });
  });

  it("faturas fazem parte do portal: financeiro nunca vira card para o cliente", () => {
    expect(labels("cliente", ["wms", "financeiro"])).toEqual(["Armazenagem"]);
  });

  it("cliente com armazenagem e operação vai ao Início do portal, sem cards: o portal é um lugar só", () => {
    for (const operacao of [true, false]) {
      expect(entrada("cliente", { modules: ["wms", "operacao"] }, false, operacao)).toEqual({ kind: "redirect", to: "/portal" });
      expect(entrada("cliente", { modules: ["wms", "operacao", "financeiro"] }, false, operacao)).toEqual({ kind: "redirect", to: "/portal" });
    }
  });

  it("cliente só com a Operação vai a Minhas OS, onde a Operação está liberada (parte 4.3b)", () => {
    expect(entrada("cliente", { modules: ["operacao"] }, false, true)).toEqual({ kind: "redirect", to: ROTA_MINHAS_OS });
    expect(entrada("cliente", { modules: ["operacao", "financeiro"] }, false, true)).toEqual({ kind: "redirect", to: ROTA_MINHAS_OS });
    expect(entrada("cliente", { modules: ["operacao"] }, false, false)).toEqual({ kind: "nenhum" });
  });

  it("cliente só com o financeiro e papel sem tela ainda não têm módulo", () => {
    // Faturas fazem parte do portal: sem armazenagem nem Operação, não há serviço que gere fatura.
    expect(entrada("cliente", { modules: ["financeiro"] }, false, true)).toEqual({ kind: "nenhum" });
    for (const role of ["campo", "comercial", "rh", "painel"] as const) {
      expect(entrada(role, null, false)).toEqual({ kind: "nenhum" });
    }
  });

  it("o campo, com a Operação liberada, vai direto para o app dele (parte 3.8b)", () => {
    expect(entrada("campo", null, false, true)).toEqual({ kind: "redirect", to: "/campo" });
    expect(entrada("campo", null, false, false)).toEqual({ kind: "nenhum" });
  });

  it("o painel, com a Operação liberada, vai direto para a TV da sala (parte 3.12b)", () => {
    expect(entrada("painel", null, false, true)).toEqual({ kind: "redirect", to: "/tv" });
    expect(entrada("painel", null, true, true)).toEqual({ kind: "redirect", to: "/tv" });
    expect(entrada("painel", null, false, false)).toEqual({ kind: "nenhum" });
    // Quem coordena continua no Início da Operação; a TV abre por /tv.
    expect(entrada("interno", null, false, true)).toEqual({
      kind: "cards",
      modules: expect.arrayContaining([expect.objectContaining({ href: "/operacao" })]),
    });
  });

  it("sem papel, nenhum módulo", () => {
    expect(entrada(null, null)).toEqual({ kind: "nenhum" });
  });
});

describe("casa de cada módulo", () => {
  it("é uma rota que o papel abre", () => {
    for (const module of PLATFORM_MODULES) {
      for (const [role, path] of Object.entries(module.home)) {
        expect(getRouteProfileRoles(path), `${module.key} → ${role}`).toContain(role);
      }
    }
  });

  it("só existe para papel da equipe que trabalha no módulo", () => {
    for (const module of PLATFORM_MODULES) {
      for (const role of Object.keys(module.home) as Papel[]) {
        if (role === "cliente") continue;
        expect(MODULOS_POR_PAPEL[role], `${module.key} → ${role}`).toContain(module.key);
      }
    }
  });

  it("todo módulo do domínio está no app, uma vez", () => {
    expect(PLATFORM_MODULES.map((module) => module.key).sort()).toEqual(
      ["comercial", "financeiro", "operacao", "rh", "wms"],
    );
    expect(PAPEIS).toContain("cliente");
  });
});
