import { readFileSync } from "node:fs";

import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import {
  getActiveModule,
  getHomePathForProfile,
  getMobileNavigation,
  getNavigationForProfileRole,
  getRouteAppRoles,
  getRouteProfileRoles,
  isModuleGroup,
  isNavRouteActive,
} from "../modules";
import { entrada, modulesForPerson } from "../platform-modules";
import {
  ABAS_DO_COMERCIAL,
  APROVADOR_ROLES,
  COMERCIAL_ROLES,
  ROTA_APROVAR,
  ROTA_AUTORIZACOES,
  ROTA_CLIENTES,
  ROTA_COMERCIAL,
  ROTA_CONTRATOS,
  ROTA_MEDICOES,
  ROTA_DOCUMENTO,
  ROTA_ORCAMENTO,
  TELAS_DO_COMERCIAL,
  abasVisiveis,
  abreComercial,
  aprovaOrcamento,
  contratoDaBusca,
  hrefDaMedicao,
  hrefDoContrato,
  medicaoDaBusca,
  rotasDoComercial,
  soComComercialLiberado,
} from "./navegacao";

/**
 * Base de navegação do Comercial (docs/plataforma/fase-6-comercial.md, parte
 * 13): rotas, menu, casa do card na tela de entrada e aterrissagem do papel
 * comercial, sempre por papel E pela liberação (lib/liberacao.ts). Toda
 * chamada aqui passa a liberação explícita: o resultado não depende do .env
 * de quem roda o teste.
 */

const LIBERADO = true;
const DESLIGADO = false;

