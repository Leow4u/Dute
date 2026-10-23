import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { AI_CURSORS_COLLECTION, CURSOR_DAS_MEDIDAS, EVENTS_COLLECTION, runMeasuresFor } from "./medidas-gravacao.js";
import { AI_MEASURES_COLLECTION, idDaMedida } from "./medidas.js";
import type { CoreProfile } from "./profile.js";
import { answerSuggestionFor, suggestDurationFor } from "./sugestao-gravacao.js";
import { AI_SUGGESTIONS_COLLECTION } from "./sugestao.js";

/**
 * A duração sugerida no emulador (parte 5.2a): o cliente vem da demanda,
 * nunca do pedido; a base é a medida do cliente com o mínimo; só quem planeja
 * pede. A resposta grava o sugerido, recalculado no servidor, a decisão e o
 * escolhido, e não toca na OS. Quando a OS é revisada, a rotina grava o valor
 * real e o erro. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
const AGORA = () => new Date("2026-10-23T12:00:00.000Z");

const interno: CoreProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const campo: CoreProfile = { uid: "campo-1", role: "campo" };
const cliente: CoreProfile = { uid: "cli-1", role: "cliente" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-sugestao-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const OS_PLANEJADA = { demanda: "10045", customer_code: "ITAU", status: "agendada", tipo: "servico", edicao: 1 };

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("demands/10045", { numero: "10045", customer_code: "ITAU", etapa: "para_planejar" });
  set("demands/20001", { numero: "20001", customer_code: "SAFRA", etapa: "para_planejar" });
  set("service_orders/10045-01", OS_PLANEJADA);
  set("service_orders/10045-02", { ...OS_PLANEJADA, demanda: "10099" });
  const medida = (tipo: "duracao_item" | "erro_planejamento", customer: string | null, chave: string, dados: Record<string, unknown>) =>
    set(`${AI_MEASURES_COLLECTION}/${idDaMedida(tipo, customer, chave)}`, { tipo, escopo: customer ? "cliente" : "geral", customer_code: customer, ...dados });
  // No Itaú, a mesa tem 6 execuções: 20 homem-minutos por unidade. Na geral, 40 execuções de 30.
  medida("duracao_item", "ITAU", "lpu_mesa", { lpu_item_id: "lpu_mesa", homem_minuto_por_unidade: 20, execucoes: 6, os_recentes: ["10040-01", "10041-01"] });
  medida("duracao_item", null, "lpu_mesa", { lpu_item_id: "lpu_mesa", homem_minuto_por_unidade: 30, execucoes: 40, os_recentes: ["20000-01"] });
  // A cadeira só tem 3 no Itaú e 10 na geral: sem base.
  medida("duracao_item", "ITAU", "lpu_cadeira", { lpu_item_id: "lpu_cadeira", homem_minuto_por_unidade: 5, execucoes: 3, os_recentes: [] });
  medida("duracao_item", null, "lpu_cadeira", { lpu_item_id: "lpu_cadeira", homem_minuto_por_unidade: 6, execucoes: 10, os_recentes: [] });
  medida("erro_planejamento", "ITAU", "os", { execucoes: 6, erro_medio_pct: 22, acima_da_janela: 5 });
  await batch.commit();
});

const PEDIDO = {
  demanda: "10045",
  pessoas: 2,
  itens: [
    { lpu_item_id: "lpu_mesa", item: "Mesa", quantidade: "12" },
    { lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "40" },
  ],
};

const resposta = (extra: Record<string, unknown> = {}) => ({ idempotency_key: "resposta-0001", os: "10045-01", decisao: "aceitou", minutos_escolhidos: 120, ...PEDIDO, ...extra });

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem?: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (mensagem) assert.equal(error.message, mensagem);
    return true;
  });
}

describe("a duração sugerida", () => {
  it("a base do cliente com o mínimo; o item sem base fica de fora; o aviso do plano otimista; nada se grava", async () => {
    const sugestao = await suggestDurationFor(db, interno, PEDIDO);
    // 12 mesas × 20 ÷ 2 pessoas = 120 minutos.
    assert.deepEqual(
      sugestao.itens.map((item) => [item.lpu_item_id, item.minutos, item.base?.escopo ?? null, item.base?.execucoes ?? null, item.base?.os_recentes ?? null]),
      [
        ["lpu_mesa", 120, "cliente", 6, ["10040-01", "10041-01"]],
        ["lpu_cadeira", null, null, null, null],
      ],
    );
    assert.deepEqual([sugestao.minutos_total, sugestao.completa, sugestao.plano_otimista?.erro_medio_pct], [120, false, 22]);
    assert.equal((await db.collection(AI_SUGGESTIONS_COLLECTION).get()).size, 0);
  });

  it("o cliente vem da demanda: a do Safra usa a geral, e nunca a do Itaú", async () => {
    const sugestao = await suggestDurationFor(db, interno, { ...PEDIDO, demanda: "20001" });
    // 12 × 30 ÷ 2 = 180, da geral com 40 execuções.
    assert.deepEqual([sugestao.itens[0].minutos, sugestao.itens[0].base?.escopo, sugestao.plano_otimista], [180, "geral", null]);
  });

  it("só quem planeja pede; a demanda que não existe recusa", async () => {
    await recusa(suggestDurationFor(db, campo, PEDIDO), "permission-denied", "Seu perfil não planeja OS.");
    await recusa(suggestDurationFor(db, cliente, PEDIDO), "permission-denied");
    await recusa(suggestDurationFor(db, interno, { ...PEDIDO, demanda: "10999" }), "not-found", "A demanda 10999 não existe.");
  });
});

describe("a resposta à sugestão", () => {
  it("grava o sugerido recalculado, a decisão e o escolhido, sem tocar na OS; repetir devolve a mesma; a chave com outra resposta recusa", async () => {
    const gravada = await answerSuggestionFor(db, interno, resposta(), AGORA);
    assert.equal(gravada.gravada, true);
    const doc = (await db.collection(AI_SUGGESTIONS_COLLECTION).doc(gravada.sugestao_id!).get()).data() ?? {};
    assert.deepEqual(
      [doc.tipo, doc.customer_code, doc.demanda, doc.os, doc.decisao, doc.minutos_escolhidos, doc.sugestao.minutos_total, doc.pedida_por, doc.valor_real],
      ["duracao_os", "ITAU", "10045", "10045-01", "aceitou", 120, 120, { uid: "interno-1", role: "interno" }, null],
    );
    assert.deepEqual((await db.doc("service_orders/10045-01").get()).data(), OS_PLANEJADA);

    assert.deepEqual(await answerSuggestionFor(db, interno, resposta(), AGORA), { sugestao_id: gravada.sugestao_id, gravada: true, replayed: true });
    await recusa(answerSuggestionFor(db, interno, resposta({ decisao: "mudou", minutos_escolhidos: 180 }), AGORA), "already-exists");
    assert.equal((await db.collection(AI_SUGGESTIONS_COLLECTION).get()).size, 1);
  });

  it("sem base em nenhum item, não houve sugestão e nada se grava; a OS de outra demanda e o campo recusam", async () => {
    const semBase = await answerSuggestionFor(db, interno, resposta({ idempotency_key: "resposta-0002", itens: [{ lpu_item_id: "lpu_cadeira", item: "Cadeira", quantidade: "40" }] }), AGORA);
    assert.deepEqual(semBase, { sugestao_id: null, gravada: false });
    await recusa(answerSuggestionFor(db, interno, resposta({ idempotency_key: "resposta-0003", os: "10045-02" }), AGORA), "failed-precondition", "A OS 10045-02 não é da demanda 10045.");
    await recusa(answerSuggestionFor(db, campo, resposta({ idempotency_key: "resposta-0004" }), AGORA), "permission-denied");
    assert.equal((await db.collection(AI_SUGGESTIONS_COLLECTION).get()).size, 0);
  });

  it("revisada a OS, a rotina grava o valor real e o erro contra o sugerido", async () => {
    const { sugestao_id } = await answerSuggestionFor(db, interno, resposta(), AGORA);
    await db.collection(AI_CURSORS_COLLECTION).doc(CURSOR_DAS_MEDIDAS).set({ created_at: Timestamp.fromDate(new Date("2026-10-23T12:00:00.000Z")), evento_id: "" });
    // A OS levou 150 minutos de trabalho: 25% a mais que os 120 sugeridos.
    await db.doc("service_orders/10045-01").update({
      status: "revisada",
      etapas: [
        { etapa: "chegada_origem", instante: "2026-10-24T12:00:00.000Z" },
        { etapa: "fim", instante: "2026-10-24T14:30:00.000Z" },
      ],
      revisao: { instante: "2026-10-24T18:00:00.000Z", pessoas: 2, linhas: [] },
    });
    await db.collection(EVENTS_COLLECTION).doc("evt_revisada").set({ id: "evt_revisada", type: "os.reviewed", source: "functions_operacao", customer_code: "ITAU", payload: { id: "10045-01" }, created_at: Timestamp.fromDate(new Date("2026-10-24T18:00:00.000Z")) });
    const rodada = await runMeasuresFor(db, { agora: () => new Date("2026-10-24T18:05:00.000Z") });
    assert.deepEqual([rodada.recalculou, rodada.reais], [true, 1]);
    const doc = (await db.collection(AI_SUGGESTIONS_COLLECTION).doc(sugestao_id!).get()).data() ?? {};
    assert.deepEqual([doc.valor_real, doc.erro_pct, doc.real_em], [150, 25, "2026-10-24T18:05:00.000Z"]);
  });
});
