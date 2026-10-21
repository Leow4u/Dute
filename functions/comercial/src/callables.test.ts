import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As callables do Comercial precisam estar no formato que a conferência do
 * invoker lê (tools/check_functions_invoker.ps1): `export const nome = onCall(`
 * no começo da linha. Um `export { x } from` passaria sem conferência, como no
 * incidente de 03/09/2026. E toda callable de negócio entra pela liberação e
 * pelo perfil (requireComercialCaller); só o comercialStatus responde fora dela.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// Compilado em functions/comercial/lib/callables.test.js. Sem os comentários,
// que podem citar o formato.
const index = read("../src/index.ts")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const invokerScript = read("../../../tools/check_functions_invoker.ps1");

function invokerPattern(): RegExp {
  const line = invokerScript.split(/\r?\n/).find((item) => item.includes("onCall") && item.includes("-Pattern"));
  assert.ok(line, "padrão das callables não encontrado em tools/check_functions_invoker.ps1");
  const pattern = line.match(/-Pattern\s+'([^']+)'/);
  assert.ok(pattern, `padrão ilegível: ${line}`);
  return new RegExp(pattern[1], "gm");
}

function callableBlocks(): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const block of index.split(/^(?=export const )/m)) {
    const name = block.match(/^export const (\w+) = onCall\(/);
    if (name) blocks.set(name[1], block);
  }
  return blocks;
}

describe("callables do Comercial", () => {
  it("toda onCall está no formato que a conferência do invoker lê", () => {
    const listed = [...index.matchAll(invokerPattern())].map((match) => match[1]);
    const calls = index.match(/onCall\(/g) ?? [];
    assert.ok(listed.length > 0, "nenhuma callable encontrada");
    assert.equal(listed.length, calls.length, "há onCall fora do formato `export const nome = onCall(`");
    assert.ok(listed.includes("comercialStatus"));
    assert.doesNotMatch(index, /^export\s*\{/m, "reexportação passa sem conferência do invoker");
  });

  it("toda callable de negócio passa pela liberação e pelo perfil", () => {
    for (const [name, block] of callableBlocks()) {
      if (name === "comercialStatus") continue;
      assert.match(block, /requireComercialCaller\(/, `${name} não chama requireComercialCaller`);
    }
  });

  it("a região é a do app", () => {
    assert.match(index, /setGlobalOptions\(\{[\s\S]*?region: "southamerica-east1"/);
  });
});
