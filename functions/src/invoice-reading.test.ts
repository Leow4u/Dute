import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertOwnInvoicePath, matchInvoiceItems, sanitizeInvoiceReading } from "./domain/invoice-reading.js";

describe("arquivo da nota", () => {
  it("só lê arquivo da pasta do próprio cliente", () => {
    assert.equal(
      assertOwnInvoicePath("operational-documents/BTG_Pactual/2026-10/123-nf.pdf", "BTG Pactual"),
      "operational-documents/BTG_Pactual/2026-10/123-nf.pdf",
    );
    assert.throws(() => assertOwnInvoicePath("operational-documents/Outro/2026-10/nf.pdf", "BTG Pactual"));
    assert.throws(() => assertOwnInvoicePath("operational-documents/BTG_Pactual/../Outro/nf.pdf", "BTG Pactual"));
    assert.throws(() => assertOwnInvoicePath("billing/BTG_Pactual/x.pdf", "BTG Pactual"));
  });
});

describe("o que a IA devolveu", () => {
  it("normaliza números brasileiros e descarta linhas sem quantidade ou descrição", () => {
    const reading = sanitizeInvoiceReading({
      supplier: " Gráfica Alfa Ltda ",
      invoice_number: "Nº 48213",
      issue_date: "2026-09-28",
      items: [
        { supplier_code: "CAM-G", description: "CAMISETA BASICA G", quantity: "1.200,00", unit: "UN" },
        { supplier_code: "X", description: "", quantity: 3 },
        { supplier_code: "Y", description: "FRETE", quantity: 0 },
        "lixo",
      ],
    });
    assert.deepEqual(reading, {
      supplier: "Gráfica Alfa Ltda",
      invoice_number: "48213",
      issue_date: "2026-09-28",
      notes: "NF emitida em 28/09/2026",
      items: [{ supplier_code: "CAM-G", description: "CAMISETA BASICA G", quantity: 1200, unit: "UN" }],
    });
    assert.deepEqual(sanitizeInvoiceReading(null), { supplier: "", invoice_number: "", issue_date: "", notes: "", items: [] });
  });

  it("DANFE real: número sem zeros e pontos, volumes e transporte nas observações", () => {
    const reading = sanitizeInvoiceReading({
      supplier: "Uniformes Elegância Confecções LTDA",
      invoice_number: "000.002.471",
      issue_date: "2026-06-26",
      volumes: "2 CAIXA",
      carrier: "Transporte próprio por conta do remetente",
      items: [{ supplier_code: "BAT101", description: "BLUSA MOLETOM ABERTA - PRETO XT - GG", quantity: 8, unit: "UN" }],
    });
    assert.equal(reading.invoice_number, "2471");
    assert.equal(reading.notes, "Volumes: 2 CAIXA · Transporte: Transporte próprio por conta do remetente · NF emitida em 26/06/2026");
    assert.equal(sanitizeInvoiceReading({ invoice_number: "PED-7781" }).invoice_number, "PED-7781");
  });
});

describe("casar com o estoque", () => {
  const catalog = [
    { client_item_code: "A.01.0114.004.G", sku_code: "S1", product_name: "CAMISETA" },
    { client_item_code: "A.01.0114.004.GG", sku_code: "S2", product_name: "CAMISETA" },
    { client_item_code: "K.0101.001.U", sku_code: "S3", product_name: "CANECA TERMICA 500 ML" },
  ];

  it("pelo código quando o fornecedor usa o código da BTG", () => {
    const [item] = matchInvoiceItems([{ supplier_code: "a.01.0114.004.gg", description: "Camiseta", quantity: 10, unit: "UN" }], catalog);
    assert.deepEqual(item.match, { client_item_code: "A.01.0114.004.GG", sku_code: "S2", product_name: "CAMISETA", by: "codigo" });
  });

  it("pelo nome só sem dúvida; tamanhos com o mesmo nome ficam para a pessoa", () => {
    const [caneca, camiseta, outro] = matchInvoiceItems(
      [
        { supplier_code: "77", description: "Caneca térmica 500 ml", quantity: 5, unit: "UN" },
        { supplier_code: "88", description: "Camiseta", quantity: 5, unit: "UN" },
        { supplier_code: "99", description: "Ecobag lona natural", quantity: 5, unit: "UN" },
      ],
      catalog,
    );
    assert.equal(caneca.match?.client_item_code, "K.0101.001.U");
    assert.equal(caneca.match?.by, "nome");
    assert.equal(camiseta.match, null);
    assert.equal(outro.match, null);
  });
});
