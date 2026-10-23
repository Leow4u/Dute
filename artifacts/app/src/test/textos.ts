import { JSDOM } from "jsdom";

/**
 * Trava contra legenda (docs/plataforma/plano-de-implantacao.md, seção 1.2):
 * a tela só mostra rótulos, dados e ações. O teste lista o que a tela pode
 * mostrar; qualquer texto fora da lista é legenda que entrou sem querer.
 *
 * `textosDaTela` devolve cada texto visível, sem repetir, na ordem em que
 * aparece. Texto só para leitor de tela (sr-only) entra também: ele precisa
 * estar na lista como qualquer outro.
 */
export function textosDaTela(html: string): string[] {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const { document, NodeFilter } = dom.window;
  const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set<string>();
  for (let no = andar.nextNode(); no; no = andar.nextNode()) {
    const pai = no.parentElement;
    if (!pai || pai.closest("script, style, template")) continue;
    const texto = (no.textContent ?? "").replace(/\s+/g, " ").trim();
    if (texto) vistos.add(texto);
  }
  dom.window.close();
  return [...vistos];
}

/** Os textos da tela que não estão na lista do teste. */
export function textosForaDaLista(html: string, permitidos: ReadonlyArray<string | RegExp>): string[] {
  return textosDaTela(html).filter(
    (texto) => !permitidos.some((permitido) => (typeof permitido === "string" ? permitido === texto : permitido.test(texto))),
  );
}
