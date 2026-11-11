import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CaixaDaPrateleira } from "@/lib/warehouse-ops/caixas-da-separacao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { OutraCaixaConteudo, caixasFecham, type OutraCaixaDaLinha } from "./outra-caixa";

/**
 * "Outra caixa" (separação com caixas, parte 3b;
 * docs/mockups/WmsSepararOutraCaixa.dc.html). Antes, a separação não dizia de
 * qual caixa o item saiu. Dados sintéticos.
 */

const noop = () => undefined;

const caixa = (code: string, origem: string, guardadaEm: string, disponivel: number): CaixaDaPrateleira => ({
  code,
  stored_at: null,
  disponivel,
  saldo: disponivel,
  intacta: true,
  origem,
  guardadaEm,
});

const CAMISETA: OutraCaixaDaLinha = {
  id: "pli_1",
  nome: "Camiseta Masculino Preta · G",
  posicao: "B-02",
  quantidade: 35,
  caixas: [
    caixa("CX-000061", "Abertura", "22/10/2026", 20),
    caixa("CX-000062", "Abertura", "22/10/2026", 40),
    caixa("CX-000064", "Recebimento · NF 48.377", "06/11/2026", 30),
  ],
  informadas: { "CX-000061": 0, "CX-000062": 35, "CX-000064": 0 },
};

function render(linha: OutraCaixaDaLinha, confirmando = false) {
  return renderToStaticMarkup(<OutraCaixaConteudo linha={linha} confirmando={confirmando} onMudar={noop} onVoltar={noop} onConfirmar={noop} />);
}

function campos(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const { document } = dom.window;
  const de = (codigo: string) => ({
    valor: document.querySelector<HTMLInputElement>(`input[aria-label='Separado de ${codigo}']`)?.value,
    menos: document.querySelector(`button[aria-label='Menos um de ${codigo}']`)?.hasAttribute("disabled"),
    mais: document.querySelector(`button[aria-label='Mais um de ${codigo}']`)?.hasAttribute("disabled"),
  });
  const resultado = {
    "CX-000061": de("CX-000061"),
    "CX-000062": de("CX-000062"),
    confirmar: [...document.querySelectorAll("button")].find((botao) => botao.textContent?.startsWith("Confirma"))?.hasAttribute("disabled"),
  };
  dom.window.close();
  return resultado;
}

describe("Outra caixa", () => {
  it("só rótulos, dados e ações: a linha, as caixas da prateleira com o que têm, a soma e os botões", () => {
    expect(textosDaTela(render(CAMISETA))).toEqual([
      "Camiseta Masculino Preta · G · B-02 · 35 un.",
      "CX-000061",
      "Abertura · 22/10/2026 · tem 20 un.",
      "CX-000062",
      "Abertura · 22/10/2026 · tem 40 un.",
      "CX-000064",
      "Recebimento · NF 48.377 · 06/11/2026 · tem 30 un.",
      "Separado",
      "35 de 35 un.",
      "Voltar",
      "Confirmar caixas",
    ]);
    expect(campos(render(CAMISETA))).toEqual({
      "CX-000061": { valor: "0", menos: true, mais: false },
      "CX-000062": { valor: "35", menos: false, mais: false },
      confirmar: false,
    });
  });

  it("Confirmar caixas só liga com a soma fechando com a linha, e a caixa não passa do que tem", () => {
    const faltando = { ...CAMISETA, informadas: { "CX-000061": 20, "CX-000062": 10 } };
    expect(textosDaTela(render(faltando))).toContain("30 de 35 un.");
    expect(campos(render(faltando))).toMatchObject({ "CX-000061": { valor: "20", mais: true }, confirmar: true });
    expect(caixasFecham(faltando)).toBe(false);
    expect(caixasFecham({ ...CAMISETA, informadas: { "CX-000061": 20, "CX-000062": 15 } })).toBe(true);
  });

  it("quando as caixas da prateleira não cobrem a linha, a soma fecha com tudo o que elas têm", () => {
    const poucas = { ...CAMISETA, quantidade: 100, informadas: { "CX-000061": 20, "CX-000062": 40, "CX-000064": 30 } };
    expect(textosDaTela(render(poucas))).toContain("90 de 90 un.");
    expect(caixasFecham(poucas)).toBe(true);
  });

  it("gravando, o botão diz Confirmando e não aceita outro clique", () => {
    const html = render(CAMISETA, true);
    expect(textosDaTela(html)).toContain("Confirmando...");
    expect(campos(html).confirmar).toBe(true);
  });

  it("a linha sem endereço não deixa o separador sobrando", () => {
    expect(textosDaTela(render({ ...CAMISETA, posicao: "" }))[0]).toBe("Camiseta Masculino Preta · G · 35 un.");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render(CAMISETA))).toEqual([]);
  });
});
