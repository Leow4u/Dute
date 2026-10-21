import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  alertasDoContrato,
  diasEntre,
  pagamentoPrevisto,
  prazoDeRenovacao,
  problemaDasFaixas,
  type AlertaContrato,
  type ContratoParaAlertas,
  type ContratoParaPagamento,
  type FaixaPagamento,
} from "./contratos-datas.js";

/**
 * Datas do contrato no backend do Comercial: cópia literal de
 * lib/dominio/src/contratos-datas.ts (as Functions não importam lib/dominio).
 * Roda os mesmos casos de lib/dominio/src/contratos-datas.casos.json que o
 * vitest do app roda contra o original, e a trava confere que a cópia é
 * idêntica (o padrão do dinheiro.test.ts).
 */

// Compilado em functions/comercial/lib/domain/contratos-datas.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/contratos-datas.ts";
const COPIA = "../../src/domain/contratos-datas.ts";
const CASOS = "../../../../lib/dominio/src/contratos-datas.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/contratos-datas\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type CasoDeAlerta = {
  caso: string;
  contrato: string;
  com?: Partial<ContratoParaAlertas>;
  hoje: string;
  alertas?: AlertaContrato[];
  erro?: boolean;
};

type Casos = {
  contratos: Record<string, ContratoParaAlertas>;
  alertas: CasoDeAlerta[];
  prazos_de_renovacao: { caso: string; renovacao: ContratoParaAlertas["renovacao"]; fim: string; prazo: string | null }[];
  pagamentos: {
    regras: Record<string, ContratoParaPagamento["pagamento"]>;
    casos: { caso: string; regra: string; nf: string; previsto?: string | null; erro?: boolean }[];
  };
  faixas: { caso: string; faixas: FaixaPagamento[]; problema: string | null }[];
  dias_entre: { caso: string; de: string; ate: string; dias: number }[];
};

const casos = JSON.parse(read(CASOS)) as Casos;

function contratoDoCaso(caso: CasoDeAlerta): ContratoParaAlertas {
  const base = casos.contratos[caso.contrato];
  assert.ok(base, `contrato base "${caso.contrato}" não existe nos casos`);
  return { ...base, ...caso.com };
}

describe("datas do contrato no backend: a cópia é a de lib/dominio", () => {
  it("functions/comercial/src/domain/contratos-datas.ts é idêntico a lib/dominio/src/contratos-datas.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/contratos-datas.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/contratos-datas.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/contratos-datas.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/dinheiro.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/contratos-datas.ts\n`), original);
  });
});

describe("datas do contrato no backend: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.alertas.length >= 20);
    assert.ok(casos.prazos_de_renovacao.length >= 5);
    assert.ok(casos.pagamentos.casos.length >= 15);
    assert.ok(casos.faixas.length >= 5);
  });

  for (const caso of casos.alertas) {
    it(`alertas: ${caso.caso}`, () => {
      const contrato = contratoDoCaso(caso);
      if (caso.erro) assert.throws(() => alertasDoContrato(contrato, caso.hoje));
      else assert.deepEqual(alertasDoContrato(contrato, caso.hoje), caso.alertas);
    });
  }

  for (const caso of casos.prazos_de_renovacao) {
    it(`prazo de renovação: ${caso.caso}`, () => {
      assert.equal(prazoDeRenovacao({ renovacao: caso.renovacao }, caso.fim), caso.prazo);
    });
  }

  for (const caso of casos.pagamentos.casos) {
    it(`pagamento: ${caso.caso}`, () => {
      const regra = casos.pagamentos.regras[caso.regra];
      assert.ok(regra, `regra "${caso.regra}" não existe nos casos`);
      if (caso.erro) assert.throws(() => pagamentoPrevisto({ pagamento: regra }, caso.nf));
      else assert.equal(pagamentoPrevisto({ pagamento: regra }, caso.nf), caso.previsto);
    });
  }

  for (const caso of casos.faixas) {
    it(`faixas: ${caso.caso}`, () => {
      const problema = problemaDasFaixas(caso.faixas);
      if (caso.problema === null) assert.equal(problema, null);
      else assert.ok(problema?.includes(caso.problema), `${problema} deveria conter "${caso.problema}"`);
    });
  }

  for (const caso of casos.dias_entre) {
    it(`dias entre: ${caso.caso}`, () => {
      assert.equal(diasEntre(caso.de, caso.ate), caso.dias);
    });
  }
});
