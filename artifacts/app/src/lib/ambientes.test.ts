import { readFileSync } from "node:fs";

import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { ambienteDaRota, layoutDaRota, podeTrocarDeModulo } from "./ambientes";
import { getNavigationForProfileRole, menuDoComercial } from "./modules";

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
  });

  it("toda rota protegida do App cai no shell do caminho", () => {
    expect(caminhos.filter((path) => path.startsWith("/comercial"))).not.toEqual([]);
    for (const path of caminhos) {
      expect(layoutDaRota(path), path).toBe(path.startsWith("/comercial") ? "comercial" : path.startsWith("/configuracoes") ? "settings" : "app");
    }
  });

  it("o menu do WMS nunca aponta para o shell do Comercial, e o do Comercial nunca aponta para o WMS", () => {
    for (const role of PAPEIS) {
      for (const module of getNavigationForProfileRole(role, null, true)) {
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
      expect(podeTrocarDeModulo(role, null, true, true), role).toBe(false);
    }
    expect(podeTrocarDeModulo("comercial", null, false, true)).toBe(false);
    expect(podeTrocarDeModulo(null, null, true, true)).toBe(false);
  });

  it("o cliente não troca enquanto só a Armazenagem tem casa", () => {
    expect(podeTrocarDeModulo("cliente", { modules: ["wms", "operacao", "financeiro"] }, true, true)).toBe(false);
    expect(podeTrocarDeModulo("cliente", null, true, true)).toBe(false);
  });
});
