// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { Progresso, numeroDaContagem, numeroDaEtapa, type ItemDoProgresso } from "./progresso";

/**
 * O progresso das operações longas (carregamento v2, seção 9 e momento 6):
 * "3 de 4" com a barra em segmentos e as miniaturas, e "Etapa 1 de 2" com os
 * marcadores. A barra de progresso tem nome e aria-valuetext ("3 de 4
 * fotos"), que muda por foto, nunca por byte. Dados sintéticos.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

function render(elemento: React.ReactElement) {
  act(() => raiz!.render(elemento));
}

/** O axe espera com timers de verdade. */
async function axe(html: string) {
  vi.useRealTimers();
  return violacoesDeAcessibilidade(html);
}

const barra = () => container!.querySelector<HTMLElement>('[role="progressbar"]')!;
const MINI = "blob:foto";

const subindo: ItemDoProgresso[] = [
  { estado: "feito", miniatura: MINI },
  { estado: "feito", miniatura: MINI },
  { estado: "andamento", fracao: 0.42, miniatura: MINI },
  { estado: "fila", miniatura: MINI },
];

describe("Progresso · contagem (as fotos)", () => {
  it("a barra de progresso tem o nome e o aria-valuetext \"3 de 4 fotos\"", async () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={subindo} concluido="4 fotos enviadas" />);
    expect(barra().getAttribute("aria-label")).toBe("Enviando fotos");
    expect(barra().getAttribute("aria-valuetext")).toBe("3 de 4 fotos");
    expect(barra().getAttribute("aria-valuenow")).toBe("3");
    expect(barra().getAttribute("aria-valuemin")).toBe("0");
    expect(barra().getAttribute("aria-valuemax")).toBe("4");
    // O "3" grande e o "de 4" em cinza.
    expect(barra().querySelector("b")?.textContent).toBe("3");
    expect(barra().querySelector("b")?.className).toContain("text-contagem");
    expect(textosDaTela(container!.innerHTML)).toEqual(["Enviando fotos", "3", "de 4"]);
    expect(await axe(container!.innerHTML)).toEqual([]);
  });

  it("a barra em segmentos: feitos cheios, o atual enchendo pelos bytes com as listras, os da fila só no trilho; tudo aria-hidden", () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={subindo} />);
    const segmentos = [...container!.querySelectorAll<HTMLElement>("[data-segmento]")];
    expect(segmentos.map((segmento) => segmento.dataset.estado)).toEqual(["feito", "feito", "andamento", "fila"]);
    expect(segmentos[2].style.getPropertyValue("--f")).toBe("0.42");
    expect(segmentos.map((segmento) => Boolean(segmento.querySelector('[data-parte="listras"]')))).toEqual([false, false, true, false]);
    expect(container!.querySelector(".carregando-segmentos")?.getAttribute("aria-hidden")).toBe("true");
    // As listras andam até os 5 s e param.
    expect(container!.querySelector(".carregando-segmentos")?.hasAttribute("data-parado")).toBe(false);
    act(() => vi.advanceTimersByTime(CARREGANDO.movimentoMaxMs));
    expect(container!.querySelector(".carregando-segmentos")?.hasAttribute("data-parado")).toBe(true);
  });

  it("as miniaturas: o selo verde, o véu com a caixa determinada, o contorno da fila; decorativas", () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={subindo} />);
    const miniaturas = [...container!.querySelectorAll<HTMLElement>(".carregando-miniatura")];
    expect(miniaturas.map((miniatura) => miniatura.dataset.estado)).toEqual(["feito", "feito", "andamento", "fila"]);
    expect(miniaturas[0].querySelector('[data-selo="feito"]')).not.toBeNull();
    const caixa = miniaturas[2].querySelector<HTMLElement>('[data-veu="escuro"] [data-spinner]')!;
    expect(caixa.getAttribute("data-tamanho")).toBe("24");
    expect(caixa.hasAttribute("data-determinado")).toBe(true);
    expect(caixa.style.getPropertyValue("--p")).toBe("0.42");
    expect(miniaturas[3].querySelector('[data-veu="fila"]')).not.toBeNull();
    expect(container!.querySelector(".carregando-miniaturas")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a que falhou: a caixa com o \"!\" e o próprio \"Tentar de novo\", com 44 px", async () => {
    const tentar = vi.fn();
    render(
      <Progresso
        forma="contagem"
        titulo="Enviando fotos"
        itens={[{ estado: "feito", miniatura: MINI }, { estado: "feito", miniatura: MINI }, { estado: "erro", miniatura: MINI, onTentar: tentar }, { estado: "feito", miniatura: MINI }]}
        concluido="3 fotos enviadas"
      />,
    );
    expect(textosDaTela(container!.innerHTML)).toEqual(["Enviando fotos", "3", "de 4", "Foto 3 não enviada", "Tentar de novo"]);
    // As enviadas já estão na tela; fica a miniatura da que falhou.
    expect([...container!.querySelectorAll<HTMLElement>(".carregando-miniatura")].map((miniatura) => miniatura.dataset.estado)).toEqual(["erro"]);
    const botao = [...container!.querySelectorAll("button")].find((candidato) => candidato.textContent === "Tentar de novo")!;
    expect(botao.className).toContain("min-h-11");
    act(() => botao.click());
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(await axe(container!.innerHTML)).toEqual([]);
  });

  it("no fim, a caixa fechada e \"4 fotos enviadas\"", async () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={subindo.map((item) => ({ ...item, estado: "feito" }))} concluido="4 fotos enviadas" />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["4 fotos enviadas", "4", "de 4"]);
    expect(barra().getAttribute("aria-valuetext")).toBe("4 de 4 fotos");
    expect(container!.querySelector(".carregando-caixa-cheia")).not.toBeNull();
    expect(await axe(container!.innerHTML)).toEqual([]);
  });

  it("a contagem é das feitas mais a que sobe", () => {
    expect(numeroDaContagem(subindo)).toBe(3);
    expect(numeroDaContagem([{ estado: "andamento" }, { estado: "fila" }])).toBe(1);
    expect(numeroDaContagem([{ estado: "feito" }, { estado: "erro" }])).toBe(1);
  });
});

