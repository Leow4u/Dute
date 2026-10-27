import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  interpretarCancelamento,
  pedidoJaCancelado,
  problemaDoCancelamento,
  problemaDoEncerramento,
  tarefaAberta,
} from "./order-cancel.js";

describe("o pedido de cancelamento (pergunta 59)", () => {
  it("leva o pedido, o motivo e a chave, sem espaço sobrando no motivo", () => {
    assert.deepEqual(
      interpretarCancelamento({ order_id: " ord_req-1 ", reason: "  O cliente   desistiu da retirada. ", idempotency_key: "cancelar-1234" }),
      { order_id: "ord_req-1", reason: "O cliente desistiu da retirada.", idempotency_key: "cancelar-1234" },
    );
  });

  it("recusa sem o motivo, com o motivo curto ou longo, com o pedido inválido e com campo a mais", () => {
    const base = { order_id: "ord_req-1", reason: "O cliente desistiu.", idempotency_key: "cancelar-1234" };
    const recusa = (entrada: Record<string, unknown>, message: string) =>
      assert.throws(() => interpretarCancelamento(entrada), { code: "invalid-argument", message });
    recusa({ order_id: base.order_id, idempotency_key: base.idempotency_key }, "Informe o motivo do cancelamento.");
    recusa({ ...base, reason: " ab " }, "Informe o motivo do cancelamento.");
    recusa({ ...base, reason: "x".repeat(501) }, "Use até 500 caracteres no motivo.");
    recusa({ ...base, order_id: "" }, "Informe o pedido.");
    recusa({ ...base, order_id: "orders/outro" }, "Pedido inválido.");
    recusa({ ...base, customer_code: "Outro" }, "Campo não aceito: customer_code.");
  });
});

describe("quando o pedido se cancela", () => {
  it("o pedido no armazém se cancela: aprovado, separado ou embalado", () => {
    for (const status of ["PENDENTE", "SEPARACAO", "EM_EXPEDICAO", "pendente"]) assert.equal(problemaDoCancelamento(status), null, status);
  });

  it("o que já saiu não se cancela, e o status desconhecido também não", () => {
    for (const status of ["EXPEDIDO", "ENTREGUE"]) {
      assert.equal(problemaDoCancelamento(status), "O pedido já saiu do armazém: não se cancela mais.");
    }
    assert.equal(problemaDoCancelamento("ABERTO"), "Pedido em ABERTO não se cancela.");
    assert.equal(problemaDoCancelamento(undefined), "Pedido em status vazio não se cancela.");
  });

  it("o cancelado de antes não é problema: cancelar de novo devolve o mesmo", () => {
    assert.equal(pedidoJaCancelado("CANCELADO"), true);
    assert.equal(pedidoJaCancelado("cancelled"), true);
    assert.equal(pedidoJaCancelado("PENDENTE"), false);
    assert.equal(problemaDoCancelamento("CANCELADO"), null);
  });

  it("fecha só a tarefa que não terminou", () => {
    assert.equal(tarefaAberta("picking", "planned"), true);
    assert.equal(tarefaAberta("picking", "in_progress"), true);
    assert.equal(tarefaAberta("picking", "completed"), false);
    assert.equal(tarefaAberta("packing", "ready"), true);
    assert.equal(tarefaAberta("packing", "completed"), false);
    assert.equal(tarefaAberta("shipping", "ready_to_dispatch"), true);
    assert.equal(tarefaAberta("shipping", "dispatched"), false);
    assert.equal(tarefaAberta("shipping", "delivered"), false);
  });
});

describe("Encerrar a solicitação de saída", () => {
  it("só depois da entrega", () => {
    assert.equal(problemaDoEncerramento({ operational_status: "delivered" }), null);
    assert.equal(problemaDoEncerramento({ fulfillment_status: "completed" }), null);
    for (const operational_status of ["picking_planned", "packing_ready", "ready_to_dispatch", "dispatched", undefined]) {
      assert.equal(
        problemaDoEncerramento({ operational_status }),
        "O pedido ainda não foi entregue: encerre depois da entrega. Para desistir dele, use Cancelar pedido.",
      );
    }
  });
});
