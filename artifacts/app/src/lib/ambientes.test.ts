import { readFileSync } from "node:fs";

import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { ambienteDaRota, layoutDaRota, moduloDaRota, podeTrocarDeModulo } from "./ambientes";
import { ROTA_FATURAMENTO_WMS, ROTA_FINANCEIRO } from "./financeiro/navegacao";
import { getNavigationForProfileRole, menuDoComercial, menuDoFinanceiro } from "./modules";

/**
 * O caminho escolhe o ambiente. A liberação entra explícita: o resultado não
 * depende do .env de quem roda o teste.
 */

const APP_SOURCE = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const caminhos = Array.from(APP_SOURCE.matchAll(/protectedRoute\(\s*"([^"]+)"/g), ([, path]) => path);

describe("ambiente da rota", () => {
  it("o prefixo /comercial é o Comercial, inclusive com busca", () => {
    expect(ambienteDaRota("/comercial")).toBe("comercial");
    expect(ambienteDaRota("/comercial/clientes")).toBe("comercial");
    expect(ambienteDaRota("/comercial/orcamento/documento?numero=10045&rv=1")).toBe("comercial");
    expect(layoutDaRota("/comercial/medicoes?contrato=safra&competencia=2026-09")).toBe("comercial");
  });

  it("um caminho parecido não vira Comercial", () => {
    expect(ambienteDaRota("/comercialidade")).toBe("wms");
    expect(layoutDaRota("/comercialidade")).toBe("app");
  });

  it("WMS, portal e faturamento ficam no shell de hoje", () => {
    for (const path of ["/dashboard", "/pedidos", "/estoque/mapa", "/faturamento", "/faturamento/fatura", "/portal", "/portal/faturas", "/reports"]) {
      expect(ambienteDaRota(path), path).toBe("wms");
      expect(layoutDaRota(path), path).toBe("app");
    }
  });

  it("configuração tem shell próprio e não é módulo", () => {
    expect(ambienteDaRota("/configuracoes")).toBe("wms");
    expect(layoutDaRota("/configuracoes")).toBe("settings");
    expect(layoutDaRota("/configuracoes/clientes?x=1")).toBe("settings");
    expect(moduloDaRota("/configuracoes")).toBeNull();
    expect(moduloDaRota("/configuracoes/aplicativo")).toBeNull();
  });

  it("marca Comercial, Financeiro ou Armazenagem conforme a casa da rota", () => {
    expect(moduloDaRota("/comercial")).toBe("comercial");
    expect(moduloDaRota("/comercial/orcamento?numero=1")).toBe("comercial");
    expect(moduloDaRota("/operacao")).toBe("operacao");
    expect(moduloDaRota("/operacao/colaboradores")).toBe("operacao");
    expect(moduloDaRota("/faturamento")).toBe("financeiro");
    expect(moduloDaRota("/faturamento/fatura")).toBe("financeiro");
    expect(moduloDaRota("/dashboard")).toBe("wms");
    expect(moduloDaRota("/estoque/mapa")).toBe("wms");
    expect(moduloDaRota("/portal/faturas")).toBe("wms");
  });

  it("toda rota protegida do App cai no shell do caminho", () => {
    expect(caminhos.filter((path) => path.startsWith("/comercial"))).not.toEqual([]);
    expect(caminhos.filter((path) => path.startsWith("/operacao"))).not.toEqual([]);
    expect(caminhos.filter((path) => path.startsWith("/campo"))).toEqual(["/campo", "/campo/os", "/campo/concluir"]);
    expect(caminhos.filter((path) => path.startsWith("/tv"))).toEqual(["/tv"]);
    expect(caminhos.filter((path) => path.startsWith("/financeiro"))).toEqual([
      "/financeiro",
      "/financeiro/a-faturar",
      "/financeiro/a-receber",
      "/financeiro/vencidos",
      "/financeiro/pagos",
      "/financeiro/faturas",
      "/financeiro/nf",
      "/financeiro/relatorios",
      // O Agent Dute do Financeiro (parte 5.5j), no shell dele.
      "/financeiro/agente",
    ]);
    for (const path of caminhos) {
      const esperado = path.startsWith("/financeiro")
        ? "financeiro"
        : path.startsWith("/comercial")
        ? "comercial"
        : path.startsWith("/operacao")
          ? "operacao"
          : path.startsWith("/campo")
            ? "campo"
            : path.startsWith("/tv")
              ? "tv"
              : path.startsWith("/configuracoes")
                ? "settings"
                : "app";
      expect(layoutDaRota(path), path).toBe(esperado);
    }
  });

  it("o menu do WMS nunca aponta para o shell do Comercial, e o do Comercial nunca aponta para o WMS", () => {
    for (const role of PAPEIS) {
      // Sem a liberação do Financeiro: com ela, o financeiro tem o link de volta (teste abaixo).
      for (const module of getNavigationForProfileRole(role, null, true, false)) {
        expect(module.ambiente ?? "wms", `${role} ${module.label}`).toBe("wms");
        for (const route of module.routes) {
          if (!route.href) continue;
          expect(layoutDaRota(route.href), route.href).toBe("app");
        }
      }
      for (const item of menuDoComercial(role, true)) {
        expect(ambienteDaRota(item.href!), item.href).toBe("comercial");
        expect(layoutDaRota(item.href!), item.href).toBe("comercial");
      }
    }
  });

  it("o Financeiro e o Faturamento da armazenagem se alcançam: são os únicos links entre os dois shells", () => {
    for (const role of PAPEIS) {
      for (const module of getNavigationForProfileRole(role, null, true, true)) {
        for (const route of module.routes) {
          if (!route.href) continue;
          const esperado = role === "financeiro" && route.href === ROTA_FINANCEIRO ? "financeiro" : "app";
          expect(layoutDaRota(route.href), `${role} ${route.href}`).toBe(esperado);
        }
      }
      for (const item of menuDoFinanceiro(role, true)) {
        expect(layoutDaRota(item.href!), item.href).toBe(item.href === ROTA_FATURAMENTO_WMS ? "app" : "financeiro");
      }
    }
  });
});

describe("troca de módulo", () => {
  it("só aparece com a plataforma liberada e dois ou mais módulos com tela", () => {
    expect(podeTrocarDeModulo("owner", null, true, true)).toBe(true);
    expect(podeTrocarDeModulo("admin", null, true, true)).toBe(true);
    // Armazenagem e Financeiro já são dois, mesmo sem o Comercial.
    expect(podeTrocarDeModulo("owner", null, false, true)).toBe(true);
    expect(podeTrocarDeModulo("owner", null, true, false)).toBe(false);
    expect(podeTrocarDeModulo("admin", null, false, false)).toBe(false);
  });

  it("quem tem um módulo só não vê o atalho: a entrada devolveria para a casa", () => {
    const umSo: Papel[] = ["comercial", "wms", "financeiro", "interno", "suporte"];
    for (const role of umSo) {
      expect(podeTrocarDeModulo(role, null, true, true, false), role).toBe(false);
    }
    expect(podeTrocarDeModulo("comercial", null, false, true)).toBe(false);
    expect(podeTrocarDeModulo(null, null, true, true)).toBe(false);
  });

  it("o cliente não troca enquanto só a Armazenagem tem casa", () => {
    expect(podeTrocarDeModulo("cliente", { modules: ["wms", "operacao", "financeiro"] }, true, true)).toBe(false);
    expect(podeTrocarDeModulo("cliente", null, true, true)).toBe(false);
  });
});
