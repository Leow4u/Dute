import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formDoContato, type FormContato } from "@/lib/comercial/clientes";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { AvisosDoContato } from "./clientes-dialogos";

/**
 * Os avisos por e-mail no diálogo do contato (parte 4.6b): só com o e-mail;
 * a NF só para o gestor e o financeiro do cliente; rótulos sem legenda e
 * `axe`. O diálogo em si (portal) é do Radix.
 */

const noop = () => undefined;

function form(parcial: Partial<FormContato>): FormContato {
  return { ...formDoContato(null), nome: "Renata Okubo", ...parcial };
}

function html(f: FormContato): string {
  return renderToStaticMarkup(<AvisosDoContato form={f} desabilitado={false} onMarcar={noop} />);
}

function render(f: FormContato): HTMLElement {
  return new JSDOM(`<!doctype html><body>${html(f)}</body>`).window.document.body;
}

function textos(container: HTMLElement): string[] {
  return [...container.querySelectorAll("legend, label")].map((item) => item.textContent?.trim() ?? "");
}

describe("avisos por e-mail do contato", () => {
  it("sem o e-mail, nada aparece", () => {
    expect(render(form({ papel: "gestor_cliente" })).innerHTML).toBe("");
  });

  it("o gestor do cliente vê os cinco modelos, com os marcados", () => {
    const container = render(form({ email: "renata@itau.com", papel: "gestor_cliente", avisos: ["os_agendada", "nf_emitida"] }));
    expect(textos(container)).toEqual(["Avisos por e-mail", "OS agendada", "OS em execução", "OS concluída", "NF emitida", "Solicitação recebida"]);
    const marcados = [...container.querySelectorAll('[role="checkbox"][aria-checked="true"]')].map((item) => item.id);
    expect(marcados).toEqual(["contato-aviso-os_agendada", "contato-aviso-nf_emitida"]);
  });

  it("a gerenciadora não vê a NF, que leva o valor", () => {
    const container = render(form({ email: "camila@sl.com", papel: "gerenciadora", avisos: ["nf_emitida"] }));
    expect(textos(container)).toEqual(["Avisos por e-mail", "OS agendada", "OS em execução", "OS concluída", "Solicitação recebida"]);
  });

  it("sem violações de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(html(form({ email: "renata@itau.com", papel: "financeiro", avisos: ["nf_emitida"] })))).toEqual([]);
  });
});
