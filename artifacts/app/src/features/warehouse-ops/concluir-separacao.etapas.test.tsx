// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ConcluirSeparacaoDialog, etapasDaConclusao } from "./concluir-separacao";

/**
 * Concluindo a separação (carregamento v2, parte 11 e momento 6): aos 300
 * ms, "Etapa 1 de 2" com Separação → Embalagem; o "Voltar" aria-disabled, o
 * botão "Concluindo…" na mesma largura e o diálogo que não fecha; aos 10 s,
 * "Demorando mais que o normal · 0:12"; sem resposta, "Sem confirmação do
 * servidor" e o "Conferir". Dados sintéticos.
 */

const RESUMO = "BTG Pactual · 3 itens · 41 un.";
const BOTAO = ["Confirmar separação", "Concluindo…", "Concluído", "Não concluído", "Conferir"];
const ETAPAS = ["Etapa", "1", "de 2", "Separação", "2", "Embalagem"];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let fechou = 0;
let confirmou = 0;
let conferiu = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fechou = 0;
  confirmou = 0;
  conferiu = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function abrir(estado: EstadoDaAcao, conferindo = false) {
  act(() =>
    raiz!.render(
      <>
        <Anunciador />
        <ConcluirSeparacaoDialog
          aberto
          numero="Pedido 1038"
          resumo={RESUMO}
          lacre="88240"
          estado={estado}
          conferindo={conferindo}
          onLacre={() => undefined}
          onFechar={() => (fechou += 1)}
          onConfirmar={() => (confirmou += 1)}
          onConferir={() => (conferiu += 1)}
        />
      </>,
    ),
  );
}

const marcadores = () => [...dialogo().querySelectorAll<HTMLElement>("[data-etapa]")].map((etapa) => etapa.dataset.etapa);
/** Onde o botão principal está, medido pelo que vem antes dele no diálogo: os blocos que estão na tela. */
const blocosAntesDoRodape = () => [...dialogo().querySelectorAll(":scope form > *")].map((no) => (no as HTMLElement).dataset.progresso ?? ((no as HTMLElement).hasAttribute("data-lugar-do-aviso") ? "aviso" : no.tagName));

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const botao = (texto: string) => [...dialogo().querySelectorAll("button")].find((candidato) => candidato.textContent === texto)!;
const principal = () => dialogo().querySelector<HTMLButtonElement>(".botao-acao")!;

