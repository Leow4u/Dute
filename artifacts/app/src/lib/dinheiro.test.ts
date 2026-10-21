import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
} from "@workspace/dominio";

/**
 * Conta de dinheiro do Comercial (lib/dominio/src/dinheiro.ts). Os casos
 * ficam num JSON que functions/comercial também roda, contra a cópia de lá
 * (docs/plataforma/fase-6-comercial.md, Marco 0, parte 2).
 */

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

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const casos = JSON.parse(
  readFileSync(resolve(root, "lib/dominio/src/dinheiro.casos.json"), "utf8"),
) as Casos;

// Os casos trazem de propósito o que o tipo recusa (number, null): é o que
// pode chegar de um formulário ou de uma callable.
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
    expect(codigoDoErro(conta)).toBe(caso.erro);
  } else {
    expect(conta()).toBe(esperado);
  }
}

describe("dinheiro: casos de referência", () => {
  it.each(casos.linhas.map((caso) => [caso.caso, caso] as const))("linha: %s", (_, caso) => {
    conferir(caso, caso.centavos, () => linha(caso.quantidade, caso.preco, { ajuste: caso.ajuste }));
  });

  it.each(casos.totais.map((caso) => [caso.caso, caso] as const))("total: %s", (_, caso) => {
    conferir(caso, caso.centavos, () => total(caso.linhas));
  });

  it.each(casos.somas.map((caso) => [caso.caso, caso] as const))("soma: %s", (_, caso) => {
    conferir(caso, caso.total, () => somar(caso.centavos));
  });

  it.each(casos.formatos.map((caso) => [caso.caso, caso] as const))("formato: %s", (_, caso) => {
    conferir(caso, caso.texto, () => formatar(caso.centavos));
  });

  it("todo código de erro aparece nos casos", () => {
    const usados = new Set(
      [...casos.linhas, ...casos.totais, ...casos.somas, ...casos.formatos].map((caso) => caso.erro),
    );
    for (const codigo of ERROS_DO_DINHEIRO) expect(usados).toContain(codigo);
    for (const codigo of usados) {
      if (codigo) expect(ERROS_DO_DINHEIRO).toContain(codigo);
    }
  });
});

describe("dinheiro: contrato", () => {
  it("todo resultado válido é centavo inteiro seguro", () => {
    for (const caso of casos.linhas) {
      if (caso.erro) continue;
      expect(Number.isSafeInteger(linha(caso.quantidade, caso.preco, { ajuste: caso.ajuste }))).toBe(true);
    }
  });

  it("o caso do WMS: 3 × 0,335 por linha dá 1,02", () => {
    const linhas = [1, 2, 3].map(() => ({ quantidade: "1", preco: "0.335" }));
    expect(linhas.map((item) => centavosDaLinha(item.quantidade, item.preco))).toEqual([34, 34, 34]);
    expect(formatarReais(totalEmCentavos(linhas))).toBe("R$ 1,02");
  });

  it("lê o decimal sem passar por float", () => {
    expect(lerDecimal("12.50", CASAS_DO_PRECO)).toEqual({ coeficiente: 1250n, casas: 2 });
    expect(lerDecimal("-0.3335", CASAS_DO_PRECO)).toEqual({ coeficiente: -3335n, casas: 4 });
    expect(lerDecimal("123456789.123", CASAS_DA_QUANTIDADE)).toEqual({ coeficiente: 123456789123n, casas: 3 });
    expect(codigoDoErro(() => lerDecimal("1.0000", CASAS_DA_QUANTIDADE))).toBe("CASAS_DEMAIS");
  });

  it("o erro é um Error com código e mensagem", () => {
    let pego: unknown;
    try {
      centavosDaLinha("1", "-1.00");
    } catch (erro) {
      pego = erro;
    }
    expect(pego).toBeInstanceOf(Error);
    expect(pego).toBeInstanceOf(ErroDinheiro);
    expect((pego as ErroDinheiro).name).toBe("ErroDinheiro");
    expect((pego as ErroDinheiro).codigo).toBe("NEGATIVO_FORA_DE_AJUSTE");
    expect((pego as ErroDinheiro).message).toMatch(/preço/);
  });

  it("formata igual ao Intl pt-BR das telas de hoje", () => {
    const intl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    for (const centavos of [0, 1, 102, 123456, 123456789, -2500, -5]) {
      expect(formatarReais(centavos)).toBe(intl.format(centavos / 100));
    }
  });
});
