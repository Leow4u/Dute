import { describe, expect, it } from "vitest";

import {
  agendaDaSemana,
  dataValida,
  diasDaSemana,
  inicioDaSemana,
  proximaSemana,
  resumoDoDiaEmPartes,
  semanaAnterior,
  tituloDaSemana,
  type EntradaDaAgenda,
} from "./agenda";
import type { ColaboradorDaLista, VeiculoDaLista } from "./cadastro";
import type { OsDaFila } from "./fila";

/** Agenda da semana (parte 3.6b, docs/mockups/OpAgenda.dc.html). */

const SEGUNDA = "2026-10-19";
const HOJE = "2026-10-20";

function pessoa(id: string, nome: string, vinculo: ColaboradorDaLista["vinculo"], extra: Partial<ColaboradorDaLista> = {}): ColaboradorDaLista {
  return { id, nome, funcao: "Montador", vinculo, empresa: "", papeis: [], noApp: false, ativo: true, ...extra } as ColaboradorDaLista;
}

function veiculo(id: string, placa: string, extra: Partial<VeiculoDaLista> = {}): VeiculoDaLista {
  return { id, placa, tipo: "Baú", resumo: "", dono: "proprio", empresa: "", ativo: true, ...extra } as VeiculoDaLista;
}

function os(numero: string, data: string | null, extra: Partial<OsDaFila> & { equipe?: Array<[string, string, string | null]>; frota?: string[]; hora?: string | null; fim?: string | null } = {}): OsDaFila {
  const { equipe = [], frota = [], hora = "08:00", fim = null, ...resto } = extra;
  return {
    numero,
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    status: "agendada",
    edicao: 1,
    itens: [],
    agenda: data ? { data, hora, fim, equipe: equipe.map(([id]) => id), veiculos: frota } : null,
    pessoas: equipe.map(([id, nome, papel]) => ({ id, nome, papel })),
    placas: [],
    ...resto,
  };
}

const CARLOS = pessoa("col_cs", "Carlos Silva", "proprio", { papeis: ["lider"] });
const ANA = pessoa("col_al", "Ana Lima", "proprio", { papeis: ["lider", "motorista"] });
const DIEGO = pessoa("col_da", "Diego Alves", "freelancer");
const VALTER = pessoa("col_vm", "Valter Moreira", "terceiro", { empresa: "Rota Sul", papeis: ["motorista"] });
const PARADO = pessoa("col_xx", "Xavier Parado", "proprio", { ativo: false });
const DEF = veiculo("vei_def", "DEF-4G56");
const GHI = veiculo("vei_ghi", "GHI-7J89", { tipo: "Truck", dono: "terceiro", empresa: "Rota Sul" });

