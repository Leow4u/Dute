// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";

import { abridorDoDialogo, devolverFocoAoFechar, lugarPadraoDoFoco, podeReceberFoco, vigiarFocoDeVolta } from "./foco-de-volta";

/**
 * O foco que volta quando o diálogo fecha (carregamento v2, parte 13a; WCAG
 * 2.4.3): ao controle que abriu e, se ele saiu da tela, ao título da página,
 * nunca ao body.
 */

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const esperar = () => new Promise((pronto) => setTimeout(pronto, 0));

describe("quem abriu o diálogo", () => {
  it("o item do menu \"⋯\" vira o botão do menu, que fica na tela depois que o menu fecha", () => {
    document.body.innerHTML = '<button id="gatilho">Mais ações</button><div role="menu" aria-labelledby="gatilho"><div role="menuitem" tabindex="-1">Cancelar pedido</div></div>';
    expect(abridorDoDialogo(document.querySelector('[role="menuitem"]'))).toBe(document.getElementById("gatilho"));
  });

  it("o botão comum é ele mesmo; o body não é ninguém", () => {
    document.body.innerHTML = "<button>Nova rua</button>";
    const botao = document.querySelector("button")!;
    expect(abridorDoDialogo(botao)).toBe(botao);
    expect(abridorDoDialogo(document.body)).toBeNull();
    expect(abridorDoDialogo(null)).toBeNull();
  });
});

describe("quem pode receber o foco", () => {
  it("fora da tela, desabilitado, inerte ou escondido não pode", () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b" disabled>B</button><div inert><button id="c">C</button></div><div aria-hidden="true"><button id="d">D</button></div>';
    expect(podeReceberFoco(document.getElementById("a"))).toBe(true);
    for (const id of ["b", "c", "d"]) expect(podeReceberFoco(document.getElementById(id)), id).toBe(false);
    expect(podeReceberFoco(document.createElement("button"))).toBe(false);
    expect(podeReceberFoco(null)).toBe(false);
  });

  it("o lugar padrão é o título da área principal; sem ele, a área principal", () => {
    document.body.innerHTML = "<h1>Fora</h1><main><h1>Posições</h1></main>";
    expect(lugarPadraoDoFoco()?.textContent).toBe("Posições");
    document.body.innerHTML = "<main><p>Sem título</p></main>";
    expect(lugarPadraoDoFoco()?.tagName).toBe("MAIN");
  });
});

describe("o fim do diálogo", () => {
  it("volta ao controle que abriu, se ele ainda está na tela", () => {
    document.body.innerHTML = "<main><h1>Posições</h1><button>Nova rua</button></main>";
    const abridor = document.querySelector("button")!;
    const evento = new Event("focusScope.autoFocusOnUnmount", { cancelable: true });
    devolverFocoAoFechar(evento, abridor);
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(abridor);
  });

  it("sem o controle, vai ao lugar pedido e, sem ele, ao título, sem rolar a tela", () => {
    document.body.innerHTML = '<main><h1>Posições</h1><button id="seguinte">Remover A-04</button></main>';
    const saiu = document.createElement("button");
    devolverFocoAoFechar(new Event("x", { cancelable: true }), saiu, () => document.getElementById("seguinte"));
    expect(document.activeElement?.id).toBe("seguinte");
    const foco = vi.spyOn(HTMLElement.prototype, "focus");
    devolverFocoAoFechar(new Event("x", { cancelable: true }), saiu);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(foco).toHaveBeenLastCalledWith({ preventScroll: true });
    foco.mockRestore();
  });

  it("quem usa o diálogo e já levou o foco decide: nada muda", () => {
    document.body.innerHTML = "<main><h1>Pedidos</h1><button>Separar</button></main>";
    const evento = new Event("x", { cancelable: true });
    evento.preventDefault();
    devolverFocoAoFechar(evento, document.querySelector("button"));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("a vigia do foco que voltou", () => {
  it("o controle que sai da tela com o foco leva o foco ao lugar certo", async () => {
    document.body.innerHTML = '<main><h1>Posições</h1><ul><li><button id="linha">Remover A-03</button></li></ul></main>';
    const linha = document.getElementById("linha")!;
    linha.focus();
    vigiarFocoDeVolta(linha);
    linha.closest("li")!.remove();
    await esperar();
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("acaba quando a pessoa leva o foco a outro lugar, ou no prazo da releitura", async () => {
    document.body.innerHTML = '<main><h1>Posições</h1><button id="linha">A</button><button id="outro">B</button></main>';
    const linha = document.getElementById("linha")!;
    linha.focus();
    vigiarFocoDeVolta(linha);
    document.getElementById("outro")!.focus();
    linha.remove();
    await esperar();
    expect(document.activeElement?.id).toBe("outro");

    vi.useFakeTimers();
    document.body.innerHTML = '<main><h1>Posições</h1><button id="linha">A</button></main>';
    const outra = document.getElementById("linha")!;
    outra.focus();
    vigiarFocoDeVolta(outra);
    vi.advanceTimersByTime(CARREGANDO.desisteMs);
    vi.useRealTimers();
    outra.remove();
    await esperar();
    expect(document.activeElement).toBe(document.body);
  });
});
