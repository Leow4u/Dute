import { describe, expect, it } from "vitest";

import {
  SEM_FILTRO_DE_DEMANDAS,
  chegadaDaDemanda,
  clientesDasDemandas,
  demandaDaOperacao,
  escopoComSaldo,
  etapaNaOperacao,
  linhasDeDemandas,
  osDaDemanda,
  proximaOs,
  resumoDasOs,
  type DemandaDaOperacao,
} from "./demandas";
import type { OsDaFila } from "./fila";

/** Operação › Demandas e Demanda (parte 3.5b). */

const HOJE = "2026-10-23";
const AGORA = new Date("2026-10-23T17:20:00.000Z");

function demanda(numero: string, extra: Partial<DemandaDaOperacao> = {}): DemandaDaOperacao {
  return {
    numero,
    customerCode: "ITAU",
    titulo: "Mudança do 5º andar",
    tipo: "planejada",
    entrada: "comercial",
    etapa: "para_planejar",
    executarAte: null,
    osNumeros: [],
    escopo: [
      { id: "ln_1", item: "Cadeira", quantidade: "160", unidade: "UN" },
      { id: "ln_2", item: "Mesa", quantidade: "12.5", unidade: "UN" },
    ],
    fora: null,
    recebidaEm: null,
    canal: null,
    pedidoPor: null,
    origem: null,
    destino: null,
    ...extra,
  };
}

function os(numero: string, status: OsDaFila["status"], itens: OsDaFila["itens"] = [], agenda: OsDaFila["agenda"] = null): OsDaFila {
  return { numero, demanda: numero.slice(0, 5), customer_code: "ITAU", status, edicao: 1, itens, agenda, pessoas: [], placas: [], servicos: [], rota: null };
}

const em = (data: string, hora: string | null) => ({ data, hora, fim: null, equipe: [], veiculos: [] });

describe("leitura da demanda", () => {
  it("traz o que a ficha mostra: quem pediu, a chegada e os locais, sem contato do cadastro", () => {
    const lida = demandaDaOperacao("10053", {
      customer_code: "ITAU",
      etapa: "para_planejar",
      entrada: "direta",
      tipo: "paraquedas",
      canal: "whatsapp",
      recebida_em: "2026-10-23T16:05:00.000Z",
      pedido_por: { nome: "Renata Campos", telefone: "11987654321" },
      origem: { local_id: "loc_faria", complemento: "5º andar" },
      destino: { local_id: null, complemento: null },
      solicitante: { contato_id: "ct_1" },
    });
    expect(lida).toMatchObject({
      canal: "whatsapp",
      recebidaEm: "2026-10-23T16:05:00.000Z",
      pedidoPor: { nome: "Renata Campos", telefone: "11987654321" },
      origem: { localId: "loc_faria", complemento: "5º andar" },
      destino: null,
    });
    expect(chegadaDaDemanda(lida!)).toBe("WhatsApp · 23/10/2026 13:05");
    expect(chegadaDaDemanda({ canal: null, recebidaEm: null })).toBeNull();
    // A entrega do WMS (parte 4.5b) chega pela Armazenagem, não é o pedido do portal.
    expect(chegadaDaDemanda({ canal: "wms", recebidaEm: null })).toBe("Armazenagem");
  });
});

describe("etapa na Operação", () => {
  it("fora de Para planejar vale a do Comercial, agrupada", () => {
    expect(etapaNaOperacao(demanda("1", { etapa: "em_montagem" }), [])).toBe("no_comercial");
    expect(etapaNaOperacao(demanda("1", { etapa: "para_aprovar" }), [])).toBe("no_comercial");
    expect(etapaNaOperacao(demanda("1", { etapa: "aguardando_cliente" }), [])).toBe("aguardando_cliente");
    expect(etapaNaOperacao(demanda("1", { etapa: "execucao_a_orcar" }), [])).toBe("execucao_a_orcar");
    expect(etapaNaOperacao(demanda("1", { etapa: "aguardando_autorizacao" }), [])).toBe("a_faturar");
    expect(etapaNaOperacao(demanda("1", { etapa: "a_faturar" }), [])).toBe("a_faturar");
    expect(etapaNaOperacao(demanda("1", { etapa: "para_planejar", fora: "perdida" }), [])).toBe("perdida");
  });

  it("em Para planejar, a OS que mais avançou diz onde a demanda está", () => {
    const d = demanda("10045");
    expect(etapaNaOperacao(d, [])).toBe("para_planejar");
    expect(etapaNaOperacao(d, [os("10045-01", "aberta")])).toBe("para_agendar");
    expect(etapaNaOperacao(d, [os("10045-01", "aberta"), os("10045-02", "agendada")])).toBe("agendada");
    expect(etapaNaOperacao(d, [os("10045-01", "em_revisao"), os("10045-02", "agendada")])).toBe("em_revisao");
    expect(etapaNaOperacao(d, [os("10045-01", "em_execucao"), os("10045-02", "em_revisao")])).toBe("em_execucao");
    expect(etapaNaOperacao(d, [os("10045-01", "revisada"), os("10045-02", "cancelada")])).toBe("para_planejar");
    expect(etapaNaOperacao(d, [os("10046-01", "agendada")])).toBe("para_planejar");
  });
});

