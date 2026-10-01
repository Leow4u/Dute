import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeOperationalDocument, decodeShipmentAttachment, OPERATIONAL_DOCUMENT_MAX_BYTES, receivedSummary, SHIPMENT_ATTACHMENT_MAX_BYTES, storageFailure } from "./domain/client-shipments.js";

describe("quanto chegou de verdade", () => {
  it("soma avisado e conferido e lista só as linhas que divergiram", () => {
    const summary = receivedSummary([
      { client_item_code: "A.01.0594.005.P", product_name: "POLO", expected_qty: 100, received_qty: 100 },
      { client_item_code: "A.01.0594.005.M", product_name: "POLO", expected_qty: 20, received_qty: 18 },
      { sku_code: "SKU-9", product_name: "CANECA", expected_qty: 5, received_qty: 6 },
    ]);
    assert.deepEqual(summary, {
      qty_expected: 125,
      qty_received: 124,
      received_differences: [
        { code: "A.01.0594.005.M", name: "POLO", expected: 20, received: 18 },
        { code: "SKU-9", name: "CANECA", expected: 5, received: 6 },
      ],
    });
  });

  it("não publica nada interno da linha", () => {
    const summary = receivedSummary([
      { client_item_code: "X", expected_qty: 1, received_qty: 0, ...({ location_id: "R1", unit_cost: 9 } as object) },
    ]);
    assert.deepEqual(Object.keys(summary.received_differences[0]).sort(), ["code", "expected", "name", "received"]);
  });
});

describe("anexo do aviso gravado pelo backend", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n").toString("base64");

  it("aceita PDF e foto de verdade, com ou sem prefixo data:", () => {
    assert.equal(decodeShipmentAttachment({ content_type: "application/pdf", data_base64: pdf }).buffer.length, 17);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64");
    const decoded = decodeShipmentAttachment({ content_type: "IMAGE/JPEG", data_base64: `data:image/jpeg;base64,${jpeg}` });
    assert.equal(decoded.contentType, "image/jpeg");
    assert.equal(decoded.buffer[0], 0xff);
  });

  it("recusa tipo fora da lista, conteúdo que não confere, vazio e acima de 8 MB", () => {
    assert.throws(() => decodeShipmentAttachment({ content_type: "text/html", data_base64: pdf }), /PDF ou foto/);
    assert.throws(() => decodeShipmentAttachment({ content_type: "image/png", data_base64: pdf }), /não confere/);
    assert.throws(() => decodeShipmentAttachment({ content_type: "application/pdf", data_base64: "" }), /vazio/);
    assert.throws(() => decodeShipmentAttachment({ content_type: "application/pdf", data_base64: "<script>" }), /corrompido/);
    const big = Buffer.alloc(SHIPMENT_ATTACHMENT_MAX_BYTES + 1);
    big.write("%PDF-");
    assert.throws(
      () => decodeShipmentAttachment({ content_type: "application/pdf", data_base64: big.toString("base64") }),
      /até 8 MB/,
    );
  });
});

describe("falha do Storage com mensagem que diz o que fazer", () => {
  it("403 do Storage (conta das Functions sem papel) aponta o papel que falta", () => {
    const denied = Object.assign(
      new Error("912453685006-compute@developer.gserviceaccount.com does not have storage.objects.create access to the Google Cloud Storage object."),
      { code: 403 },
    );
    const gravar = storageFailure(denied, "gravar");
    assert.equal(gravar.code, "failed-precondition");
    assert.match(gravar.message, /roles\/storage\.objectCreator/);
    assert.match(storageFailure({ code: 403, message: "Forbidden" }, "ler").message, /roles\/storage\.objectViewer/);
  });

  it("arquivo sumido e falha passageira não viram erro interno genérico", () => {
    assert.equal(storageFailure({ code: 404, message: "No such object" }, "ler").code, "not-found");
    assert.equal(storageFailure(new Error("socket hang up"), "gravar").code, "unavailable");
  });
});

describe("documento interno gravado pelo backend", () => {
  it("aceita PDF real, planilha e texto; recusa tipo fora da lista e PDF falso", () => {
    const pdf = Buffer.from("%PDF-1.4 contrato").toString("base64");
    assert.equal(decodeOperationalDocument({ content_type: "application/pdf", data_base64: pdf }).contentType, "application/pdf");
    const xlsx = Buffer.from("PK\u0003\u0004planilha").toString("base64");
    assert.equal(
      decodeOperationalDocument({
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data_base64: xlsx,
      }).buffer.length,
      12,
    );
    assert.equal(decodeOperationalDocument({ content_type: "text/csv", data_base64: Buffer.from("a;b").toString("base64") }).buffer.length, 3);
    assert.throws(() => decodeOperationalDocument({ content_type: "application/x-msdownload", data_base64: pdf }), /não permitido/);
    assert.throws(() => decodeOperationalDocument({ content_type: "application/pdf", data_base64: xlsx }), /não confere/);
  });

  it("aceita até 20 MB", () => {
    const big = Buffer.alloc(OPERATIONAL_DOCUMENT_MAX_BYTES + 1);
    big.write("%PDF-");
    assert.throws(
      () => decodeOperationalDocument({ content_type: "application/pdf", data_base64: big.toString("base64") }),
      /até 20 MB/,
    );
  });
});
