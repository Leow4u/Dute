import { describe, expect, it } from "vitest";

import { ATTACHMENT_ACCEPT, isAcceptedAttachment } from "./shipment-files";

function fakeFile(size: number, type: string) {
  const file = new File([new Uint8Array(1)], "nota.pdf", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("escolha do anexo na tela", () => {
  it("aceita a nota escaneada no celular (9,3 MB) para ser reduzida antes de subir", () => {
    expect(isAcceptedAttachment(fakeFile(9.3 * 1024 * 1024, "application/pdf"))).toBe(true);
    expect(isAcceptedAttachment(fakeFile(14 * 1024 * 1024, "image/jpeg"))).toBe(true);
  });

  it("recusa na hora o que não é PDF ou imagem, vazio ou absurdo", () => {
    expect(isAcceptedAttachment(fakeFile(10, "text/csv"))).toBe(false);
    expect(isAcceptedAttachment(fakeFile(0, "application/pdf"))).toBe(false);
    expect(isAcceptedAttachment(fakeFile(200 * 1024 * 1024, "application/pdf"))).toBe(false);
  });

  it("o input de arquivo aceita os mesmos tipos", () => {
    expect(ATTACHMENT_ACCEPT).toBe("application/pdf,image/jpeg,image/png,image/webp");
  });
});
