import { describe, expect, it } from "vitest";

import { closedInvoices } from "./billing-insights";
import { countByKind, fileFormat, fileSize, filterPortalDocuments, orderProofs, portalDocuments } from "./portal-documents";

const published = [
  {
    id: "doc-proof",
    customer_visible: true,
    title: "Comprovante de entrega",
    file_name: "canhoto.pdf",
    document_type: "comprovante_entrega",
    reference: "Pedido PED-0042",
    file_url: "https://storage.example/canhoto.pdf",
    size_bytes: 348160,
    signed_at: "2026-10-02T15:00:00Z",
  },
  {
    id: "doc-contract",
    customer_visible: true,
    title: "Contrato de armazenagem 2026",
    file_name: "contrato.pdf",
    document_type: "contrato",
    external_url: "https://drive.example/contrato",
    created_at: "2026-07-30T12:00:00Z",
  },
  {
    id: "doc-nf",
    customer_visible: true,
    title: "NF 2471",
    file_name: "nf.pdf",
    document_type: "nf_entrada",
    storage_path: "portal/btg/nf-2471.pdf",
    file_url: "https://storage.example/nf.pdf",
    created_at: "2026-10-01T12:00:00Z",
  },
  { id: "doc-hidden", customer_visible: false, title: "Interno", document_type: "contrato" },
];

const requests = [
  {
    id: "creq_1",
    request_number: "ENV-0012",
    status: "open",
    supplier: "Uniformes Elegância",
    invoice_number: "2471",
    requested_by_name: "Leonardo Silva",
    created_at: "2026-10-01T10:00:00Z",
    // Já publicado pela Dutelog com o mesmo arquivo: não duplica.
    attachments: [{ file_name: "nf.pdf", file_url: "https://storage.example/nf.pdf", storage_path: "portal/btg/nf-2471.pdf", content_type: "application/pdf" }],
  },
  {
    id: "creq_2",
    request_number: "ENV-0011",
    status: "approved",
    supplier: "Gráfica Alfa",
    invoice_number: "48213",
    requested_by_name: "Cristiane Souza",
    created_at: "2026-09-28T10:00:00Z",
    attachments: [{ file_name: "nf-48213.jpeg", file_url: "https://storage.example/48213.jpg", storage_path: "portal/btg/48213.jpg" }],
  },
  {
    id: "creq_3",
    request_number: "ENV-0013",
    status: "cancelled",
    attachments: [{ file_name: "teste.pdf", file_url: "https://storage.example/teste.pdf" }],
  },
  { id: "creq_4", request_number: "PED-0042", status: "approved" },
];

const invoices = closedInvoices([
  { id: "2026-09", competencia: "2026-09", status: "emitido", total: 23900, emitido_em: "2026-10-01T12:00:00Z" },
  { id: "2026-08", competencia: "2026-08", status: "pago", total: 21400, emitido_em: "2026-09-01T12:00:00Z", pago_em: "2026-09-08T12:00:00Z" },
  { id: "2026-10", competencia: "2026-10", status: "aberto", total: 1 },
]);

describe("documentos do portal", () => {
  const rows = portalDocuments(published, requests, invoices);

  it("junta publicados, notas fiscais dos avisos e faturas fechadas", () => {
    expect(rows.map((row) => row.key)).toEqual([
      "doc:doc-proof",
      "doc:doc-nf",
      "doc:doc-contract",
      "req:creq_2:0",
      "fat:2026-09",
      "fat:2026-08",
    ]);
  });

  it("abre o arquivo pelo file_url ou external_url da projeção", () => {
    expect(rows.find((row) => row.key === "doc:doc-proof")).toMatchObject({
      href: "https://storage.example/canhoto.pdf",
      kind: "comprovante",
      reference: "PED-0042",
      format: "PDF",
      detail: "02/10/2026 · 340 KB",
    });
    expect(rows.find((row) => row.key === "doc:doc-contract")?.href).toBe("https://drive.example/contrato");
  });

  it("nota fiscal anexada mostra o envio e quem mandou", () => {
    expect(rows.find((row) => row.key === "req:creq_2:0")).toMatchObject({
      title: "NF 48213 · Gráfica Alfa",
      reference: "ENV-0011",
      detail: "enviada por Cristiane em 28/09/2026",
      format: "JPG",
      href: "https://storage.example/48213.jpg",
      link: { href: "/portal/recebimentos", label: "Ver envio" },
    });
  });

  it("fatura leva para a página dela", () => {
    const august = rows.find((row) => row.key === "fat:2026-08");
    expect(august?.detail.replace(/\s/g, " ")).toBe("R$ 21.400,00 · paga em 08/09");
    expect(august).toMatchObject({
      title: "Fatura Agosto/2026",
      href: "",
      link: { href: "/portal/faturas/fatura?competencia=2026-08" },
    });
    expect(rows.find((row) => row.key === "fat:2026-09")?.detail.replace(/\s/g, " ")).toBe("R$ 23.900,00 · a pagar");
  });

  it("busca por número de pedido, envio ou NF e filtra por tipo", () => {
    expect(filterPortalDocuments(rows, { search: "ped-0042", kind: "all" }).map((row) => row.key)).toEqual(["doc:doc-proof"]);
    expect(filterPortalDocuments(rows, { search: "ENV-0011", kind: "all" }).map((row) => row.key)).toEqual(["req:creq_2:0"]);
    expect(filterPortalDocuments(rows, { search: "48213", kind: "nf" })).toHaveLength(1);
    expect(filterPortalDocuments(rows, { search: "", kind: "fatura" })).toHaveLength(2);
    expect(countByKind(rows).get("nf")).toBe(2);
  });
});

describe("comprovante no pedido", () => {
  it("acha pelo PED- citado ou pelo id do pedido", () => {
    expect(orderProofs(published, { id: "creq_4", number: "PED-0042" }).map((row) => row.key)).toEqual(["doc:doc-proof"]);
    expect(
      orderProofs([{ ...published[0], reference: "", entity_id: "creq_9" }], { id: "creq_9", number: "#ABC123" }),
    ).toHaveLength(1);
    expect(orderProofs(published, { id: "creq_5", number: "PED-0043" })).toEqual([]);
  });
});

describe("arquivo", () => {
  it("formato e tamanho", () => {
    expect(fileFormat("foto.jpeg")).toBe("JPG");
    expect(fileFormat("", "application/pdf")).toBe("PDF");
    expect(fileSize(1258291)).toBe("1,2 MB");
    expect(fileSize(undefined)).toBe("");
  });
});
