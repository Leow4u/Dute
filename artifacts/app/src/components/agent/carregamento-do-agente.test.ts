import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * As telas do Agent Dute no carregamento v2 (parte 12): a conversa, o painel
 * antigo e o /agente/painel, as anotações, os playbooks, as rotinas, os
 * cartões de rascunho, o painel antigo (ai-control) e o Conhecimento. Nelas,
 * nada gira fora do `Spinner` (a caixa chanfrada), nada pulsa fora do
 * `Esqueleto`, o esqueleto rosado (`Skeleton`) não volta, o "Pensando…" não
 * volta e a reticência é o caractere "…", nunca os três pontos.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const DO_AGENTE = fileURLToPath(new URL(".", import.meta.url));

const ARQUIVOS = [
  ...readdirSync(DO_AGENTE)
    .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
    .map((nome) => `components/agent/${nome}`),
  "pages/agente-painel.tsx",
  "pages/agente-painel-view.tsx",
  "pages/ai-control.tsx",
  "pages/agent-knowledge.tsx",
];

const PROIBIDOS: Array<[string, RegExp]> = [
  ["ícone girando (use o Spinner)", /\banimate-spin\b/],
  ["bloco pulsando (use o Esqueleto)", /\banimate-pulse\b/],
  ["o Loader2", /\bLoader2\b/],
  ["o Skeleton rosado (use o Esqueleto)", /from "@\/components\/ui\/skeleton"/],
  ["o Pensando", /Pensando/],
  ["três pontos no texto (use …)", /[\p{L}\d)]\.\.\.(?![\w.])|["'`>]\.\.\.["'`<]/u],
];

describe("as telas do Agent Dute no carregamento v2", () => {
  it("a lista cobre a conversa, a trilha, os cartões e os painéis", () => {
    expect(ARQUIVOS).toEqual(
      expect.arrayContaining([
        "components/agent/agent-screen.tsx",
        "components/agent/trilha-do-agente.tsx",
        "components/agent/agent-notes.tsx",
        "components/agent/agent-playbooks.tsx",
        "components/agent/routines.tsx",
        "components/agent/order-draft-card.tsx",
        "components/agent/shipment-draft-card.tsx",
        "components/agent/note-draft-card.tsx",
        "components/agent/routine-draft-card.tsx",
      ]),
    );
  });

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo}: sem ícone girando, bloco pulsando, Skeleton, "Pensando…" nem três pontos`, () => {
      // Os comentários podem citar o que saiu; vale o código.
      const texto = readFileSync(`${SRC}/${arquivo}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (comentario) => comentario.replace(/[^\n]/g, " "))
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      const achados = PROIBIDOS.flatMap(([nome, padrao]) =>
        texto.split("\n").flatMap((linha, indice) => (padrao.test(linha) ? [`${nome} na linha ${indice + 1}: ${linha.trim()}`] : [])),
      );
      expect(achados).toEqual([]);
    });
  }
});
