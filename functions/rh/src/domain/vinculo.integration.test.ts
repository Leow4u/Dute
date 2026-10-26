import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "./banco.js";
import { getRhFichaFor, getRhPanelFor, saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";
import { saveRhVinculoFor } from "./vinculo-gravacao.js";

/**
 * As datas do vínculo no emulador (parte 8.4), com os dois bancos: o cadastro
 * da Operação no padrão, que não muda, e as datas, o recibo e o evento no
 * `dute-rh`, nunca no padrão. Só o rh grava, e só no vínculo próprio. A ficha
 * e o painel mostram as datas; o painel mantém quem está inativo na Operação
 * com o vínculo aberto (pergunta 70). Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-rh";
const AGORA = new Date("2026-10-26T15:00:00Z");
const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const CARLA = "col_cccccccccccccccc";
const DANI = "col_dddddddddddddddd";

const RH: RhProfile = { uid: "rh-1", role: "rh", email: "rh@dutelog.com.br", name: "Pessoa rh" };
const OWNER: RhProfile = { uid: "owner-1", role: "owner", name: "Pessoa owner" };
const ADMIN: RhProfile = { uid: "admin-1", role: "admin", name: "Pessoa admin" };

const CADASTRO_DA_ANA = { nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", cpf: "52998224725", ativo: true, edicao: 1 };

let app: ReturnType<typeof initializeApp>;
let padrao: Firestore;
let rh: Firestore;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rh-vinculo-test");
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
  batch.set(padrao.doc(`collaborators/${ANA}`), CADASTRO_DA_ANA);
  batch.set(padrao.doc(`collaborators/${BRUNO}`), { nome: "Bruno Lima", funcao: "Motorista", vinculo: "terceiro", ativo: true, edicao: 1 });
  batch.set(padrao.doc(`collaborators/${CARLA}`), { nome: "Carla Dias", funcao: "Ajudante", vinculo: "freelancer", ativo: true, edicao: 2 });
  // O cadastro sem vínculo é próprio, como na ficha.
  batch.set(padrao.doc(`collaborators/${DANI}`), { nome: "Daniela Reis", funcao: "Conferente", ativo: true, edicao: 1 });
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
function datas(extra: Record<string, unknown> = {}) {
  chave += 1;
  return { idempotency_key: `vinculo-${chave}`, colaborador_id: ANA, admissao: "2025-02-03", ...extra };
}

describe("as datas do vínculo no banco do RH", () => {
  it("o rh grava as datas no banco do RH, com o recibo e o evento; o cadastro da Operação não muda", async () => {
    const primeira = await saveRhVinculoFor(padrao, rh, RH, datas({ idempotency_key: "grava-1" }));
    assert.deepEqual(primeira, { colaborador_id: ANA, edicao: 1 });
    const gravado = (await rh.doc(`vinculos/${ANA}`).get()).data();
    assert.deepEqual([gravado?.colaborador_id, gravado?.admissao, gravado?.desligamento, gravado?.edicao], [ANA, "2025-02-03", null, 1]);
    assert.equal(gravado?.created_by.role, "rh");

    // O desligamento não inativa a pessoa na Operação (decisão de 26/10/2026).
    const desligada = await saveRhVinculoFor(padrao, rh, RH, datas({ desligamento: "2026-10-31", expected_edicao: 1 }));
    assert.deepEqual(desligada, { colaborador_id: ANA, edicao: 2 });
    assert.deepEqual((await padrao.doc(`collaborators/${ANA}`).get()).data(), CADASTRO_DA_ANA);

    const eventos = (await rh.collection("events").get()).docs.map((doc) => doc.data()).sort((a, b) => a.payload.edicao_depois - b.payload.edicao_depois);
    assert.deepEqual(eventos.map((evento) => [evento.type, evento.entity_type, evento.entity_id, evento.actor.role]), [
      ["rh.vinculo_saved", "rh_vinculo", ANA, "rh"],
      ["rh.vinculo_saved", "rh_vinculo", ANA, "rh"],
    ]);
    assert.deepEqual(eventos[1].payload, { id: ANA, admissao: "2025-02-03", desligamento: "2026-10-31", edicao_antes: 1, edicao_depois: 2 });
    assert.equal(JSON.stringify(eventos).includes("52998224725"), false);
    assert.equal((await rh.collection("rh_operations").get()).size, 2);
    for (const colecao of ["vinculos", "events", "rh_operations"]) assert.equal((await padrao.collection(colecao).get()).size, 0, colecao);
  });

  it("o mesmo pedido repete o resultado; a mesma chave com outro conteúdo recusa", async () => {
    await saveRhVinculoFor(padrao, rh, RH, datas({ idempotency_key: "repete-1" }));
    const repetido = await saveRhVinculoFor(padrao, rh, RH, datas({ idempotency_key: "repete-1" }));
    assert.deepEqual(repetido, { colaborador_id: ANA, edicao: 1, replayed: true });
    await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ idempotency_key: "repete-1", admissao: "2025-03-03" })), "already-exists", /outro conteúdo/);
    assert.equal((await rh.collection("events").get()).size, 1);
    assert.equal((await rh.doc(`vinculos/${ANA}`).get()).data()?.admissao, "2025-02-03");
  });

  it("a tela que leu sem datas, ou uma edição velha, recarrega; nada muda", async () => {
    await saveRhVinculoFor(padrao, rh, RH, datas());
    await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ admissao: "2025-04-01" })), "failed-precondition", /Recarregue e tente de novo/);
    await saveRhVinculoFor(padrao, rh, RH, datas({ desligamento: "2026-09-30", expected_edicao: 1 }));
    await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ expected_edicao: 1 })), "failed-precondition", /Recarregue e tente de novo/);
    const gravado = (await rh.doc(`vinculos/${ANA}`).get()).data();
    assert.deepEqual([gravado?.admissao, gravado?.desligamento, gravado?.edicao], ["2025-02-03", "2026-09-30", 2]);
    assert.equal((await rh.collection("events").get()).size, 2);
  });

  it("só o rh grava; só o vínculo próprio tem as datas; o desligamento não vem antes da admissão", async () => {
    for (const quem of [OWNER, ADMIN]) {
      await recusa(saveRhVinculoFor(padrao, rh, quem, datas()), "permission-denied", /^Só o RH grava no RH\.$/);
    }
    for (const colaborador_id of [BRUNO, CARLA]) {
      await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ colaborador_id })), "failed-precondition", /Só o vínculo próprio tem admissão e desligamento/);
    }
    await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ desligamento: "2025-02-02" })), "invalid-argument", /não pode ser antes da admissão/);
    await recusa(saveRhVinculoFor(padrao, rh, RH, datas({ colaborador_id: "col_eeeeeeeeeeeeeeee" })), "not-found", /Colaborador não encontrado/);
    assert.equal((await rh.collection("vinculos").get()).size, 0);
    assert.equal((await rh.collection("events").get()).size, 0);

    assert.deepEqual(await saveRhVinculoFor(padrao, rh, RH, datas({ colaborador_id: DANI })), { colaborador_id: DANI, edicao: 1 });
  });

  it("a ficha traz as datas com a edição, e o painel, as datas de cada próprio", async () => {
    const semDatas = await getRhFichaFor(padrao, rh, { colaborador_id: ANA }, AGORA);
    assert.equal(semDatas.datas_do_vinculo, null);
    await saveRhVinculoFor(padrao, rh, RH, datas());
    await saveRhVinculoFor(padrao, rh, RH, datas({ desligamento: "2026-11-30", expected_edicao: 1 }));

    const ficha = await getRhFichaFor(padrao, rh, { colaborador_id: ANA }, AGORA);
    assert.deepEqual(ficha.datas_do_vinculo, { admissao: "2025-02-03", desligamento: "2026-11-30", edicao: 2 });
    const doTerceiro = await getRhFichaFor(padrao, rh, { colaborador_id: BRUNO }, AGORA);
    assert.equal(doTerceiro.datas_do_vinculo, null);

    const painel = await getRhPanelFor(padrao, rh, AGORA);
    assert.deepEqual(
      painel.colaboradores.map((colaborador) => [colaborador.id, colaborador.admissao, colaborador.desligamento]),
      [[ANA, "2025-02-03", "2026-11-30"], [BRUNO, null, null], [CARLA, null, null], [DANI, null, null]],
    );
  });

  it("as datas gravadas antes num terceiro não aparecem: valem só no vínculo próprio", async () => {
    // O cadastro da Operação muda de vínculo depois de o RH gravar as datas.
    await saveRhVinculoFor(padrao, rh, RH, datas());
    await padrao.doc(`collaborators/${ANA}`).update({ vinculo: "terceiro" });
    assert.equal((await getRhFichaFor(padrao, rh, { colaborador_id: ANA }, AGORA)).datas_do_vinculo, null);
    const painel = await getRhPanelFor(padrao, rh, AGORA);
    assert.deepEqual(painel.colaboradores.find((colaborador) => colaborador.id === ANA)?.admissao, null);
  });

  it("quem a coordenação desativou com a admissão sem o desligamento segue no painel, inativo e sem vencimento, até o RH gravar o desligamento (pergunta 70)", async () => {
    const EVA = "col_eeeeeeeeeeeeeeee";
    const FABIO = "col_ffffffffffffffff";
    const GABI = "col_gggggggggggggggg";
    await padrao.doc(`collaborators/${EVA}`).set({ nome: "Eva Melo", funcao: "Ajudante", vinculo: "proprio", ativo: true, edicao: 1 });
    await padrao.doc(`collaborators/${FABIO}`).set({ nome: "Fábio Neves", funcao: "Montador", vinculo: "proprio", ativo: false, edicao: 1 });
    // O exame vencido da Ana conta enquanto ela está ativa.
    await saveRhRecordFor(padrao, rh, RH, { idempotency_key: "exame-ana", colaborador_id: ANA, categoria: "exame", tipo: "periodico", emitido_em: "2025-09-01", vence_em: "2026-09-01", resultado: "apto" }, AGORA);
    await saveRhVinculoFor(padrao, rh, RH, datas());
    await saveRhVinculoFor(padrao, rh, RH, datas({ colaborador_id: DANI, desligamento: "2026-10-20" }));
    await saveRhVinculoFor(padrao, rh, RH, datas({ colaborador_id: EVA }));
    // As datas sem o cadastro (a pessoa apagada da Operação) não entram.
    await rh.doc(`vinculos/${GABI}`).set({ colaborador_id: GABI, admissao: "2024-01-02", desligamento: null, edicao: 1 });
    assert.equal((await getRhPanelFor(padrao, rh, AGORA)).vencimentos.length, 1);

    // A coordenação desativa a Ana (vínculo aberto), a Daniela (já desligada) e a Eva, que passa a terceiro.
    await padrao.doc(`collaborators/${ANA}`).update({ ativo: false });
    await padrao.doc(`collaborators/${DANI}`).update({ ativo: false });
    await padrao.doc(`collaborators/${EVA}`).update({ ativo: false, vinculo: "terceiro" });
    const painel = await getRhPanelFor(padrao, rh, AGORA);
    assert.deepEqual(
      painel.colaboradores.map((colaborador) => [colaborador.id, colaborador.ativo]),
      [[ANA, false], [BRUNO, true], [CARLA, true]],
    );
    const ana = painel.colaboradores[0];
    assert.deepEqual(
      [ana.nome, ana.admissao, ana.desligamento, ana.registros, ana.vencidos, ana.vencendo],
      ["Ana Souza", "2025-02-03", null, 1, 0, 0],
    );
    assert.deepEqual(painel.vencimentos, []);

    // Com o desligamento, ela sai do painel.
    await saveRhVinculoFor(padrao, rh, RH, datas({ desligamento: "2026-10-24", expected_edicao: 1 }));
    assert.deepEqual((await getRhPanelFor(padrao, rh, AGORA)).colaboradores.map((colaborador) => colaborador.id), [BRUNO, CARLA]);
  });
});
