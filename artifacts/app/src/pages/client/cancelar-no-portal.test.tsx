// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

/**
 * Cancelar o pedido e o aviso de envio, no portal (carregamento v2, parte
 * 13f; necessidade 5). Antes: o botão girava o Loader2 e ficava `disabled`
 * (o foco caía no `body`), sem dizer "Cancelando…", e o "Manter" seguia
 * ativo durante o cancelamento. Agora o `BotaoDeAcao` diz o gerúndio aos
 * 300 ms, com `aria-busy`, e o "Manter" fica `aria-disabled`, com a trava no
 * código. Dados sintéticos.
 */

const dados = vi.hoisted(() => ({ overview: {} as Record<string, unknown>, cancelamentos: [] as Array<(ok: boolean) => void> }));

vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => ReactNode }) => children(dados.overview),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "c1", publicMetadata: { role: "cliente", customer_code: "ACME" } }, isLoaded: true }),
}));

import { ClienteEnvios } from "./envios";
import { ClientePedidos } from "./pedidos";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dados.cancelamentos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((pronto) =>
          dados.cancelamentos.push((ok) => pronto(new Response(JSON.stringify(ok ? {} : { message: "Não deu." }), { status: ok ? 200 : 409 }))),
        ),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`A tela não chegou ao estado esperado em 3 s: ${container.textContent}`);
    await espera(20);
  }
}

async function montar(tela: ReactNode) {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Router>{tela}</Router>
      </QueryClientProvider>,
    ),
  );
}

