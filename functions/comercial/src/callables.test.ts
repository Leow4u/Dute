import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * As callables do Comercial precisam estar no formato que a conferência do
 * invoker lê (tools/check_functions_invoker.ps1): `export const nome = onCall`
 * com o parêntese na mesma linha. Um `export { x } from` passaria sem
 * conferência, como no incidente de 03/09/2026; e o script reprova qualquer
 * linha do index.ts que use onCall fora desse formato, até em comentário. Toda
 * callable de negócio começa pela liberação e pelo perfil
 * (requireComercialCaller); só o comercialStatus responde fora dela.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// Compilado em functions/comercial/lib/callables.test.js.
const rawIndex = read("../src/index.ts");
// Sem os comentários, para as travas de código.
const index = rawIndex.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const invokerScript = read("../../../tools/check_functions_invoker.ps1");

/** Uso de onCall que o script confere linha a linha (o $onCallUsePattern dele). */
const ON_CALL_USE = /\bonCall\s*[<(]/;

/** O padrão das callables do script: o literal entre aspas simples que começa com ^export const. */
function invokerPattern(): RegExp {
  const literals = [...invokerScript.matchAll(/'(\^export const [^']*onCall[^']*)'/g)].map((match) => match[1]);
  assert.equal(literals.length, 1, `esperava um padrão de callable em tools/check_functions_invoker.ps1, achei ${literals.length}`);
  return new RegExp(literals[0]);
}

function callableBlocks(): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const block of index.split(/^(?=export const )/m)) {
    const name = block.match(/^export const (\w+) = onCall\b/);
    if (name) blocks.set(name[1], block);
  }
  return blocks;
}

/** O handler começa por requireComercialCaller com o projeto do ambiente, antes de qualquer outra coisa. */
const ENTRADA_DE_NEGOCIO =
  /^export const \w+ = onCall(?:<[^>]*>)?\((?:\{[^{}]*\},\s*)?async \(request\) => \{\s*(?:const (?:\w+|\{[^{}]*\}) = )?await requireComercialCaller\(db, request, PROJECT_ID\);/;

describe("callables do Comercial", () => {
  it("toda linha com onCall está no formato que a conferência do invoker lê, inclusive comentário", () => {
    const pattern = invokerPattern();
    const lines = rawIndex.split(/\r?\n/);
    const used = lines.map((line, i) => [i + 1, line] as const).filter(([, line]) => ON_CALL_USE.test(line));
    assert.ok(used.length > 0, "nenhuma callable encontrada");
    for (const [number, line] of used) {
      assert.match(line, pattern, `index.ts:${number} usa onCall fora do formato que o script lê: ${line.trim()}`);
    }
    const listed = used.map(([, line]) => line.match(pattern)?.[1]);
    assert.ok(listed.includes("comercialStatus"));
  });

  it("a trava de formato reprova onCall em comentário e em duas linhas", () => {
    const pattern = invokerPattern();
    assert.match("export const approveQuote = onCall(async (request) => {", pattern);
    for (const line of [
      " * Toda callable fica escrita como `export const nome = onCall(` no começo da linha",
      "  onCall(async (request) => {",
    ]) {
      assert.match(line, ON_CALL_USE);
      assert.doesNotMatch(line, pattern);
    }
  });

  it("nada é exportado de outro arquivo", () => {
    assert.doesNotMatch(index, /^export\s*\{/m, "reexportação passa sem conferência do invoker");
    assert.doesNotMatch(index, /^export\s*\*/m, "reexportação passa sem conferência do invoker");
  });

  it("só há callables: nenhum outro gatilho (HTTP, agenda, documento, fila)", () => {
    const triggers = new Set([...index.matchAll(/\bon[A-Z]\w*/g)].map((match) => match[0]));
    assert.deepEqual([...triggers], ["onCall"], "gatilho que não é callable fica fora da liberação e da conferência do invoker");
    assert.doesNotMatch(index, /firebase-functions\/v1|from "firebase-functions"/, "use só firebase-functions/https e /v2");
  });

  it("toda callable de negócio começa por requireComercialCaller(db, request, PROJECT_ID)", () => {
    const blocks = callableBlocks();
    assert.ok(blocks.has("comercialStatus"));
    for (const [name, block] of blocks) {
      if (name === "comercialStatus") continue;
      assert.match(block, ENTRADA_DE_NEGOCIO, `${name} não começa por await requireComercialCaller(db, request, PROJECT_ID)`);
    }
  });

  it("a trava de entrada reprova projeto escrito à mão e chamada fora do começo", () => {
    const aceitos = [
      "export const approveQuote = onCall(async (request) => {\n  const caller = await requireComercialCaller(db, request, PROJECT_ID);",
      "export const sendQuote = onCall({ timeoutSeconds: 60 }, async (request) => {\n  await requireComercialCaller(db, request, PROJECT_ID);",
    ];
    const recusados = [
      "export const approveQuote = onCall(async (request) => {\n  const caller = await requireComercialCaller(db, request, \"dute-homolog\");",
      "export const approveQuote = onCall(async (request) => {\n  const quote = await db.doc(\"quotes/1\").get();\n  await requireComercialCaller(db, request, PROJECT_ID);",
      "export const approveQuote = onCall(async (request) => {\n  return helper(request);\n});\nasync function helper(request) {\n  await requireComercialCaller(db, request, PROJECT_ID);",
    ];
    for (const block of aceitos) assert.match(block, ENTRADA_DE_NEGOCIO, block);
    for (const block of recusados) assert.doesNotMatch(block, ENTRADA_DE_NEGOCIO, block);
  });

  it("contratos (parte 8): saveContract e recordAditivo declaradas como callables de negócio", () => {
    const blocks = callableBlocks();
    for (const name of ["saveContract", "recordAditivo"]) {
      assert.ok(blocks.has(name), `${name} não declarada em index.ts`);
      assert.match(blocks.get(name) ?? "", ENTRADA_DE_NEGOCIO, name);
    }
  });

  it("a região é a do app", () => {
    assert.match(index, /setGlobalOptions\(\{[\s\S]*?region: "southamerica-east1"/);
  });
});
