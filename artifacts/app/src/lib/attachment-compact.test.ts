import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_MAX_BYTES,
  AttachmentRejected,
  attachmentDecision,
  buildImagePdf,
  COMPACT_ABOVE_BYTES,
  fitWithin,
  prepareAttachment,
  type CompactDeps,
} from "./attachment-compact";

const MB = 1024 * 1024;

function fakeFile(size: number, type: string, name = "nota.pdf") {
  // File real com o tamanho pedido sem alocar o conteúdo todo para o teste.
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("decisão sobre o anexo", () => {
  it("recusa tipo fora da lista e arquivo vazio ou absurdo", () => {
    expect(attachmentDecision({ type: "text/html", size: 10 })).toBe("reject_type");
    expect(attachmentDecision({ type: "application/pdf", size: 0 })).toBe("reject_size");
    expect(attachmentDecision({ type: "image/jpeg", size: 200 * MB })).toBe("reject_size");
  });

  it("mantém o que já é pequeno e reduz scan de celular acima de 2 MB", () => {
    expect(attachmentDecision({ type: "application/pdf", size: COMPACT_ABOVE_BYTES })).toBe("keep");
    expect(attachmentDecision({ type: "image/jpeg", size: 1.5 * MB })).toBe("keep");
    // A nota da Applicato: 2 páginas fotografadas no iPhone, 9,3 MB.
    expect(attachmentDecision({ type: "application/pdf", size: 9.3 * MB })).toBe("compact");
    expect(attachmentDecision({ type: "image/png", size: 6 * MB })).toBe("compact");
  });

  it("PDF com texto (DANFE do ERP) fica como está até o teto; acima vira imagem", () => {
    expect(attachmentDecision({ type: "application/pdf", size: 5 * MB }, true)).toBe("keep");
    expect(attachmentDecision({ type: "application/pdf", size: ATTACHMENT_MAX_BYTES + 1 }, true)).toBe("compact");
  });
});

describe("escala da página", () => {
  it("cabe no lado maior e nunca amplia", () => {
    expect(fitWithin(1761, 2507)).toBeCloseTo(2000 / 2507, 6);
    expect(fitWithin(2507, 1761)).toBeCloseTo(2000 / 2507, 6);
    expect(fitWithin(800, 600)).toBe(1);
    expect(fitWithin(0, 0)).toBe(1);
  });
});

describe("PDF montado só com as imagens", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

  it("gera um PDF válido com uma página por imagem e xref apontando para os objetos", () => {
    const bytes = buildImagePdf([
      { jpeg, width: 1405, height: 2000 },
      { jpeg, width: 2000, height: 1405 },
    ]);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Type /Pages /Kids [3 0 R 6 0 R] /Count 2");
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain("/Width 1405 /Height 2000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 12");
    // Página em pontos a 200 dpi: 1405 px -> 505,80 pt; 2000 px -> 720,00 pt.
    expect(text).toContain("/MediaBox [0 0 505.80 720.00]");
    expect(text).toContain("/MediaBox [0 0 720.00 505.80]");

    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n /gm)].map((match) => Number(match[1]));
    expect(entries).toHaveLength(8);
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    // O JPEG entra byte a byte, sem recompressão.
    const streamAt = bytes.indexOf(0xff, text.indexOf("/DCTDecode"));
    expect(Array.from(bytes.slice(streamAt, streamAt + jpeg.length))).toEqual(Array.from(jpeg));
  });

  it("recusa montar PDF sem páginas", () => {
    expect(() => buildImagePdf([])).toThrow(/sem páginas/);
  });
});

describe("preparar o anexo antes de subir", () => {
  function deps(overrides: Partial<CompactDeps> = {}): CompactDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      compactImage: async (file) => {
        calls.push("image");
        return fakeFile(600 * 1024, "image/jpeg", file.name.replace(/\.\w+$/, ".jpg"));
      },
      pdfHasText: async () => {
        calls.push("text");
        return false;
      },
      compactPdf: async (file) => {
        calls.push("pdf");
        return fakeFile(1.1 * MB, "application/pdf", file.name);
      },
      ...overrides,
    };
  }

  it("arquivo pequeno sobe como está, sem abrir nada", async () => {
    const d = deps();
    const small = fakeFile(900 * 1024, "application/pdf");
    expect(await prepareAttachment(small, d)).toBe(small);
    expect(d.calls).toEqual([]);
  });

  it("scan de 9,3 MB vira o PDF reduzido", async () => {
    const d = deps();
    const ready = await prepareAttachment(fakeFile(9.3 * MB, "application/pdf", "NF_Applicato.pdf"), d);
    expect(d.calls).toEqual(["text", "pdf"]);
    expect(ready.type).toBe("application/pdf");
    expect(ready.name).toBe("NF_Applicato.pdf");
    expect(ready.size).toBeLessThan(2 * MB);
  });

  it("foto grande vira JPEG reduzido", async () => {
    const d = deps();
    const ready = await prepareAttachment(fakeFile(6 * MB, "image/png", "nota.png"), d);
    expect(d.calls).toEqual(["image"]);
    expect(ready.type).toBe("image/jpeg");
    expect(ready.name).toBe("nota.jpg");
  });

  it("PDF com texto de 5 MB não é rasterizado", async () => {
    const d = deps({ pdfHasText: async () => true });
    const danfe = fakeFile(5 * MB, "application/pdf", "danfe.pdf");
    expect(await prepareAttachment(danfe, d)).toBe(danfe);
  });

  it("se a redução falhar, o original segue quando cabe; acima do teto recusa", async () => {
    const failing = deps({ compactPdf: async () => { throw new Error("PDF protegido"); } });
    const nine = fakeFile(9 * MB, "application/pdf");
    expect(await prepareAttachment(nine, failing)).toBe(nine);
    await expect(prepareAttachment(fakeFile(20 * MB, "application/pdf"), failing)).rejects.toThrow(/até 15 MB/);
  });

  it("se a redução sair maior, fica o original", async () => {
    const d = deps({ compactImage: async (file) => fakeFile(file.size + 1, "image/jpeg") });
    const photo = fakeFile(3 * MB, "image/jpeg");
    expect(await prepareAttachment(photo, d)).toBe(photo);
  });

  it("tipo errado e arquivo absurdo são recusados com motivo", async () => {
    await expect(prepareAttachment(fakeFile(10, "text/plain", "x.txt"), deps())).rejects.toBeInstanceOf(AttachmentRejected);
    await expect(prepareAttachment(fakeFile(200 * MB, "application/pdf"), deps())).rejects.toThrow(/até 15 MB/);
  });
});
