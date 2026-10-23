import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getActiveModule,
  getHomePathForProfile,
  getMobileNavigation,
  getNavigationForProfileRole,
  getRouteAppRoles,
  getRouteProfileRoles,
  hasRouteRoles,
  INTERNAL_ROLES,
  isAccountPath,
  portalModuleForPath,
  type ProfileRole,
} from "./modules";
import { resolveOperationProfile } from "./operations";

// Caminhos de PROTECTED_ROUTES, lidos do App.tsx (importar o App puxaria o
// Firebase para o teste).
const PROTECTED_PATHS = Array.from(
  readFileSync(new URL("../App.tsx", import.meta.url), "utf8").matchAll(
    /protectedRoute\(\s*"([^"]+)"/g,
  ),
  ([, path]) => path,
);

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
  ["/estoque/etiquetas", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/estoque/mapa", ["owner", "admin", "interno", "wms", "suporte"]],
  ["/estoque/posicoes", ["owner", "admin", "interno", "wms", "suporte"]],
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
  // Telas da conta valem para os 11 papéis da plataforma (Fase 2).
  ["/configuracoes", ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]],
  ["/configuracoes/conta", ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]],
  ["/configuracoes/aplicativo", ["owner", "admin", "interno", "wms", "campo", "comercial", "financeiro", "rh", "suporte", "painel", "cliente"]],
  ["/configuracoes/pessoas", ["owner", "admin"]],
  ["/configuracoes/clientes", ["owner", "admin"]],
  ["/configuracoes/cliente", ["owner", "admin"]],
  ["/configuracoes/sistema", ["owner", "admin", "suporte"]],
  ["/portal", ["cliente"]],
  ["/portal/estoque", ["cliente"]],
  ["/portal/eventos", ["cliente"]],
  ["/portal/recebimentos", ["cliente"]],
  ["/portal/solicitacoes", ["cliente"]],
  ["/portal/pedidos", ["cliente"]],
  ["/portal/faturas", ["cliente"]],
  ["/portal/faturas/fatura", ["cliente"]],
  ["/portal/faturas/relatorio", ["cliente"]],
  ["/portal/documentos", ["cliente"]],
  ["/portal/agente", ["cliente"]],
  ["/portal/agente/operacional", ["cliente"]],
  ["/minhas-faturas", ["cliente"]],
  // Comercial: rotas registradas só com a liberação (lib/comercial/navegacao.ts).
  // Parte 2.5: /comercial é o Início; a fila (parte 11) é /comercial/orcamentos.
  ["/comercial", ["owner", "admin", "comercial"]],
  ["/comercial/orcamentos", ["owner", "admin", "comercial"]],
  // A montagem do orçamento abre pela fila.
  ["/comercial/orcamento", ["owner", "admin", "comercial"]],
  // Parte 12a: o documento A4 do orçamento; a aprovação é só do owner.
  ["/comercial/orcamento/documento", ["owner", "admin", "comercial"]],
  ["/comercial/aprovar", ["owner"]],
  ["/comercial/clientes", ["owner", "admin", "comercial"]],
  ["/comercial/contratos", ["owner", "admin", "comercial"]],
  ["/comercial/autorizacoes", ["owner", "admin", "comercial"]],
  ["/comercial/medicoes", ["owner", "admin", "comercial"]],
  // Operação, parte 1: cadastro, só com a liberação (lib/operacao/navegacao.ts).
  ["/operacao", ["owner", "admin", "interno"]],
  ["/operacao/hoje", ["owner", "admin", "interno"]],
  ["/operacao/agenda", ["owner", "admin", "interno"]],
  ["/operacao/demandas", ["owner", "admin", "interno"]],
  ["/operacao/demanda", ["owner", "admin", "interno"]],
  ["/operacao/nova-demanda", ["owner", "admin", "interno"]],
  ["/operacao/planejar", ["owner", "admin", "interno"]],
  ["/operacao/os", ["owner", "admin", "interno"]],
  ["/operacao/os/impressao", ["owner", "admin", "interno"]],
  ["/operacao/revisao", ["owner", "admin", "interno"]],
  ["/campo", ["campo", "owner", "admin"]],
  ["/campo/os", ["campo", "owner", "admin"]],
  ["/campo/concluir", ["campo", "owner", "admin"]],
  // A TV da sala (parte 3.12b): o painel e quem coordena.
  ["/tv", ["painel", "owner", "admin", "interno"]],
  ["/operacao/colaboradores", ["owner", "admin", "interno"]],
  ["/operacao/veiculos", ["owner", "admin", "interno"]],
];

