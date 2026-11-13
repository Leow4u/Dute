// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

/**
 * As Etiquetas na migração do carregamento v2 (parte 13b; diagnóstico, 4.7 e
 * necessidades 2 e 3). Antes de ler, a contagem não diz "0 etiquetas · 0
 * folhas". A leitura que falha mostra o aviso com "Tentar de novo"; a
 * releitura que falha (depois de registrar a impressão) não tira a prévia da
 * tela. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 0,
  falha: false,
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "caixas=CX-000225",
  useLocation: () => ["/estoque/etiquetas", () => undefined],
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: { session_id: "sessao-1", lines: [] }, isLoading: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-volumes-do-pedido", () => ({ useVolumesDoPedido: () => ({ estado: "pronto", pedido: null, volumes: [] }) }));
vi.mock("@/lib/warehouse-ops/model", async (original) => ({
  ...(await original<typeof import("@/lib/warehouse-ops/model")>()),
  fetchJson: async (url: string) => {
    await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
    if (estado.falha) throw new Error("Falha no servidor");
    if (url.startsWith("/api/warehouse/boxes?")) return { items: [CAIXA] };
    throw new Error(`API inesperada: ${url}`);
  },
}));

import WarehouseLabelsPage from "./warehouse-labels";

const CAIXA = {
  code: "CX-000225",
  customer_code: "BTG",
  status: "stored",
  location_id: "B-09",
  length_m: 0.4,
  width_m: 0.6,
  height_m: 0.35,
  unit_count: 19,
  origin: { kind: "receipt", receipt_id: "inb_7c21a9f0", receipt_number: "AVL-7C21A9F0", invoice_number: "48.377" },
  lines: [{ inbound_item_id: "i1", line_number: 1, sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 19 }],
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const botao = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.atrasoMs = 0;
  estado.falha = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

async function abrir() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Anunciador />
        <WarehouseLabelsPage />
      </QueryClientProvider>,
    ),
  );
}

describe("Estoque › Etiquetas: a espera", () => {
  it("antes de ler, a contagem não diz 0 etiquetas nem 0 folhas; depois, a contagem lida", async () => {
    estado.atrasoMs = 700;
    await abrir();
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 100));
    });
    expect(naTela()).not.toMatch(/\b0 etiquetas|\b0 folhas/);
    expect(textosDaTela(container.querySelector(".no-print")!.outerHTML)).toEqual(["Contagem", "Etiquetas", "Imprimir / Salvar PDF", "Saída", "Folha A4"]);
    // Aos 300 ms, a caixa com o rótulo no lugar da prévia, e o anúncio.
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 250));
    });
    expect(naTela()).toContain("Carregando as etiquetas…");
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    await esperar(() => Boolean(container.querySelector(".lbl-print")), "a prévia");
    expect(naTela()).toContain("1 etiqueta · 1 folha · 1 caixa");
  });

  it("a leitura que falha: o aviso com Tentar de novo; a nova tentativa traz a prévia", async () => {
    estado.falha = true;
    await abrir();
    await esperar(() => naTela().includes("Não consegui carregar as etiquetas."), "o aviso da falha");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    estado.falha = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => Boolean(container.querySelector(".lbl-print")), "a prévia depois da nova tentativa");
  });

  it("a releitura que falha não tira a prévia da tela", async () => {
    await abrir();
    await esperar(() => Boolean(container.querySelector(".lbl-print")), "a prévia");
    estado.falha = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["warehouse-boxes"] });
    });
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 50));
    });
    expect(container.querySelector(".lbl-print")).not.toBeNull();
    expect(naTela()).not.toMatch(/Não foi possível montar|Não consegui carregar as etiquetas/);
  });
});
