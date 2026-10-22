import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { menuDoComercial } from "@/lib/modules";

import { ComercialShell } from "./comercial-shell";

const ITENS = menuDoComercial("owner", true);

function render(path: string, children = "Fila") {
  return renderToStaticMarkup(
    <Router ssrPath={path}>
      <ComercialShell items={ITENS} basePath="" online conta={() => null}>
        {children}
      </ComercialShell>
    </Router>,
  );
}

function linkAtual(html: string, href: string) {
  return [...html.matchAll(/<a\b[^>]*>/g)].some((match) => {
    const tag = match[0];
    return tag.includes(`href="${href}"`) && tag.includes('aria-current="page"');
  });
}

describe("shell do Comercial", () => {
  it("mostra o título e só as telas do módulo", () => {
    const html = render("/comercial");
    expect(html).toContain('data-ambiente="comercial"');
    expect(html).toContain(">Comercial<");
    for (const tela of ["Orçamentos", "Clientes", "Contratos", "Autorizações", "Medições"]) {
      expect(html, tela).toContain(`>${tela}<`);
    }
    for (const href of ["/comercial", "/comercial/clientes", "/comercial/contratos", "/comercial/autorizacoes", "/comercial/medicoes"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    for (const doWms of ["Início", "Pedidos", "Estoque", "Faturamento", "Relatórios", "Documentos", "Agent Dute", "Cliente ativo"]) {
      expect(html, doWms).not.toContain(`>${doWms}<`);
    }
    expect(html).toContain(">Fila<");
  });

  it("a troca de módulo saiu da sidebar e do cabeçalho", () => {
    const html = render("/comercial/contratos");
    expect(html).not.toContain(">Módulos<");
    expect(html).not.toContain('href="/"');
    expect(html).toContain('href="/comercial/contratos"');
  });

  it("a tela aberta fica marcada, e a montagem acende Orçamentos", () => {
    const clientes = render("/comercial/clientes");
    expect(linkAtual(clientes, "/comercial/clientes")).toBe(true);
    expect(linkAtual(clientes, "/comercial")).toBe(false);

    const montagem = render("/comercial/orcamento");
    expect(linkAtual(montagem, "/comercial")).toBe(true);
    expect(linkAtual(montagem, "/comercial/clientes")).toBe(false);

    const aprovar = render("/comercial/aprovar");
    expect(linkAtual(aprovar, "/comercial")).toBe(true);
  });

  it("no celular a barra leva às mesmas telas", () => {
    const html = render("/comercial/medicoes");
    expect(html).toContain('aria-label="Navegação principal"');
    expect(html).toContain('href="/comercial/medicoes"');
    expect(html).not.toContain(">Módulos<");
  });
});
