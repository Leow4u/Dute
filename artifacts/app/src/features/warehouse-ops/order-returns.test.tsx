import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { RetornosView, type RetornosViewProps } from "./order-returns";

/** Devoluções › Retornos da Operação (parte 4.5d): o retorno a receber e a conferência, sem legenda. */

const RETORNO = { orderId: "ord_118", numero: "PED-0118", customerCode: "BTG Pactual", os: "10050-02", chegouEm: "2026-10-30T21:40:00.000Z" };
const noop = () => undefined;
const acoes = { abrir: noop, fechar: noop, mudarLinha: noop, mudarNotas: noop, receber: noop };

function render(extra: Partial<RetornosViewProps> = {}) {
  return renderToStaticMarkup(<RetornosView retornos={[RETORNO]} aberto={null} acoes={acoes} {...extra} />);
}

describe("os retornos da Operação", () => {
  it("o pedido, a OS e quando chegou, com Receber retorno; sem retorno, nada aparece", () => {
    expect(textosDaTela(render())).toEqual(["Retornos da Operação", "a receber · 1", "PED-0118", "OS 10050-02 · chegou Sex 30/10 18:40", "Receber retorno"]);
    expect(render({ retornos: [] })).toBe("");
  });

  it("quem só consulta vê o retorno sem Receber retorno", () => {
    expect(textosDaTela(render({ somenteConsulta: true }))).toEqual(["Retornos da Operação", "a receber · 1", "PED-0118", "OS 10050-02 · chegou Sex 30/10 18:40"]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});

/**
 * A falha e a espera dos retornos (carregamento v2, parte 13c; diagnóstico,
 * 4.5). Antes, a leitura que falhava fazia o grupo sumir (`return null`), e
 * as linhas do pedido que não vinham ficavam em "Carregando..." para sempre,
 * com o "Receber" travado.
 */
describe("os retornos que não vieram e as linhas que esperam", () => {
  const tentar = async () => undefined;

  it("a leitura que falhou mostra o aviso com Tentar de novo, no lugar do grupo que sumia", async () => {
    const html = render({ retornos: [], falha: { tentar } });
    expect(textosDaTela(html)).toEqual(["Retornos da Operação", "Não consegui carregar os retornos da Operação.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

});
