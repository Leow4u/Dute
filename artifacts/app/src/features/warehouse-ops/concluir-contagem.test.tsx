// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { botaoPeloRotulo, travado } from "@/test/botoes";
import { textosDaTela } from "@/test/textos";

import { ConcluirContagemConteudo } from "./concluir-contagem";

/**
 * "Concluir contagem" (o registro da rodada, 18/11/2026; decisão 1 do
 * Leonardo): os números da rodada como a tela os tem e o aviso de quantas
 * prateleiras por contar ficam fora; conclui mesmo assim. Sem legenda.
 */

const RODADA: RodadaDaContagem = {
  rodada: "cr_1",
  titulo: "Contagem geral · 19/11/2026",
  comeco: { quando: "2026-11-19T11:10:00.000Z", quem: "Guilherme Dantas" },
  prateleiras: 5,
  prateleirasContadas: 2,
  caixas: 6,
  caixasConfirmadas: 3,
  caixasComDiferenca: 1,
  diferenca: -3,
  ruas: [],
  continuar: "B-10",
  alcance: { tipo: "geral" },
  concluida: null,
};
const NUMEROS = ["Contagem geral · 19/11/2026", "Prateleiras contadas", "2 de 5", "Caixas confirmadas", "3 de 6", "Caixas com diferença", "1", "Diferença líquida", "−3 un."];
const BOTOES = ["Cancelar", "Concluir contagem", "Concluindo…", "Concluída", "Não concluída", "Conferir"];
const noop = () => undefined;

function render(extra: Partial<Parameters<typeof ConcluirContagemConteudo>[0]> = {}) {
  return renderToStaticMarkup(<ConcluirContagemConteudo rodada={RODADA} estado="repouso" onCancelar={noop} onConcluir={noop} {...extra} />);
}

describe("Concluir contagem, o conteúdo", () => {
  it("só rótulos, dados e ações: os números e o aviso das prateleiras por contar; com tudo contado, sem aviso", async () => {
    const html = render();
    expect(textosDaTela(html)).toEqual([...NUMEROS, "3 prateleiras por contar ficam fora.", ...BOTOES]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    const tudoContado = render({ rodada: { ...RODADA, prateleirasContadas: 5, caixasConfirmadas: 6 } });
    expect(textosDaTela(tudoContado)).toEqual(["Contagem geral · 19/11/2026", "Prateleiras contadas", "5 de 5", "Caixas confirmadas", "6 de 6", "Caixas com diferença", "1", "Diferença líquida", "−3 un.", ...BOTOES]);
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
  });

  it("concluindo, o Cancelar e o Concluir ficam aria-disabled, nunca disabled", () => {
    const html = render({ estado: "andamento" });
    expect(html).toContain('data-estado="andamento"');
    expect(html).not.toContain('disabled=""');
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
  });
});

describe("Concluir contagem, a ação", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;
  const concluir = vi.fn();
  const cancelar = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    concluir.mockReset();
    cancelar.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    raiz = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("Concluir contagem chama onConcluir uma vez; Cancelar chama onCancelar", async () => {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(<ConcluirContagemConteudo rodada={RODADA} estado="repouso" onCancelar={cancelar} onConcluir={concluir} />);
    });
    const botao = botaoPeloRotulo(container, "Concluir contagem")!;
    expect(travado(botao)).toBe(false);
    await act(async () => {
      botao.click();
    });
    expect(concluir).toHaveBeenCalledTimes(1);
    await act(async () => {
      botaoPeloRotulo(container, "Cancelar")!.click();
    });
    expect(cancelar).toHaveBeenCalledTimes(1);
  });
});
