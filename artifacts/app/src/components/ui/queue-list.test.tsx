import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { PageHeader } from "./page-header";
import { QueueGroup, QueueRow } from "./queue-list";

/** A fila do WMS (Pedidos, Receber) e o cabeçalho da página na v3 (parte 4.7c). */

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
    expect(linha()).toMatch(/<p class="mt-0\.5 text-sm text-foreground\/60">Retirada · BTG Pactual · 12 un\.<span class="text-foreground\/45"> · há 25 min<\/span><\/p>/);
    expect(await violacoesDeAcessibilidade(comApoio)).toEqual([]);
  });
});
