// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { Confirmacao } from "./confirmacao";

/**
 * A confirmação que espera a resposta (docs/plataforma/diagnostico-carregamento.md,
 * decisão 6 de 06/11/2026). Antes, Emitir a fatura, Remover item da tabela,
 * Remover posição e Apagar rotina fechavam no clique, antes da resposta, e a
 * falha passava sem o diálogo.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let props: ComponentProps<typeof Confirmacao>;

async function montar(patch: Partial<ComponentProps<typeof Confirmacao>> = {}) {
  props = { ...props, ...patch };
  await act(async () => raiz!.render(<Confirmacao {...props} />));
}

function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === texto);
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

  it("enquanto a ação roda: o gerúndio com o spinner, Cancelar desligado e o Esc não fecha", async () => {
    await montar({ ocupada: true });
    const confirmar = botao("Emitindo…")!;
    expect(confirmar.disabled).toBe(true);
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(confirmar.querySelector("[data-spinner]")).not.toBeNull();
    expect(botao("Cancelar")!.disabled).toBe(true);
    expect(botao("Emitir")).toBeUndefined();
    await esc();
    expect(props.onFechar).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')!.getAttribute("aria-busy")).toBe("true");
  });

  it("parada, o Esc e o Cancelar fecham", async () => {
    await montar();
    await esc();
    expect(props.onFechar).toHaveBeenCalledTimes(1);
    await act(async () => botao("Cancelar")!.click());
    expect(props.onFechar).toHaveBeenCalledTimes(2);
    expect(props.onConfirmar).not.toHaveBeenCalled();
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
  });
});
