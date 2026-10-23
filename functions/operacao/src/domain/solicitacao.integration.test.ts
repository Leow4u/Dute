import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { openDirectDemandFor } from "./demanda-direta-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import type { OperacaoProfile } from "./profile.js";
import { declineServiceRequestFor, requestServiceFor, type ConferirAnexo } from "./solicitacao-gravacao.js";

/**
 * Parte 4.4a: o cliente pede a OS pelo portal; a solicitação cai em Para
 * planejar e nunca abre demanda nem OS sozinha. Quem coordena abre a
 * demanda direta a partir dela, uma vez, ou a recusa com o motivo.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = () => new Date("2026-10-23T13:00:00.000Z");
const DEPOIS = () => new Date("2026-10-23T14:30:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const cliente: OperacaoProfile = { uid: "cli-1", role: "cliente", name: "Roberto Souza", email: "roberto@itau.example", customer_code: "ITAU" };
const outroCliente: OperacaoProfile = { uid: "cli-2", role: "cliente", name: "Carla", customer_code: "SAFRA" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };

const PEDIDO = {
  idempotency_key: "sol-1",
  tipo_servico: "transporte",
  data: "2026-10-24",
  horario: "08:00",
  origem: "Rua das Indústrias, 450 · Galpão 3",
  destino: "Av. Paulista, 1000",
  descricao: "Levar 12 paletes de mobiliário.",
  anexos: [{ arquivo: "an_0123456789abcdef.pdf", nome: "NF 4498.pdf" }],
};

const ARQUIVOS = new Map([["portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", { contentType: "application/pdf", size: 180_000 }]]);
const conferirAnexo: ConferirAnexo = async (caminho) => ARQUIVOS.get(caminho) ?? null;

function demandaDaSolicitacao(solicitacaoId: string, extra: Record<string, unknown> = {}) {
  return {
    idempotency_key: `dem-${solicitacaoId}`,
    customer_code: "ITAU",
    titulo: "Transporte de paletes",
    canal: "portal",
    executar_ate: "2026-10-24T08:00-03:00",
    itens: [{ item: "Paletes de mobiliário", unidade: "UN", quantidade: "12" }],
    solicitacao_id: solicitacaoId,
    ...extra,
  };
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-solicitacao-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("customers/ITAU").set({ code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", status: "active" });
  await db.doc("customers/SAFRA").set({ code: "SAFRA", customer_code: "SAFRA", name: "Safra", status: "active" });
  await db.doc("demand_counters/geral").set({ ultimo: 10049 });
});

after(async () => {
  await deleteApp(app);
});

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

async function tamanho(colecao: string): Promise<number> {
  return (await db.collection(colecao).get()).size;
}

describe("o cliente pede a OS pelo portal", () => {
  it("a solicitação nasce recebida, com o anexo conferido e o evento; repetir devolve a mesma; nunca abre demanda nem OS", async () => {
    const pedida = await requestServiceFor(db, cliente, PEDIDO, conferirAnexo, AGORA);
    assert.match(pedida.solicitacao_id, /^sol_[a-f0-9]{16}$/);
    const deNovo = await requestServiceFor(db, cliente, PEDIDO, conferirAnexo, AGORA);
    assert.deepEqual(deNovo, { solicitacao_id: pedida.solicitacao_id, replayed: true });

    const solicitacao = (await db.doc(`service_requests/${pedida.solicitacao_id}`).get()).data() ?? {};
    assert.equal(solicitacao.status, "recebida");
    assert.equal(solicitacao.customer_code, "ITAU");
    assert.equal(solicitacao.customer_name, "Itaú Unibanco");
    assert.equal(solicitacao.tipo_servico, "transporte");
    assert.equal(solicitacao.desejada_em, "2026-10-24T11:00:00.000Z");
    assert.equal(solicitacao.recebida_em, "2026-10-23T13:00:00.000Z");
    assert.deepEqual(solicitacao.contato, { uid: "cli-1", nome: "Roberto Souza", email: "roberto@itau.example" });
    assert.deepEqual(solicitacao.anexos, [
      { arquivo: "an_0123456789abcdef.pdf", caminho: "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", nome: "NF 4498.pdf", tipo: "application/pdf", tamanho: 180_000 },
    ]);
    assert.equal(solicitacao.demanda, null);

    // Pedido do portal nunca cria OS sozinho (nem demanda, nem número do contador).
    assert.equal(await tamanho("service_orders"), 0);
    assert.equal(await tamanho("demands"), 0);
    assert.equal((await db.doc("demand_counters/geral").get()).data()?.ultimo, 10049);

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    assert.deepEqual(
      eventos.map((evento) => [evento.type, evento.entity_type, evento.customer_code, evento.actor.role]),
      [["portal.service_requested", "service_request", "ITAU", "cliente"]],
    );
    assert.deepEqual(eventos[0].payload, { id: pedida.solicitacao_id, tipo_servico: "transporte", data: "2026-10-24", anexos: 1 });
    for (const proibido of ["Indústrias", "Paulista", "paletes", "NF 4498"]) assert.equal(JSON.stringify(eventos[0]).includes(proibido), false, proibido);
  });

  it("anexo que não subiu ou é do outro cliente, data que passou e quem não é cliente são recusados sem gravar", async () => {
    const semArquivo = await rejection(
      requestServiceFor(db, cliente, { ...PEDIDO, idempotency_key: "s2", anexos: [{ arquivo: "an_ffffffffffffffff.pdf", nome: "x.pdf" }] }, conferirAnexo, AGORA),
    );
    assert.match(semArquivo.message, /não chegou/);
    // O mesmo nome de arquivo no caminho do outro cliente não existe: o caminho sai do código do perfil.
    const doOutro = await rejection(requestServiceFor(db, outroCliente, { ...PEDIDO, idempotency_key: "s3" }, conferirAnexo, AGORA));
    assert.match(doOutro.message, /não chegou/);
    const passou = await rejection(requestServiceFor(db, cliente, { ...PEDIDO, idempotency_key: "s4", data: "2026-10-23", horario: "09:00" }, conferirAnexo, AGORA));
    assert.equal(passou.message, "A data e o horário pedidos já passaram.");
    const equipe = await rejection(requestServiceFor(db, interno, { ...PEDIDO, idempotency_key: "s5" }, conferirAnexo, AGORA));
    assert.equal(equipe.code, "permission-denied");
    assert.equal(await tamanho("service_requests"), 0);
    assert.equal(await tamanho(EVENTS_COLLECTION), 0);
  });
});

describe("a coordenação atende ou recusa a solicitação", () => {
  it("a demanda direta da solicitação: canal portal, o instante e quem pediu vêm da solicitação; a solicitação fica aceita; a OS só pelo planejamento", async () => {
    const { solicitacao_id: id } = await requestServiceFor(db, cliente, PEDIDO, conferirAnexo, AGORA);
    assert.equal(await tamanho("service_orders"), 0);

    const aberta = await openDirectDemandFor(db, interno, demandaDaSolicitacao(id), DEPOIS);
    assert.equal(aberta.numero, "10050");
    const demanda = (await db.doc("demands/10050").get()).data() ?? {};
    assert.equal(demanda.entrada, "direta");
    assert.equal(demanda.canal, "portal");
    assert.equal(demanda.etapa, "para_planejar");
    assert.equal(demanda.solicitacao_id, id);
    assert.equal(demanda.recebida_em, "2026-10-23T13:00:00.000Z");
    assert.deepEqual(demanda.pedido_por, { nome: "Roberto Souza", telefone: null });
    assert.equal(demanda.tipo_calculado, "emergencial");

    const solicitacao = (await db.doc(`service_requests/${id}`).get()).data() ?? {};
    assert.equal(solicitacao.status, "aceita");
    assert.equal(solicitacao.demanda, "10050");
    assert.equal(solicitacao.aceita_por_uid, "interno-1");
    assert.equal(solicitacao.aceita_em, "2026-10-23T14:30:00.000Z");

    const tipos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data().type).sort();
    assert.deepEqual(tipos, ["demand.direct_opened", "portal.service_accepted", "portal.service_requested"]);
    assert.equal(await tamanho("service_orders"), 0);

    const outra = await rejection(openDirectDemandFor(db, interno, demandaDaSolicitacao(id, { idempotency_key: "de-novo" }), DEPOIS));
    assert.equal(outra.message, "A solicitação já virou a demanda 10050.");
    assert.equal((await db.doc("demand_counters/geral").get()).data()?.ultimo, 10050);

    const linha = demanda.itens_pedidos[0] as { id: string };
    const plano = await saveServiceOrderFor(db, interno, { action: "plan", idempotency_key: "plano", demanda: "10050", ordens: [{ itens: [{ id: linha.id, planejado: "12" }] }] });
    assert.deepEqual(plano.numeros, ["10050-01"]);
  });

  it("a solicitação de um cliente não vira demanda de outro; a recusa tem motivo e encerra a solicitação", async () => {
    const { solicitacao_id: id } = await requestServiceFor(db, cliente, PEDIDO, conferirAnexo, AGORA);
    const errado = await rejection(openDirectDemandFor(db, interno, demandaDaSolicitacao(id, { customer_code: "SAFRA" }), DEPOIS));
    assert.equal(errado.message, "A solicitação é de outro cliente.");
    const inexistente = await rejection(openDirectDemandFor(db, interno, demandaDaSolicitacao("sol_ffffffffffffffff"), DEPOIS));
    assert.equal(inexistente.code, "not-found");
    assert.equal(await tamanho("demands"), 0);

    const pelaCliente = await rejection(declineServiceRequestFor(db, cliente, { idempotency_key: "r0", solicitacao_id: id, motivo: "Desisti do pedido" }, DEPOIS));
    assert.equal(pelaCliente.code, "permission-denied");

    await declineServiceRequestFor(db, interno, { idempotency_key: "r1", solicitacao_id: id, motivo: "Fora da área atendida" }, DEPOIS);
    const recusada = (await db.doc(`service_requests/${id}`).get()).data() ?? {};
    assert.equal(recusada.status, "recusada");
    assert.deepEqual(recusada.recusa, { motivo: "Fora da área atendida", em: "2026-10-23T14:30:00.000Z", por_uid: "interno-1" });

    const depois = await rejection(openDirectDemandFor(db, interno, demandaDaSolicitacao(id), DEPOIS));
    assert.equal(depois.message, "A solicitação foi recusada.");
    const deNovo = await rejection(declineServiceRequestFor(db, interno, { idempotency_key: "r2", solicitacao_id: id, motivo: "Fora da área atendida" }, DEPOIS));
    assert.equal(deNovo.message, "A solicitação foi recusada.");

    const eventos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
    const recusa = eventos.find((evento) => evento.type === "portal.service_declined");
    assert.deepEqual(recusa?.payload, { id });
    assert.equal(JSON.stringify(recusa).includes("Fora da área"), false);
    assert.equal(await tamanho("demands"), 0);
    assert.equal(await tamanho("service_orders"), 0);
  });
});
