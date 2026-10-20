import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AgentAttachmentSchema, attachmentsForDraft, invoiceContext } from "./domain/agent-attachments.js";

const nota = {
  file_name: "nf-2471.pdf",
  file_url: "https://storage.example/nf-2471.pdf",
  storage_path: "operational-documents/BTG_Pactual/chat/nf-2471.pdf",
  content_type: "application/pdf",
  size_bytes: 1200,
};

describe("nota anexada no chat do Agent Dute", () => {
  it("a leitura vira contexto para o agente, com o que está no estoque e o que não está", () => {
    const text = invoiceContext("nf-2471.pdf", {
      supplier: "Gráfica Alfa",
      invoice_number: "2471",
      issue_date: "2026-10-01",
      notes: "2 CAIXA",
      items: [
        { supplier_code: "A.01.0594.005.P", description: "POLO P", quantity: 120, unit: "UN", match: { client_item_code: "A.01.0594.005.P", product_name: "POLO" } },
        { supplier_code: "", description: "Sacola kraft", quantity: 300, unit: "PC", match: null },
      ],
    });
    assert.match(text, /Fornecedor: Gráfica Alfa/);
    assert.match(text, /NF: 2471/);
    assert.match(text, /120 UN \| no estoque como A\.01\.0594\.005\.P/);
    assert.match(text, /sem código \| Sacola kraft \| 300 PC \| não encontrado no estoque/);
    assert.match(text, /rascunho_envio/);
  });

  it("sem leitura, o agente pede os dados", () => {
    assert.match(invoiceContext("foto.jpg", null), /não consegui ler a nota/);
  });

  it("o aviso leva a nota desta mensagem ou da última que trouxe anexo", () => {
    const outra = { ...nota, file_name: "antiga.pdf" };
    const history = [
      { role: "user", attachments: [outra] },
      { role: "assistant" },
      { role: "user", attachments: [nota] },
      { role: "user" },
    ];
    assert.deepEqual(attachmentsForDraft(undefined, history), [nota]);
    assert.deepEqual(attachmentsForDraft([outra], history), [outra]);
    assert.deepEqual(attachmentsForDraft([], [{ role: "user" }]), []);
  });

  it("anexo precisa ter forma de arquivo enviado", () => {
    assert.equal(AgentAttachmentSchema.safeParse(nota).success, true);
    assert.equal(AgentAttachmentSchema.safeParse({ ...nota, file_url: "não é url" }).success, false);
  });
});
