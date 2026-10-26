import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

// Sem o Firebase de verdade: a capa mostra o aviso de configuração só quando falta.
vi.mock("@/lib/firebase", () => ({ firebaseConfigError: null, firebaseAuth: null, firestore: null }));

import { PortalDesligadoView } from "./portal-desligado";

function render(email: string | null = "ana.ribeiro@itau.com.br") {
  return renderToStaticMarkup(<PortalDesligadoView cliente="Itaú Unibanco" email={email} onSair={() => undefined} />);
}

describe("o portal desligado (perguntas 69 e 71)", () => {
  it("diz que o portal está desligado, com o cliente, o e-mail da pessoa e Sair", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain("Portal desligado");
    expect(html).toContain("Itaú Unibanco");
    expect(html).toContain("ana.ribeiro@itau.com.br");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Sair<\/button>/);
  });

  it("sem o e-mail, só o Sair", () => {
    const html = render(null);
    expect(html).not.toContain("@");
    expect(html).toContain(">Sair<");
  });

  it("só mostra rótulos, dados e ações (sem legenda)", () => {
    expect(
      textosForaDaLista(render(), [
        "Portal desligado",
        "Itaú Unibanco",
        "ana.ribeiro@itau.com.br",
        "Sair",
        /^© \d{4} Dutelog Soluções Logísticas$/,
      ]),
    ).toEqual([]);
  });

  it("passa no axe (WCAG 2.1 A e AA)", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
