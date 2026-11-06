import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Spinner } from "./spinner";

/** O spinner em anel (docs/plataforma/diagnostico-carregamento.md, decisão 5 de 06/11/2026). */

describe("o spinner em anel", () => {
  it("é o anel com o arco, que gira e para com movimento reduzido", () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain("<circle");
    expect(html).toContain('d="M21 12a9 9 0 0 0-9-9"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("motion-reduce:animate-none");
  });

  it("ao lado de um rótulo, fica fora da árvore de acessibilidade", () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
  });

  it("sozinho, com aria-label, vira o aviso de status", () => {
    const html = renderToStaticMarkup(<Spinner aria-label="Carregando" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Carregando"');
    expect(html).not.toContain("aria-hidden");
  });
});
