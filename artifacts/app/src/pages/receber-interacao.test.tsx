// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WarehouseTask } from "@/lib/warehouse-ops/model";

const state = vi.hoisted(() => ({ desktop: true, role: "wms", code: "BTG Pactual", tasks: [] as WarehouseTask[], extraGuards: [] as WarehouseTask[], requests: [] as Record<string, unknown>[], create: vi.fn(), toast: vi.fn(), calls: [] as string[] }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: state.role } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: state.code }) }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => state.desktop }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/warehouse-ops/model", async (original) => ({
  ...await original<typeof import("@/lib/warehouse-ops/model")>(),
  fetchJson: async (url: string, options?: RequestInit) => {
    state.calls.push(url);
    if (url === "/api/warehouse/ops") return { queues: { receiving: { key: "receiving", tasks: state.tasks }, putaway: { key: "putaway", tasks: [{ id: "putaway:1", title: "Guardar caixa", status: "planned", box_code: "CX-1", customer: state.code }, ...state.extraGuards] } }, alerts: [] };
    if (url.startsWith("/api/customer-requests?")) return { items: state.requests };
    if (url === "/api/warehouse/receipts") return state.create(JSON.parse(String(options?.body)));
    throw new Error(`API inesperada: ${url}`);
  },
}));
vi.mock("@/features/warehouse-ops/chegada-por-caixa", () => ({ FichaDaChegadaPorCaixa: ({ entry, onBack }: { entry: { task: WarehouseTask }; onBack?: () => void }) => <div><h1>Conferir {entry.task.title}</h1><button onClick={onBack}>Voltar à fila</button><span>{entry.task.can_advance === false ? "Consulta" : "Operação"}</span></div> }));
vi.mock("@/features/warehouse-ops/guarda-da-caixa", () => ({ GuardaDaCaixa: () => <div>Ficha da guarda</div> }));
vi.mock("@/features/warehouse-ops/receiving", () => ({
  ReceivingTaskDetailCard: ({ entry }: { entry: { task: WarehouseTask } }) => <div>Detalhe {entry.task.title} · {entry.task.can_advance === false ? "Consulta" : "Operação"}</div>,
  UnplannedReceiptDialog: ({ open, onCreate, onOpenChange }: { open: boolean; onCreate: (payload: Record<string, unknown>) => Promise<unknown>; onOpenChange: (open: boolean) => void }) => open ? <div role="dialog" aria-label="Chegada avulsa"><button onClick={async () => { try { await onCreate({ customer_code: state.code, idempotency_key: "estavel" }); onOpenChange(false); } catch { /* O diálogo real preserva e mostra o erro. */ } }}>Criar conferência</button></div> : null,
}));
// A mutação/validação do cancelamento tem seus próprios testes. Aqui verificamos a porta da página.
vi.mock("@/features/warehouse-ops/cancelar-recebimento", () => ({ CancelarRecebimentoDialog: ({ task, customerCode }: { task: WarehouseTask | null; customerCode: string }) => task ? <div role="dialog" aria-label="Cancelar recebimento" data-customer={customerCode}>Cancelar {task.title}</div> : null }));
vi.mock("./customer-requests", () => ({ formatRequestAge: () => "Hoje" }));
import Receber from "./receber";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
function buttons(label: string) { return Array.from(container.querySelectorAll("button")).filter((el) => el.textContent === label); }
async function click(label: string, index = 0) { const button = buttons(label)[index]; expect(button, label).toBeDefined(); await act(async () => button!.click()); }
async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 60; i += 1) { if (condition()) return; await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
  expect(condition()).toBe(true);
}
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><Receber /></QueryClientProvider>)); }
const receipt = (id: string, overrides: Partial<WarehouseTask> = {}): WarehouseTask => ({ id: `receiving:${id}`, reference: id, title: id, customer: "BTG Pactual", customer_code: "BTG Pactual", source: "wms_unplanned_receipt", status: "created", conference_mode: "per_box", can_advance: true, ...overrides });
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.desktop = true; state.role = "wms"; state.code = "BTG Pactual"; state.calls = []; state.requests = []; state.extraGuards = [];
  state.tasks = [receipt("inb_avulso_aberto"), receipt("recebido", { status: "received" }), receipt("cancelado", { status: "cancelled", cancellation_reason: "mistake" })];
  state.create.mockReset(); state.toast.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await render(); await waitFor(() => buttons("Conferir").length === 1);
});
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });

