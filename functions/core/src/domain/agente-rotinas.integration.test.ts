import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { GerarResposta, PedidoAoModelo } from "./agente-conversa.js";
import { deleteDuteRoutineFor, listDuteRoutinesFor, pegarRotinasVencidas, rodarRotinasVencidas, runDuteRoutineNowFor, saveDuteRoutineFor } from "./agente-rotinas.js";
import type { CoreProfile } from "./profile.js";

/**
 * As rotinas do Agent Dute no núcleo, no emulador (parte 5.5g). A rotina é
 * da pessoa, no cliente e no módulo dela; pelo cartão, a mesma mensagem não
 * cria duas. A rodada pega cada vencida uma vez só e roda pelo fluxo da
 * conversa, com o perfil atual de quem criou: sem histórico, com a origem
 * "rotina". Sem acesso, pausa; a falha tenta de novo uma vez. Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
// 23/10/2026, 12:00 em São Paulo: a próxima das 08:00 é amanhã.
const AGORA = new Date("2026-10-23T15:00:00.000Z");
const AMANHA_8H = "2026-10-24T11:00:00.000Z";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-rotinas-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.collection("users").doc("cli-itau"), { role: "cliente", customer_code: "ITAU", nome: "Renata", email: "renata@itau.com" });
  batch.set(db.collection("users").doc("ops-1"), { role: "interno", nome: "Ops" });
  batch.set(db.collection("customers").doc("cus_itau"), { customer_code: "ITAU", operation_template: "uniformes" });
  batch.set(db.collection("customers").doc("cus_safra"), { customer_code: "SAFRA" });
  batch.set(db.collection("client_access").doc("ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao"] });
  batch.set(db.collection("client_access").doc("SAFRA"), { customer_code: "SAFRA", modules: ["wms"] });
  batch.set(db.collection("client_inventory").doc("i1"), { customer_code: "ITAU", sku_code: "ITAU-000001", client_item_code: "POLO-M", product_name: "Camisa polo", qty_on_hand: 30 });
  batch.set(db.collection("agent_messages").doc("msg_agent_1"), {
    id: "msg_agent_1",
    conversation_id: "conv_1",
    customer_code: "ITAU",
    user_id: "cli-itau",
    role: "assistant",
    content: "Posso criar a rotina.",
    draft: { tipo: "rotina", nome: "Saldo diário", pergunta: "Quanto tenho de polo M?", frequency: "daily", days: [], day_of_month: null, time: "08:00" },
  });
  await batch.commit();
});

const cliente: CoreProfile = { uid: "cli-itau", role: "cliente", customerCode: "ITAU", name: "Renata", email: "renata@itau.com" };
const interno: CoreProfile = { uid: "ops-1", role: "interno", name: "Ops" };
const agora = () => AGORA;

const rotina = (extra: Record<string, unknown> = {}) => ({ modulo: "wms", name: "Saldo diário", prompt: "Quanto tenho de polo M?", frequency: "daily", time: "08:00", ...extra });

let contador = 0;
const novoId = (prefixo: string) => `${prefixo}_${String(++contador).padStart(4, "0")}`;

/** O modelo falso: consulta o estoque e responde; anota o pedido. */
function modelo(registro: PedidoAoModelo[] = []): GerarResposta {
  return async (pedido) => {
    registro.push(pedido);
    await pedido.ferramentas.find((item) => item.nome === "resumo_estoque")?.executar({});
    return { texto: "Você tem **30** polos M.", fonte: "genkit_teste", modelo: "teste", tokens_entrada: 50, tokens_saida: 10, latencia_ms: 3 };
  };
}

const semModelo: GerarResposta = async () => ({ texto: "Não consegui consultar os dados agora.", fonte: "fallback_indisponivel", erro: "teste: fora do ar" });

async function doc(colecao: string, id: string) {
  return (await db.collection(colecao).doc(id).get()).data();
}

async function todos(colecao: string) {
  return (await db.collection(colecao).get()).docs.map((item) => item.data());
}

