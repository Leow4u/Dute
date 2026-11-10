import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ConcluirSeparacaoConteudo } from "./concluir-separacao";

/**
 * "Concluir separação" (separação com caixas, parte 2;
 * docs/mockups/WmsSepararConcluir.dc.html): o lacre, um por pedido. Dados
 * sintéticos.
 */

const noop = () => undefined;
const RESUMO = "BTG Pactual · 116 itens · 3.335 un. · Para quando Seg 16/11 11:36";

function render(lacre: string, confirmando = false) {
  return renderToStaticMarkup(<ConcluirSeparacaoConteudo resumo={RESUMO} lacre={lacre} confirmando={confirmando} onLacre={noop} onVoltar={noop} onConfirmar={noop} />);
}

function confirmar(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const botao = dom.window.document.querySelector("button[type='submit']");
  const resultado = { texto: botao?.textContent, desligado: botao?.hasAttribute("disabled") };
  dom.window.close();
  return resultado;
}

describe("Concluir separação", () => {
  it("só rótulos, dados e ações: o pedido e o Número do lacre", () => {
    expect(textosDaTela(render("88231"))).toEqual([RESUMO, "Número do lacre", "Voltar", "Confirmar separação"]);
    expect(render("88231")).toMatch(/<label[^>]*for="concluir-separacao-lacre"[^>]*>Número do lacre<\/label>/);
  });

  it("Confirmar separação só liga com o lacre", () => {
    expect(confirmar(render(""))).toEqual({ texto: "Confirmar separação", desligado: true });
    expect(confirmar(render("   "))).toMatchObject({ desligado: true });
    expect(confirmar(render("88231"))).toMatchObject({ desligado: false });
  });

  it("gravando, o botão diz Registrando e não aceita outro clique", () => {
    expect(confirmar(render("88231", true))).toEqual({ texto: "Registrando...", desligado: true });
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("88231"))).toEqual([]);
  });
});