describe("fila e bancada do Receber", () => {
  it.each([true, false])("abre a conferência sem fila nem painel lateral (desktop=%s), e volta ao botão de origem", async (desktop) => {
    state.desktop = desktop; await render();
    await click("Conferir");
    expect(container.querySelector('[aria-label="Bancada de conferência"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Para conferir");
    expect(container.textContent).not.toContain("Para guardar");
    expect(container.querySelector("aside")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Voltar à fila");
    expect(container.textContent).toContain("Para conferir");
    expect(container.textContent).toContain("Para guardar");
    expect(document.activeElement).toBe(buttons("Conferir")[0]);
  });

  it("separa recebidas e canceladas e força consulta no histórico mesmo com can_advance legado", async () => {
    await click("Recebidos");
    expect(container.textContent).toContain("recebido");
    expect(container.textContent).not.toContain("cancelado");
    await click("Cancelados");
    expect(container.textContent).toContain("cancelado");
    expect(container.textContent).not.toContain("inb_avulso_aberto");
    expect(buttons("Cancelar recebimento")).toHaveLength(0);
    await click("Ver");
    expect(container.textContent).toContain("Recebimento cancelado");
    expect(container.textContent).toContain("Consulta");
    expect(container.textContent).not.toContain("Operação");
  });

  it("Recebidos separa as chegadas das guardas em dois grupos", async () => {
    state.extraGuards = [{ id: "putaway:guardada", title: "Guardar caixa CX-2", status: "completed", can_advance: false, box_code: "CX-2", customer: "BTG Pactual", location: "B-02" }];
    await act(async () => { await client.invalidateQueries({ queryKey: ["warehouse-ops"] }); });
    await click("Recebidos");
    await waitFor(() => container.textContent?.includes("Guardar caixa CX-2") === true);
    const grupo = (titulo: string) => Array.from(container.querySelectorAll("section")).find((section) => section.querySelector("h2")?.textContent?.startsWith(titulo))!;
    expect(Array.from(container.querySelectorAll("h2")).map((h2) => h2.textContent)).toEqual(["Chegadas1", "Guardas1"]);
    expect(grupo("Chegadas").textContent).toContain("recebido");
    expect(grupo("Chegadas").textContent).not.toContain("Guardar caixa CX-2");
    expect(grupo("Guardas").textContent).toContain("Guardar caixa CX-2");
    expect(grupo("Guardas").textContent).not.toContain("recebido");
  });

  it("preserva chegadas e guardas de todos os clientes e cancela com o dono da tarefa", async () => {
    state.tasks = [...state.tasks, receipt("inb_avulso_itau", { customer: "Itaú", customer_code: "Itaú" })];
    state.extraGuards = [{ id: "putaway:itau", title: "Guardar caixa do Itaú", status: "planned", box_code: "CX-ITAU", customer: "Itaú", customer_code: "Itaú" }];
    await act(async () => { await client.invalidateQueries({ queryKey: ["warehouse-ops"] }); });
    await waitFor(() => container.textContent?.includes("inb_avulso_itau") === true);
    expect(container.textContent).toContain("Guardar caixa CX-ITAU");
    expect(container.textContent).toContain("inb_avulso_aberto");
    const conferir = container.querySelector<HTMLButtonElement>('[data-receipt-id="receiving:inb_avulso_itau"]')!;
    const cancelar = Array.from(conferir.parentElement!.querySelectorAll("button")).find((button) => button.textContent === "Cancelar recebimento")!;
    await act(async () => cancelar.click());
    expect(container.querySelector('[role="dialog"]')?.getAttribute("data-customer")).toBe("Itaú");
    expect(state.code).toBe("BTG Pactual");
  });

  it("suporte consulta a chegada e a guarda sem criar ou cancelar", async () => {
    state.role = "suporte"; await render();
    expect(buttons("Chegada avulsa")).toHaveLength(0);
    expect(buttons("Cancelar recebimento")).toHaveLength(0);
    await click("Ver");
    expect(container.textContent).toContain("Consulta");
  });

  it("mantém avisos e guardas acessíveis na fila", async () => {
    state.requests = [{ id: "aviso", customer_code: "BTG Pactual", type: "recebimento", status: "open", request_number: "ENV-123", supplier: "Fornecedor" }];
    await act(async () => { await client.invalidateQueries({ queryKey: ["customer-requests"] }); });
    await waitFor(() => buttons("Ver").length > 0);
    await click("Ver");
    expect(container.textContent).toContain("Aviso de envio");
    expect(container.textContent).toContain("ENV-123");
    await click("Guardar");
    expect(container.textContent).toContain("Ficha da guarda");
  });

  it("aguarda a criação e refetch, fecha o diálogo e seleciona a nova chegada", async () => {
    let resolve!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await click("Chegada avulsa"); await click("Criar conferência");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    state.tasks = [...state.tasks, receipt("inb_nova")];
    await act(async () => resolve({ receipt_id: "inb_nova", receipt_number: "AVL-1" }));
    await waitFor(() => container.textContent?.includes("Conferir inb_nova") === true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(state.create).toHaveBeenCalledWith({ customer_code: "BTG Pactual", idempotency_key: "estavel" });
  });

  it.each(["success", "error"])("ignora feedback global de criação antiga após trocar cliente (%s)", async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    state.create.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await click("Chegada avulsa"); await click("Criar conferência");
    state.code = "Itaú";
    await render();
    await act(async () => { if (outcome === "success") resolve({ receipt_id: "inb_antiga" }); else reject(new Error("Erro antigo")); });
    expect(state.toast).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Bancada de conferência"]')).toBeNull();
  });

  it("falha de criação mantém diálogo aberto e não seleciona outra chegada", async () => {
    state.create.mockRejectedValue(new Error("Sem conexão"));
    await click("Chegada avulsa"); await click("Criar conferência");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Bancada de conferência"]')).toBeNull();
  });
});
