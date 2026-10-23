import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import type { AgentAttachment } from "./agent-attachments.js";
import { bancoFalso } from "./agente-banco-falso.test.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { anexosDaMensagem, lerNotaAnexada, TAMANHO_MAXIMO_DA_NOTA, type LerNota } from "./agente-nota.js";

/**
 * A nota fiscal anexada pelo cliente (parte 5.5h). As regras da leitura são
 * cópias literais do WMS, travadas aqui arquivo por arquivo: a mesma nota dá
 * o mesmo contexto ao modelo e o mesmo cartão nos dois agentes. Só o cliente
 * anexa, na Armazenagem, da pasta dele; a leitura só lê, pelo leitor do
 * cliente. Dados sintéticos.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("as cópias do WMS", () => {
  it("a leitura da nota e os anexos são os arquivos do WMS, letra por letra", () => {
    assert.equal(read("../../src/domain/invoice-reading.ts"), read("../../../wms/src/domain/invoice-reading.ts"));
    assert.equal(read("../../src/domain/agent-attachments.ts"), read("../../../wms/src/domain/agent-attachments.ts"));
  });

  it("o esquema da extração é o do WMS", () => {
    const bloco = (fonte: string) => fonte.match(/const InvoiceExtractionSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0];
    const doNucleo = bloco(read("../../src/domain/agente-nota.ts"));
    assert.ok(doNucleo);
    assert.equal(doNucleo, bloco(read("../../../wms/src/index.ts")));
  });

  it("o maior arquivo lido é o do WMS", () => {
    assert.match(read("../../../wms/src/index.ts"), /DOCUMENT_VISUAL_OCR_MAX_BYTES \?\? 14 \* 1024 \* 1024/);
    assert.equal(TAMANHO_MAXIMO_DA_NOTA, 14 * 1024 * 1024);
  });
});

const nota = (extra: Partial<AgentAttachment> = {}): AgentAttachment => ({
  file_name: "NF 2471.pdf",
  file_url: "https://storage.test/nf.pdf",
  storage_path: "operational-documents/ITAU/envios/nf-2471.pdf",
  content_type: "application/pdf",
  size_bytes: 120_000,
  ...extra,
});

const recusa = (codigo: string) => (erro: unknown) => erro instanceof HttpsError && erro.code === codigo;

describe("quem anexa a nota", () => {
  const cliente = { audiencia: "cliente" as const, modulo: "wms" as const, customerCode: "ITAU" };

  it("só o cliente, na Armazenagem, e só da pasta dele", () => {
    assert.deepEqual(anexosDaMensagem({ ...cliente, audiencia: "equipe" }, []), []);
    assert.deepEqual(anexosDaMensagem(cliente, [nota()]), [nota()]);
    assert.throws(() => anexosDaMensagem({ ...cliente, audiencia: "equipe" }, [nota()]), recusa("permission-denied"));
    assert.throws(() => anexosDaMensagem({ ...cliente, modulo: "operacao" }, [nota()]), recusa("failed-precondition"));
    assert.throws(() => anexosDaMensagem(cliente, [nota(), nota({ storage_path: "operational-documents/SAFRA/nf.pdf" })]), recusa("permission-denied"));
    assert.throws(() => anexosDaMensagem(cliente, [nota({ storage_path: "operational-documents/ITAU/../SAFRA/nf.pdf" })]), recusa("permission-denied"));
  });
});

describe("a leitura da nota", () => {
  const { db } = bancoFalso({
    client_inventory: {
      i1: { customer_code: "ITAU", sku_code: "ITAU-000001", client_item_code: "POLO-M", product_name: "Camisa polo manga curta M" },
      s1: { customer_code: "SAFRA", sku_code: "SAFRA-000001", client_item_code: "CAL-42", product_name: "Calça social 42" },
    },
  });
  const leitor = leitorDoAgente(db, { customerCode: "ITAU", audiencia: "cliente", leValor: true });
  const escopo = { customerCode: "ITAU" };

  function leitura(saida: unknown, registro: string[] = []): LerNota {
    return {
      baixar: async (caminho) => {
        registro.push(caminho);
        return Buffer.from("pdf");
      },
      extrair: async () => ({ saida, modelo: "teste", tokens_entrada: 900, tokens_saida: 80, latencia_ms: 12 }),
    };
  }

  const lida = {
    supplier: "Confecções Exemplo Ltda",
    invoice_number: "000.002.471",
    issue_date: "2026-10-20",
    volumes: "2 CAIXA",
    items: [
      { supplier_code: "POLO-M", description: "CAMISA POLO M", quantity: 30, unit: "UN" },
      { supplier_code: "X9", description: "Calça social 42", quantity: 5, unit: "PC" },
    ],
  };

  it("casa os itens com o estoque do próprio cliente e registra o uso", async () => {
    const caminhos: string[] = [];
    const { contexto, uso } = await lerNotaAnexada(leitor, escopo, [nota({ content_type: "text/csv" }), nota()], leitura(lida, caminhos));
    assert.deepEqual(caminhos, ["operational-documents/ITAU/envios/nf-2471.pdf"]);
    assert.match(contexto, /^\[Nota fiscal anexada pela pessoa: "NF 2471\.pdf"/);
    assert.match(contexto, /Fornecedor: Confecções Exemplo Ltda\nNF: 2471\nEmissão: 2026-10-20\nObservações da nota: Volumes: 2 CAIXA · NF emitida em 20\/10\/2026/);
    assert.match(contexto, /- código do fornecedor POLO-M \| CAMISA POLO M \| 30 UN \| no estoque como POLO-M \(Camisa polo manga curta M\)/);
    // A calça é de outro cliente: não casa.
    assert.match(contexto, /- código do fornecedor X9 \| Calça social 42 \| 5 PC \| não encontrado no estoque/);
    assert.deepEqual(uso, { source: "leitura_nota_chat", model: "teste", input_tokens: 900, output_tokens: 80, latency_ms: 12, items_read: 2, error: null });
  });

  it("sem nota legível, nada; sem a leitura, o arquivo grande ou o modelo fora, o agente pede os dados", async () => {
    const caminhos: string[] = [];
    assert.deepEqual(await lerNotaAnexada(leitor, escopo, [nota({ content_type: "text/csv" })], leitura(lida, caminhos)), { contexto: "", uso: null });
    assert.deepEqual(caminhos, []);

    const semLeitura = `[A pessoa anexou o arquivo "NF 2471.pdf", mas não consegui ler a nota. Peça fornecedor, número da NF, itens e quantidades.]`;
    assert.deepEqual(await lerNotaAnexada(leitor, escopo, [nota()], undefined), { contexto: semLeitura, uso: null });

    let extraiu = false;
    const grande: LerNota = { baixar: async () => Buffer.alloc(TAMANHO_MAXIMO_DA_NOTA + 1), extrair: async () => ((extraiu = true), { saida: lida, modelo: "teste", latencia_ms: 1 }) };
    assert.deepEqual(await lerNotaAnexada(leitor, escopo, [nota()], grande), { contexto: semLeitura, uso: null });
    assert.equal(extraiu, false);

    const foraDoAr: LerNota = { baixar: async () => Buffer.from("pdf"), extrair: async () => Promise.reject(new Error("teste: fora do ar")) };
    assert.deepEqual(await lerNotaAnexada(leitor, escopo, [nota()], foraDoAr), { contexto: semLeitura, uso: null });

    // O caminho de outro cliente nunca é baixado, mesmo que chegue aqui.
    assert.deepEqual(await lerNotaAnexada(leitor, escopo, [nota({ storage_path: "operational-documents/SAFRA/nf.pdf" })], leitura(lida, caminhos)), { contexto: semLeitura, uso: null });
    assert.deepEqual(caminhos, []);
  });
});
