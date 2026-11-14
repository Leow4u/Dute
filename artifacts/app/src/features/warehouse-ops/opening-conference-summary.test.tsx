// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpeningConferenceSummary } from "./opening-conference-summary";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { OpeningConferenceLine } from "@/lib/opening-conference";
const props = { busy: false, resuming: false, onEdit: () => {}, onRemove: () => {}, onReview: () => {}, onReopen: () => {}, onResume: () => {} };
const line: OpeningConferenceLine = { id: "line-1", status: "pending", product_name: "Camisa", client_item_code: "CAM-G", size: "G", counted_qty: 4, unit_cost: 20 };
describe("resumo da caixa física", () => {
  it("permite revisar e corrigir antes de guardar", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} box={warehouseBoxFromRecord({ code: "CX-000001", status: "counting" })} lines={[line]} />);
    expect(html).toContain("Conteúdo da caixa CX-000001");
    expect(html).toContain("Camisa · G");
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

  /** Antes, o ícone girava com o formulário sujo, sem nenhuma operação (decisão 6 de 06/11/2026). */
  it("desligado por outra coisa, o Retomar guarda não gira: espera com aria-disabled, sem disabled (parte 13b)", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} busy box={warehouseBoxFromRecord({ code: "CX-000001", status: "committing" })} lines={[{ ...line, status: "failed" }]} />);
    const retomar = botaoDe(html, "Retomar guarda");
    expect(retomar.getAttribute("data-estado")).toBe("repouso");
    expect(retomar.getAttribute("aria-disabled")).toBe("true");
    expect(retomar.hasAttribute("disabled")).toBe(false);
    expect(html).not.toContain("data-spinner");
    expect(html).not.toContain("animate-spin");
  });

  it("retomando, o Retomar guarda é o BotaoDeAcao em andamento (\"Retomando guarda…\"), sem disabled", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} resuming box={warehouseBoxFromRecord({ code: "CX-000001", status: "committing" })} lines={[{ ...line, status: "failed" }]} />);
    const retomar = botaoDe(html, "Retomar guarda");
    expect(retomar.getAttribute("data-estado")).toBe("andamento");
    expect(retomar.textContent).toContain("Retomando guarda…");
    expect(retomar.getAttribute("aria-disabled")).toBe("true");
    expect(retomar.hasAttribute("disabled")).toBe(false);
  });

  it("reabrindo, o Reabrir conferência é o BotaoDeAcao em andamento (\"Reabrindo…\"), sem disabled (parte 13b)", () => {
    const html = renderToStaticMarkup(<OpeningConferenceSummary {...props} busy reabrindo box={warehouseBoxFromRecord({ code: "CX-000001", status: "reviewed" })} lines={[line]} />);
    const reabrir = botaoDe(html, "Reabrir conferência");
    expect(reabrir.getAttribute("data-estado")).toBe("andamento");
    expect(reabrir.textContent).toContain("Reabrindo…");
    expect(reabrir.hasAttribute("disabled")).toBe(false);
  });
});

function botaoDe(html: string, rotulo: string): HTMLButtonElement {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const achado = Array.from(documento.querySelectorAll("button")).find(
    (botao) => (botao.querySelector('[data-camada="repouso"]') ?? botao).textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`Sem o botão ${rotulo}`);
  return achado as HTMLButtonElement;
}
