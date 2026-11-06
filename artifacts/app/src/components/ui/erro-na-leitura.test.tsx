import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ErroNaLeitura } from "./erro-na-leitura";

/** Erro nunca vira vazio (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026). */

describe("o erro na leitura", () => {
  it("diz que não conseguiu ler e oferece a nova tentativa, como alerta", async () => {
    const html = renderToStaticMarkup(
      <ErroNaLeitura mensagem="Não consegui carregar os pedidos." tentando={false} onTentar={() => undefined} />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui carregar os pedidos.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("tentando de novo: o botão gira, muda o rótulo e fica desligado", async () => {
    const html = renderToStaticMarkup(
      <ErroNaLeitura mensagem="Não consegui carregar os pedidos." tentando onTentar={() => undefined} />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui carregar os pedidos.", "Tentando de novo…"]);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("data-spinner");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