// Caminhos de PROTECTED_ROUTES no App.tsx (importar o App puxaria o Firebase).
const APP_SOURCE = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const caminhos = (source: string) => Array.from(source.matchAll(/protectedRoute\(\s*"([^"]+)"/g), ([, path]) => path);
const APP_PATHS = caminhos(APP_SOURCE);
const doComercial = (path: string) => path === ROTA_COMERCIAL || path.startsWith(`${ROTA_COMERCIAL}/`);

const QUEM_ABRE: Papel[] = ["owner", "admin", "comercial"];
const QUEM_NAO_ABRE = PAPEIS.filter((role) => !QUEM_ABRE.includes(role));

function menu(role: Papel, liberado: boolean) {
  return getNavigationForProfileRole(role, null, liberado).map((module) => ({
    label: module.label,
    routes: module.routes.map((route) => route.label),
  }));
}

describe("rotas do Comercial", () => {
  it("só existem com a liberação ligada", () => {
    expect(rotasDoComercial(DESLIGADO)).toEqual([]);
    expect(rotasDoComercial(LIBERADO)).toEqual([
      ROTA_COMERCIAL,
      ROTA_ORCAMENTO,
      ROTA_DOCUMENTO,
      ROTA_APROVAR,
      ROTA_CLIENTES,
      ROTA_CONTRATOS,
      ROTA_AUTORIZACOES,
      ROTA_MEDICOES,
    ]);
  });

  it("o App registra exatamente as rotas do Comercial: a fila, a montagem, o documento, a aprovação, Clientes, Contratos e Autorizações", () => {
    expect(APP_PATHS.filter(doComercial)).toEqual(rotasDoComercial(LIBERADO));
  });

  it("toda rota do Comercial no App passa pela liberação: nenhuma fora de soComComercialLiberado", () => {
    const blocos = Array.from(APP_SOURCE.matchAll(/soComComercialLiberado\(\[([\s\S]*?)\]\)/g), ([, bloco]) => bloco);
    expect(blocos).toHaveLength(1);
    expect(caminhos(blocos[0])).toEqual(rotasDoComercial(LIBERADO));
    const fora = APP_SOURCE.replace(/soComComercialLiberado\(\[[\s\S]*?\]\)/g, "");
    expect(caminhos(fora).filter(doComercial)).toEqual([]);
  });

  it("soComComercialLiberado: na produção nenhuma rota; na homologação, só as do Comercial", () => {
    const rotas = [
      { path: ROTA_COMERCIAL },
      { path: ROTA_ORCAMENTO },
      { path: ROTA_DOCUMENTO },
      { path: ROTA_APROVAR },
      { path: ROTA_CLIENTES },
      { path: ROTA_CONTRATOS },
      { path: ROTA_AUTORIZACOES },
      { path: ROTA_MEDICOES },
      { path: "/comercial/inexistente" },
    ];
    expect(soComComercialLiberado(rotas, DESLIGADO)).toEqual([]);
    expect(soComComercialLiberado(rotas, LIBERADO).map((rota) => rota.path)).toEqual([
      ROTA_COMERCIAL,
      ROTA_ORCAMENTO,
      ROTA_DOCUMENTO,
      ROTA_APROVAR,
      ROTA_CLIENTES,
      ROTA_CONTRATOS,
      ROTA_AUTORIZACOES,
      ROTA_MEDICOES,
    ]);
  });

  it.each(PAPEIS)("%s: a rota de Contratos existe e abre só para quem abre o Comercial, com a liberação", (role) => {
    for (const liberado of [LIBERADO, DESLIGADO]) {
      const registrada = rotasDoComercial(liberado).includes(ROTA_CONTRATOS);
      const permitida = getRouteProfileRoles(ROTA_CONTRATOS).includes(role);
      expect(registrada && permitida, `${role} ${liberado}`).toBe(abreComercial(role, liberado));
    }
  });

  it.each(PAPEIS)("%s: a rota de Autorizações (parte 15b) abre só para owner, admin e comercial, com a liberação", (role) => {
    // O financeiro registra pela callable e lê pelas regras; a tela dele é da Fase 7.
    for (const liberado of [LIBERADO, DESLIGADO]) {
      const existe = rotasDoComercial(liberado).includes(ROTA_AUTORIZACOES);
      const permitida = getRouteProfileRoles(ROTA_AUTORIZACOES).includes(role);
      expect(existe && permitida, `${role} ${liberado}`).toBe(abreComercial(role, liberado));
    }
    expect(getRouteProfileRoles(ROTA_AUTORIZACOES)).not.toContain("financeiro");
  });

  it("owner, admin e comercial abrem; nenhum outro papel (a aprovação, só o owner)", () => {
    expect([...COMERCIAL_ROLES]).toEqual(QUEM_ABRE);
    for (const path of rotasDoComercial(LIBERADO).filter((rota) => rota !== ROTA_APROVAR)) {
      expect([...getRouteProfileRoles(path)].sort(), path).toEqual([...QUEM_ABRE].sort());
      expect(getRouteAppRoles(path), path).toEqual(["interno"]);
    }
  });

  it("a tela de aprovar é só do owner (a rota e a decisão), e o documento é de quem abre o Comercial", () => {
    expect([...APROVADOR_ROLES]).toEqual(["owner"]);
    expect(getRouteProfileRoles(ROTA_APROVAR)).toEqual(["owner"]);
    expect(getRouteAppRoles(ROTA_APROVAR)).toEqual(["interno"]);
    expect([...getRouteProfileRoles(ROTA_DOCUMENTO)].sort()).toEqual([...QUEM_ABRE].sort());
    for (const role of PAPEIS) {
      expect(aprovaOrcamento(role, LIBERADO), role).toBe(role === "owner");
      expect(aprovaOrcamento(role, DESLIGADO), role).toBe(false);
    }
  });

  it.each(QUEM_ABRE)("%s abre o Comercial só com a liberação", (role) => {
    expect(abreComercial(role, LIBERADO)).toBe(true);
    expect(abreComercial(role, DESLIGADO)).toBe(false);
  });

  it.each(QUEM_NAO_ABRE)("%s nunca abre o Comercial", (role) => {
    expect(abreComercial(role, LIBERADO)).toBe(false);
    expect(abreComercial(role, DESLIGADO)).toBe(false);
  });

  it("sem papel, não abre", () => {
    expect(abreComercial(null, LIBERADO)).toBe(false);
    expect(abreComercial(undefined, LIBERADO)).toBe(false);
  });

  it("/comercial é a fila de orçamentos (parte 11): sem redirecionar para Clientes", () => {
    expect(TELAS_DO_COMERCIAL).toEqual([ROTA_COMERCIAL, ROTA_ORCAMENTO, ROTA_DOCUMENTO, ROTA_APROVAR, ROTA_CLIENTES, ROTA_CONTRATOS, ROTA_AUTORIZACOES, ROTA_MEDICOES]);
    expect(APP_SOURCE).not.toMatch(/ComercialRedirect|DESTINO_DO_COMERCIAL/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/comercial", ComercialOrcamentos\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/comercial\/orcamento", ComercialOrcamento\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/comercial\/orcamento\/documento", ComercialDocumento\)/);
    expect(APP_SOURCE).toMatch(/protectedRoute\("\/comercial\/aprovar", ComercialAprovar\)/);
  });
});

describe("link para a medição de um contrato e competência", () => {
  it("com a tela de Medições, leva ao contrato e à competência", () => {
    expect(hrefDaMedicao("safra", "2026-09")).toBe("/comercial/medicoes?contrato=safra&competencia=2026-09");
    expect(hrefDaMedicao("a b/c", "2026-09")).toBe("/comercial/medicoes?contrato=a%20b%2Fc&competencia=2026-09");
    expect(hrefDaMedicao("safra")).toBe("/comercial/medicoes?contrato=safra");
  });

  it("sem a tela de Medições, não há link", () => {
    expect(hrefDaMedicao("safra", "2026-09", [ROTA_CLIENTES])).toBeNull();
  });

  it("o contrato e a competência abertos vêm da busca da URL; competência inválida é ignorada", () => {
    expect(medicaoDaBusca("?contrato=safra&competencia=2026-09")).toEqual({ contrato: "safra", competencia: "2026-09" });
    expect(medicaoDaBusca("contrato=a%20b%2Fc")).toEqual({ contrato: "a b/c", competencia: null });
    expect(medicaoDaBusca("?competencia=2026-13")).toEqual({ contrato: null, competencia: null });
    expect(medicaoDaBusca("")).toEqual({ contrato: null, competencia: null });
  });

  it("ida e volta: o link devolve o mesmo contrato e a mesma competência", () => {
    const href = hrefDaMedicao("ct_9xZ-1", "2026-12")!;
    expect(medicaoDaBusca(href.slice(href.indexOf("?")))).toEqual({ contrato: "ct_9xZ-1", competencia: "2026-12" });
  });
});

describe("link para a ficha do contrato", () => {
  it("com a tela de Contratos, o link leva à ficha pelo id", () => {
    expect(hrefDoContrato("itau-2026")).toBe("/comercial/contratos?id=itau-2026");
    expect(hrefDoContrato("a b/c")).toBe("/comercial/contratos?id=a%20b%2Fc");
  });

  it("sem a tela de Contratos, não há link", () => {
    expect(hrefDoContrato("itau-2026", [ROTA_CLIENTES])).toBeNull();
  });

  it("a ficha aberta vem do id da busca da URL", () => {
    expect(contratoDaBusca("?id=itau-2026")).toBe("itau-2026");
    expect(contratoDaBusca("id=a%20b%2Fc")).toBe("a b/c");
    expect(contratoDaBusca("")).toBeNull();
    expect(contratoDaBusca("?id=")).toBeNull();
    expect(contratoDaBusca("?outro=1")).toBeNull();
  });

  it("ida e volta: o link da ficha devolve o mesmo id", () => {
    const href = hrefDoContrato("ct_9xZ-1")!;
    expect(contratoDaBusca(href.slice(href.indexOf("?")))).toBe("ct_9xZ-1");
  });
});

describe("menu do Comercial", () => {
  it("comercial vê só o grupo Comercial, com Orçamentos, Clientes, Contratos, Autorizações e Medições dentro", () => {
    expect(menu("comercial", LIBERADO)).toEqual([{ label: "Comercial", routes: ["Orçamentos", "Clientes", "Contratos", "Autorizações", "Medições"] }]);
    const [comercial] = getNavigationForProfileRole("comercial", null, LIBERADO);
    expect(comercial.href).toBe(ROTA_COMERCIAL);
    expect(isModuleGroup(comercial)).toBe(true);
  });

  it("fora da liberação o comercial não tem menu, como antes", () => {
    expect(menu("comercial", DESLIGADO)).toEqual([]);
  });

  it.each<Papel>(["owner", "admin"])("%s ganha o grupo Comercial depois do Faturamento, só com a liberação", (role) => {
    const labels = (liberado: boolean) => menu(role, liberado).map((module) => module.label);
    expect(labels(DESLIGADO)).not.toContain("Comercial");
    expect(labels(LIBERADO)).toEqual([
      "Início",
      "Agent Dute",
      "Pedidos",
      "Estoque",
      "Faturamento",
      "Comercial",
      "Relatórios",
      "Documentos",
    ]);
  });

  it.each(QUEM_NAO_ABRE)("%s não vê o Comercial nem com a liberação", (role) => {
    expect(menu(role, LIBERADO).map((module) => module.label)).not.toContain("Comercial");
  });

  it.each(QUEM_ABRE)("todo link do menu de %s abre uma rota permitida para ele", (role) => {
    for (const module of getNavigationForProfileRole(role, null, LIBERADO)) {
      for (const route of module.routes) {
        expect(getRouteProfileRoles(route.href!), route.href).toContain(role);
      }
    }
  });

  it("Clientes, Contratos (com a ficha aberta), a fila e a montagem do orçamento acendem o grupo Comercial", () => {
    const modules = getNavigationForProfileRole("admin", null, LIBERADO);
    for (const path of [
      ROTA_CLIENTES,
      ROTA_CONTRATOS,
      hrefDoContrato("itau-2026")!,
      ROTA_MEDICOES,
      hrefDaMedicao("safra", "2026-09")!,
      ROTA_COMERCIAL,
      ROTA_ORCAMENTO,
      `${ROTA_DOCUMENTO}?numero=10045&rv=1`,
      ROTA_APROVAR,
    ]) {
      expect(getActiveModule(modules, path).label, path).toBe("Comercial");
    }
  });

  it("Orçamentos não acende em Clientes nem em Contratos: a rota da fila é exata", () => {
    const [comercial] = getNavigationForProfileRole("comercial", null, LIBERADO);
    const orcamentos = comercial.routes.find((route) => route.label === "Orçamentos")!;
    expect(orcamentos.href).toBe(ROTA_COMERCIAL);
    expect(orcamentos.exact).toBe(true);
  });

  it("na montagem do orçamento, o item Orçamentos do menu fica aceso (e só ele)", () => {
    const [comercial] = getNavigationForProfileRole("comercial", null, LIBERADO);
    const acesos = (path: string) => comercial.routes.filter((route) => isNavRouteActive(path, route)).map((route) => route.label);
    expect(acesos(ROTA_ORCAMENTO)).toEqual(["Orçamentos"]);
    expect(acesos(ROTA_DOCUMENTO)).toEqual(["Orçamentos"]);
    expect(acesos(ROTA_APROVAR)).toEqual(["Orçamentos"]);
    expect(acesos(ROTA_COMERCIAL)).toEqual(["Orçamentos"]);
    expect(acesos(ROTA_CLIENTES)).toEqual(["Clientes"]);
    expect(acesos(ROTA_CONTRATOS)).toEqual(["Contratos"]);
    expect(acesos(ROTA_AUTORIZACOES)).toEqual(["Autorizações"]);
    expect(acesos(ROTA_MEDICOES)).toEqual(["Medições"]);
  });

  it("o menu (lateral, suspenso e do celular) acende pelo item, com as telas dele", () => {
    for (const arquivo of ["../../components/layout/app-layout.tsx", "../../components/layout/mobile-tab-bar.tsx"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      expect(fonte, arquivo).not.toMatch(/isRouteActive\(location, route\.href, route\.exact\)/);
      expect(fonte, arquivo).toMatch(/isNavRouteActive\(location, route\)/);
    }
  });

  it("os grupos do WMS continuam como eram: grupo é quem tem mais de uma tela", () => {
    const modules = getNavigationForProfileRole("admin", null, LIBERADO);
    expect(modules.filter(isModuleGroup).map((module) => module.label)).toEqual(["Estoque", "Comercial"]);
  });

  it("no celular, o comercial tem o Comercial na barra; o owner o encontra em Mais", () => {
    const comercial = getMobileNavigation(getNavigationForProfileRole("comercial", null, LIBERADO));
    expect(comercial.bar.map((module) => module.label)).toEqual(["Comercial"]);
    const owner = getMobileNavigation(getNavigationForProfileRole("owner", null, LIBERADO));
    expect(owner.more.flatMap(({ module, routes }) => routes.map((route) => `${module.label} · ${route.label}`))).toEqual(
      expect.arrayContaining(["Comercial · Orçamentos", "Comercial · Clientes", "Comercial · Contratos", "Comercial · Autorizações"]),
    );
  });
});

describe("abreComercial decide menu, aterrissagem e card", () => {
  it.each(PAPEIS)("%s: menu, casa e card seguem abreComercial, com e sem a liberação", (role) => {
    for (const liberado of [LIBERADO, DESLIGADO]) {
      const abre = abreComercial(role, liberado);
      const noMenu = getNavigationForProfileRole(role, null, liberado).some((module) => module.label === "Comercial");
      const card = modulesForPerson(role, null, liberado).some((entry) => entry.module.label === "Comercial");
      expect({ noMenu, card }, `${role} ${liberado}`).toEqual({ noMenu: abre, card: abre });
      if (role === "comercial") expect(getHomePathForProfile(role, liberado) === ROTA_COMERCIAL).toBe(abre);
    }
  });
});

describe("aterrissagem e tela de entrada", () => {
  it("o papel comercial aterrissa em /comercial com a liberação; sem ela, na Conta", () => {
    expect(getHomePathForProfile("comercial", LIBERADO)).toBe(ROTA_COMERCIAL);
    expect(getHomePathForProfile("comercial", DESLIGADO)).toBe("/configuracoes/conta");
    expect(entrada("comercial", null, LIBERADO)).toEqual({ kind: "redirect", to: ROTA_COMERCIAL });
    expect(entrada("comercial", null, DESLIGADO)).toEqual({ kind: "nenhum" });
  });

  it("a liberação não muda a aterrissagem dos outros papéis", () => {
    for (const role of PAPEIS.filter((papel) => papel !== "comercial")) {
      expect(getHomePathForProfile(role, LIBERADO), role).toBe(getHomePathForProfile(role, DESLIGADO));
    }
  });

  it("owner e admin ganham o card Comercial, com casa em /comercial, só com a liberação", () => {
    for (const role of ["owner", "admin"] as const) {
      const cards = (liberado: boolean) =>
        modulesForPerson(role, null, liberado).map((entry) => [entry.module.label, entry.href]);
      expect(cards(DESLIGADO)).toEqual([
        ["Armazenagem", "/dashboard"],
        ["Financeiro", "/faturamento"],
      ]);
      expect(cards(LIBERADO)).toEqual([
        ["Armazenagem", "/dashboard"],
        ["Comercial", ROTA_COMERCIAL],
        ["Financeiro", "/faturamento"],
      ]);
      expect(entrada(role, null, LIBERADO).kind).toBe("cards");
    }
  });

  it("nenhum outro papel ganha o card Comercial", () => {
    for (const role of QUEM_NAO_ABRE) {
      const labels = modulesForPerson(role, null, LIBERADO).map((entry) => entry.module.label);
      expect(labels, role).not.toContain("Comercial");
    }
  });
});

describe("abas do módulo (Orçamentos · Contratos · Autorizações · Medições)", () => {
  it("as quatro abas, na ordem dos mockups", () => {
    expect(ABAS_DO_COMERCIAL.map((aba) => aba.rotulo)).toEqual(["Orçamentos", "Contratos", "Autorizações", "Medições"]);
  });

  it("aba sem tela fica oculta: hoje Orçamentos, Contratos, Autorizações e Medições têm", () => {
    expect(abasVisiveis(TELAS_DO_COMERCIAL).map((aba) => aba.id)).toEqual(["orcamentos", "contratos", "autorizacoes", "medicoes"]);
    expect(abasVisiveis().map((aba) => aba.href)).toEqual([ROTA_COMERCIAL, ROTA_CONTRATOS, ROTA_AUTORIZACOES, ROTA_MEDICOES]);
    expect(abasVisiveis([ROTA_CLIENTES])).toEqual([]);
  });

  it("a montagem, o documento e a aprovação do orçamento são da aba Orçamentos", () => {
    const orcamentos = ABAS_DO_COMERCIAL.find((aba) => aba.id === "orcamentos")!;
    expect(orcamentos.tambem).toEqual([ROTA_ORCAMENTO, ROTA_APROVAR, ROTA_DOCUMENTO]);
  });

  it("a aba Autorizações leva à tela de autorizações (parte 15b)", () => {
    expect(ABAS_DO_COMERCIAL.find((aba) => aba.id === "autorizacoes")!.href).toBe(ROTA_AUTORIZACOES);
  });

  it("cada tela nova acende a aba dela, na ordem", () => {
    const contratos = ABAS_DO_COMERCIAL.find((aba) => aba.id === "contratos")!;
    const orcamentos = ABAS_DO_COMERCIAL.find((aba) => aba.id === "orcamentos")!;
    expect(abasVisiveis([...TELAS_DO_COMERCIAL, contratos.href, orcamentos.href]).map((aba) => aba.id)).toEqual([
      "orcamentos",
      "contratos",
      "autorizacoes",
      "medicoes",
    ]);
  });
});