describe("OS da demanda", () => {
  const ordens = [os("10045-02", "agendada", [], em("2026-10-28", "08:00")), os("10045-01", "agendada", [], em(HOJE, "15:00")), os("10045-03", "cancelada")];

  it("em ordem, sem a cancelada (a não ser que se peça)", () => {
    expect(osDaDemanda("10045", ordens).map((item) => item.numero)).toEqual(["10045-01", "10045-02"]);
    expect(osDaDemanda("10045", ordens, true).map((item) => item.numero)).toEqual(["10045-01", "10045-02", "10045-03"]);
  });

  it("o resumo da coluna OS e a próxima OS agendada", () => {
    expect(resumoDasOs("10045", [])).toBe("Nenhuma");
    expect(resumoDasOs("10045", [os("10045-01", "aberta")])).toBe("1 · para agendar");
    expect(resumoDasOs("10045", ordens)).toBe("2 · 2 agendada");
    expect(resumoDasOs("10045", [...ordens, os("10045-04", "em_execucao")])).toBe("3 · 1 em execução");
    expect(proximaOs("10045", ordens, HOJE)).toBe("OS 10045-01 · 23/10/2026 15:00");
    expect(proximaOs("10045", ordens, "2026-10-24")).toBe("OS 10045-02 · 28/10/2026 08:00");
    expect(proximaOs("10045", [], HOJE)).toBeNull();
  });
});

describe("escopo com saldo", () => {
  it("soma as fatias das OS não canceladas, diz em quais OS está e o saldo, como a callable", () => {
    const linhas = escopoComSaldo(demanda("10045"), [
      os("10045-01", "agendada", [{ id: "ln_1", item: "Cadeira", quantidade: "60" }]),
      os("10045-02", "aberta", [{ id: "ln_1", item: "Cadeira", quantidade: "40.5" }, { id: "ln_2", item: "Mesa", quantidade: "12.5" }]),
      os("10045-03", "cancelada", [{ id: "ln_1", item: "Cadeira", quantidade: "50" }]),
    ]);
    expect(linhas).toEqual([
      { id: "ln_1", lpuItemId: null, item: "Cadeira", unidade: "UN", escopo: "160", nasOs: "100.5", osNumeros: ["10045-01", "10045-02"], saldo: "59.5" },
      { id: "ln_2", lpuItemId: null, item: "Mesa", unidade: "UN", escopo: "12.5", nasOs: "12.5", osNumeros: ["10045-02"], saldo: "0" },
    ]);
  });
});

describe("lista de demandas", () => {
  const demandas = [
    demanda("10043", { titulo: "Instalação de 40 lockers" }),
    demanda("10053", { tipo: "paraquedas", entrada: "direta", customerCode: "SAFRA", titulo: "Troca de cadeiras", executarAte: "2026-10-23T22:00:00.000Z" }),
    demanda("10049", { etapa: "aguardando_cliente", titulo: "Vistoria da mudança" }),
  ];
  const ordens = [os("10053-01", "aberta")];
  const linhas = (extra: Partial<Parameters<typeof linhasDeDemandas>[0]> = {}) =>
    linhasDeDemandas({ demandas, ordens, nomesClientes: { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" }, hoje: HOJE, agora: AGORA, filtros: SEM_FILTRO_DE_DEMANDAS, busca: "", ...extra });

  it("mais recentes primeiro, com etapa, OS, próximo passo e o prazo da direta", () => {
    const lista = linhas();
    expect(lista.map((linha) => [linha.demanda.numero, linha.etapa, linha.os, linha.proximo])).toEqual([
      ["10053", "para_agendar", "1 · para agendar", null],
      ["10049", "aguardando_cliente", "Nenhuma", null],
      ["10043", "para_planejar", "Nenhuma", "Planejar OS"],
    ]);
    expect(lista[0].prazo).toEqual({ texto: "Hoje até 19:00", falta: "faltam 4h40", atrasada: false });
    expect(lista[0].cliente).toBe("Banco Safra");
  });

  it("filtra por tipo, entrada, cliente e etapa, e busca por número, OS, cliente e título", () => {
    const numeros = (extra: Partial<Parameters<typeof linhasDeDemandas>[0]>) => linhas(extra).map((linha) => linha.demanda.numero);
    expect(numeros({ filtros: { ...SEM_FILTRO_DE_DEMANDAS, tipo: "paraquedas" } })).toEqual(["10053"]);
    expect(numeros({ filtros: { ...SEM_FILTRO_DE_DEMANDAS, entrada: "comercial" } })).toEqual(["10049", "10043"]);
    expect(numeros({ filtros: { ...SEM_FILTRO_DE_DEMANDAS, cliente: "ITAU" } })).toEqual(["10049", "10043"]);
    expect(numeros({ filtros: { ...SEM_FILTRO_DE_DEMANDAS, etapa: "para_planejar" } })).toEqual(["10043"]);
    expect(numeros({ busca: "10053-01" })).toEqual(["10053"]);
    expect(numeros({ busca: "safra" })).toEqual(["10053"]);
    expect(numeros({ busca: "instalacao" })).toEqual(["10043"]);
  });

  it("a entrega do WMS entra pela Armazenagem no filtro, e a Direta não a traz", () => {
    const comEntrega = [...demandas, demanda("10060", { entrada: "direta", canal: "wms", titulo: "Entrega do pedido PED-0118" })];
    const numeros = (porEntrada: DemandaDaOperacao["entrada"]) =>
      linhas({ demandas: comEntrega, filtros: { ...SEM_FILTRO_DE_DEMANDAS, entrada: porEntrada } }).map((linha) => linha.demanda.numero);
    expect(numeros("armazenagem")).toEqual(["10060"]);
    expect(numeros("direta")).toEqual(["10053"]);
  });

  it("as opções de cliente são os das demandas, por nome", () => {
    expect(clientesDasDemandas(demandas, { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" })).toEqual([
      { valor: "SAFRA", rotulo: "Banco Safra" },
      { valor: "ITAU", rotulo: "Itaú Unibanco" },
    ]);
  });
});
