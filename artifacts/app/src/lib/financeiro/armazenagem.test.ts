import { describe, expect, it } from "vitest";

import { acaoDaArmazenagem } from "./armazenagem";

/** A ação de pagamento no Faturamento do WMS (parte 7.2c). Dados sintéticos. */

const NF = "fat_0123456789abcdef01234567";

describe("o pagamento da armazenagem", () => {
  it("sem o Financeiro, a emitida se marca como paga no WMS", () => {
    expect(acaoDaArmazenagem("emitido", null, "financeiro", false)).toEqual({ tipo: "pagar_no_wms" });
    expect(acaoDaArmazenagem("aberto", null, "financeiro", false)).toBeNull();
    expect(acaoDaArmazenagem("pago", null, "financeiro", false)).toBeNull();
  });

  it("com o Financeiro, a emitida leva ao A faturar e a que está numa NF, à NF", () => {
    expect(acaoDaArmazenagem("emitido", null, "financeiro", true)).toEqual({ tipo: "abrir_no_financeiro", href: "/financeiro/a-faturar", rotulo: "Faturar no Financeiro" });
    expect(acaoDaArmazenagem("emitido", NF, "admin", true)).toEqual({ tipo: "abrir_no_financeiro", href: `/financeiro/nf?nf=${NF}`, rotulo: "Ver a NF no Financeiro" });
    expect(acaoDaArmazenagem("pago", NF, "owner", true)).toEqual({ tipo: "abrir_no_financeiro", href: `/financeiro/nf?nf=${NF}`, rotulo: "Ver a NF no Financeiro" });
    expect(acaoDaArmazenagem("pago", null, "financeiro", true)).toBeNull();
    expect(acaoDaArmazenagem("aberto", null, "financeiro", true)).toBeNull();
  });

  it("com o Financeiro, quem não o abre não paga nem ganha o link", () => {
    expect(acaoDaArmazenagem("emitido", null, "suporte", true)).toBeNull();
    expect(acaoDaArmazenagem("emitido", NF, "suporte", true)).toBeNull();
  });
});
