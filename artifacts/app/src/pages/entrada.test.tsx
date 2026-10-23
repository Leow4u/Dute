import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { entrada } from "@/lib/platform-modules";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { EntradaView, type EntradaTela, type ResumosDaEntrada } from "./entrada";

// Terça-feira, 20/10/2026, de manhã.
const TODAY = new Date(2026, 9, 20, 9, 0);

function render(decision: EntradaTela, resumos?: ResumosDaEntrada, resumosProntos = false) {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <EntradaView
        decision={decision}
        name="Leonardo Silva"
        today={TODAY}
        basePath=""
        onSignOut={() => undefined}
        resumos={resumos}
        resumosProntos={resumosProntos}
      />
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
    const decision = entrada("owner", null, false, false);
    if (decision.kind !== "cards") throw new Error("owner deveria ver cards");
    const html = render(decision);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/faturamento"');
    expect(html).toContain('class="v3 ');
  });

  // Comercial desligado, como na produção; o card dele vem no teste seguinte.
  it("sem legenda: só data, saudação, nome, iniciais e os módulos", () => {
    const decision = entrada("admin", null, false, false);
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
    const decision = entrada("admin", null, true, false);
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

  describe("contadores (parte 2.4)", () => {
    const cards = () => {
      const decision = entrada("owner", null, true, true);
      if (decision.kind !== "cards") throw new Error("owner deveria ver cards");
      return decision;
    };
    const RESUMOS: ResumosDaEntrada = {
      wms: { total: 2, alerta: false, primeira: "2 pedidos para separar" },
      comercial: { total: 3, alerta: true, primeira: "Prazo de faturamento vencido em 29/09/2026 · BTG Pactual" },
      operacao: { total: 0, alerta: false, primeira: null },
    };

    it("cada card mostra a primeira linha do Início do módulo e quantas são; a frase soma tudo", () => {
      expect(texts(render(cards(), RESUMOS, true))).toEqual([
        "Leonardo Silva",
        "LS",
        "Terça-feira, 20 de outubro",
        "Bom dia, Leonardo",
        "5 coisas",
        "precisam de você hoje.",
        "Armazenagem",
        "2 pedidos para separar",
        "2",
        "Operação",
        "Comercial",
        "Prazo de faturamento vencido em 29/09/2026 · BTG Pactual",
        "3",
        "Financeiro",
      ]);
    });

    it("vermelho só no módulo com item crítico; sem nada parado, sem número", () => {
      const html = render(cards(), RESUMOS, true);
      expect(html).toMatch(/<span class="[^"]*bg-v3-marca[^"]*">3<\/span>/);
      expect(html).toMatch(/<span class="[^"]*bg-muted text-foreground[^"]*">2<\/span>/);
      expect(html).not.toMatch(/>0<\/span>/);
    });

    it("enquanto algum módulo carrega, a frase não aparece; o card sem resumo fica só com o nome", () => {
      const textos = texts(render(cards(), { wms: RESUMOS.wms }, false));
      expect(textos).not.toContain("precisam de você hoje.");
      expect(textos.slice(4)).toEqual(["Armazenagem", "2 pedidos para separar", "2", "Operação", "Comercial", "Financeiro"]);
    });

    it("nada parado: a frase diz", () => {
      expect(texts(render(cards(), { wms: { total: 0, alerta: false, primeira: null } }, true))).toContain("Nada parado hoje.");
    });

    it("só rótulos, dados e ações, e sem violação do axe", async () => {
      const html = render(cards(), RESUMOS, true);
      const permitidos = [
        "Leonardo Silva",
        "Minha conta",
        "LS",
        "Terça-feira, 20 de outubro",
        "Bom dia, Leonardo",
        "5 coisas",
        "precisam de você hoje.",
        "Armazenagem",
        "Operação",
        "Comercial",
        "Financeiro",
        "2 pedidos para separar",
        "Prazo de faturamento vencido em 29/09/2026 · BTG Pactual",
        /^\d+$/,
      ];
      expect(textosForaDaLista(html, permitidos)).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    });
  });
});
