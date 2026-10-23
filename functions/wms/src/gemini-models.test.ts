import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Modelos que o Google já aposentou no Vertex AI: a chamada falha. O
// gemini-2.5-flash saiu em 20/10/2026 e derrubou, sem aviso, a conferência das
// fotos, o OCR dos anexos, a revisão de documentos e a reserva do Agent Dute.
// Ao aposentar outro modelo usado aqui, acrescente o id e troque no código.
const RETIRED_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);

const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("modelos do Vertex AI", () => {
  it("o código não chama modelo Gemini aposentado", () => {
    const found = sourceFiles(sourceDirectory).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/gemini-\d[\w.-]*/g)]
        .map((match) => match[0].replace(/[.-]+$/, ""))
        .filter((model) => RETIRED_MODELS.has(model))
        .map((model) => `${relative(sourceDirectory, path)}: ${model}`),
    );
    assert.deepEqual(found, []);
  });
});
