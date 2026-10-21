import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ABAS_DO_COMERCIAL, ROTA_CLIENTES, ROTA_COMERCIAL, ROTA_ORCAMENTO, TELAS_DO_COMERCIAL } from "@/lib/comercial/navegacao";

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
    expect(render("/comercial/clientes", [ROTA_CLIENTES])).toBe("");
  });

  it("hoje: Orçamentos, Contratos e Medições; Orçamentos marcada na fila e na montagem do orçamento", () => {
    for (const atual of [ROTA_COMERCIAL, ROTA_ORCAMENTO]) {
      const html = render(atual, TELAS_DO_COMERCIAL);
      expect(html.replace(/<[^>]+>/g, "|").split("|").filter(Boolean)).toEqual(["Orçamentos", "Contratos", "Medições"]);
      expect(html, atual).toMatch(/<a [^>]*aria-current="page"[^>]*>Orçamentos<\/a>/);
      expect(html, atual).not.toMatch(/<a [^>]*aria-current="page"[^>]*>Contratos<\/a>/);
    }
    expect(render(ROTA_CLIENTES, TELAS_DO_COMERCIAL)).not.toContain("aria-current");
  });

  it("na tela de contratos, a aba Contratos fica marcada", () => {
    const html = render(href("contratos"), TELAS_DO_COMERCIAL);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Contratos<\/a>/);
    expect(html).not.toMatch(/<a [^>]*aria-current="page"[^>]*>Orçamentos<\/a>/);
  });

  it("na tela de medições, a aba Medições fica marcada", () => {
    const html = render(href("medicoes"), TELAS_DO_COMERCIAL);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Medições<\/a>/);
    expect(html).not.toMatch(/<a [^>]*aria-current="page"[^>]*>Orçamentos<\/a>/);
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
