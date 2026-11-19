import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A callable de acesso precisa estar no formato que a conferência do invoker
 * lê (tools/check_functions_invoker.ps1): `export const nome = onCall` com o
 * parêntese na mesma linha. Ela começa pela liberação e pelo perfil.
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

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireZapCaller\(db, request, PROJECT_ID\);/;

describe("callable do Zap", () => {
  it("a linha com onCall está no formato que a conferência do invoker lê", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).filter((line) => ON_CALL_USE.test(line));
    assert.deepEqual(
      used.map((line) => line.match(pattern)?.[1]),
      ["registrarAcessoZap"],
    );
  });

  it("a callable começa pela liberação e pelo perfil", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 1);
    for (const block of blocks) assert.match(block, ENTRADA);
  });
});
