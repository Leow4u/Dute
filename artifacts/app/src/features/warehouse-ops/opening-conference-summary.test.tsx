import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpeningConferenceSummary } from "./opening-conference-summary";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { OpeningConferenceLine } from "@/lib/opening-conference";
const props = { busy: false, onEdit: () => {}, onRemove: () => {}, onReview: () => {}, onReopen: () => {}, onResume: () => {} };
const line: OpeningConferenceLine = { id: "line-1", status: "pending", product_name: "Camisa", client_item_code: "CAM-G", size: "G", counted_qty: 4, unit_cost: 20 };
describe("resumo da caixa física", () => {
  it("permite revisar e corrigir antes de guardar", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} box={warehouseBoxFromRecord({ code: "CX-000001", status: "counting" })} lines={[line]} />);
    expect(html).toContain("Conteúdo da caixa CX-000001");
    expect(html).toContain("tamanho G");
    expect(html).toContain("Editar");
    expect(html).toContain("Revisar e fechar caixa");
    expect(html).not.toContain("Retomar guarda");
  });
  it("a revisão fechada exige reabrir antes de editar", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} box={warehouseBoxFromRecord({ code: "CX-000001", status: "reviewed" })} lines={[line]} />);
    expect(html).toContain("Reabrir conferência");
    expect(html).not.toContain(">Editar<");
    expect(html).not.toContain("Remover rascunho");
  });
  it("retoma falha sem expor edição de uma linha já publicada", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} box={warehouseBoxFromRecord({ code: "CX-000001", status: "committing" })} lines={[{ ...line, status: "committed" }, { ...line, id: "line-2", product_name: "Polo", status: "failed", error: "Revise o código" }]} />);
    expect(html).toContain("Retomar guarda");
    expect(html).toContain("Já publicada");
    expect(html).toContain("Revise o código");
    expect(html).toContain("Remover rascunho de Polo");
    expect(html).not.toContain("Remover rascunho de Camisa");
  });
});
