import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "./banco.js";
import { downloadRhExportFor, exportRhMonthFor, listRhExportsFor } from "./exportacao-gravacao.js";
import { saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";

/**
 * A exportação para a contabilidade no emulador (parte 8.3), com os dois
 * bancos: o cadastro no padrão, a versão, o recibo e o evento no `rh`, nunca
 * no padrão. A mesma competência sem mudança devolve a mesma versão, sem
 * evento novo; com mudança, nasce a seguinte. Só o rh gera; owner, admin e rh
 * baixam, e cada download fica registrado. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-rh";
const AGORA = new Date("2026-10-24T15:00:00Z");
const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const CARLA = "col_cccccccccccccccc";

const RH: RhProfile = { uid: "rh-1", role: "rh", email: "rh@dutelog.com.br", name: "Pessoa rh" };
const OWNER: RhProfile = { uid: "owner-1", role: "owner", name: "Pessoa owner" };
const ADMIN: RhProfile = { uid: "admin-1", role: "admin", name: "Pessoa admin" };

let app: ReturnType<typeof initializeApp>;
let padrao: Firestore;
let rh: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rh-exportacao-test");
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
  const batch = padrao.batch();
  batch.set(padrao.doc(`collaborators/${ANA}`), { nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", cpf: "52998224725", ativo: true, edicao: 1 });
  batch.set(padrao.doc(`collaborators/${BRUNO}`), { nome: "Bruno Lima", funcao: "Motorista", vinculo: "terceiro", cpf: "11144477735", ativo: true, edicao: 1 });
  batch.set(padrao.doc(`collaborators/${CARLA}`), { nome: "Carla Dias", funcao: "Ajudante", vinculo: "proprio", cpf: "39053344705", ativo: false, edicao: 2 });
  await batch.commit();
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
async function exame(colaborador: string, tipo: string, emitido_em: string, resultado = "apto") {
  chave += 1;
  return saveRhRecordFor(
    padrao,
    rh,
    RH,
    { idempotency_key: `exame-${chave}`, colaborador_id: colaborador, categoria: "exame", tipo, emitido_em, vence_em: null, resultado },
    AGORA,
  );
}

async function eventosDaExportacao(banco: Firestore) {
  const snapshot = await banco.collection("events").get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((evento) => String(evento.type).startsWith("rh.export_"))
    .map((evento) => [evento.type, evento.entity_id, evento.actor?.role])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])));
}

describe("a exportação no banco do RH", () => {
  it("a primeira gera a versão 1 com o evento; o mesmo pedido repete o resultado; sem mudança, a mesma versão", async () => {
    await exame(ANA, "periodico", "2026-10-05");
    await exame(CARLA, "demissional", "2026-10-02");
    await exame(BRUNO, "periodico", "2026-10-06");
    await exame(ANA, "admissional", "2025-10-01");

    const primeira = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    assert.deepEqual(primeira, { id: "exp_2026-10_v1", versao: 1, nova: true });
    const repetida = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    assert.deepEqual(repetida, { id: "exp_2026-10_v1", versao: 1, nova: true, replayed: true });
    const igual = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-2", competencia: "2026-10" }, AGORA);
    assert.deepEqual(igual, { id: "exp_2026-10_v1", versao: 1, nova: false });

    const gravada = (await rh.doc("exportacoes/exp_2026-10_v1").get()).data() ?? {};
    // O terceiro (Bruno) não entra; a Carla, inativa, entra pelo demissional do mês.
    assert.deepEqual(gravada.totais, { exames: 2, colaboradores: 2 });
    assert.deepEqual((gravada.exames as { nome: string }[]).map((linha) => linha.nome), ["Carla Dias", "Ana Souza"]);
    assert.deepEqual(await eventosDaExportacao(rh), [["rh.export_created", "exp_2026-10_v1", "rh"]]);
    assert.equal((await padrao.collection("events").get()).size, 0);
    assert.equal((await padrao.collection("exportacoes").get()).size, 0);
  });

  it("com um exame novo no mês, nasce a versão 2, e a 1 continua", async () => {
    await exame(ANA, "periodico", "2026-10-05");
    await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    await exame(CARLA, "demissional", "2026-10-20", "inapto");
    const segunda = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-2", competencia: "2026-10" }, AGORA);
    assert.deepEqual(segunda, { id: "exp_2026-10_v2", versao: 2, nova: true });
    const lista = await listRhExportsFor(rh);
    assert.deepEqual(
      lista.exportacoes.map((item) => [item.id, item.versao, item.exames, item.colaboradores]).sort(),
      [["exp_2026-10_v1", 1, 1, 1], ["exp_2026-10_v2", 2, 2, 2]],
    );
    assert.equal(lista.exportacoes[0].gerada_por, "Pessoa rh");
    assert.equal((await rh.collection("exportacoes").get()).size, 2);
  });

  it("só o rh gera; o mês que não começou recusa", async () => {
    for (const quem of [OWNER, ADMIN]) {
      await recusa(exportRhMonthFor(padrao, rh, quem, { idempotency_key: "x", competencia: "2026-10" }, AGORA), "permission-denied", /Só o RH grava/);
    }
    await recusa(exportRhMonthFor(padrao, rh, RH, { idempotency_key: "x", competencia: "2026-11" }, AGORA), "invalid-argument", /ainda não começou/);
    assert.equal((await rh.collection("exportacoes").get()).size, 0);
  });

  it("owner, admin e rh baixam a planilha da versão guardada, e cada download fica registrado", async () => {
    await exame(ANA, "periodico", "2026-10-05");
    await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    // A planilha é a da versão guardada, mesmo que a ficha mude depois.
    await exame(ANA, "retorno_ao_trabalho", "2026-10-15");
    const arquivo = await downloadRhExportFor(rh, OWNER, { id: "exp_2026-10_v1", arquivo: "exames" }, AGORA);
    assert.equal(arquivo.nome, "dute-rh-exames-2026-10-v1.csv");
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n").slice(1), ["Ana Souza;529.982.247-25;Montadora;Periódico;1;05/10/2026;Apto;1;", ""]);
    await downloadRhExportFor(rh, ADMIN, { id: "exp_2026-10_v1", arquivo: "colaboradores" }, AGORA);
    await downloadRhExportFor(rh, RH, { id: "exp_2026-10_v1", arquivo: "exames" }, AGORA);
    assert.deepEqual(await eventosDaExportacao(rh), [
      ["rh.export_created", "exp_2026-10_v1", "rh"],
      ["rh.export_downloaded", "exp_2026-10_v1", "admin"],
      ["rh.export_downloaded", "exp_2026-10_v1", "owner"],
      ["rh.export_downloaded", "exp_2026-10_v1", "rh"],
    ]);
    await recusa(downloadRhExportFor(rh, RH, { id: "exp_2026-09_v1", arquivo: "exames" }, AGORA), "not-found", /não encontrada/);
  });
});
