import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { layoutDaRota, moduloDaRota } from "../ambientes";
import { getHomePathForProfile, getNavigationForProfileRole, getRouteProfileRoles, menuDoFinanceiro } from "../modules";
import { entrada, modulesForPerson } from "../platform-modules";
import { opcoesDoSeletor } from "../seletor-de-modulo";
import {
  FINANCEIRO_ROLES,
  ROTA_A_FATURAR,
  ROTA_A_RECEBER,
  ROTA_FATURAMENTO_WMS,
  ROTA_FATURAS,
  ROTA_FINANCEIRO,
  ROTA_PAGOS,
  ROTA_VENCIDOS,
  abreFinanceiro,
  hrefDaNf,
  nfDaBusca,
  rotasDoFinanceiro,
  soComFinanceiroLiberado,
} from "./navegacao";

/**
 * O shell do Financeiro (parte 4.1b de docs/plataforma/fase-4-financeiro.md):
 * /financeiro com o Início e A faturar, só com a liberação do Financeiro.
 * Fora dela, o card do Financeiro leva ao Faturamento do WMS, como antes. O
 * Faturamento da armazenagem continua no shell do WMS até a Fase 7, e os dois
 * shells se alcançam.
 */

const APP_SOURCE = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const caminhos = (source: string) => Array.from(source.matchAll(/protectedRoute\(\s*"([^"]+)"/g), ([, path]) => path);
const LIBERADO = true;
const DESLIGADO = false;

describe("navegação do Financeiro", () => {
  it("owner, admin e financeiro abrem, a mesma lista das callables; os outros papéis não", () => {
    expect([...FINANCEIRO_ROLES]).toEqual(["owner", "admin", "financeiro"]);
    for (const role of FINANCEIRO_ROLES) expect(abreFinanceiro(role, LIBERADO), role).toBe(true);
    for (const role of ["interno", "comercial", "campo", "suporte", "wms", "rh", "painel", "cliente"] as const) {
      expect(abreFinanceiro(role, LIBERADO), role).toBe(false);
    }
    expect(abreFinanceiro("owner", DESLIGADO)).toBe(false);
    expect(abreFinanceiro(null, LIBERADO)).toBe(false);
  });

  it("com a liberação, o card do Financeiro leva ao shell dele; sem ela, ao Faturamento do WMS", () => {
    const card = (liberado: boolean) => modulesForPerson("owner", null, false, false, liberado).find((item) => item.module.key === "financeiro")?.href;
    expect(card(LIBERADO)).toBe(ROTA_FINANCEIRO);
    expect(card(DESLIGADO)).toBe("/faturamento");
    // O financeiro tem um módulo só: a entrada vai direto para a casa dele.
    expect(entrada("financeiro", null, false, false, LIBERADO)).toEqual({ kind: "redirect", to: ROTA_FINANCEIRO });
    expect(entrada("financeiro", null, false, false, DESLIGADO)).toEqual({ kind: "redirect", to: "/faturamento" });
    expect(getHomePathForProfile("financeiro", false, LIBERADO)).toBe(ROTA_FINANCEIRO);
    expect(getHomePathForProfile("financeiro", false, DESLIGADO)).toBe("/faturamento");
    // O cliente não tem card do Financeiro: as faturas fazem parte do portal.
    expect(modulesForPerson("cliente", { modules: ["wms", "financeiro"] }, false, false, LIBERADO).map((item) => item.href)).toEqual(["/portal"]);
  });

  it("o menu do módulo tem o Início, A faturar, a cobrança e a Armazenagem, que leva ao Faturamento do WMS", () => {
    expect(menuDoFinanceiro("financeiro", LIBERADO).map((item) => [item.label, item.href])).toEqual([
      ["Início", ROTA_FINANCEIRO],
      ["A faturar", ROTA_A_FATURAR],
      ["A receber", ROTA_A_RECEBER],
      ["Vencidos", ROTA_VENCIDOS],
      ["Pagos", ROTA_PAGOS],
      ["Faturas", ROTA_FATURAS],
      ["Armazenagem", ROTA_FATURAMENTO_WMS],
    ]);
    // O Início é a casa: rota exata, para não acender nas outras telas.
    expect(menuDoFinanceiro("financeiro", LIBERADO)[0].routes[0].exact).toBe(true);
    expect(menuDoFinanceiro("owner", LIBERADO)).toHaveLength(7);
    for (const role of ["interno", "comercial", "campo", "cliente"] as const) expect(menuDoFinanceiro(role, LIBERADO), role).toEqual([]);
    expect(menuDoFinanceiro("financeiro", DESLIGADO)).toEqual([]);
    for (const item of menuDoFinanceiro("financeiro", LIBERADO)) expect(getRouteProfileRoles(item.href!), item.href).toEqual(["owner", "admin", "financeiro"]);
  });

  it("no WMS, o financeiro volta ao Financeiro pelo item logo antes do Faturamento; owner e admin usam o seletor", () => {
    expect(getNavigationForProfileRole("financeiro", null, false, LIBERADO).map((module) => [module.label, module.href])).toEqual([
      ["Início", "/dashboard"],
      ["Agent Dute", "/agente"],
      ["Financeiro", ROTA_FINANCEIRO],
      ["Faturamento", "/faturamento"],
      ["Relatórios", "/reports"],
      ["Documentos", "/documentos"],
    ]);
    expect(getNavigationForProfileRole("financeiro", null, false, DESLIGADO).some((module) => module.href === ROTA_FINANCEIRO)).toBe(false);
    expect(getNavigationForProfileRole("owner", null, false, LIBERADO).some((module) => module.href === ROTA_FINANCEIRO)).toBe(false);
    const seletor = opcoesDoSeletor("owner", null, "/faturamento", { comercial: false, plataforma: true, operacao: false, financeiro: LIBERADO });
    expect(seletor.map((opcao) => [opcao.label, opcao.href, opcao.atual])).toEqual([
      ["Armazenagem", "/dashboard", false],
      ["Financeiro", ROTA_FINANCEIRO, true],
    ]);
  });

  it("/financeiro abre o shell do Financeiro; o Faturamento do WMS continua no shell do WMS", () => {
    expect(layoutDaRota(ROTA_FINANCEIRO)).toBe("financeiro");
    expect(layoutDaRota(ROTA_A_FATURAR)).toBe("financeiro");
    expect(layoutDaRota("/faturamento")).toBe("app");
    expect(moduloDaRota(ROTA_A_FATURAR)).toBe("financeiro");
    expect(moduloDaRota("/financeiros")).toBe("wms");
  });

  it("toda rota do Financeiro no App passa pela liberação", () => {
    const blocos = Array.from(APP_SOURCE.matchAll(/soComFinanceiroLiberado\(\[([\s\S]*?)\]\)/g), ([, bloco]) => bloco);
    expect(blocos).toHaveLength(1);
    expect(caminhos(blocos[0])).toEqual(rotasDoFinanceiro(LIBERADO));
    const fora = APP_SOURCE.replace(/soComFinanceiroLiberado\(\[[\s\S]*?\]\)/g, "");
    expect(caminhos(fora).filter((path) => path.startsWith("/financeiro"))).toEqual([]);
    expect(rotasDoFinanceiro(LIBERADO)).toEqual([ROTA_FINANCEIRO, ROTA_A_FATURAR, ROTA_A_RECEBER, ROTA_VENCIDOS, ROTA_PAGOS, ROTA_FATURAS]);
    expect(rotasDoFinanceiro(DESLIGADO)).toEqual([]);
    expect(soComFinanceiroLiberado([{ path: ROTA_FINANCEIRO }, { path: "/financeiro/outra" }], LIBERADO).map((rota) => rota.path)).toEqual([ROTA_FINANCEIRO]);
    expect(soComFinanceiroLiberado([{ path: ROTA_FINANCEIRO }], DESLIGADO)).toEqual([]);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/financeiro", FinanceiroInicio\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/financeiro\/a-faturar", FinanceiroAFaturar\)/);
    expect(APP_SOURCE).toMatch(/financeiro: FinanceiroLayout/);
  });

  it("a NF aberta fica na URL da lista; id fora do formato não abre nada", () => {
    const id = "fat_0123456789abcdef01234567";
    expect(hrefDaNf(ROTA_VENCIDOS, id)).toBe(`/financeiro/vencidos?nf=${id}`);
    expect(nfDaBusca(`?nf=${id}`)).toBe(id);
    expect(nfDaBusca("?nf=fat_x")).toBeNull();
    expect(nfDaBusca("")).toBeNull();
  });
});
