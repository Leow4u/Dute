import { Boxes, Briefcase, Truck } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { getNavigationForProfileRole, menuDoComercial, menuDoOperacao } from "@/lib/modules";
import { opcoesDoSeletor, type Liberacoes } from "@/lib/seletor-de-modulo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ShellDoModulo, type ContadorDoItem } from "./shell-do-modulo";

// O CI roda o vitest sem VITE_FIREBASE_PROJECT_ID: as liberações vão explícitas.
const TUDO: Liberacoes = { comercial: true, plataforma: true, operacao: true };

function comercial(path: string, opcoes = opcoesDoSeletor("owner", null, path, TUDO), contadores?: Record<string, ContadorDoItem>, online = true) {
  return renderToStaticMarkup(
    <Router ssrPath={path}>
      <ShellDoModulo
        ambiente="comercial"
        atual={{ label: "Comercial", icon: Briefcase }}
        opcoes={opcoes}
        items={menuDoComercial("owner", true)}
        contadores={contadores}
        basePath=""
        online={online}
        conta={() => <button type="button">Minha conta</button>}
      >
        <h1>Fila</h1>
      </ShellDoModulo>
    </Router>,
  );
}

function operacao(path: string) {
  return renderToStaticMarkup(
    <Router ssrPath={path}>
      <ShellDoModulo
        ambiente="operacao"
        atual={{ label: "Operação", icon: Truck }}
        opcoes={opcoesDoSeletor("interno", null, path, TUDO)}
        items={menuDoOperacao("interno", true)}
        basePath=""
        online
        conta={() => <button type="button">Minha conta</button>}
      >
        <h1>Início</h1>
      </ShellDoModulo>
    </Router>,
  );
}

function wms(path: string, conteudoV3 = false, contadores?: Record<string, ContadorDoItem>) {
  return renderToStaticMarkup(
    <Router ssrPath={path}>
      <ShellDoModulo
        ambiente="wms"
        atual={{ label: "Armazenagem", icon: Boxes }}
        opcoes={opcoesDoSeletor("admin", null, path, TUDO)}
        items={getNavigationForProfileRole("admin", null, true, false)}
        contadores={contadores}
        basePath=""
        online
        conteudoV3={conteudoV3}
        abaixoDoSeletor={(compact) => <button type="button">{compact ? "BTG" : "Cliente ativo BTG"}</button>}
        conta={() => <button type="button">Minha conta</button>}
      >
        <h1>Tela do WMS</h1>
      </ShellDoModulo>
    </Router>,
  );
}

function linkAtual(html: string, href: string) {
  return [...html.matchAll(/<a\b[^>]*>/g)].some((match) => {
    const tag = match[0];
    return tag.includes(`href="${href}"`) && tag.includes('aria-current="page"');
  });
}

const TELAS_DO_COMERCIAL = ["Início", "Orçamentos", "Clientes", "Contratos", "Autorizações", "Medições"];

