import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As functions do núcleo (codebase `core`). Callable, quando houver, no
 * formato que a conferência do invoker lê (tools/check_functions_invoker.ps1),
 * numa linha só. Toda function confere a liberação da memória antes de tudo.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rawIndex = read("../src/index.ts");
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("functions do núcleo", () => {
  it("ainda sem callable: nenhuma linha usa onCall, nem em comentário", () => {
    assert.deepEqual(rawIndex.split(/\r?\n/).filter((line) => /\bonCall\s*[<(]/.test(line)), []);
    assert.doesNotMatch(index, /^export\s*\{/m);
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
