import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { entradaDe, entradaDoSalvar, CancelarEdicaoSchema, EnviarEdicaoSchema } from "./edicao.js";
import {
  EDICOES_COLLECTION,
  EVENTOS_COLLECTION,
  OPERATIONS_COLLECTION,
  PRECOS_COLLECTION,
  archiveClientEventTransaction,
  cancelEventEditionTransaction,
  lerEdicaoDoCliente,
  saveEventEditionTransaction,
  sendEventEditionTransaction,
} from "./edicao-gravacao.js";

/**
 * A edição do evento no emulador (eventos, parte 2): nasce com o nome,
 * muda pelo patch com o CAS, funde o cronograma pelo id do momento, é
 * enviada (ainda sem pedido), cancelada ou excluída, e o evento é
 * arquivado sem edição aberta; o cliente de outro código não acha nada.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const cristiane = { uid: "cli-1", role: "cliente", customer_code: BTG, name: "Cristiane" };
const outraCliente = { uid: "cli-2", role: "cliente", customer_code: "Outro", name: "Paula" };
const manoel = { uid: "manoel", role: "interno", name: "Manoel", customer_code: BTG };

type Ator = typeof cristiane | typeof outraCliente | typeof manoel;

async function criar(raw: Record<string, unknown>, ator: Ator = cristiane) {
  return saveEventEditionTransaction(db, { ...entradaDoSalvar(raw), customer_code: ator.customer_code }, ator);
}

async function mudar(id: string, expected: number, patch: Record<string, unknown>, ator: Ator = cristiane) {
  return saveEventEditionTransaction(db, { ...entradaDoSalvar({ id, expected_edicao: expected, patch }), customer_code: ator.customer_code }, ator);
}

async function enviar(id: string, expected: number, chave: string, ator: Ator = cristiane) {
  const input = entradaDe(EnviarEdicaoSchema, { id, expected_edicao: expected, idempotency_key: chave });
  return sendEventEditionTransaction(db, { ...input, customer_code: ator.customer_code }, ator, {});
}

async function cancelar(id: string, chave: string, ator: Ator = cristiane, motivo?: string) {
  const input = entradaDe(CancelarEdicaoSchema, { id, idempotency_key: chave, ...(motivo ? { motivo } : {}) });
  return cancelEventEditionTransaction(db, { ...input, customer_code: ator.customer_code }, ator);
}

async function arquivar(eventId: string, chave: string, ator: Ator = cristiane) {
  return archiveClientEventTransaction(db, { event_id: eventId, idempotency_key: chave, customer_code: ator.customer_code }, ator);
}

async function gravada(id: string) {
  return (await db.collection(EDICOES_COLLECTION).doc(id).get()).data() ?? {};
}

async function capa(id: string) {
  return (await db.collection(EVENTOS_COLLECTION).doc(id).get()).data() ?? {};
}

async function eventsFor(id: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", id).get();
  return snapshot.docs.map((document) => document.data());
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (erro: unknown) => {
    assert.equal((erro as { code?: string }).code, codigo);
    assert.equal((erro as Error).message, mensagem);
    return true;
  });
}

const momento = (tipo: string, data: string, hora: string, extra: Record<string, unknown> = {}) => ({ tipo, data, hora, ...extra });

/** O cronograma da Necton de 28 e 29/01/2027, na ordem dos sete tipos. */
const CRONOGRAMA_DA_NECTON = [
  momento("coleta_no_cliente", "2027-01-27", "05:00"),
  momento("entrega_no_local", "2027-01-27", "08:30"),
  momento("montagem", "2027-01-27", "10:00", { ate: "19:00", observacao: "2 estoquistas e 2 pessoas do cliente" }),
  momento("evento", "2027-01-28", "08:00", { ate: "20:00" }),
  momento("desmontagem", "2027-01-29", "20:00"),
  momento("retorno_ao_estoque", "2027-01-30", "09:00"),
  momento("entrega_de_volta", "2027-01-30", "14:00"),
];

const sku = (n: number) => `BTG-${String(n).padStart(6, "0")}`;
const itensDaNecton = (quantidade: (n: number) => number) =>
  Array.from({ length: 100 }, (_, n) => ({ sku_code: sku(n + 1), client_item_code: `A.01.${String(n + 1).padStart(4, "0")}`, product_name: `Polo ${n + 1}`, quantity: quantidade(n) }));

const OBSERVACAO_DA_NECTON = "Separação dos móveis que estão no estoque Dutelog. ".repeat(8).trim().slice(0, 418).padEnd(418, ".");

