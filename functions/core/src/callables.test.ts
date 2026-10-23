import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As functions do núcleo (codebase `core`). A callable fica no formato que a
 * conferência do invoker lê (tools/check_functions_invoker.ps1), numa linha
 * só, e começa pela liberação e pelo perfil (requireCoreCaller). A rotina
 * confere a liberação antes de tudo.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rawIndex = read("../src/index.ts");
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const invokerScript = read("../../../tools/check_functions_invoker.ps1");

function invokerPattern(): RegExp {
  const literals = [...invokerScript.matchAll(/'(\^export const [^']*onCall[^']*)'/g)].map((match) => match[1]);
  assert.equal(literals.length, 1, `esperava um padrão de callable em tools/check_functions_invoker.ps1, achei ${literals.length}`);
  return new RegExp(literals[0]);
}

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireCoreCaller\(db, request, PROJECT_ID\);/;

describe("functions do núcleo", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).filter((line) => /\bonCall\s*[<(]/.test(line));
    assert.deepEqual(used.map((line) => line.match(pattern)?.[1]), ["suggestDuration", "answerSuggestion"]);
  });

  it("as callables começam pela liberação e pelo perfil, e nada é reexportado", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 2);
    for (const block of blocks) assert.match(block, ENTRADA);
  });

  it("a rotina das medidas (parte 5.1a), a cada 15 minutos, uma instância, confere a liberação antes de tudo", () => {
    const agendadas = [...index.matchAll(/^export const (\w+) = onSchedule\(/gm)].map((match) => match[1]);
    assert.deepEqual(agendadas, ["runMeasures"]);
    assert.match(
      index,
      /export const runMeasures = onSchedule\(\{[^}]*schedule: "every 15 minutes"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\}, async \(\) => \{\s*if \(!memoriaLiberada\(PROJECT_ID\)\) return;/,
    );
  });
});
