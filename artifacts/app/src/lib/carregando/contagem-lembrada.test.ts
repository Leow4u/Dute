// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FANTASMAS_MAX,
  FANTASMAS_MIN,
  FANTASMAS_SEM_LEMBRANCA,
  lembrarContagens,
  lerContagens,
  linhasDosFantasmas,
  useContagemLembrada,
  type ContagemLembrada,
  type ContagensDaLista,
} from "./contagem-lembrada";
import { resumoDaLista } from "./resumo-da-lista";

/**
 * A contagem lembrada (carregamento v2, seção 5.2, e a decisão P3): a última
 * contagem lida de cada grupo, por lista e por cliente ativo, guardada no
 * aparelho, dimensiona as linhas-fantasma da próxima primeira leitura. Sem
 * ela, duas por grupo; com ela, entre uma e cinco. Sem o armazenamento do
 * aparelho, a lista abre do mesmo jeito.
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("quantas linhas-fantasma", () => {
  it("sem lembrança, duas; com ela, a contagem, entre uma e cinco", () => {
    expect(FANTASMAS_SEM_LEMBRANCA).toBe(2);
    expect([FANTASMAS_MIN, FANTASMAS_MAX]).toEqual([1, 5]);
    expect(linhasDosFantasmas(undefined)).toBe(2);
    expect(linhasDosFantasmas(null)).toBe(2);
    expect(linhasDosFantasmas(Number.NaN)).toBe(2);
    expect(linhasDosFantasmas(3)).toBe(3);
    // O grupo que estava vazio guarda uma linha: o vazio também ocupa o cartão.
    expect(linhasDosFantasmas(0)).toBe(1);
    expect(linhasDosFantasmas(40)).toBe(5);
  });
});

describe("a contagem guardada no aparelho", () => {
  it("é por lista e por cliente: a da BTG não dimensiona a de outro cliente, nem a de outra lista", () => {
    lembrarContagens("pedidos", "BTG", { aprovar: 3, separar: 2, entregar: 1 });
    expect(lerContagens("pedidos", "BTG")).toEqual({ aprovar: 3, separar: 2, entregar: 1 });
    expect(lerContagens("pedidos", "ACME")).toBeNull();
    expect(lerContagens("receber", "BTG")).toBeNull();
    // Sem cliente, nada se lê nem se guarda.
    lembrarContagens("pedidos", "", { aprovar: 9 });
    expect(lerContagens("pedidos", "")).toBeNull();
  });

  it("o guardado estragado não vale: só ficam os números inteiros de zero para cima", () => {
    window.localStorage.setItem("dute:contagem-lembrada:pedidos:BTG", "{nao é json");
    expect(lerContagens("pedidos", "BTG")).toBeNull();
    window.localStorage.setItem("dute:contagem-lembrada:pedidos:BTG", "[3, 2]");
    expect(lerContagens("pedidos", "BTG")).toBeNull();
    window.localStorage.setItem("dute:contagem-lembrada:pedidos:BTG", JSON.stringify({ aprovar: 3, separar: -1, entregar: 1.5, entregues: "4" }));
    expect(lerContagens("pedidos", "BTG")).toEqual({ aprovar: 3 });
  });

  it("sem o armazenamento do aparelho (a janela anônima, o bloqueio), nada quebra: a leitura é nula e a gravação some", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cheio", "QuotaExceededError");
    });
    expect(() => lembrarContagens("pedidos", "BTG", { aprovar: 3 })).not.toThrow();
    expect(lerContagens("pedidos", "BTG")).toBeNull();
  });
});

describe("useContagemLembrada", () => {
  function montar(lista: string, cliente: string, lidas: ContagensDaLista | null) {
    let visto: ContagemLembrada | null = null;
    function Sonda(props: { cliente: string; lidas: ContagensDaLista | null }) {
      visto = useContagemLembrada(lista, props.cliente, props.lidas);
      return null;
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const raiz = createRoot(document.createElement("div"));
    act(() => raiz.render(createElement(Sonda, { cliente, lidas })));
    return {
      atual: () => visto!,
      mudar: (props: { cliente: string; lidas: ContagensDaLista | null }) => act(() => raiz.render(createElement(Sonda, props))),
      fim: () => act(() => raiz.unmount()),
    };
  }

  it("lê a lembrança quando a tela abre, guarda cada leitura nova e não apaga a lembrança enquanto a lista não leu", () => {
    lembrarContagens("pedidos", "BTG", { aprovar: 4 });
    const sonda = montar("pedidos", "BTG", null);
    expect(sonda.atual().linhas("aprovar")).toBe(4);
    expect(sonda.atual().lembrada("aprovar")).toBe(4);
    expect(sonda.atual().linhas("separar")).toBe(2);
    expect(sonda.atual().lembrada("separar")).toBeNull();
    // A primeira leitura ainda não chegou: o que estava guardado fica.
    expect(lerContagens("pedidos", "BTG")).toEqual({ aprovar: 4 });
    sonda.mudar({ cliente: "BTG", lidas: { aprovar: 1, separar: 0 } });
    expect(lerContagens("pedidos", "BTG")).toEqual({ aprovar: 1, separar: 0 });
    // Outro cliente: a lembrança dele, e a leitura dele guardada com ele.
    sonda.mudar({ cliente: "ACME", lidas: null });
    expect(sonda.atual().linhas("aprovar")).toBe(2);
    sonda.mudar({ cliente: "ACME", lidas: { aprovar: 5 } });
    expect(lerContagens("pedidos", "ACME")).toEqual({ aprovar: 5 });
    expect(lerContagens("pedidos", "BTG")).toEqual({ aprovar: 1, separar: 0 });
    sonda.fim();
  });
});

describe("o resumo falado no fim da primeira leitura", () => {
  it("diz cada grupo com linha, no singular e no plural; sem nenhuma, o vazio", () => {
    expect(
      resumoDaLista(
        [
          { quantos: 3, um: "para aprovar" },
          { quantos: 2, um: "para separar" },
          { quantos: 1, um: "para entregar" },
        ],
        "Nenhum pedido em aberto",
      ),
    ).toBe("3 para aprovar, 2 para separar, 1 para entregar");
    expect(
      resumoDaLista(
        [
          { quantos: 0, um: "para conferir" },
          { quantos: 1, um: "recebida por guardar", varios: "recebidas por guardar" },
          { quantos: 2, um: "recebida por guardar", varios: "recebidas por guardar" },
        ],
        "Nenhuma chegada em aberto",
      ),
    ).toBe("1 recebida por guardar, 2 recebidas por guardar");
    expect(resumoDaLista([{ quantos: 0, um: "para aprovar" }], "Nenhum pedido em aberto")).toBe("Nenhum pedido em aberto");
  });
});
