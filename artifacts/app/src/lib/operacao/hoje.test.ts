import { describe, expect, it } from "vitest";

import type { OsDaFila } from "./fila";
import {
  SEM_FILTRO,
  demandaDoHoje,
  equipeCurta,
  iniciais,
  linhasComSaldo,
  opcoesDosFiltros,
  prazoDaDemanda,
  quadroDoHoje,
  resumoDoHoje,
  type DemandaDoHoje,
  type EntradaDoQuadro,
} from "./hoje";

/** O Hoje da Operação (parte 3.5a, docs/mockups/ModOpHoje.dc.html). */

const HOJE = "2026-10-23";
// Sexta, 23/10/2026, 14:20 em São Paulo.
const AGORA = new Date("2026-10-23T17:20:00.000Z");

function demanda(numero: string, extra: Partial<DemandaDoHoje> = {}): DemandaDoHoje {
  return {
    numero,
    customerCode: "ITAU",
    titulo: "Mudança do 5º andar",
    tipo: "planejada",
    entrada: "comercial",
    etapa: "para_planejar",
    executarAte: null,
    osNumeros: [],
    escopo: [{ id: "ln_1", item: "Cadeira", quantidade: "160" }],
    fora: null,
    ...extra,
  };
}

function os(numero: string, extra: Partial<OsDaFila> = {}): OsDaFila {
  return {
    numero,
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    status: "aberta",
    edicao: 1,
    itens: [{ id: "ln_1", item: "Cadeira", quantidade: "60" }],
    agenda: null,
    pessoas: [],
    placas: [],
    servicos: ["transporte"],
    rota: "Faria Lima → Torre B",
    ...extra,
  };
}

