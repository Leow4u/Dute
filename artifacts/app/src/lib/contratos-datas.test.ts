import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MARCOS_DE_AVISO,
  TIPOS_ALERTA,
  alertasDoContrato,
  diasEntre,
  pagamentoPrevisto,
  prazoDeRenovacao,
  problemaDasFaixas,
  type AlertaContrato,
  type ContratoParaAlertas,
  type ContratoParaPagamento,
  type FaixaPagamento,
} from "@workspace/dominio";

/**
 * Datas do contrato do Comercial (lib/dominio/src/contratos-datas.ts): os
 * alertas da tela de contratos e do Início e a previsão de pagamento. Os
 * casos ficam num JSON que functions/comercial também roda, contra a cópia
 * de lá (docs/plataforma/fase-6-comercial.md, parte 14).
 */

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

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const casos = JSON.parse(readFileSync(resolve(root, "lib/dominio/src/contratos-datas.casos.json"), "utf8")) as Casos;

function contratoDoCaso(caso: CasoDeAlerta): ContratoParaAlertas {
  const base = casos.contratos[caso.contrato];
  if (!base) throw new Error(`contrato base "${caso.contrato}" não existe nos casos`);
  return { ...base, ...caso.com };
}

describe("datas do contrato: casos de referência", () => {
  it.each(casos.alertas.map((caso) => [caso.caso, caso] as const))("alertas: %s", (_, caso) => {
    const contrato = contratoDoCaso(caso);
    if (caso.erro) expect(() => alertasDoContrato(contrato, caso.hoje)).toThrow();
    else expect(alertasDoContrato(contrato, caso.hoje)).toEqual(caso.alertas);
  });

  it.each(casos.prazos_de_renovacao.map((caso) => [caso.caso, caso] as const))("prazo de renovação: %s", (_, caso) => {
    expect(prazoDeRenovacao({ renovacao: caso.renovacao }, caso.fim)).toBe(caso.prazo);
  });

  it.each(casos.pagamentos.casos.map((caso) => [caso.caso, caso] as const))("pagamento: %s", (_, caso) => {
    const regra = casos.pagamentos.regras[caso.regra];
    expect(regra, caso.regra).toBeDefined();
    if (caso.erro) expect(() => pagamentoPrevisto({ pagamento: regra }, caso.nf)).toThrow();
    else expect(pagamentoPrevisto({ pagamento: regra }, caso.nf)).toBe(caso.previsto);
  });

  it.each(casos.faixas.map((caso) => [caso.caso, caso] as const))("faixas: %s", (_, caso) => {
    const problema = problemaDasFaixas(caso.faixas);
    if (caso.problema === null) expect(problema).toBeNull();
    else expect(problema).toContain(caso.problema);
  });

  it.each(casos.dias_entre.map((caso) => [caso.caso, caso] as const))("dias entre: %s", (_, caso) => {
    expect(diasEntre(caso.de, caso.ate)).toBe(caso.dias);
  });
});

describe("datas do contrato: o que os casos cobrem", () => {
  it("todo tipo de alerta e todo marco aparecem nos casos", () => {
    const alertas = casos.alertas.flatMap((caso) => caso.alertas ?? []);
    expect(new Set(alertas.map((alerta) => alerta.tipo))).toEqual(new Set(TIPOS_ALERTA));
    expect(new Set(alertas.map((alerta) => alerta.marco))).toEqual(new Set([...MARCOS_DE_AVISO, 0]));
  });

  it("todo tipo de regra de pagamento aparece nos casos", () => {
    const tipos = new Set(Object.values(casos.pagamentos.regras).map((regra) => regra.tipo));
    expect(tipos).toEqual(new Set(["faixas_do_dia_da_nf", "dias_apos_nf", "texto"]));
  });

  it("o caso do Itaú: NF recebida de 1 a 10 paga dia 30; de 11 a 20, dia 10 do mês seguinte", () => {
    const itau = { pagamento: casos.pagamentos.regras.faixas_do_dia };
    expect(pagamentoPrevisto(itau, "2026-10-05")).toBe("2026-10-30");
    expect(pagamentoPrevisto(itau, "2026-10-21")).toBe("2026-11-30");
  });
});
