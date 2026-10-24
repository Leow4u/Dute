import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As callables do Financeiro precisam estar no formato que a conferência do
 * invoker lê (tools/check_functions_invoker.ps1): `export const nome = onCall`
 * com o parêntese na mesma linha. Toda callable começa pela liberação e pelo
 * perfil (requireFinanceiroCaller).
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

const ENTRADA = /^export const \w+ = onCall(?:<[^>]*>)?\(async \(request\) => \{\s*const caller = await requireFinanceiroCaller\(db, request, PROJECT_ID\);/;

describe("callables do Financeiro", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const used = rawIndex.split(/\r?\n/).filter((line) => ON_CALL_USE.test(line));
    assert.deepEqual(used.map((line) => line.match(pattern)?.[1]), ["registerNf", "advanceFatura", "emitNfOmie", "actOnNfEmission", "listNfEmissions", "actOnNfSettlement", "listNfSettlements"]);
  });

  it("as callables começam pela liberação e pelo perfil, e nada é reexportado", () => {
    assert.doesNotMatch(index, /^export\s*\{/m);
    const blocks = index.split(/^(?=export const )/m).filter((block) => /^export const \w+ = onCall/.test(block));
    assert.equal(blocks.length, 7);
    for (const block of blocks) assert.match(block, ENTRADA);
  });
});

describe("a rotina da Omie", () => {
  it("roda uma passada por vez: uma instância, e uma chamada por instância", () => {
    // Com a concorrência padrão da segunda geração (80 com 1 CPU), a mesma instância aceitaria a passada seguinte
    // do Cloud Scheduler enquanto a anterior ainda chama a Omie, e as duas repetiriam a mesma chamada que grava.
    const declaracao = index.match(/^export const runOmieSync = onSchedule\(\{([^}]*)\}/m)?.[1] ?? "";
    assert.match(declaracao, /\bmaxInstances: 1\b/);
    assert.match(declaracao, /\bconcurrency: 1\b/);
  });

  it("recebe as chaves da API do Secret Manager, declaradas só onde a Omie está liberada", () => {
    const declaracao = index.match(/^export const runOmieSync = onSchedule\(\{([^}]*)\}/m)?.[1] ?? "";
    assert.match(declaracao, /\bsecrets: segredosDaOmie\(PROJECT_ID\)/);
  });
});
