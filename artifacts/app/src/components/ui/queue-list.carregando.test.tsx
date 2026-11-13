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
    expect(textosDaTela(opcoes(6))).toEqual(["Em aberto · 6", "Entregues"]);
    expect(textosDaTela(opcoes(0))).toEqual(["Em aberto", "Entregues"]);
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
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    expect(container.querySelector('h2 [data-forma="contagem"]')).toBeNull();
    const titulos = [...container.querySelectorAll("h2")].map((titulo) => titulo.textContent);
    expect(titulos).toEqual(["Para aprovar3", "Para separar", "Para entregar1"]);
    // O número entra subindo, como o que rola.
    expect(container.querySelector('h2 [data-conta="entra"]')?.textContent).toBe("3");
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
  });

  it("o grupo que sempre teve o dado não chega: nada de cascata (a releitura e a lista sem saltos)", async () => {
    desenhar(<Lista lendo={false} />);
    expect(container.querySelector("[data-chegada], [data-chegada-vazio]")).toBeNull();
    expect(DURACAO_DA_CHEGADA_MS).toBe(CARREGANDO.chegadaMs + (CARREGANDO.linhasNaCascata - 1) * CARREGANDO.passoMs);
  });

  it("a cascata e a entrada dos fantasmas no CSS: só opacidade e a subida de 4 px, 30 ms por linha, até a sexta", () => {
    expect(regra("[data-fantasmas]:not([data-visivel])")).toEqual({ opacity: "0" });
    expect(regra("[data-fantasmas][data-visivel]").animation).toBe("carregando-aparece var(--carregando-t-entrada) var(--ease-carregando-entrada) both");
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
