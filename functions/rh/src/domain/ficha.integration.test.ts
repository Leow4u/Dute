import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "./banco.js";
import { archiveRhRecordFor, getRhFichaFor, getRhPanelFor, saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";

/**
 * A ficha do colaborador no emulador (parte 8.2a), com os dois bancos: o
 * cadastro no banco padrão e o registro, o recibo e o evento no banco
 * `dute-rh`, nunca no padrão. Owner e admin leem; só o rh grava. O mais
 * recente de cada tipo é o vigente, e arquivar devolve o anterior.
 */

const PROJECT_ID = "demo-dute-rh";
const AGORA = new Date("2026-10-23T15:00:00Z");
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
  app = initializeApp({ projectId: PROJECT_ID }, "rh-ficha-test");
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
  batch.set(padrao.doc(`collaborators/${BRUNO}`), { nome: "Bruno Lima", funcao: "Motorista", vinculo: "terceiro", ativo: true, edicao: 1 });
  batch.set(padrao.doc(`collaborators/${CARLA}`), { nome: "Carla Dias", funcao: "Ajudante", vinculo: "freelancer", ativo: false, edicao: 2 });
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
function exame(extra: Record<string, unknown> = {}) {
  chave += 1;
  return { idempotency_key: `k-${chave}`, colaborador_id: ANA, categoria: "exame", tipo: "periodico", emitido_em: "2025-11-01", vence_em: "2026-11-01", resultado: "apto", ...extra };
}

async function eventos(banco: Firestore) {
  const snapshot = await banco.collection("events").get();
  return snapshot.docs.map((doc) => doc.data()).sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.entity_id).localeCompare(String(b.entity_id)));
}

describe("a ficha no banco do RH", () => {
  it("o rh inclui o registro no banco do RH, com o recibo e o evento, e nada no banco padrão", async () => {
    const salvo = await saveRhRecordFor(padrao, rh, RH, exame({ idempotency_key: "inclui-1" }), AGORA);
    assert.match(salvo.id, /^reg_[a-f0-9]{16}$/);
    assert.deepEqual([salvo.edicao, salvo.situacao], [1, "vigente"]);

    const gravado = (await rh.doc(`registros/${salvo.id}`).get()).data();
    assert.equal(gravado?.resultado, "apto");
    assert.equal(gravado?.colaborador_id, ANA);
    assert.equal(gravado?.created_by.role, "rh");
    assert.equal((await rh.collection("rh_operations").get()).size, 1);
    const [evento] = await eventos(rh);
    assert.equal(evento.type, "rh.record_created");
    assert.deepEqual(evento.payload, { id: salvo.id, colaborador_id: ANA, categoria: "exame", tipo: "periodico", emitido_em: "2025-11-01", vence_em: "2026-11-01", situacao: "vigente" });
    assert.equal(JSON.stringify(evento).includes("apto"), false);

    for (const colecao of ["registros", "events", "rh_operations"]) assert.equal((await padrao.collection(colecao).get()).size, 0, colecao);

    const repetido = await saveRhRecordFor(padrao, rh, RH, exame({ idempotency_key: "inclui-1" }), AGORA);
    assert.deepEqual(repetido, { id: salvo.id, edicao: 1, situacao: "vigente", replayed: true });
    await recusa(saveRhRecordFor(padrao, rh, RH, exame({ idempotency_key: "inclui-1", vence_em: "2026-12-01" }), AGORA), "already-exists", /outro conteúdo/);
    assert.equal((await rh.collection("registros").get()).size, 1);
  });

  it("owner e admin leem a ficha e o painel, e só o rh grava", async () => {
    const salvo = await saveRhRecordFor(padrao, rh, RH, exame(), AGORA);
    for (const quem of [OWNER, ADMIN]) {
      await recusa(saveRhRecordFor(padrao, rh, quem, exame(), AGORA), "permission-denied", /^Só o RH grava no RH\.$/);
      await recusa(archiveRhRecordFor(rh, quem, { idempotency_key: "a", id: salvo.id, expected_edicao: 1 }), "permission-denied", /^Só o RH grava no RH\.$/);
    }
    const ficha = await getRhFichaFor(padrao, rh, { colaborador_id: ANA }, AGORA);
    assert.deepEqual(ficha.registros.map((registro) => [registro.id, registro.resultado]), [[salvo.id, "apto"]]);
    assert.deepEqual(ficha.colaborador, { id: ANA, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true });
    assert.equal(JSON.stringify(ficha).includes("52998224725"), false);
    assert.equal((await rh.collection("registros").get()).size, 1);
  });

  it("o exame novo substitui o anterior; o antigo lançado depois nasce substituído; arquivar o vigente devolve o anterior", async () => {
    const antigo = await saveRhRecordFor(padrao, rh, RH, exame({ emitido_em: "2024-11-01", vence_em: "2025-11-01" }), AGORA);
    const novo = await saveRhRecordFor(padrao, rh, RH, exame(), AGORA);
    assert.equal(novo.situacao, "vigente");
    const substituido = (await rh.doc(`registros/${antigo.id}`).get()).data();
    assert.deepEqual([substituido?.situacao, substituido?.substituido_por], ["substituido", novo.id]);

    const lancadoDepois = await saveRhRecordFor(padrao, rh, RH, exame({ emitido_em: "2023-11-01", vence_em: "2024-11-01" }), AGORA);
    assert.equal(lancadoDepois.situacao, "substituido");
    assert.equal((await rh.doc(`registros/${novo.id}`).get()).data()?.situacao, "vigente");

    const arquivado = await archiveRhRecordFor(rh, RH, { idempotency_key: "arquiva-1", id: novo.id, expected_edicao: 1 });
    assert.deepEqual([arquivado.situacao, arquivado.edicao], ["arquivado", 2]);
    const devolvido = (await rh.doc(`registros/${antigo.id}`).get()).data();
    assert.deepEqual([devolvido?.situacao, devolvido?.substituido_por], ["vigente", null]);
    assert.equal((await rh.doc(`registros/${lancadoDepois.id}`).get()).data()?.substituido_por, antigo.id);

    const mudancas = (await eventos(rh)).filter((evento) => evento.type === "rh.record_status_changed").map((evento) => [evento.entity_id, evento.payload.antes, evento.payload.depois]);
    assert.deepEqual(mudancas.sort(), [
      [antigo.id, "substituido", "vigente"],
      [antigo.id, "vigente", "substituido"],
    ].sort());
    assert.equal((await eventos(rh)).filter((evento) => evento.type === "rh.record_archived").length, 1);
    await recusa(archiveRhRecordFor(rh, RH, { idempotency_key: "arquiva-2", id: novo.id, expected_edicao: 2 }), "failed-precondition", /já está arquivado/);
  });

  it("o exame lançado de novo com as mesmas datas vale no lugar do anterior", async () => {
    const primeiro = await saveRhRecordFor(padrao, rh, RH, exame(), new Date("2026-10-23T15:00:00Z"));
    const corrigido = await saveRhRecordFor(padrao, rh, RH, exame(), new Date("2026-10-23T15:05:00Z"));
    assert.equal(corrigido.situacao, "vigente");
    const anterior = (await rh.doc(`registros/${primeiro.id}`).get()).data();
    assert.deepEqual([anterior?.situacao, anterior?.substituido_por], ["substituido", corrigido.id]);
  });

  it("alterar a data pode trocar o vigente; a edição velha e o colaborador errado recusam", async () => {
    const primeiro = await saveRhRecordFor(padrao, rh, RH, exame({ emitido_em: "2024-11-01", vence_em: "2025-11-01" }), AGORA);
    const segundo = await saveRhRecordFor(padrao, rh, RH, exame(), AGORA);
    const alterado = await saveRhRecordFor(padrao, rh, RH, exame({ id: primeiro.id, expected_edicao: 1, emitido_em: "2026-01-10", vence_em: "2027-01-10" }), AGORA);
    assert.deepEqual([alterado.situacao, alterado.edicao], ["vigente", 2]);
    assert.deepEqual((await rh.doc(`registros/${segundo.id}`).get()).data()?.substituido_por, primeiro.id);
    const atualizado = (await eventos(rh)).find((evento) => evento.type === "rh.record_updated");
    assert.deepEqual([atualizado?.payload.edicao_antes, atualizado?.payload.edicao_depois], [1, 2]);

    await recusa(saveRhRecordFor(padrao, rh, RH, exame({ id: primeiro.id, expected_edicao: 1 }), AGORA), "failed-precondition", /foi atualizado/);
    await recusa(saveRhRecordFor(padrao, rh, RH, exame({ id: primeiro.id, expected_edicao: 2, colaborador_id: BRUNO }), AGORA), "not-found", /Registro não encontrado/);
    await recusa(saveRhRecordFor(padrao, rh, RH, exame({ colaborador_id: "col_dddddddddddddddd" }), AGORA), "not-found", /Colaborador não encontrado/);
  });
});

