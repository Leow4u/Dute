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
/** As cinco camadas do botão de ação (a largura do maior): todas no DOM, só a atual na árvore. */
const BOTAO = ["Confirmar separação", "Concluindo…", "Concluído", "Não concluído", "Conferir"];
/** As etapas ficam na tela desde o repouso, pendentes (carregamento v2, parte 11). */
const ETAPAS = ["Etapa", "1", "de 2", "Separação", "2", "Embalagem"];

function render(lacre: string, confirmando = false) {
  return renderToStaticMarkup(<ConcluirSeparacaoConteudo resumo={RESUMO} lacre={lacre} confirmando={confirmando} onLacre={noop} onVoltar={noop} onConfirmar={noop} />);
}

function confirmar(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const botao = dom.window.document.querySelector(".botao-acao");
  const atual = botao?.querySelector(".botao-acao-camada[data-atual]");
  const resultado = { texto: atual?.textContent, desligado: botao?.getAttribute("aria-disabled") === "true", disabled: botao?.hasAttribute("disabled") };
  dom.window.close();
  return resultado;
}

describe("Concluir separação", () => {
  it("só rótulos, dados e ações: o pedido e o Número do lacre", () => {
    expect(textosDaTela(render("88231"))).toEqual([RESUMO, "Número do lacre", ...ETAPAS, "Voltar", ...BOTAO]);
    expect(render("88231")).toMatch(/<label[^>]*for="concluir-separacao-lacre"[^>]*>Número do lacre<\/label>/);
  });

  it("Confirmar separação só liga com o lacre (aria-disabled, nunca disabled)", () => {
    expect(confirmar(render(""))).toEqual({ texto: "Confirmar separação", desligado: true, disabled: false });
    expect(confirmar(render("   "))).toMatchObject({ desligado: true });
    expect(confirmar(render("88231"))).toMatchObject({ desligado: false });
  });

  it("gravando, o botão trava o outro clique sem desabilitar (o Concluindo… entra aos 300 ms, na mesma largura)", () => {
    expect(confirmar(render("88231", true))).toEqual({ texto: "Confirmar separação", desligado: true, disabled: false });
  });

  it("com as caixas do pedido lidas, diz as inteiras, as abertas e as vazias (parte 3)", async () => {
    const comCaixas = renderToStaticMarkup(
      <ConcluirSeparacaoConteudo resumo={RESUMO} caixas={{ inteiras: 31, abertas: 23, vazias: 4 }} lacre="88231" onLacre={noop} onVoltar={noop} onConfirmar={noop} />,
    );
    expect(textosDaTela(comCaixas)).toEqual([RESUMO, "Caixas inteiras", "31", "Caixas abertas", "23", "Caixas vazias", "4", "Número do lacre", ...ETAPAS, "Voltar", ...BOTAO]);
    expect(await violacoesDeAcessibilidade(comCaixas)).toEqual([]);
    // O pedido que não saiu de caixa nenhuma não ganha os números.
    const semCaixas = renderToStaticMarkup(
      <ConcluirSeparacaoConteudo resumo={RESUMO} caixas={{ inteiras: 0, abertas: 0, vazias: 0 }} lacre="88231" onLacre={noop} onVoltar={noop} onConfirmar={noop} />,
    );
    expect(textosDaTela(semCaixas)).toEqual([RESUMO, "Número do lacre", ...ETAPAS, "Voltar", ...BOTAO]);
  });

  it("com os volumes lidos, diz quantos o pedido fecha, antes das caixas (parte 4)", async () => {
    const comVolumes = renderToStaticMarkup(
      <ConcluirSeparacaoConteudo resumo={RESUMO} volumes={42} caixas={{ inteiras: 31, abertas: 23, vazias: 4 }} lacre="88231" onLacre={noop} onVoltar={noop} onConfirmar={noop} />,
    );
    expect(textosDaTela(comVolumes)).toEqual([
      RESUMO,
      "Volumes",
      "42",
      "Caixas inteiras",
      "31",
      "Caixas abertas",
      "23",
      "Caixas vazias",
      "4",
      "Número do lacre",
      ...ETAPAS,
      "Voltar",
      ...BOTAO,
    ]);
    expect(await violacoesDeAcessibilidade(comVolumes)).toEqual([]);
    // O pedido que não saiu de caixa diz só os volumes; sem volume, nada.
    const soVolumes = renderToStaticMarkup(<ConcluirSeparacaoConteudo resumo={RESUMO} volumes={3} lacre="88231" onLacre={noop} onVoltar={noop} onConfirmar={noop} />);
    expect(textosDaTela(soVolumes)).toEqual([RESUMO, "Volumes", "3", "Número do lacre", ...ETAPAS, "Voltar", ...BOTAO]);
    const semVolumes = renderToStaticMarkup(<ConcluirSeparacaoConteudo resumo={RESUMO} volumes={0} lacre="88231" onLacre={noop} onVoltar={noop} onConfirmar={noop} />);
    expect(textosDaTela(semVolumes)).toEqual([RESUMO, "Número do lacre", ...ETAPAS, "Voltar", ...BOTAO]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("88231"))).toEqual([]);
  });
});
