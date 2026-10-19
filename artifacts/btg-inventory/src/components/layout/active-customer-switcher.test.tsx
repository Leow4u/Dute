import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ActiveCustomerSwitcher } from "./active-customer-switcher";

const render = (variant: "sidebar" | "compact" | "header") =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ActiveCustomerSwitcher variant={variant} canManageCustomers />
    </TooltipProvider>,
  );

describe("seletor do cliente ativo", () => {
  it("no menu, mostra o cliente ativo (a BTG, sem perfil carregado) com rótulo acessível", () => {
    const html = render("sidebar");
    expect(html).toContain("Cliente ativo");
    expect(html).toContain("BTG Pactual");
    expect(html).toContain('aria-label="Cliente ativo: BTG Pactual. Trocar cliente"');
    expect(html).toContain("bg-info-soft");
  });

  it("no cabeçalho do celular e no menu recolhido, o mesmo rótulo", () => {
    expect(render("header")).toContain('aria-label="Cliente ativo: BTG Pactual. Trocar cliente"');
    expect(render("compact")).toContain('aria-label="Cliente ativo: BTG Pactual. Trocar cliente"');
  });
});
