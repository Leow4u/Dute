// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As fotos na ficha do Estoque (carregamento v2, parte 11): "Adicionar foto"
 * ocupado sem `disabled` (o foco fica no botão), "Salvando no cadastro…" aos
 * 300 ms e falado pelo Anunciador (sem `role="status"` solto), e o "Recolher
 * ficha" que diz que está travado enquanto as fotos sobem. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  envios: [] as Array<() => void>,
  cadastro: [] as Array<() => void>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG Pactual" }, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/features/warehouse-ops/shared", async (original) => ({
  ...(await original<typeof import("@/features/warehouse-ops/shared")>()),
  uploadProductPhoto: (file: File) =>
    new Promise((resolve) => {
      estado.envios.push(() => resolve({ fileName: file.name, fileUrl: `https://example.com/${file.name}`, storagePath: `produtos/${file.name}` }));
    }),
}));

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import type { StockItem } from "@/lib/stock-items";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { BotaoRecolherFicha, ItemCard } from "./estoque";

const ITEM = {
  key: "000001",
  skuCode: "BTG-000001",
  clientCode: "POLO-M-AZ",
  name: "Polo Masculino Piquet Preto",
  detail: "M",
  onHand: 12,
  reserved: 0,
  available: 12,
  locations: [{ id: "A-01-02", qty: 12 }],
  photos: [],
  low: false,
  zero: false,
  sku: {},
} as unknown as StockItem;

function resposta(corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const adicionar = () => Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === "Adicionar foto")!;
const anuncio = () => container!.querySelector("[data-anunciador]")?.textContent ?? "";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.envios = [];
  estado.cadastro = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      if (url.startsWith("/api/catalog/photos") && (init?.method ?? "GET") === "POST") {
        return new Promise<Response>((resolver) => estado.cadastro.push(() => resolver(resposta({ ok: true }))));
      }
      if (url.startsWith("/api/movements")) return resposta({ items: [] });
      if (url.startsWith("/api/warehouse/stock-dates")) return resposta({ locais: [] });
      return resposta({ items: [] });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={client}>
        <Anunciador />
        <ItemCard item={ITEM} caixas={[]} rotuloDaCaixaParada="Parado" />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function escolher() {
  const entrada = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(entrada, "files", { value: [new File(["x"], "foto-1.jpg", { type: "image/jpeg" })], configurable: true });
  await act(async () => {
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("as fotos na ficha do Estoque", () => {
  it("\"Adicionar foto\" fica ocupado sem disabled enquanto as fotos sobem e se registram: o foco fica nele", async () => {
    adicionar().focus();
    await escolher();
    expect(adicionar().getAttribute("aria-disabled")).toBe("true");
    expect(adicionar().hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(adicionar());
    // O clique ocupado não abre a escolha.
    const abrir = vi.spyOn(container!.querySelector<HTMLInputElement>('input[type="file"]')!, "click");
    act(() => adicionar().click());
    expect(abrir).not.toHaveBeenCalled();
  });

  it("\"Salvando no cadastro…\" entra aos 300 ms e o leitor de tela ouve, sem região viva solta", async () => {
    await escolher();
    await act(async () => estado.envios[0]());
    await passar(10);
    expect(estado.cadastro).toHaveLength(1);
    expect(container!.textContent).not.toContain("Salvando no cadastro…");
    await passar(CARREGANDO.atrasoMs);
    expect(container!.textContent).toContain("Salvando no cadastro…");
    // Um anúncio a cada 2 s: o "Enviando 1 foto" acabou de sair, e o "Salvando no cadastro" vem em seguida.
    await passar(2_000);
    expect(anuncio()).toBe("Salvando no cadastro");
    // Só o Anunciador fala.
    expect(container!.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    // As partes da ficha que a espera mudou: o botão, as fotos que sobem e o "Salvando no cadastro…".
    const salvandoNaTela = Array.from(container!.querySelectorAll("p")).find((p) => p.textContent === "Salvando no cadastro…")!;
    const ficha = [adicionar(), container!.querySelector("[data-fotos-enviando]")!, salvandoNaTela].map((no) => no.outerHTML).join("");
    expect(
      textosForaDaLista(ficha, [
        "Adicionar foto",
        "Enviando fotos",
        /^\d$/,
        /^de \d$/,
        /^\d fotos? enviadas?$/,
        "Salvando no cadastro…",
      ]),
    ).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(ficha)).toEqual([]);
  });
});

describe("o X da ficha", () => {
  it("com as fotos subindo, diz que está travado e não recolhe; livre, recolhe", () => {
    const recolher = vi.fn();
    const travado = renderToStaticMarkup(<BotaoRecolherFicha travado onRecolher={recolher} />);
    expect(travado).toContain('aria-disabled="true"');
    expect(travado).not.toContain("disabled=\"\"");
    const livre = renderToStaticMarkup(<BotaoRecolherFicha travado={false} onRecolher={recolher} />);
    expect(livre).not.toContain("aria-disabled");
  });
});