describe("Progresso · etapas", () => {
  const etapas: ItemDoProgresso[] = [
    { rotulo: "Separação", estado: "andamento" },
    { rotulo: "Embalagem", estado: "fila" },
  ];

  it("\"Etapa 1 de 2\", com Separação e Embalagem, e a barra com o aria-valuetext da etapa", async () => {
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={etapas} />);
    expect(textosDaTela(container!.innerHTML)).toEqual(["Etapa", "1", "de 2", "Separação", "2", "Embalagem"]);
    expect(barra().getAttribute("aria-label")).toBe("Concluindo a separação");
    expect(barra().getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect(barra().getAttribute("aria-valuemin")).toBe("1");
    expect(barra().getAttribute("aria-valuemax")).toBe("2");
    expect(await axe(container!.innerHTML)).toEqual([]);
  });

  it("os marcadores de 28 px: a atual com o indicador de 24, a pendente com o número; o fio enche quando a de antes termina", () => {
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={etapas} />);
    const marcadores = [...container!.querySelectorAll<HTMLElement>(".carregando-marcador")];
    expect(marcadores.every((marcador) => marcador.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(marcadores[0].querySelector("[data-spinner]")?.getAttribute("data-tamanho")).toBe("24");
    expect(marcadores[1].querySelector('[data-vazia]')).not.toBeNull();
    expect(container!.querySelector(".carregando-fio")?.hasAttribute("data-cheio")).toBe(false);
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={[{ rotulo: "Separação", estado: "feito" }, { rotulo: "Embalagem", estado: "andamento" }]} />);
    expect(container!.querySelector(".carregando-fio")?.hasAttribute("data-cheio")).toBe(true);
    expect(barra().getAttribute("aria-valuetext")).toBe("Etapa 2 de 2");
    expect(numeroDaEtapa([{ estado: "feito" }, { estado: "feito" }])).toBe(2);
  });
});
