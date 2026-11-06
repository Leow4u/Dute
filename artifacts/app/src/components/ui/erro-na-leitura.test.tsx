import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { BlocoSemConexao, ErroNaLeitura, FaixaSemConexao } from "./erro-na-leitura";

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

/** Sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular, de 06/11/2026). */

describe("sem conexão e sem nada lido", () => {
  it("o aviso no lugar da lista, com o ícone da rede e a nova tentativa", async () => {
    const html = renderToStaticMarkup(<BlocoSemConexao tentando={false} onTentar={() => undefined} />);
    expect(textosDaTela(html)).toEqual(["Sem conexão.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("lucide-wifi-off");
    expect(html).not.toContain("lucide-circle-alert");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("sem conexão com a lista já lida", () => {
  // 13:42 UTC são 10:42 no armazém.
  const lidaEm = Date.parse("2026-11-06T13:42:00Z");

  it("a faixa diz desde quando é a lista que está na tela", async () => {
    const html = renderToStaticMarkup(<FaixaSemConexao lidaEm={lidaEm} tentando={false} onTentar={() => undefined} />);
    expect(textosDaTela(html)).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(html).toContain('role="status"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("tentando de novo: gira e fica desligada", async () => {
    const html = renderToStaticMarkup(<FaixaSemConexao lidaEm={lidaEm} tentando onTentar={() => undefined} />);
    expect(textosDaTela(html)).toEqual(["Sem conexão · lista de 10:42", "Tentando de novo…"]);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("data-spinner");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o toque da nova tentativa tem 44 px de altura", () => {
    const html = renderToStaticMarkup(<FaixaSemConexao lidaEm={lidaEm} tentando={false} onTentar={() => undefined} />);
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11/);
  });
});
