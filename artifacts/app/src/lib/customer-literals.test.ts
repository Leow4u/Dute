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

/**
 * O portal atende qualquer cliente: tela, componente e texto que o cliente lê
 * não falam da BTG (o texto que grava também não). Comentário pode citar.
 */
const DO_CLIENTE = ["pages/client", "components/portal", "lib/portal", "lib/access.ts"];

function semComentario(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\/.*$/, "");
}

describe("o portal não fala da BTG", () => {
  it('nenhum texto do portal nem a descrição do papel cliente dizem "BTG"', () => {
    const found: string[] = [];
    for (const raiz of DO_CLIENTE) {
      const caminho = join(SRC, raiz);
      const arquivos = statSync(caminho).isDirectory() ? sourceFiles(caminho) : [caminho];
      for (const file of arquivos) {
        const rel = relative(SRC, file).split("\\").join("/");
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (/BTG/.test(semComentario(line))) found.push(`${rel}:${index + 1}: ${line.trim()}`);
          });
      }
    }
    expect(found).toEqual([]);
  });
});
