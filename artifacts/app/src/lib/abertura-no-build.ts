/**
 * A folha do app vai para o corpo, logo antes do `#root` (carregamento v2,
 * parte 9). No <head>, como o Vite a põe, ela segurava a primeira pintura
 * inteira, a abertura preta inclusive, até chegar, e no primeiro acesso ela
 * disputa a rede com uns 500 KB de JavaScript. No corpo, ela só segura o que
 * vem depois dela: o `#root`, que o React preenche depois que ela chega (os
 * scripts esperam as folhas). A abertura tem o CSS dela no próprio index.html.
 * Usada pelo vite.config.ts no build.
 */
const FOLHA_DO_APP = /[ \t]*<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="[^"]*\/assets\/[^"]+\.css")[^>]*>\r?\n?/g;

export function folhasDepoisDaAbertura(html: string): string {
  const folhas = html.match(FOLHA_DO_APP) ?? [];
  if (folhas.length === 0) return html;
  const semFolhas = html.replace(FOLHA_DO_APP, "");
  const raiz = semFolhas.search(/[ \t]*<div id="root"[\s>]/);
  const abertura = semFolhas.indexOf('<div id="abertura"');
  if (raiz < 0 || abertura < 0 || abertura > raiz) {
    throw new Error("index.html sem a abertura antes do #root: a folha do app não tem onde ficar.");
  }
  const recuo = /^[ \t]*/.exec(semFolhas.slice(raiz))?.[0] ?? "";
  const bloco = folhas.map((folha) => `${recuo}${folha.trim()}\n`).join("");
  return semFolhas.slice(0, raiz) + bloco + semFolhas.slice(raiz);
}
