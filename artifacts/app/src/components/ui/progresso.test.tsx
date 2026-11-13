// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const falados = vi.hoisted(() => [] as string[]);
// O anunciador de verdade é estável, como este.
const anunciar = vi.hoisted(() => (texto: string) => {
  falados.push(texto);
});
vi.mock("@/lib/carregando/anunciador", () => ({ useAnuncio: () => anunciar }));

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
    // A vez acabou: o título diz o que subiu, e a contagem conta a que falhou como passada.
    expect(textosDaTela(container!.innerHTML)).toEqual(["3 fotos enviadas", "4", "de 4", "Foto 3 não enviada", "Tentar de novo"]);
    // As miniaturas ficam todas, com o selo verde nas enviadas e a caixa com o "!" na que falhou.
    expect([...container!.querySelectorAll<HTMLElement>(".carregando-miniatura")].map((miniatura) => miniatura.dataset.estado)).toEqual(["feito", "feito", "erro", "feito"]);
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
    expect(numeroDaContagem([{ estado: "feito" }, { estado: "erro" }])).toBe(2);
  });

  it("a que falhou conta como passada: com uma enviada, uma não enviada e a terceira subindo, \"3 de 4\"", () => {
    const itens: ItemDoProgresso[] = [{ estado: "feito" }, { estado: "erro", onTentar: () => undefined }, { estado: "andamento", fracao: 0.2 }, { estado: "fila" }];
    expect(numeroDaContagem(itens)).toBe(3);
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={itens} concluido="2 fotos enviadas" />);
    expect(barra().getAttribute("aria-valuetext")).toBe("3 de 4 fotos");
    // Ainda sobe: o título continua o da operação.
    expect(container!.querySelector("[data-titulo]")?.textContent).toBe("Enviando fotos");
  });

  it("a vez que termina com uma não enviada não continua dizendo \"Enviando fotos\": o título e o nome da barra viram o fim, sem a caixa verde", () => {
    render(
      <Progresso
        forma="contagem"
        titulo="Enviando fotos"
        itens={[{ estado: "feito", miniatura: MINI }, { estado: "erro", miniatura: MINI, onTentar: () => undefined }, { estado: "feito", miniatura: MINI }, { estado: "feito", miniatura: MINI }]}
        concluido="3 fotos enviadas"
      />,
    );
    expect(container!.querySelector("[data-titulo]")?.textContent).toBe("3 fotos enviadas");
    expect(barra().getAttribute("aria-label")).toBe("3 fotos enviadas");
    expect(barra().getAttribute("aria-valuetext")).toBe("4 de 4 fotos");
    // A caixa fechada é do fim sem falha.
    expect(container!.querySelector("[data-titulo] .carregando-caixa-cheia")).toBeNull();
  });

  it("no fim, o nome da barra é o que o título diz", () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={subindo.map((item) => ({ ...item, estado: "feito" }))} concluido="4 fotos enviadas" />);
    expect(barra().getAttribute("aria-label")).toBe("4 fotos enviadas");
    // As enviadas ficam com o selo verde, como na prancha: o bloco não encolhe no fim.
    expect([...container!.querySelectorAll<HTMLElement>(".carregando-miniatura")].map((miniatura) => miniatura.dataset.estado)).toEqual(["feito", "feito", "feito", "feito"]);
    expect(container!.querySelectorAll('[data-selo="feito"]')).toHaveLength(4);
  });

  it("cada \"Tentar de novo\" diz de qual foto é, e o foco não cai no corpo quando ele sai", () => {
    const tentar = vi.fn();
    const itens: ItemDoProgresso[] = [
      { estado: "feito", miniatura: MINI },
      { estado: "erro", miniatura: MINI, onTentar: tentar },
      { estado: "erro", miniatura: MINI, onTentar: tentar },
      { estado: "feito", miniatura: MINI },
    ];
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={itens} concluido="2 fotos enviadas" />);
    const botoes = [...container!.querySelectorAll<HTMLButtonElement>("button")];
    const descricoes = botoes.map((botao) => document.getElementById(botao.getAttribute("aria-describedby") ?? "")?.textContent);
    expect(descricoes).toEqual(["Foto 2 não enviada", "Foto 3 não enviada"]);
    // O da foto 2 sai da tela: o foco vai para o da foto 3.
    botoes[0].focus();
    act(() => botoes[0].click());
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={itens.map((item, indice) => (indice === 1 ? { ...item, estado: "andamento" as const, onTentar: undefined } : item))} concluido="2 fotos enviadas" />);
    expect(document.activeElement?.textContent).toBe("Tentar de novo");
    expect(document.getElementById(document.activeElement!.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Foto 3 não enviada");
    // O último sai: o foco vai para o título da operação.
    act(() => (document.activeElement as HTMLButtonElement).click());
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={itens.map((item, indice) => (indice === 1 ? { ...item, estado: "andamento" as const, onTentar: undefined } : indice === 2 ? { ...item, estado: "fila" as const, onTentar: undefined } : item))} concluido="2 fotos enviadas" />);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.hasAttribute("data-titulo")).toBe(true);
    expect(tentar).toHaveBeenCalledTimes(2);
  });

  it("a que sobe sem os bytes medidos (o envio de uma vez, até 256 KB) gira, e não fica com cara de fila", () => {
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={[{ estado: "andamento", miniatura: MINI }, { estado: "fila", miniatura: MINI }]} />);
    const segmentos = [...container!.querySelectorAll<HTMLElement>("[data-segmento]")];
    expect(segmentos[0].hasAttribute("data-medido")).toBe(false);
    const caixa = container!.querySelector<HTMLElement>('.carregando-miniatura[data-estado="andamento"] [data-spinner]')!;
    expect(caixa.hasAttribute("data-determinado")).toBe(false);
    // Com o primeiro byte medido, a caixa passa a fechar pelos bytes.
    render(<Progresso forma="contagem" titulo="Enviando fotos" itens={[{ estado: "andamento", fracao: 0.3, miniatura: MINI }, { estado: "fila", miniatura: MINI }]} />);
    expect(container!.querySelector<HTMLElement>("[data-segmento]")!.hasAttribute("data-medido")).toBe(true);
    expect(container!.querySelector<HTMLElement>('.carregando-miniatura[data-estado="andamento"] [data-spinner]')!.hasAttribute("data-determinado")).toBe(true);
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
    const marcadores = () => [...container!.querySelectorAll<HTMLElement>(".carregando-marcador")];
    expect(marcadores().every((marcador) => marcador.getAttribute("aria-hidden") === "true")).toBe(true);
    // Nada aparece antes de 300 ms: a etapa que anda fica pendente até lá.
    expect(marcadores()[0].querySelector("[data-spinner]")).toBeNull();
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(marcadores()[0].querySelector("[data-spinner]")?.getAttribute("data-tamanho")).toBe("24");
    expect(marcadores()[1].querySelector('[data-vazia]')).not.toBeNull();
    expect(container!.querySelector(".carregando-fio")?.hasAttribute("data-cheio")).toBe(false);
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={[{ rotulo: "Separação", estado: "feito" }, { rotulo: "Embalagem", estado: "andamento" }]} />);
    expect(container!.querySelector(".carregando-fio")?.hasAttribute("data-cheio")).toBe(true);
    expect(barra().getAttribute("aria-valuetext")).toBe("Etapa 2 de 2");
    expect(numeroDaEtapa([{ estado: "feito" }, { estado: "feito" }])).toBe(2);
  });

  it("o Anunciador fala a entrada na espera aos 300 ms, uma vez, e não antes", () => {
    // Em repouso, com as etapas pendentes, nada espera e nada é falado.
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={etapas.map((item) => ({ ...item, estado: "fila" as const }))} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(falados).toEqual([]);
    expect(barra().getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    render(<Progresso forma="etapas" titulo="Concluindo a separação" itens={etapas} />);
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs - 1));
    expect(falados).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(falados).toEqual(["Concluindo a separação"]);
    act(() => vi.advanceTimersByTime(CARREGANDO.demoraMs));
    expect(falados).toEqual(["Concluindo a separação"]);
  });

  it("três etapas marcam a caixa para a forma estreita (os rótulos sob os marcadores, quando não cabem lado a lado)", () => {
    render(<Progresso forma="etapas" titulo="Anexando ao Agent Dute" itens={[{ rotulo: "Cadastro", estado: "andamento" }, { rotulo: "Arquivo", estado: "fila" }, { rotulo: "Trechos", estado: "fila" }]} />);
    expect(container!.querySelector(".carregando-etapas")?.getAttribute("data-n")).toBe("3");
    expect(container!.querySelector(".carregando-etapas-caixa")).not.toBeNull();
  });

  it("duas etapas também vão para a forma estreita na caixa do celular, e três já a partir de 26rem", () => {
    // O jsdom não avalia a consulta de contêiner: a regra fica travada no index.css.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const consulta = (largura: string) => {
      const inicio = css.indexOf(`@container (max-width: ${largura})`);
      return inicio < 0 ? "" : css.slice(inicio, css.indexOf("\n  }\n", inicio));
    };
    expect(consulta("21rem")).toContain('.carregando-etapas:not([data-n="1"]) > [data-etapa]');
    expect(consulta("21rem")).toContain("flex-direction: column");
    expect(consulta("26rem")).toContain('.carregando-etapas:not([data-n="1"], [data-n="2"]) > [data-etapa]');
  });
});
