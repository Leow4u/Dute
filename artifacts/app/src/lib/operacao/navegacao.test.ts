import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getNavigationForProfileRole, getRouteProfileRoles, menuDoOperacao } from "../modules";
import { entrada, modulesForPerson } from "../platform-modules";
import {
  ROTA_COLABORADORES,
  ROTA_VEICULOS,
  abreOperacao,
  rotasDaOperacao,
  soComOperacaoLiberada,
} from "./navegacao";

const APP_SOURCE = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const caminhos = (source: string) => Array.from(source.matchAll(/protectedRoute\(\s*"([^"]+)"/g), ([, path]) => path);
const LIBERADO = true;
const DESLIGADO = false;

describe("navegação do cadastro da Operação", () => {
  it("owner, admin e interno abrem; campo, suporte e comercial não", () => {
    for (const role of ["owner", "admin", "interno"] as const) expect(abreOperacao(role, LIBERADO), role).toBe(true);
    for (const role of ["campo", "suporte", "comercial", "wms", "cliente"] as const) {
      expect(abreOperacao(role, LIBERADO), role).toBe(false);
    }
    expect(abreOperacao("owner", DESLIGADO)).toBe(false);
  });

  it("com a liberação, o interno vê Armazenagem e Operação; o cliente não vê o cadastro", () => {
    expect(modulesForPerson("interno", null, false, true).map((entry) => entry.module.label)).toEqual([
      "Armazenagem",
      "Operação",
    ]);
    expect(entrada("interno", null, false, true)).toEqual({
      kind: "cards",
      modules: modulesForPerson("interno", null, false, true),
    });
    expect(modulesForPerson("cliente", { modules: ["wms", "operacao"] }, false, true).map((entry) => entry.href)).toEqual([
      "/portal",
    ]);
    expect(entrada("cliente", { modules: ["operacao"] }, false, true)).toEqual({ kind: "nenhum" });
  });

  it("sem a liberação, a Operação não entra na entrada nem no menu do WMS", () => {
    expect(modulesForPerson("owner", null, false, false).map((entry) => entry.module.label)).toEqual([
      "Armazenagem",
      "Financeiro",
    ]);
    expect(menuDoOperacao("owner", false)).toEqual([]);
    expect(getNavigationForProfileRole("owner", null, false).some((module) => module.ambiente === "operacao")).toBe(false);
  });

  it("o menu do módulo tem Colaboradores e Veículos para quem grava", () => {
    expect(menuDoOperacao("interno", true).map((item) => [item.label, item.href])).toEqual([
      ["Colaboradores", ROTA_COLABORADORES],
      ["Veículos", ROTA_VEICULOS],
    ]);
    expect(menuDoOperacao("campo", true)).toEqual([]);
    expect(getRouteProfileRoles(ROTA_VEICULOS)).toEqual(["owner", "admin", "interno"]);
  });

  it("toda rota da Operação no App passa pela liberação", () => {
    const blocos = Array.from(APP_SOURCE.matchAll(/soComOperacaoLiberada\(\[([\s\S]*?)\]\)/g), ([, bloco]) => bloco);
    expect(blocos).toHaveLength(1);
    expect(caminhos(blocos[0])).toEqual(rotasDaOperacao(LIBERADO));
    const fora = APP_SOURCE.replace(/soComOperacaoLiberada\(\[[\s\S]*?\]\)/g, "");
    expect(caminhos(fora).filter((path) => path.startsWith("/operacao"))).toEqual([]);
    expect(soComOperacaoLiberada([{ path: ROTA_COLABORADORES }, { path: "/operacao/outra" }], DESLIGADO)).toEqual([]);
    expect(soComOperacaoLiberada([{ path: ROTA_COLABORADORES }, { path: ROTA_VEICULOS }], LIBERADO).map((rota) => rota.path)).toEqual([
      ROTA_COLABORADORES,
      ROTA_VEICULOS,
    ]);
  });
});