/** O botão pelo rótulo; o botão de ação, pela camada que está na tela. */
function botao(rotulo: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

async function conferirCancelamento(confirmar: string, pergunta: string) {
  await act(async () => botao(confirmar)!.click());
  await ate(() => container.textContent?.includes(pergunta));
  const confirmacao = botao(confirmar)!;
  confirmacao.focus();
  await act(async () => confirmacao.click());
  expect(dados.cancelamentos).toHaveLength(1);
  // O segundo toque, no meio, não cancela de novo.
  await act(async () => confirmacao.click());
  expect(dados.cancelamentos).toHaveLength(1);
  await ate(() => botao("Cancelando…"));
  const andando = botao("Cancelando…")!;
  expect(andando.hasAttribute("disabled")).toBe(false);
  expect(andando.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(andando);
  expect(andando.querySelector("[data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector(".animate-spin")).toBeNull();
  // O "Manter" fica travado no código, sem disabled: o toque não fecha a pergunta.
  const manter = botao("Manter")!;
  expect(manter.getAttribute("aria-disabled")).toBe("true");
  expect(manter.hasAttribute("disabled")).toBe(false);
  await act(async () => manter.click());
  expect(container.textContent).toContain(pergunta);
  expect(textosDaTela(container.innerHTML)).toEqual(expect.arrayContaining(["Cancelando…", "Manter"]));
  expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  // Na falha, o "Manter" volta a responder.
  await act(async () => dados.cancelamentos[0]!(false));
  await ate(() => botao("Manter")?.getAttribute("aria-disabled") !== "true");
}

describe("Cancelar no portal", () => {
  it("o pedido: 'Cancelando…' no botão, sem desabilitar, e o Manter travado", async () => {
    dados.overview = {
      request_history: [
        {
          id: "creq_1",
          type: "retirada",
          request_number: "PED-0001",
          title: "Uniformes",
          status: "open",
          created_at: "2026-11-04T12:00:00Z",
          items: [{ client_item_code: "POLO-M", product_name: "Polo M", quantity: 3 }],
        },
      ],
      order_tracking: [],
    };
    await montar(<ClientePedidos />);
    await conferirCancelamento("Cancelar pedido", "Cancelar PED-0001?");
  });

  it("o aviso de envio: 'Cancelando…' no botão, sem desabilitar, e o Manter travado", async () => {
    dados.overview = {
      customer: { code: "ACME" },
      requests: [
        {
          id: "creq_2",
          type: "recebimento",
          request_number: "ENV-0001",
          title: "Envio de Fornecedor",
          supplier: "Fornecedor",
          status: "open",
          created_at: "2026-11-04T12:00:00Z",
          items: [{ client_item_code: "POLO-M", product_name: "Polo M", quantity: 3 }],
        },
      ],
    };
    await montar(<ClienteEnvios />);
    await conferirCancelamento("Cancelar aviso", "Cancelar este aviso?");
  });
});

const PEDIDO = {
  request_history: [
    {
      id: "creq_1",
      type: "retirada",
      request_number: "PED-0001",
      title: "Uniformes",
      status: "open",
      created_at: "2026-11-04T12:00:00Z",
      items: [{ client_item_code: "POLO-M", product_name: "Polo M", quantity: 3 }],
    },
  ],
  order_tracking: [],
};

const AVISO = {
  customer: { code: "ACME" },
  requests: [
    {
      id: "creq_2",
      type: "recebimento",
      request_number: "ENV-0001",
      title: "Envio de Fornecedor",
      supplier: "Fornecedor",
      status: "open",
      created_at: "2026-11-04T12:00:00Z",
      items: [{ client_item_code: "POLO-M", product_name: "Polo M", quantity: 3 }],
    },
  ],
};

describe("Cancelar no portal, o tempo e o foco (revisão da parte 13f)", () => {
  it("o Manter não pisca quando o cancelamento responde antes de 300 ms: travado no toque, esmaecido só com o gerúndio", async () => {
    dados.overview = PEDIDO;
    await montar(<ClientePedidos />);
    await act(async () => botao("Cancelar pedido")!.click());
    await ate(() => container.textContent?.includes("Cancelar PED-0001?"));
    await act(async () => botao("Cancelar pedido")!.click());
    await ate(() => botao("Manter")?.getAttribute("aria-disabled") === "true");
    const manter = botao("Manter")!;
    let esmaeceu = manter.className.includes("opacity-45");
    await act(async () => dados.cancelamentos[0]!(false));
    for (let vez = 0; vez < 10; vez += 1) {
      await espera(40);
      esmaeceu ||= (botao("Manter")?.className ?? "").includes("opacity-45");
    }
    expect(esmaeceu).toBe(false);
    expect(botao("Manter")!.hasAttribute("aria-disabled")).toBe(false);
  });

  for (const [tela, overview, gatilho, pergunta] of [
    ["o pedido", PEDIDO, "Cancelar pedido", "Cancelar PED-0001?"],
    ["o aviso de envio", AVISO, "Cancelar aviso", "Cancelar este aviso?"],
  ] as const) {
    it(`${tela}: ao abrir, o foco vai ao Manter, no grupo com a pergunta; o Manter e o sucesso devolvem o foco ao gatilho, nunca ao body`, async () => {
      dados.overview = overview;
      await montar(tela === "o pedido" ? <ClientePedidos /> : <ClienteEnvios />);
      const abrir = botao(gatilho)!;
      abrir.focus();
      await act(async () => abrir.click());
      const manter = botao("Manter")!;
      expect(document.activeElement).toBe(manter);
      const grupo = manter.closest<HTMLElement>('[role="group"]')!;
      expect(document.getElementById(grupo.getAttribute("aria-labelledby")!)?.textContent).toBe(pergunta);
      // No celular, as ações da linha têm 48 px.
      expect(manter.className).toContain("max-md:min-h-12");
      expect(botao(gatilho)!.className).toContain("max-md:min-h-12");
      expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);

      await act(async () => manter.click());
      expect(document.activeElement?.textContent).toBe(gatilho);
      expect(document.activeElement).not.toBe(document.body);
      // O gatilho de texto tem o toque estendido a 48 px no celular, sem mudar a linha.
      expect(document.activeElement!.className).toContain("max-md:before:-inset-y-4");

      await act(async () => botao(gatilho)!.click());
      const confirmar = botao(gatilho)!;
      confirmar.focus();
      await act(async () => confirmar.click());
      await act(async () => dados.cancelamentos[0]!(true));
      await ate(() => !container.textContent?.includes(pergunta));
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.textContent).toBe(gatilho);
    });
  }
});
