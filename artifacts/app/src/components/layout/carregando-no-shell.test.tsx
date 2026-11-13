// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveCustomerState } from "@/lib/active-customer-context";
import { activeCustomerOptions } from "@/lib/active-customer";
import { SemResposta } from "@/lib/conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O shell enquanto lê (carregamento v2, parte 13e, momento 1): o seletor do
 * cliente ativo mostra o bloco e, aos 300 ms, a caixa de 16 px até a lista
 * dos clientes chegar, nunca o cliente legado como se fosse o escolhido; a
 * lista que não veio diz a falta, e o toque tenta de novo. O item do menu da
 * tela que ainda abre mostra a caixa no lugar do contador. Dados sintéticos.
 */

const OPCOES = activeCustomerOptions([]);
const estado = vi.hoisted(() => ({ cliente: {} as ActiveCustomerState, tentar: vi.fn() }));

vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => estado.cliente }));

import { ActiveCustomerSwitcher } from "./active-customer-switcher";
import { ContadorOuEspera } from "./shell-do-modulo";
import { CarregandoTela } from "@/components/ui/carregando-tela";

function cliente(extra: Partial<ActiveCustomerState>): ActiveCustomerState {
  return {
    options: OPCOES,
    active: OPCOES[0]!,
    code: OPCOES[0]!.code,
    setCode: () => undefined,
    isLoading: false,
    falhou: false,
    erro: null,
    tentar: estado.tentar,
    tentando: false,
    codeProvavel: OPCOES[0]!.code,
    ...extra,
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.tentar = vi.fn();
  estado.cliente = cliente({});
  container = document.createElement("div");
  container.className = "v3 bg-v3-header";
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
const gatilho = () => container.querySelector<HTMLButtonElement>("button[data-cliente-ativo]")!;

async function montar(variante: "v3" | "v3-cabecalho" = "v3") {
  await act(async () => raiz!.render(<ActiveCustomerSwitcher variant={variante} canManageCustomers />));
}

async function tocarNoGatilho() {
  await act(async () => {
    gatilho().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

describe("o seletor do cliente ativo enquanto a lista dos clientes lê", () => {
  it("nunca mostra o cliente legado: o bloco desde 0 ms e a caixa aos 300 ms, no lugar da seta", async () => {
    estado.cliente = cliente({ isLoading: true });
    await montar();
    expect(container.textContent).not.toContain("BTG Pactual");
    expect(container.querySelector("[data-esqueleto]")).not.toBeNull();
    expect(gatilho().getAttribute("aria-label")).toBe("Carregando o cliente ativo");
    expect(gatilho().getAttribute("aria-disabled")).toBe("true");
    expect(gatilho().disabled).toBe(false);
    expect(container.querySelector("[data-spinner]")).toBeNull();
    await espera(360);
    expect(container.querySelector("[data-spinner]")).not.toBeNull();
    expect(gatilho().getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain("BTG Pactual");
  });

  it("lendo, o toque não abre o menu", async () => {
    estado.cliente = cliente({ isLoading: true });
    await montar();
    await tocarNoGatilho();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("a lista que não veio diz a falta, e o toque tenta de novo", async () => {
    estado.cliente = cliente({ falhou: true, erro: new Error("Falhou.") });
    await montar();
    expect(container.textContent).toContain("Não carregou");
    expect(container.textContent).not.toContain("BTG Pactual");
    expect(gatilho().getAttribute("aria-label")).toBe("Cliente ativo: Não carregou. Tentar de novo");
    await tocarNoGatilho();
    expect(estado.tentar).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("sem resposta do servidor, diz Reconectando… (a falta de conexão, pelo estado único)", async () => {
    estado.cliente = cliente({ falhou: true, erro: new SemResposta() });
    await montar("v3-cabecalho");
    expect(container.textContent).toContain("Reconectando…");
  });

  it("lido, mostra o cliente e abre o menu", async () => {
    await montar();
    expect(container.textContent).toContain("BTG Pactual");
    await tocarNoGatilho();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("só rótulos e passa no axe, lendo e com a falta", async () => {
    for (const extra of [{ isLoading: true }, { falhou: true, erro: new Error("Falhou.") }]) {
      estado.cliente = cliente(extra);
      const html = `<div class="v3 bg-v3-header">${renderToStaticMarkup(<ActiveCustomerSwitcher variant="v3" canManageCustomers />)}${renderToStaticMarkup(<ActiveCustomerSwitcher variant="v3-cabecalho" canManageCustomers />)}</div>`;
      expect(textosForaDaLista(html, ["Cliente ativo", "Não carregou"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });
});

describe("o item do menu da tela que ainda abre", () => {
  it("aos 300 ms, a caixa de 16 px no lugar do contador; quando a tela chega, o contador volta", async () => {
    await act(async () =>
      raiz!.render(
        <>
          <span data-item="">
            <ContadorOuEspera atual contador={{ n: 3 }} />
          </span>
          <CarregandoTela titulo="Pedidos" />
        </>,
      ),
    );
    const item = () => container.querySelector("[data-item]")!;
    expect(item().textContent).toBe("3");
    await espera(360);
    expect(item().querySelector("[data-espera-da-rota]")).not.toBeNull();
    expect(item().querySelector("[data-espera-da-rota]")?.getAttribute("aria-hidden")).toBe("true");
    expect(item().textContent).toBe("");
    await act(async () =>
      raiz!.render(
        <span data-item="">
          <ContadorOuEspera atual contador={{ n: 3 }} />
        </span>,
      ),
    );
    expect(item().textContent).toBe("3");
  });

  it("o item que não é o da tela fica com o contador", async () => {
    await act(async () =>
      raiz!.render(
        <>
          <span data-item="">
            <ContadorOuEspera atual={false} contador={{ n: 2 }} />
          </span>
          <CarregandoTela titulo="Pedidos" />
        </>,
      ),
    );
    await espera(360);
    expect(container.querySelector("[data-item]")!.textContent).toBe("2");
  });
});
