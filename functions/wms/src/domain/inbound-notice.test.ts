import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  receiptDocumentId,
  receiptLinkProblem,
  shipmentNoticeProblem,
} from "./inbound-notice.js";

describe("vínculo da chegada com o aviso de envio", () => {
  const customer = "BTG Pactual";

  it("aceita o aviso aberto do mesmo cliente e o id da tarefa do Receber", () => {
    assert.equal(receiptDocumentId("receiving:inb_avulso_1"), "inb_avulso_1");
    assert.equal(receiptDocumentId("inb_avulso_1"), "inb_avulso_1");
    assert.equal(
      shipmentNoticeProblem(
        { customer_code: customer, type: "recebimento", status: "open" },
        customer,
      ),
      null,
    );
    assert.equal(receiptLinkProblem({ customer_code: customer, status: "checking" }, customer), null);
  });

  it("recusa outro cliente, saída, aviso já decidido e chegada concluída", () => {
    assert.equal(
      shipmentNoticeProblem({ customer_code: "Outro", type: "recebimento", status: "open" }, customer),
      "Aviso de outro cliente.",
    );
    assert.equal(
      shipmentNoticeProblem({ customer_code: customer, type: "retirada", status: "open" }, customer),
      "Só avisos de envio podem ser vinculados.",
    );
    assert.equal(
      shipmentNoticeProblem({ customer_code: customer, type: "recebimento", status: "approved" }, customer),
      "Este aviso não está aguardando aprovação.",
    );
    assert.equal(
      receiptLinkProblem({ customer_code: customer, status: "received" }, customer),
      "Esta chegada já foi concluída.",
    );
  });
});
