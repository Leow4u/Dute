import { afterEach, describe, expect, it, vi } from "vitest";
import { billingPaidInFinanceiro } from "../../../../functions/wms/src/domain/billing-scope";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function ambiente(projeto: string) {
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", projeto);
  vi.resetModules();
  return {
    modulos: await import("./platform-modules"),
    navegacao: await import("./modules"),
    seletor: await import("./seletor-de-modulo"),
    ambientes: await import("./ambientes"),
    operacao: await import("./operations"),
    pagamento: await import("./financeiro/armazenagem"),
    comercial: await import("./comercial/navegacao"),
    operacaoRotas: await import("./operacao/navegacao"),
    financeiro: await import("./financeiro/navegacao"),
    rh: await import("./rh/navegacao"),
  };
}

describe("produção focada na Armazenagem", () => {
  it("entra direto, sem seletor de módulos, preservando o destino de cada papel", async () => {
    const { modulos, seletor, ambientes } = await ambiente("dute-prod");
    for (const [papel, destino] of [["owner", "/dashboard"], ["admin", "/dashboard"], ["interno", "/dashboard"], ["suporte", "/dashboard"], ["wms", "/pedidos"], ["financeiro", "/faturamento"]] as const) {
      expect(modulos.entrada(papel, null)).toEqual({ kind: "redirect", to: destino });
      expect(modulos.modulesForPerson(papel, null).map(({ module }) => module.key)).toEqual(["wms"]);
      expect(seletor.opcoesDoSeletor(papel, null, destino)).toEqual([]);
    }
    expect(ambientes.moduloDaRota("/faturamento")).toBe("wms");
    expect(ambientes.moduloDaRota("/faturamento/fatura")).toBe("wms");
  });

  it("não registra as telas dos módulos pausados, incluindo Campo e TV", async () => {
    const app = await ambiente("dute-prod");
    expect(app.comercial.rotasDoComercial()).toEqual([]);
    expect(app.operacaoRotas.rotasDaOperacao()).toEqual([]);
    expect(app.financeiro.rotasDoFinanceiro()).toEqual([]);
    expect(app.rh.rotasDoRh()).toEqual([]);
  });

  it("preserva permissões: financeiro só fatura e papéis pausados não ganham Armazenagem", async () => {
    const { modulos, navegacao } = await ambiente("dute-prod");
    for (const papel of ["comercial", "rh", "campo", "painel"] as const) {
      expect(modulos.entrada(papel, null)).toEqual({ kind: "nenhum" });
    }
    const menu = navegacao.getNavigationForProfileRole("financeiro");
    expect(menu.flatMap((item) => item.routes.map((route) => route.href))).toContain("/faturamento");
    expect(menu.flatMap((item) => item.routes.map((route) => route.href))).not.toContain("/estoque");
    expect(menu.flatMap((item) => item.routes.map((route) => route.href))).not.toContain("/financeiro");
    expect(navegacao.getRouteProfileRoles("/estoque")).not.toContain("financeiro");
    expect(navegacao.getRouteProfileRoles("/faturamento/contratos")).toEqual(["owner", "admin"]);
  });

  it("mantém o portal WMS e suas faturas, sem Serviços nem novas permissões contratuais", async () => {
    const { modulos, operacao, navegacao } = await ambiente("dute-prod");
    const perfil = operacao.resolveOperationProfile({ customer_code: "Teste", operation_template: "uniformes", modules: ["wms", "operacao", "financeiro"] });
    expect(modulos.entrada("cliente", perfil)).toEqual({ kind: "redirect", to: "/portal" });
    expect(operacao.portalModulesFor(perfil)).not.toContain("services");
    expect(operacao.portalModulesFor(perfil)).toContain("invoices");
    expect(operacao.leiturasDoPortal(perfil.modules).servicos).toBe(false);
    expect(navegacao.getNavigationForProfileRole("cliente", perfil).flatMap((m) => m.routes.map((r) => r.href))).not.toContain("/portal/servicos");
    expect(navegacao.getNavigationForProfileRole("cliente", null).flatMap((m) => m.routes.map((r) => r.href))).not.toContain("/portal/servicos");
    expect(modulos.entrada("cliente", { modules: ["operacao", "financeiro"] })).toEqual({ kind: "nenhum" });
  });

  it("permite baixa da armazenagem sem encaminhar para o módulo oculto", async () => {
    const { pagamento } = await ambiente("dute-prod");
    expect(pagamento.acaoDaArmazenagem("emitido", null, "financeiro")).toEqual({ tipo: "pagar_no_wms" });
    expect(pagamento.acaoDaArmazenagem("emitido", "fat_existente", "owner")).toEqual({ tipo: "nf_vinculada" });
    expect(pagamento.acaoDaArmazenagem("emitido", null, "suporte")).toBeNull();
    expect(billingPaidInFinanceiro("dute-prod")).toBe(false);
  });

  it("mantém os módulos e o faturamento integrado disponíveis na homologação", async () => {
    const { modulos, pagamento, ambientes } = await ambiente("dute-homolog");
    expect(modulos.modulesForPerson("owner", null).map(({ module }) => module.key)).toEqual(["wms", "operacao", "comercial", "financeiro", "rh"]);
    expect(ambientes.moduloDaRota("/faturamento")).toBe("financeiro");
    expect(pagamento.acaoDaArmazenagem("emitido", null, "financeiro")).toMatchObject({ tipo: "abrir_no_financeiro" });
    expect(billingPaidInFinanceiro("dute-homolog")).toBe(true);
  });

  it("filtra links diretos dos módulos pausados e conserva rotas WMS e configurações", async () => {
    await ambiente("dute-prod");
    const { rotaDisponivelNaArmazenagem } = await import("./somente-armazenagem");
    for (const path of ["/operacao", "/operacao/os", "/comercial/orcamento", "/financeiro/nf", "/rh/pessoas", "/campo/os", "/tv", "/portal/servicos", "/portal/servicos/comprovante"]) {
      expect(rotaDisponivelNaArmazenagem(path)).toBe(false);
      expect(rotaDisponivelNaArmazenagem(path, false)).toBe(true);
    }
    for (const path of ["/dashboard", "/pedidos", "/wms/receber", "/wms/contagem", "/estoque", "/faturamento", "/faturamento/fatura", "/portal/faturas", "/configuracoes/clientes", "/configuracoes/pessoas"]) {
      expect(rotaDisponivelNaArmazenagem(path)).toBe(true);
    }
  });
});
