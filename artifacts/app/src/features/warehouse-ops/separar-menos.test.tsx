import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { SepararMenosConteudo, type DiferencaDaLinha } from "./separar-menos";

/**
 * "Separar menos" (separação com caixas, parte 5; decisão 14 de 10/11/2026;
 * docs/mockups/WmsSepararMenos.dc.html). Antes, quem opera não tinha onde
 * registrar o que separou a menos. Dados sintéticos.
 */

const noop = () => undefined;
const LANCHEIRA: DiferencaDaLinha = { id: "pli_1", nome: "Lancheira Grande AZ", posicao: "B-09", pedido: 2, separado: 1, motivo: "avaria", detalhe: "1 com o zíper quebrado" };

function render(diferenca: DiferencaDaLinha, registrando = false) {
  return renderToStaticMarkup(<SepararMenosConteudo diferenca={diferenca} registrando={registrando} onMudar={noop} onVoltar={noop} onRegistrar={noop} />);
}

function campos(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const { document } = dom.window;
  const resultado = {
    separado: document.querySelector<HTMLInputElement>("input[aria-label='Separado de Lancheira Grande AZ']")?.value,
    motivo: document.querySelector<HTMLInputElement>("input[type='radio'][checked]")?.value ?? null,
    detalhe: document.querySelector<HTMLInputElement>("#separar-menos-detalhe")?.value,
    menos: document.querySelector("button[aria-label='Menos um']")?.hasAttribute("disabled"),
    mais: document.querySelector("button[aria-label='Mais um']")?.hasAttribute("disabled"),
    registrar: [...document.querySelectorAll("button")].find((botao) => botao.textContent?.startsWith("Registr"))?.hasAttribute("disabled"),
  };
  dom.window.close();
  return resultado;
}

describe("Separar menos", () => {
  it("só rótulos, dados e ações: o item, a prateleira e o pedido; o separado, o motivo e o detalhe", () => {
    expect(textosDaTela(render(LANCHEIRA))).toEqual([
      "Lancheira Grande AZ · B-09 · pedido 2 un.",
      "Separado",
      "Motivo da diferença",
      "Falta",
      "Avaria",
      "Detalhe",
      "Voltar",
      "Registrar diferença",
    ]);
    expect(campos(render(LANCHEIRA))).toEqual({ separado: "1", motivo: "avaria", detalhe: "1 com o zíper quebrado", menos: false, mais: true, registrar: false });
  });

  it("Registrar diferença só liga com o separado abaixo do pedido e o motivo escolhido", () => {
    expect(campos(render({ ...LANCHEIRA, motivo: "" }))).toMatchObject({ motivo: null, registrar: true });
    expect(campos(render({ ...LANCHEIRA, separado: 2 }))).toMatchObject({ registrar: true });
    expect(campos(render({ ...LANCHEIRA, separado: 0, motivo: "falta" }))).toMatchObject({ separado: "0", menos: true, mais: false, registrar: false });
  });

  it("gravando, o botão diz Registrando e não aceita outro clique", () => {
    const html = render(LANCHEIRA, true);
    expect(textosDaTela(html)).toContain("Registrando...");
    expect(campos(html).registrar).toBe(true);
  });

  it("a linha sem endereço não deixa o separador sobrando", () => {
    expect(textosDaTela(render({ ...LANCHEIRA, posicao: "" }))[0]).toBe("Lancheira Grande AZ · pedido 2 un.");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render(LANCHEIRA))).toEqual([]);
  });
});