async function vencer(id: string) {
  await db.collection("agent_routines").doc(id).update({ next_run_at: "2026-10-23T14:00:00.000Z" });
}

describe("a rotina da pessoa", () => {
  it("pelo cartão: o id vem da mensagem, a mensagem guarda a rotina e repetir não cria outra", async () => {
    const criada = await saveDuteRoutineFor(db, cliente, rotina({ agent_message_id: "msg_agent_1" }), agora);
    const id = `rot_${createHash("sha256").update("agent_draft_msg_agent_1").digest("hex").slice(0, 20)}`;
    assert.deepEqual(criada, { id, name: "Saldo diário", created: true });

    const salva = await doc("agent_routines", id);
    assert.deepEqual(
      [salva?.user_id, salva?.customer_code, salva?.modulo, salva?.frequency, salva?.time, salva?.active, salva?.next_run_at, salva?.conversation_id, salva?.retry_pending, salva?.last_status],
      ["cli-itau", "ITAU", "wms", "daily", "08:00", true, AMANHA_8H, `routine_${id}`, false, null],
    );
    assert.deepEqual((await doc("agent_messages", "msg_agent_1"))?.draft_sent, { request_id: id, request_number: "Saldo diário", sent_at: AGORA.toISOString() });

    assert.deepEqual(await saveDuteRoutineFor(db, cliente, rotina({ agent_message_id: "msg_agent_1" }), agora), { id, name: "Saldo diário", created: false, replayed: true });
    assert.equal((await todos("agent_routines")).length, 1);
  });

  it("o cartão de outra pessoa ou sem rotina recusa, sem gravar", async () => {
    await assert.rejects(saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", agent_message_id: "msg_agent_1" }), agora), { code: "permission-denied" });
    await db.collection("agent_messages").doc("msg_agent_1").update({ draft: { tipo: "pedido" } });
    await assert.rejects(saveDuteRoutineFor(db, cliente, rotina({ agent_message_id: "msg_agent_1" }), agora), { code: "failed-precondition" });
    assert.equal((await todos("agent_routines")).length, 0);
  });

  it("a equipe cria no cliente ativo; o cliente, só no próprio; no máximo 5 por cliente", async () => {
    await assert.rejects(saveDuteRoutineFor(db, interno, rotina(), agora), { code: "invalid-argument" });
    await assert.rejects(saveDuteRoutineFor(db, cliente, rotina({ customer_code: "SAFRA" }), agora), { code: "permission-denied" });
    for (let vez = 0; vez < 5; vez += 1) await saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", name: `Rotina ${vez}` }), agora);
    await assert.rejects(saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU" }), agora), { code: "failed-precondition" });
    // Outro cliente tem a conta dele.
    await saveDuteRoutineFor(db, interno, rotina({ customer_code: "SAFRA" }), agora);
    assert.deepEqual(
      (await listDuteRoutinesFor(db, interno, { customer_code: "SAFRA", modulo: "wms" })).items.map((item) => item.name),
      ["Saldo diário"],
    );
    assert.equal((await listDuteRoutinesFor(db, interno, { customer_code: "ITAU", modulo: "wms" })).items.length, 5);
    assert.equal((await listDuteRoutinesFor(db, cliente, { modulo: "wms" })).items.length, 0);
  });

  it("alterar e excluir só a própria; a rotina não muda de módulo", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina({ frequency: "weekly", days: [1, 3] }), agora);
    await assert.rejects(saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", id }), agora), { code: "permission-denied" });
    await assert.rejects(saveDuteRoutineFor(db, cliente, rotina({ id, modulo: "operacao" }), agora), { code: "failed-precondition" });
    await assert.rejects(saveDuteRoutineFor(db, cliente, rotina({ id: "rot_0123456789abcdef0123" }), agora), { code: "not-found" });

    const pausada = await saveDuteRoutineFor(db, cliente, rotina({ id, name: "Saldo de segunda", active: false }), agora);
    assert.equal(pausada.created, false);
    const salva = await doc("agent_routines", id);
    assert.deepEqual([salva?.name, salva?.active, salva?.next_run_at, salva?.frequency, salva?.days], ["Saldo de segunda", false, null, "daily", []]);

    await assert.rejects(deleteDuteRoutineFor(db, interno, { id }), { code: "permission-denied" });
    await deleteDuteRoutineFor(db, cliente, { id });
    assert.equal(await doc("agent_routines", id), undefined);
  });
});

describe("a rodada das rotinas", () => {
  it("cada vencida é pega uma vez só; a pausada e a que não venceu ficam", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    const { id: pausada } = await saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", active: false }), agora);
    await saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", name: "Amanhã" }), agora);
    await vencer(id);
    await db.collection("agent_routines").doc(pausada).update({ next_run_at: "2026-10-23T14:00:00.000Z" });

    const [uma, outra] = await Promise.all([pegarRotinasVencidas(db, AGORA), pegarRotinasVencidas(db, AGORA)]);
    assert.deepEqual([...uma, ...outra].map((item) => [item.id, item.modulo, item.customer_code]), [[id, "wms", "ITAU"]]);
    const pega = await doc("agent_routines", id);
    assert.deepEqual([pega?.next_run_at, pega?.running_since], [AMANHA_8H, AGORA.toISOString()]);
  });

  it("roda pelo fluxo da conversa, sem histórico, com a origem rotina, e grava o resultado", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    await vencer(id);
    const pedidos: PedidoAoModelo[] = [];
    assert.deepEqual(await rodarRotinasVencidas(db, { gerar: modelo(pedidos), agora, novoId }), { rodadas: 1, ok: 1, falhas: 0, sem_acesso: 0, adiadas: 0 });

    assert.deepEqual(pedidos[0].historico, []);
    assert.match(pedidos[0].mensagem, /^Quanto tenho de polo M\?\n\n\(Rotina agendada "Saldo diário", sexta-feira, 23\/10\/2026\./);
    const conversa = await doc("agent_conversations", `routine_${id}`);
    assert.deepEqual([conversa?.title, conversa?.routine_id, conversa?.modulo, conversa?.user_id, conversa?.customer_code], ["Rotina: Saldo diário", id, "wms", "cli-itau", "ITAU"]);
    const mensagens = (await todos("agent_messages")).filter((item) => item.conversation_id === `routine_${id}`);
    assert.deepEqual(mensagens.map((item) => [item.role, item.source]).sort(), [["assistant", "genkit_teste"], ["user", "rotina"]]);
    assert.equal(mensagens.find((item) => item.role === "user")?.content, "Quanto tenho de polo M?");
    const [uso] = await todos("agent_usage");
    assert.deepEqual([uso.source, uso.conversation_id, uso.tools_used], ["rotina", `routine_${id}`, ["resumo_estoque"]]);

    const rodada = await doc("agent_routines", id);
    assert.deepEqual([rodada?.last_status, rodada?.last_run_at, rodada?.retry_pending, "running_since" in (rodada ?? {})], ["ok", AGORA.toISOString(), false, false]);

    // A próxima vez também responde do zero, mesmo com as mensagens de antes na conversa.
    await vencer(id);
    await rodarRotinasVencidas(db, { gerar: modelo(pedidos), agora, novoId });
    assert.deepEqual(pedidos[1].historico, []);
  });

  it("sem acesso ao agente, a rotina pausa sem chamar o modelo, em qualquer cliente", async () => {
    const pedidos: PedidoAoModelo[] = [];
    const { id: doCliente } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    const { id: daEquipe } = await saveDuteRoutineFor(db, interno, rotina({ customer_code: "ITAU", modulo: "operacao" }), agora);
    const { id: outroCliente } = await saveDuteRoutineFor(db, interno, rotina({ customer_code: "SAFRA" }), agora);
    for (const id of [doCliente, daEquipe, outroCliente]) await vencer(id);
    await db.collection("users").doc("cli-itau").update({ access_disabled: true });
    await db.collection("users").doc("ops-1").update({ role: "campo" });

    assert.deepEqual(await rodarRotinasVencidas(db, { gerar: modelo(pedidos), agora, novoId }), { rodadas: 3, ok: 0, falhas: 0, sem_acesso: 3, adiadas: 0 });
    assert.equal(pedidos.length, 0);
    for (const id of [doCliente, daEquipe, outroCliente]) {
      const pausada = await doc("agent_routines", id);
      assert.deepEqual([pausada?.active, pausada?.next_run_at, pausada?.last_status], [false, null, "no_access"]);
    }
    assert.equal((await todos("agent_messages")).length, 1);
  });

  it("o cliente que perdeu o módulo da rotina também pausa", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    await vencer(id);
    await db.collection("client_access").doc("ITAU").update({ modules: ["operacao"] });
    assert.equal((await rodarRotinasVencidas(db, { gerar: modelo(), agora, novoId })).sem_acesso, 1);
    assert.equal((await doc("agent_routines", id))?.last_status, "no_access");
  });

  it("sem modelo, não grava a resposta de reserva: tenta de novo em 15 minutos e, na segunda falha, volta à agenda", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    await vencer(id);
    assert.equal((await rodarRotinasVencidas(db, { gerar: semModelo, agora, novoId })).falhas, 1);
    const primeira = await doc("agent_routines", id);
    assert.deepEqual([primeira?.retry_pending, primeira?.next_run_at, primeira?.last_status, primeira?.last_error], [true, "2026-10-23T15:15:00.000Z", null, "teste: fora do ar"]);
    assert.equal((await todos("agent_messages")).filter((item) => item.conversation_id === `routine_${id}`).length, 0);

    const depois = new Date("2026-10-23T15:15:00.000Z");
    assert.equal((await rodarRotinasVencidas(db, { gerar: semModelo, agora: () => depois, novoId })).falhas, 1);
    const segunda = await doc("agent_routines", id);
    assert.deepEqual([segunda?.retry_pending, segunda?.next_run_at, segunda?.last_status], [false, AMANHA_8H, "failed"]);
  });

  it("a rotina excluída no meio da rodada não para as outras", async () => {
    const { id: primeira } = await saveDuteRoutineFor(db, cliente, rotina({ name: "Primeira" }), agora);
    const { id: segunda } = await saveDuteRoutineFor(db, cliente, rotina({ name: "Segunda" }), agora);
    await vencer(primeira);
    await vencer(segunda);
    const excluiAPrimeira: GerarResposta = async (pedido) => {
      if (pedido.mensagem.includes('"Primeira"')) await db.collection("agent_routines").doc(primeira).delete();
      return modelo()(pedido);
    };
    assert.deepEqual(await rodarRotinasVencidas(db, { gerar: excluiAPrimeira, agora, novoId }), { rodadas: 2, ok: 1, falhas: 1, sem_acesso: 0, adiadas: 0 });
    assert.equal((await doc("agent_routines", segunda))?.last_status, "ok");
  });

  it("rodar agora: só a própria, no máximo uma vez a cada 5 minutos, e a falha não mexe na agenda", async () => {
    const { id } = await saveDuteRoutineFor(db, cliente, rotina(), agora);
    await assert.rejects(runDuteRoutineNowFor(db, interno, { id }, { gerar: modelo(), agora, novoId }), { code: "permission-denied" });

    await assert.rejects(runDuteRoutineNowFor(db, cliente, { id }, { gerar: semModelo, agora, novoId }), { code: "unavailable" });
    const falhou = await doc("agent_routines", id);
    assert.deepEqual([falhou?.next_run_at, falhou?.retry_pending, falhou?.last_status], [AMANHA_8H, false, "failed"]);

    assert.deepEqual(await runDuteRoutineNowFor(db, cliente, { id }, { gerar: modelo(), agora, novoId }), { id, conversation_id: `routine_${id}` });
    const pouco = new Date(AGORA.getTime() + 4 * 60_000);
    await assert.rejects(runDuteRoutineNowFor(db, cliente, { id }, { gerar: modelo(), agora: () => pouco, novoId }), { code: "failed-precondition" });
    assert.equal((await doc("agent_routines", id))?.next_run_at, AMANHA_8H);
  });
});
