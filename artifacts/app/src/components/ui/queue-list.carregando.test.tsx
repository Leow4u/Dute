// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ClipboardCheck, Package } from "lucide-react";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { DURACAO_DA_CHEGADA_MS } from "@/lib/carregando/use-chegada";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { QueueGroup, QueueRow } from "./queue-list";
import { Segmented } from "./segmented";

/**
 * A lista com a forma final na primeira leitura (carregamento v2, momento 2,
 * e a decisão P3 de 12/11/2026): o grupo com o título real desde 0 ms, o
 * bloco no lugar do número (nunca "0") e o cartão com as linhas-fantasma na
 * altura reservada, invisíveis até os 300 ms; na chegada, as linhas reais
 * entram em cascata e o bloco vira número. E as props novas da QueueRow:
 * ocupada, apoio em andamento e aviso. Dados sintéticos.
 */

// No ambiente jsdom o Vite reescreve `new URL(..., import.meta.url)` como endereço de asset.
const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** As declarações da regra do index.css com exatamente esse seletor (ou lista de seletores). */
function regra(seletor: string): Record<string, string> {
  const inicio = CSS.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`sem a regra ${seletor}`);
  const corpo = CSS.slice(CSS.indexOf("{", inicio) + 1, CSS.indexOf("}", inicio));
  return Object.fromEntries(
    corpo
      .split(";")
      .map((linha) => linha.trim())
      .filter(Boolean)
      .map((linha) => [linha.slice(0, linha.indexOf(":")).trim(), linha.slice(linha.indexOf(":") + 1).trim()]),
  );
}