function entrada(ordens: OsDaFila[], extra: Partial<EntradaDaAgenda> = {}): EntradaDaAgenda {
  return {
    segunda: SEGUNDA,
    hoje: HOJE,
    ordens,
    pessoas: [CARLOS, ANA, DIEGO, VALTER, PARADO],
    veiculos: [DEF, GHI],
    nomesClientes: { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" },
    demandas: { "10045": { titulo: "Mudança do 5º andar", tipo: "planejada" }, "10049": { titulo: "Troca de cadeiras", tipo: "paraquedas" } },
    busca: "",
    ...extra,
  };
}

describe("a semana", () => {
  it("começa na segunda, de qualquer dia dela; domingo é o fim da semana anterior", () => {
    expect(inicioDaSemana("2026-10-19")).toBe("2026-10-19");
    expect(inicioDaSemana("2026-10-23")).toBe("2026-10-19");
    expect(inicioDaSemana("2026-10-25")).toBe("2026-10-19");
    expect(inicioDaSemana("2026-11-01")).toBe("2026-10-26");
    expect(semanaAnterior(SEGUNDA)).toBe("2026-10-12");
    expect(proximaSemana("2026-12-28")).toBe("2027-01-04");
  });

  it("segunda a sábado; o domingo entra só com OS; hoje marcado", () => {
    const dias = diasDaSemana(SEGUNDA, HOJE, false);
    expect(dias.map((dia) => dia.rotulo)).toEqual(["Seg 19", "Ter 20", "Qua 21", "Qui 22", "Sex 23", "Sáb 24"]);
    expect(dias.filter((dia) => dia.hoje).map((dia) => dia.data)).toEqual([HOJE]);
    expect(diasDaSemana(SEGUNDA, HOJE, true).at(-1)).toEqual({ data: "2026-10-25", rotulo: "Dom 25", hoje: false });
  });

  it("o título junta o mês quando a semana não cruza a virada", () => {
    expect(tituloDaSemana(diasDaSemana(SEGUNDA, HOJE, false))).toBe("19 a 24 de outubro");
    expect(tituloDaSemana(diasDaSemana("2026-09-28", HOJE, false))).toBe("28 de setembro a 3 de outubro");
    expect(tituloDaSemana(diasDaSemana("2026-12-28", HOJE, false))).toBe("28 de dezembro de 2026 a 2 de janeiro de 2027");
  });

  it("só data que existe no calendário vale como semana", () => {
    expect(dataValida("2026-10-19")).toBe(true);
    expect(dataValida("2026-02-30")).toBe(false);
    expect(dataValida("19/10/2026")).toBe(false);
  });
});

describe("as linhas", () => {
  const ordens = [
    os("10045-01", HOJE, { hora: "07:30", fim: "18:00", equipe: [["col_cs", "Carlos Silva", "lider"], ["col_da", "Diego Alves", "montador"]], frota: ["vei_def"] }),
    os("10045-02", "2026-10-22", { hora: "19:00", fim: "23:00", equipe: [["col_cs", "Carlos Silva", "lider"]], frota: ["vei_def"] }),
    os("10049-01", HOJE, { customer_code: "SAFRA", status: "em_execucao", hora: "14:00", equipe: [["col_vm", "Valter Moreira", "motorista"]], frota: ["vei_ghi"] }),
  ];

  it("equipe própria, freelancers, terceiros e veículos, cada um com as OS em cada dia", () => {
    const agenda = agendaDaSemana(entrada(ordens));
    expect(agenda.grupos.map((grupo) => [grupo.titulo, grupo.linhas.map((linha) => linha.nome)])).toEqual([
      ["Equipe própria", ["Ana Lima", "Carlos Silva"]],
      ["Freelancers", ["Diego Alves"]],
      ["Terceiros", ["Valter Moreira"]],
      ["Veículos", ["DEF-4G56", "GHI-7J89"]],
    ]);
    const carlos = agenda.grupos[0].linhas[1];
    expect(carlos.detalhe).toBe("Líder");
    expect(Object.fromEntries(Object.entries(carlos.dias).map(([data, lista]) => [data, lista.map((item) => `${item.numero} ${item.cliente} ${item.janela}`)]))).toEqual({
      [HOJE]: ["10045-01 Itaú Unibanco 07:30–18:00"],
      "2026-10-22": ["10045-02 Itaú Unibanco 19:00–23:00"],
    });
    expect(agenda.grupos[2].linhas[0].detalhe).toBe("Motorista · Rota Sul");
    expect(agenda.grupos[3].linhas.map((linha) => linha.detalhe)).toEqual(["Baú", "Truck · Rota Sul"]);
    // O desativado sem OS na semana some; com OS, continua.
    expect(JSON.stringify(agenda.grupos)).not.toContain("Xavier");
    const comParado = agendaDaSemana(entrada([...ordens, os("10045-03", "2026-10-23", { equipe: [["col_xx", "Xavier Parado", null]] })]));
    expect(comParado.grupos[0].linhas.map((linha) => linha.nome)).toContain("Xavier Parado");
  });

  it("a OS leva o que a barra da seleção mostra, sem valor", () => {
    const agenda = agendaDaSemana(entrada(ordens));
    expect(agenda.ordens["10045-01"]).toEqual({
      numero: "10045-01",
      status: "agendada",
      demanda: "10045",
      cliente: "Itaú Unibanco",
      titulo: "Mudança do 5º andar",
      tipo: "planejada",
      janela: "07:30–18:00",
      quando: "Ter 20/10 07:30–18:00",
      equipe: ["Carlos Silva", "Diego Alves"],
      placas: ["DEF-4G56"],
    });
    expect(JSON.stringify(agenda)).not.toMatch(/R\$|preco|valor/);
  });

  it("fora da semana, aberta e cancelada não entram; o domingo aparece quando tem OS", () => {
    const agenda = agendaDaSemana(
      entrada([
        os("10045-01", "2026-10-26", { equipe: [["col_cs", "Carlos Silva", "lider"]] }),
        os("10045-02", HOJE, { status: "cancelada", equipe: [["col_cs", "Carlos Silva", "lider"]] }),
        os("10045-03", null, { status: "aberta" }),
      ]),
    );
    expect(Object.keys(agenda.ordens)).toEqual([]);
    expect(agenda.dias).toHaveLength(6);
    expect(agendaDaSemana(entrada([os("10045-01", "2026-10-25", { equipe: [["col_cs", "Carlos Silva", "lider"]] })])).dias).toHaveLength(7);
  });

  it("a OS de antes da parte 3.4 acha a equipe e a placa pelo cadastro", () => {
    const antiga = { ...os("10045-01", HOJE, { equipe: [] }), agenda: { data: HOJE, hora: "09:00", fim: null, equipe: ["col_al"], veiculos: ["vei_ghi"] }, pessoas: [], placas: [] };
    const agenda = agendaDaSemana(entrada([antiga]));
    expect(agenda.ordens["10045-01"].equipe).toEqual(["Ana Lima"]);
    expect(agenda.ordens["10045-01"].placas).toEqual(["GHI-7J89"]);
    expect(agenda.grupos[0].linhas[0].dias[HOJE].map((item) => item.numero)).toEqual(["10045-01"]);
  });
});

describe("o que pede atenção", () => {
  it("quem está em duas OS no mesmo dia aparece nas duas, pela hora, e conta no dia", () => {
    const agenda = agendaDaSemana(
      entrada([
        os("10049-01", HOJE, { hora: "16:00", equipe: [["col_al", "Ana Lima", "lider"]] }),
        os("10045-01", HOJE, { hora: "08:00", fim: "12:40", status: "em_revisao", equipe: [["col_al", "Ana Lima", "lider"]] }),
      ]),
    );
    expect(agenda.grupos[0].linhas[0].dias[HOJE].map((item) => item.numero)).toEqual(["10045-01", "10049-01"]);
    expect(agenda.resumo[HOJE]).toEqual({ ordens: 2, semEquipe: 0, emDuasOs: 1 });
    expect(resumoDoDiaEmPartes(agenda.resumo[HOJE])).toEqual([
      { texto: "2 OS", alerta: false },
      { texto: "1 em duas OS", alerta: true },
    ]);
  });

  it("a OS agendada sem ninguém fica em Sem equipe e conta no dia", () => {
    const agenda = agendaDaSemana(entrada([os("10049-01", "2026-10-21", { hora: "15:00", frota: ["vei_def"] }), os("10045-01", HOJE, { hora: null })]));
    expect(agenda.semEquipe.map((item) => [item.numero, item.quando, item.tipo])).toEqual([
      ["10045-01", "Ter 20/10", "planejada"],
      ["10049-01", "Qua 21/10 15:00", "paraquedas"],
    ]);
    expect(resumoDoDiaEmPartes(agenda.resumo["2026-10-21"])).toEqual([
      { texto: "1 OS", alerta: false },
      { texto: "1 sem equipe", alerta: true },
    ]);
    expect(resumoDoDiaEmPartes(agenda.resumo["2026-10-19"])).toEqual([]);
  });
});

describe("a busca", () => {
  const ordens = [
    os("10045-01", HOJE, { equipe: [["col_cs", "Carlos Silva", "lider"]], frota: ["vei_def"] }),
    os("10049-01", HOJE, { customer_code: "SAFRA", equipe: [["col_al", "Ana Lima", "lider"]], frota: ["vei_ghi"] }),
    os("10049-02", HOJE, { customer_code: "SAFRA" }),
  ];

  it("acha a pessoa pelo nome sem acento, a placa, a OS e o cliente", () => {
    const nomes = (busca: string) =>
      agendaDaSemana(entrada(ordens, { busca }))
        .grupos.flatMap((grupo) => grupo.linhas.map((linha) => linha.nome));
    expect(nomes("carlos")).toEqual(["Carlos Silva"]);
    expect(nomes("ANA LIMA")).toEqual(["Ana Lima"]);
    expect(nomes("ghi-7j")).toEqual(["GHI-7J89"]);
    expect(nomes("10045-01")).toEqual(["Carlos Silva", "DEF-4G56"]);
    expect(nomes("itau")).toEqual(["Carlos Silva", "DEF-4G56"]);
    expect(agendaDaSemana(entrada(ordens, { busca: "safra" })).semEquipe.map((item) => item.numero)).toEqual(["10049-02"]);
    expect(agendaDaSemana(entrada(ordens, { busca: "carlos" })).semEquipe).toEqual([]);
  });

  it("a lista por dia do celular traz as OS do dia pela hora, com a busca pela equipe, placa ou cliente", () => {
    const numeros = (busca: string) => (agendaDaSemana(entrada(ordens, { busca })).porDia[HOJE] ?? []).map((item) => item.numero);
    expect(numeros("")).toEqual(["10045-01", "10049-01", "10049-02"]);
    expect(numeros("ana")).toEqual(["10049-01"]);
    expect(numeros("def-4g")).toEqual(["10045-01"]);
    expect(numeros("safra")).toEqual(["10049-01", "10049-02"]);
  });
});
