// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { fichaLida } from "@/lib/rh/ficha";
import { FichaView, type AcoesDaFicha, type FichaViewProps } from "@/pages/rh/ficha-view";

/**
 * O arquivo que sobe na ficha do RH (carregamento v2, momento 3; revisão da
 * parte 13g): "Enviando o arquivo…" e a caixa seguem o relógio da espera (só
 * aos 300 ms, e pelo menos 500 ms), e o seletor de arquivo, que é o controle
 * da própria ação, nunca fica `disabled`: o foco de quem escolheu o arquivo
 * pelo teclado fica nele, com `aria-busy`. Antes, a caixa aparecia em 0 ms,
 * piscava no envio rápido, e o foco caía no body. Dados sintéticos.
 */

const ANA = "col_aaaaaaaaaaaaaaaa";
const FICHA = fichaLida({
  hoje: "2026-10-23",
  colaborador: { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true },
  registros: [
    { id: "reg_1", colaborador_id: ANA, descricao: null, resultado: null, situacao: "vigente", substituido_por: null, arquivo: null, edicao: 1, vence_em: null, categoria: "documento", tipo: "rg", emitido_em: "2015-03-02" },
  ],
  datas_do_vinculo: null,
})!;
const nada = () => undefined;
const ACOES = new Proxy({}, { get: () => nada }) as AcoesDaFicha;

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mostrar(extra: Partial<FichaViewProps>) {
  const props: FichaViewProps = { estado: "pronto", ficha: FICHA, erro: null, grava: true, formulario: null, vinculo: null, arquivando: null, ocupado: false, falha: null, acoes: ACOES, ...extra };
  act(() =>
    raiz!.render(
      <Router ssrPath="/rh/ficha">
        <FichaView {...props} />
      </Router>,
    ),
  );
}

const passar = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const seletor = () => container.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("Anexar arquivo", () => {
  it("o envio rápido (120 ms) não mostra a espera: nem a caixa nem o gerúndio piscam", () => {
    mostrar({});
    mostrar({ ocupado: true, emAndamento: "anexar:reg_1" });
    expect(container.textContent).toContain("Anexar arquivo");
    expect(container.querySelector("[data-spinner]")).toBeNull();
    passar(120);
    mostrar({});
    passar(1_000);
    expect(container.textContent).not.toContain("Enviando o arquivo…");
    expect(container.querySelector("[data-spinner]")).toBeNull();
  });

  it("o envio que demora: a caixa e o gerúndio aos 300 ms, por pelo menos 500 ms, com o foco no seletor, que nunca fica disabled", () => {
    mostrar({});
    seletor().focus();
    mostrar({ ocupado: true, emAndamento: "anexar:reg_1" });
    passar(CARREGANDO.atrasoMs);
    expect(container.textContent).toContain("Enviando o arquivo…");
    expect(container.querySelector("[data-spinner]")).not.toBeNull();
    expect(seletor().disabled).toBe(false);
    expect(seletor().getAttribute("aria-disabled")).toBe("true");
    expect(seletor().getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(seletor());
    passar(100);
    mostrar({});
    expect(container.textContent).toContain("Enviando o arquivo…");
    passar(CARREGANDO.minimoMs);
    expect(container.textContent).toContain("Anexar arquivo");
    expect(seletor().hasAttribute("aria-disabled")).toBe(false);
    expect(document.activeElement).toBe(seletor());
  });
});
