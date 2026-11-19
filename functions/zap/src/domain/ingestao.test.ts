import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aplicar, type Entrada, type Efeito } from "./modelo.js";
import { tratarIngestao, segredoConfere, type PedidoHttp } from "./ingestao.js";
import { LINHA_PILOTO } from "./linhas.js";

const AGORA = new Date("2026-11-19T12:00:00Z");
const SEGREDO = "segredo-de-teste-com-32-chars!!";

function pedido(parcial: Partial<PedidoHttp> = {}): PedidoHttp {
  return {
    method: "POST",
    contentType: "application/json",
    headerSecret: SEGREDO,
    body: {
      direction: "in",
      phone_number_id: LINHA_PILOTO,
      from: "5511900000000",
      message: { id: "wamid.UM", timestamp: "1732010000", type: "text", text: "Oi" },
    },
    tamanho: 100,
    ...parcial,
  };
}

function memoria() {
  const mensagens = new Map<string, ReturnType<typeof aplicar>["mensagem"]>();
  const conversas = new Map<string, ReturnType<typeof aplicar>["conversa"]>();
  const gravar = async (entrada: Entrada): Promise<Efeito> => {
    const atual = mensagens.get(entrada.wamid) ?? null;
    const conversa = atual ? conversas.get(atual.conversation_id) ?? null : null;
    const resultado = aplicar(atual, conversa, entrada, AGORA.getTime());
    if (resultado.efeito !== "repetida") {
      mensagens.set(entrada.wamid, resultado.mensagem);
      conversas.set(resultado.conversa.id, resultado.conversa);
    }
    return resultado.efeito;
  };
  return { gravar, mensagens, conversas };
}

describe("ingestão", () => {
  it("sem segredo configurado não grava, mesmo com cabeçalho", async () => {
    const estado = memoria();
    const resposta = await tratarIngestao(pedido(), { segredo: undefined, agora: AGORA, gravar: estado.gravar });
    assert.equal(resposta.status, 503);
    assert.equal(resposta.body.erro, "sem_segredo");
    assert.equal(estado.mensagens.size, 0);
  });

  it("segredo errado ou ausente responde 401 e não grava", async () => {
    assert.equal(segredoConfere(SEGREDO, SEGREDO), true);
    assert.equal(segredoConfere(SEGREDO, "outro-segredo-de-teste-32chars"), false);
    assert.equal(segredoConfere(SEGREDO, undefined), false);
    const estado = memoria();
    const resposta = await tratarIngestao(pedido({ headerSecret: "errado" }), { segredo: SEGREDO, agora: AGORA, gravar: estado.gravar });
    assert.equal(resposta.status, 401);
    assert.equal(estado.mensagens.size, 0);
  });

  it("grava a mensagem e a repetição não duplica", async () => {
    const estado = memoria();
    const deps = { segredo: SEGREDO, agora: AGORA, gravar: estado.gravar };
    const primeira = await tratarIngestao(pedido(), deps);
    const segunda = await tratarIngestao(pedido(), deps);
    assert.equal(primeira.status, 200);
    assert.equal(primeira.body.gravados, 1);
    assert.equal(segunda.body.repetidos, 1);
    assert.equal(estado.mensagens.size, 1);
    assert.equal(estado.conversas.size, 1);
  });

  it("o status atualiza a mensagem que o agente já registrou", async () => {
    const estado = memoria();
    const deps = { segredo: SEGREDO, agora: AGORA, gravar: estado.gravar };
    await tratarIngestao(
      pedido({
        body: {
          direction: "out",
          phone_number_id: LINHA_PILOTO,
          to: "5511900000000",
          message: { id: "wamid.SAIDA", timestamp: "1732010000", type: "text", text: "Segue." },
        },
      }),
      deps,
    );
    const status = await tratarIngestao(
      pedido({
        body: {
          object: "whatsapp_business_account",
          entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: LINHA_PILOTO }, statuses: [{ id: "wamid.SAIDA", status: "read", timestamp: "1732010003", recipient_id: "5511900000000" }] } }] }],
        },
      }),
      deps,
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.atualizados, 1);
    assert.equal(estado.mensagens.get("wamid.SAIDA")?.status, "read");
    assert.equal(estado.mensagens.get("wamid.SAIDA")?.text, "Segue.");
  });

  it("recusa método, tamanho e content-type antes de olhar o segredo", async () => {
    const estado = memoria();
    const deps = { segredo: SEGREDO, agora: AGORA, gravar: estado.gravar };
    assert.equal((await tratarIngestao(pedido({ method: "GET" }), deps)).status, 405);
    assert.equal((await tratarIngestao(pedido({ tamanho: 2 * 1024 * 1024 }), deps)).status, 413);
    assert.equal((await tratarIngestao(pedido({ contentType: "text/plain" }), deps)).status, 415);
    assert.equal(estado.mensagens.size, 0);
  });

  it("falha da gravação vira 503 para o relay tentar de novo", async () => {
    const resposta = await tratarIngestao(pedido(), {
      segredo: SEGREDO,
      agora: AGORA,
      gravar: async () => {
        throw new Error("firestore indisponível");
      },
    });
    assert.equal(resposta.status, 503);
    assert.equal(resposta.body.erro, "indisponivel");
  });
});