describe("shell v3 do módulo", () => {
  it("o Comercial mostra só as telas dele, na v3, sem nada do WMS", () => {
    const html = comercial("/comercial");
    expect(html).toContain('data-ambiente="comercial"');
    expect(html).toMatch(/class="v3 /);
    for (const tela of TELAS_DO_COMERCIAL) expect(html, tela).toContain(`>${tela}<`);
    for (const href of ["/comercial", "/comercial/orcamentos", "/comercial/clientes", "/comercial/contratos", "/comercial/autorizacoes", "/comercial/medicoes"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    for (const doWms of ["Pedidos", "Estoque", "Faturamento", "Relatórios", "Documentos", "Agent Dute", "Cliente ativo"]) {
      expect(html, doWms).not.toContain(`>${doWms}<`);
    }
    expect(html).toContain(">Fila<");
  });

  it("o logo leva aos cards e o nome do módulo é o seletor de quem tem mais de um", () => {
    const html = comercial("/comercial/contratos");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*><img [^>]*alt="Dutelog Soluções Logísticas"/);
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>.*?Comercial/);
    expect(html).not.toContain(">Módulos<");
  });

  it("quem tem um módulo só vê o nome, sem seletor", () => {
    const html = comercial("/comercial", opcoesDoSeletor("comercial", null, "/comercial", TUDO));
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toMatch(/<p [^>]*>.*?<span[^>]*>Comercial<\/span><\/p>/);
  });

  it("a tela aberta fica marcada, e a montagem acende Orçamentos, não o Início", () => {
    expect(linkAtual(comercial("/comercial"), "/comercial")).toBe(true);
    expect(linkAtual(comercial("/comercial/clientes"), "/comercial/clientes")).toBe(true);
    expect(linkAtual(comercial("/comercial/clientes"), "/comercial")).toBe(false);
    for (const montagem of ["/comercial/orcamento", "/comercial/aprovar", "/comercial/orcamento/documento"]) {
      expect(linkAtual(comercial(montagem), "/comercial/orcamentos"), montagem).toBe(true);
      expect(linkAtual(comercial(montagem), "/comercial"), montagem).toBe(false);
    }
  });

  it("o contador aparece no item, vermelho só no alerta", () => {
    const html = comercial("/comercial", undefined, {
      "comercial-orcamentos": { n: 5 },
      "comercial-autorizacoes": { n: 1, alerta: true },
      "comercial-medicoes": { n: 0 },
    });
    expect(html).toMatch(/>Orçamentos<\/span><span class="[^"]*bg-v3-header-foreground\/15[^"]*">5<\/span>/);
    expect(html).toMatch(/>Autorizações<\/span><span class="[^"]*bg-v3-marca[^"]*">1<\/span>/);
    expect(html).toMatch(/>Medições<\/span><\/a>/);
  });

  it("no celular, cabeçalho preto com o seletor e a barra com três telas e Mais, como nos mockups", () => {
    const html = comercial("/comercial/medicoes");
    expect(html).toMatch(/<nav aria-label="Navegação principal" class="[^"]*bg-v3-header/);
    const barra = html.slice(html.indexOf('<nav aria-label="Navegação principal"'));
    const links = [...barra.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([, href]) => href);
    expect(links).toEqual(["/comercial", "/comercial/orcamentos", "/comercial/clientes"]);
    expect(barra).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*<span>Mais<\/span><\/button>/);
  });

  it("sem conexão, uma linha de status e mais nada", () => {
    const html = comercial("/comercial", undefined, undefined, false);
    expect(html).toMatch(/<p role="status"[^>]*>.*Sem conexão<\/p>/);
  });

  it("a Operação usa o mesmo shell, com as telas dela", () => {
    const html = operacao("/operacao/veiculos");
    expect(html).toContain('data-ambiente="operacao"');
    for (const tela of ["Início", "Hoje", "Agenda", "Demandas", "Revisão", "Relatórios", "Colaboradores", "Veículos"]) expect(html, tela).toContain(`>${tela}<`);
    for (const doWms of ["Pedidos", "Estoque", "Faturamento", "Orçamentos"]) expect(html, doWms).not.toContain(`>${doWms}<`);
    expect(linkAtual(html, "/operacao/veiculos")).toBe(true);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = ["Comercial", ...TELAS_DO_COMERCIAL, "Minha conta", "Fila", "Mais", "5", "1"];
    const html = comercial("/comercial", undefined, { "comercial-orcamentos": { n: 5 }, "comercial-autorizacoes": { n: 1, alerta: true } });
    expect(textosForaDaLista(html, permitidos)).toEqual([]);
    expect(textosForaDaLista(operacao("/operacao"), ["Operação", "Início", "Hoje", "Agenda", "Demandas", "Revisão", "Relatórios", "Colaboradores", "Veículos", "Mais", "Minha conta"])).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(comercial("/comercial/clientes"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(comercial("/comercial", opcoesDoSeletor("comercial", null, "/comercial", TUDO)))).toEqual([]);
    expect(await violacoesDeAcessibilidade(operacao("/operacao"))).toEqual([]);
  });

  describe("a Armazenagem no shell v3 (parte 4.7a)", () => {
    it("a barra e o cabeçalho ficam na v3; a tela que não passou fica com o visual do WMS", () => {
      const html = wms("/pedidos");
      expect(html).toContain('data-ambiente="wms"');
      expect(html).toMatch(/<div data-ambiente="wms" class="(?![^"]*\bv3\b)[^"]*"/);
      expect(html).toMatch(/<aside aria-label="Armazenagem" class="v3 /);
      expect(html).toMatch(/<header class="v3 /);
      expect(html).toContain('class="contents v3"');
      expect(wms("/pedidos", true)).toMatch(/<div data-ambiente="wms" class="[^"]* v3"/);
    });

    it("o Estoque é um grupo: abre sozinho na tela dele, com a tela marcada", () => {
      const barra = (html: string) => html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
      const fechado = barra(wms("/pedidos"));
      expect(fechado).toMatch(/<button type="button" aria-expanded="false" aria-controls="menu-inventory"[^>]*>.*?>Estoque</);
      expect(fechado).not.toContain('id="menu-inventory"');
      expect(linkAtual(fechado, "/pedidos")).toBe(true);
      const aberto = barra(wms("/wms/receber"));
      expect(aberto).toMatch(/aria-expanded="true" aria-controls="menu-inventory"/);
      expect(aberto).toContain('id="menu-inventory"');
      for (const href of ["/estoque", "/wms/receber", "/wms/contagem"]) expect(aberto, href).toContain(`href="${href}"`);
      expect(linkAtual(aberto, "/wms/receber")).toBe(true);
      expect(linkAtual(aberto, "/estoque")).toBe(false);
    });

    it("o cliente ativo fica abaixo do seletor, na barra e numa linha sob o cabeçalho do celular", () => {
      const html = wms("/dashboard");
      expect(html.indexOf(">Cliente ativo BTG<")).toBeGreaterThan(html.indexOf(">Armazenagem<"));
      expect(html.indexOf(">Cliente ativo BTG<")).toBeLessThan(html.indexOf('aria-label="Telas de Armazenagem"'));
      const cabecalho = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      expect(cabecalho.indexOf(">BTG<")).toBeGreaterThan(cabecalho.indexOf(">Minha conta<"));
    });

    it("o contador do grupo soma as telas dele", () => {
      const html = wms("/dashboard", false, { home: { n: 3 }, inventory: { n: 2, alerta: true } });
      expect(html).toMatch(/>Início<\/span><span class="[^"]*bg-v3-header-foreground\/15[^"]*">3<\/span>/);
      expect(html).toMatch(/>Estoque<\/span><span class="[^"]*bg-v3-marca[^"]*">2<\/span>/);
    });

    it("passa nas regras WCAG 2.1 A e AA do axe, com o grupo aberto e fechado", async () => {
      expect(await violacoesDeAcessibilidade(wms("/pedidos"))).toEqual([]);
      expect(await violacoesDeAcessibilidade(wms("/estoque", true))).toEqual([]);
    });
  });
});
