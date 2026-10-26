import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { RH_DATABASE } from "./banco.js";
import { downloadRhExportFor, exportRhMonthFor, listRhExportsFor } from "./exportacao-gravacao.js";
import { saveRhRecordFor } from "./ficha-gravacao.js";
import type { RhProfile } from "./profile.js";
import { saveRhVinculoFor } from "./vinculo-gravacao.js";

/**
 * A exportação para a contabilidade no emulador (parte 8.3), com os dois
 * bancos: o cadastro no padrão, a versão, o recibo e o evento no `rh`, nunca
 * no padrão. A mesma competência sem mudança devolve a mesma versão, sem
 * evento novo; com mudança, nasce a seguinte. Só o rh gera; owner, admin e rh
 * baixam, e cada download fica registrado. Com as datas do vínculo (parte
 * 8.4), a planilha de colaboradores lista quem teve vínculo no mês. Dados
 * sintéticos.
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

  it("com as datas do vínculo, entra quem teve vínculo no mês, e a versão guarda o formato 2", async () => {
    await padrao.doc("collaborators/col_eeeeeeeeeeeeeeee").set({ nome: "Eduardo Paz", funcao: "Ajudante", vinculo: "proprio", cpf: "16899535009", ativo: true, edicao: 1 });
    // A Ana, ativa, só é admitida em novembro; a Carla, inativa e sem exame no mês, foi desligada nele.
    await saveRhVinculoFor(padrao, rh, RH, { idempotency_key: "v-ana", colaborador_id: ANA, admissao: "2026-11-03" });
    await saveRhVinculoFor(padrao, rh, RH, { idempotency_key: "v-carla", colaborador_id: CARLA, admissao: "2024-01-10", desligamento: "2026-10-15" });

    await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    const gravada = (await rh.doc("exportacoes/exp_2026-10_v1").get()).data() ?? {};
    assert.equal(gravada.formato, 2);
    assert.deepEqual(
      (gravada.colaboradores as { nome: string; admissao: string | null; desligamento: string | null; situacao_no_mes: string }[]).map((linha) => [linha.nome, linha.admissao, linha.desligamento, linha.situacao_no_mes]),
      [["Carla Dias", "2024-01-10", "2026-10-15", "desligamento"], ["Eduardo Paz", null, null, "ativo"]],
    );
    const arquivo = await downloadRhExportFor(rh, RH, { id: "exp_2026-10_v1", arquivo: "colaboradores" }, AGORA);
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), [
      "Nome;CPF;Função;Admissão;Desligamento;Situação no mês",
      "Carla Dias;390.533.447-05;Ajudante;10/01/2024;15/10/2026;Desligamento no mês",
      "Eduardo Paz;168.995.350-09;Ajudante;;;Ativo",
      "",
    ]);

    // Em novembro, a Ana entra pela admissão, e a Carla, desligada em outubro, sai.
    const novembro = new Date("2026-11-10T15:00:00Z");
    await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-2", competencia: "2026-11" }, novembro);
    const deNovembro = (await rh.doc("exportacoes/exp_2026-11_v1").get()).data() ?? {};
    assert.deepEqual((deNovembro.colaboradores as { nome: string; situacao_no_mes: string }[]).map((linha) => [linha.nome, linha.situacao_no_mes]), [
      ["Ana Souza", "admissao"],
      ["Eduardo Paz", "ativo"],
    ]);
  });

  it("o nome ou a função mudados depois não criam versão nova do mês; o CPF mudado cria", async () => {
    await exame(ANA, "periodico", "2026-10-05");
    await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-1", competencia: "2026-10" }, AGORA);
    await padrao.doc(`collaborators/${ANA}`).update({ nome: "Ana Souza Lima", funcao: "Líder de equipe" });
    const igual = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-2", competencia: "2026-10" }, AGORA);
    assert.deepEqual(igual, { id: "exp_2026-10_v1", versao: 1, nova: false });
    await padrao.doc(`collaborators/${ANA}`).update({ cpf: "168.995.350-09" });
    const outra = await exportRhMonthFor(padrao, rh, RH, { idempotency_key: "exp-3", competencia: "2026-10" }, AGORA);
    assert.deepEqual(outra, { id: "exp_2026-10_v2", versao: 2, nova: true });
    // A versão nova leva o cadastro de hoje inteiro, com o nome novo.
    const gravada = (await rh.doc("exportacoes/exp_2026-10_v2").get()).data() ?? {};
    assert.deepEqual((gravada.colaboradores as { nome: string; cpf: string }[]).map((linha) => [linha.nome, linha.cpf]), [["Ana Souza Lima", "16899535009"]]);
  });

  it("a versão gerada antes das datas do vínculo baixa com as colunas de então", async () => {
    await rh.doc("exportacoes/exp_2026-09_v1").set({
      competencia: "2026-09",
      versao: 1,
      hash: "a".repeat(32),
      exames: [],
      colaboradores: [{ colaborador_id: ANA, nome: "Ana Souza", cpf: "52998224725", funcao: "Montadora", ativo: true }],
      totais: { exames: 0, colaboradores: 1 },
      gerada_em: "2026-10-01T12:00:00.000Z",
    });
    const arquivo = await downloadRhExportFor(rh, RH, { id: "exp_2026-09_v1", arquivo: "colaboradores" }, AGORA);
    assert.deepEqual(arquivo.conteudo.slice(1).split("\r\n"), ["Nome;CPF;Função;Situação", "Ana Souza;529.982.247-25;Montadora;Ativo", ""]);
  });
});
