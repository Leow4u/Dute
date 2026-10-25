import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Trava do multicliente nas Functions do WMS, a mesma do app
 * (artifacts/app/src/lib/customer-literals.test.ts): o código não volta a
 * falar com a BTG fixa. Registro sem customer_code é do cliente legado, pela
 * constante LEGACY_CUSTOMER_CODE (domain/customer-scope.ts), para ficar
 * visível na busca; texto que vai para a tela, para o e-mail ou para a IA
 * serve a todo cliente. Comentário pode citar.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** As constantes do cliente legado: o faturamento guarda a sua (billing-scope.ts). */
const CONSTANTES = new Set(["domain/customer-scope.ts", "domain/billing-scope.ts"]);

/** Código de item do cliente legado, dado dele: não é texto nem fronteira. */
const DADO_DO_CLIENTE_LEGADO = new Set(["domain/operations.ts: const CLIENT_SCOPED_SKUS = new Set([\"BTG-1043\"]);"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

function semComentario(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\/.*$/, "");
}

function linhas(test: (code: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (test(semComentario(line))) found.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe("a BTG fixa nas Functions do WMS", () => {
  it('"BTG Pactual" só nas constantes do cliente legado', () => {
    const found = linhas((code) => /(["'`])BTG Pactual\1/.test(code)).filter(
      (line) => !CONSTANTES.has(line.split(":")[0]),
    );
    assert.deepEqual(found, []);
  });

  it("nenhum texto do código cita a BTG", () => {
    const found = linhas((code) => /BTG/.test(code)).filter((line) => {
      const [file, , ...rest] = line.split(":");
      return !CONSTANTES.has(file) && !DADO_DO_CLIENTE_LEGADO.has(`${file}: ${rest.join(":").trim()}`);
    });
    assert.deepEqual(found, []);
  });
});
