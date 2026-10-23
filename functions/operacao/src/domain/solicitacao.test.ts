import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import { interpretarDemandaDireta } from "./demanda-direta.js";
import { OPERACAO_EVENT_PAYLOADS, buildOperacaoEvent } from "./events.js";
import {
  MAX_ANEXOS,
  TIPOS_DE_SERVICO,
  caminhoDoAnexo,
  desejadaEm,
  documentoDaSolicitacao,
  idDaSolicitacao,
  interpretarPedidoDeServico,
  interpretarRecusa,
  problemaDaData,
  problemaDaSolicitacao,
  problemaDoAnexo,
  solicitacaoLida,
} from "./solicitacao.js";

/**
 * A solicitação de OS pelo portal (parte 4.4a): o que o cliente pede, os
 * anexos conferidos, a data que já passou, a solicitação que só vira demanda
 * uma vez e pelo mesmo cliente, e o evento sem o texto livre. Dados
 * sintéticos.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const AGORA = new Date("2026-10-23T13:00:00.000Z");

const PEDIDO = {
  idempotency_key: "sol-1",
  tipo_servico: "transporte",
  data: "2026-10-24",
  horario: "08:00",
  origem: "  Rua das Indústrias, 450   · Galpão 3 ",
  destino: "Av. Paulista, 1000",
  descricao: "Levar 12 paletes de\r\nmobiliário.\n\n\n\nCuidado com o vidro.",
  anexos: [{ arquivo: "an_0123456789abcdef.pdf", nome: "NF 4498.pdf" }],
};

function rejeita(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("o pedido do cliente", () => {
  it("os quatro tipos do formulário; o texto sem espaço repetido; o destino e os anexos opcionais", () => {
    assert.deepEqual([...TIPOS_DE_SERVICO], ["transporte", "armazenagem", "servico_em_campo", "mudanca"]);
    const pedido = interpretarPedidoDeServico(PEDIDO);
    assert.equal(pedido.origem, "Rua das Indústrias, 450 · Galpão 3");
    assert.equal(pedido.descricao, "Levar 12 paletes de\nmobiliário.\n\nCuidado com o vidro.");
    const simples = interpretarPedidoDeServico({ ...PEDIDO, destino: undefined, anexos: undefined });
    assert.equal(simples.destino, null);
    assert.deepEqual(simples.anexos, []);
  });

  it("recusa tipo, data, horário, origem e descrição fora do formato, anexo demais, repetido ou de outro tipo, e campo a mais", () => {
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, tipo_servico: "frete" })).message, /tipo_servico: use transporte/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, data: "2026-02-30" })).message, /Data inválida/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, horario: "24:00" })).message, /Horário inválido/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, origem: " " })).message, /Informe a origem/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, descricao: "" })).message, /Diga o que será feito/);
    const quatro = Array.from({ length: MAX_ANEXOS + 1 }, (_, indice) => ({ arquivo: `an_000000000000000${indice}.png`, nome: `foto ${indice}` }));
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, anexos: quatro })).message, /até 3 arquivos/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, anexos: [PEDIDO.anexos[0], PEDIDO.anexos[0]] })).message, /duas vezes/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, anexos: [{ arquivo: "an_0123456789abcdef.exe", nome: "x" }] })).message, /PDF, JPG, PNG ou WEBP/);
    assert.match(rejeita(() => interpretarPedidoDeServico({ ...PEDIDO, customer_code: "SAFRA" })).message, /Campo não aceito: customer_code/);
  });

  it("a data e o horário em São Paulo; o que já passou ou passa de um ano é recusado", () => {
    assert.equal(desejadaEm("2026-10-24", "08:00"), "2026-10-24T11:00:00.000Z");
    assert.equal(problemaDaData("2026-10-24", "08:00", AGORA), null);
    assert.equal(problemaDaData("2026-10-23", "09:30", AGORA), "A data e o horário pedidos já passaram.");
    assert.equal(problemaDaData("2026-10-23", "10:00", AGORA), "A data e o horário pedidos já passaram.");
    assert.equal(problemaDaData("2026-10-23", "10:30", AGORA), null);
    assert.match(problemaDaData("2027-10-24", "08:00", AGORA) ?? "", /até 365 dias/);
  });

  it("o anexo vale só depois de subir, com o tipo do nome e até 10 MB", () => {
    assert.equal(caminhoDoAnexo("ITAU", "an_0123456789abcdef.pdf"), "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf");
    assert.equal(problemaDoAnexo("an_0123456789abcdef.pdf", { contentType: "application/pdf", size: 200_000 }), null);
    assert.match(problemaDoAnexo("an_0123456789abcdef.pdf", null) ?? "", /não chegou/);
    assert.match(problemaDoAnexo("an_0123456789abcdef.pdf", { contentType: "image/png", size: 10 }) ?? "", /tipo/);
    assert.match(problemaDoAnexo("an_0123456789abcdef.jpg", { contentType: "image/jpeg", size: 11 * 1024 * 1024 }) ?? "", /10 MB/);
    assert.match(problemaDoAnexo("an_0123456789abcdef.jpg", { contentType: "image/jpeg", size: 0 }) ?? "", /10 MB/);
  });

  it("a solicitação nasce recebida, sem demanda; o id sai da operação", () => {
    const id = idDaSolicitacao("op_service_request_abc");
    assert.match(id, /^sol_[a-f0-9]{16}$/);
    assert.equal(idDaSolicitacao("op_service_request_abc"), id);
    const documento = documentoDaSolicitacao({
      id,
      customer_code: "ITAU",
      customer_name: "Itaú Unibanco",
      pedido: interpretarPedidoDeServico(PEDIDO),
      anexos: [],
      contato: { uid: "cli-1", nome: "Roberto Souza", email: "roberto@itau.example" },
      iso: AGORA.toISOString(),
    });
    assert.equal(documento.status, "recebida");
    assert.equal(documento.desejada_em, "2026-10-24T11:00:00.000Z");
    assert.equal(documento.demanda, null);
    assert.equal(documento.recusa, null);
    assert.equal(documento.recebida_em, AGORA.toISOString());
  });
});

describe("a solicitação vira demanda uma vez, pela coordenação", () => {
  const lida = (extra: Record<string, unknown> = {}) =>
    solicitacaoLida("sol_0123456789abcdef", { status: "recebida", customer_code: "ITAU", recebida_em: "2026-10-23T12:00:00.000Z", contato: { nome: "Roberto" }, ...extra });

  it("só a recebida, do mesmo cliente", () => {
    assert.equal(problemaDaSolicitacao(lida(), "ITAU"), null);
    assert.equal(problemaDaSolicitacao(lida(), null), null);
    assert.equal(problemaDaSolicitacao(lida(), "SAFRA"), "A solicitação é de outro cliente.");
    assert.equal(problemaDaSolicitacao(lida({ status: "aceita", demanda: "10050" }), "ITAU"), "A solicitação já virou a demanda 10050.");
    assert.equal(problemaDaSolicitacao(lida({ status: "recusada" }), "ITAU"), "A solicitação foi recusada.");
    assert.match(problemaDaSolicitacao(lida({ status: "pendente" }), "ITAU") ?? "", /desconhecido/);
  });

  it("a demanda da solicitação chega pelo portal e usa o instante da solicitação", () => {
    const base = {
      idempotency_key: "d1",
      customer_code: "ITAU",
      titulo: "Transporte de paletes",
      canal: "portal",
      executar_ate: "2026-10-24T08:00-03:00",
      itens: [{ item: "Paletes", unidade: "UN", quantidade: "12" }],
      solicitacao_id: "sol_0123456789abcdef",
    };
    assert.equal(interpretarDemandaDireta(base).solicitacao_id, "sol_0123456789abcdef");
    assert.equal(rejeita(() => interpretarDemandaDireta({ ...base, canal: "telefone" })).message, "A demanda da solicitação do portal chega pelo portal.");
    assert.equal(rejeita(() => interpretarDemandaDireta({ ...base, recebida_em: "2026-10-23T09:00-03:00" })).message, "A solicitação do portal já diz quando foi recebida.");
    assert.equal(rejeita(() => interpretarDemandaDireta({ ...base, solicitacao_id: undefined })).message, "Informe recebida_em.");
    assert.match(rejeita(() => interpretarDemandaDireta({ ...base, solicitacao_id: "sol_x" })).message, /Solicitação do portal inválida/);
  });

  it("a recusa diz o motivo, com ao menos 5 caracteres", () => {
    assert.equal(interpretarRecusa({ idempotency_key: "r1", solicitacao_id: "sol_0123456789abcdef", motivo: "  Fora da  área atendida " }).motivo, "Fora da área atendida");
    assert.match(rejeita(() => interpretarRecusa({ idempotency_key: "r1", solicitacao_id: "sol_0123456789abcdef", motivo: "não" })).message, /Informe o motivo/);
  });
});

describe("o evento da solicitação", () => {
  it("leva o tipo, o dia e quantos anexos; nunca o local, o que será feito, o nome do anexo ou o motivo", () => {
    const schema = OPERACAO_EVENT_PAYLOADS["portal.service_requested"];
    const payload = { id: "sol_0123456789abcdef", tipo_servico: "transporte", data: "2026-10-24", anexos: 1 };
    assert.equal(schema.safeParse(payload).success, true);
    for (const extra of [{ origem: "Rua" }, { descricao: "Levar" }, { nome: "NF.pdf" }, { motivo: "Fora" }]) {
      assert.equal(schema.safeParse({ ...payload, ...extra }).success, false, JSON.stringify(extra));
    }
    assert.equal(OPERACAO_EVENT_PAYLOADS["portal.service_declined"].safeParse({ id: "sol_0123456789abcdef", motivo: "Fora" }).success, false);
  });

  it("o cliente só grava a solicitação; a coordenação grava o resto; o evento é do cliente da solicitação", () => {
    const cliente = { uid: "cli-1", role: "cliente", name: "Roberto" };
    const interno = { uid: "u1", role: "interno", name: "Paula" };
    const pedido = buildOperacaoEvent({
      operation_id: "op_1",
      type: "portal.service_requested",
      entity_id: "sol_0123456789abcdef",
      payload: { id: "sol_0123456789abcdef", tipo_servico: "mudanca", data: "2026-10-24", anexos: 0 },
      actor: cliente,
      customer_code: "ITAU",
      occurred_at: "2026-10-23T13:00:00.000Z",
    });
    assert.equal(pedido.entity_type, "service_request");
    assert.equal(pedido.customer_code, "ITAU");
    const comoEquipe = () =>
      buildOperacaoEvent({ operation_id: "op_1", type: "portal.service_requested", entity_id: "sol_0123456789abcdef", payload: pedido.payload as never, actor: interno, customer_code: "ITAU" });
    assert.match(rejeita(comoEquipe).message, /sempre do cliente/);
    const clienteNaOs = () =>
      buildOperacaoEvent({ operation_id: "op_1", type: "os.cancelled", entity_id: "10045-01", payload: { id: "10045-01", demanda: "10045" }, actor: cliente, customer_code: "ITAU" });
    assert.match(rejeita(clienteNaOs).message, /alguém da equipe/);
    const semCliente = () =>
      buildOperacaoEvent({ operation_id: "op_1", type: "portal.service_declined", entity_id: "sol_0123456789abcdef", payload: { id: "sol_0123456789abcdef" }, actor: interno, customer_code: null });
    assert.match(rejeita(semCliente).message, /sem customer_code/);
  });

  it("a solicitação fica fora da zeragem do WMS, com a Operação", () => {
    const ferramenta = read("../../../../tools/full_reset_btg.py");
    const operacao = ferramenta.slice(ferramenta.indexOf("OPERACAO_COLLECTIONS = ("), ferramenta.indexOf(")", ferramenta.indexOf("OPERACAO_COLLECTIONS = (")));
    assert.match(operacao, /"service_requests"/);
  });
});
