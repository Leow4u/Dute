import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CUSTOMER_CODE_PATTERN, sugerirCodigo } from "./codigo";

/**
 * A sugestão de código do diálogo "Novo prospect" é a mesma do servidor
 * (functions/comercial/src/domain/customer-identity.ts): o app não importa das
 * Functions, então guarda uma cópia literal. Esta trava lê os dois fontes e
 * reprova qualquer diferença, e roda os mesmos casos do teste do backend.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const servidor = read("functions/comercial/src/domain/customer-identity.ts");
const copia = read("artifacts/app/src/lib/comercial/codigo.ts");

/** Declaração de primeiro nível: até a chave que fecha na coluna zero, ou a linha que termina em ";". */
function declaracao(source: string, name: string): string {
  const start = new RegExp(`^(?:export )?(?:function ${name}\\b|const ${name}\\b)`, "m").exec(source);
  if (!start) throw new Error(`${name} não encontrado`);
  const lineEnd = source.indexOf("\n", start.index);
  if (source.slice(start.index, lineEnd).trimEnd().endsWith(";")) return source.slice(start.index, lineEnd);
  const close = source.indexOf("\n}", start.index);
  if (close < 0) throw new Error(`${name} sem fechamento na coluna zero`);
  return source.slice(start.index, close + 2);
}

/** Sem comentários, sem `export` e com os espaços juntados: só o código conta. */
function normalizada(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^export /, "");
}

describe("sugestão de código do cliente: cópia travada do servidor", () => {
  it.each(["text", "CUSTOMER_CODE_PATTERN", "CUSTOMER_CODE_MAX", "SUFIXOS_SOCIETARIOS", "sugerirCodigo"])(
    "%s é igual ao de functions/comercial",
    (name) => {
      expect(normalizada(declaracao(copia, name))).toBe(normalizada(declaracao(servidor, name)));
    },
  );

  // Os mesmos casos de functions/comercial/src/domain/customer-identity.test.ts.
  it("sugerido pelo nome: sem acento, com hífen e sem o sufixo societário", () => {
    for (const [nome, codigo] of [
      ["Itaú Unibanco S.A.", "ITAU-UNIBANCO"],
      ["Banco Safra S/A", "BANCO-SAFRA"],
      ["BTG Pactual", "BTG-PACTUAL"],
      ["Construtora Ômega Ltda.", "CONSTRUTORA-OMEGA"],
      ["Padaria São João ME", "PADARIA-SAO-JOAO"],
      ["  dutelog  ", "DUTELOG"],
      ["SA", "SA"],
    ] as const) {
      expect(sugerirCodigo(nome), nome).toBe(codigo);
    }
  });

  it("corta em palavra inteira até 20 caracteres", () => {
    expect(sugerirCodigo("Companhia Brasileira de Distribuição")).toBe("COMPANHIA-BRASILEIRA");
    expect(sugerirCodigo("Superintendênciageralmentelonga")).toBe("SUPERINTENDENCIAGERA");
    for (const nome of ["Companhia Brasileira de Distribuição", "Superintendênciageralmentelonga", "A B C D E F G H I J K"]) {
      const codigo = sugerirCodigo(nome);
      expect(codigo.length).toBeLessThanOrEqual(20);
      expect(codigo).toMatch(CUSTOMER_CODE_PATTERN);
    }
  });

  it("nome que não rende código válido sugere vazio", () => {
    for (const nome of ["", "   ", "A", "!!!", null, undefined]) {
      expect(sugerirCodigo(nome), String(nome)).toBe("");
    }
  });
});
