import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * O roteador do navegador (cloud-api.ts) só lê. Toda gravação passa pelas
 * Cloud Functions (functions-api.ts): nenhuma escrita crítica depende do
 * frontend (invariante 1), e as regras do Firestore negam a gravação direta
 * nas coleções operacionais. Uma rota nova sem Function cai no "Rota
 * Firebase não implementada", em vez de tentar gravar pelo navegador. A
 * conta da cobrança também é só do servidor: a cópia que o navegador
 * mantinha divergia da emissão.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("./cloud-api.ts", import.meta.url)), "utf8");

function linhasCom(padrao: RegExp) {
  return SOURCE.split("\n")
    .map((line, index) => ({ line: line.trim(), numero: index + 1 }))
    .filter(({ line }) => padrao.test(line))
    .map(({ line, numero }) => `${numero}: ${line}`);
}

describe("o roteador do navegador só lê", () => {
  it("cloud-api.ts não grava no Firestore", () => {
    expect(linhasCom(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/)).toEqual([]);
  });

  it("cloud-api.ts não calcula a cobrança: a prévia e a emissão são das Functions", () => {
    // O uso congelado, as quantidades manuais e as fontes automáticas da LPU
    // são da conta do servidor (loadBillingCalculation, em functions/wms).
    expect(
      linhasCom(/billing_operational_snapshots|billing_manual|mov_entrada_pecas|mov_saida_pecas|mov_count/),
    ).toEqual([]);
  });
});