/** O texto que fica na árvore de acessibilidade: sem o que é aria-hidden. */
function naArvore(elemento: Element): string {
  const copia = elemento.cloneNode(true) as Element;
  copia.querySelectorAll('[aria-hidden="true"]').forEach((escondido) => escondido.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ").trim();
}

function linhaReal(titulo: string) {
  return <QueueRow icon={ClipboardCheck} tone="approve" title={titulo} meta="Retirada · BTG Pactual · 3 itens · 12 un." actions={<Button type="button">Aprovar</Button>} />;
}

describe("o grupo antes de ler", () => {
  const grupo = (semSaltos: boolean) =>
    renderToStaticMarkup(
      <div className="v3">
        <QueueGroup title="Para aprovar" count={null} empty="Nenhum pedido para aprovar." carregando={{ linhas: 3, acoes: 2 }} semSaltos={semSaltos} rolarContagem={semSaltos}>
          {null}
        </QueueGroup>
      </div>,
    );

  it.each([false, true])("o título real, o bloco no lugar do número e as linhas-fantasma, nunca 0 nem Nenhum (sem saltos: %s)", async (semSaltos) => {
    const html = grupo(semSaltos);
    const documento = new DOMParser().parseFromString(html, "text/html");
    const titulo = documento.querySelector("h2")!;
    expect(naArvore(titulo)).toBe("Para aprovar");
    const bloco = titulo.querySelector('[data-esqueleto][data-forma="contagem"]');
    expect(bloco, "o bloco no lugar do número").not.toBeNull();
    expect(bloco!.getAttribute("aria-hidden")).toBe("true");
    expect(textosDaTela(html)).toEqual(["Para aprovar"]);
    expect(html).not.toMatch(/Nenhum|>0</);
    // As linhas-fantasma, com a anatomia da linha real: a caixa do ícone, o título, o apoio e os dois botões.
    const fantasmas = documento.querySelector("[data-fantasmas]")!;
    expect(fantasmas.getAttribute("aria-hidden")).toBe("true");
    const linhas = fantasmas.querySelectorAll("[data-linha-fantasma]");
    expect(linhas).toHaveLength(3);
    for (const linha of linhas) {
      expect(linha.querySelectorAll('[data-forma="icone"]')).toHaveLength(1);
      expect(linha.querySelectorAll('[data-forma="texto"]')).toHaveLength(2);
      expect(linha.querySelectorAll('[data-forma="botao"]')).toHaveLength(2);
    }
    // Antes dos 300 ms elas guardam a altura, sem aparecer, e sem brilho.
    expect(fantasmas.hasAttribute("data-visivel")).toBe(false);
    expect(fantasmas.hasAttribute("data-brilho")).toBe(false);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a linha-fantasma tem a altura da linha real: as mesmas linhas de texto (24 e 20 px), a caixa de 44 e os botões de 40", () => {
    const html = grupo(false);
    expect(html).toContain('class="flex h-6 items-center"');
    expect(html).toContain('class="mt-0.5 flex h-5 items-center"');
    expect(html).toMatch(/data-forma="botao" class="carregando-esqueleto w-37"/);
    // No celular os botões vêm embaixo, na largura toda, como os da linha real.
    expect(html).toContain("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5");
    expect(html).toContain("[&amp;&gt;*]:flex-1 sm:[&amp;&gt;*]:flex-none");
  });

  it("a linha-fantasma do pedido tem a anatomia dele: a linha do atalho (Ver volumes) e, no celular, as ações no bloco de baixo", () => {
    const pedido = renderToStaticMarkup(
      <QueueGroup title="Para entregar" count={null} empty="" carregando={{ linhas: 1, acoes: 1, atalho: true, acoesAbaixo: true }}>
        {null}
      </QueueGroup>,
    );
    // O atalho: 6 px acima e a linha de 16 px do texto pequeno, como o "Ver volumes" (mt-1.5 e text-xs).
    expect(pedido).toContain('<span class="mt-1.5 flex h-4 items-center"><span aria-hidden="true" data-esqueleto="" data-forma="texto" class="carregando-esqueleto h-2.5 w-20"></span></span>');
    // No celular, o bloco das ações do pedido fica 16 px mais abaixo que o da linha de sempre (o py-4 da linha antes dele).
    expect(pedido).toContain("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 md:px-5 max-sm:gap-7");
    const fila = grupo(false);
    expect(fila).not.toContain("max-sm:gap-7");
    expect(fila).not.toContain("h-2.5 w-20");
  });

  it("o número do grupo tem contraste de texto (4,5:1): o --muted-foreground, e não a tinta a 50%", () => {
    expect(grupo(false)).toContain('<span class="text-sm text-muted-foreground">');
    expect(grupo(false)).not.toContain("text-foreground/50");
  });

  it("sem ação, a linha-fantasma não tem botão; com uma, um", () => {
    const sem = renderToStaticMarkup(<QueueGroup title="Entregues" count={null} empty="" carregando={{ linhas: 1, acoes: 0 }}>{null}</QueueGroup>);
    const uma = renderToStaticMarkup(<QueueGroup title="Para separar" count={null} empty="" carregando={{ linhas: 2, acoes: 1 }}>{null}</QueueGroup>);
    expect(sem).not.toContain('data-forma="botao"');
    expect(uma.match(/data-forma="botao"/g)).toHaveLength(2);
  });

  it("o segmentado diz Em aberto com o bloco, fora da árvore; depois o número, e zero não mostra número", () => {
    const opcoes = (count: number | null) =>
      renderToStaticMarkup(
        <Segmented value="open" onChange={() => undefined} aria-label="Pedidos em aberto ou entregues" options={[{ value: "open", label: "Em aberto", count }, { value: "delivered", label: "Entregues" }]} />,
      );
    const lendo = new DOMParser().parseFromString(opcoes(null), "text/html");
    const aberto = lendo.querySelector("button")!;
    expect(naArvore(aberto)).toBe("Em aberto");
    expect(aberto.querySelector('[aria-hidden="true"] [data-esqueleto][data-forma="contagem"]')).not.toBeNull();
    // O número fica na casa do bloco, de 16 px, e o rótulo não anda quando ele chega (a prancha, .conta-seg).
    expect(textosDaTela(opcoes(6))).toEqual(["Em aberto ·", "6", "Entregues"]);
    expect(new DOMParser().parseFromString(opcoes(6), "text/html").querySelector("button")!.textContent).toBe("Em aberto · 6");
    const casa = (count: number | null) => new DOMParser().parseFromString(opcoes(count), "text/html").querySelector("button span.min-w-4");
    expect(casa(null)?.className).toBe(casa(6)?.className);
    expect(casa(6)?.className).toContain("inline-grid min-w-4 justify-items-start");
    expect(textosDaTela(opcoes(0))).toEqual(["Em aberto", "Entregues"]);
    // No celular, 44 px de alvo em cada opção (seção 7): o grupo tem 44 px sem borda nem respiro que ocupem lugar (o
    // contorno é por dentro), e a opção marcada é a pílula 3 px para dentro, desenhada só no miolo (a borda
    // transparente também é toque).
    const html = new DOMParser().parseFromString(opcoes(6), "text/html");
    const doGrupo = html.querySelector('[role="group"]')!.className.split(" ");
    expect(doGrupo).toEqual(expect.arrayContaining(["max-md:h-11", "max-md:border-0", "max-md:p-0", "max-md:gap-0", "max-md:inset-ring", "max-md:inset-ring-border"]));
    for (const opcao of html.querySelectorAll("button")) {
      expect(opcao.className.split(" ")).toEqual(expect.arrayContaining(["h-full", "max-md:border-3", "max-md:border-transparent", "max-md:bg-clip-padding"]));
    }
    // Pedidos e Receber: no celular o segmentado ocupa a linha das ações, com as opções em partes iguais, e no estreito
    // aperta a margem em vez de sair da tela (320 px).
    const cheio = new DOMParser().parseFromString(
      renderToStaticMarkup(<Segmented value="open" onChange={() => undefined} cheioNoCelular options={[{ value: "open", label: "Em aberto", count: null }, { value: "done", label: "Recebidos" }]} />),
      "text/html",
    );
    expect(cheio.querySelector('[role="group"]')!.className.split(" ")).toEqual(expect.arrayContaining(["max-sm:flex", "max-sm:min-w-fit", "max-sm:flex-1"]));
    for (const opcao of cheio.querySelectorAll("button")) expect(opcao.className.split(" ")).toEqual(expect.arrayContaining(["max-sm:flex-1", "max-sm:px-1"]));
    expect(doGrupo).not.toContain("max-sm:flex-1");
    // No controle selecionado, de fundo em tinta, o bloco fica na cor do texto dele.
    expect(regra('[aria-pressed="true"] .carregando-esqueleto')["background-color"]).toBe("hsl(var(--background) / 0.35)");
  });
});

describe("o grupo no tempo: os fantasmas aos 300 ms e a chegada", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    raiz = null;
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function desenhar(elemento: ReactElement) {
    raiz ??= createRoot(container);
    act(() => raiz!.render(elemento));
  }

  function Lista({ lendo, semSaltos = false }: { lendo: boolean; semSaltos?: boolean }) {
    const linhas = lendo ? [] : ["Pedido 1042", "Pedido 1043", "Pedido 1045"];
    return (
      <div className="v3">
        <QueueGroup title="Para aprovar" count={lendo ? null : 3} empty="Nenhum pedido para aprovar." carregando={lendo ? { linhas: 3, acoes: 2, ordem: 0 } : undefined} semSaltos={semSaltos} rolarContagem={semSaltos}>
          {linhas.map((titulo) => (
            <div key={titulo} data-chave={titulo}>
              {linhaReal(titulo)}
            </div>
          ))}
        </QueueGroup>
        <QueueGroup title="Para separar" count={lendo ? null : 0} empty="Nenhum pedido para separar." carregando={lendo ? { linhas: 2, acoes: 1, ordem: 1 } : undefined} cascata={3}>
          {null}
        </QueueGroup>
        <QueueGroup title="Para entregar" count={lendo ? null : 1} empty="Nenhum pedido para entregar." carregando={lendo ? { linhas: 1, acoes: 1, ordem: 2 } : undefined} cascata={3}>
          <QueueRow icon={Package} tone="deliver" title="PED-1036" meta="2 volumes · lacre 88231" />
        </QueueGroup>
      </div>
    );
  }

  it("de 0 a 300 ms as linhas-fantasma guardam a altura sem aparecer; aos 300 ms entram, e o cartão ganha o brilho, um depois do outro", async () => {
    desenhar(<Lista lendo />);
    await passar(CARREGANDO.atrasoMs - 10);
    expect(container.querySelectorAll("[data-fantasmas]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-fantasmas][data-visivel]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-brilho]")).toHaveLength(0);
    await passar(20);
    const visiveis = [...container.querySelectorAll<HTMLElement>("[data-fantasmas][data-visivel]")];
    expect(visiveis).toHaveLength(3);
    // O brilho de cada cartão começa 120 ms depois do anterior (a --ordem do CartaoComBrilho).
    expect(visiveis.map((cartao) => cartao.hasAttribute("data-brilho") && cartao.style.getPropertyValue("--ordem"))).toEqual(["0", "1", "2"]);
    expect(visiveis.every((cartao) => cartao.getAttribute("aria-hidden") === "true")).toBe(true);
    // As linhas-fantasma guardam a contagem de cada grupo.
    expect(visiveis.map((cartao) => cartao.querySelectorAll("[data-linha-fantasma]").length)).toEqual([3, 2, 1]);
  });

  it("na chegada, as linhas reais tomam o lugar dos fantasmas em cascata, a partir da posição de cada grupo na tela, e o bloco vira número", async () => {
    desenhar(<Lista lendo />);
    await passar(1_000);
    desenhar(<Lista lendo={false} />);
    // Os fantasmas que estavam na tela ficam por baixo das linhas reais, fora do fluxo e da árvore, e esmaecem
    // (data-saindo): nenhum quadro com o cartão vazio.
    const saindo = [...container.querySelectorAll<HTMLElement>("[data-fantasmas]")];
    expect(saindo).toHaveLength(3);
    expect(saindo.every((cartao) => cartao.hasAttribute("data-saindo") && cartao.hasAttribute("data-visivel") && cartao.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(saindo.every((cartao) => cartao.classList.contains("absolute"))).toBe(true);
    expect(saindo.map((cartao) => cartao.querySelectorAll("[data-linha-fantasma]").length)).toEqual([3, 2, 1]);
    expect(saindo.map((cartao) => cartao.style.getPropertyValue("--chegada-desde"))).toEqual(["0", "3", "3"]);
    // Por baixo: as linhas reais vêm depois no cartão.
    for (const cartao of saindo) expect(cartao.compareDocumentPosition(cartao.parentElement!.querySelector("[data-chegada], [data-chegada-vazio]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const titulos = [...container.querySelectorAll("h2")].map((titulo) => titulo.textContent);
    expect(titulos).toEqual(["Para aprovar3", "Para separar", "Para entregar1"]);
    // O número entra subindo, como o que rola, e o bloco sai subindo no mesmo lugar, fora da árvore.
    expect(container.querySelector('h2 [data-conta="entra"]')?.textContent).toBe("3");
    expect([...container.querySelectorAll('h2 [data-forma="contagem"]')].every((bloco) => bloco.closest('[data-conta="sai"][aria-hidden="true"]'))).toBe(true);
    const listas = [...container.querySelectorAll<HTMLElement>("[data-chegada]")];
    expect(listas).toHaveLength(2);
    expect(listas.map((lista) => lista.style.getPropertyValue("--chegada-desde"))).toEqual(["0", "3"]);
    // O vazio do grupo chega como a primeira linha dele.
    const vazio = container.querySelector<HTMLElement>("[data-chegada-vazio]");
    expect(vazio?.textContent).toBe("Nenhum pedido para separar.");
    expect(vazio?.style.getPropertyValue("--chegada-desde")).toBe("3");
    // Acabada a cascata, a lista fica como sempre: o que chegar depois é da lista sem saltos.
    await passar(DURACAO_DA_CHEGADA_MS);
    expect(container.querySelector("[data-chegada], [data-chegada-vazio]")).toBeNull();
    expect(container.querySelector('h2 [data-conta="entra"]')).toBeNull();
    expect(container.querySelector("[data-fantasmas], h2 [data-forma=\"contagem\"]")).toBeNull();
  });

  it("a chegada acaba com as animações dela, não num relógio: a cascata que começou tarde (o celular lento) não é cortada", async () => {
    // O navegador: as animações da chegada nascem no primeiro quadro pintado, que no celular lento vem depois dos
    // 300 ms do relógio. Aqui elas terminam aos 700 ms; até lá, a lista segue com a cascata e os fantasmas por baixo.
    let terminar: () => void = () => undefined;
    const terminou = new Promise<void>((pronto) => {
      terminar = pronto;
    });
    const animacoes: Array<{ animationName: string; playState: string; finished: Promise<void> }> = [];
    const daChegada = (nome: string) => {
      const animacao = { animationName: nome, playState: "running", finished: terminou.then(() => undefined) };
      animacoes.push(animacao);
      return animacao;
    };
    vi.stubGlobal("requestAnimationFrame", (quadro: FrameRequestCallback) => setTimeout(() => quadro(performance.now()), 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value(this: Element) {
        // As linhas que entram, o número que entra e os fantasmas que esmaecem; o brilho, que não é da chegada, segue.
        const vivas = animacoes.filter((animacao) => animacao.playState !== "finished");
        return vivas.length ? [...vivas, { animationName: "carregando-brilho", playState: "running", finished: new Promise(() => undefined) }] : [];
      },
    });
    try {
      desenhar(<Lista lendo />);
      await passar(1_000);
      daChegada("carregando-chega-linha");
      daChegada("carregando-conta-entra");
      daChegada("carregando-some");
      desenhar(<Lista lendo={false} />);
      await passar(DURACAO_DA_CHEGADA_MS + 100);
      expect(container.querySelectorAll("[data-chegada]")).toHaveLength(2);
      expect(container.querySelectorAll("[data-fantasmas][data-saindo]")).toHaveLength(3);
      for (const animacao of animacoes) animacao.playState = "finished";
      terminar();
      await passar(50);
      expect(container.querySelector("[data-chegada], [data-chegada-vazio], [data-fantasmas]")).toBeNull();
    } finally {
      if (original) Object.defineProperty(Element.prototype, "getAnimations", original);
      else delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it("a chegada antes dos 300 ms não tem fantasma para esmaecer: as linhas entram direto", async () => {
    desenhar(<Lista lendo />);
    await passar(CARREGANDO.atrasoMs - 50);
    desenhar(<Lista lendo={false} />);
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    expect(container.querySelectorAll("[data-chegada]")).toHaveLength(2);
  });

  it("o grupo que sempre teve o dado não chega: nada de cascata (a releitura e a lista sem saltos)", async () => {
    desenhar(<Lista lendo={false} />);
    expect(container.querySelector("[data-chegada], [data-chegada-vazio]")).toBeNull();
    expect(DURACAO_DA_CHEGADA_MS).toBe(CARREGANDO.chegadaMs + (CARREGANDO.linhasNaCascata - 1) * CARREGANDO.passoMs);
  });

  it("a cascata e a entrada dos fantasmas no CSS: só opacidade e a subida de 4 px, 30 ms por linha, até a sexta", () => {
    expect(regra("[data-fantasmas]:not([data-visivel])")).toEqual({ opacity: "0" });
    expect(regra("[data-fantasmas][data-visivel]").animation).toBe("carregando-aparece var(--carregando-t-entrada) var(--ease-carregando-entrada) both");
    // Na chegada, os fantasmas esmaecem em 150 ms por baixo das linhas reais, só por opacidade, e não recebem toque.
    expect(regra("[data-fantasmas][data-visivel][data-saindo]")).toEqual({
      "pointer-events": "none",
      animation: "carregando-some var(--carregando-t-chegada) var(--ease-carregando-saida) both",
      // Junto com a primeira linha do grupo na cascata: o cartão de baixo não fica vazio esperando a vez dela.
      "animation-delay": "calc(min(var(--chegada-desde, 0), 5) * var(--carregando-passo))",
    });
    const chegada = regra("[data-chegada] > *,\n  [data-chegada-vazio]");
    expect(chegada.animation).toBe("carregando-chega-linha var(--carregando-t-chegada) var(--ease-carregando-entrada) both");
    expect(chegada["animation-delay"]).toBe(
      `calc(min(var(--chegada-desde, 0) + var(--chegada-i, ${CARREGANDO.linhasNaCascata - 1}), ${CARREGANDO.linhasNaCascata - 1}) * var(--carregando-passo))`,
    );
    // Uma posição por linha até a quinta; da sexta em diante, a última.
    const posicoes = [...CSS.matchAll(/\[data-chegada\] > :nth-child\((\d+)\)[^{]*\{\s*--chegada-i: (\d+);/g)].map((achado) => [Number(achado[1]), Number(achado[2])]);
    expect(posicoes).toEqual(Array.from({ length: CARREGANDO.linhasNaCascata - 1 }, (_, indice) => [indice + 1, indice]));
    // A lista sem saltos vem depois: a linha que sai ou chega manda na animação dela.
    expect(CSS.indexOf("[data-chegada] > *")).toBeLessThan(CSS.indexOf('[data-na-lista="chegando"] {'));
  });
});

describe("a linha com a ação em andamento (QueueRow)", () => {
  const linha = (props: Partial<Parameters<typeof QueueRow>[0]>) =>
    renderToStaticMarkup(
      <QueueRow icon={ClipboardCheck} tone="approve" title="Pedido 1042" meta="Retirada · BTG Pactual · 3 itens · 12 un." age="há 25 min" {...props} />,
    );

  it("ocupada: aria-busy na linha até a resposta; livre, sem ele", () => {
    expect(linha({ ocupada: true })).toMatch(/^<div aria-busy="true" class="flex flex-col/);
    expect(linha({})).not.toContain("aria-busy");
  });

  it("o apoio em andamento toma o lugar do meta e da idade, em tinta e 700; o aviso vem antes dele", async () => {
    const andando = linha({ apoioEmAndamento: "Aprovando pedido 1042…" });
    expect(textosDaTela(andando)).toEqual(["Pedido 1042", "Aprovando pedido 1042…"]);
    expect(andando).toContain('<span class="font-bold text-foreground">Aprovando pedido 1042…</span>');
    const comAviso = linha({ apoioEmAndamento: "Aprovando pedido 1042…", aviso: <span>Demorando mais que o normal</span> });
    expect(textosDaTela(comAviso)).toEqual(["Pedido 1042", "Demorando mais que o normal"]);
    // Sem nenhum dos dois, o meta e a idade, como sempre.
    expect(textosDaTela(linha({}))).toEqual(["Pedido 1042", "Retirada · BTG Pactual · 3 itens · 12 un.", "· há 25 min"]);
    expect(await violacoesDeAcessibilidade(linha({ ocupada: true, apoioEmAndamento: "Aprovando pedido 1042…" }))).toEqual([]);
  });
});
