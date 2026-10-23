import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ROTA_CAMPO, ROTA_CAMPO_OS } from "../campo/navegacao";
import { getNavigationForProfileRole, getRouteProfileRoles, menuDoOperacao } from "../modules";
import { entrada, modulesForPerson } from "../platform-modules";
import {
  ROTA_AGENDA,
  ROTA_COLABORADORES,
  ROTA_DEMANDA,
  ROTA_DEMANDAS,
  ROTA_HOJE,
  ROTA_NOVA_DEMANDA,
  ROTA_PLANEJAR,
  ROTA_OPERACAO,
  ROTA_OS,
  ROTA_VEICULOS,
  abreOperacao,
  colaboradorDaBusca,
  demandaDaBusca,
  demandaDoPlanoDaBusca,
  fichaDaBusca,
  hrefDaFichaDaOs,
  hrefDaOs,
  hrefDaSemana,
  hrefDaDemanda,
  hrefDoPlano,
  hrefDoColaborador,
  osDaBusca,
  semanaDaBusca,
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

  it("o menu do módulo tem o Início, o Hoje, a Agenda, Demandas, Colaboradores e Veículos para quem grava", () => {
    expect(menuDoOperacao("interno", true).map((item) => [item.label, item.href])).toEqual([
      ["Início", ROTA_OPERACAO],
      ["Hoje", ROTA_HOJE],
      ["Agenda", ROTA_AGENDA],
      ["Demandas", ROTA_DEMANDAS],
      ["Colaboradores", ROTA_COLABORADORES],
      ["Veículos", ROTA_VEICULOS],
    ]);
    // O Início é a casa: rota exata, para não acender nas outras telas.
    expect(menuDoOperacao("interno", true)[0].routes[0].exact).toBe(true);
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
    expect(
      soComOperacaoLiberada([{ path: ROTA_OPERACAO }, { path: ROTA_HOJE }, { path: ROTA_COLABORADORES }, { path: ROTA_VEICULOS }], LIBERADO).map(
        (rota) => rota.path,
      ),
    ).toEqual([ROTA_OPERACAO, ROTA_HOJE, ROTA_COLABORADORES, ROTA_VEICULOS]);
  });

  it("/operacao é o Início (parte 2.6) e o Hoje (parte 3.5a) mora em /operacao/hoje", () => {
    expect(rotasDaOperacao(LIBERADO)).toEqual([ROTA_OPERACAO, ROTA_HOJE, ROTA_AGENDA, ROTA_DEMANDAS, ROTA_DEMANDA, ROTA_NOVA_DEMANDA, ROTA_PLANEJAR, ROTA_OS, ROTA_COLABORADORES, ROTA_VEICULOS, ROTA_CAMPO, ROTA_CAMPO_OS]);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao", OperacaoInicio\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/hoje", OperacaoHoje\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/agenda", OperacaoAgenda\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/demandas", OperacaoDemandas\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/demanda", OperacaoDemanda\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/nova-demanda", OperacaoDemandaNova\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/planejar", OperacaoPlanejar\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/operacao\/os", OperacaoOs\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/campo", CampoHoje\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/campo\/os", CampoOs\)/);
  });

  it("links diretos: a OS na fila e o colaborador no cadastro, de ida e volta", () => {
    expect(hrefDaOs("10045-01")).toBe("/operacao/hoje?os=10045-01");
    expect(osDaBusca("?os=10045-01")).toBe("10045-01");
    expect(osDaBusca("os=")).toBeNull();
    expect(osDaBusca("")).toBeNull();
    const href = hrefDoColaborador("col_0123456789abcdef");
    expect(href).toBe("/operacao/colaboradores?id=col_0123456789abcdef");
    expect(colaboradorDaBusca(href.slice(href.indexOf("?")))).toBe("col_0123456789abcdef");
    expect(colaboradorDaBusca("?outro=1")).toBeNull();
    expect(hrefDaDemanda("10045")).toBe("/operacao/demanda?numero=10045");
    expect(demandaDaBusca("?numero=10045")).toBe("10045");
    expect(demandaDaBusca("?numero=10045-01")).toBeNull();
    expect(demandaDaBusca("")).toBeNull();
    expect(hrefDoPlano("10045")).toBe("/operacao/planejar?demanda=10045");
    expect(demandaDoPlanoDaBusca("?demanda=10045")).toBe("10045");
    expect(demandaDoPlanoDaBusca("?demanda=abc")).toBeNull();
    expect(hrefDaFichaDaOs("10045-01")).toBe("/operacao/os?numero=10045-01");
    expect(fichaDaBusca("?numero=10045-01")).toBe("10045-01");
    expect(fichaDaBusca("?numero=10045")).toBeNull();
    expect(hrefDaSemana("2026-10-19")).toBe("/operacao/agenda?semana=2026-10-19");
    expect(semanaDaBusca("?semana=2026-10-19")).toBe("2026-10-19");
    expect(semanaDaBusca("?semana=19/10/2026")).toBeNull();
    expect(semanaDaBusca("")).toBeNull();
  });
});
