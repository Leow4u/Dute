import { describe, expect, it } from "vitest";

import {
  agendaDaOs,
  clienteDaLeitura,
  comDemanda,
  demandaDaFila,
  demandaParaAbrir,
  equipeDe,
  osDaLeitura,
  pedidoDeAgenda,
  placasDe,
  type OsDaFila,
} from "./fila";

const aberta: OsDaFila = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "aberta",
  edicao: 1,
  itens: [{ item: "Estação", quantidade: "2" }],
  agenda: null,
};

describe("leitura da fila", () => {
  it("lê a OS sem preço e a demanda em Para planejar", () => {
    const os = osDaLeitura("10045-01", {
      status: "aberta",
      edicao: 1,
      demanda: "10045",
      customer_code: "ITAU",
      itens: [{ item: "Estação", quantidade: "2", preco: "88.50", total_cents: 17700 }],
    });
    expect(os?.itens).toEqual([{ item: "Estação", quantidade: "2" }]);
    expect(JSON.stringify(os)).not.toContain("88.50");
    expect(demandaParaAbrir("10045", {
      etapa: "para_planejar",
      customer_code: "ITAU",
      titulo: "Montagem",
      os_numeros: ["10045-01"],
    })).toMatchObject({ titulo: "Montagem", os_numeros: ["10045-01"] });
    expect(demandaParaAbrir("10046", { etapa: "em_montagem", customer_code: "ITAU" })).toBeNull();
    expect(clienteDaLeitura("cli", { customer_code: "ITAU", name: "Itaú" })).toEqual({ code: "ITAU", nome: "Itaú" });
    expect(equipeDe(["col_a", "col_b"], { col_a: "Ana Souza" })).toBe("Ana Souza +1");
    expect(agendaDaOs(aberta, "2026-10-22")).toMatchObject({ data: "2026-10-22", equipe: [], veiculoId: "" });
  });
});

describe("OS de demanda perdida no Comercial", () => {
  it("marca a OS da demanda perdida ou cancelada e deixa as outras como estão", () => {
    const perdida = demandaDaFila("10045", {
      etapa: "perdida",
      customer_code: "ITAU",
      perda: { motivo: "cancelado_cliente", etapa_antes: "para_planejar", rv: 0 },
      cancelamento: null,
      os_numeros: ["10045-01"],
    });
    expect(perdida).toEqual({ numero: "10045", fora: "perdida", paraAbrir: null, executarAte: null });
    expect(demandaDaFila("10046", { etapa: "cancelada", customer_code: "ITAU", perda: null, cancelamento: { motivo: "cliente" } }).fora).toBe("cancelada");
    const planejar = demandaDaFila("10047", { etapa: "para_planejar", customer_code: "ITAU", perda: null, os_numeros: [] });
    expect(planejar.fora).toBeNull();
    expect(planejar.paraAbrir?.numero).toBe("10047");

    const outra: OsDaFila = { ...aberta, numero: "10047-01", demanda: "10047" };
    const ordens = comDemanda([aberta, outra], [perdida, planejar]);
    expect(ordens.map((os) => [os.numero, os.demandaFora])).toEqual([
      ["10045-01", "perdida"],
      ["10047-01", null],
    ]);
  });

  it("a OS leva o prazo da demanda direta (parte 3.13b)", () => {
    const direta = demandaDaFila("10053", { etapa: "para_planejar", entrada: "direta", customer_code: "ITAU", executar_ate: "2026-10-23T19:00:00-03:00" });
    expect(direta.executarAte).toBe("2026-10-23T19:00:00-03:00");
    expect(demandaDaFila("10054", { etapa: "para_planejar", customer_code: "ITAU", executar_ate: "amanhã" }).executarAte).toBeNull();
    const [os] = comDemanda([{ ...aberta, numero: "10053-01", demanda: "10053" }], [direta]);
    expect(os.prazo).toBe("2026-10-23T19:00:00-03:00");
    expect(comDemanda([aberta], [])[0].prazo).toBeNull();
  });
});

