import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LINHA_PILOTO } from "./linhas.js";
import { aplicar, idDeDocumento, instanteDaMensagem, previa, statusMelhor, type Entrada, type Mensagem } from "./modelo.js";

const AGORA = Date.parse("2026-11-19T12:00:00Z");
const CONTATO = "5511900000000";

function entrada(parcial: Partial<Entrada> = {}): Entrada {
  return {
    wamid: "wamid.EXEMPLO",
    phone_number_id: LINHA_PILOTO,
    contact_wa_id: CONTATO,
    direction: "in",
    type: "text",
    text: "Bom dia",
    occurred_at_ms: AGORA - 60_000,
    origin: "relay",
    status_only: false,
    ...parcial,
  };
}

describe("modelo do Zap", () => {
  it("o status não rebaixa uma leitura", () => {
    assert.equal(statusMelhor(undefined, "sent"), "sent");
    assert.equal(statusMelhor("sent", "delivered"), "delivered");
    assert.equal(statusMelhor("delivered", "sent"), "delivered");
    assert.equal(statusMelhor("read", "failed"), "read");
    assert.equal(statusMelhor("sent", "failed"), "failed");
    assert.equal(statusMelhor("failed", "sent"), "sent");
    assert.equal(statusMelhor("read", "played"), "played");
  });

  it("horário fora da faixa usa o relógio do servidor", () => {
    assert.equal(instanteDaMensagem("1700000000", AGORA), 1700000000 * 1000);
    assert.equal(instanteDaMensagem(AGORA, AGORA), AGORA);
    assert.equal(instanteDaMensagem("1", AGORA), AGORA);
    assert.equal(instanteDaMensagem(undefined, AGORA), AGORA);
  });

  it("id com barra vira id de documento escapado", () => {
    assert.equal(idDeDocumento("wamid.OK"), "wamid.OK");
    assert.equal(idDeDocumento("wamid.A/B"), encodeURIComponent("wamid.A/B"));
    assert.equal(idDeDocumento("."), null);
    assert.equal(idDeDocumento(""), null);
  });

  it("a primeira mensagem abre a conversa na linha do Jamil", () => {
    const resultado = aplicar(null, null, entrada({ contact_name: "Maria" }), AGORA);
    assert.equal(resultado.efeito, "nova");
    assert.equal(resultado.mensagem.agent, "jamil");
    assert.equal(resultado.conversa.agent_name, "Jamil");
    assert.equal(resultado.conversa.area, "Compras");
    assert.equal(resultado.conversa.last_preview, "Bom dia");
    assert.equal(resultado.conversa.contact_name, "Maria");
    assert.equal(resultado.conversa.id, `${LINHA_PILOTO}_${CONTATO}`);
  });

  it("repetir a mesma mensagem não muda o estado", () => {
    const primeira = aplicar(null, null, entrada(), AGORA);
    const segunda = aplicar(primeira.mensagem, primeira.conversa, entrada(), AGORA + 1000);
    assert.equal(segunda.efeito, "repetida");
  });

  it("áudio sem texto vira a prévia Áudio", () => {
    const resultado = aplicar(null, null, entrada({ type: "audio", text: "" }), AGORA);
    assert.equal(resultado.conversa.last_preview, "Áudio");
    assert.equal(previa("image", ""), "Imagem");
    assert.equal(previa("text", "linha\n2"), "linha 2");
  });

  it("o status chega antes do texto e o envio preenche o mesmo id", () => {
    const status = aplicar(null, null, entrada({ direction: "out", status_only: true, status: "sent", text: "", type: "unknown", origin: "status" }), AGORA);
    assert.equal(status.mensagem.direction, "out");
    assert.equal(status.mensagem.type, "unknown");
    assert.equal(status.mensagem.status, "sent");
    const texto = aplicar(
      status.mensagem,
      status.conversa,
      entrada({ direction: "out", origin: "agent", text: "Segue o orçamento", type: "text", status_only: false }),
      AGORA + 1000,
    );
    assert.equal(texto.efeito, "atualizada");
    assert.equal(texto.mensagem.text, "Segue o orçamento");
    assert.equal(texto.mensagem.status, "sent");
    assert.equal(texto.conversa.last_preview, "Segue o orçamento");
  });

  it("uma leitura não volta para entregue, e o texto antigo não é trocado", () => {
    const primeira = aplicar(null, null, entrada({ direction: "out", origin: "agent", text: "Original", status: "read" }), AGORA);
    const deNovo = aplicar(primeira.mensagem, primeira.conversa, entrada({ direction: "out", origin: "agent", text: "Outro", status: "delivered", status_only: false }), AGORA + 1000);
    assert.equal(deNovo.efeito, "repetida");
    assert.equal(deNovo.mensagem.text, "Original");
    assert.equal(deNovo.mensagem.status, "read");
  });

  it("mensagem mais antiga não cobre a prévia da mais nova", () => {
    const nova = aplicar(null, null, entrada({ text: "Nova", occurred_at_ms: AGORA }), AGORA);
    const antiga = aplicar(null, nova.conversa, entrada({ wamid: "wamid.ANTIGA", text: "Antiga", occurred_at_ms: AGORA - 86_400_000 }), AGORA);
    assert.equal(antiga.conversa.last_preview, "Nova");
    assert.equal(antiga.efeito, "nova");
  });

  it("o nome do contato completa a conversa sem mudar o texto", () => {
    const primeira = aplicar(null, null, entrada(), AGORA);
    const comNome = aplicar(primeira.mensagem, primeira.conversa, entrada({ contact_name: "Maria" }), AGORA + 1000);
    assert.equal(comNome.efeito, "atualizada");
    assert.equal(comNome.mensagem.contact_name, "Maria");
    assert.equal(comNome.conversa.contact_name, "Maria");
    assert.equal(comNome.mensagem.text, "Bom dia");
  });

  it("linha desconhecida ainda grava, com agente desconhecido", () => {
    const resultado = aplicar(null, null, entrada({ phone_number_id: "1234567890123456" }), AGORA);
    assert.equal(resultado.mensagem.agent, "desconhecido");
    assert.equal(resultado.conversa.area, "Fora do catálogo");
  });

  it("o tipo da mensagem guardada não é any", () => {
    const mensagem: Mensagem = aplicar(null, null, entrada(), AGORA).mensagem;
    assert.equal(mensagem.wamid, "wamid.EXEMPLO");
  });
});
