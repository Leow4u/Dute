import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { entregaGravada, instanteDaEntrega, interpretarEntrega, mesmaEntrega, pedidoFechado, problemaDaEntrega, type Entrega } from "./order-delivery.js";

/**
 * A entrega do pedido de saída (parte 4.5a): pela Dutelog ou retirada pelo
 * cliente, só antes da saída e enquanto a Operação não abriu a demanda.
 * Dados sintéticos.
 */

const AGORA = new Date("2026-10-23T13:00:00.000Z");
const DUTELOG = {
  order_id: "ord_1",
  entrega: {
    modo: "dutelog",
    destino: "  Transamerica Expo ·  Pavilhão B ",
    data: "2026-10-28",
    hora: "13:00",
    contato: { nome: "Lucas Prado", telefone: "(11) 98765-4321" },
    montagem: true,
    retorno: { data: "2026-10-30", hora: "18:00" },
  },
};
const RETIRADA = { order_id: "ord_1", entrega: { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos Lima", documento: "RG 12.345.678-9", placa: "abc-1d23" } };

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("a escolha da entrega", () => {
  it("pela Dutelog: o destino sem espaço repetido, o contato, a montagem e o retorno", () => {
    const { entrega } = interpretarEntrega(DUTELOG);
    assert.deepEqual(entrega, {
      modo: "dutelog",
      destino: "Transamerica Expo · Pavilhão B",
      data: "2026-10-28",
      hora: "13:00",
      contato: { nome: "Lucas Prado", telefone: "11987654321" },
      montagem: true,
      retorno: { data: "2026-10-30", hora: "18:00" },
    });
    const simples = interpretarEntrega({ order_id: "ord_1", entrega: { modo: "dutelog", destino: "Av. Paulista, 1000", data: "2026-10-28", hora: "13:00" } }).entrega;
    assert.deepEqual(simples, { modo: "dutelog", destino: "Av. Paulista, 1000", data: "2026-10-28", hora: "13:00", contato: null, montagem: false, retorno: null });
  });

  it("retirada pelo cliente: quem retira, o documento e a placa normalizada", () => {
    assert.deepEqual(interpretarEntrega(RETIRADA).entrega, { modo: "retirada", data: "2026-10-24", hora: "09:00", quem_retira: "Carlos Lima", documento: "RG 12.345.678-9", placa: "ABC1D23" });
  });

  it("recusa modo desconhecido, campo de outro modo, data, hora, placa e telefone fora do formato", () => {
    assert.match(rejeita(() => interpretarEntrega({ order_id: "ord_1", entrega: { modo: "correio" } })).message, /Dutelog ou a retirada/);
    assert.match(rejeita(() => interpretarEntrega({ ...RETIRADA, entrega: { ...RETIRADA.entrega, destino: "X" } })).message, /Campo não aceito: destino/);
    assert.match(rejeita(() => interpretarEntrega({ ...DUTELOG, entrega: { ...DUTELOG.entrega, data: "2026-02-30" } })).message, /Data inválida/);
    assert.match(rejeita(() => interpretarEntrega({ ...DUTELOG, entrega: { ...DUTELOG.entrega, hora: "25:00" } })).message, /Hora inválida/);
    assert.match(rejeita(() => interpretarEntrega({ ...RETIRADA, entrega: { ...RETIRADA.entrega, placa: "1234" } })).message, /Placa inválida/);
    assert.match(rejeita(() => interpretarEntrega({ ...DUTELOG, entrega: { ...DUTELOG.entrega, contato: { nome: "Lucas", telefone: "12" } } })).message, /Telefone do contato/);
    assert.match(rejeita(() => interpretarEntrega({ ...RETIRADA, order_id: "a/b" })).message, /Pedido inválido/);
  });
});

describe("quando a entrega muda", () => {
  const dutelog = interpretarEntrega(DUTELOG).entrega as Extract<Entrega, { modo: "dutelog" }>;

  it("só antes da saída, de hoje em diante, com o retorno depois da entrega", () => {
    assert.equal(problemaDaEntrega({ status: "EM_EXPEDICAO" }, dutelog, AGORA), null);
    for (const status of ["EXPEDIDO", "ENTREGUE", "CANCELADO"]) {
      assert.equal(problemaDaEntrega({ status }, dutelog, AGORA), "O pedido já saiu do armazém: a entrega não muda mais.", status);
      assert.equal(pedidoFechado(status), true);
    }
    assert.equal(problemaDaEntrega({ status: "PENDENTE" }, { ...dutelog, data: "2026-10-22" }, AGORA), "A data da entrega já passou.");
    assert.equal(problemaDaEntrega({ status: "PENDENTE" }, { ...dutelog, retorno: { data: "2026-10-28", hora: "12:00" } }, AGORA), "O retorno ao armazém vem depois da entrega.");
    assert.equal(instanteDaEntrega("2026-10-28", "13:00"), Date.parse("2026-10-28T16:00:00.000Z"));
  });

  it("a entrega que já virou demanda muda na Operação", () => {
    assert.equal(problemaDaEntrega({ status: "PENDENTE", entrega: { modo: "dutelog", demanda: "10050" } }, interpretarEntrega(RETIRADA).entrega, AGORA), "A entrega já virou a demanda 10050 na Operação: mude por lá.");
  });

  it("a mesma escolha, lida de volta do pedido com os carimbos, compara igual", () => {
    const gravada = entregaGravada(dutelog, AGORA.toISOString(), "u1");
    assert.equal(gravada.demanda, null);
    // O Firestore devolve o mapa em outra ordem.
    const lida = Object.fromEntries(Object.entries(gravada).reverse());
    assert.equal(mesmaEntrega(lida, dutelog), true);
    assert.equal(mesmaEntrega(lida, { ...dutelog, hora: "14:00" }), false);
    assert.equal(mesmaEntrega(null, dutelog), false);
  });
});
