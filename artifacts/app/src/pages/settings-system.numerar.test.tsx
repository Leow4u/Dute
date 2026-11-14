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

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ apply: boolean }>,
  falharAplicar: false,
  /** "Numerar agora" sem resposta: a chamada fica presa. */
  prenderAplicar: false,
  /** "Numerar agora" que cai no prazo do servidor, sem dizer se valeu. */
  prazoDoAplicar: 0,
  /** Quanto o "Numerar agora" demora a responder. */
  demoraDoAplicar: 1_000,
  /** O que a prévia ainda acha para numerar. */
  restantes: 2,
}));

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
    if (corpo.apply && estado.prenderAplicar) return new Promise<Response>(() => undefined);
    if (corpo.apply && estado.prazoDoAplicar) {
      await new Promise((pronto) => setTimeout(pronto, estado.prazoDoAplicar));
      return new Response(JSON.stringify({ message: "O servidor não respondeu a tempo." }), { status: 504, headers: { "content-type": "application/json" } });
    }
    await new Promise((pronto) => setTimeout(pronto, corpo.apply ? estado.demoraDoAplicar : 1_000));
    if (corpo.apply && estado.falharAplicar) {
      return new Response(JSON.stringify({ message: "Falha interna no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
    }
    const assigned = [{ id: "r1", request_number: "PED-0001" }, { id: "r2", request_number: "ENV-0002" }].slice(0, corpo.apply ? 2 : estado.restantes);
    return json({ dry_run: !corpo.apply, assigned_count: assigned.length, assigned });
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
  estado.prenderAplicar = false;
  estado.prazoDoAplicar = 0;
  estado.demoraDoAplicar = 1_000;
  estado.restantes = 2;
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

/**
 * O "Numerar agora" sem resposta (carregamento v2, junção das partes 10 e 13):
 * a junção juntou o botão da 13d, que vira "Conferir" aos 70 s, ao aviso da
 * escrita da 13e. O "Conferir" ficava mudo enquanto a chamada não respondia
 * (o toque saía no `isPending`) e, depois, só voltava ao repouso, sem reler,
 * com a prévia velha na tela. Agora ele relê a prévia, nunca numera de novo:
 * sem nada a numerar, valeu; com o que falta, a prévia nova e o "Numerar
 * agora" travado enquanto a primeira chamada não responde. E a numeração que
 * acaba depois dos 10 s não faz o Anunciador dizer a demora de novo.
 */
describe("Numerar agora aos 70 s, na junção", () => {
  async function abrirComPrevia() {
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
  }
  const TEXTOS_DA_DESISTENCIA = [...TEXTOS, "Demorando mais que o normal", /^\d:\d\d$/, "Sem confirmação do servidor", "Conferindo…", /^Vai numerar 0 solicitação\(ões\)\.$/];
  /** O texto da seção, sem a região do Anunciador. */
  const naSecao = () =>
    Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Numerar pedidos e envios antigos")?.textContent ?? "";
  const textosDaDesistencia = () => {
    const secao = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Numerar pedidos e envios antigos");
    return textosForaDaLista(secao?.outerHTML ?? "", TEXTOS_DA_DESISTENCIA);
  };

  it("o Conferir, com a chamada ainda sem resposta, relê a prévia e nunca numera de novo; sem nada a numerar, valeu", async () => {
    await abrirComPrevia();
    estado.prenderAplicar = true;
    const numerar = botao("Numerar agora");
    await tocar(numerar);
    await passar(70_100);
    expect(camada(numerar)).toBe("Conferir");
    // O Conferir age: não é o ocupado, mudo.
    expect(numerar.getAttribute("aria-disabled")).toBeNull();
    expect(naSecao()).toContain("Sem confirmação do servidor");
    expect(textosDaDesistencia()).toEqual([]);
    paraOAxe.push(container.innerHTML);
    // O servidor numerou: a prévia relida não acha mais nada.
    estado.restantes = 0;
    await tocar(numerar);
    await passar(350);
    expect(camada(numerar)).toBe("Conferindo…");
    expect(numerar.getAttribute("aria-busy")).toBe("true");
    // Conferindo, o aviso fica.
    expect(naSecao()).toContain("Sem confirmação do servidor");
    await passar(1_000);
    expect(camada(numerar)).toBe("Numerado");
    // O fim que o Conferir achou tira a desistência, mesmo com a primeira chamada ainda sem resposta.
    expect(naSecao()).not.toContain("Sem confirmação do servidor");
    expect(estado.chamadas).toEqual([{ apply: false }, { apply: true }, { apply: false }]);
    expect(textosDaDesistencia()).toEqual([]);
    await axeDoQueVimos();
  });

  it("o Conferir que acha o que falta numerar mostra a prévia nova, e o Numerar agora espera a primeira chamada, travado", async () => {
    await abrirComPrevia();
    estado.prenderAplicar = true;
    const numerar = botao("Numerar agora");
    await tocar(numerar);
    await passar(70_100);
    estado.restantes = 1;
    await tocar(numerar);
    await passar(1_400);
    expect(camada(numerar)).toBe("Numerar agora");
    expect(container.textContent).toContain("Vai numerar 1 solicitação(ões): PED-0001");
    expect(numerar.getAttribute("aria-disabled")).toBe("true");
    await tocar(numerar);
    await passar(1_400);
    expect(estado.chamadas).toEqual([{ apply: false }, { apply: true }, { apply: false }]);
  });

  it("a chamada que cai no prazo depois dos 70 s não tira a desistência: \"Sem confirmação do servidor\" fica com o Conferir", async () => {
    await abrirComPrevia();
    estado.prazoDoAplicar = 71_000;
    const numerar = botao("Numerar agora");
    await tocar(numerar);
    await passar(70_100);
    expect(camada(numerar)).toBe("Conferir");
    await passar(2_000);
    expect(camada(numerar)).toBe("Conferir");
    expect(naSecao()).toContain("Sem confirmação do servidor");
    expect(estado.chamadas).toEqual([{ apply: false }, { apply: true }]);
  });

  it("a numeração que acaba depois dos 10 s não faz o Anunciador dizer a demora de novo", async () => {
    await abrirComPrevia();
    estado.demoraDoAplicar = 15_000;
    const falas: string[] = [];
    const regiao = document.querySelector("[data-anunciador]")!;
    const observador = new MutationObserver(() => {
      const texto = regiao.textContent?.trim();
      if (texto) falas.push(texto);
    });
    observador.observe(regiao, { subtree: true, childList: true, characterData: true });
    await tocar(botao("Numerar agora"));
    await passar(10_500);
    await passar(5_000);
    await passar(5_000);
    observador.disconnect();
    expect(container.textContent).toContain("Numerou 2 solicitação(ões)");
    expect(falas.filter((fala) => fala === "Demorando mais que o normal")).toHaveLength(1);
  });
});
