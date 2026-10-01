import { describe, expect, it } from "vitest";

import {
  getActiveModule,
  getHomePathForProfile,
  getNavigationForProfileRole,
  getRouteProfileRoles,
  INTERNAL_ROLES,
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
  ["/agente", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/agente/conhecimento", ["owner", "admin", "interno", "financeiro", "suporte"]],
  ["/suporte", ["owner", "admin", "suporte"]],
  ["/documentos", ["owner", "admin", "interno", "wms", "financeiro", "suporte"]],
  ["/clientes", ["owner", "admin"]],
  ["/usuarios", ["owner", "admin"]],
  ["/configuracoes", ["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"]],
  ["/portal", ["cliente"]],
  ["/portal/estoque", ["cliente"]],
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
    "%s vê 5 destinos principais e o grupo Mais",
    (role) => {
      expect(menu(role)).toEqual([
        { label: "Início", routes: ["Início"] },
        { label: "Pedidos", routes: ["Pedidos"] },
        { label: "Estoque", routes: ["Itens", "Receber"] },
        { label: "Faturamento", routes: ["Faturamento"] },
        {
          label: "Administração",
          routes: ["Clientes", "Pessoas e acessos", "Observabilidade"],
        },
        {
          label: "Mais",
          routes: ["Relatórios", "Documentos"],
        },
      ]);
    },
  );

  it("operador WMS vê só a bancada e os documentos", () => {
    expect(menu("wms")).toEqual([
      { label: "Pedidos", routes: ["Pedidos"] },
      { label: "Estoque", routes: ["Itens", "Receber"] },
      { label: "Documentos", routes: ["Documentos"] },
    ]);
  });

  it("financeiro não vê operação física", () => {
    expect(menu("financeiro").map((module) => module.label)).toEqual([
      "Início",
      "Faturamento",
      "Mais",
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
    ["/suporte", "Administração"],
    ["/reports", "Mais"],
  ])("%s destaca %s", (path, label) => {
    expect(activeLabel(path)).toBe(label);
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
