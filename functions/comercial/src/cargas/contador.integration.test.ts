import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { main } from "./contador.js";

/**
 * O contador das demandas contra o emulador (parte 6.21): o dry-run lê e não
 * grava; --executar grava com o evento; o banco impede ficar abaixo da maior
 * demanda ou do que o contador já guarda; o mesmo valor não grava.
 */

const PROJECT_ID = "demo-dute-comercial";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let pasta: string;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-contador-test");
  db = getFirestore(app);
  pasta = mkdtempSync(join(tmpdir(), "contador-int-"));
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
});

after(async () => {
  await deleteApp(app);
  rmSync(pasta, { recursive: true, force: true });
});

const rodar = (...args: string[]) => main([...args, "--projeto", PROJECT_ID, "--relatorio-dir", pasta], { db, log: () => undefined });
const contador = async () => (await db.collection("demand_counters").doc("geral").get()).data();
const eventos = async () => (await db.collection("events").where("type", "==", "demand_counter.set").get()).docs.map((doc) => doc.data());

describe("contador das demandas no emulador", () => {
  it("dry-run com --projeto lê o banco e não grava", async () => {
    await db.collection("demands").doc("10045").set({ etapa: "em_montagem" });
    const resultado = await rodar("--ultimo", "10500");
    assert.equal(resultado.codigo, 0);
    assert.equal(resultado.conteudo?.acao, "gravar");
    assert.equal(resultado.conteudo?.maior_demanda, 10045);
    assert.equal(await contador(), undefined);
    assert.deepEqual(await eventos(), []);
  });

  it("--executar grava o último número e o evento, sem cliente e sem valor", async () => {
    const resultado = await rodar("--ultimo", "10500", "--executar");
    assert.equal(resultado.codigo, 0);
    assert.equal(resultado.conteudo?.acao, "gravar");
    const gravado = await contador();
    assert.equal(gravado?.ultimo, 10500);
    assert.equal(gravado?.ajustado_por, "carga-contador");
    const [evento] = await eventos();
    assert.equal(evento.customer_code, null);
    assert.deepEqual(evento.payload, { anterior: null, ultimo: 10500, maior_demanda: null });
    assert.equal(evento.description, "A próxima demanda é a 10501.");
  });

  it("recusa ficar abaixo da maior demanda e não grava", async () => {
    await db.collection("demands").doc("10600").set({ etapa: "em_montagem" });
    const resultado = await rodar("--ultimo", "10500", "--executar");
    assert.equal(resultado.codigo, 1);
    assert.match(resultado.conteudo?.problema ?? "", /A demanda 10600 já existe/);
    assert.equal(await contador(), undefined);
  });

  it("recusa andar para trás; o mesmo valor não grava de novo", async () => {
    await db.collection("demand_counters").doc("geral").set({ ultimo: 10700 });
    const atras = await rodar("--ultimo", "10650", "--executar");
    assert.equal(atras.codigo, 1);
    assert.match(atras.conteudo?.problema ?? "", /já está em 10700/);
    const igual = await rodar("--ultimo", "10700", "--executar");
    assert.equal(igual.codigo, 0);
    assert.equal(igual.conteudo?.acao, "sem_mudanca");
    assert.deepEqual(await eventos(), []);
  });
});
