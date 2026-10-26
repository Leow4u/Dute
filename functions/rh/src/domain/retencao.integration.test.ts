import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "./banco.js";
import { downloadRhExportFor, exportRhMonthFor, listRhExportsFor } from "./exportacao-gravacao.js";
import type { RhProfile } from "./profile.js";
import { runRhRetentionFor } from "./retencao-gravacao.js";

/**
 * A retenção da exportação do RH no emulador (LGPD, decisão 7): a versão
 * substituída há mais de 30 dias perde as linhas e fica com o hash e as
 * contagens; a última fica inteira; a lista continua mostrando as duas; o
 * download da limpa é recusado com o motivo; o evento não leva nome nem CPF;
 * rodar de novo não apaga nem grava mais nada. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-rh";
const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const PRIMEIRA = new Date("2026-10-24T15:00:00.000Z");
const SEGUNDA = new Date("2026-10-25T15:00:00.000Z");
const DIA = 86_400_000;

const RH: RhProfile = { uid: "rh-1", role: "rh", email: "rh@dutelog.com.br", name: "Pessoa rh" };

let app: ReturnType<typeof initializeApp>;
let padrao: Firestore;
let rh: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rh-retencao-test");
  padrao = getFirestore(app);
  rh = getFirestore(app, RH_DATABASE);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  for (const banco of ["(default)", RH_DATABASE]) {
    await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/${banco}/documents`, { method: "DELETE" });
  }
  await padrao.doc(`collaborators/${ANA}`).set({ nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", cpf: "52998224725", ativo: true, edicao: 1 });
});

/** Duas versões de outubro: a v1 em 24/10, só com a Ana, e a v2, com o Bruno, em 25/10. */
async function duasVersoes() {
  await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, PRIMEIRA);
  await padrao.doc(`collaborators/${BRUNO}`).set({ nome: "Bruno Lima", funcao: "Motorista", vinculo: "proprio", cpf: "11144477735", ativo: true, edicao: 1 });
  const segunda = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-2", competencia: "2026-10" }, SEGUNDA);
  assert.deepEqual([segunda.id, segunda.nova], ["exp_2026-10_v2", true]);
}

async function versao(id: string) {
  return (await rh.collection("exportacoes").doc(id).get()).data()!;
}

async function eventosDaRetencao() {
  return (await rh.collection("events").where("type", "==", "rh.export_lines_removed").get()).docs.map((doc) => doc.data());
}

describe("a retenção da exportação do RH", () => {
  it("antes dos 30 dias, nada muda", async () => {
    await duasVersoes();
    const resultado = await runRhRetentionFor(rh, new Date(SEGUNDA.getTime() + 29 * DIA));
    assert.deepEqual([resultado.substituidas, resultado.limpas], [0, 0]);
    assert.equal((await versao("exp_2026-10_v1")).colaboradores.length, 1);
  });

  it("a substituída há mais de 30 dias perde as linhas e fica com o hash e as contagens; a última fica inteira", async () => {
    await duasVersoes();
    const antes = await versao("exp_2026-10_v1");
    const agora = new Date(SEGUNDA.getTime() + 31 * DIA);

    const resultado = await runRhRetentionFor(rh, agora);

    assert.deepEqual(resultado, { dia: "2026-11-25", substituidas: 1, limpas: 1, falhas: 0 });
    const limpa = await versao("exp_2026-10_v1");
    assert.deepEqual(["exames" in limpa, "colaboradores" in limpa], [false, false]);
    assert.deepEqual([limpa.hash, limpa.totais, limpa.gerada_em, limpa.linhas_apagadas_em], [antes.hash, antes.totais, antes.gerada_em, agora.toISOString()]);
    assert.equal(JSON.stringify(limpa).includes("52998224725"), false);
    const ultima = await versao("exp_2026-10_v2");
    assert.deepEqual(ultima.colaboradores.map((linha: { cpf: string }) => linha.cpf).sort(), ["11144477735", "52998224725"]);
    assert.equal("linhas_apagadas_em" in ultima, false);

    const [evento, ...outros] = await eventosDaRetencao();
    assert.equal(outros.length, 0);
    assert.deepEqual([evento!.entity_id, evento!.actor.role, evento!.payload], ["exp_2026-10_v1", "sistema", { id: "exp_2026-10_v1", competencia: "2026-10", versao: 1, substituida_por: 2 }]);
    assert.equal(/52998224725|Ana Souza/.test(JSON.stringify(evento)), false);

    // A lista continua com as duas, com as contagens.
    const lista = await listRhExportsFor(rh);
    assert.deepEqual(lista.exportacoes.map((linha) => [linha.id, linha.colaboradores]), [["exp_2026-10_v2", 2], ["exp_2026-10_v1", 1]]);
  });

  it("o download da versão limpa é recusado com o motivo; o da última, não", async () => {
    await duasVersoes();
    await runRhRetentionFor(rh, new Date(SEGUNDA.getTime() + 31 * DIA));

    await assert.rejects(downloadRhExportFor(rh, RH, { id: "exp_2026-10_v1", arquivo: "colaboradores" }), (error: unknown) => {
      assert.ok(error instanceof HttpsError, String(error));
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /Baixe a versão mais nova da competência/);
      return true;
    });
    const arquivo = await downloadRhExportFor(rh, RH, { id: "exp_2026-10_v2", arquivo: "colaboradores" });
    assert.ok(arquivo);
  });

  it("rodar de novo não apaga mais nada nem grava outro evento", async () => {
    await duasVersoes();
    await runRhRetentionFor(rh, new Date(SEGUNDA.getTime() + 31 * DIA));
    const segunda = await runRhRetentionFor(rh, new Date(SEGUNDA.getTime() + 32 * DIA));
    assert.deepEqual([segunda.substituidas, segunda.limpas, segunda.falhas], [0, 0, 0]);
    assert.equal((await eventosDaRetencao()).length, 1);
  });
});
