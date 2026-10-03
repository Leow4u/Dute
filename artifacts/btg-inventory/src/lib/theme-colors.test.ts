import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Trava do modo escuro: cor fixa clara não volta para a interface.
 *
 * Superfície branca, tom pastel do Tailwind (50-300) e texto escuro de
 * estado (600-950) ficam certos só no tema claro; no escuro viram bloco
 * branco ou texto ilegível. Use os tokens de index.css: bg-card,
 * border-card-edge, bg-muted, text-muted-foreground, *-soft
 * (success / info / warning / destructive), agent-*, surface-hover.
 *
 * Continuam permitidos, porque funcionam nos dois temas: cores sólidas
 * saturadas (pontos de status bg-green-600, botão bg-red-700), texto branco
 * sobre fundo saturado, véus bg-black/NN e cores de gráfico em style.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Papel de impressão: fica branco nos dois temas (ver .print-area em index.css). */
const PAPER_FILES = new Set([
  "components/billing/invoice-document.tsx",
  "pages/client/relatorio.tsx",
]);

/** Padrão shadcn: texto do toast destrutivo sobre fundo destructive. */
const VENDOR_FILES = new Set(["components/ui/toast.tsx"]);

const NEUTRAL = "slate|gray|zinc|neutral|stone";
const HUES =
  "red|rose|pink|fuchsia|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple";

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "superfície branca", pattern: /\b(?:bg|border|divide|ring)-white\b/g },
  { name: "texto neutro fixo", pattern: new RegExp(`\\btext-(?:${NEUTRAL})-\\d+\\b`, "g") },
  {
    name: "superfície neutra clara",
    pattern: new RegExp(`\\b(?:bg-(?:${NEUTRAL})-(?:50|100|200)|(?:border|divide)-(?:${NEUTRAL})-(?:100|200|300))\\b`, "g"),
  },
  {
    name: "superfície pastel de estado",
    pattern: new RegExp(`\\b(?:bg|border|divide)-(?:${HUES})-(?:50|100|200|300)\\b`, "g"),
  },
  {
    name: "texto escuro de estado",
    pattern: new RegExp(`\\btext-(?:${HUES})-(?:600|700|800|900|950)\\b`, "g"),
  },
  { name: "hex solto em classe", pattern: /-\[#[0-9a-fA-F]{3,8}\]/g },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function violations(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (PAPER_FILES.has(rel) || VENDOR_FILES.has(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const rule of RULES) {
          for (const match of line.matchAll(rule.pattern)) {
            found.push(`${rel}:${index + 1} ${rule.name}: ${match[0]}`);
          }
        }
      });
  }
  return found;
}

describe("cores do tema", () => {
  it("nenhuma tela usa cor fixa que quebra o modo escuro", () => {
    expect(violations()).toEqual([]);
  });

  it("as exceções de papel ainda existem (senão a lista está velha)", () => {
    const files = new Set(sourceFiles(SRC).map((file) => relative(SRC, file).split("\\").join("/")));
    for (const paper of [...PAPER_FILES, ...VENDOR_FILES]) {
      expect(files.has(paper), paper).toBe(true);
    }
  });
});
