import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { entrada } from "@/lib/platform-modules";

import { EntradaView, type EntradaTela } from "./entrada";

// Terça-feira, 20/10/2026, de manhã.
const TODAY = new Date(2026, 9, 20, 9, 0);

function render(decision: EntradaTela) {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <EntradaView decision={decision} name="Leonardo Silva" today={TODAY} basePath="" onSignOut={() => undefined} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.trim())
    .filter(Boolean);
}

describe("tela de entrada", () => {
  it("um card por módulo, com link para a casa dele", () => {
    const decision = entrada("owner", null, false);
    if (decision.kind !== "cards") throw new Error("owner deveria ver cards");
    const html = render(decision);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/faturamento"');
    expect(html).toContain('class="v3 ');
  });

  // Comercial desligado, como na produção; o card dele vem no teste seguinte.
  it("sem legenda: só data, saudação, nome, iniciais e os módulos", () => {
    const decision = entrada("admin", null, false);
    if (decision.kind !== "cards") throw new Error("admin deveria ver cards");
    expect(texts(render(decision))).toEqual([
      "Leonardo Silva",
      "LS",
      "Terça-feira, 20 de outubro",
      "Bom dia, Leonardo",
      "Armazenagem",
      "Financeiro",
    ]);
  });

  it("com o Comercial liberado, o card Comercial leva a /comercial", () => {
    const decision = entrada("admin", null, true);
    if (decision.kind !== "cards") throw new Error("admin deveria ver cards");
    const html = render(decision);
    expect(texts(html).slice(4)).toEqual(["Armazenagem", "Comercial", "Financeiro"]);
    expect(html).toContain('href="/comercial"');
  });

  it("sem módulo: o aviso e a saída, nada mais", () => {
    expect(texts(render({ kind: "nenhum" }))).toEqual([
      "Leonardo Silva",
      "LS",
      "Terça-feira, 20 de outubro",
      "Bom dia, Leonardo",
      "Nenhum módulo liberado",
      "Sair",
    ]);
  });
});
