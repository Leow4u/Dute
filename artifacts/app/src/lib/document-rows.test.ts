import { describe, expect, it } from "vitest";

import { buildDocumentRows, documentsListUrl, matchesDocumentFilters, type DocumentRow } from "./document-rows";

describe("a lista de documentos por papel", () => {
  it("o financeiro pede só os de faturamento; a regra nega a lista sem o filtro", () => {
    expect(documentsListUrl("financeiro")).toBe("/api/documents?entity_type=fatura&limit=500");
    for (const role of ["owner", "admin", "interno", "wms", "suporte", undefined]) {
      expect(documentsListUrl(role)).toBe("/api/documents?limit=500");
    }
  });
});

const documents = [
  {
    _docId: "d1",
    title: "Contrato BTG 2026",
    file_name: "contrato.pdf",
    document_type: "contrato",
    customer_visible: false,
    visibility: "internal",
    created_at: { seconds: Date.parse("2026-07-30T12:00:00Z") / 1000 },
    file_url: "https://x/contrato",
  },
  {
    _docId: "d2",
    title: "Comprovante P-0128",
    document_type: "comprovante_entrega",
    reference: "Pedido P-0128",
    customer_visible: true,
    created_at: "2026-09-27T12:00:00Z",
    storage_path: "docs/btg/comp.jpg",
  },
  { _docId: "d3", title: "Antigo", document_type: "outro", archived: true, status: "archived" },
];

const requests = [
  {
    id: "creq_1",
    created_at: "2026-09-29T12:00:00Z",
    supplier: "Fornecedor X",
    invoice_number: "48213",
    requested_by: { name: "Cristiane" },
    attachments: [
      { file_name: "NF 48213.pdf", file_url: "https://x/nf", storage_path: "uploads/nf.pdf" },
      { file_name: "já guardado", storage_path: "docs/btg/comp.jpg" },
    ],
  },
  { id: "creq_2", attachments: [] },
];

function filter(rows: DocumentRow[], overrides: Partial<Parameters<typeof matchesDocumentFilters>[1]> = {}) {
  return rows
    .filter((row) => matchesDocumentFilters(row, { search: "", kind: "all", audience: "all", ...overrides }))
    .map((row) => row.title);
}

describe("lista de documentos", () => {
  const rows = buildDocumentRows(documents, requests);

  it("junta documentos e anexos do aviso de chegada, do mais recente ao mais antigo", () => {
    expect(rows.map((row) => row.title)).toEqual([
      "NF 48213.pdf",
      "Comprovante P-0128",
      "Contrato BTG 2026",
      "Antigo",
    ]);
  });

  it("o anexo vem da BTG, vinculado ao aviso e não pode ser alterado", () => {
    const nf = rows[0];
    expect(nf).toMatchObject({
      source: "request",
      audience: "btg",
      kind: "nf",
      origin: "Enviado por Cristiane no aviso de chegada",
      linkedTo: "Aviso de chegada · Fornecedor X · NF 48213",
      href: "https://x/nf",
    });
    expect(nf.documentId).toBeUndefined();
  });

  it("anexo que já virou documento não aparece duas vezes", () => {
    expect(rows.filter((row) => row.title === "já guardado")).toEqual([]);
  });

  it("quem vê: interno, BTG e arquivado", () => {
    expect(rows.find((row) => row.documentId === "d1")?.audience).toBe("internal");
    expect(rows.find((row) => row.documentId === "d2")?.audience).toBe("btg");
    expect(rows.find((row) => row.documentId === "d3")?.audience).toBe("archived");
  });
});

describe("filtros", () => {
  const rows = buildDocumentRows(documents, requests);

  it("arquivado só aparece quando pedido", () => {
    expect(filter(rows)).not.toContain("Antigo");
    expect(filter(rows, { audience: "archived" })).toEqual(["Antigo"]);
  });

  it("por tipo, por quem vê e por busca", () => {
    expect(filter(rows, { kind: "nf" })).toEqual(["NF 48213.pdf"]);
    expect(filter(rows, { audience: "internal" })).toEqual(["Contrato BTG 2026"]);
    expect(filter(rows, { search: "p-0128" })).toEqual(["Comprovante P-0128"]);
  });
});

describe("situação no Conhecimento do Agent", () => {
  it("lê o status gravado pela extração e pela aprovação", () => {
    const state = (document: Record<string, unknown>) =>
      buildDocumentRows([{ _docId: "x", title: "x", ...document }], [])[0].knowledge;
    expect(state({})).toBe("none");
    expect(state({ content_extraction_status: "pending_visual_ocr" })).toBe("reading");
    expect(state({ knowledge_status: "pending_approval", knowledge_id: "k" })).toBe("pending");
    expect(state({ knowledge_status: "active", knowledge_id: "k" })).toBe("active");
    expect(state({ knowledge_status: "rejected" })).toBe("rejected");
  });
});
