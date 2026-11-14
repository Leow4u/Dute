import { JSDOM } from "jsdom";

import { textosDaTela } from "./textos";

/**
 * Os botões como a pessoa os lê (carregamento v2, parte 13g). O
 * `BotaoDeAcao` empilha as camadas (repouso, em andamento, sucesso, erro e
 * "Conferir") na mesma célula, e só a atual fica visível e na árvore de
 * acessibilidade: o rótulo do botão é o da camada atual, e não o
 * `textContent` inteiro. Nos outros botões, o texto deles.
 */
export function rotuloDoBotao(botao: Element): string {
  const atual = botao.querySelector(".botao-acao-camada[data-atual]");
  return (atual ?? botao).textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** O botão com o rótulo dado (o da camada atual, no `BotaoDeAcao`). */
export function botaoPeloRotulo(raiz: ParentNode, rotulo: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll<HTMLButtonElement>("button")].find((botao) => rotuloDoBotao(botao) === rotulo);
}

/** O botão está travado: `disabled` ou, no `BotaoDeAcao` e no Cancelar em ação, `aria-disabled` com a trava no código. */
export function travado(botao: Element): boolean {
  return botao.hasAttribute("disabled") || botao.getAttribute("aria-disabled") === "true";
}

/**
 * O HTML sem as camadas escondidas do `BotaoDeAcao` (o gerúndio, o sucesso,
 * o erro e o "Conferir" que não são a atual): o que a pessoa vê, na ordem.
 * Para as listas de "textos visíveis, na ordem" dos testes de tela. A trava
 * contra legenda (`textosForaDaLista`) continua lendo todas as camadas.
 */
export function semCamadasEscondidas(html: string): string {
  if (!html.includes("botao-acao-camada")) return html;
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  for (const camada of dom.window.document.querySelectorAll('.botao-acao-camada[aria-hidden="true"]')) camada.remove();
  // O jsdom escreve o espaço que não quebra como entidade; o HTML do React o traz cru.
  const limpo = dom.window.document.body.innerHTML.replace(/&nbsp;/g, "\u00a0");
  dom.window.close();
  return limpo;
}

/**
 * Os rótulos das ações principais da tela (o primário cheio,
 * `bg-primary text-primary-foreground`), na ordem: o da camada atual no
 * `BotaoDeAcao`, o texto nos outros botões e links.
 */
export function acoesPrincipais(html: string): string[] {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const principais = [...dom.window.document.querySelectorAll("button, a")].filter((elemento) => {
    const classe = elemento.getAttribute("class") ?? "";
    return classe.includes("bg-primary") && classe.includes("text-primary-foreground");
  });
  const rotulos = principais.map((elemento) => rotuloDoBotao(elemento));
  dom.window.close();
  return rotulos;
}

/** O botão do HTML com o rótulo dado está travado (`disabled` ou `aria-disabled`, nunca as duas faltando). */
export function travadoNoHtml(html: string, rotulo: string): boolean {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const botao = botaoPeloRotulo(dom.window.document, rotulo);
  if (!botao) {
    dom.window.close();
    throw new Error(`Botão "${rotulo}" não encontrado.`);
  }
  const resposta = travado(botao);
  dom.window.close();
  return resposta;
}

/**
 * O relógio do `BotaoDeAcao` passa do intervalo do toque duplo (1 s): o
 * próximo toque no mesmo botão é outro pedido, como o da pessoa que corrige o
 * campo e toca de novo. Devolve quem volta o relógio.
 */
export function depoisDoToqueDuplo(): () => void {
  const real = Date.now.bind(Date);
  const avanco = real() + 1_500;
  const base = real();
  const espiao = Object.getOwnPropertyDescriptor(Date, "now");
  Date.now = () => avanco + (real() - base);
  return () => {
    if (espiao) Object.defineProperty(Date, "now", espiao);
  };
}

/** Os textos que a pessoa vê, na ordem (`textosDaTela` sem as camadas escondidas do `BotaoDeAcao`). */
export function textosVisiveis(html: string): string[] {
  return textosDaTela(semCamadasEscondidas(html));
}
