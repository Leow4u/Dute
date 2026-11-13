// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { formularioInicial } from "@/lib/portal/solicitacao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ServicosView, type ServicosViewProps } from "./servicos-view";

/**
 * Minhas OS no carregamento v2 (parte 13f). Antes: "Carregando..." em texto
 * seco, com três pontos; a falha sem "Tentar de novo" (o `onSnapshot` que
 * falha não volta sozinho); a falha das NFs e das solicitações sumia; e o
 * "Enviar solicitação" só trocava o texto para "Enviando..." e ficava
 * `disabled`, com o Fechar do formulário ativo. Dados sintéticos.
 */

const HOJE = "2026-10-23";

function props(extra: Partial<ServicosViewProps> = {}): ServicosViewProps {
  return {
    estado: "pronto",
    os: [],
    numeros: { emAndamento: 0, agendadas: 0, concluidas: 0 },
    aPagarCents: null,
    cobrancas: new Map(),
    busca: "",
    aberta: null,
    solicitacoes: [],
    pedido: null,
    acoes: {
      buscar: () => undefined,
      abrir: () => undefined,
      fechar: () => undefined,
      solicitar: () => undefined,
      mudar: () => undefined,
      anexar: () => undefined,
      removerAnexo: () => undefined,
      enviar: () => undefined,
      cancelar: () => undefined,
    },
    ...extra,
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

async function montar(tela: ReactNode) {
  await act(async () => raiz!.render(<Router ssrPath="/portal/servicos">{tela}</Router>));
}

function botao(rotulo: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

describe("Minhas OS lendo e na falha", () => {
  it("lendo, a caixa e 'Carregando as OS…' aos 300 ms, no lugar do texto seco", async () => {
    await montar(<ServicosView {...props({ estado: "carregando", leitura: { tentando: false, onTentar: () => undefined } })} />);
    expect(container.textContent).not.toContain("Carregando");
    await ate(() => container.textContent?.includes("Carregando as OS…"));
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    expect(textosForaDaLista(container.innerHTML, ["Minhas OS", "Carregando as OS…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("na falha, 'Tentar de novo' assina de novo; as leituras de apoio que falharam ficam ditas", async () => {
    let tentativas = 0;
    let nfs = 0;
    await montar(
      <ServicosView
        {...props({
          estado: "erro",
          leitura: { tentando: false, onTentar: () => (tentativas += 1) },
          falhas: [{ mensagem: "Não foi possível carregar as NFs das OS.", tentando: false, onTentar: () => (nfs += 1) }],
        })}
      />,
    );
    const alertas = [...container.querySelectorAll('[role="alert"]')].map((alerta) => alerta.textContent ?? "");
    expect(alertas).toEqual([expect.stringContaining("Não foi possível carregar as NFs das OS."), expect.stringContaining("Não foi possível carregar as OS.")]);
    const tentar = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.trim() === "Tentar de novo");
    expect(tentar).toHaveLength(2);
    await act(async () => tentar[1]!.click());
    expect(tentativas).toBe(1);
    await act(async () => tentar[0]!.click());
    expect(nfs).toBe(1);
    expect(
      textosForaDaLista(container.innerHTML, [
        "Minhas OS",
        "Não foi possível carregar as NFs das OS.",
        "Não foi possível carregar as OS.",
        "Tentar de novo",
        "Tentando de novo…",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("Solicitar OS enviando", () => {
  it("o Enviar solicitação diz o gerúndio aos 300 ms, sem desabilitar, e o Fechar fica travado", async () => {
    let fechou = 0;
    const pedido = {
      aberto: true,
      form: formularioInicial(HOJE),
      problemas: {},
      enviando: true,
      erro: null,
      problemaDoAnexo: null,
      enviada: false,
      hoje: HOJE,
    };
    await montar(<ServicosView {...props({ pedido, acoes: { ...props().acoes, cancelar: () => (fechou += 1) } })} />);
    await ate(() => botao("Enviando a solicitação…"));
    const enviando = botao("Enviando a solicitação…")!;
    expect(enviando.hasAttribute("disabled")).toBe(false);
    expect(enviando.getAttribute("aria-busy")).toBe("true");
    const fechar = botao("Fechar")!;
    expect(fechar.getAttribute("aria-disabled")).toBe("true");
    expect(fechar.hasAttribute("disabled")).toBe(false);
    await act(async () => fechar.click());
    expect(fechou).toBe(0);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});
