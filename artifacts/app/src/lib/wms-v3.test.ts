import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TELAS_DO_WMS_NA_V3, telaDoWmsNaV3 } from "./wms-v3";

/** As telas da Armazenagem na v3 (parte 4.7): a lista e o caminho que entra nela. */

describe("telas do WMS na v3", () => {
  it("a tela entra pelo caminho exato, sem a busca; a tela dentro de outra entra por si", () => {
    const telas = ["/dashboard", "/estoque"];
    expect(telaDoWmsNaV3("/dashboard", telas)).toBe(true);
    expect(telaDoWmsNaV3("/estoque?item=SKU-1#historico", telas)).toBe(true);
    expect(telaDoWmsNaV3("/estoque/mapa", telas)).toBe(false);
    expect(telaDoWmsNaV3("/estoques", telas)).toBe(false);
    expect(telaDoWmsNaV3("/pedidos", telas)).toBe(false);
  });

  it("as telas na v3, na ordem da pergunta 18, e a tela nova dos alertas (parte 5.4e)", () => {
    expect(TELAS_DO_WMS_NA_V3).toEqual(["/dashboard", "/pedidos", "/estoque", "/wms/receber", "/estoque/alertas"]);
  });

  it("o layout do WMS usa a lista", () => {
    const fonte = readFileSync(new URL("../components/layout/wms-layout.tsx", import.meta.url), "utf8");
    expect(fonte).toContain("conteudoV3={telaDoWmsNaV3(location)}");
  });
});
