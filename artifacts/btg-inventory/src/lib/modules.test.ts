import { describe, expect, it } from "vitest";

import {
  getActiveModule,
  getHomePathForProfile,
  getMobileNavigation,
  getNavigationForProfileRole,
  getRouteProfileRoles,
  INTERNAL_ROLES,
  isAccountPath,
  type ProfileRole,
} from "./modules";

// Quem acessa cada rota, fixado em 29/09/2026 antes de enxugar o menu. As
// permissões por rota são derivadas das entradas do menu; mexer na régua não
// pode mudar quem entra em cada tela.
const ROUTE_ACCESS: Array<[string, ProfileRole[]]> = [
  ["/dashboard", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/reports", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/solicitacoes", ["owner", "admin", "interno", "suporte"]],
  ["/wms/receber", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/pedidos", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/contagem", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/recebimento", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/inventario", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/qualidade", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/putaway", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/picking", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/packing", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/expedicao", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/devolucoes", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms/excecoes", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/wms", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/catalogo", ["owner", "admin", "interno", "suporte"]],
  ["/catalogo/saldos", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/catalogo/mapa", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/warehouse", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/products", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/skus", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/estoque", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/movements", ["owner", "admin", "interno", "suporte"]],
  ["/pedidos", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/orders", ["owner", "admin", "interno", "suporte"]],
  ["/faturamento", ["owner", "admin", "financeiro"]],
  ["/faturamento/tabela", ["owner", "admin", "financeiro"]],
  ["/faturamento/fatura", ["owner", "admin", "financeiro"]],
  ["/tabela-precos", ["owner", "admin", "financeiro"]],
  // A conversa com o agente é de toda a equipe; o painel segue com a torre.
  ["/agente", ["owner", "admin", "interno", "wms", "financeiro", "suporte"]],
  ["/agente/painel", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/agente/conhecimento", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/suporte", ["owner", "admin", "suporte"]],
  ["/documentos", ["owner", "admin", "interno", "wms", "financeiro", "suporte"]],
  ["/clientes", ["owner", "admin"]],
  ["/usuarios", ["owner", "admin"]],
  ["/configuracoes", ["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"]],
  ["/configuracoes/conta", ["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"]],
  ["/configuracoes/aplicativo", ["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"]],
  ["/configuracoes/pessoas", ["owner", "admin"]],
  ["/configuracoes/cliente", ["owner", "admin"]],
  ["/configuracoes/sistema", ["owner", "admin", "suporte"]],
  ["/portal", ["cliente"]],
  ["/portal/estoque", ["cliente"]],
  ["/portal/eventos", ["cliente"]],
  ["/portal/recebimentos", ["cliente"]],
  ["/portal/pedidos", ["cliente"]],
  ["/portal/faturas", ["cliente"]],
  ["/portal/faturas/fatura", ["cliente"]],
  ["/portal/documentos", ["cliente"]],
  ["/portal/agente", ["cliente"]],
  ["/minhas-faturas", ["cliente"]],
];

function menu(role: ProfileRole) {
  return getNavigationForProfileRole(role).map((module) => ({
    label: module.label,
    routes: module.routes.map((route) => route.label),
  }));
}

describe("permissões por rota", () => {
  it.each(ROUTE_ACCESS)("%s mantém os mesmos papéis", (path, roles) => {
    expect([...getRouteProfileRoles(path)].sort()).toEqual([...roles].sort());
  });
});

describe("menu interno", () => {
  it.each<ProfileRole>(["owner", "admin"])(
    "%s vê os destinos principais, sem grupo Mais (Administração vive na Configuração)",
    (role) => {
      expect(menu(role)).toEqual([
        { label: "Início", routes: ["Início"] },
        { label: "Agent Dute", routes: ["Agent Dute"] },
        { label: "Pedidos", routes: ["Pedidos"] },
        { label: "Estoque", routes: ["Itens", "Receber", "Contagem", "Posições"] },
        { label: "Faturamento", routes: ["Faturamento"] },
        { label: "Relatórios", routes: ["Relatórios"] },
        { label: "Documentos", routes: ["Documentos"] },
      ]);
    },
  );

  it("operador WMS vê o Agent Dute, a bancada e os documentos", () => {
    expect(menu("wms")).toEqual([
      { label: "Agent Dute", routes: ["Agent Dute"] },
      { label: "Pedidos", routes: ["Pedidos"] },
      { label: "Estoque", routes: ["Itens", "Receber", "Contagem", "Posições"] },
      { label: "Documentos", routes: ["Documentos"] },
    ]);
  });

  it("financeiro não vê operação física", () => {
    expect(menu("financeiro").map((module) => module.label)).toEqual([
      "Início",
      "Agent Dute",
      "Faturamento",
      "Relatórios",
      "Documentos",
    ]);
  });

  it.each<ProfileRole>(INTERNAL_ROLES)(
    "todo link do menu de %s abre uma rota permitida para ele",
    (role) => {
      for (const module of getNavigationForProfileRole(role)) {
        for (const route of module.routes) {
          expect(getRouteProfileRoles(route.href!)).toContain(role);
        }
      }
    },
  );
});

describe("grupo ativo", () => {
  const modules = getNavigationForProfileRole("admin");
  const activeLabel = (path: string) => getActiveModule(modules, path).label;

  it.each([
    ["/dashboard", "Início"],
    ["/solicitacoes", "Pedidos"],
    ["/wms/pedidos", "Pedidos"],
    ["/pedidos", "Pedidos"],
    ["/orders", "Pedidos"],
    ["/wms", "Estoque"],
    ["/estoque", "Estoque"],
    ["/movements", "Estoque"],
    ["/wms/receber", "Estoque"],
    ["/wms/contagem", "Estoque"],
    ["/wms/qualidade", "Estoque"],
    ["/catalogo/saldos", "Estoque"],
    ["/faturamento/tabela", "Faturamento"],
    ["/faturamento/fatura", "Faturamento"],
    ["/reports", "Relatórios"],
    ["/agente", "Agent Dute"],
    ["/agente/painel", "Agent Dute"],
  ])("%s destaca %s", (path, label) => {
    expect(activeLabel(path)).toBe(label);
  });
});

describe("telas da conta", () => {
  it("/configuracoes não acende nenhum item do menu", () => {
    expect(isAccountPath("/configuracoes")).toBe(true);
    expect(isAccountPath("/configuracoes/pessoas")).toBe(true);
    expect(isAccountPath("/configuracoesx")).toBe(false);
    expect(isAccountPath("/dashboard")).toBe(false);
  });
});

describe("tela inicial por perfil", () => {
  it.each<[ProfileRole, string]>([
    ["wms", "/pedidos"],
    ["financeiro", "/faturamento"],
    ["admin", "/dashboard"],
    ["cliente", "/portal"],
  ])("%s abre em %s", (role, path) => {
    expect(getHomePathForProfile(role)).toBe(path);
  });
});

describe("menu do portal da BTG", () => {
  it("Agent Dute vem primeiro e cada tela é um item próprio", () => {
    expect(getNavigationForProfileRole("cliente").map((module) => [module.label, module.href])).toEqual([
      ["Agent Dute", "/portal/agente"],
      ["Início", "/portal"],
      ["Estoque", "/portal/estoque"],
      ["Eventos", "/portal/eventos"],
      ["Envios para a Dutelog", "/portal/recebimentos"],
      ["Pedidos", "/portal/pedidos"],
      ["Faturas", "/portal/faturas"],
      ["Documentos", "/portal/documentos"],
    ]);
  });
});

describe("barra inferior do celular", () => {
  const bar = (role: ProfileRole) =>
    getMobileNavigation(getNavigationForProfileRole(role)).bar.map((module) => module.label);
  const more = (role: ProfileRole) =>
    getMobileNavigation(getNavigationForProfileRole(role)).more.flatMap(({ module, routes }) =>
      routes.map((route) => `${module.label} · ${route.label}`),
    );

  it("coordenação: Início, Pedidos, Estoque e Agent Dute; o resto em Mais", () => {
    expect(bar("owner")).toEqual(["Início", "Pedidos", "Estoque", "Agent Dute"]);
    expect(more("owner")).toEqual([
      "Estoque · Receber",
      "Estoque · Contagem",
      "Estoque · Posições",
      "Faturamento · Faturamento",
      "Relatórios · Relatórios",
      "Documentos · Documentos",
    ]);
  });

  it("operador WMS completa a barra com Documentos", () => {
    expect(bar("wms")).toEqual(["Pedidos", "Estoque", "Agent Dute", "Documentos"]);
    expect(more("wms")).toEqual(["Estoque · Receber", "Estoque · Contagem", "Estoque · Posições"]);
  });

  it("financeiro completa a barra com Faturamento e Relatórios", () => {
    expect(bar("financeiro")).toEqual(["Início", "Agent Dute", "Faturamento", "Relatórios"]);
    expect(more("financeiro")).toEqual(["Documentos · Documentos"]);
  });

  it("portal da BTG: Início, Pedidos, Estoque e Agent Dute; Eventos, Envios, Faturas e Documentos em Mais", () => {
    expect(bar("cliente")).toEqual(["Início", "Pedidos", "Estoque", "Agent Dute"]);
    expect(more("cliente")).toEqual([
      "Eventos · Eventos",
      "Envios para a Dutelog · Envios para a Dutelog",
      "Faturas · Faturas",
      "Documentos · Documentos",
    ]);
  });
});