describe("OS do modelo da parte 3.4b", () => {
  const BASE = { demanda: "10045", customer_code: "ITAU", edicao: 2 };

  it("lê a janela, a equipe e os veículos copiados, e a fatia em planejado", () => {
    const os = osDaLeitura("10045-02", {
      ...BASE,
      status: "agendada",
      itens: [{ id: "ln_1", item: "Estação", planejado: "30" }],
      janela: { data: "2026-10-27", inicio: "07:30", fim: "18:00" },
      equipe: [
        { colaborador_id: "col_a", nome: "Ana Souza", papel: "lider" },
        { colaborador_id: "col_b", nome: "Valter Moreira", papel: null },
      ],
      veiculos: [{ veiculo_id: "vei_a", placa: "DEF4G56" }, { veiculo_id: "vei_b", placa: "FGH2B34" }],
    });
    expect(os?.itens).toEqual([{ id: "ln_1", item: "Estação", quantidade: "30" }]);
    expect(os?.pessoas).toEqual([
      { id: "col_a", nome: "Ana Souza", papel: "lider" },
      { id: "col_b", nome: "Valter Moreira", papel: null },
    ]);
    expect(os?.placas).toEqual(["DEF-4G56", "FGH-2B34"]);
    expect(os?.agenda).toEqual({ data: "2026-10-27", hora: "07:30", fim: "18:00", equipe: ["col_a", "col_b"], veiculos: ["vei_a", "vei_b"] });
  });

  it("revisada, o saldo conta o consumido (parte 3.10a), como a callable", () => {
    const os = osDaLeitura("10045-02", { ...BASE, status: "revisada", itens: [{ id: "ln_1", item: "Estação", planejado: "30", consumido: "28" }] });
    expect(os?.itens).toEqual([{ id: "ln_1", item: "Estação", quantidade: "28" }]);
  });

  it("a OS de antes da parte 3.4 continua lida pela agenda antiga", () => {
    const os = osDaLeitura("10045-01", {
      ...BASE,
      status: "agendada",
      itens: [{ item: "Estação", quantidade: "2" }],
      agenda: { data: "2026-10-22", hora: "15:00", equipe: ["col_a"], veiculo_id: "vei_a" },
    });
    expect(os?.agenda).toEqual({ data: "2026-10-22", hora: "15:00", fim: null, equipe: ["col_a"], veiculos: ["vei_a"] });
    expect(os?.itens[0].quantidade).toBe("2");
  });

  it("a rota sai dos locais copiados; as OS em execução e revisão também são lidas", () => {
    const os = osDaLeitura("10045-04", {
      ...BASE,
      status: "em_execucao",
      itens: [],
      servicos: ["transporte", "montagem"],
      locais: { origem: { nome: "Faria Lima", complemento: "4º andar" }, destino: { nome: null, complemento: "12º andar" } },
    });
    expect(os?.status).toBe("em_execucao");
    expect(os?.rota).toBe("Faria Lima → 12º andar");
    expect(os?.servicos).toEqual(["transporte", "montagem"]);
    expect(osDaLeitura("10045-05", { ...BASE, status: "pausada", itens: [] })).toBeNull();
  });

  it("aberta, sem janela, não tem agenda mesmo com equipe planejada", () => {
    const os = osDaLeitura("10045-03", { ...BASE, status: "aberta", itens: [], equipe: [{ colaborador_id: "col_a" }] });
    expect(os?.agenda).toBeNull();
  });

  it("o agendamento manda janela, equipe e veículos no formato da callable", () => {
    expect(pedidoDeAgenda({ data: "2026-10-27", hora: "07:30:00", equipe: ["col_a", "col_b"], veiculoId: "vei_a" })).toEqual({
      janela: { data: "2026-10-27", inicio: "07:30", fim: null },
      equipe: [{ colaborador_id: "col_a" }, { colaborador_id: "col_b" }],
      veiculos: ["vei_a"],
    });
    expect(pedidoDeAgenda({ data: "2026-10-27", hora: " ", equipe: [], veiculoId: "" })).toEqual({
      janela: { data: "2026-10-27", inicio: null, fim: null },
      equipe: [],
      veiculos: [],
    });
  });

  it("as placas dos veículos da OS, na ordem", () => {
    expect(placasDe(["vei_a", "vei_x"], { vei_a: "DEF4G56" })).toBe("DEF-4G56, vei_x");
  });
});

