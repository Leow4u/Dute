import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { PageHeader } from "./page-header";
import { QueueGroup, QueueRow } from "./queue-list";

/** A fila do WMS (Pedidos, Receber) e o cabeçalho da página na v3 (parte 4.7c). */

const CSS = readFileSync(new URL("../../index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** As declarações da regra do index.css com exatamente esse seletor. */
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

function fila() {
  return renderToStaticMarkup(
    <div className="v3">
      <PageHeader title="Pedidos" />
      <QueueGroup title="Para separar" count={1} empty="Nenhum pedido para separar.">
        <QueueRow icon={Package} tone="pick" title="PED-0118" meta="BTG Pactual · 3 itens" age="há 2 h" actions={<Button type="button">Separado</Button>} />
      </QueueGroup>
      <QueueGroup title="Para entregar" count={0} empty="Nenhum pedido para entregar.">
        {null}
      </QueueGroup>
    </div>,
  );
}

describe("a fila e o cabeçalho na v3", () => {
  it("o título, o grupo e a linha seguem a v3 dentro do .v3", () => {
    const html = fila();
    expect(html).toMatch(/<h1 class="[^"]*in-\[\.v3\]:text-3xl[^"]*in-\[\.v3\]:font-extrabold[^"]*">Pedidos<\/h1>/);
    expect(html).toMatch(/<span class="[^"]*in-\[\.v3\]:text-lg[^"]*">Para separar<\/span>/);
    expect(html).toMatch(/<p class="[^"]*in-\[\.v3\]:font-bold[^"]*">PED-0118<\/p>/);
    expect(html).toContain(">Nenhum pedido para entregar.<");
  });

  it("o grupo mostra só a contagem, sem legenda", () => {
    expect(fila()).toMatch(/>Para separar<\/span><span class="[^"]*">1<\/span>/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(fila())).toEqual([]);
  });

  it("o selo opcional fica ao lado do título, sem mudar a linha sem selo", async () => {
    const html = renderToStaticMarkup(
      <div className="v3">
        <QueueGroup title="Para guardar" count={1} empty="Nada para guardar.">
          <QueueRow icon={Package} tone="store" title="Guardar caixa CX-000132" badge={<span>sem prateleira</span>} meta="POLO GG · 18 un. · está em RECEBIMENTO" />
        </QueueGroup>
      </div>,
    );
    expect(html).toMatch(/<p class="[^"]*">Guardar caixa CX-000132<span class="ml-2 inline-flex align-middle"><span>sem prateleira<\/span><\/span><\/p>/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o atalho opcional fica ao lado de Ver itens, sem mudar a linha sem atalho", async () => {
    const linha = (atalho?: boolean) =>
      renderToStaticMarkup(
        <div className="v3">
          <QueueGroup title="Para separar" count={1} empty="Nenhum pedido para separar.">
            <QueueRow
              icon={Package}
              tone="pick"
              title="PED-0001"
              meta="116 itens · 3.335 un."
              onToggle={() => undefined}
              open
              aoLadoDoToggle={atalho ? <a href="/pedidos/lista?pedido=ord_1">Imprimir lista</a> : undefined}
            />
          </QueueGroup>
        </div>,
      );
    const comAtalho = linha(true);
    expect(comAtalho).toMatch(/<div class="mt-1\.5 flex[^"]*"><button type="button" class="inline-flex[^"]*">.*Esconder itens<\/button><a href="\/pedidos\/lista\?pedido=ord_1">Imprimir lista<\/a><\/div>/s);
    const semAtalho = linha();
    expect(semAtalho).toMatch(/<button type="button" class="inline-flex[^"]* mt-1\.5">.*Esconder itens<\/button>/s);
    expect(semAtalho).not.toContain("Imprimir lista");
    expect(await violacoesDeAcessibilidade(comAtalho)).toEqual([]);
  });

  it("o apoio opcional toma o lugar do meta e da idade, sem mudar a linha sem apoio", async () => {
    const linha = (apoio?: ReactNode) =>
      renderToStaticMarkup(
        <div className="v3">
          <QueueGroup title="Para aprovar" count={1} empty="Nenhum pedido para aprovar.">
            <QueueRow icon={Package} tone="approve" title="Pedido 1042" meta="Retirada · BTG Pactual · 12 un." age="há 25 min" apoio={apoio} />
          </QueueGroup>
        </div>,
      );
    const comApoio = linha(<span className="font-bold text-foreground">Aprovando pedido 1042…</span>);
    expect(comApoio).toMatch(/<p class="mt-0\.5 text-sm text-foreground\/60"><span class="font-bold text-foreground">Aprovando pedido 1042…<\/span><\/p>/);
    expect(comApoio).not.toContain("Retirada");
    expect(comApoio).not.toContain("há 25 min");
    expect(linha()).toMatch(/<p class="mt-0\.5 text-sm text-foreground\/60">Retirada · BTG Pactual · 12 un\.<span> · há 25 min<\/span><\/p>/);
    expect(await violacoesDeAcessibilidade(comApoio)).toEqual([]);
  });
});

/**
 * O grupo da fila sem saltos (carregamento v2, momento 4, parte 6c): o título
 * e o cartão sobem com o palco, e o cartão, em três pedaços como na prancha,
 * encolhe e estica só por transform. Receber usa o grupo de sempre, que não
 * muda.
 */
describe("o grupo sem saltos e o de sempre", () => {
  it("sem semSaltos, o grupo é o de antes, byte a byte (Receber, Retornos da Operação)", () => {
    const comLinha = renderToStaticMarkup(
      <QueueGroup title="Para conferir" count={1} empty="Nenhuma chegada para conferir.">
        <p>linha</p>
      </QueueGroup>,
    );
    expect(comLinha).toBe(
      '<section class="flex flex-col gap-2.5"><h2 class="flex items-baseline gap-2 px-1 focus:outline-none">' +
        '<span class="text-base font-semibold text-foreground in-[.v3]:text-lg in-[.v3]:font-bold">Para conferir</span>' +
        '<span class="text-sm text-muted-foreground">1</span></h2>' +
        '<div class="relative overflow-hidden rounded-2xl border border-border bg-card in-[.v3]:rounded-lg"><div class="divide-y divide-border/60"><p>linha</p></div></div></section>',
    );
    const vazio = renderToStaticMarkup(
      <QueueGroup title="Para guardar" count={0} empty="Nada para guardar.">
        {null}
      </QueueGroup>,
    );
    expect(vazio).toBe(
      '<section class="flex flex-col gap-2.5"><h2 class="flex items-baseline gap-2 px-1 focus:outline-none">' +
        '<span class="text-base font-semibold text-foreground in-[.v3]:text-lg in-[.v3]:font-bold">Para guardar</span>' +
        '<span class="text-sm text-muted-foreground"></span></h2>' +
        '<div class="relative overflow-hidden rounded-2xl border border-border bg-card in-[.v3]:rounded-lg"><p class="px-5 py-4 text-sm text-muted-foreground">Nada para guardar.</p></div></section>',
    );
  });

  it("com semSaltos, o cartão em três pedaços atrás das linhas, fora da árvore, sem recortar a altura; o título e o vazio andam com o palco", async () => {
    const grupo = (count: number) =>
      renderToStaticMarkup(
        <div className="v3">
          <QueueGroup title="Para separar" count={count} empty="Nenhum pedido para separar." semSaltos rolarContagem>
            <div data-chave="ord_1" data-na-lista="parada">
              <QueueRow icon={Package} tone="pick" title="PED-0001" meta="2 itens · 14 un." actions={<Button type="button">Separar</Button>} />
            </div>
          </QueueGroup>
        </div>,
      );
    const html = grupo(1);
    const doc = new JSDOM(html).window.document;
    const titulo = doc.querySelector("h2")!;
    expect(titulo.getAttribute("data-palco")).toBe("bloco");
    const cartao = titulo.nextElementSibling!;
    expect(cartao.className).toBe("fila-cartao");
    // A moldura: o meio estica, as tampas andam; nenhuma vai para o leitor de tela.
    const pecas = Array.from(cartao.querySelectorAll(":scope > [data-moldura]"));
    expect(pecas.map((peca) => [peca.getAttribute("data-moldura"), peca.getAttribute("data-palco"), peca.getAttribute("aria-hidden")])).toEqual([
      ["meio", "estica", "true"],
      ["topo", "bloco", "true"],
      ["base", "bloco", "true"],
    ]);
    // Os cantos são os do cartão de sempre.
    expect(pecas[1].className).toContain("rounded-t-2xl");
    expect(pecas[1].className).toContain("in-[.v3]:rounded-t-lg");
    expect(pecas[2].className).toContain("rounded-b-2xl");
    expect(pecas[2].className).toContain("in-[.v3]:rounded-b-lg");
    // O cartão não recorta a altura (a linha que sobe fica inteira); a lista recorta só a largura.
    expect(cartao.className).not.toContain("overflow-hidden");
    const lista = cartao.querySelector(":scope > div")!;
    expect(lista.className).toContain("overflow-x-clip");
    expect(lista.className).not.toMatch(/\boverflow-hidden\b/);
    const vazio = new JSDOM(grupo(0)).window.document.querySelector(".fila-cartao > p")!;
    expect(vazio.getAttribute("data-palco")).toBe("bloco");
    // O vazio tem o fundo e os cantos do cartão, como as linhas.
    expect(vazio.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-card", "rounded-2xl", "in-[.v3]:rounded-lg"]));
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("as linhas ficam dentro da borda, com o fundo do cartão: o contraste se mede contra o cartão, e não contra a página", () => {
    // Como no cartão de sempre: a borda de 1 px por fora das linhas.
    expect(regra(".fila-cartao")).toMatchObject({ padding: "1px" });
    // A moldura atrás é pintada como imagem (o meio esticado), e quem mede o contraste não a lê: a linha tem o fundo.
    expect(regra('.fila-cartao [data-chave]:not([data-na-lista="saindo"])')).toEqual({ "background-color": "hsl(var(--card))" });
  });

  it("os controles que a espera travou têm a cara do travado do BotaoDeAcao (0,45), sem hover nem toque", () => {
    expect(regra("[data-na-lista] [data-trava-da-espera]")).toEqual({ opacity: "0.45", "pointer-events": "none" });
    const botaoDeAcao = readFileSync(new URL("./botao-de-acao.tsx", import.meta.url), "utf8");
    expect(botaoDeAcao).toContain('bloqueado && "opacity-45"');
  });

  it("o título que recebe o foco tem o anel do sistema visual no foco visível, o mesmo do botão", () => {
    const html = renderToStaticMarkup(
      <QueueGroup title="Para aprovar" count={0} empty="Nenhum pedido para aprovar." tituloRef={() => undefined}>
        {null}
      </QueueGroup>,
    );
    const titulo = new JSDOM(html).window.document.querySelector("h2")!;
    expect(titulo.getAttribute("tabindex")).toBe("-1");
    const classes = titulo.className.split(/\s+/);
    const anel = buttonVariants()
      .split(/\s+/)
      .filter((classe) => classe.startsWith("focus-visible:"));
    // O anel cheio do --foco (3:1 nos dois temas) e o contorno das cores forçadas (carregamento v2, parte 13h).
    expect(anel).toEqual(expect.arrayContaining(["focus-visible:outline-hidden", "focus-visible:ring-2", "focus-visible:ring-foco"]));
    for (const classe of anel) expect(classes, classe).toContain(classe);
  });
});

describe("o contraste da linha da fila (carregamento v2, parte 13h)", () => {
  const linha = renderToStaticMarkup(
    <div className="v3">
      <QueueGroup title="Para aprovar" count={1} empty="Nenhum pedido para aprovar.">
        <QueueRow icon={Package} tone="approve" title="Pedido 1042" meta="Entrega · BTG Pactual · 2 itens · 40 un." age="há 25 min" onToggle={() => undefined} open={false} />
      </QueueGroup>
    </div>,
  );
  const documento = new JSDOM(linha).window.document;

  it("a idade tem o tom do apoio (4,74:1 no branco da v3), e não a tinta a 45% (2,92:1)", () => {
    const apoio = [...documento.querySelectorAll("p")].find((p) => p.textContent?.includes("há 25 min"))!;
    expect(apoio.className.split(/\s+/)).toContain("text-foreground/60");
    expect(apoio.innerHTML).not.toMatch(/text-foreground\/(?:[1-5]\d)(?!\d)/);
    expect(apoio.textContent).toBe("Entrega · BTG Pactual · 2 itens · 40 un. · há 25 min");
  });

  it("o Ver itens é o primário como texto (o --primary-texto: 6,3:1 no cartão escuro, onde o --primary dava 4,4:1)", () => {
    const ver = [...documento.querySelectorAll("button")].find((botao) => botao.textContent === "Ver itens")!;
    const classes = ver.className.split(/\s+/);
    expect(classes).toContain("text-primary-texto");
    expect(classes).not.toContain("text-primary");
  });
});
