import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { layoutDaRota, moduloDaRota } from "../ambientes";
import { getHomePathForProfile, getRouteProfileRoles, menuDoRh } from "../modules";
import { entrada, modulesForPerson } from "../platform-modules";
import { opcoesDoSeletor } from "../seletor-de-modulo";
import {
  RH_ROLES,
  ROTA_FICHA,
  ROTA_PESSOAS,
  ROTA_RH,
  abreRh,
  colaboradorDaBusca,
  gravaNoRh,
  hrefDaFicha,
  rotasDoRh,
  soComRhLiberado,
} from "./navegacao";

/**
 * O shell do RH (parte 8.2c de docs/plataforma/fase-8-rh.md): /rh com o
 * Início, Pessoas e a ficha de cada pessoa, só com a liberação do RH, que
 * liga depois da parte 8.1b. Owner e admin leem; só o rh grava.
 */

const APP_SOURCE = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const caminhos = (source: string) => Array.from(source.matchAll(/protectedRoute\(\s*"([^"]+)"/g), ([, path]) => path);
const LIBERADO = true;
const DESLIGADO = false;
const COL = "col_0123456789abcdef";

describe("navegação do RH", () => {
  it("owner, admin e rh abrem, e só o rh grava; os outros papéis não abrem", () => {
    expect([...RH_ROLES]).toEqual(["owner", "admin", "rh"]);
    for (const role of RH_ROLES) expect(abreRh(role, LIBERADO), role).toBe(true);
    for (const role of ["interno", "comercial", "campo", "suporte", "wms", "financeiro", "painel", "cliente"] as const) {
      expect(abreRh(role, LIBERADO), role).toBe(false);
    }
    expect(gravaNoRh("rh", LIBERADO)).toBe(true);
    expect(gravaNoRh("owner", LIBERADO)).toBe(false);
    expect(gravaNoRh("admin", LIBERADO)).toBe(false);
    expect(abreRh("rh", DESLIGADO)).toBe(false);
    expect(gravaNoRh("rh", DESLIGADO)).toBe(false);
  });

  it("com a liberação, o card do RH leva ao Início dele; o rh cai direto lá; sem ela, o RH não existe", () => {
    const card = (liberado: boolean) => modulesForPerson("owner", null, false, false, false, liberado).find((item) => item.module.key === "rh")?.href;
    expect(card(LIBERADO)).toBe(ROTA_RH);
    expect(card(DESLIGADO)).toBeUndefined();
    expect(entrada("rh", null, false, false, false, LIBERADO)).toEqual({ kind: "redirect", to: ROTA_RH });
    expect(entrada("rh", null, false, false, false, DESLIGADO)).toEqual({ kind: "nenhum" });
    expect(getHomePathForProfile("rh", false, false, LIBERADO)).toBe(ROTA_RH);
    expect(getHomePathForProfile("rh", false, false, DESLIGADO)).toBe("/configuracoes/conta");
    // O interno não tem o módulo: nem o card.
    expect(modulesForPerson("interno", null, false, false, false, LIBERADO).some((item) => item.module.key === "rh")).toBe(false);
  });

  it("o menu do módulo tem o Início e Pessoas; a ficha acende Pessoas e tem os papéis do RH", () => {
    expect(menuDoRh("rh", LIBERADO).map((item) => [item.label, item.href])).toEqual([
      ["Início", ROTA_RH],
      ["Pessoas", ROTA_PESSOAS],
    ]);
    expect(menuDoRh("rh", LIBERADO)[0].routes[0].exact).toBe(true);
    expect(menuDoRh("owner", LIBERADO)).toHaveLength(2);
    expect(menuDoRh("rh", DESLIGADO)).toEqual([]);
    for (const role of ["interno", "financeiro", "cliente"] as const) expect(menuDoRh(role, LIBERADO), role).toEqual([]);
    for (const rota of [ROTA_RH, ROTA_PESSOAS, ROTA_FICHA]) expect(getRouteProfileRoles(rota), rota).toEqual(["owner", "admin", "rh"]);
    expect(menuDoRh("rh", LIBERADO)[1].routes[0].tambem).toEqual([ROTA_FICHA]);
  });

  it("owner e admin trocam para o RH pelo seletor", () => {
    const seletor = opcoesDoSeletor("admin", null, ROTA_PESSOAS, { comercial: false, plataforma: true, operacao: false, financeiro: false, rh: LIBERADO });
    expect(seletor.map((opcao) => [opcao.label, opcao.href, opcao.atual])).toEqual([
      ["Armazenagem", "/dashboard", false],
      ["Financeiro", "/faturamento", false],
      ["RH", ROTA_RH, true],
    ]);
  });

  it("/rh abre o shell do RH", () => {
    expect(layoutDaRota(ROTA_RH)).toBe("rh");
    expect(layoutDaRota(ROTA_FICHA)).toBe("rh");
    expect(moduloDaRota(ROTA_PESSOAS)).toBe("rh");
    expect(moduloDaRota("/rhs")).toBe("wms");
  });

  it("toda rota do RH no App passa pela liberação", () => {
    const blocos = Array.from(APP_SOURCE.matchAll(/soComRhLiberado\(\[([\s\S]*?)\]\)/g), ([, bloco]) => bloco);
    expect(blocos).toHaveLength(1);
    expect(caminhos(blocos[0])).toEqual(rotasDoRh(LIBERADO));
    const fora = APP_SOURCE.replace(/soComRhLiberado\(\[[\s\S]*?\]\)/g, "");
    expect(caminhos(fora).filter((path) => path === ROTA_RH || path.startsWith(`${ROTA_RH}/`))).toEqual([]);
    expect(rotasDoRh(LIBERADO)).toEqual([ROTA_RH, ROTA_PESSOAS, ROTA_FICHA]);
    expect(rotasDoRh(DESLIGADO)).toEqual([]);
    expect(soComRhLiberado([{ path: ROTA_RH }], DESLIGADO)).toEqual([]);
  });

  it("a ficha pela URL: o id do cadastro, e nada além dele", () => {
    expect(hrefDaFicha(COL)).toBe(`/rh/ficha?colaborador=${COL}`);
    expect(colaboradorDaBusca(`?colaborador=${COL}`)).toBe(COL);
    expect(colaboradorDaBusca("?colaborador=../users")).toBeNull();
    expect(colaboradorDaBusca("")).toBeNull();
  });
});