describe("o painel de escalar devolve o que não mostra", () => {
  // O Planejar OS grava o papel de cada um, vários veículos e o fim da
  // janela; o painel do Hoje e da Agenda mostra só data, hora, equipe e um
  // veículo, e a callable troca a janela, a equipe e os veículos inteiros.
  const planejada: OsDaFila = {
    ...aberta,
    status: "agendada",
    agenda: { data: "2026-10-27", hora: "08:00", fim: "12:30", equipe: ["col_a", "col_b"], veiculos: ["vei_a", "vei_b"] },
    pessoas: [
      { id: "col_a", nome: "Ana Souza", papel: "lider" },
      { id: "col_b", nome: "Valter Moreira", papel: "motorista" },
    ],
  };

  it("reagendar mantém o papel de cada um, os outros veículos e a duração da janela", () => {
    const agenda = { ...agendaDaOs(planejada, "2026-10-22"), data: "2026-10-28", hora: "09:00" };
    expect(pedidoDeAgenda(agenda)).toEqual({
      janela: { data: "2026-10-28", inicio: "09:00", fim: "13:30" },
      equipe: [
        { colaborador_id: "col_a", papel: "lider" },
        { colaborador_id: "col_b", papel: "motorista" },
      ],
      veiculos: ["vei_a", "vei_b"],
    });
  });

  it("sem mexer na hora, o fim fica; quem entra pelo painel vai sem papel (vale o do cadastro)", () => {
    const agenda = agendaDaOs(planejada, "2026-10-22");
    expect(pedidoDeAgenda({ ...agenda, equipe: [...agenda.equipe, "col_c"] })).toMatchObject({
      janela: { data: "2026-10-27", inicio: "08:00", fim: "12:30" },
      equipe: [
        { colaborador_id: "col_a", papel: "lider" },
        { colaborador_id: "col_b", papel: "motorista" },
        { colaborador_id: "col_c" },
      ],
    });
    expect(pedidoDeAgenda({ ...agenda, equipe: ["col_b"] }).equipe).toEqual([{ colaborador_id: "col_b", papel: "motorista" }]);
  });

  it("o veículo do painel é o primeiro: trocar ou tirar mexe só nele", () => {
    const agenda = agendaDaOs(planejada, "2026-10-22");
    expect(agenda.veiculoId).toBe("vei_a");
    expect(pedidoDeAgenda({ ...agenda, veiculoId: "vei_c" }).veiculos).toEqual(["vei_c", "vei_b"]);
    expect(pedidoDeAgenda({ ...agenda, veiculoId: "" }).veiculos).toEqual(["vei_b"]);
    expect(pedidoDeAgenda({ ...agenda, veiculoId: "vei_b" }).veiculos).toEqual(["vei_b"]);
  });

  it("sem hora não há fim, e o fim que passaria do dia sai", () => {
    const agenda = agendaDaOs(planejada, "2026-10-22");
    expect(pedidoDeAgenda({ ...agenda, hora: "" }).janela).toEqual({ data: "2026-10-27", inicio: null, fim: null });
    expect(pedidoDeAgenda({ ...agenda, hora: "21:00" }).janela).toEqual({ data: "2026-10-27", inicio: "21:00", fim: null });
    expect(pedidoDeAgenda({ ...agenda, hora: "19:29" }).janela).toEqual({ data: "2026-10-27", inicio: "19:29", fim: "23:59" });
  });

  it("a OS salva como rascunho no Planejar abre com a equipe e os veículos do plano", () => {
    const rascunho = osDaLeitura("10045-03", {
      demanda: "10045",
      customer_code: "ITAU",
      edicao: 1,
      status: "aberta",
      itens: [],
      equipe: [{ colaborador_id: "col_a", nome: "Ana Souza", papel: "lider" }],
      veiculos: [{ veiculo_id: "vei_a", placa: "DEF4G56" }, { veiculo_id: "vei_b", placa: "FGH2B34" }],
    });
    if (!rascunho) throw new Error("rascunho não lido");
    expect(rascunho.agenda).toBeNull();
    const agenda = agendaDaOs(rascunho, "2026-10-22");
    expect(agenda).toMatchObject({ data: "2026-10-22", hora: "", equipe: ["col_a"], veiculoId: "vei_a" });
    expect(pedidoDeAgenda(agenda)).toEqual({
      janela: { data: "2026-10-22", inicio: null, fim: null },
      equipe: [{ colaborador_id: "col_a", papel: "lider" }],
      veiculos: ["vei_a", "vei_b"],
    });
  });

  it("o papel fora da lista do campo não vai à callable", () => {
    const antiga: OsDaFila = { ...planejada, pessoas: [{ id: "col_a", nome: "Ana Souza", papel: "supervisor" }] };
    expect(pedidoDeAgenda(agendaDaOs(antiga, "2026-10-22")).equipe).toEqual([{ colaborador_id: "col_a" }, { colaborador_id: "col_b" }]);
  });
});
