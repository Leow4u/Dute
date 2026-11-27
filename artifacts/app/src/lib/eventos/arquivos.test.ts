import { describe, expect, it } from "vitest";

import {
  TAMANHO_DA_FOTO,
  TAMANHO_DO_DOCUMENTO,
  TIPOS_DE_DOCUMENTO,
  TIPOS_DE_FOTO,
  caminhoDoArquivoDaEdicao,
  nomeDoArquivo,
  problemaDoArquivoDaEdicao,
} from "./arquivos";

/**
 * Os arquivos da edição do evento no navegador (eventos, parte 3): o nome que
 * o storage.rules aceita, os três caminhos e a recusa antes de subir. As
 * telas das partes 4, 8 e 11 sobem pelo SDK com estes nomes.
 */

const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EDICAO = "ced_0123456789abcdef";
const BYTES = () => new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]);

describe("o nome do arquivo da edição", () => {
  it("o prefixo, 16 hex e a extensão do tipo: jpeg vira jpg e a planilha, xlsx", () => {
    expect(nomeDoArquivo("ft", "image/jpeg", () => new Uint8Array(8))).toBe("ft_0000000000000000.jpg");
    expect(nomeDoArquivo("dc", "application/pdf", BYTES)).toBe("dc_deadbeef00010203.pdf");
    expect(nomeDoArquivo("an", PLANILHA, BYTES)).toBe("an_deadbeef00010203.xlsx");
    expect(nomeDoArquivo("ft", "image/png", BYTES)).toBe("ft_deadbeef00010203.png");
    expect(nomeDoArquivo("dc", "image/webp", BYTES)).toBe("dc_deadbeef00010203.webp");
    expect(nomeDoArquivo("an", "application/pdf")).toMatch(/^an_[a-f0-9]{16}\.pdf$/);
  });

  it("o tipo que não sobe não tem nome: a foto só imagem, e nada de gif, html ou executável", () => {
    expect(nomeDoArquivo("ft", "application/pdf", BYTES)).toBeNull();
    expect(nomeDoArquivo("ft", PLANILHA, BYTES)).toBeNull();
    expect(nomeDoArquivo("dc", "image/gif", BYTES)).toBeNull();
    expect(nomeDoArquivo("an", "text/html", BYTES)).toBeNull();
    expect(nomeDoArquivo("an", "application/x-msdownload", BYTES)).toBeNull();
  });
});

describe("o caminho do arquivo da edição", () => {
  it("os três caminhos do storage.rules: a foto e o documento da Dutelog, e o anexo do cliente", () => {
    expect(caminhoDoArquivoDaEdicao("foto", "BTG Pactual", EDICAO, "ft_0123456789abcdef.jpg")).toBe(
      "eventos/BTG Pactual/ced_0123456789abcdef/fotos/ft_0123456789abcdef.jpg",
    );
    expect(caminhoDoArquivoDaEdicao("documento", "BTG Pactual", EDICAO, "dc_0123456789abcdef.xlsx")).toBe(
      "eventos/BTG Pactual/ced_0123456789abcdef/docs/dc_0123456789abcdef.xlsx",
    );
    expect(caminhoDoArquivoDaEdicao("anexo", "BTG Pactual", EDICAO, "an_0123456789abcdef.pdf")).toBe(
      "portal/BTG Pactual/eventos/ced_0123456789abcdef/an_0123456789abcdef.pdf",
    );
  });
});

describe("a recusa antes de subir", () => {
  it("a foto: JPG, PNG ou WebP, abaixo de 8 MB (8 MB exatos recusam, como a regra)", () => {
    expect(problemaDoArquivoDaEdicao({ type: "image/jpeg", size: 8 * 1024 * 1024 }, "foto")).toBe("A foto passa de 8 MB.");
    expect(problemaDoArquivoDaEdicao({ type: "image/webp", size: 8 * 1024 * 1024 - 1 }, "foto")).toBeNull();
    expect(problemaDoArquivoDaEdicao({ type: "application/pdf", size: 100 }, "foto")).toBe("Use foto JPG, PNG ou WebP.");
    expect(problemaDoArquivoDaEdicao({ type: "image/gif", size: 100 }, "foto")).toBe("Use foto JPG, PNG ou WebP.");
  });

  it("o documento: PDF, imagem ou planilha, até 10 MB (10 MB exatos sobem)", () => {
    expect(problemaDoArquivoDaEdicao({ type: PLANILHA, size: 10 * 1024 * 1024 }, "documento")).toBeNull();
    expect(problemaDoArquivoDaEdicao({ type: "image/png", size: 100 }, "documento")).toBeNull();
    expect(problemaDoArquivoDaEdicao({ type: "application/pdf", size: 10 * 1024 * 1024 + 1 }, "documento")).toBe("O documento passa de 10 MB.");
    expect(problemaDoArquivoDaEdicao({ type: "application/x-msdownload", size: 100 }, "documento")).toBe("Use PDF, imagem ou planilha (.xlsx).");
    expect(problemaDoArquivoDaEdicao({ type: "", size: 100 }, "documento")).toBe("Use PDF, imagem ou planilha (.xlsx).");
  });

  it("os tipos e os tamanhos são os do storage.rules", () => {
    expect([...TIPOS_DE_FOTO]).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect([...TIPOS_DE_DOCUMENTO]).toEqual(["image/jpeg", "image/png", "image/webp", "application/pdf", PLANILHA]);
    expect(TAMANHO_DA_FOTO).toBe(8 * 1024 * 1024);
    expect(TAMANHO_DO_DOCUMENTO).toBe(10 * 1024 * 1024);
  });
});
