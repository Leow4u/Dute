import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarBrand } from "./sidebar-brand";

function images(collapsed: boolean) {
  const html = renderToStaticMarkup(<SidebarBrand basePath="" collapsed={collapsed} />);
  return [...html.matchAll(/<img [^>]*>/g)].map((match) => match[0]);
}

describe("logo da barra lateral", () => {
  it("as imagens ficam sempre na página: recolher ou trocar o tema não carrega nada", () => {
    for (const collapsed of [false, true]) {
      const [logo, logoDark, mark] = images(collapsed);
      expect(logo).toContain('src="/dutelog-logo.png"');
      expect(logo).toContain("dark:hidden");
      expect(logoDark).toContain('src="/dutelog-logo-light.png"');
      expect(logoDark).toContain("dark:block");
      expect(logoDark).toContain('aria-hidden="true"');
      expect(mark).toContain('src="/dutelog-mark-180.png"');
    }
  });

  it("aberta mostra o logo completo; recolhida mostra só o D, sem esmagar o logo", () => {
    const [logoOpen, , markOpen] = images(false);
    expect(logoOpen).toContain("opacity-100");
    expect(markOpen).toContain("opacity-0");
    expect(markOpen).toContain('aria-hidden="true"');

    const [logoClosed, , markClosed] = images(true);
    expect(logoClosed).toContain("opacity-0");
    expect(logoClosed).toContain("max-w-0");
    expect(logoClosed).toContain('aria-hidden="true"');
    expect(markClosed).toContain("opacity-100");
    expect(markClosed).toContain('alt="Dutelog"');
  });
});