// Menu com o Comercial desligado, como na produção (o liberado: comercial/navegacao.test.ts).
function menu(role: ProfileRole) {
  return getNavigationForProfileRole(role, null, false).map((module) => ({
    label: module.label,
    routes: module.routes.map((route) => route.label),
  }));
}

describe("permissões por rota", () => {
  it.each(ROUTE_ACCESS)("%s mantém os mesmos papéis", (path, roles) => {
    expect([...getRouteProfileRoles(path)].sort()).toEqual([...roles].sort());
  });

  // Rota sem entrada própria cai no padrão interno: o cliente volta para "/"
  // e o interno abre a tela do portal (/portal/faturas/relatorio, 20/10/2026).
  it("toda rota protegida do App tem papéis próprios e fixados aqui", () => {
    expect(PROTECTED_PATHS).toContain("/portal/faturas/relatorio");
    const fixed = new Set(ROUTE_ACCESS.map(([path]) => path));
    expect(PROTECTED_PATHS.filter((path) => !hasRouteRoles(path))).toEqual([]);
    expect(PROTECTED_PATHS.filter((path) => !fixed.has(path))).toEqual([]);
  });

  it.each(ROUTE_ACCESS.filter(([, roles]) => roles.join() === "cliente"))(
    "%s abre para o cliente no portal",
    (path) => {
      expect(getRouteAppRoles(path)).toEqual(["cliente"]);
    },
  );
});

