import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Trava do multicliente (PR 1b): o código não volta a gravar a BTG fixa.
 *
 * Tela interna grava para o cliente ativo (useActiveCustomer); registro sem
 * customer_code é lido como da BTG por recordCustomerCode/customerRows; e
 * todo fallback legado usa LEGACY_CUSTOMER_CODE, para ficar visível na busca.
 * O nome literal só existe no pacote da BTG, de onde a constante vem.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

// O pacote da BTG lista o código operacional dela; LEGACY_CUSTOMER_CODE
// (lib/operations) vem dali.
const ALLOWED = new Set(["lib/operations/packs/btg.ts"]);

const LITERAL = /(["'`])BTG Pactual\1/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("cliente fixo no código", () => {
  it('"BTG Pactual" só aparece no pacote da BTG', () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (LITERAL.test(line)) found.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });
});
