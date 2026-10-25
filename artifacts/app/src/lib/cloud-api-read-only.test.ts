import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * O roteador do navegador (cloud-api.ts) só lê. Toda gravação passa pelas
 * Cloud Functions (functions-api.ts): nenhuma escrita crítica depende do
 * frontend (invariante 1), e as regras do Firestore negam a gravação direta
 * nas coleções operacionais. Uma rota nova sem Function cai no "Rota
 * Firebase não implementada", em vez de tentar gravar pelo navegador.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("./cloud-api.ts", import.meta.url)), "utf8");

describe("o roteador do navegador só lê", () => {
  it("cloud-api.ts não grava no Firestore", () => {
    const escritas = SOURCE.split("\n")
      .map((line, index) => ({ line: line.trim(), numero: index + 1 }))
      .filter(({ line }) => /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/.test(line))
      .map(({ line, numero }) => `${numero}: ${line}`);
    expect(escritas).toEqual([]);
  });
});
