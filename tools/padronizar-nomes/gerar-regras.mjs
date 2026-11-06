#!/usr/bin/env node
/**
 * Gera regras.mjs a partir de lib/dominio/src/nome-do-produto.ts, só tirando
 * os tipos (TypeScript transpileModule). A ferramenta roda em Node puro, sem
 * TypeScript; o vitest do app (artifacts/app/src/lib/nome-do-produto.test.ts)
 * gera de novo e reprova quando regras.mjs não é o que sai daqui.
 *
 *   node tools/padronizar-nomes/gerar-regras.mjs
 *
 * Exige o `typescript` da raiz (`corepack pnpm install`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const ORIGEM = "lib/dominio/src/nome-do-produto.ts";
export const DESTINO = "tools/padronizar-nomes/regras.mjs";

const CABECALHO = `// Gerado de ${ORIGEM} por tools/padronizar-nomes/gerar-regras.mjs: não edite aqui.\n// O vitest do app reprova quando este arquivo não é o que o gerador produz.\n`;

/** O conteúdo de regras.mjs para o código TypeScript da regra. */
export function gerar(fonte, ts) {
  const saida = ts.transpileModule(fonte, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false, newLine: ts.NewLineKind.LineFeed },
    reportDiagnostics: false,
  });
  return CABECALHO + saida.outputText.replace(/\r\n/g, "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ts = createRequire(path.join(raiz, "package.json"))("typescript");
  const fonte = readFileSync(path.join(raiz, ORIGEM), "utf8");
  writeFileSync(path.join(raiz, DESTINO), gerar(fonte, ts), "utf8");
  console.log(`${DESTINO} gerado de ${ORIGEM}.`);
}
