// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * "Numerar pedidos e envios antigos" no carregamento v2 (parte 13d;
 * diagnóstico, necessidade 5): antes, "Ver o que muda" e "Numerar agora" só
 * apagavam (`disabled`, sem rótulo nem indicador) durante a numeração, e o
 * foco caía no `body`. Agora cada um é o `BotaoDeAcao`, com o próprio
 * gerúndio, e o outro espera com `aria-disabled`. A chamada é a mesma.
 * Relógio simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ chamadas: [] as Array<{ apply: boolean }>, falharAplicar: false }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/components/system/owner-dashboard", () => ({ OwnerDashboard: () => null }));

import SettingsSystem from "./settings-system";

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/system/request-numbers") {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as { apply: boolean };
    estado.chamadas.push(corpo);
    await new Promise((pronto) => setTimeout(pronto, 1_000));
    if (corpo.apply && estado.falharAplicar) {
      return new Response(JSON.stringify({ message: "Falha interna no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return json({ dry_run: !corpo.apply, assigned_count: 2, assigned: [{ id: "r1", request_number: "PED-0001" }, { id: "r2", request_number: "ENV-0002" }] });
  }
  return json({ ok: true, checked_at: "2026-11-13T13:42:00Z", firestore_ms: 40, last_event: null, incidents: [] });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.chamadas = [];
  estado.falharAplicar = false;
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`sem o botão ${rotulo}`);
  return achado;
}

async function tocar(alvo: HTMLButtonElement) {
  alvo.focus();
  await act(async () => alvo.click());
}

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("Numerar pedidos e envios antigos", () => {
  it("cada botão espera com o próprio gerúndio, ocupado sem disabled, e o outro fica travado com aria-disabled", async () => {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <SettingsSystem />
        </QueryClientProvider>,
      );
    });
    await passar(100);
    const ver = botao("Ver o que muda");
    // Sem a prévia, "Numerar agora" não tem o que fazer: travado, sem disabled.
    expect(botao("Numerar agora").getAttribute("aria-disabled")).toBe("true");
    await tocar(ver);
    expect(ver.disabled).toBe(false);
    await passar(350);
    expect(ver.getAttribute("aria-busy")).toBe("true");
    expect(ver.textContent).toContain("Conferindo a numeração…");
    expect(document.activeElement).toBe(ver);
    paraOAxe.push(container.innerHTML);
    await passar(1_000);
    expect(container.textContent).toContain("Vai numerar 2 solicitação(ões): PED-0001, ENV-0002");

    const numerar = botao("Numerar agora");
    expect(numerar.getAttribute("aria-disabled")).toBeNull();
    await tocar(numerar);
    expect(numerar.disabled).toBe(false);
    await passar(350);
    expect(numerar.getAttribute("aria-busy")).toBe("true");
    expect(numerar.textContent).toContain("Numerando…");
    expect(botao("Ver o que muda").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Ver o que muda").disabled).toBe(false);
    await passar(1_000);
    expect(container.textContent).toContain("Numerou 2 solicitação(ões)");
    expect(estado.chamadas).toEqual([{ apply: false }, { apply: true }]);
    await axeDoQueVimos();
  });
});

const camada = (item: HTMLButtonElement) => item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? null;
const TEXTOS = [
  /^Numerar pedidos e envios antigos$/, /^Dá número PED-\/ENV-/, /^(Vai numerar|Numerou) 2 solicitação\(ões\)/, "Ver o que muda", "Conferindo a numeração…",
  "Numerar agora", "Numerando…", "Numerado", "Não numerado", "Conferir",
];
const textosDoNumerar = () => {
  const secao = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Numerar pedidos e envios antigos");
  return textosForaDaLista(secao?.outerHTML ?? "", TEXTOS);
};

describe("Numerar agora, depois da revisão (parte 13d)", () => {
  it("mostra o fim: \"Numerado\" pelo menos 1 s; no erro, \"Não numerado\" por 2 s, e volta", async () => {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <SettingsSystem />
        </QueryClientProvider>,
      );
    });
    await passar(100);
    await tocar(botao("Ver o que muda"));
    await passar(1_100);
    estado.falharAplicar = true;
    const numerar = botao("Numerar agora");
    await tocar(numerar);
    await passar(1_100);
    expect(camada(numerar)).toBe("Não numerado");
    expect(textosDoNumerar()).toEqual([]);
    await passar(2_100);
    expect(camada(numerar)).toBe("Numerar agora");
    estado.falharAplicar = false;
    await tocar(numerar);
    await passar(1_100);
    expect(camada(numerar)).toBe("Numerado");
    expect(numerar.getAttribute("aria-disabled")).toBe("true");
    expect(textosDoNumerar()).toEqual([]);
    paraOAxe.push(container.innerHTML);
    await passar(1_200);
    expect(camada(numerar)).toBe("Numerar agora");
    expect(estado.chamadas).toEqual([{ apply: false }, { apply: true }, { apply: true }]);
    await axeDoQueVimos();
  });
});
