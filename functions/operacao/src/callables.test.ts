import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As callables da Operação precisam estar no formato que a conferência do
 * invoker lê (tools/check_functions_invoker.ps1): `export const nome = onCall`
 * com o parêntese na mesma linha. Toda callable começa pela liberação e pelo
 * perfil (requireOperacaoCaller).
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rawIndex = read("../src/index.ts");
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const invokerScript = read("../../../tools/check_functions_invoker.ps1");

const ON_CALL_USE = /\bonCall\s*[<(]/;

function invokerPattern(): RegExp {
  const literals = [...invokerScript.matchAll(/'(\^export const [^']*onCall[^']*)'/g)].map((match) => match[1]);
  assert.equal(literals.length, 1, `esperava um padrão de callable em tools/check_functions_invoker.ps1, achei ${literals.length}`);
  return new RegExp(literals[0]);
}

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireOperacaoCaller\(db, request, PROJECT_ID\);/;

describe("callables da Operação", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).map((line, i) => [i + 1, line] as const).filter(([, line]) => ON_CALL_USE.test(line));
    assert.deepEqual(used.map(([, line]) => line.match(pattern)?.[1]), ["saveCollaborator", "saveVehicle", "saveServiceOrder", "openDirectDemand", "registerStep", "registerOccurrence"]);
  });

  it("as callables começam pela liberação e pelo perfil, e nada é reexportado", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 6);
    for (const block of blocks) assert.match(block, ENTRADA);
  });
});
