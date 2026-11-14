// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

const api = vi.hoisted(() => ({ cancelar: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/wms/cancelar-recebimento", async (original) => ({
  ...await original<typeof import("@/lib/wms/cancelar-recebimento")>(), cancelarRecebimento: api.cancelar,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: api.toast }) }));
import { CancelarRecebimentoDialog } from "./cancelar-recebimento";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const task: WarehouseTask = { id: "receiving:inb_avulso_duplo", reference: "inb_avulso_duplo", customer: "CLIENTE-A", source: "wms_unplanned_receipt", status: "created", receipt_number: "AVL-DUPLO", invoice_number: "046143", quantity: 71 };
const original: WarehouseTask = { ...task, id: "receiving:inb_original", reference: "inb_original", receipt_number: "AVL-ORIGINAL", status: "received" };
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const closed = vi.fn();
const cancelled = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.cancelar.mockReset().mockResolvedValue({ ok: true, receipt_id: task.reference, status: "cancelled" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); client.clear(); host.remove(); });

async function render(selected: WarehouseTask | null = task, customerCode = "CLIENTE-A") {
  await act(async () => root.render(<QueryClientProvider client={client}><CancelarRecebimentoDialog task={selected} receipts={[task, original, { ...original, id: "receiving:outro", reference: "outro", customer: "CLIENTE-B", receipt_number: "OUTRO-CLIENTE" }]} customerCode={customerCode} onOpenChange={closed} onCancelled={cancelled} /></QueryClientProvider>));
}
// O BotaoDeAcao (carregamento v2, parte 13c) empilha as camadas: o rótulo é o da camada atual.
function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => (element.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? element.textContent)?.trim() === text,
  )!;
}
async function select(id: string, value: string) {
  await act(async () => { const input = document.getElementById(id) as HTMLSelectElement; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function fillNote(value: string) {
  await act(async () => { const input = document.getElementById("cancelar-observacao")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
// Cada envio um segundo depois do anterior: o BotaoDeAcao ignora o segundo toque dentro de 1 s (o toque único).
async function submit() { vi.setSystemTime(Date.now() + 1_100); await act(async () => button("Cancelar recebimento").click()); }

describe("confirmação de cancelamento", () => {
  it("identifica a chegada e só oferece originais do cliente, com textos e acessibilidade", async () => {
    await render();
    expect(document.body.textContent).toContain("AVL-DUPLO");
    expect(document.body.textContent).not.toContain("OUTRO-CLIENTE");
    expect(textosForaDaLista(document.body.innerHTML, [
      "Cancelar recebimento?", "AVL-DUPLO · NF 046143 · 71 unidades", "Motivo", "Duplicado", "Lançamento incorreto", "Outro",
      "Recebimento original", "Selecione o recebimento", "AVL-ORIGINAL · NF 046143 · 71 un.", "Observação", "Voltar", "Cancelar recebimento", "Cancelando…", "Conferir", "Fechar",
      "Este recebimento sai da fila e permanece no histórico.", "O recebimento original será mantido.",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(document.body.innerHTML)).toEqual([]);
  });

  it("exige a original para duplicidade e não envia observação vazia", async () => {
    await render(); await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Selecione o recebimento original.");
    expect(api.cancelar).not.toHaveBeenCalled();
    await select("cancelar-original", "inb_original"); await submit();
    expect(api.cancelar).toHaveBeenCalledWith({ receipt_id: "inb_avulso_duplo", customer_code: "CLIENTE-A", expected_status: "created", reason: "duplicate", duplicate_of_receipt_id: "inb_original", idempotency_key: expect.any(String) });
    expect(cancelled).toHaveBeenCalledWith("inb_avulso_duplo");
  });

  it("preserva os dados e a mesma chave depois de uma falha", async () => {
    api.cancelar.mockRejectedValueOnce(new Error("Falha de conexão."));
    await render(); await select("cancelar-original", "inb_original"); await fillNote("  Lançado duas vezes.  "); await submit();
    expect(cancelled).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Falha de conexão.");
    expect((document.getElementById("cancelar-observacao") as HTMLTextAreaElement).value).toBe("  Lançado duas vezes.  ");
    await submit();
    expect(api.cancelar.mock.calls[0]![0]).toEqual(api.cancelar.mock.calls[1]![0]);
    expect(api.cancelar.mock.calls[0]![0].note).toBe("Lançado duas vezes.");
  });

  it("impede envio duplicado e fechamento enquanto está pendente", async () => {
    let done!: (value: unknown) => void;
    api.cancelar.mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    await render(); await select("cancelar-original", "inb_original");
    await act(async () => { const action = button("Cancelar recebimento"); action.click(); action.click(); });
    expect(api.cancelar).toHaveBeenCalledTimes(1);
    await act(async () => button("Fechar").click());
    expect(closed).not.toHaveBeenCalled();
    // O diálogo fica: o Esc não fecha, e o Voltar e o confirmar ficam ocupados, não desabilitados (parte 13c).
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(closed).not.toHaveBeenCalled();
    expect(button("Voltar").getAttribute("aria-disabled")).toBe("true");
    expect(button("Voltar").disabled).toBe(false);
    expect(button("Cancelar recebimento").getAttribute("aria-disabled")).toBe("true");
    expect(button("Cancelar recebimento").disabled).toBe(false);
    await act(async () => done({ ok: true, receipt_id: task.reference, status: "cancelled" }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("outro motivo exige observação e não carrega a original de duplicidade", async () => {
    await render(); await select("cancelar-original", "inb_original"); await select("cancelar-motivo", "other"); await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Informe o motivo na observação.");
    await fillNote("  Entrega desistida.  "); await submit();
    expect(api.cancelar.mock.calls[0]![0]).toMatchObject({ reason: "other", note: "Entrega desistida." });
    expect(api.cancelar.mock.calls[0]![0]).not.toHaveProperty("duplicate_of_receipt_id");
  });

  it("uma resposta antiga não fecha outra chegada nem transmite o rascunho", async () => {
    let done!: (value: unknown) => void;
    api.cancelar.mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    await render(); await select("cancelar-original", "inb_original"); await fillNote("Da chegada anterior"); await submit();
    await render({ ...task, id: "receiving:inb_avulso_novo", reference: "inb_avulso_novo" });
    expect((document.getElementById("cancelar-observacao") as HTMLTextAreaElement).value).toBe("");
    await act(async () => done({ ok: true, receipt_id: task.reference, status: "cancelled" }));
    expect(cancelled).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
  });

  it("não abre sem uma chegada selecionada", async () => { await render(null); expect(document.querySelector('[role="dialog"]')).toBeNull(); });
});
