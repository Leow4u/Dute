// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const falados = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/carregando/anunciador", () => ({ useAnuncio: () => (texto: string) => falados.push(texto) }));

import { estimativaDaEspera } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { AvisoDeEspera } from "./aviso-de-espera";

/**
 * O aviso da espera longa (carregamento v2, seção 9 e momento 6): aos 10 s,
 * "Demorando mais que o normal · 0:12" (com "Tentar de novo" na leitura, só
 * o aviso na escrita, e a estimativa quando o total é conhecido); aos 70 s
 * na escrita, "Sem confirmação do servidor" e "Conferir".
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  falados.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.unstubAllGlobals();
});

function render(elemento: React.ReactElement) {
  act(() => raiz!.render(elemento));
}

const botoes = () => [...container!.querySelectorAll("button")];

describe("AvisoDeEspera", () => {
  it("na escrita, aos 10 s: só o aviso com o relógio, e a estimativa quando o total é conhecido", async () => {
    render(<AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={12_400} restanteMs={16_200} />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Demorando mais que o normal", "·", "0:12", "cerca de 20 s"]);
    expect(botoes()).toEqual([]);
    expect(falados).toEqual(["Demorando mais que o normal"]);
    // O relógio é só visual: nenhuma região viva no aviso.
    expect(container!.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("na leitura, aos 10 s, com \"Tentar de novo\" de 44 px", async () => {
    const tentar = vi.fn();
    render(<AvisoDeEspera fase="demorando" tipo="leitura" desdeMs={10_000} onTentar={tentar} />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Demorando mais que o normal", "·", "0:10", "Tentar de novo"]);
    expect(botoes()[0].className).toContain("min-h-11");
    act(() => botoes()[0].click());
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("na escrita, aos 70 s: \"Sem confirmação do servidor\" e \"Conferir\"; conferindo, ocupado sem desabilitar", async () => {
    const conferir = vi.fn();
    render(<AvisoDeEspera fase="sem-resposta" tipo="escrita" onConferir={conferir} />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Sem confirmação do servidor", "Conferir"]);
    expect(falados).toEqual(["Sem confirmação do servidor"]);
    act(() => botoes()[0].click());
    expect(conferir).toHaveBeenCalledTimes(1);
    render(<AvisoDeEspera fase="sem-resposta" tipo="escrita" onConferir={conferir} tentando />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Sem confirmação do servidor", "Conferindo…"]);
    expect(botoes()[0].getAttribute("aria-busy")).toBe("true");
    expect(botoes()[0].getAttribute("aria-disabled")).toBe("true");
    expect(botoes()[0].hasAttribute("disabled")).toBe(false);
    act(() => botoes()[0].click());
    expect(conferir).toHaveBeenCalledTimes(1);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("na leitura, aos 70 s: \"Sem resposta do servidor.\" e \"Tentar de novo\"", () => {
    render(<AvisoDeEspera fase="sem-resposta" tipo="leitura" onTentar={() => undefined} />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Sem resposta do servidor.", "Tentar de novo"]);
  });

  it("a estimativa arredonda para cima: de 5 em 5 s até um minuto, depois em minutos", () => {
    expect(estimativaDaEspera(1_000)).toBe("cerca de 5 s");
    expect(estimativaDaEspera(16_200)).toBe("cerca de 20 s");
    expect(estimativaDaEspera(60_000)).toBe("cerca de 60 s");
    expect(estimativaDaEspera(61_000)).toBe("cerca de 2 min");
    expect(estimativaDaEspera(0)).toBeNull();
    expect(estimativaDaEspera(Number.NaN)).toBeNull();
  });
});
