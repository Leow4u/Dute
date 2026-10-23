import { describe, expect, it } from "vitest";

import { pendenciasDoComercial } from "./comercial/pendencias";
import { menuDoComercial, menuDoOperacao } from "./modules";
import { pendenciasDaOperacao, type EntradaDoInicio } from "./operacao/pendencias";
import { contadoresDoMenu, resumoDoModulo } from "./resumo-do-modulo";

const COMERCIAL = pendenciasDoComercial({
  role: "owner",
  paraAprovar: [{ numero: "10045", cliente: "Itaú Unibanco" }],
  devolvidos: [{ numero: "10046", rotulo: "10046 – RV01", nota: null, em: "2026-10-22T18:10:00.000Z" }],
  autorizacoes: {
    esperandoMaisDe30: [{ numero: "10029", rotulo: "10029 – RV02", cliente: "Itaú Unibanco", dias: 70 }],
    prazos: [{ numero: "10041", rotulo: "10041 – RV02", cliente: "BTG Pactual", limite: "2026-09-29", restantes: -22, vencido: true, critico: true }],
  },
  semResposta: [{ numero: "10052", cliente: "Clínica Vida Plena", enviadaEm: "2026-10-17", dias: 6 }],
  comercialLiberado: true,
});

const HOJE = "2026-10-23";
const OPERACAO_ENTRADA: EntradaDoInicio = {
  hoje: HOJE,
  ordens: [
    { numero: "10050-01", demanda: "10050", customer_code: "T", status: "aberta", edicao: 1, itens: [], agenda: null, demandaFora: null },
  ],
  demandas: [{ numero: "10043", customer_code: "S", titulo: null, os_numeros: [] }],
  pessoas: [
    {
      id: "col_m",
      edicao: 1,
      ativo: true,
      nome: "Marcos Andrade",
      funcao: "Motorista",
      cpf: "",
      telefone: "",
      cnhCategoria: "D",
      cnhValidade: "2026-10-20",
      cnh: null,
    },
  ],
  veiculos: [],
  nomesClientes: {},
};

describe("resumo do módulo para o card da entrada", () => {
  it("o total é o número de linhas do Início, a primeira é a mais urgente e o alerta vem do crítico", () => {
    expect(resumoDoModulo(COMERCIAL)).toEqual({
      total: COMERCIAL.length,
      alerta: true,
      primeira: "Prazo de faturamento vencido em 29/09/2026 · BTG Pactual",
    });
    expect(resumoDoModulo([])).toEqual({ total: 0, alerta: false, primeira: null });
    expect(resumoDoModulo([{ tone: "attention", title: "1 OS para agendar", href: "/operacao/hoje" }]).alerta).toBe(false);
  });
});

describe("contadores do menu do módulo", () => {
  it("Comercial: o Início conta todas as linhas; cada tela, as linhas que levam a ela", () => {
    const contadores = contadoresDoMenu(COMERCIAL, menuDoComercial("owner", true), "comercial-inicio");
    expect(contadores).toEqual({
      "comercial-inicio": { n: 5, alerta: true },
      // Aprovar, o devolvido e a proposta sem resposta abrem telas do orçamento.
      "comercial-orcamentos": { n: 3, alerta: false },
      "comercial-autorizacoes": { n: 2, alerta: true },
    });
    expect(contadores["comercial-inicio"].n).toBe(COMERCIAL.length);
  });

  it("Operação: a fila e o cadastro de colaboradores", () => {
    const itens = pendenciasDaOperacao(OPERACAO_ENTRADA);
    expect(contadoresDoMenu(itens, menuDoOperacao("interno", true), "operacao-inicio")).toEqual({
      "operacao-inicio": { n: 3, alerta: true },
      "operacao-hoje": { n: 2, alerta: false },
      "operacao-colaboradores": { n: 1, alerta: true },
    });
  });

  it("sem linha, sem contador", () => {
    expect(contadoresDoMenu([], menuDoComercial("owner", true), "comercial-inicio")).toEqual({});
  });
});
