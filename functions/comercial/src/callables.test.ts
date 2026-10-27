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

/**
 * O handler começa por requireComercialCaller com o projeto do ambiente, antes
 * de qualquer outra coisa. O único acesso a mais que cabe é `{ financeiro: true }`
 * (e só onde ACESSO_DO_FINANCEIRO lista).
 */
const ENTRADA_DE_NEGOCIO =
  /^export const \w+ = onCall(?:<[^>]*>)?\((?:\{[^{}]*\},\s*)?async \(request\) => \{\s*(?:const (?:\w+|\{[^{}]*\}) = )?await requireComercialCaller\(db, request, PROJECT_ID(?:, \{ financeiro: true \})?\);/;

/** As callables que o financeiro também chama (pergunta 4 do desenho): só a autorização de faturamento. */
const ACESSO_DO_FINANCEIRO = ["recordAuthorization"];

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

  it("só há callables e o adaptador HTTP autenticado declarado", () => {
    const triggers = new Set([...index.matchAll(/\bon[A-Z]\w*/g)].map((match) => match[0]));
    assert.deepEqual([...triggers].sort(), ["onCall", "onRequest"], "nenhum gatilho extra fora da liberação");
    const http = [...index.matchAll(/^export const (\w+) = onRequest/gm)].map((match) => match[1]);
    assert.deepEqual(http, ["duteComercialApi"]);
    assert.match(index, /httpModuleHandler\(createModuleHandler\(db, PROJECT_ID, \(token\) => getAuth\(\).verifyIdToken\(token, true\), comercialApi\)\)/);
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

  it("o cadastro comercial tem as três callables, cada uma no seu domínio", () => {
    const blocks = callableBlocks();
    for (const [name, handler] of [
      ["saveCommercialCustomer", "saveCommercialCustomerFor"],
      ["saveCustomerLocation", "saveCustomerLocationFor"],
      ["saveCustomerContact", "saveCustomerContactFor"],
    ]) {
      const block = blocks.get(name);
      assert.ok(block, `${name} não declarada`);
      assert.match(block, new RegExp(`return ${handler}\\(db, caller, request\\.data\\);`), name);
    }
  });

  it("demanda e orçamento (parte 9): saveQuote e advanceQuote, cada uma no seu domínio", () => {
    const blocks = callableBlocks();
    for (const [name, handler] of [
      ["saveQuote", "saveQuoteFor"],
      ["advanceQuote", "advanceQuoteFor"],
    ]) {
      const block = blocks.get(name);
      assert.ok(block, `${name} não declarada`);
      assert.match(block, ENTRADA_DE_NEGOCIO, name);
      assert.match(block, new RegExp(`return ${handler}\\(db, caller, request\\.data\\);`), name);
    }
  });

  it("demanda depois do envio (parte 10): advanceDemand, no domínio demandas.ts", () => {
    const blocks = callableBlocks();
    const block = blocks.get("advanceDemand");
    assert.ok(block, "advanceDemand não declarada");
    assert.match(block, ENTRADA_DE_NEGOCIO, "advanceDemand");
    assert.match(block, /return advanceDemandFor\(db, caller, request\.data\);/);
    assert.match(index, /import \{ advanceDemandFor \} from "\.\/domain\/demandas\.js";/);
  });

  it("medição mensal (parte 16a): saveMedicao e advanceMedicao, no domínio medicoes.ts", () => {
    const blocks = callableBlocks();
    for (const [name, handler] of [
      ["saveMedicao", "saveMedicaoFor"],
      ["advanceMedicao", "advanceMedicaoFor"],
    ]) {
      const block = blocks.get(name);
      assert.ok(block, `${name} não declarada`);
      assert.match(block, ENTRADA_DE_NEGOCIO, name);
      assert.match(block, new RegExp(`return ${handler}\\(db, caller, request\\.data\\);`), name);
    }
    assert.match(index, /import \{ advanceMedicaoFor, saveMedicaoFor \} from "\.\/domain\/medicoes\.js";/);
  });

  it("autorização de faturamento (parte 15): recordAuthorization, no domínio autorizacoes.ts, abre ao financeiro", () => {
    const blocks = callableBlocks();
    const block = blocks.get("recordAuthorization");
    assert.ok(block, "recordAuthorization não declarada");
    assert.match(block, ENTRADA_DE_NEGOCIO, "recordAuthorization");
    assert.match(block, /await requireComercialCaller\(db, request, PROJECT_ID, \{ financeiro: true \}\);/);
    assert.match(block, /return recordAuthorizationFor\(db, caller, request\.data\);/);
    assert.match(index, /import \{ recordAuthorizationFor \} from "\.\/domain\/autorizacoes\.js";/);
  });

  it("só as callables da lista abrem ao financeiro; nenhuma outra passa acesso a mais", () => {
    const blocks = callableBlocks();
    const abertas = [...blocks].filter(([, block]) => /requireComercialCaller\(db, request, PROJECT_ID,/.test(block)).map(([name]) => name);
    assert.deepEqual(abertas, ACESSO_DO_FINANCEIRO);
    for (const [name, block] of blocks) {
      if (name === "comercialStatus" || ACESSO_DO_FINANCEIRO.includes(name)) continue;
      assert.match(block, /await requireComercialCaller\(db, request, PROJECT_ID\);/, name);
    }
    // A trava reprova outro acesso a mais (outro papel, variável, objeto montado à parte).
    for (const recusado of [
      "export const saveQuote = onCall(async (request) => {\n  const caller = await requireComercialCaller(db, request, PROJECT_ID, { financeiro: true, rh: true });",
      "export const saveQuote = onCall(async (request) => {\n  const caller = await requireComercialCaller(db, request, PROJECT_ID, ACESSO);",
      "export const saveQuote = onCall(async (request) => {\n  const caller = await requireComercialCaller(db, request, PROJECT_ID, { suporte: true });",
    ]) {
      assert.doesNotMatch(recusado, ENTRADA_DE_NEGOCIO, recusado);
    }
  });

  it("contratos (parte 8): saveContract e recordAditivo declaradas como callables de negócio", () => {
    const blocks = callableBlocks();
    for (const name of ["saveContract", "recordAditivo"]) {
      assert.ok(blocks.has(name), `${name} não declarada em index.ts`);
      assert.match(blocks.get(name) ?? "", ENTRADA_DE_NEGOCIO, name);
    }
  });

  it("a tabela do contrato grava pelo domínio e começa pela autorização comercial", () => {
    const block = callableBlocks().get("saveContractPriceTable");
    assert.ok(block, "saveContractPriceTable não declarada");
    assert.match(block, ENTRADA_DE_NEGOCIO);
    assert.match(block, /return saveContractPriceTableFor\(db, caller, request\.data\);/);
  });

  it("a região é a do app", () => {
    assert.match(index, /setGlobalOptions\(\{[\s\S]*?region: "southamerica-east1"/);
  });
});
