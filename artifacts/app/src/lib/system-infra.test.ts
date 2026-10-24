import { describe, expect, it } from "vitest";

import { functionRoute } from "./functions-api";
import {
  codebaseLabel,
  errorsToShow,
  functionsNote,
  functionsToShow,
  infraTiles,
  serviceNames,
  vertexComparison,
  type FunctionRow,
  type SystemInfra,
} from "./system-infra";

const row = (name: string, status: FunctionRow["status"], codebase = "default"): FunctionRow => ({
  name,
  codebase,
  service: name.toLowerCase(),
  status,
  state: status === "nao_publicada" ? null : "ACTIVE",
  updated_at: null,
  fix: status === "ok" ? null : "comando",
});

const infra: SystemInfra = {
  checked_at: "2026-10-03T15:00:00Z",
  settings: { billing_table: null },
  errors: {
    status: "ok",
    total: 7,
    blocked: 3,
    services: 2,
    groups: [{ service: "readshipmentinvoice", message: "x", count: 5, first_at: "", last_at: "", blocked: false, admin: false }],
  },
  functions: {
    status: "ok",
    total: 52,
    ok: 50,
    sem_acesso: 1,
    nao_publicada: 1,
    codebases: ["default", "comercial"],
    last_deploy_at: null,
    list: [row("getSystemDashboard", "nao_publicada"), row("saveAgentCostSettings", "sem_acesso"), row("readShipmentInvoice", "ok"), row("advanceQuote", "ok", "comercial")],
  },
  billing: { status: "not_configured" },
};

describe("painel do sistema: infraestrutura", () => {
  it("rotas vão para as callables certas", async () => {
    expect(functionRoute("/api/system/infra", "GET")?.name).toBe("getSystemInfra");
    const save = functionRoute("/api/system/infra-settings", "POST");
    expect(save?.name).toBe("saveSystemInfraSettings");
    expect(await save?.payload("/api/system/infra-settings", { method: "POST", body: JSON.stringify({ billing_table: "a.b.c" }) })).toEqual({ billing_table: "a.b.c" });
  });

  it("quadros do topo: erros, bloqueadas e functions com problema", () => {
    const tiles = infraTiles(infra, false);
    expect(tiles.errors).toEqual({ value: "7 erros em 2 functions", detail: "+ 3 chamadas bloqueadas", tone: "bad" });
    expect(tiles.functions).toEqual({ value: "50 de 52 ok", detail: "1 sem acesso · 1 não publicada", tone: "bad" });

    const clean = infraTiles(
      {
        ...infra,
        errors: { status: "ok", total: 0, blocked: 0, services: 0, groups: [] },
        functions: { status: "ok", total: 52, ok: 52, sem_acesso: 0, nao_publicada: 0, codebases: ["default"], last_deploy_at: null, list: [] },
      },
      false,
    );
    expect(clean.errors).toEqual({ value: "Nenhum erro", detail: "Nenhuma chamada bloqueada", tone: "ok" });
    expect(clean.functions).toEqual({ value: "52 functions ok", detail: "Todas publicadas e com acesso", tone: "ok" });

    expect(infraTiles(undefined, true).errors.value).toBe("Verificando…");
    expect(infraTiles({ ...infra, errors: { status: "error", message: "403" } }, false).errors.value).toBe("Sem leitura");
  });

  it("lista só as functions com problema, a não ser que peça todas; nomes do código no lugar do serviço", () => {
    const list = infra.functions.status === "ok" ? infra.functions.list : [];
    expect(functionsToShow(list, false).map((fn) => fn.name)).toEqual(["getSystemDashboard", "saveAgentCostSettings"]);
    expect(functionsToShow(list, true)).toHaveLength(4);
    const name = serviceNames(infra);
    expect(name("readshipmentinvoice")).toBe("readShipmentInvoice");
    expect(name("dute-btg-app")).toBe("Site (dute-btg-app)");
    expect(name("dute-app")).toBe("Site (dute-app)");
    expect(name("outra")).toBe("outra");
  });

  it("as functions de todas as codebases: o WMS é a codebase default", () => {
    expect(codebaseLabel("default")).toBe("wms");
    expect(codebaseLabel("comercial")).toBe("comercial");
    expect(functionsNote(52, ["default", "comercial", "operacao", "financeiro", "core", "rh"])).toBe("52 functions em 6 codebases");
    expect(functionsNote(1, ["default"])).toBe("1 function em 1 codebase");
    expect(serviceNames(infra)("advancequote")).toBe("advanceQuote");
  });

  it("erros: os 5 mais recentes, ou todos", () => {
    const groups = Array.from({ length: 7 }, (_, index) => ({ service: `s${index}`, message: "m", count: 1, first_at: "", last_at: "", blocked: false, admin: false }));
    expect(errorsToShow(groups, false).map((group) => group.service)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(errorsToShow(groups, true)).toHaveLength(7);
  });

  it("compara o Vertex AI da fatura com a estimativa", () => {
    expect(vertexComparison(0.74, 0.69)).toBe("A estimativa está perto da fatura.");
    expect(vertexComparison(0.5, 1)).toMatch(/acima da fatura/);
    expect(vertexComparison(1, 0.5)).toMatch(/abaixo da fatura/);
    expect(vertexComparison(0, 0.5)).toBeNull();
  });
});
