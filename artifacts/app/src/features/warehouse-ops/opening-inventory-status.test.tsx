import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpeningInventoryNotice } from "./opening-inventory-status";

describe("faixa de estado do inventário de abertura", () => {
  it("em andamento: informação, contagem até agora e a ação que a tela passar", () => {
    const html = renderToStaticMarkup(
      <OpeningInventoryNotice
        session={{ status: "open", line_count: 12, unit_count: 148 }}
        actions={<a href="/wms/contagem">Continuar contagem</a>}
      />,
    );
    expect(html).toContain("Inventário de abertura em andamento");
    expect(html).toContain("12 produtos e 148 unidades confirmados");
    expect(html).toContain("bg-info-soft");
    expect(html).toContain('href="/wms/contagem"');
  });

  it("pendente: atenção, sem cor fixa", () => {
    const html = renderToStaticMarkup(
      <OpeningInventoryNotice session={{ status: "not_started" }} />,
    );
    expect(html).toContain("Inventário de abertura pendente");
    expect(html).toContain("bg-warning-soft");
    expect(html).not.toMatch(/bg-(?:white|amber|yellow)-?\d*/);
  });

  it("concluída: não renderiza nada", () => {
    expect(
      renderToStaticMarkup(<OpeningInventoryNotice session={{ status: "completed" }} />),
    ).toBe("");
  });
});
