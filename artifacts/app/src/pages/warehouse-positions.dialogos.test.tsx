// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Os diálogos de Posições que gravam (carregamento v2, parte 13a): "Nova rua"
 * e "Remover a posição" seguram o diálogo enquanto o servidor responde. O
 * Esc, o toque fora, o X e o Cancelar não fecham, o Cancelar e o X ficam
 * aria-disabled, e o confirmar é o BotaoDeAcao, nunca disabled. Depois de
 * remover, a linha que abriu a confirmação sai da tabela, e o foco vai ao
 * título da página, nunca ao body. Dados sintéticos.
 */

type Pendente = { caminho: string; corpo: Record<string, unknown>; responder: (corpo: unknown, status?: number) => void };

const estado = vi.hoisted(() => ({
  toast: vi.fn(),
  posicoes: [] as Array<Record<string, unknown>>,
  pendentes: [] as Pendente[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: estado.toast }) }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/posicoes", () => undefined] }));

import WarehousePositionsPage from "./warehouse-positions";

function posicao(rua: string, n: number) {
  return { code: `${rua}-0${n}`, aisle: rua, shelf: n, length_m: 1.8, depth_m: 0.75, height_m: 0.65, capacity_boxes: 3, status: "active", customer_code: "BTG", sequence: n, occupied_boxes: 0 };
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/warehouse/positions" && metodo === "GET") return resposta({ items: estado.posicoes });
  if (url.pathname === "/api/customers") return resposta({ items: [{ id: "c1", code: "BTG", name: "BTG Pactual", status: "active", modules: ["armazenagem"] }] });
  if (metodo === "POST") {
    return new Promise<Response>((resolver) =>
      estado.pendentes.push({
        caminho: url.pathname,
        corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responder: (corpo, status = 200) => resolver(resposta(corpo, status)),
      }),
    );
  }
  throw new Error(`API inesperada: ${metodo} ${url.pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

/** O botão pelo rótulo: o texto inteiro, o aria-label ou a camada atual do BotaoDeAcao. */
function botao(rotulo: string, dentro: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function tentarFechar() {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  });
  for (const rotulo of ["Fechar", "Cancelar"]) {
    const elemento = botao(rotulo, dialogo()!);
    if (elemento) await act(async () => elemento.click());
  }
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.toast.mockReset();
  estado.pendentes.length = 0;
  estado.posicoes = [posicao("A", 1), posicao("A", 2), posicao("A", 3)];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <main>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
          <WarehousePositionsPage />
        </QueryClientProvider>
      </main>,
    );
  });
  await esperar(() => Boolean(botao("Remover A-03")), "as posições na tabela");
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Nova rua, gravando", () => {
  it("o Esc, o toque fora, o X e o Cancelar não fecham; o Cancelar e o X ficam aria-disabled e o foco fica no Cadastrar rua", async () => {
    await act(async () => botao("Nova rua")!.click());
    await esperar(() => Boolean(dialogo()), "o diálogo da nova rua");
    await digitar("aisle-code", "D");
    await digitar("aisle-shelves", "2");
    const confirmar = botao("Cadastrar rua", dialogo()!)!;
    confirmar.focus();
    await act(async () => confirmar.click());
    await esperar(() => estado.pendentes.length === 1, "a rua enviada");
    await esperar(() => confirmar.getAttribute("aria-disabled") === "true", "o Cadastrar rua travado");

    await tentarFechar();
    expect(dialogo()).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    for (const rotulo of ["Fechar", "Cancelar"]) {
      expect(botao(rotulo, dialogo()!)!.getAttribute("aria-disabled"), rotulo).toBe("true");
      expect(botao(rotulo, dialogo()!)!.disabled, rotulo).toBe(false);
    }
    expect(confirmar.disabled).toBe(false);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);

    await act(async () => estado.pendentes[0].responder({ created: ["D-01", "D-02"], updated: [] }));
    await esperar(() => !dialogo(), "o diálogo fechado no sucesso");
    expect(estado.toast).toHaveBeenCalledWith({ title: "Rua cadastrada: 2 prateleiras" });
  });

  it("o rodapé só tem os rótulos e as camadas do botão", async () => {
    await act(async () => botao("Nova rua")!.click());
    await esperar(() => Boolean(dialogo()), "o diálogo da nova rua");
    const rodape = dialogo()!.querySelector("[data-rodape-do-dialogo]")!;
    expect(textosForaDaLista(rodape.outerHTML, ["Cancelar", "Cadastrar rua", "Cadastrando…", "Conferir"])).toEqual([]);
  });
});

describe("Remover a posição, gravando", () => {
  it("o Esc e o Cancelar não fecham; no fim, a linha sai e o foco vai ao título, nunca ao body", async () => {
    const gatilho = botao("Remover A-03")!;
    gatilho.focus();
    await act(async () => gatilho.click());
    await esperar(() => Boolean(dialogo()), "a confirmação");
    await act(async () => botao("Remover", dialogo()!)!.click());
    await esperar(() => estado.pendentes.length === 1, "a remoção enviada");
    // O isPending chega à tela no tique seguinte ao toque.
    await esperar(() => Boolean(dialogo()?.hasAttribute("data-ocupado")), "a confirmação ocupada");

    await tentarFechar();
    expect(dialogo()).not.toBeNull();
    expect(botao("Cancelar", dialogo()!)!.getAttribute("aria-disabled")).toBe("true");

    estado.posicoes = estado.posicoes.filter((item) => item.code !== "A-03");
    await act(async () => estado.pendentes[0].responder({ ok: true, code: "A-03" }));
    await esperar(() => !dialogo() && !botao("Remover A-03"), "a confirmação fechada e a linha fora");
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 20));
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("H1");
  });
});
