// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O aviso de envio do portal enquanto grava e enquanto o Agent Dute lê a nota
 * (carregamento v2, parte 13f; necessidades 5 e 10). Antes: o Enviar aviso
 * girava o Loader2 e ficava `disabled`, e o Cancelar do topo também (o foco
 * caía no `body`); a nota em leitura girava o Loader2 sem `aria-hidden`, o
 * "Anexar outro" e o "Remover" ficavam `disabled`, e o Enviar aviso seguia
 * ativo durante a leitura (o aviso saía sem os itens que ela ia trazer, e o
 * arquivo subia duas vezes). Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ avisos: 0, leituras: 0, leituraPresa: false, avisoPreso: false }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "ACME" } }, isLoaded: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ClienteEnvios } from "./envios";

const ITEM = { sku_code: "ACME-000101", client_item_code: "POLO-PP", product_name: "Polo Feminina Azul", qty_on_hand: 12, qty_available: 12 };
const VISAO = { customer: { code: "ACME", name: "ACME" }, inventory: { items: [ITEM] }, requests: [] };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const presa = () => new Promise<Response>(() => undefined);

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.avisos = 0;
  estado.leituras = 0;
  estado.leituraPresa = false;
  estado.avisoPreso = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") return json(VISAO);
      if (url.pathname === "/api/client/shipments/attachments") {
        const { file_name: nome } = JSON.parse(String(init?.body)) as { file_name: string };
        return json({ file_name: nome, file_url: `https://arquivos/${nome}`, storage_path: `x/${nome}`, content_type: "application/pdf", size_bytes: 4 });
      }
      if (url.pathname === "/api/client/shipments/read-invoice") {
        estado.leituras += 1;
        return estado.leituraPresa ? presa() : json({ items: [] });
      }
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.avisos += 1;
        return estado.avisoPreso ? presa() : json({ id: "creq_1" }, 201);
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Router ssrPath="/portal/recebimentos">
          <ClienteEnvios />
        </Router>
      </QueryClientProvider>,
    ),
  );
  await ate(() => botao("Avisar um envio"));
  await act(async () => botao("Avisar um envio")!.click());
  await ate(() => botao("Enviar aviso"));
  await digitar(container.querySelector<HTMLInputElement>('input[placeholder="Quem vai entregar"]'), "Malharia Sul");
  await digitar(container.querySelector<HTMLInputElement>('input[aria-label="Código do item"]'), "POLO-PP");
  await digitar(container.querySelector<HTMLInputElement>('input[aria-label="Peças"]'), "50");
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
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

/** O botão pelo rótulo; o botão de ação, pela camada que está na tela. */
function botao(rotulo: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

async function digitar(campo: HTMLInputElement | null, valor: string) {
  if (!campo) throw new Error("Sem o campo");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function anexar(arquivos: File[]) {
  const campo = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!campo) throw new Error("Sem o campo de anexo");
  Object.defineProperty(campo, "files", { configurable: true, value: arquivos });
  await act(async () => {
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const nota = () => new File([new Uint8Array([37, 80, 68, 70])], "nota.pdf", { type: "application/pdf" });

describe("o aviso gravando", () => {
  it("o Enviar aviso diz o gerúndio aos 300 ms, sem desabilitar, e o Cancelar do topo fica travado", async () => {
    estado.avisoPreso = true;
    const enviar = botao("Enviar aviso")!;
    enviar.focus();
    await act(async () => enviar.click());
    expect(estado.avisos).toBe(1);
    await ate(() => botao("Registrando o aviso…"));
    const andando = botao("Registrando o aviso…")!;
    expect(andando.hasAttribute("disabled")).toBe(false);
    expect(andando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(andando);
    // O segundo toque não envia de novo.
    await act(async () => andando.click());
    expect(estado.avisos).toBe(1);
    const cancelar = botao("Cancelar")!;
    expect(cancelar.hasAttribute("disabled")).toBe(false);
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => cancelar.click());
    expect(botao("Registrando o aviso…")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    const resumo = container.querySelector("aside")!.outerHTML;
    expect(
      textosForaDaLista(resumo, [
        "Resumo",
        "Fornecedor",
        "Malharia Sul",
        "Chega em",
        "—",
        "Itens",
        "Peças",
        "1",
        "50",
        "Enviar aviso",
        "Registrando o aviso…",
        "Conferir",
        "O estoque só muda depois da conferência física na Dutelog.",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("a nota em leitura", () => {
  it("a caixa no lugar do ícone; os botões que esperam ficam aria-disabled, e o aviso não sai enquanto ela lê", async () => {
    estado.leituraPresa = true;
    await anexar([nota()]);
    await ate(() => estado.leituras === 1);
    await ate(() => container.querySelector("section [data-spinner]"));
    expect(container.textContent).toContain("Lendo a nota…");
    const caixa = container.querySelector("section [data-spinner]");
    expect(caixa?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".animate-spin")).toBeNull();
    const remover = botao("Remover nota.pdf")!;
    expect(remover.hasAttribute("disabled")).toBe(false);
    expect(remover.getAttribute("aria-disabled")).toBe("true");
    await act(async () => remover.click());
    expect(container.textContent).toContain("nota.pdf");
    const anexarOutro = botao("Anexar outro")!;
    expect(anexarOutro.hasAttribute("disabled")).toBe(false);
    expect(anexarOutro.getAttribute("aria-disabled")).toBe("true");
    const enviar = botao("Enviar aviso")!;
    expect(enviar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => enviar.click());
    expect(estado.avisos).toBe(0);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("a área da nota é a região de estado: sem aria-busy nela; o Remover tem 24 px, 44 no celular, e o anel cheio do foco (revisão da parte 13f)", async () => {
    estado.leituraPresa = true;
    await anexar([nota()]);
    await ate(() => container.querySelector("section [data-spinner]"));
    const secao = botao("Remover nota.pdf")!.closest("section")!;
    expect(container.querySelector("[aria-busy='true'] h2")).toBeNull();
    expect(secao.hasAttribute("aria-busy")).toBe(false);
    const remover = botao("Remover nota.pdf")!;
    expect(remover.className).toContain("size-6");
    expect(remover.className).toContain("max-md:before:-inset-2.5");
    expect(remover.className).toContain("focus-visible:ring-foco");
    expect(remover.className).toContain("focus-visible:ring-offset-2");
    expect(remover.className).not.toContain("ring-ring/40");
    expect(botao("Anexar outro")!.className).toContain("max-md:min-h-11");
    // O texto de apoio da caixa violeta (a demora inclusive) com 4,5:1 no escuro.
    expect(secao.querySelector("h2 + p")!.className).toContain("dark:text-agent-muted");
  });

  it("aos 10 s de leitura, a demora dita na área da nota", async () => {
    estado.leituraPresa = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      await anexar([nota()]);
      for (let volta = 0; volta < 50 && estado.leituras === 0; volta += 1) await act(async () => vi.advanceTimersByTime(20));
      expect(estado.leituras).toBe(1);
      expect(container.querySelector("section")!.textContent).not.toContain("Demorando mais que o normal");
      await act(async () => vi.advanceTimersByTime(10_200));
      expect(container.querySelector("section")!.textContent).toContain("Demorando mais que o normal");
    } finally {
      vi.useRealTimers();
    }
  });
});
