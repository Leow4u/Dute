import { describe, expect, it } from "vitest";

import { edicao } from "@/test/eventos-necton";

import { documentosDoCliente, ehPlanilha, linhaDoDocumento, problemaDoAnexo, tipoDoArquivo } from "./anexos";
import { TAMANHO_DO_DOCUMENTO } from "./arquivos";
import type { DocumentoView } from "./tipos";

/**
 * O layout e a planilha que o cliente anexa à edição
 * (docs/mockups/EventosPortalNovo.dc.html): a recusa antes de subir, com o
 * nome do arquivo, a linha de cada documento e a separação entre o layout e a
 * planilha. O .xlsx chega sem tipo em alguns Windows: vale a extensão.
 */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function documento(extra: Partial<DocumentoView>): DocumentoView {
  return {
    id: "an_0000000000000001",
    caminho: "portal/BTG/eventos/ced_0123456789abcdef/an_0000000000000001.pdf",
    nome: "layout-necton-2027.pdf",
    tipo: "application/pdf",
    tamanho: 1_258_291,
    origem: "cliente",
    momento_id: null,
    registrado_por: null,
    registrado_em: null,
    ...extra,
  };
}

describe("os anexos do cliente", () => {
  it("problemaDoAnexo: 10 MiB passa, 10 MiB + 1 byte e o .docx recusam com o nome, e o 21.º documento recusa", () => {
    expect(problemaDoAnexo({ name: "produtos.xlsx", type: XLSX, size: TAMANHO_DO_DOCUMENTO }, 0)).toBeNull();
    expect(problemaDoAnexo({ name: "produtos.xlsx", type: XLSX, size: TAMANHO_DO_DOCUMENTO + 1 }, 0)).toBe("produtos.xlsx: O documento passa de 10 MB.");
    expect(problemaDoAnexo({ name: "lista.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1000 }, 0)).toBe(
      "lista.docx: Use PDF, imagem ou planilha (.xlsx).",
    );
    expect(problemaDoAnexo({ name: "layout.pdf", type: "application/pdf", size: 1000 }, 19)).toBeNull();
    expect(problemaDoAnexo({ name: "layout.pdf", type: "application/pdf", size: 1000 }, 20)).toBe("A edição já tem 20 documentos.");
    // O .xlsx sem tipo (alguns Windows) vale pela extensão.
    expect(problemaDoAnexo({ name: "Produtos.XLSX", type: "", size: 1000 }, 0)).toBeNull();
    expect(tipoDoArquivo({ name: "Produtos.XLSX", type: "" })).toBe(XLSX);
    expect(tipoDoArquivo({ name: "foto.jpeg", type: "" })).toBe("image/jpeg");
    expect(tipoDoArquivo({ name: "sem-extensao", type: "" })).toBe("");
  });

  it("documentosDoCliente separa o PDF da planilha e ignora o da Dutelog; linhaDoDocumento dá 'layout-necton-2027.pdf · 1,2 MB'", () => {
    const pdf = documento({});
    const planilha = documento({ id: "an_0000000000000002", nome: "produtos-b2b-conference.xlsx", tipo: XLSX, tamanho: 519_168 });
    const daDutelog = documento({ id: "dc_0000000000000003", nome: "romaneio.pdf", origem: "dutelog" });
    const separados = documentosDoCliente(edicao({ documentos: [pdf, planilha, daDutelog] }));
    expect(separados.layout.map((item) => item.id)).toEqual([pdf.id]);
    expect(separados.planilhas.map((item) => item.id)).toEqual([planilha.id]);
    expect(ehPlanilha(planilha)).toBe(true);
    expect(ehPlanilha(pdf)).toBe(false);
    expect(linhaDoDocumento(pdf)).toBe("layout-necton-2027.pdf · 1,2 MB");
    expect(linhaDoDocumento(planilha)).toBe("produtos-b2b-conference.xlsx · 507 KB");
    expect(documentosDoCliente(null)).toEqual({ layout: [], planilhas: [] });
  });
});