describe("o painel do RH", () => {
  it("quem está ativo, por nome, com a ficha resumida e os vencimentos com o nome", async () => {
    await saveRhRecordFor(padrao, rh, RH, exame({ vence_em: "2026-11-01" }), AGORA);
    await saveRhRecordFor(padrao, rh, RH, exame({ categoria: "treinamento", tipo: "nr35", resultado: null, emitido_em: "2024-10-01", vence_em: "2026-10-01" }), AGORA);
    await saveRhRecordFor(padrao, rh, RH, exame({ categoria: "documento", tipo: "rg", resultado: null, vence_em: null }), AGORA);
    await saveRhRecordFor(padrao, rh, RH, exame({ colaborador_id: CARLA, vence_em: "2026-10-25" }), AGORA);

    const painel = await getRhPanelFor(padrao, rh, AGORA);
    assert.equal(painel.hoje, "2026-10-23");
    assert.deepEqual(
      painel.colaboradores.map((colaborador) => [colaborador.nome, colaborador.registros, colaborador.vencendo, colaborador.vencidos, colaborador.proximo_vencimento]),
      [
        ["Ana Souza", 3, 1, 1, "2026-11-01"],
        ["Bruno Lima", 0, 0, 0, null],
      ],
    );
    assert.deepEqual(
      painel.vencimentos.map((vencimento) => [vencimento.nome, vencimento.categoria, vencimento.tipo, vencimento.dias]),
      [
        ["Ana Souza", "treinamento", "nr35", -22],
        ["Ana Souza", "exame", "periodico", 9],
      ],
    );

    const ficha = await getRhFichaFor(padrao, rh, { colaborador_id: CARLA }, AGORA);
    assert.equal(ficha.colaborador.ativo, false);
    assert.equal(ficha.registros.length, 1);
  });
});
