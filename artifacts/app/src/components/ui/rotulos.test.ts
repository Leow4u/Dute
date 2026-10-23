import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O botão de fechar do diálogo e da gaveta é lido pelo leitor de tela: em
 * português, como o resto do app (achado da conferência local do Comercial,
 * 21/10/2026).
 */
describe("rótulos dos componentes de base", () => {
  it.each(["dialog.tsx", "sheet.tsx"])("%s: o fechar diz Fechar", (arquivo) => {
    const fonte = readFileSync(new URL(`./${arquivo}`, import.meta.url), "utf8");
    expect(fonte).toContain('<span className="sr-only">Fechar</span>');
    expect(fonte).not.toMatch(/>Close</);
  });
});
