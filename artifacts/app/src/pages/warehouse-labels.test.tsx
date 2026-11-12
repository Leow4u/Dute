// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAIDA_GUARDADA } from "@/lib/warehouse-labels";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

/**
 * Estoque › Etiquetas (docs/mockups/EtiquetaA4Tela.dc.html): a saída guardada
 * no computador e a do endereço, a paginação de cada saída, a contagem e os
 * textos da tela. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  busca: "",
  navegar: vi.fn(),
  caixas: [] as Record<string, unknown>[],
  posicoes: [] as Record<string, unknown>[],
  linhasDaSessao: [] as Record<string, unknown>[],
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => estado.busca,
  useLocation: () => ["/estoque/etiquetas", estado.navegar],
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: { session_id: "sessao-1", lines: estado.linhasDaSessao }, isLoading: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-volumes-do-pedido", () => ({ useVolumesDoPedido: () => ({ estado: "pronto", pedido: null, volumes: [] }) }));
vi.mock("@/lib/warehouse-ops/model", async (original) => ({
  ...(await original<typeof import("@/lib/warehouse-ops/model")>()),
  fetchJson: async (url: string) => {
    if (url.startsWith("/api/warehouse/boxes?")) return { items: estado.caixas };
    if (url.startsWith("/api/warehouse/positions?")) return { items: estado.posicoes };
    throw new Error(`API inesperada: ${url}`);
  },
}));

import WarehouseLabelsPage from "./warehouse-labels";

/** A caixa da abertura com 16 produtos: no rolo, 2 etiquetas (5 e 11); na folha, 4 (5, 5, 5 e 1). */
const CAIXA_DA_ABERTURA = {
  code: "CX-000226",
  customer_code: "BTG",
  status: "stored",
  location_id: "B-03",
  length_m: 0.5,
  width_m: 0.4,
  height_m: 0.3,
  gross_weight_kg: 8.4,
  unit_count: 136,
  stored_at: "2026-10-22T13:00:00.000Z",
  origin: { kind: "opening_inventory", session_id: "sessao-1" },
};
const DEZESSEIS = Array.from({ length: 16 }, (_, indice) => ({
  box_code: "CX-000226",
  product_name: `Produto ${String(indice + 1).padStart(2, "0")}`,
  client_item_code: `C.${String(indice + 1).padStart(4, "0")}.U`,
  sku_code: `BTG-${String(indice + 1).padStart(6, "0")}`,
  counted_qty: indice + 1,
}));
/** A caixa do recebimento, com o destino confirmado: sai pelo Receber, com a chegada e a NF. */
const CAIXA_DA_CHEGADA = {
  code: "CX-000225",
  customer_code: "BTG",
  status: "committing",
  location_id: "B-09",
  length_m: 0.4,
  width_m: 0.6,
  height_m: 0.35,
  gross_weight_kg: 10,
  unit_count: 0,
  draft_unit_count: 19,
  origin: { kind: "receipt", receipt_id: "inb_7c21a9f0", receipt_number: "AVL-7C21A9F0", invoice_number: "48.377" },
  lines: [
    { inbound_item_id: "i1", line_number: 1, sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 12 },
    { inbound_item_id: "i2", line_number: 2, sku_code: "BTG-000113", client_item_code: "A.01.0713.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG", counted_qty: 7 },
  ],
};
const posicao = (code: string, shelf: number) => ({ code, aisle: code[0], shelf, customer_code: "BTG", length_m: 2.4, depth_m: 1, height_m: 1.8, max_weight_kg: 500 });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function abrir(busca: string) {
  estado.busca = busca;
  await act(async () => root.render(<QueryClientProvider client={client}><WarehouseLabelsPage /></QueryClientProvider>));
  for (let tentativa = 0; tentativa < 60 && !container.querySelector(".lbl-print"); tentativa += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(container.querySelector(".lbl-print"), "a prévia das etiquetas").not.toBeNull();
}

const saida = () => container.querySelector('button[role="combobox"]')?.textContent?.trim();
const contador = () => container.querySelector('button[role="combobox"]')?.closest(".flex-wrap")?.lastElementChild?.textContent;
const etiquetasEm = (seletor: string) => container.querySelectorAll(`${seletor} .lbl[role="group"]`).length;
const cabecalho = () => textosDaTela(container.querySelector(".no-print")!.outerHTML);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  estado.navegar.mockReset();
  estado.caixas = [CAIXA_DA_ABERTURA, CAIXA_DA_CHEGADA];
  estado.posicoes = [posicao("B-01", 1), posicao("B-02", 2)];
  estado.linhasDaSessao = DEZESSEIS;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Estoque › Etiquetas: a saída", () => {
  it("sem saída guardada nem no endereço, abre na folha A4: a caixa de 16 produtos em 4 etiquetas, quatro por folha", async () => {
    await abrir("caixas=CX-000226");
    expect(saida()).toBe("Folha A4");
    expect(container.querySelectorAll(".lbl-folha")).toHaveLength(1);
    expect(etiquetasEm(".lbl-folha")).toBe(4);
    expect(container.querySelector(".lbl-roll")).toBeNull();
    expect(contador()).toBe("4 etiquetas · 1 folha · 1 caixa");
  });

  it("com o rolo guardado neste computador, abre no rolo: as mesmas 16 linhas em 2 etiquetas (5 e 11)", async () => {
    window.localStorage.setItem(SAIDA_GUARDADA, "zebra");
    await abrir("caixas=CX-000226");
    expect(saida()).toBe("Rolo Zebra");
    expect(container.querySelector(".lbl-folha")).toBeNull();
    expect(etiquetasEm(".lbl-roll")).toBe(2);
    expect([...container.querySelectorAll(".lbl-roll .lbl[role=\"group\"]")].map((etiqueta) => etiqueta.querySelectorAll(".lbl-line").length)).toEqual([5, 11]);
    // No rolo não há folha.
    expect(contador()).toBe("2 etiquetas · 1 caixa");
  });

  it("a saída do endereço vale mais que a guardada", async () => {
    window.localStorage.setItem(SAIDA_GUARDADA, "zebra");
    await abrir("caixas=CX-000226&modo=a4");
    expect(saida()).toBe("Folha A4");
    expect(etiquetasEm(".lbl-folha")).toBe(4);
    expect(contador()).toBe("4 etiquetas · 1 folha · 1 caixa");
  });

  it("escolher a saída guarda a escolha no computador e troca o endereço, sem nova entrada no histórico", async () => {
    Element.prototype.scrollIntoView ??= () => undefined;
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    await abrir("caixas=CX-000226");
    const gatilho = container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
    await act(async () => {
      gatilho.focus();
      gatilho.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const rolo = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((opcao) => opcao.textContent === "Rolo Zebra");
    expect(rolo, "a opção Rolo Zebra").toBeDefined();
    await act(async () => {
      rolo!.focus();
      rolo!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(window.localStorage.getItem(SAIDA_GUARDADA)).toBe("zebra");
    expect(estado.navegar).toHaveBeenCalledWith("/estoque/etiquetas?caixas=CX-000226&modo=zebra", { replace: true });
    // A guardada já vale nesta tela, antes do endereço mudar.
    expect(saida()).toBe("Rolo Zebra");
    expect(etiquetasEm(".lbl-roll")).toBe(2);
  });
});

describe("Estoque › Etiquetas: os textos da tela", () => {
  it("pela Contagem: só os rótulos, a saída e a contagem, sem frase de explicação; passa no axe", async () => {
    await abrir("caixas=CX-000226");
    expect(cabecalho()).toEqual(["Contagem", "Etiquetas", "Imprimir / Salvar PDF", "Saída", "Folha A4", "4 etiquetas · 1 folha · 1 caixa"]);
    // Sem o "Pular etiquetas usadas" de antes.
    expect(container.querySelector("input")).toBeNull();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("pelo Receber: a linha de cima diz a chegada, a NF e o cliente; passa no axe", async () => {
    await abrir("caixas=CX-000225&chegada=AVL-7C21A9F0");
    expect(cabecalho()).toEqual(["Receber", "Etiquetas", "Chegada AVL-7C21A9F0 · NF 48.377 · BTG", "Imprimir / Salvar PDF", "Saída", "Folha A4", "1 etiqueta · 1 folha · 1 caixa"]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("pelas Posições: as posições dez por folha em pé, com a contagem delas; passa no axe", async () => {
    await abrir("posicoes=B-01,B-02");
    expect(cabecalho()).toEqual(["Posições", "Etiquetas", "Imprimir / Salvar PDF", "Saída", "Folha A4", "2 etiquetas · 1 folha · 2 posições"]);
    expect(etiquetasEm(".lbl-sheet")).toBe(2);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
