import axe from "axe-core";
import { JSDOM } from "jsdom";

/**
 * Acessibilidade das telas novas (docs/plataforma/plano-de-implantacao.md,
 * seção 1.2): roda o axe-core, só as regras WCAG 2.1 A e AA, sobre o HTML que
 * o teste renderizou. O contraste de cor fica de fora: o jsdom não carrega o
 * CSS do Tailwind; as cores da v3 são conferidas no docs/mockups/README.md.
 *
 * Devolve uma linha por violação ("regra: alvo"), para o teste comparar com [].
 */
export async function violacoesDeAcessibilidade(html: string): Promise<string[]> {
  const dom = new JSDOM(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste</title></head><body>${html}</body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  dom.window.eval(axe.source);
  const axeDaJanela = (dom.window as unknown as { axe: typeof axe }).axe;
  const resultado = await axeDaJanela.run(dom.window.document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  dom.window.close();
  return resultado.violations.flatMap((violacao) =>
    violacao.nodes.map((node) => `${violacao.id}: ${node.target.join(" ")}`),
  );
}
