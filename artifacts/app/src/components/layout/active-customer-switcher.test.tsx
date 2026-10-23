import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { ActiveCustomerSwitcher } from "./active-customer-switcher";

const render = (variant: "v3" | "v3-cabecalho") => renderToStaticMarkup(<ActiveCustomerSwitcher variant={variant} canManageCustomers />);

describe("seletor do cliente ativo", () => {
  it("na barra preta, mostra o cliente ativo (a BTG, sem perfil carregado) com rótulo acessível", () => {
    const html = render("v3");
    expect(html).toContain(">Cliente ativo<");
    expect(html).toContain(">BTG Pactual<");
    expect(html).toContain('aria-label="Cliente ativo: BTG Pactual. Trocar cliente"');
    expect(html).toContain("text-v3-header-foreground");
  });

  it("no cabeçalho do celular, o nome e o mesmo rótulo", () => {
    const html = render("v3-cabecalho");
    expect(html).toContain('aria-label="Cliente ativo: BTG Pactual. Trocar cliente"');
    expect(html).toContain(">BTG Pactual<");
    expect(html).not.toContain(">Cliente ativo<");
  });

  it("sem legenda: nenhuma explicação de para onde as telas gravam", () => {
    const fonte = renderToStaticMarkup(<ActiveCustomerSwitcher variant="v3" canManageCustomers />);
    expect(fonte).not.toMatch(/vão para ele|mostram todos/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(`<div class="v3 bg-v3-header">${render("v3")}${render("v3-cabecalho")}</div>`)).toEqual([]);
  });
});
