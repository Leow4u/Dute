import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CLIENTE_DO_WMS, clienteDoNucleo, type ClienteDoAgente } from "@/lib/agente/cliente";
import { ProvedorDoAgente } from "@/lib/agente/contexto";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { DraftCard } from "./draft-card";

/**
 * O cartão da anotação que o agente do núcleo sugeriu (parte 5.5i): o texto e
 * uma ação. Enviada, o cartão diz que foi. O agente do WMS não tem esse
 * cartão.
 */

const ANOTACAO = { tipo: "anotacao", texto: "Entregas na Paulista só pela manhã", visibilidade: "todos" };

function cartao(cliente: ClienteDoAgente, sent?: unknown) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProvedorDoAgente cliente={cliente}>
        <DraftCard value={ANOTACAO} messageId="msg_agent_1" sent={sent} />
      </ProvedorDoAgente>
    </QueryClientProvider>,
  );
}

describe("o cartão da anotação", () => {
  const nucleo = clienteDoNucleo("wms", "ITAU");

  it("o texto e uma ação, sem legenda e acessível", async () => {
    const html = cartao(nucleo);
    expect(textosDaTela(html)).toEqual(["Anotação para a coordenação", "Entregas na Paulista só pela manhã", "Sugerir anotação"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("enviada, diz que foi, sem a ação", async () => {
    const html = cartao(nucleo, { request_id: "note_0123456789abcdef01234567", request_number: "", sent_at: "2026-10-23T15:00:00.000Z" });
    expect(textosDaTela(html)).toEqual(["Anotação enviada para a coordenação", "Entregas na Paulista só pela manhã"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o agente do WMS não mostra o cartão", () => {
    expect(cartao(CLIENTE_DO_WMS)).toBe("");
  });
});