describe("menu interno", () => {
  it.each<ProfileRole>(["owner", "admin"])(
    "%s vê os destinos principais, sem grupo Mais (Administração vive na Configuração)",
    (role) => {
      expect(menu(role)).toEqual([
        { label: "Início", routes: ["Início"] },
        { label: "Agent Dute", routes: ["Agent Dute"] },
        { label: "Pedidos", routes: ["Pedidos"] },
        { label: "Estoque", routes: ["Itens", "Receber", "Contagem", "Mapa", "Posições"] },
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
      { label: "Estoque", routes: ["Itens", "Receber", "Contagem", "Mapa", "Posições"] },
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
    ["/estoque/etiquetas", "Estoque"],
    ["/estoque/mapa", "Estoque"],
    ["/catalogo/mapa", "Estoque"],
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

describe("menu do portal por modelo de operação", () => {
  const profileFor = (template: string) =>
    resolveOperationProfile({ customer_code: "Cliente X", operation_template: template });
  const labels = (template: string) =>
    getNavigationForProfileRole("cliente", profileFor(template)).map((module) => module.label);

  it("uniformes é o portal da BTG de hoje, inteiro", () => {
    expect(labels("uniformes")).toEqual([
      "Agent Dute",
      "Início",
      "Estoque",
      "Eventos",
      "Envios para a Dutelog",
      "Pedidos",
      "Faturas",
      "Documentos",
    ]);
  });

  it("mobiliário não tem Eventos", () => {
    expect(labels("mobiliario")).toEqual([
      "Agent Dute",
      "Início",
      "Estoque",
      "Envios para a Dutelog",
      "Pedidos",
      "Faturas",
      "Documentos",
    ]);
  });

  it("insumos não tem portal: uma conta de cliente por engano vê só o Início", () => {
    expect(labels("insumos")).toEqual(["Início"]);
  });

  it("os módulos contratados tiram do menu as telas de fora do contrato (parte 2.7)", () => {
    const comModulos = (modules: string[]) =>
      getNavigationForProfileRole(
        "cliente",
        resolveOperationProfile({ customer_code: "Cliente X", operation_template: "uniformes", modules }),
      ).map((module) => module.label);
    expect(comModulos(["operacao"])).toEqual(["Início"]);
    expect(comModulos(["wms", "operacao"])).not.toContain("Faturas");
    expect(comModulos(["financeiro"])).toEqual(["Início", "Faturas"]);
    expect(comModulos(["wms", "financeiro"])).toEqual(labels("uniformes"));
  });

  it("sem perfil carregado nada é escondido; o perfil não mexe no menu interno", () => {
    expect(getNavigationForProfileRole("cliente", null).length).toBe(8);
    expect(getNavigationForProfileRole("cliente", undefined).length).toBe(8);
    expect(getNavigationForProfileRole("admin", profileFor("insumos")).map((module) => module.label)).toEqual(
      getNavigationForProfileRole("admin").map((module) => module.label),
    );
  });

  it("cada rota do portal sabe a que módulo pertence", () => {
    expect(portalModuleForPath("/portal")).toBe("home");
    expect(portalModuleForPath("/portal/eventos")).toBe("events");
    expect(portalModuleForPath("/portal/faturas/fatura")).toBe("invoices");
    expect(portalModuleForPath("/portal/faturas/relatorio?de=2026-05&ate=2026-10")).toBe("invoices");
    expect(portalModuleForPath("/portal/agente?x=1")).toBe("assistant");
    expect(portalModuleForPath("/estoque")).toBeNull();
    expect(portalModuleForPath("/configuracoes/conta")).toBeNull();
  });

  it("barra do celular do mobiliário: sem Eventos em Mais", () => {
    const navigation = getMobileNavigation(getNavigationForProfileRole("cliente", profileFor("mobiliario")));
    expect(navigation.bar.map((module) => module.label)).toEqual(["Início", "Pedidos", "Estoque", "Agent Dute"]);
    expect(
      navigation.more.flatMap(({ module, routes }) => routes.map((route) => `${module.label} · ${route.label}`)),
    ).toEqual([
      "Envios para a Dutelog · Envios para a Dutelog",
      "Faturas · Faturas",
      "Documentos · Documentos",
    ]);
  });
});

describe("barra inferior do celular", () => {
  const bar = (role: ProfileRole) =>
    getMobileNavigation(getNavigationForProfileRole(role, null, false)).bar.map((module) => module.label);
  const more = (role: ProfileRole) =>
    getMobileNavigation(getNavigationForProfileRole(role, null, false)).more.flatMap(({ module, routes }) =>
      routes.map((route) => `${module.label} · ${route.label}`),
    );

  it("coordenação: Início, Pedidos, Estoque e Agent Dute; o resto em Mais", () => {
    expect(bar("owner")).toEqual(["Início", "Pedidos", "Estoque", "Agent Dute"]);
    expect(more("owner")).toEqual([
      "Estoque · Receber",
      "Estoque · Contagem",
      "Estoque · Mapa",
      "Estoque · Posições",
      "Faturamento · Faturamento",
      "Relatórios · Relatórios",
      "Documentos · Documentos",
    ]);
  });

  it("operador WMS completa a barra com Documentos", () => {
    expect(bar("wms")).toEqual(["Pedidos", "Estoque", "Agent Dute", "Documentos"]);
    expect(more("wms")).toEqual(["Estoque · Receber", "Estoque · Contagem", "Estoque · Mapa", "Estoque · Posições"]);
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

describe("papéis da plataforma que o WMS ainda não atende (Fase 2)", () => {
  const NEW_ROLES: ProfileRole[] = ["campo", "comercial", "rh", "painel"];

  // Com o Comercial desligado, como na produção (o liberado: comercial/navegacao.test.ts).
  it.each(NEW_ROLES)("%s não herda nenhum item do menu", (role) => {
    expect(getNavigationForProfileRole(role, null, false)).toEqual([]);
  });

  it.each(NEW_ROLES)("%s abre na Conta, sem laço de redirecionamento", (role) => {
    const home = getHomePathForProfile(role, false);
    expect(home).toBe("/configuracoes/conta");
    expect(getRouteProfileRoles(home)).toContain(role);
  });

  it.each(NEW_ROLES)("%s não entra em rota sem dono nem nas telas da equipe do WMS", (role) => {
    for (const path of ["/rota-que-nao-existe", "/dashboard", "/agente", "/documentos", "/pedidos", "/estoque", "/faturamento", "/portal"]) {
      expect(getRouteProfileRoles(path)).not.toContain(role);
    }
  });

  it("a equipe do WMS continua sendo a mesma", () => {
    expect([...INTERNAL_ROLES].sort()).toEqual(["admin", "financeiro", "interno", "owner", "suporte", "wms"]);
  });
});
