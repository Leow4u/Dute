import { describe, expect, it } from "vitest";

import {
  agendaDaOs,
  clienteDaLeitura,
  comDemanda,
  demandaDaFila,
  demandaParaAbrir,
  equipeDe,
  osDaLeitura,
  quadroDoDia,
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

describe("quadro do dia", () => {
  it("separa o que falta agendar, o de hoje e os outros dias, e esconde a cancelada", () => {
    const hoje: OsDaFila = {
      ...aberta,
      numero: "10045-02",
      status: "agendada",
      agenda: { data: "2026-10-22", hora: "15:00", equipe: ["col_a"], veiculo_id: "vei_a" },
    };
    const outro: OsDaFila = {
      ...hoje,
      numero: "10045-03",
      agenda: { ...hoje.agenda!, data: "2026-10-23" },
    };
    const cancelada: OsDaFila = { ...aberta, numero: "10045-04", status: "cancelada" };
    const quadro = quadroDoDia([aberta, hoje, outro, cancelada], "2026-10-22");
    expect(quadro.paraAgendar.map((os) => os.numero)).toEqual(["10045-01"]);
    expect(quadro.agendadasHoje.map((os) => os.numero)).toEqual(["10045-02"]);
    expect(quadro.outrosDias.map((os) => os.numero)).toEqual(["10045-03"]);
  });

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
    expect(perdida).toEqual({ numero: "10045", fora: "perdida", paraAbrir: null });
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
    expect(quadroDoDia(ordens, "2026-10-22").paraAgendar.map((os) => os.numero)).toEqual(["10045-01", "10047-01"]);
  });
});
