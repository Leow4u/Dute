import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASAS_DA_QUANTIDADE,
  CASAS_DO_PRECO,
  ERROS_DO_DINHEIRO,
  ErroDinheiro,
  centavosDaLinha,
  formatarReais,
  lerDecimal,
  somarCentavos,
  totalEmCentavos,
} from "./dinheiro.js";

/**
 * Conta de dinheiro do backend do Comercial: cópia literal de
 * lib/dominio/src/dinheiro.ts (as Functions não importam lib/dominio). Roda
 * os mesmos casos de lib/dominio/src/dinheiro.casos.json que o vitest do app
 * roda contra o original, e a trava confere que a cópia é idêntica.
 */

// Compilado em functions/comercial/lib/domain/dinheiro.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/dinheiro.ts";
const COPIA = "../../src/domain/dinheiro.ts";
const CASOS = "../../../../lib/dominio/src/dinheiro.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/dinheiro\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

interface CasoComErro {
  caso: string;
  erro?: string;
}

interface CasoDeLinha extends CasoComErro {
  quantidade: unknown;
  preco: unknown;
  ajuste?: unknown;
  centavos?: number;
}

interface CasoDeTotal extends CasoComErro {
  linhas: { quantidade: unknown; preco: unknown; ajuste?: unknown }[];
  centavos?: number;
}

interface CasoDeSoma extends CasoComErro {
  centavos: unknown[];
  total?: number;
}

interface CasoDeFormato extends CasoComErro {
  centavos: unknown;
  texto?: string;
}

interface Casos {
  linhas: CasoDeLinha[];
  totais: CasoDeTotal[];
  somas: CasoDeSoma[];
  formatos: CasoDeFormato[];
}

const casos = JSON.parse(read(CASOS)) as Casos;

// Os casos trazem de propósito o que o tipo recusa (number, null): é o que
// pode chegar de uma callable ou de uma planilha.
const linha = centavosDaLinha as (quantidade: unknown, preco: unknown, opcoes?: { ajuste?: unknown }) => number;
const total = totalEmCentavos as (linhas: unknown[]) => number;
const somar = somarCentavos as (centavos: unknown[]) => number;
const formatar = formatarReais as (centavos: unknown) => string;

function codigoDoErro(conta: () => unknown): string {
  try {
    conta();
  } catch (erro) {
    if (erro instanceof ErroDinheiro) return erro.codigo;
    throw erro;
  }
  throw new Error("a conta deveria ter recusado");
}

function conferir(caso: CasoComErro, esperado: unknown, conta: () => unknown) {
  if (caso.erro) {
    assert.equal(codigoDoErro(conta), caso.erro, caso.caso);
  } else {
    assert.equal(conta(), esperado, caso.caso);
  }
}

describe("dinheiro no backend: a cópia é a de lib/dominio", () => {
  it("functions/comercial/src/domain/dinheiro.ts é idêntico a lib/dominio/src/dinheiro.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/dinheiro.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/dinheiro.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/dinheiro.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// outro comentário\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/dinheiro.ts\n`), original);
  });
});

describe("dinheiro no backend: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.linhas.length >= 40);
    assert.ok(casos.totais.length >= 5);
    assert.ok(casos.somas.length >= 5);
    assert.ok(casos.formatos.length >= 5);
  });

  for (const caso of casos.linhas) {
    it(`linha: ${caso.caso}`, () => {
      conferir(caso, caso.centavos, () => linha(caso.quantidade, caso.preco, { ajuste: caso.ajuste }));
    });
  }

  for (const caso of casos.totais) {
    it(`total: ${caso.caso}`, () => {
      conferir(caso, caso.centavos, () => total(caso.linhas));
    });
  }

  for (const caso of casos.somas) {
    it(`soma: ${caso.caso}`, () => {
      conferir(caso, caso.total, () => somar(caso.centavos));
    });
  }

  for (const caso of casos.formatos) {
    it(`formato: ${caso.caso}`, () => {
      conferir(caso, caso.texto, () => formatar(caso.centavos));
    });
  }

  it("todo código de erro aparece nos casos", () => {
    const usados = new Set(
      [...casos.linhas, ...casos.totais, ...casos.somas, ...casos.formatos].map((caso) => caso.erro).filter(Boolean),
    );
    assert.deepEqual([...usados].sort(), [...ERROS_DO_DINHEIRO].sort());
  });
});

describe("dinheiro no backend: contrato", () => {
  it("o caso do WMS: 3 × 0,335 por linha dá 1,02", () => {
    const linhas = [1, 2, 3].map(() => ({ quantidade: "1", preco: "0.335" }));
    assert.deepEqual(
      linhas.map((item) => centavosDaLinha(item.quantidade, item.preco)),
      [34, 34, 34],
    );
    // Espaço que não quebra depois do R$, como o Intl pt-BR.
    assert.equal(formatarReais(totalEmCentavos(linhas)), "R$ 1,02");
  });

  it("lê o decimal sem passar por float", () => {
    assert.deepEqual(lerDecimal("12.345", CASAS_DO_PRECO), { coeficiente: 12345n, casas: 3 });
    assert.equal(codigoDoErro(() => lerDecimal("1.0001", CASAS_DA_QUANTIDADE)), "CASAS_DEMAIS");
  });
});
