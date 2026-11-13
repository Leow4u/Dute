// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoDaAcao } from "@/components/ui/botao-de-acao";
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

function abrir(estado: EstadoDaAcao) {
  act(() =>
    raiz!.render(
      <ConcluirSeparacaoDialog
        aberto
        numero="Pedido 1038"
        resumo={RESUMO}
        lacre="88240"
        estado={estado}
        onLacre={() => undefined}
        onFechar={() => (fechou += 1)}
        onConfirmar={() => (confirmou += 1)}
        onConferir={() => (conferiu += 1)}
      />,
    ),
  );
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const botao = (texto: string) => [...dialogo().querySelectorAll("button")].find((candidato) => candidato.textContent === texto)!;
const principal = () => dialogo().querySelector<HTMLButtonElement>(".botao-acao")!;

describe("Concluindo a separação, com as etapas", () => {
  it("antes de 300 ms nada muda; aos 300 ms, \"Etapa 1 de 2\" com Separação e Embalagem", async () => {
    abrir("andamento");
    expect(dialogo().querySelector('[role="progressbar"]')).toBeNull();
    passar(CARREGANDO.atrasoMs);
    const barra = dialogo().querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(barra.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect(barra.getAttribute("aria-label")).toBe("Concluindo a separação");
    expect(textosDaTela(dialogo().innerHTML)).toEqual([
      "Pedido 1038: concluir separação",
      RESUMO,
      "Número do lacre",
      "Etapa",
      "1",
      "de 2",
      "Separação",
      "2",
      "Embalagem",
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

  it("o Voltar fica aria-disabled e o diálogo não fecha: nem o Voltar, nem o Esc", () => {
    abrir("andamento");
    expect(botao("Voltar").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Voltar").hasAttribute("disabled")).toBe(false);
    act(() => botao("Voltar").click());
    act(() => {
      dialogo().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => principal().click());
    expect(fechou).toBe(0);
    expect(confirmou).toBe(0);
    // Em repouso, fecha.
    abrir("repouso");
    act(() => botao("Voltar").click());
    expect(fechou).toBe(1);
  });

  it("aos 10 s, \"Demorando mais que o normal · 0:12\", sem \"Tentar de novo\"", () => {
    abrir("andamento");
    passar(12_000);
    const aviso = dialogo().querySelector<HTMLElement>("[data-aviso-de-espera]")!;
    expect(textosDaTela(aviso.outerHTML)).toEqual(["Demorando mais que o normal", "·", "0:12"]);
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

  it("no sucesso, as duas etapas feitas", () => {
    expect(etapasDaConclusao("sucesso").map((etapa) => etapa.estado)).toEqual(["feito", "feito"]);
    expect(etapasDaConclusao("andamento").map((etapa) => etapa.estado)).toEqual(["andamento", "fila"]);
  });
});
