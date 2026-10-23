import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";

import { armazemDoBucket, attachRhFileFor, openRhFileFor, requestRhUploadFor, type ArmazemDoRh } from "./arquivos-gravacao.js";
import { RH_DATABASE } from "./banco.js";
import { archiveRhRecordFor, getRhFichaFor, saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";

/**
 * Os arquivos da ficha no emulador (parte 8.2b): o rh pede a URL, sobe o
 * arquivo e o liga ao registro; o bucket confere o arquivo de verdade. Owner,
 * admin e rh abrem, e cada abertura fica registrada no banco `rh`. A URL
 * assinada vem de um armazém de mentira: o emulador não assina.
 */

const PROJECT_ID = "demo-dute-rh";
const BUCKET = "demo-dute-rh.appspot.com";
const ANA = "col_aaaaaaaaaaaaaaaa";
const AGORA = new Date("2026-10-23T15:00:00Z");
const PDF = Buffer.from("%PDF-1.4\n%rh\n");

const RH: RhProfile = { uid: "rh-1", role: "rh", name: "Pessoa rh" };
const OWNER: RhProfile = { uid: "owner-1", role: "owner", name: "Pessoa owner" };
const ADMIN: RhProfile = { uid: "admin-1", role: "admin", name: "Pessoa admin" };

let app: ReturnType<typeof initializeApp>;
let padrao: Firestore;
let rh: Firestore;
let armazem: ArmazemDoRh;
let assinadas: string[];

before(() => {
  app = initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET }, "rh-arquivos-test");
  padrao = getFirestore(app);
  rh = getFirestore(app, RH_DATABASE);
  const doBucket = armazemDoBucket(getStorage(app).bucket());
  armazem = {
    conferir: doBucket.conferir,
    async urlParaSubir(caminho, contentType) {
      assinadas.push(`subir ${contentType} ${caminho}`);
      return `https://assinada.test/subir/${caminho}`;
    },
    async urlParaAbrir(caminho) {
      assinadas.push(`abrir ${caminho}`);
      return `https://assinada.test/abrir/${caminho}`;
    },
  };
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  assinadas = [];
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  for (const banco of ["(default)", RH_DATABASE]) {
    await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/${banco}/documents`, { method: "DELETE" });
  }
  await padrao.doc(`collaborators/${ANA}`).set({ nome: "Ana Souza", funcao: "Montadora", ativo: true, edicao: 1 });
});

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: RegExp) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.match(error.message, mensagem);
    return true;
  });
}

let chave = 0;
async function exame() {
  chave += 1;
  return saveRhRecordFor(padrao, rh, RH, { idempotency_key: `e-${chave}`, colaborador_id: ANA, categoria: "exame", tipo: "periodico", emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto" }, AGORA);
}

/** Pede a URL, sobe no caminho dela (como o navegador faria pela URL) e devolve o que o anexo pede. */
async function subir(registroId: string, conteudo: Buffer = PDF, contentType = "application/pdf") {
  const envio = await requestRhUploadFor(rh, RH, { registro_id: registroId, content_type: contentType, tamanho: conteudo.length }, armazem, AGORA);
  const caminho = envio.upload_url.replace("https://assinada.test/subir/", "");
  await getStorage(app).bucket().file(caminho).save(conteudo, { contentType });
  return { envio, caminho };
}

async function eventos(tipo: string) {
  const snapshot = await rh.collection("events").where("type", "==", tipo).get();
  return snapshot.docs.map((doc) => doc.data());
}

describe("os arquivos da ficha", () => {
  it("o rh pede a URL no caminho do registro, sobe e anexa; o bucket confere; nada vai ao banco padrão", async () => {
    const registro = await exame();
    const { envio, caminho } = await subir(registro.id);
    assert.match(envio.arquivo_id, /^arq_[a-f0-9]{16}$/);
    assert.equal(caminho, `rh/${ANA}/${registro.id}/${envio.arquivo_id}.pdf`);
    assert.deepEqual(envio.upload_headers, { "content-type": "application/pdf" });
    assert.equal(envio.expira_em, "2026-10-23T15:10:00.000Z");
    assert.equal((await rh.collection("rh_operations").get()).size, 1, "pedir a URL não grava");

    const anexo = { idempotency_key: "anexa-1", registro_id: registro.id, arquivo_id: envio.arquivo_id, content_type: "application/pdf", expected_edicao: 1 };
    const anexado = await attachRhFileFor(rh, RH, anexo, armazem);
    assert.deepEqual(anexado, { id: registro.id, edicao: 2, arquivo_id: envio.arquivo_id });
    assert.deepEqual((await attachRhFileFor(rh, RH, anexo, armazem)).replayed, true);
    const gravado = (await rh.doc(`registros/${registro.id}`).get()).data();
    assert.deepEqual(gravado?.arquivo, { id: envio.arquivo_id, caminho, content_type: "application/pdf", tamanho: PDF.length });
    const [evento] = await eventos("rh.file_attached");
    assert.deepEqual(evento.payload, { id: registro.id, colaborador_id: ANA, categoria: "exame", tipo: "periodico", substituiu: false });
    assert.equal(JSON.stringify(evento).includes(envio.arquivo_id), false);

    const ficha = await getRhFichaFor(padrao, rh, { colaborador_id: ANA }, AGORA);
    assert.deepEqual(ficha.registros[0].arquivo, { id: envio.arquivo_id, content_type: "application/pdf", tamanho: PDF.length });
    for (const colecao of ["registros", "events", "rh_operations"]) assert.equal((await padrao.collection(colecao).get()).size, 0, colecao);
  });

  it("sem o arquivo no bucket, com outro tipo ou com a edição velha, o anexo recusa", async () => {
    const registro = await exame();
    const envio = await requestRhUploadFor(rh, RH, { registro_id: registro.id, content_type: "application/pdf", tamanho: 100 }, armazem, AGORA);
    const anexo = { idempotency_key: "a-1", registro_id: registro.id, arquivo_id: envio.arquivo_id, content_type: "application/pdf", expected_edicao: 1 };
    await recusa(attachRhFileFor(rh, RH, anexo, armazem), "failed-precondition", /não chegou/);

    const { envio: outro, caminho } = await subir(registro.id);
    await getStorage(app).bucket().file(caminho).save(Buffer.from("<html>"), { contentType: "text/html" });
    await recusa(attachRhFileFor(rh, RH, { ...anexo, idempotency_key: "a-2", arquivo_id: outro.arquivo_id }, armazem), "failed-precondition", /não é do tipo informado/);

    const { envio: certo } = await subir(registro.id);
    await recusa(attachRhFileFor(rh, RH, { ...anexo, idempotency_key: "a-3", arquivo_id: certo.arquivo_id, expected_edicao: 2 }, armazem), "failed-precondition", /foi atualizado/);
    assert.equal((await rh.doc(`registros/${registro.id}`).get()).data()?.arquivo, null);
  });

  it("trocar o arquivo guarda o anterior; owner e admin não sobem nem anexam", async () => {
    const registro = await exame();
    const primeiro = await subir(registro.id);
    await attachRhFileFor(rh, RH, { idempotency_key: "t-1", registro_id: registro.id, arquivo_id: primeiro.envio.arquivo_id, content_type: "application/pdf", expected_edicao: 1 }, armazem);
    const segundo = await subir(registro.id, Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
    await attachRhFileFor(rh, RH, { idempotency_key: "t-2", registro_id: registro.id, arquivo_id: segundo.envio.arquivo_id, content_type: "image/jpeg", expected_edicao: 2 }, armazem);
    const gravado = (await rh.doc(`registros/${registro.id}`).get()).data();
    assert.equal(gravado?.arquivo.id, segundo.envio.arquivo_id);
    assert.deepEqual(gravado?.arquivos_anteriores.map((arquivo: { id: string }) => arquivo.id), [primeiro.envio.arquivo_id]);
    assert.deepEqual((await eventos("rh.file_attached")).map((evento) => evento.payload.substituiu).sort(), [false, true]);

    for (const quem of [OWNER, ADMIN]) {
      await recusa(requestRhUploadFor(rh, quem, { registro_id: registro.id, content_type: "application/pdf", tamanho: 10 }, armazem, AGORA), "permission-denied", /^Só o RH grava no RH\.$/);
      await recusa(attachRhFileFor(rh, quem, { idempotency_key: "x", registro_id: registro.id, arquivo_id: segundo.envio.arquivo_id, content_type: "image/jpeg", expected_edicao: 3 }, armazem), "permission-denied", /^Só o RH grava no RH\.$/);
    }
  });

  it("owner, admin e rh abrem, e cada abertura fica registrada; o arquivado ainda abre, mas não recebe arquivo", async () => {
    const registro = await exame();
    const { envio, caminho } = await subir(registro.id);
    await recusa(openRhFileFor(rh, RH, { registro_id: registro.id }, armazem, AGORA), "not-found", /não tem arquivo/);
    await attachRhFileFor(rh, RH, { idempotency_key: "o-1", registro_id: registro.id, arquivo_id: envio.arquivo_id, content_type: "application/pdf", expected_edicao: 1 }, armazem);

    for (const quem of [OWNER, ADMIN, RH]) {
      const aberto = await openRhFileFor(rh, quem, { registro_id: registro.id }, armazem, AGORA);
      assert.deepEqual(aberto, { url: `https://assinada.test/abrir/${caminho}`, content_type: "application/pdf", expira_em: "2026-10-23T15:05:00.000Z" });
    }
    assert.deepEqual((await eventos("rh.file_opened")).map((evento) => evento.actor.role).sort(), ["admin", "owner", "rh"]);

    await archiveRhRecordFor(rh, RH, { idempotency_key: "o-2", id: registro.id, expected_edicao: 2 });
    assert.equal((await openRhFileFor(rh, OWNER, { registro_id: registro.id }, armazem, AGORA)).content_type, "application/pdf");
    await recusa(requestRhUploadFor(rh, RH, { registro_id: registro.id, content_type: "application/pdf", tamanho: 10 }, armazem, AGORA), "failed-precondition", /está arquivado/);
  });
});
