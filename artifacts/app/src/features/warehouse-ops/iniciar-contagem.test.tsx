// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProdutoDoCatalogo } from "@/lib/warehouse-ops/recontagem-por-caixa";
import type { EscolhaDoAlcance } from "@/lib/warehouse-ops/rodadas-da-contagem";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { botaoPeloRotulo, travado } from "@/test/botoes";
import { textosDaTela } from "@/test/textos";

import { IniciarContagemConteudo } from "./iniciar-contagem";

/**
 * "Iniciar contagem" (o registro da rodada, 18/11/2026;
 * docs/mockups/contagem-entrada/02-iniciar-contagem.png): o alcance geral,
 * por rua (a lista das ruas com caixa) ou por item (a busca no catálogo do
 * cliente), e o "Iniciar contagem" que grava. Sem legenda. Dados sintéticos.
 */

const RUAS = ["A", "B"];
const PRODUTOS: ProdutoDoCatalogo[] = [
  { sku: "BTG-000121", codigo: "A.01.0806.005.P", nome: "Polo Masculino Piquet Preto · P", barras: "" },
  { sku: "BTG-000125", codigo: "A.01.0806.005.GG", nome: "Polo Masculino Piquet Preto · GG", barras: "7890000000125" },
  { sku: "BTG-000200", codigo: "C.0900.001.U", nome: "Boné Preto", barras: "" },
];
const BOTOES = ["Cancelar", "Iniciar contagem", "Iniciando…", "Iniciada", "Não iniciada", "Conferir"];
const ALCANCE = ["Alcance", "Geral", "Por rua", "Por item"];

const noop = () => undefined;

function render(extra: Partial<Parameters<typeof IniciarContagemConteudo>[0]> = {}) {
  return renderToStaticMarkup(<IniciarContagemConteudo ruas={RUAS} produtos={PRODUTOS} catalogoFalhou={false} estado="repouso" onCancelar={noop} onIniciar={noop} {...extra} />);
}

describe("Iniciar contagem, o conteúdo", () => {
  it("só rótulos, dados e ações: o alcance geral; por rua, as ruas; por item, a busca e o escolhido", async () => {
    const geral = render();
    expect(textosDaTela(geral)).toEqual([...ALCANCE, ...BOTOES]);
    expect(geral).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Geral<\/button>/);
    expect(await violacoesDeAcessibilidade(geral)).toEqual([]);

    const porRua = render({ escolhaInicial: { tipo: "rua", rua: "B" } });
    expect(textosDaTela(porRua)).toEqual([...ALCANCE, "Rua", "Rua A", "Rua B", ...BOTOES]);
    expect(porRua).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Rua B<\/button>/);
    expect(await violacoesDeAcessibilidade(porRua)).toEqual([]);

    const porItem = render({ escolhaInicial: { tipo: "item", sku: "BTG-000125" } });
    expect(textosDaTela(porItem)).toEqual([...ALCANCE, "Item", "Polo Masculino Piquet Preto · GG", "A.01.0806.005.GG · BTG-000125", "Trocar", ...BOTOES]);
    expect(await violacoesDeAcessibilidade(porItem)).toEqual([]);

    const semItem = render({ escolhaInicial: { tipo: "item", sku: "" } });
    expect(textosDaTela(semItem)).toEqual([...ALCANCE, "Item", ...BOTOES]);
    expect(semItem).toContain('placeholder="Código ou nome do produto"');
  });

  it("iniciando, o Cancelar e o Iniciar ficam aria-disabled, nunca disabled; o catálogo que falhou avisa no item", () => {
    const html = render({ estado: "andamento" });
    expect(html).toContain('data-estado="andamento"');
    expect(html).not.toContain('disabled=""');
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
    const semCatalogo = render({ escolhaInicial: { tipo: "item", sku: "" }, catalogoFalhou: true });
    expect(textosDaTela(semCatalogo)).toContain("Não consegui carregar o catálogo.");
  });
});

describe("Iniciar contagem, a escolha", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;
  const iniciar = vi.fn<(escolha: EscolhaDoAlcance) => void>();

  async function montar() {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(<IniciarContagemConteudo ruas={RUAS} produtos={PRODUTOS} catalogoFalhou={false} estado="repouso" onCancelar={noop} onIniciar={iniciar} />);
    });
  }

  const clicar = async (rotulo: string) => {
    const botao = botaoPeloRotulo(container, rotulo);
    if (!botao) throw new Error(`Botão "${rotulo}" não encontrado.`);
    await act(async () => {
      botao.click();
    });
    return botao;
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    iniciar.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    raiz = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("geral: iniciar manda o alcance geral", async () => {
    await montar();
    await clicar("Iniciar contagem");
    expect(iniciar).toHaveBeenCalledWith({ tipo: "geral" });
  });

  it("por rua: sem rua o Iniciar fica travado; com a rua, manda a rua", async () => {
    await montar();
    await clicar("Por rua");
    expect(travado(botaoPeloRotulo(container, "Iniciar contagem")!)).toBe(true);
    await clicar("Iniciar contagem");
    expect(iniciar).not.toHaveBeenCalled();
    await clicar("Rua A");
    expect(travado(botaoPeloRotulo(container, "Iniciar contagem")!)).toBe(false);
    await clicar("Iniciar contagem");
    expect(iniciar).toHaveBeenCalledWith({ tipo: "rua", rua: "A" });
  });

  it("por item: a busca lista os produtos do cliente, o escolhido entra, e iniciar manda o SKU", async () => {
    await montar();
    await clicar("Por item");
    expect(travado(botaoPeloRotulo(container, "Iniciar contagem")!)).toBe(true);
    const busca = container.querySelector<HTMLInputElement>("input[type=search]");
    expect(busca).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(busca, "polo gg");
      busca!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...container.querySelectorAll("[data-produto]")].map((item) => item.getAttribute("data-produto"))).toEqual(["BTG-000125"]);
    await clicar("Polo Masculino Piquet Preto · GG");
    expect(container.textContent).toContain("A.01.0806.005.GG · BTG-000125");
    expect(container.querySelector("input[type=search]")).toBeNull();
    await clicar("Iniciar contagem");
    expect(iniciar).toHaveBeenCalledWith({ tipo: "item", sku: "BTG-000125" });
    // "Trocar" volta à busca.
    await clicar("Trocar");
    expect(container.querySelector("input[type=search]")).not.toBeNull();
  });
});
