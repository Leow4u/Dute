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
  // Forma do sistema (auditoria de 09/10/2026): a escala de raio, as
  // superfícies sólidas, as duas sombras e a escala de texto moram em
  // index.css e em components/ui. Valor arbitrário na tela foi o que deixou o
  // app com 22 raios, 20 opacidades de vidro e texto de 10,5px.
  { name: "raio arbitrário", pattern: /\brounded(?:-[a-z]{1,2})?-\[(?!inherit\])[^\]]+\]/g },
  { name: "vidro fosco", pattern: /\bbackdrop-blur(?:-[^\s"'`]+)?/g },
  { name: "superfície translúcida", pattern: /\bbg-(?:card|popover|sidebar)\/\d+\b/g },
  { name: "sombra arbitrária", pattern: /\bshadow-\[[^\]]+\]/g },
  { name: "tamanho de texto arbitrário", pattern: /\btext-\[[0-9.]+(?:px|rem)\]/g },
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

/** Conteúdo de um bloco `@layer nome { ... }` do CSS, por contagem de chaves. */
function layerBlock(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  return css.slice(start);
}

/**
 * As classes próprias do app (@layer base e utilities em index.css) também
 * não podem ter superfície clara fixa: em 03/10/2026 o fundo .app-atmosphere
 * (#FAFAF8) e o vidro .glass-surface (branco .72) deixaram o escuro com a área
 * principal clara, e o teste só olhava .ts/.tsx.
 */
const CSS_LIGHT_LITERALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "vidro ou brilho", pattern: /backdrop-filter|radial-gradient/g },
  { name: "branco", pattern: /#fff(?:fff)?\b|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.[1-9]/gi },
  { name: "fundo claro do app", pattern: /#FAFAF8|#ECEEF2|rgba\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/gi },
  {
    name: "sobrescrita de cor do Tailwind",
    pattern: /\.(?:hover\\:)?(?:bg|text|border)-(?:gray|slate|amber|emerald|green|blue|indigo|purple|sky|red|rose)-(?:50|100|200|300|600|700|800|900)\b/g,
  },
];

function cssViolations(): string[] {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const found: string[] = [];
  for (const layer of ["base", "utilities"]) {
    const block = layerBlock(css, layer);
    for (const rule of CSS_LIGHT_LITERALS) {
      for (const match of block.matchAll(rule.pattern)) {
        found.push(`index.css @layer ${layer} ${rule.name}: ${match[0]}`);
      }
    }
  }
  return found;
}

describe("cores e forma do tema", () => {
  it("classes próprias do index.css leem token, sem superfície clara fixa", () => {
    expect(cssViolations()).toEqual([]);
  });

  it("nenhuma tela usa cor fixa que quebra o escuro nem valor fora da escala do sistema", () => {
    expect(violations()).toEqual([]);
  });

  it("as exceções de papel ainda existem (senão a lista está velha)", () => {
    const files = new Set(sourceFiles(SRC).map((file) => relative(SRC, file).split("\\").join("/")));
    for (const paper of [...PAPER_FILES, ...VENDOR_FILES]) {
      expect(files.has(paper), paper).toBe(true);
    }
  });
});
