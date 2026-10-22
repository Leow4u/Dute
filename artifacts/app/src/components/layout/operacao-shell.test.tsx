import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { menuDoOperacao } from "@/lib/modules";

import { OperacaoShell } from "./operacao-shell";

const ITENS = menuDoOperacao("owner", true);

function render(path: string, showModulos: boolean) {
  return renderToStaticMarkup(
    <Router ssrPath={path}>
      <OperacaoShell items={ITENS} showModulos={showModulos} basePath="" online conta={() => null}>
        Lista
      </OperacaoShell>
    </Router>,
  );
}

describe("shell da Operação", () => {
  it("mostra o cadastro e não mostra o menu do WMS", () => {
    const html = render("/operacao/colaboradores", true);
    expect(html).toContain('data-ambiente="operacao"');
    expect(html).toContain(">Operação<");
    expect(html).toContain(">Colaboradores<");
    expect(html).toContain(">Veículos<");
    expect(html).toContain('href="/operacao/colaboradores"');
    expect(html).toContain('href="/operacao/veiculos"');
    for (const doWms of ["Pedidos", "Estoque", "Faturamento", "Orçamentos"]) {
      expect(html, doWms).not.toContain(`>${doWms}<`);
    }
  });

  it("a tela aberta fica marcada", () => {
    const html = render("/operacao/veiculos", false);
    expect(html).toContain('href="/operacao/veiculos"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain(">Módulos<");
  });
});
