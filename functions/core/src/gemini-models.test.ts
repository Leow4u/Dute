import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * O Agent Dute do núcleo (parte 5.5e) chama o Gemini pelo Vertex AI. Modelo
 * aposentado pelo Google falha na chamada; a lista é a do teste do WMS
 * (functions/wms/src/gemini-models.test.ts), lida de lá para as duas não
 * divergirem.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(here, "../src");
const wmsTest = readFileSync(resolve(here, "../../wms/src/gemini-models.test.ts"), "utf8");

function retiredModels(): Set<string> {
  const block = wmsTest.match(/RETIRED_MODELS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "lista dos modelos aposentados no teste do WMS");
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("modelos do Vertex AI no núcleo", () => {
  it("o código não chama modelo Gemini aposentado", () => {
    const retired = retiredModels();
    assert.ok(retired.has("gemini-2.5-flash"));
    const found = sourceFiles(sourceDirectory).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/gemini-\d[\w.-]*/g)]
        .map((match) => match[0].replace(/[.-]+$/, ""))
        .filter((model) => retired.has(model))
        .map((model) => `${relative(sourceDirectory, path)}: ${model}`),
    );
    assert.deepEqual(found, []);
  });

  it("os modelos do agente são os do WMS", () => {
    const wmsIndex = readFileSync(resolve(here, "../../wms/src/index.ts"), "utf8");
    const modelo = readFileSync(resolve(sourceDirectory, "domain/agente-modelo.ts"), "utf8");
    const principal = (fonte: string) => fonte.match(/process\.env\.AGENT_DUTE_MODEL \?\? "([^"]+)"/)?.[1];
    assert.equal(principal(modelo), principal(wmsIndex));
    assert.equal(modelo.match(/MODELO_RESERVA = "([^"]+)"/)?.[1], wmsIndex.match(/AGENT_DUTE_FALLBACK_MODEL = "([^"]+)"/)?.[1]);
  });
});
