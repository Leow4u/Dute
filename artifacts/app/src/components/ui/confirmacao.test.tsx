// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { Confirmacao } from "./confirmacao";

/**
 * A confirmação que espera a resposta (docs/plataforma/diagnostico-carregamento.md,
 * decisão 6 de 06/11/2026). Antes, Emitir a fatura, Remover item da tabela,
 * Remover posição e Apagar rotina fechavam no clique, antes da resposta, e a
 * falha passava sem o diálogo. Na parte 13a do carregamento v2, o confirmar
 * virou o BotaoDeAcao e o Cancelar ficou aria-disabled: o disabled de antes
 * derrubava o foco no body.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let props: ComponentProps<typeof Confirmacao>;

async function montar(patch: Partial<ComponentProps<typeof Confirmacao>> = {}) {
  props = { ...props, ...patch };
  await act(async () => raiz!.render(<Confirmacao {...props} />));
}

/** O botão pelo rótulo: o texto inteiro, ou a camada atual do BotaoDeAcao. */
function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === texto || button.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
}

async function esc() {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    aberta: true,
    ocupada: false,
    titulo: "Emitir a fatura de outubro de 2026?",
    descricao: "Os valores serão congelados.",
    confirmar: "Emitir",
    confirmando: "Emitindo…",
    onConfirmar: vi.fn(),
    onFechar: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  container?.remove();
  raiz = null;
  container = null;
});

describe("a confirmação que espera a resposta", () => {
  it("confirmar chama a ação e não fecha o diálogo", async () => {
    await montar();
    await act(async () => botao("Emitir")!.click());
    expect(props.onConfirmar).toHaveBeenCalledTimes(1);
    expect(props.onFechar).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("enquanto a ação roda: o BotaoDeAcao no gerúndio aos 300 ms, o Cancelar aria-disabled, o Esc não fecha e o foco fica", async () => {
    vi.useFakeTimers();
    await montar();
    const confirmar = botao("Emitir")!;
    confirmar.focus();
    await montar({ ocupada: true });
    await act(async () => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(botao("Emitindo…")).toBe(confirmar);
    // Ocupado não é desabilitado: o foco fica no botão tocado, nunca no body.
    expect(confirmar.disabled).toBe(false);
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(confirmar.querySelector("[data-spinner]")).not.toBeNull();
    expect(document.activeElement).toBe(confirmar);
    const cancelar = botao("Cancelar")!;
    expect(cancelar.disabled).toBe(false);
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => cancelar.click());
    await act(async () => confirmar.click());
    await esc();
    expect(props.onFechar).not.toHaveBeenCalled();
    expect(props.onConfirmar).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')!.hasAttribute("data-ocupado")).toBe(true);
  });

  it("parada, o Esc e o Cancelar fecham", async () => {
    await montar();
    await esc();
    expect(props.onFechar).toHaveBeenCalledTimes(1);
    await act(async () => botao("Cancelar")!.click());
    expect(props.onFechar).toHaveBeenCalledTimes(2);
    expect(props.onConfirmar).not.toHaveBeenCalled();
  });

  it("enquanto sai, o texto é o de quando estava aberta: quem chama já limpou o que ela confirmava", async () => {
    await montar({ titulo: "Remover a posição A-03?" });
    const textos: string[] = [];
    const observador = new MutationObserver((registros) => {
      for (const registro of registros) {
        if (registro.type === "characterData") textos.push((registro.target as Text).data);
        for (const no of Array.from(registro.addedNodes)) textos.push(no.textContent ?? "");
      }
    });
    observador.observe(document.body, { subtree: true, childList: true, characterData: true });
    // Quem chama fecha e limpa a posição na mesma hora: antes, a saída mostrava "Remover a posição ?".
    await montar({ aberta: false, titulo: "Remover a posição ?" });
    observador.disconnect();
    expect(textos.join(" | ")).not.toContain("Remover a posição ?");
  });

  it("o perigo chega ao confirmar: o vermelho sólido, que travado não muda com o ponteiro em cima", async () => {
    await montar({ perigo: true, ocupada: true });
    const confirmar = document.querySelector<HTMLButtonElement>(".botao-acao")!;
    expect(confirmar.className).toContain("bg-red-700");
    expect(confirmar.className).toContain("hover:bg-red-700");
    expect(confirmar.className).not.toContain("hover:bg-primary");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, parada e em andamento", async () => {
    await montar();
    expect(await violacoesDeAcessibilidade(document.querySelector('[role="alertdialog"]')!.outerHTML)).toEqual([]);
    await montar({ ocupada: true });
    expect(await violacoesDeAcessibilidade(document.querySelector('[role="alertdialog"]')!.outerHTML)).toEqual([]);
  });
});

describe("as quatro confirmações usam a que espera a resposta", () => {
  const fonte = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

  it("Emitir a fatura fecha só no sucesso", () => {
    const billing = fonte("../../pages/billing.tsx");
    expect(billing).toMatch(/<Confirmacao[\s\S]*?ocupada=\{emit\.isPending\}[\s\S]*?confirmando="Emitindo…"/);
    expect(billing).not.toContain("<AlertDialogAction");
    expect(billing).toMatch(/onSuccess: \(\) => \{\s*setConfirmarEmissao\(false\);/);
  });

  it("Remover item da tabela de preços fecha só no sucesso e avisa a falha", () => {
    const tabela = fonte("../../pages/price-list.tsx");
    expect(tabela).toMatch(/<Confirmacao[\s\S]*?ocupada=\{del\.isPending\}[\s\S]*?confirmando="Removendo…"/);
    expect(tabela).not.toContain("<AlertDialogAction");
    expect(tabela).toMatch(/del\.mutate\(\s*\{ id \},\s*\{\s*onSuccess: \(\) => \{[^\n]*setRemoving\(null\)[^\n]*\},\s*onError:/);
    expect(tabela).toContain('onError: () => toast({ title: "Erro ao remover item", variant: "destructive" })');
  });

  it("Remover posição fecha só no sucesso", () => {
    const posicoes = fonte("../../pages/warehouse-positions.tsx");
    expect(posicoes).toMatch(/<Confirmacao[\s\S]*?ocupada=\{remove\.isPending\}[\s\S]*?confirmando="Removendo…"/);
    expect(posicoes).not.toContain("<AlertDialogAction");
  });

  it("Apagar rotina fecha só no sucesso", () => {
    const rotinas = fonte("../agent/routines.tsx");
    expect(rotinas).toMatch(/<Confirmacao[\s\S]*?ocupada=\{remove\.isPending\}[\s\S]*?confirmando="Apagando…"/);
    expect(rotinas).not.toContain("<AlertDialogAction");
    expect(rotinas).toContain("remove.mutate(undefined, { onSuccess: () => setConfirmDelete(false) })");
    // O vermelho do Apagar é o perigo do BotaoDeAcao, que travado não fica no do primário com o ponteiro em cima.
    expect(rotinas).toMatch(/<Confirmacao[\s\S]*?\n\s*perigo\n/);
    expect(rotinas).not.toContain("classeDoConfirmar");
  });
});
