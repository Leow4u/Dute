import { Package } from "lucide-react";
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
});