describe("Concluindo a separação, com as etapas", () => {
  it("em repouso, as etapas já estão lá, pendentes, e o lugar do aviso guardado: nada entra empurrando o botão tocado", () => {
    abrir("repouso");
    expect(dialogo().querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect(marcadores()).toEqual(["fila", "fila"]);
    const antes = blocosAntesDoRodape();
    expect(antes).toContain("etapas");
    expect(antes).toContain("aviso");
    // Concluindo, aos 300 ms, aos 10 s e aos 70 s, os mesmos blocos: só o conteúdo deles muda.
    abrir("andamento");
    passar(CARREGANDO.atrasoMs);
    expect(blocosAntesDoRodape()).toEqual(antes);
    passar(CARREGANDO.demoraMs);
    expect(blocosAntesDoRodape()).toEqual(antes);
    abrir("sem-resposta");
    expect(blocosAntesDoRodape()).toEqual(antes);
  });

  it("antes de 300 ms nada muda; aos 300 ms, a Separação anda em \"Etapa 1 de 2\", e o leitor de tela ouve \"Concluindo a separação\"", async () => {
    abrir("andamento");
    expect(marcadores()).toEqual(["fila", "fila"]);
    expect(document.querySelector("[data-anunciador]")?.textContent).toBe("");
    passar(CARREGANDO.atrasoMs);
    expect(marcadores()).toEqual(["andamento", "fila"]);
    expect(document.querySelector("[data-anunciador]")?.textContent).toBe("Concluindo a separação");
    const barra = dialogo().querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(barra.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect(barra.getAttribute("aria-label")).toBe("Concluindo a separação");
    expect(textosDaTela(dialogo().innerHTML)).toEqual([
      "Pedido 1038: concluir separação",
      RESUMO,
      "Número do lacre",
      ...ETAPAS,
      "Voltar",
      ...BOTAO,
      "Fechar",
    ]);
    // O botão diz "Concluindo…" e mantém a largura: as cinco camadas estão lá, só a atual na árvore.
    expect(principal().querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Concluindo…");
    expect(principal().getAttribute("aria-busy")).toBe("true");
    expect(principal().getAttribute("aria-disabled")).toBe("true");
    expect(principal().hasAttribute("disabled")).toBe(false);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(dialogo().outerHTML)).toEqual([]);
  });

  it("o Voltar e o X ficam aria-disabled e o diálogo não fecha: nem o Voltar, nem o X, nem o Esc", () => {
    abrir("andamento");
    expect(botao("Voltar").getAttribute("aria-disabled")).toBe("true");
    // O X diz que está travado, como o Voltar, e o toque nele não fecha.
    expect(botao("Fechar").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Fechar").hasAttribute("disabled")).toBe(false);
    act(() => botao("Fechar").click());
    expect(botao("Voltar").hasAttribute("disabled")).toBe(false);
    act(() => botao("Voltar").click());
    act(() => {
      dialogo().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => principal().click());
    expect(fechou).toBe(0);
    expect(confirmou).toBe(0);
    // Em repouso, fecha, e o X está livre.
    abrir("repouso");
    expect(botao("Fechar").hasAttribute("aria-disabled")).toBe(false);
    act(() => botao("Voltar").click());
    expect(fechou).toBe(1);
  });

  it("o Voltar e o botão principal têm 44 px: o \"Conferir\" também", () => {
    abrir("sem-resposta");
    expect(botao("Voltar").className).toContain("min-h-11");
    expect(principal().className).toContain("min-h-11");
  });

  it("conferindo, que só relê: o botão diz \"Conferindo…\", o \"Sem confirmação do servidor\" fica e as etapas não voltam a andar", () => {
    abrir("sem-resposta");
    passar(1_000);
    abrir("sem-resposta", true);
    passar(CARREGANDO.atrasoMs);
    expect(principal().querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Conferindo…");
    expect(principal().getAttribute("aria-busy")).toBe("true");
    expect(dialogo().querySelector("[data-aviso-de-espera]")?.textContent).toBe("Sem confirmação do servidor");
    expect(marcadores()).toEqual(["fila", "fila"]);
    expect(dialogo().textContent).not.toContain("Demorando");
    // Conferindo, o diálogo também não fecha.
    act(() => botao("Voltar").click());
    expect(fechou).toBe(0);
  });

  it("aos 10 s, \"Demorando mais que o normal · 0:12\", sem \"Tentar de novo\"", () => {
    abrir("andamento");
    passar(12_000);
    const aviso = dialogo().querySelector<HTMLElement>("[data-aviso-de-espera]")!;
    expect(textosDaTela(aviso.outerHTML)).toEqual(["Demorando mais que o normal", "0:12"]);
    expect(aviso.querySelector("button")).toBeNull();
  });

  it("sem resposta, \"Sem confirmação do servidor\" e o botão vira \"Conferir\", que relê e não reenvia", () => {
    abrir("sem-resposta");
    expect(dialogo().querySelector("[data-aviso-de-espera]")?.textContent).toBe("Sem confirmação do servidor");
    passar(1_000);
    act(() => principal().click());
    expect(conferiu).toBe(1);
    expect(confirmou).toBe(0);
  });

  it("no sucesso, as duas etapas feitas; em andamento, a primeira anda; no resto, pendentes", () => {
    expect(etapasDaConclusao("sucesso").map((etapa) => etapa.estado)).toEqual(["feito", "feito"]);
    expect(etapasDaConclusao("andamento").map((etapa) => etapa.estado)).toEqual(["andamento", "fila"]);
    expect(etapasDaConclusao("repouso").map((etapa) => etapa.estado)).toEqual(["fila", "fila"]);
    expect(etapasDaConclusao("sem-resposta").map((etapa) => etapa.estado)).toEqual(["fila", "fila"]);
  });
});
