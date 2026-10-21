import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ABAS_DO_COMERCIAL, TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";

import { AbasDoComercial } from "./abas-do-comercial";

function render(atual: string, telas: readonly string[]) {
  return renderToStaticMarkup(
    <Router ssrPath={atual}>
      <AbasDoComercial telas={telas} />
    </Router>,
  );
}

const href = (id: string) => ABAS_DO_COMERCIAL.find((aba) => aba.id === id)!.href;

describe("barra de abas do Comercial", () => {
  it("sem tela de nenhuma aba, a barra não aparece", () => {
    expect(render("/comercial/clientes", ["/comercial/clientes"])).toBe("");
  });

  it("hoje a barra tem só Contratos, marcada na tela de contratos", () => {
    const html = render(href("contratos"), TELAS_DO_COMERCIAL);
    expect(html.replace(/<[^>]+>/g, "|").split("|").filter(Boolean)).toEqual(["Contratos"]);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Contratos<\/a>/);
  });

  it("mostra só as abas com tela, com a atual marcada", () => {
    const html = render(href("contratos"), [href("orcamentos"), href("contratos")]);
    expect(html).toContain('aria-label="Comercial"');
    expect(html.replace(/<[^>]+>/g, "|").split("|").filter(Boolean)).toEqual(["Orçamentos", "Contratos"]);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Contratos<\/a>/);
    expect(html).not.toMatch(/<a [^>]*aria-current="page"[^>]*>Orçamentos<\/a>/);
    expect(html).toContain(`href="${href("contratos")}"`);
  });
});
