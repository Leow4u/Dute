import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FieldValue } from "firebase-admin/firestore";

import {
  noticeFields,
  prelinkFields,
  receiptDocumentId,
  receiptLinkProblem,
  shipmentNoticeProblem,
} from "./inbound-notice.js";

describe("vínculo da chegada com o aviso de envio", () => {
  const customer = "BTG Pactual";
  const avulsa = { id: "inb_avulso_1", customer_code: customer, source: "wms_unplanned_receipt" };

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
    assert.equal(receiptLinkProblem({ ...avulsa, status: "checking" }, customer), null);
  });

  it("recusa outro cliente, saída, aviso já decidido, chegada prevista e chegada concluída", () => {
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
      receiptLinkProblem(
        { id: "inb_req-1", customer_code: customer, source: "customer_request", status: "created" },
        customer,
      ),
      "Só a chegada avulsa pode ser vinculada a um aviso.",
    );
    assert.equal(
      receiptLinkProblem({ ...avulsa, status: "received" }, customer),
      "Esta chegada já foi concluída.",
    );
  });

  it("guarda os campos da chegada antes do primeiro vínculo e os devolve ao desvincular", () => {
    const original = { ...avulsa, supplier: "Fornecedor da portaria", invoice_number: "77" };
    const prelink = prelinkFields(original);
    assert.deepEqual(prelink, { supplier: "Fornecedor da portaria", invoice_number: "77" });

    const linked = noticeFields(prelink, { supplier: "Camisaria Alfa", request_number: "ENV-0001" });
    assert.equal(linked.supplier, "Camisaria Alfa");
    assert.equal(linked.invoice_number, "77");
    assert.equal(linked.request_number, "ENV-0001");

    // Trocar de aviso mantém os originais, não os do aviso anterior.
    const relinked = { ...original, ...linked, customer_request_id: "req-1", notice_prelink: prelink };
    assert.deepEqual(prelinkFields(relinked), prelink);

    const unlinked = noticeFields(prelinkFields(relinked));
    assert.equal(unlinked.supplier, "Fornecedor da portaria");
    assert.equal(unlinked.invoice_number, "77");
    assert.ok((unlinked.request_number as FieldValue).isEqual(FieldValue.delete()));
  });
});
