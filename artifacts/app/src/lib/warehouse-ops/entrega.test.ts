import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MODOS_DE_ENTREGA,
  entregaDoPedido,
  faltaAbrirNaOperacao,
  formularioDaEntrega,
  naOperacao,
  pedidoDaEntrega,
  problemasDaEntrega,
  quandoEmTexto,
  resumoDaEntrega,
  saidaPelaEntrega,
} from "./entrega";

/**
 * A entrega do pedido de saída no WMS (parte 4.5c): a leitura do pedido, o
 * resumo na linha, a Operação, o formulário com a régua de setOrderDelivery
 * e o que a retirada leva para a saída. Dados sintéticos.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DO_WMS = readFileSync(resolve(here, "../../../../../functions/wms/src/domain/order-delivery.ts"), "utf8");
const AGORA = new Date("2026-10-23T13:00:00.000Z");

const DUTELOG = {
  entrega: {
    modo: "dutelog",
    destino: "Transamerica Expo · Pavilhão B",
    data: "2026-10-28",
    hora: "13:00",
    contato: { nome: "Lucas Prado", telefone: "11987654321" },
    montagem: true,
    retorno: { data: "2026-10-30", hora: "18:00" },
    demanda: "10050",
    os_numeros: ["10050-01", "10050-02"],
  },
};
// A retirada gravada antes da decisão 3 da LGPD, com o documento: ele não se lê.
const RETIRADA = { entrega: { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos Lima", documento: "RG 12.345.678-9", placa: "ABC1D23" } };

describe("a entrega gravada no pedido", () => {
  it("os modos são os do WMS", () => {
    const lista = DO_WMS.match(/export const ENTREGA_MODOS = \[([^\]]*)\]/);
    expect([...(lista?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((item) => item[1])).toEqual([...MODOS_DE_ENTREGA]);
  });

  it("o resumo na linha e a demanda e as OS na Operação", () => {
    const dutelog = entregaDoPedido(DUTELOG)!;
    expect(resumoDaEntrega(dutelog)).toBe("Entrega pela Dutelog · Qua 28/10 13:00 · montagem · retorno Sex 30/10 18:00");
    expect(naOperacao(dutelog)).toBe("Demanda 10050 · OS 10050-01 e 10050-02");
    expect(faltaAbrirNaOperacao(dutelog)).toBe(false);
    const semDemanda = entregaDoPedido({ entrega: { ...DUTELOG.entrega, demanda: null, os_numeros: [] } })!;
    expect([naOperacao(semDemanda), faltaAbrirNaOperacao(semDemanda)]).toEqual([null, true]);
    const retirada = entregaDoPedido(RETIRADA)!;
    expect(retirada).toEqual({ modo: "retirada", data: "2026-10-24", hora: "09:00", quemRetira: "Carlos Lima", placa: "ABC1D23" });
    expect(resumoDaEntrega(retirada)).toBe("Retirada pelo cliente · Sáb 24/10 09:00 · Carlos Lima");
    expect([naOperacao(retirada), faltaAbrirNaOperacao(retirada)]).toEqual([null, false]);
    expect(entregaDoPedido({})).toBeNull();
    expect(entregaDoPedido({ entrega: { modo: "correio", data: "2026-10-24", hora: "09:00" } })).toBeNull();
    expect(quandoEmTexto("2026-10-26", "08:00")).toBe("Seg 26/10 08:00");
  });

  it("a retirada leva quem retira e a placa para a saída; a entrega pela Dutelog, não", () => {
    expect(saidaPelaEntrega(entregaDoPedido(RETIRADA))).toEqual({ motorista: "Carlos Lima", placa: "ABC1D23" });
    expect(saidaPelaEntrega(entregaDoPedido(DUTELOG))).toBeNull();
    expect(saidaPelaEntrega(null)).toBeNull();
  });
});

describe("o formulário da entrega", () => {
  it("vem da entrega gravada ou vazio, pela Dutelog, hoje às 13:00", () => {
    expect(formularioDaEntrega(null, "2026-10-23")).toMatchObject({ modo: "dutelog", data: "2026-10-23", hora: "13:00", montagem: false, comRetorno: false });
    expect(formularioDaEntrega(entregaDoPedido(DUTELOG), "2026-10-23")).toMatchObject({ destino: "Transamerica Expo · Pavilhão B", contatoNome: "Lucas Prado", montagem: true, comRetorno: true, retornoData: "2026-10-30" });
    expect(formularioDaEntrega(entregaDoPedido(RETIRADA), "2026-10-23")).toMatchObject({ modo: "retirada", quemRetira: "Carlos Lima", placa: "ABC1D23" });
  });

  it("diz o que falta pela régua de setOrderDelivery", () => {
    const vazio = formularioDaEntrega(null, "2026-10-23");
    expect(problemasDaEntrega(vazio, AGORA)).toEqual({ destino: "Informe o destino." });
    const pronto = { ...vazio, destino: "Av. Paulista, 1000" };
    expect(problemasDaEntrega(pronto, AGORA)).toEqual({});
    expect(problemasDaEntrega({ ...pronto, data: "2026-10-22" }, AGORA)).toEqual({ quando: "A data da entrega já passou." });
    expect(problemasDaEntrega({ ...pronto, comRetorno: true, retornoData: "2026-10-23", retornoHora: "12:00" }, AGORA)).toEqual({ retorno: "O retorno vem depois da entrega." });
    expect(problemasDaEntrega({ ...pronto, contatoTelefone: "12" }, AGORA)).toEqual({ contato: "Telefone inválido: use DDD e número." });
    expect(problemasDaEntrega({ ...pronto, contatoTelefone: "11987654321" }, AGORA)).toEqual({ contato: "Informe o nome do contato." });
    const retirada = { ...vazio, modo: "retirada" as const };
    expect(problemasDaEntrega(retirada, AGORA)).toEqual({ quemRetira: "Informe quem retira." });
    expect(problemasDaEntrega({ ...retirada, quemRetira: "Carlos", placa: "12" }, AGORA)).toEqual({ placa: "Placa inválida: use ABC1D23 ou ABC1234." });
  });

  it("o pedido leva só os campos do modo escolhido", () => {
    const form = { ...formularioDaEntrega(null, "2026-10-23"), destino: " Av. Paulista, 1000 ", quemRetira: "não vai" };
    expect(pedidoDaEntrega(form, "ord_118", "k1")).toEqual({
      idempotency_key: "k1",
      order_id: "ord_118",
      entrega: { modo: "dutelog", destino: "Av. Paulista, 1000", data: "2026-10-23", hora: "13:00", contato: null, montagem: false, retorno: null },
    });
    expect(pedidoDaEntrega({ ...form, modo: "retirada", quemRetira: "Carlos Lima", placa: "abc1d23" }, "ord_118", "k1")).toEqual({
      idempotency_key: "k1",
      order_id: "ord_118",
      // Sem o documento de quem retira (decisão 3 da LGPD).
      entrega: { modo: "retirada", data: "2026-10-23", hora: "13:00", quem_retira: "Carlos Lima", placa: "abc1d23" },
    });
  });
});