function entrada(extra: Partial<EntradaDoQuadro> = {}): EntradaDoQuadro {
  return {
    hoje: HOJE,
    agora: AGORA,
    demandas: [],
    ordens: [],
    nomesClientes: { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" },
    nomesPessoas: { col_ana: "Ana Lima" },
    placas: { vei_van: "ABC1D23" },
    filtros: SEM_FILTRO,
    busca: "",
    ...extra,
  };
}

const agendada = (numero: string, data: string, hora: string | null, extra: Partial<OsDaFila> = {}) =>
  os(numero, {
    status: "agendada",
    agenda: { data, hora, fim: null, equipe: ["col_ana"], veiculos: ["vei_van"] },
    pessoas: [{ id: "col_ana", nome: "Ana Lima", papel: "lider" }],
    placas: ["ABC-1D23"],
    ...extra,
  });

describe("leitura da demanda", () => {
  it("lê tipo, entrada e o escopo fechado; na direta, os itens pedidos", () => {
    const comercial = demandaDoHoje("10045", {
      customer_code: "ITAU",
      etapa: "para_planejar",
      tipo: "planejada",
      entrada: "comercial",
      escopo: [{ linha_id: "ln_1", lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "160", preco: "10.00" }],
    });
    // O item da tabela vai junto: é por ele que a memória sugere a duração (parte 5.2b).
    expect(comercial?.escopo).toEqual([{ id: "ln_1", item: "Cadeira", quantidade: "160", unidade: null, lpuItemId: "lpu_cadeira" }]);
    expect(JSON.stringify(comercial)).not.toContain("10.00");
    const direta = demandaDoHoje("10053", {
      customer_code: "ITAU",
      etapa: "para_planejar",
      tipo: "paraquedas",
      entrada: "direta",
      executar_ate: "2026-10-23T22:00:00.000Z",
      itens_pedidos: [{ id: "ln_x", item: "Cadeira", quantidade: "6" }],
    });
    expect(direta).toMatchObject({ tipo: "paraquedas", entrada: "direta", executarAte: "2026-10-23T22:00:00.000Z", escopo: [{ id: "ln_x", item: "Cadeira", quantidade: "6", unidade: null }] });
    expect(demandaDoHoje("1", { etapa: "para_planejar", tipo: "urgente" })).toBeNull();
    expect(demandaDoHoje("2", { customer_code: "ITAU", tipo: "urgente", entrada: "outra" })).toMatchObject({ tipo: "planejada", entrada: "comercial" });
  });

  it("conta as linhas com saldo como a callable: a cancelada devolve a fatia", () => {
    const d = demanda("10045", { escopo: [{ id: "ln_1", item: "Cadeira", quantidade: "160" }, { id: "ln_2", item: "Mesa", quantidade: "12.5" }] });
    expect(linhasComSaldo(d, [])).toBe(2);
    const ordens = [
      os("10045-01", { itens: [{ id: "ln_1", item: "Cadeira", quantidade: "160" }] }),
      os("10045-02", { itens: [{ id: "ln_2", item: "Mesa", quantidade: "12.5" }], status: "cancelada" }),
      os("10046-01", { demanda: "10046", itens: [{ id: "ln_2", item: "Mesa", quantidade: "12.5" }] }),
    ];
    expect(linhasComSaldo(d, ordens)).toBe(1);
    expect(linhasComSaldo(d, [...ordens, os("10045-03", { itens: [{ id: "ln_2", item: "Mesa", quantidade: "12.5" }] })])).toBe(0);
  });
});

describe("prazo", () => {
  it("hoje com o que falta; outro dia com o dia da semana; vencido, atrasada", () => {
    expect(prazoDaDemanda("2026-10-23T22:00:00.000Z", AGORA)).toEqual({ texto: "Hoje até 19:00", falta: "faltam 4h40", atrasada: false });
    expect(prazoDaDemanda("2026-10-28T21:00:00.000Z", AGORA)).toEqual({ texto: "Qua 28/10 até 18:00", falta: null, atrasada: false });
    expect(prazoDaDemanda("2026-10-23T16:48:00.000Z", AGORA)).toEqual({ texto: "Hoje até 13:48", falta: "atrasada 32 min", atrasada: true });
    expect(prazoDaDemanda(null, AGORA)).toBeNull();
  });
});

describe("quadro do Hoje", () => {
  it("põe cada coisa na sua coluna: planejar, agendar, hoje, próximos dias, execução e revisão", () => {
    const quadro = quadroDoHoje(
      entrada({
        demandas: [demanda("10043"), demanda("10045", { osNumeros: ["10045-01"] }), demanda("10044", { etapa: "aguardando_cliente" })],
        ordens: [
          os("10045-01"),
          agendada("10049-01", HOJE, "15:00"),
          agendada("10050-01", HOJE, "08:30"),
          agendada("10051-01", "2026-10-26", "09:00"),
          agendada("10040-01", "2026-10-20", "09:00"),
          os("10038-02", { status: "em_execucao", agenda: { data: HOJE, hora: "07:30", fim: null, equipe: [], veiculos: [] } }),
          os("10037-01", { status: "em_revisao" }),
        ],
      }),
    );
    expect(quadro.paraPlanejar.map((cartao) => cartao.demanda.numero)).toEqual(["10043", "10045"]);
    expect(quadro.paraPlanejar.find((cartao) => cartao.demanda.numero === "10045")?.linhasComSaldo).toBe(1);
    expect(quadro.paraAgendar.map((cartao) => cartao.os.numero)).toEqual(["10045-01"]);
    expect(quadro.agendadasHoje.map((cartao) => cartao.os.numero)).toEqual(["10050-01", "10049-01"]);
    expect(quadro.proximosDias.map((cartao) => cartao.os.numero)).toEqual(["10051-01"]);
    expect(quadro.emExecucao.map((cartao) => cartao.os.numero)).toEqual(["10038-02"]);
    expect(quadro.emRevisao.map((cartao) => cartao.os.numero)).toEqual(["10037-01"]);
  });

  it("a demanda sem saldo, perdida ou cancelada sai de Para planejar", () => {
    const quadro = quadroDoHoje(
      entrada({
        demandas: [demanda("10045", { osNumeros: ["10045-01"] }), demanda("10046", { fora: "perdida" })],
        ordens: [os("10045-01", { itens: [{ id: "ln_1", item: "Cadeira", quantidade: "160" }] })],
      }),
    );
    expect(quadro.paraPlanejar).toEqual([]);
  });

  it("o mais urgente primeiro em Para agendar: paraquedas, emergencial e planejada", () => {
    const quadro = quadroDoHoje(
      entrada({
        demandas: [
          demanda("10051", { tipo: "emergencial", entrada: "direta", etapa: "execucao_a_orcar", executarAte: "2026-10-28T21:00:00.000Z" }),
          demanda("10053", { tipo: "paraquedas", entrada: "direta", etapa: "execucao_a_orcar", executarAte: "2026-10-23T22:00:00.000Z" }),
          demanda("10045", { etapa: "execucao_a_orcar" }),
        ],
        ordens: [os("10045-01"), os("10051-01"), os("10053-01")],
      }),
    );
    expect(quadro.paraAgendar.map((cartao) => cartao.os.numero)).toEqual(["10053-01", "10051-01", "10045-01"]);
    expect(quadro.paraAgendar[0].prazo).toEqual({ texto: "Hoje até 19:00", falta: "faltam 4h40", atrasada: false });
    expect(quadro.paraAgendar[2].prazo).toBeNull();
  });

  it("filtra por tipo, entrada, cliente e pessoa, e busca por OS, demanda, cliente e título", () => {
    const base = entrada({
      demandas: [
        demanda("10053", { tipo: "paraquedas", entrada: "direta", titulo: "Troca de cadeiras" }),
        demanda("10052", { tipo: "planejada", entrada: "comercial", customerCode: "SAFRA", titulo: "Mudança da agência" }),
      ],
      ordens: [os("10053-01"), agendada("10052-01", HOJE, "10:00", { customer_code: "SAFRA" })],
    });
    const com = (extra: Partial<EntradaDoQuadro>) => {
      const quadro = quadroDoHoje({ ...base, ...extra });
      return [...quadro.paraPlanejar.map((cartao) => cartao.demanda.numero), ...quadro.paraAgendar.map((cartao) => cartao.os.numero), ...quadro.agendadasHoje.map((cartao) => cartao.os.numero)];
    };
    expect(com({})).toEqual(["10053", "10052", "10053-01", "10052-01"]);
    expect(com({ filtros: { ...SEM_FILTRO, tipo: "paraquedas" } })).toEqual(["10053", "10053-01"]);
    expect(com({ filtros: { ...SEM_FILTRO, entrada: "comercial" } })).toEqual(["10052", "10052-01"]);
    expect(com({ filtros: { ...SEM_FILTRO, cliente: "SAFRA" } })).toEqual(["10052", "10052-01"]);
    expect(com({ filtros: { ...SEM_FILTRO, pessoa: "col_ana" } })).toEqual(["10052-01"]);
    expect(com({ busca: "safra" })).toEqual(["10052", "10052-01"]);
    expect(com({ busca: "10053-01" })).toEqual(["10053-01"]);
    expect(com({ busca: "cadeiras" })).toEqual(["10053", "10053-01"]);
    expect(com({ busca: "mudanca da agencia" })).toEqual(["10052", "10052-01"]);
  });

  it("as opções dos filtros são os clientes e as pessoas do quadro, em ordem", () => {
    const opcoes = opcoesDosFiltros({
      demandas: [demanda("10053", { customerCode: "SAFRA" })],
      ordens: [agendada("10052-01", HOJE, "10:00"), os("10040-01", { agenda: { data: HOJE, hora: null, fim: null, equipe: ["col_ana"], veiculos: [] }, pessoas: [] })],
      nomesClientes: { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" },
      nomesPessoas: { col_ana: "Ana Lima" },
    });
    expect(opcoes.clientes).toEqual([
      { valor: "SAFRA", rotulo: "Banco Safra" },
      { valor: "ITAU", rotulo: "Itaú Unibanco" },
    ]);
    expect(opcoes.pessoas).toEqual([{ valor: "col_ana", rotulo: "Ana Lima" }]);
  });

  it("o resumo diz o dia, quantas OS e quantas demandas para planejar", () => {
    const quadro = quadroDoHoje(entrada({ demandas: [demanda("10043")], ordens: [os("10045-01"), agendada("10049-01", HOJE, "15:00")] }));
    expect(resumoDoHoje(AGORA, quadro)).toBe("Sexta, 23 de outubro · 2 OS · 1 demanda para planejar");
    expect(resumoDoHoje(AGORA, quadroDoHoje(entrada()))).toBe("Sexta, 23 de outubro · 0 OS");
  });

  it("equipe curta e iniciais", () => {
    expect(equipeCurta(["Ana Lima", "Bruno", "Carlos"])).toBe("Ana Lima +2");
    expect(equipeCurta([])).toBeNull();
    expect(iniciais("Carlos da Silva")).toBe("CS");
    expect(iniciais("ana")).toBe("A");
  });
});
