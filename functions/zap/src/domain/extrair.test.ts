import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extrairEntradas } from "./extrair.js";
import { LINHA_PILOTO } from "./linhas.js";

const AGORA = Date.parse("2026-11-19T12:00:00Z");
const CONTATO = "5511900000000";

function webhook(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "1447860659935403", changes: [{ field: "messages", value }] }],
  };
}

describe("extração", () => {
  it("lê a mensagem de entrada e o nome do webhook da Meta", () => {
    const extraido = extrairEntradas(
      webhook({
        metadata: { phone_number_id: LINHA_PILOTO, display_phone_number: "5511955075266" },
        contacts: [{ profile: { name: "Maria" }, wa_id: CONTATO }],
        messages: [{ from: CONTATO, id: "wamid.ENTRADA", timestamp: "1732010000", type: "text", text: { body: "Olá" } }],
      }),
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.equal(extraido.entradas.length, 1);
    assert.equal(extraido.entradas[0]?.direction, "in");
    assert.equal(extraido.entradas[0]?.text, "Olá");
    assert.equal(extraido.entradas[0]?.contact_name, "Maria");
    assert.equal(extraido.entradas[0]?.origin, "relay");
    assert.equal(extraido.entradas[0]?.phone_number_id, LINHA_PILOTO);
  });

  it("áudio e imagem ficam no tipo, com a legenda, sem o id da mídia", () => {
    const extraido = extrairEntradas(
      webhook({
        metadata: { phone_number_id: LINHA_PILOTO },
        messages: [
          { from: CONTATO, id: "wamid.AUDIO", timestamp: "1732010000", type: "audio", audio: { id: "media-secreta" } },
          { from: CONTATO, id: "wamid.FOTO", timestamp: "1732010001", type: "image", image: { id: "foto", caption: "A nota" } },
        ],
      }),
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.deepEqual(
      extraido.entradas.map((entrada) => [entrada.type, entrada.text]),
      [
        ["audio", ""],
        ["image", "A nota"],
      ],
    );
    assert.equal(JSON.stringify(extraido).includes("media-secreta"), false);
  });

  it("status de entrega vira registro sem texto", () => {
    const extraido = extrairEntradas(
      webhook({
        metadata: { phone_number_id: LINHA_PILOTO },
        statuses: [{ id: "wamid.SAIDA", status: "delivered", timestamp: "1732010002", recipient_id: CONTATO }],
      }),
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.equal(extraido.entradas[0]?.status_only, true);
    assert.equal(extraido.entradas[0]?.status, "delivered");
    assert.equal(extraido.entradas[0]?.contact_wa_id, CONTATO);
  });

  it("evento que não é messages não inventa mensagem", () => {
    const extraido = extrairEntradas(
      { object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: { event: "VERIFIED" } }] }] },
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.equal(extraido.entradas.length, 0);
  });

  it("mensagem sem id é ignorada e o resto entra", () => {
    const extraido = extrairEntradas(
      webhook({
        metadata: { phone_number_id: LINHA_PILOTO },
        messages: [{ from: CONTATO, timestamp: "1732010000", type: "text", text: { body: "sem id" } }, { from: CONTATO, id: "wamid.OK", timestamp: "1732010000", type: "text", text: { body: "ok" } }],
      }),
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.equal(extraido.ignorados, 1);
    assert.equal(extraido.entradas.length, 1);
  });

  it("a saída do agente usa to e o texto plano", () => {
    const extraido = extrairEntradas(
      {
        direction: "out",
        phone_number_id: LINHA_PILOTO,
        to: `+${CONTATO}`,
        contact_name: "Maria",
        message: { id: "wamid.SAIDA", timestamp: "1732010000", type: "text", text: "Bom dia." },
      },
      AGORA,
    );
    assert.ok(!("erro" in extraido));
    if ("erro" in extraido) return;
    assert.equal(extraido.entradas[0]?.direction, "out");
    assert.equal(extraido.entradas[0]?.origin, "agent");
    assert.equal(extraido.entradas[0]?.text, "Bom dia.");
    assert.equal(extraido.entradas[0]?.contact_wa_id, CONTATO);
  });

  it("envelope sem contato é corpo inválido", () => {
    const extraido = extrairEntradas({ direction: "out", phone_number_id: LINHA_PILOTO, message: { id: "wamid.X", text: "oi" } }, AGORA);
    assert.deepEqual(extraido, { erro: "corpo_invalido" });
  });

  it("corpo que não é webhook nem envelope é recusado", () => {
    assert.deepEqual(extrairEntradas({ ok: true }, AGORA), { erro: "corpo_invalido" });
    assert.deepEqual(extrairEntradas(null, AGORA), { erro: "corpo_invalido" });
  });
});
