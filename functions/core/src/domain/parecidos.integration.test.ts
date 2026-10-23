import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { AI_CASE_MEMORY_COLLECTION, vetorDosItens } from "./lembrancas.js";
import { findSimilarQuotesFor } from "./parecidos-gravacao.js";
import type { CoreProfile } from "./profile.js";

/**
 * Os orçamentos parecidos no emulador (parte 5.3b): o cliente vem da
 * demanda, nunca do pedido; o caso de outro cliente nunca aparece, nem o
 * idêntico; só quem orça pede; nada grava. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";

const comercial: CoreProfile = { uid: "com-1", role: "comercial" };
const interno: CoreProfile = { uid: "int-1", role: "interno" };
const cliente: CoreProfile = { uid: "cli-1", role: "cliente" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-parecidos-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function lembranca(demanda: string, customer: string, mesas: number, fechada: string) {
  return {
    demanda,
    customer_code: customer,
    titulo: `Mudança ${demanda}`,
    itens: [{ lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", orcado: String(mesas), realizado: String(mesas) }],
    vetor: vetorDosItens([{ lpuItemId: "lpu_mesa", milesimos: mesas * 1000 }]),
    orcado_cents: mesas * 10000,
    realizado_cents: mesas * 10000,
    executado_de: "2026-10-15",
    executado_ate: "2026-10-16",
    os: [`${demanda}-01`],
    minutos_de_trabalho: 120,
    resumo: `Demanda ${demanda}`,
    fechada_em: fechada,
  };
}

async function tudo() {
  const colecoes = await db.listCollections();
  const docs = await Promise.all(colecoes.map(async (colecao) => (await colecao.get()).docs.map((doc) => [doc.ref.path, doc.data()])));
  return Object.fromEntries(docs.flat());
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.doc("demands/10050"), { numero: "10050", customer_code: "ITAU", etapa: "em_montagem" });
  batch.set(db.doc("demands/20050"), { numero: "20050", customer_code: "SAFRA", etapa: "em_montagem" });
  batch.set(db.doc(`${AI_CASE_MEMORY_COLLECTION}/10045`), lembranca("10045", "ITAU", 14, "2026-10-20T00:00:00.000Z"));
  batch.set(db.doc(`${AI_CASE_MEMORY_COLLECTION}/10046`), lembranca("10046", "ITAU", 30, "2026-10-21T00:00:00.000Z"));
  // O do Safra é idêntico ao pedido do Itaú e nunca aparece para ele.
  batch.set(db.doc(`${AI_CASE_MEMORY_COLLECTION}/20001`), lembranca("20001", "SAFRA", 12, "2026-10-22T00:00:00.000Z"));
  await batch.commit();
});

const PEDIDO = { demanda: "10050", itens: [{ lpu_item_id: "lpu_mesa", quantidade: "12" }] };

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem?: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (mensagem) assert.equal(error.message, mensagem);
    return true;
  });
}

describe("os orçamentos parecidos", () => {
  it("só os do cliente da demanda, com o orçado e o realizado; o idêntico do outro cliente nunca; nada grava", async () => {
    const antes = await tudo();
    const resultado = await findSimilarQuotesFor(db, comercial, PEDIDO);
    assert.deepEqual(
      resultado.casos.map((caso) => [caso.demanda, caso.semelhanca_pct, caso.orcado_cents, caso.os]),
      // 12 mesas contra 14 dão 95%; contra 30, 75%.
      [
        ["10045", 95, 140000, 1],
        ["10046", 75, 300000, 1],
      ],
    );
    assert.equal(resultado.lembrancas, 2);
    assert.deepEqual(await tudo(), antes);

    // Pela demanda do Safra, só o do Safra.
    assert.deepEqual((await findSimilarQuotesFor(db, comercial, { ...PEDIDO, demanda: "20050" })).casos.map((caso) => caso.demanda), ["20001"]);
  });

  it("só quem orça pede; a demanda que não existe recusa", async () => {
    await recusa(findSimilarQuotesFor(db, interno, PEDIDO), "permission-denied", "Seu perfil não orça.");
    await recusa(findSimilarQuotesFor(db, cliente, PEDIDO), "permission-denied");
    await recusa(findSimilarQuotesFor(db, comercial, { ...PEDIDO, demanda: "10999" }), "not-found", "A demanda 10999 não existe.");
  });
});