/** Uma edição pronta para enviar: o local, um item, o evento, a entrega e o retorno. */
async function prontaParaEnviar(chave: string, ator: Ator = cristiane) {
  return criar(
    {
      idempotency_key: chave,
      name: "B2B Conference Necton",
      patch: {
        onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700" },
        cronograma: [momento("entrega_no_local", "2027-01-27", "08:30"), momento("evento", "2027-01-28", "08:00"), momento("retorno_ao_estoque", "2027-01-30", "09:00")],
        itens: [{ sku_code: sku(1), product_name: "Polo 1", quantity: 20 }],
      },
    },
    ator,
  );
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "eventos-edicao-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
});

describe("a edição do evento no servidor", () => {
  it("1. nasce com o nome só: rascunho, edicao 1, a capa com editions_count 1, o preço vazio e o evento de auditoria", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0001", name: "B2B Conference Necton", description: "Conferência anual de clientes" });
    assert.equal(r.created, true);
    assert.equal(r.edicao, 1);
    assert.match(r.id, /^ced_[0-9a-f]{16}$/);
    assert.equal(r.edition.status, "rascunho");
    assert.match(r.edition.created_at ?? "", /^\d{4}-\d{2}-\d{2}T/);

    const edicao = await gravada(r.id);
    assert.equal(edicao.status, "rascunho");
    assert.equal(edicao.edicao, 1);
    assert.equal(edicao.customer_code, BTG);
    assert.equal(edicao.event_name, "B2B Conference Necton");
    assert.equal(edicao.label, null);
    assert.deepEqual(edicao.itens, []);
    assert.equal(edicao.itens_total, 0);
    assert.equal(edicao.pecas_total, 0);
    assert.deepEqual(edicao.cronograma, []);
    assert.deepEqual(edicao.coleta, { onde: null, quantidade: 0, voltou: null, distribuidos: null });
    assert.equal(edicao.pedido, null);
    assert.equal(edicao.separar_ate, null);
    assert.deepEqual(edicao.created_by, { uid: "cli-1", name: "Cristiane", role: "cliente" });
    assert.ok(edicao.created_at?.toDate, "created_at é Timestamp");
    assert.equal("valor_declarado_cents" in edicao.coleta, false);

    const evento = await capa(String(edicao.event_id));
    assert.match(String(edicao.event_id), /^cve_[0-9a-f]{16}$/);
    assert.equal(evento.name, "B2B Conference Necton");
    assert.equal(evento.description, "Conferência anual de clientes");
    assert.equal(evento.status, "active");
    assert.equal(evento.editions_count, 1);
    assert.equal(evento.last_edition_id, r.id);
    assert.equal(evento.customer_code, BTG);

    const preco = (await db.collection(PRECOS_COLLECTION).doc(r.id).get()).data() ?? {};
    assert.equal(preco.customer_code, BTG);
    assert.equal(preco.valor_declarado_cents, null);
    assert.equal(preco.fechado_cents, null);

    const eventos = await eventsFor(r.id);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].type, "evento.edicao_salva");
    assert.equal(eventos[0].entity_type, "client_event_edition");
    assert.equal(eventos[0].source, "functions_client_events");
    assert.equal(eventos[0].description, "B2B Conference Necton");
    assert.deepEqual(eventos[0].payload, { edition_id: r.id, event_id: edicao.event_id, criada: true, itens: 0, momentos: 0 });
  });

  it("2. a mesma chave de criação devolve a mesma edição sem segundo documento", async () => {
    const primeira = await criar({ idempotency_key: "necton-2027-0002", name: "B2B Conference Necton" });
    const segunda = await criar({ idempotency_key: "necton-2027-0002", name: "B2B Conference Necton" });
    assert.equal(segunda.id, primeira.id);
    assert.equal(segunda.created, false);
    assert.equal(segunda.edicao, 1);
    assert.equal((await db.collection(EDICOES_COLLECTION).get()).size, 1);
    assert.equal((await db.collection(EVENTOS_COLLECTION).get()).size, 1);
    assert.equal((await eventsFor(primeira.id)).length, 1);
    assert.equal((await capa(String((await gravada(primeira.id)).event_id))).editions_count, 1);
  });

  it("3. o patch com 100 itens de 1.000.000 e 12 momentos grava, relê e soma itens_total e pecas_total; size e category vêm de client_inventory", async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, n) =>
        db.collection("client_inventory").doc(`cinv_BTG_Pactual__${sku(n + 1)}`).set({
          customer_code: BTG,
          sku_code: sku(n + 1),
          product_name: `Polo ${n + 1}`,
          ...(n === 99 ? {} : { size: "G", category: "Polo" }),
        }),
      ),
    );
    await db.collection("client_inventory").doc(`cinv_Outro__${sku(1)}`).set({ customer_code: "Outro", sku_code: sku(1), size: "PP", category: "Outra" });
    const r = await criar({ idempotency_key: "necton-2027-0003", name: "B2B Conference Necton" });
    const outros = Array.from({ length: 5 }, (_, n) => momento("outro", "2027-01-31", "10:00", { rotulo: `Reunião ${n + 1}` }));
    const itens = itensDaNecton(() => 1_000_000).map((item, n) => (n === 99 ? { ...item, size: "XG", category: "Camisa" } : item));
    const mudou = await mudar(r.id, 1, { cronograma: [...CRONOGRAMA_DA_NECTON, ...outros], itens });
    assert.equal(mudou.edicao, 2);

    const edicao = await gravada(r.id);
    assert.equal(edicao.itens.length, 100);
    assert.equal(edicao.itens_total, 100);
    assert.equal(edicao.pecas_total, 100_000_000);
    assert.equal(edicao.itens[0].size, "G");
    assert.equal(edicao.itens[0].category, "Polo");
    assert.equal(edicao.itens[99].size, "XG", "sem o campo na projeção, vale o que veio");
    assert.equal(edicao.itens[99].category, "Camisa");
    assert.deepEqual(
      [edicao.itens[0].foi, edicao.itens[0].voltou, edicao.itens[0].avariadas, edicao.itens[0].nao_voltaram, edicao.itens[0].observacao],
      [null, null, null, null, null],
    );
    assert.equal(edicao.cronograma.length, 12);
    const ids = edicao.cronograma.map((m: { id: string }) => m.id);
    assert.ok(ids.every((id: string) => /^mo_[0-9a-f]{8}$/.test(id)));
    assert.equal(new Set(ids).size, 12);
    assert.equal(edicao.cronograma[2].previsto.ate, "19:00");
    assert.equal(edicao.cronograma[2].feito, null);
    assert.equal(edicao.cronograma[7].rotulo, "Reunião 1");
    assert.equal(edicao.label, "2027");
    assert.ok(JSON.stringify(edicao).length < 1_048_576);
    assert.equal(mudou.edition.itens.length, 100);
    assert.equal(mudou.edition.cronograma[0].id, ids[0]);
  });

  it("4. o patch com expected_edicao velho recusa com 'A edição mudou em outra aba' e não grava", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0004", name: "B2B Conference Necton" });
    await mudar(r.id, 1, { observacoes: "Primeira aba" });
    await recusa(mudar(r.id, 1, { observacoes: "Segunda aba" }), "failed-precondition", "A edição mudou em outra aba");
    const edicao = await gravada(r.id);
    assert.equal(edicao.edicao, 2);
    assert.equal(edicao.observacoes, "Primeira aba");
    assert.equal((await eventsFor(r.id)).length, 2);
  });

  it("5. a observação de 418 caracteres é aceita; a de 301 em Montagem recusa dizendo o campo", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0005", name: "B2B Conference Necton" });
    await mudar(r.id, 1, { observacoes: OBSERVACAO_DA_NECTON, cronograma: [momento("montagem", "2027-01-27", "10:00", { observacao: "m".repeat(300) })] });
    assert.equal((await gravada(r.id)).observacoes.length, 418);
    await recusa(
      mudar(r.id, 2, { cronograma: [momento("entrega_no_local", "2027-01-27", "08:30"), momento("montagem", "2027-01-27", "10:00", { observacao: "m".repeat(301) })] }),
      "invalid-argument",
      "A observação de Montagem passa de 300 caracteres",
    );
    assert.equal((await gravada(r.id)).edicao, 2);
  });

  it("6. enviar sem o momento evento recusa 'Informe a data do evento'; sem itens nem coleta, 'Escolha ao menos um item ou informe a coleta no cliente'", async () => {
    const semEvento = await criar({
      idempotency_key: "necton-2027-0006",
      name: "B2B Conference Necton",
      patch: { onde: { local: "Hotel Unique" }, itens: [{ sku_code: sku(1), product_name: "Polo 1", quantity: 1 }], cronograma: [momento("entrega_no_local", "2027-01-27", "08:30")] },
    });
    await recusa(enviar(semEvento.id, 1, "enviar-0006a"), "failed-precondition", "Informe a data do evento");
    const vazia = await criar({ idempotency_key: "necton-2027-0007", name: "B2B Conference Necton", patch: { onde: { local: "Hotel Unique" } } });
    await recusa(enviar(vazia.id, 1, "enviar-0006b"), "failed-precondition", "Escolha ao menos um item ou informe a coleta no cliente");
    const semLocal = await criar({ idempotency_key: "necton-2027-0008", name: "B2B Conference Necton" });
    await recusa(enviar(semLocal.id, 1, "enviar-0006c"), "failed-precondition", "Informe o local");
    assert.equal((await gravada(semEvento.id)).status, "rascunho");
    assert.equal((await db.collection(OPERATIONS_COLLECTION).get()).size, 0);
  });

  it("7. enviar grava enviado e enviada_em, com o evento edicao_enviada; a mesma chave devolve o mesmo; outra chave com outro conteúdo recusa", async () => {
    const r = await prontaParaEnviar("necton-2027-0009");
    const enviado = await enviar(r.id, 1, "enviar-0007");
    assert.equal(enviado.status, "enviado");
    assert.equal(enviado.request_id, null);
    assert.equal(enviado.edition.status, "enviado");
    const edicao = await gravada(r.id);
    assert.equal(edicao.status, "enviado");
    assert.equal(edicao.edicao, 2);
    assert.ok(edicao.enviada_em?.toDate, "enviada_em é Timestamp");
    assert.equal(edicao.pedido, null);
    const recibos = await db.collection(OPERATIONS_COLLECTION).get();
    assert.equal(recibos.size, 1);
    const recibo = recibos.docs[0]!.data();
    assert.match(recibos.docs[0]!.id, /^op_evento_send_[0-9a-f]{32}$/);
    assert.equal(recibo.kind, "evento.send");
    assert.deepEqual(recibo.result, { id: r.id, status: "enviado", request_id: null });
    const enviada = (await eventsFor(r.id)).filter((evento) => evento.type === "evento.edicao_enviada");
    assert.equal(enviada.length, 1);
    assert.deepEqual(enviada[0].payload, { edition_id: r.id, request_id: null, itens: 1, pecas: 20 });

    const repetido = await enviar(r.id, 1, "enviar-0007");
    assert.deepEqual({ ...repetido, edition: undefined }, { ...enviado, edition: undefined });
    assert.equal(repetido.edition.status, "enviado");
    assert.equal((await eventsFor(r.id)).filter((evento) => evento.type === "evento.edicao_enviada").length, 1);
    await recusa(enviar(r.id, 2, "enviar-0007"), "already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
    await recusa(enviar(r.id, 2, "enviar-0007b"), "failed-precondition", "A edição já foi enviada.");
  });

  it("8. depois do envio o cliente não muda nada e a coordenação muda só onde, cronograma, label e o evento; o separar_ate recusa 'O separar até nasce na confirmação'", async () => {
    const r = await prontaParaEnviar("necton-2027-0010");
    await enviar(r.id, 1, "enviar-0008");
    await recusa(mudar(r.id, 2, { observacoes: "Mais um estoquista" }), "failed-precondition", "A edição não aceita mudança neste status");
    await recusa(mudar(r.id, 2, { onde: { local: "Outro hotel" } }), "failed-precondition", "A edição não aceita mudança neste status");
    await recusa(mudar(r.id, 2, { itens: [] }, manoel), "failed-precondition", "Os itens não mudam depois do envio");
    await recusa(mudar(r.id, 2, { separar_ate: "2027-01-26" }, manoel), "failed-precondition", "O separar até nasce na confirmação");
    await recusa(mudar(r.id, 2, { observacoes: "Da coordenação" }, manoel), "failed-precondition", "A edição não aceita mudança neste status");
    const mudou = await mudar(r.id, 2, { onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700 · Salão Paris" }, label: "Edição 2027" }, manoel);
    assert.equal(mudou.edicao, 3);
    const edicao = await gravada(r.id);
    assert.equal(edicao.onde.endereco, "Av. Brigadeiro Luís Antônio, 4700 · Salão Paris");
    assert.equal(edicao.label, "Edição 2027");
    assert.equal(edicao.status, "enviado");
    assert.deepEqual(edicao.updated_by, { uid: "manoel", name: "Manoel", role: "interno" });
    await mudar(r.id, 3, { evento: { name: "B2B Conference Necton 2027" } }, manoel);
    assert.equal((await capa(String(edicao.event_id))).name, "B2B Conference Necton 2027");
  });

  it("9. cancelar o rascunho (o cliente, ou a coordenação em nome dele) apaga a edição, o preço e o evento criado só para ele; o evento com outra edição fica", async () => {
    const sozinha = await criar({ idempotency_key: "necton-2027-0011", name: "Workshop de líderes" });
    const eventoSozinho = String((await gravada(sozinha.id)).event_id);
    assert.deepEqual(await cancelar(sozinha.id, "cancelar-0009a"), { id: sozinha.id, resultado: "excluida" });
    assert.equal((await db.collection(EDICOES_COLLECTION).doc(sozinha.id).get()).exists, false);
    assert.equal((await db.collection(PRECOS_COLLECTION).doc(sozinha.id).get()).exists, false);
    assert.equal((await db.collection(EVENTOS_COLLECTION).doc(eventoSozinho).get()).exists, false);
    const excluida = (await eventsFor(sozinha.id)).filter((evento) => evento.type === "evento.edicao_excluida");
    assert.deepEqual(excluida[0]?.payload, { edition_id: sozinha.id, event_id: eventoSozinho, evento_excluido: true });

    const primeira = await criar({ idempotency_key: "necton-2027-0012", name: "B2B Conference Necton" });
    const eventId = String((await gravada(primeira.id)).event_id);
    const segunda = await criar({ idempotency_key: "necton-2027-0013", event_id: eventId });
    assert.equal((await capa(eventId)).editions_count, 2);
    assert.equal((await capa(eventId)).last_edition_id, segunda.id);
    assert.deepEqual(await cancelar(segunda.id, "cancelar-0009b", manoel), { id: segunda.id, resultado: "excluida" });
    const evento = await capa(eventId);
    assert.equal(evento.editions_count, 1);
    assert.equal(evento.last_edition_id, primeira.id);
    const excluidaPelaCoordenacao = (await eventsFor(segunda.id)).filter((e) => e.type === "evento.edicao_excluida");
    assert.deepEqual(excluidaPelaCoordenacao[0]?.payload, { edition_id: segunda.id, event_id: eventId, evento_excluido: false });
    assert.equal(excluidaPelaCoordenacao[0]?.actor.uid, "manoel");
    assert.deepEqual(await cancelar(segunda.id, "cancelar-0009b", manoel), { id: segunda.id, resultado: "excluida" });
  });

  it("10. o cliente cancela a enviada; a confirmada recusa 'Só a coordenação cancela uma edição confirmada.'", async () => {
    const r = await prontaParaEnviar("necton-2027-0014");
    await enviar(r.id, 1, "enviar-0010");
    assert.deepEqual(await cancelar(r.id, "cancelar-0010a"), { id: r.id, resultado: "cancelada" });
    const edicao = await gravada(r.id);
    assert.equal(edicao.status, "cancelado");
    assert.equal(edicao.cancelamento_motivo, null);
    assert.deepEqual(edicao.cancelada_por, { uid: "cli-1", name: "Cristiane", role: "cliente" });
    assert.ok(edicao.cancelada_em?.toDate, "cancelada_em é Timestamp");
    const cancelada = (await eventsFor(r.id)).filter((evento) => evento.type === "evento.edicao_cancelada");
    assert.deepEqual(cancelada[0]?.payload, { edition_id: r.id, status_anterior: "enviado" });
    assert.deepEqual(await cancelar(r.id, "cancelar-0010a"), { id: r.id, resultado: "cancelada" });
    await recusa(cancelar(r.id, "cancelar-0010b"), "failed-precondition", "A edição já foi cancelada.");

    const daCoordenacao = await prontaParaEnviar("necton-2027-0015");
    await enviar(daCoordenacao.id, 1, "enviar-0010b");
    await recusa(cancelar(daCoordenacao.id, "cancelar-0010c", manoel), "invalid-argument", "Informe o motivo");
    assert.equal((await gravada(daCoordenacao.id)).status, "enviado");
    await cancelar(daCoordenacao.id, "cancelar-0010d", manoel, "O cliente desistiu por telefone");
    assert.equal((await gravada(daCoordenacao.id)).cancelamento_motivo, "O cliente desistiu por telefone");

    const confirmada = await prontaParaEnviar("necton-2027-0016");
    await db.collection(EDICOES_COLLECTION).doc(confirmada.id).update({ status: "confirmado" });
    await recusa(cancelar(confirmada.id, "cancelar-0010e"), "failed-precondition", "Só a coordenação cancela uma edição confirmada.");
    await db.collection(EDICOES_COLLECTION).doc(confirmada.id).update({ status: "no_evento" });
    await recusa(cancelar(confirmada.id, "cancelar-0010f"), "failed-precondition", "Os itens já saíram: registre o retorno e feche a edição.");
    await db.collection(EDICOES_COLLECTION).doc(confirmada.id).update({ status: "fechado" });
    await recusa(cancelar(confirmada.id, "cancelar-0010g"), "failed-precondition", "A edição já está fechada.");
  });

  it("11. arquivar com edição aberta recusa; depois de cancelar, arquiva com o evento 'arquivado'", async () => {
    const r = await prontaParaEnviar("necton-2027-0017");
    const eventId = String((await gravada(r.id)).event_id);
    await recusa(arquivar(eventId, "arquivar-0011a"), "failed-precondition", "O evento tem uma edição aberta: termine ou exclua antes de arquivar.");
    await enviar(r.id, 1, "enviar-0011");
    await recusa(arquivar(eventId, "arquivar-0011b"), "failed-precondition", "O evento tem uma edição aberta: termine ou exclua antes de arquivar.");
    await cancelar(r.id, "cancelar-0011");
    assert.deepEqual(await arquivar(eventId, "arquivar-0011c"), { event_id: eventId, changed: true });
    const evento = await capa(eventId);
    assert.equal(evento.status, "archived");
    assert.deepEqual(evento.archived_by, { uid: "cli-1", name: "Cristiane", role: "cliente" });
    const arquivado = (await eventsFor(eventId)).filter((e) => e.type === "evento.arquivado");
    assert.equal(arquivado.length, 1);
    assert.equal(arquivado[0]?.entity_type, "client_event");
    assert.deepEqual(arquivado[0]?.payload, { event_id: eventId, edicoes: 1 });
    assert.deepEqual(await arquivar(eventId, "arquivar-0011c"), { event_id: eventId, changed: true });
    assert.deepEqual(await arquivar(eventId, "arquivar-0011d"), { event_id: eventId, changed: false });
    assert.equal((await eventsFor(eventId)).filter((e) => e.type === "evento.arquivado").length, 1);
    await recusa(criar({ idempotency_key: "necton-2027-0018", event_id: eventId }), "not-found", "Evento não encontrado.");
  });

  it("12. o cliente de outro código recebe not-found ao ler, mudar, enviar e cancelar", async () => {
    const r = await prontaParaEnviar("necton-2027-0019");
    const eventId = String((await gravada(r.id)).event_id);
    await recusa(db.runTransaction((transaction) => lerEdicaoDoCliente(transaction, db, r.id, "Outro")), "not-found", "Edição não encontrada.");
    await recusa(mudar(r.id, 1, { observacoes: "De outro cliente" }, outraCliente), "not-found", "Edição não encontrada.");
    await recusa(enviar(r.id, 1, "enviar-0012", outraCliente), "not-found", "Edição não encontrada.");
    await recusa(cancelar(r.id, "cancelar-0012", outraCliente), "not-found", "Edição não encontrada.");
    await recusa(arquivar(eventId, "arquivar-0012", outraCliente), "not-found", "Evento não encontrado.");
    await recusa(criar({ idempotency_key: "outro-0001", event_id: eventId }, outraCliente), "not-found", "Evento não encontrado.");
    await recusa(criar({ idempotency_key: "outro-0002", name: "Feira", origem_edicao_id: r.id }, outraCliente), "not-found", "Edição não encontrada.");
    const edicao = await gravada(r.id);
    assert.equal(edicao.edicao, 1);
    assert.equal(edicao.status, "rascunho");
  });

  it("13. o segundo patch do cronograma mantém os ids e o feito do momento registrado", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0020", name: "B2B Conference Necton" });
    await mudar(r.id, 1, {
      cronograma: [
        momento("entrega_no_local", "2027-01-27", "08:30"),
        momento("montagem", "2027-01-27", "10:00"),
        momento("evento", "2027-01-28", "08:00"),
        momento("outro", "2027-01-29", "09:00", { rotulo: "Ensaio" }),
      ],
    });
    const primeiro = (await gravada(r.id)).cronograma as Array<Record<string, unknown>>;
    const [entrega, montagem, evento, ensaio] = primeiro.map((m) => String(m.id));
    const feito = { inicio: "2027-01-27T13:05:00.000Z", fim: null, observacao: "Começou às 10:05", origem: "registro", registrado_por: { uid: "manoel", name: "Manoel", role: "interno" }, registrado_em: "2027-01-27T13:06:00.000Z", corrigido_em: null };
    await db.collection(EDICOES_COLLECTION).doc(r.id).update({
      cronograma: primeiro.map((m) => (m.id === montagem ? { ...m, feito } : m)),
      fotos: [{ id: "ft_0123456789abcdef", caminho: "eventos/x/y/fotos/ft_0123456789abcdef.jpg", momento_id: ensaio }],
    });

    await mudar(r.id, 2, {
      cronograma: [
        momento("entrega_no_local", "2027-01-27", "07:30", { id: entrega }),
        momento("montagem", "2027-01-27", "11:00", { id: montagem, ate: "19:00" }),
        momento("evento", "2027-01-28", "09:00"),
        momento("outro", "2027-01-29", "10:00", { id: ensaio, rotulo: "Ensaio geral" }),
        momento("desmontagem", "2027-01-29", "20:00"),
      ],
    });
    // Na ordem dos tipos: a desmontagem nova entra antes do outro momento.
    const segundo = (await gravada(r.id)).cronograma as Array<Record<string, any>>;
    assert.deepEqual(segundo.map((m) => m.tipo), ["entrega_no_local", "montagem", "evento", "desmontagem", "outro"]);
    assert.deepEqual([segundo[0]!.id, segundo[1]!.id, segundo[2]!.id, segundo[4]!.id], [entrega, montagem, evento, ensaio]);
    assert.deepEqual(segundo[1]!.feito, feito);
    assert.deepEqual(segundo[1]!.previsto, { data: "2027-01-27", hora: "11:00", ate: "19:00", local: null, observacao: null });
    assert.equal(segundo[0]!.previsto.hora, "07:30");
    assert.equal(segundo[2]!.previsto.hora, "09:00");
    assert.equal(segundo[4]!.rotulo, "Ensaio geral");
    assert.match(segundo[3]!.id, /^mo_[0-9a-f]{8}$/);
    assert.ok(!primeiro.some((m) => m.id === segundo[3]!.id));
    assert.equal(segundo[3]!.feito, null);

    const semMontagem = segundo.filter((m) => m.id !== montagem).map((m) => ({ id: m.id, tipo: m.tipo, ...(m.rotulo ? { rotulo: m.rotulo } : {}), data: m.previsto.data, hora: m.previsto.hora }));
    await recusa(mudar(r.id, 3, { cronograma: semMontagem }), "failed-precondition", "Montagem já tem registro e não sai do cronograma");
    const semEnsaio = segundo.filter((m) => m.id !== ensaio).map((m) => ({ id: m.id, tipo: m.tipo, data: m.previsto.data, hora: m.previsto.hora }));
    await recusa(mudar(r.id, 3, { cronograma: semEnsaio }), "failed-precondition", "Ensaio geral já tem registro e não sai do cronograma");
    assert.equal((await gravada(r.id)).edicao, 3);
  });

  it("14. o patch do evento muda o nome e a descrição na capa e o event_name desta edição, só quando diferem do gravado: o cliente em rascunho, a coordenação até confirmado; a outra edição do evento guarda o nome que tinha", async () => {
    const primeira = await prontaParaEnviar("necton-2027-0021");
    const eventId = String((await gravada(primeira.id)).event_id);
    await mudar(primeira.id, 1, { evento: { name: "B2B Conference Necton 2027", description: "Hotel Unique, dois dias" } });
    let evento = await capa(eventId);
    assert.equal(evento.name, "B2B Conference Necton 2027");
    assert.equal(evento.description, "Hotel Unique, dois dias");
    assert.equal((await gravada(primeira.id)).event_name, "B2B Conference Necton 2027");

    const antes = evento.updated_at.toMillis();
    await mudar(primeira.id, 2, { evento: { name: "B2B Conference Necton 2027", description: "Hotel Unique, dois dias" } });
    evento = await capa(eventId);
    assert.equal(evento.updated_at.toMillis(), antes, "igual ao gravado, a capa não é escrita");

    const segunda = await criar({ idempotency_key: "necton-2027-0022", event_id: eventId });
    assert.equal((await gravada(segunda.id)).event_name, "B2B Conference Necton 2027");
    await mudar(segunda.id, 1, { evento: { name: "Necton Conference" } });
    assert.equal((await capa(eventId)).name, "Necton Conference");
    assert.equal((await gravada(segunda.id)).event_name, "Necton Conference");
    assert.equal((await gravada(primeira.id)).event_name, "B2B Conference Necton 2027");

    await enviar(primeira.id, 3, "enviar-0014");
    await recusa(mudar(primeira.id, 4, { evento: { name: "Pelo cliente" } }), "failed-precondition", "A edição não aceita mudança neste status");
    await db.collection(EDICOES_COLLECTION).doc(primeira.id).update({ status: "confirmado" });
    await mudar(primeira.id, 4, { evento: { name: "Necton 2027" }, separar_ate: "2027-01-26" }, manoel);
    assert.equal((await capa(eventId)).name, "Necton 2027");
    const confirmada = await gravada(primeira.id);
    assert.equal(confirmada.event_name, "Necton 2027");
    assert.equal(confirmada.separar_ate, "2027-01-26");
    assert.equal(confirmada.pedido, null);
  });

  it("15. depois do envio, o patch da coordenação não tira o que o envio exigiu; o rascunho grava aos poucos", async () => {
    const r = await prontaParaEnviar("necton-2027-0030");
    await enviar(r.id, 1, "enviar-0015");
    const gravado = (await gravada(r.id)).cronograma as Array<Record<string, any>>;
    const linhas = (troca: (m: Record<string, any>) => Record<string, unknown> = () => ({})) =>
      gravado.map((m) => ({ id: m.id, tipo: m.tipo, data: m.previsto.data, hora: m.previsto.hora, ...troca(m) }));
    await recusa(mudar(r.id, 2, { cronograma: linhas().filter((m) => m.tipo !== "evento") }, manoel), "failed-precondition", "Informe a data do evento");
    await recusa(
      mudar(r.id, 2, { cronograma: linhas((m) => (m.tipo === "retorno_ao_estoque" ? { data: "2027-01-26" } : {})) }, manoel),
      "failed-precondition",
      "Retorno ao estoque Dutelog está antes de Evento",
    );
    await recusa(mudar(r.id, 2, { onde: { local: null, endereco: "Av. Brigadeiro Luís Antônio, 4700" } }, manoel), "failed-precondition", "Informe o local");
    assert.equal((await gravada(r.id)).edicao, 2);
    await mudar(r.id, 2, { cronograma: linhas((m) => (m.tipo === "evento" ? { hora: "09:00" } : {})) }, manoel);
    assert.equal((await gravada(r.id)).edicao, 3);

    const rascunho = await criar({ idempotency_key: "necton-2027-0031", name: "Workshop de líderes" });
    await mudar(rascunho.id, 1, { cronograma: [momento("montagem", "2027-01-27", "10:00")], onde: { local: null } });
    assert.equal((await gravada(rascunho.id)).edicao, 2);
  });

  it("16. o cronograma grava na ordem dos tipos, com os outros por último, como o formulário mostra", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0032", name: "B2B Conference Necton" });
    await mudar(r.id, 1, {
      cronograma: [
        momento("outro", "2027-01-26", "15:00", { rotulo: "Vistoria do salão" }),
        momento("retorno_ao_estoque", "2027-01-30", "09:00"),
        momento("evento", "2027-01-28", "08:00"),
        momento("entrega_no_local", "2027-01-27", "08:30"),
        momento("outro", "2027-01-29", "07:00", { rotulo: "Café da equipe" }),
      ],
      onde: { local: "Hotel Unique" },
      itens: [{ sku_code: sku(1), product_name: "Polo 1", quantity: 20 }],
    });
    const cronograma = (await gravada(r.id)).cronograma as Array<Record<string, any>>;
    assert.deepEqual(
      cronograma.map((m) => m.rotulo ?? m.tipo),
      ["entrega_no_local", "evento", "retorno_ao_estoque", "Vistoria do salão", "Café da equipe"],
    );
    assert.equal((await enviar(r.id, 2, "enviar-0016")).status, "enviado");
  });

  it("a edição da Necton nasce, muda em dois patches e é enviada; a segunda edição do evento é excluída e o evento fica", async () => {
    const r = await criar({ idempotency_key: "necton-2027-0100", name: "B2B Conference Necton" });
    const eventId = String((await gravada(r.id)).event_id);
    const primeiro = await mudar(r.id, 1, {
      onde: { local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700 · São Paulo/SP", contato: { nome: "Cristiane", telefone: "11 99999-0000" } },
      cronograma: CRONOGRAMA_DA_NECTON,
      itens: itensDaNecton((n) => (n < 20 ? 20 : n < 60 ? 25 : 15)),
    });
    const segundo = await mudar(r.id, primeiro.edicao, {
      coleta: { onde: "BTG Faria Lima, 3477", quantidade: 2190, valor_declarado_cents: 10_000_000 },
      observacoes: OBSERVACAO_DA_NECTON,
    });
    assert.equal(segundo.edition.pecas_total, 2000);
    assert.equal(segundo.edition.coleta.quantidade, 2190);
    assert.equal((await db.collection(PRECOS_COLLECTION).doc(r.id).get()).data()?.valor_declarado_cents, 10_000_000);
    assert.equal("valor_declarado_cents" in (await gravada(r.id)).coleta, false);
    const enviado = await enviar(r.id, segundo.edicao, "enviar-necton-2027");
    assert.equal(enviado.edition.status, "enviado");
    assert.equal(enviado.edition.label, "2027");
    const tipos = (await eventsFor(r.id)).map((evento) => evento.type).sort();
    assert.deepEqual(tipos, ["evento.edicao_enviada", "evento.edicao_salva", "evento.edicao_salva", "evento.edicao_salva"]);
    for (const evento of await eventsFor(r.id)) {
      assert.doesNotMatch(JSON.stringify(evento.payload), /10000000|11 99999|Cristiane/);
      // A criação ainda não tem o label: o ano vem com a data do evento.
      assert.match(String(evento.description), /^B2B Conference Necton( · 2027)?$/);
    }

    const segunda = await criar({ idempotency_key: "necton-2028-0001", event_id: eventId, origem_edicao_id: r.id });
    assert.equal((await gravada(segunda.id)).origem_edicao_id, r.id);
    assert.deepEqual(await cancelar(segunda.id, "excluir-necton-2028"), { id: segunda.id, resultado: "excluida" });
    const evento = await capa(eventId);
    assert.equal(evento.editions_count, 1);
    assert.equal(evento.last_edition_id, r.id);
    assert.equal(evento.last_edition_label, "2027");
  });
});
