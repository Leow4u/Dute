import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { completeServiceOrderFor } from "./conclusao-gravacao.js";
import { resolveFieldCompletionFor } from "./conclusao-recusada-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./fotos-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * A conclusão recusada do campo no emulador (pergunta 66): o escritório
 * conclui sem aceite, o celular conclui depois com a assinatura e é recusado;
 * a OS guarda o que chegou, uma vez só, com o evento; a coordenação anexa a
 * assinatura à conclusão ou dispensa. A hora antes da última etapa também
 * guarda, e aí só se dispensa (ou conclui com os dados, pela tela). Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const ANA = "col_aaaaaaaaaaaaaaaa"; // líder, com o app
const AGORA = () => new Date("2026-10-22T21:00:00.000Z");

const lider: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Mariana Lopes" };
const CAMINHO = "os/10045-01/assinatura/as_0123456789abcdef.png";

const NO_STORAGE = new Map<string, { contentType: string; size: number }>([
  ["os/10045-01/fotos/ft_f000000000000001.jpg", { contentType: "image/jpeg", size: 220_000 }],
  [CAMINHO, { contentType: "image/png", size: 18_000 }],
]);
const conferir: ConferirArquivo = async (caminho) => NO_STORAGE.get(caminho) ?? null;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-conclusao-recusada-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").set({
    id: "10045-01",
    numero: "10045-01",
    demanda: "10045",
    seq: 1,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "agendada",
    escopo_rv: 0,
    itens: [{ id: "ln_1", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", unidade: "UN", planejado: "10" }],
    servicos: ["transporte"],
    locais: { origem: null, destino: null },
    janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
    equipe: [{ colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" }],
    equipe_uids: ["uid-ana"],
    veiculos: [],
    instrucoes: null,
    edicao: 2,
    cancelamento: null,
  });
  await db.collection("collaborators").doc(ANA).set({ id: ANA, nome: "Ana Lima", cpf: "52998224725", ativo: true, edicao: 1, usuario_uid: "uid-ana" });
  await registerStepFor(db, lider, { idempotency_key: "e-1", numero: "10045-01", etapa: "saida_patio", instante: "2026-10-22T07:05-03:00" }, AGORA);
  await registerStepFor(db, lider, { idempotency_key: "e-2", numero: "10045-01", etapa: "chegada_origem", instante: "2026-10-22T08:00-03:00" }, AGORA);
  await registerItemFor(db, lider, { action: "executed", idempotency_key: "i-1", numero: "10045-01", linha: "ln_1", executado: "10", instante: "2026-10-22T16:00-03:00" }, AGORA);
  await attachPhotoFor(db, lider, { idempotency_key: "f-1", numero: "10045-01", arquivo: "ft_f000000000000001.jpg", instante: "2026-10-22T17:40-03:00", etapa: "fim" }, conferir, AGORA);
});

after(async () => {
  await deleteApp(app);
});

async function lerOs() {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").get()).data() ?? {};
}

async function eventos(tipo: string) {
  return (await db.collection(EVENTS_COLLECTION).where("type", "==", tipo).get()).docs.map((doc) => doc.data());
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

const doCelular = (extra: Record<string, unknown> = {}) => ({
  idempotency_key: "c-celular",
  numero: "10045-01",
  instante: "2026-10-22T17:52-03:00",
  aceite: "assinatura",
  responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: null },
  assinatura: "as_0123456789abcdef.png",
  ...extra,
});

/** O escritório conclui antes, sem aceite no local. */
const peloEscritorio = () =>
  completeServiceOrderFor(
    db,
    interno,
    { idempotency_key: "c-escritorio", numero: "10045-01", instante: "2026-10-22T17:50-03:00", aceite: "sem_aceite", responsavel: { nome: "Portaria" }, informado_por: ANA, meio: "telefone" },
    conferir,
    AGORA,
  );

const resolver = (acao: string, recusada_em: string, chave = `r-${acao}`) => resolveFieldCompletionFor(db, interno, { idempotency_key: chave, numero: "10045-01", acao, recusada_em }, AGORA);

describe("a conclusão recusada do campo", () => {
  it("o celular conclui a OS já concluída: a recusa chega ao celular, e a OS guarda o que chegou, uma vez só", async () => {
    await peloEscritorio();
    await recusa(completeServiceOrderFor(db, lider, doCelular(), conferir, AGORA), "failed-precondition", "A OS já foi concluída.");
    const os = await lerOs();
    assert.equal(os.status, "em_revisao");
    assert.equal(os.conclusao.aceite, "sem_aceite");
    assert.deepEqual(os.conclusao_recusada, {
      chave: "c-celular",
      recusada_em: "2026-10-22T21:00:00.000Z",
      instante: "2026-10-22T20:52:00.000Z",
      informado_por: ANA,
      registrado_por: { uid: "uid-ana", role: "campo" },
      responsavel: { nome: "Renata Campos", cargo: "Facilities" },
      assinatura: CAMINHO,
      motivo: "A OS já foi concluída.",
      anexada: null,
      dispensada: null,
    });
    const [evento] = await eventos("os.completion_refused");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: "10045", instante: "2026-10-22T20:52:00.000Z", canal: "celular" });
    assert.equal(evento.actor.uid, "uid-ana");
    assert.equal(JSON.stringify(evento).includes("Renata"), false);

    // A fila do celular repete o mesmo pedido: recusa de novo, sem gravar outra vez.
    const edicao = os.edicao;
    await recusa(completeServiceOrderFor(db, lider, doCelular(), conferir, AGORA), "failed-precondition", "A OS já foi concluída.");
    assert.equal((await lerOs()).edicao, edicao);
    assert.equal((await eventos("os.completion_refused")).length, 1);
  });

  it("a coordenação anexa a assinatura à conclusão sem aceite, também na OS revisada; repetir não duplica", async () => {
    await peloEscritorio();
    await recusa(completeServiceOrderFor(db, lider, doCelular(), conferir, AGORA), "failed-precondition", "A OS já foi concluída.");
    await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").update({ status: "revisada" });
    await recusa(
      resolveFieldCompletionFor(db, lider, { idempotency_key: "r-campo", numero: "10045-01", acao: "anexar", recusada_em: "2026-10-22T21:00:00.000Z" }, AGORA),
      "permission-denied",
      "Seu perfil não grava o cadastro da Operação.",
    );

    const antes = await lerOs();
    const resultado = await resolver("anexar", "2026-10-22T21:00:00.000Z");
    assert.deepEqual(resultado, { numero: "10045-01", edicao: antes.edicao + 1, acao: "anexar" });
    const os = await lerOs();
    assert.equal(os.status, "revisada");
    assert.equal(os.conclusao.aceite, "assinatura");
    assert.deepEqual(os.conclusao.responsavel, { nome: "Renata Campos", cargo: "Facilities" });
    assert.equal(os.conclusao.assinatura, CAMINHO);
    assert.equal(os.conclusao.instante, antes.conclusao.instante);
    assert.deepEqual(os.conclusao_recusada.anexada, { instante: "2026-10-22T21:00:00.000Z", por: { uid: "interno-1", nome: "Mariana Lopes" } });
    const [evento] = await eventos("os.signature_attached");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: "10045", instante: "2026-10-22T20:52:00.000Z" });
    assert.equal(evento.actor.uid, "interno-1");

    assert.equal((await resolver("anexar", "2026-10-22T21:00:00.000Z")).replayed, true);
    await recusa(resolver("dispensar", "2026-10-22T21:00:00.000Z"), "failed-precondition", "A conclusão recusada já foi resolvida.");
  });

  it("a hora antes da última etapa também guarda; a OS em execução não recebe a assinatura, e a coordenação dispensa", async () => {
    await recusa(
      completeServiceOrderFor(db, lider, doCelular({ instante: "2026-10-22T07:30-03:00" }), conferir, AGORA),
      "failed-precondition",
      "A hora vem antes de Chegada na origem (08:00).",
    );
    const os = await lerOs();
    assert.equal(os.status, "em_execucao");
    assert.equal(os.conclusao_recusada.motivo, "A hora vem antes de Chegada na origem (08:00).");

    await recusa(resolver("anexar", "2026-10-22T21:00:00.000Z"), "failed-precondition", "Só a OS concluída recebe a assinatura do campo: conclua a OS com estes dados.");
    await recusa(resolver("dispensar", "2026-10-22T20:00:00.000Z", "r-velha"), "failed-precondition", "A conclusão recusada mudou. Recarregue e tente de novo.");
    await resolver("dispensar", "2026-10-22T21:00:00.000Z");
    assert.deepEqual((await lerOs()).conclusao_recusada.dispensada, { instante: "2026-10-22T21:00:00.000Z", por: { uid: "interno-1", nome: "Mariana Lopes" } });
    assert.deepEqual((await eventos("os.refused_completion_dismissed")).map((evento) => evento.payload), [{ id: "10045-01", demanda: "10045" }]);
  });

  it("a coordenação conclui a OS em execução com estes dados: a assinatura do celular vai na conclusão e a recusa fica anexada", async () => {
    await recusa(
      completeServiceOrderFor(db, lider, doCelular({ instante: "2026-10-22T07:30-03:00" }), conferir, AGORA),
      "failed-precondition",
      "A hora vem antes de Chegada na origem (08:00).",
    );
    await completeServiceOrderFor(
      db,
      interno,
      {
        idempotency_key: "c-com-dados",
        numero: "10045-01",
        instante: "2026-10-22T17:52-03:00",
        aceite: "assinatura",
        responsavel: { nome: "Renata Campos", cargo: "Facilities" },
        assinatura: "as_0123456789abcdef.png",
        informado_por: ANA,
        meio: "telefone",
      },
      conferir,
      AGORA,
    );
    const os = await lerOs();
    assert.equal(os.status, "em_revisao");
    assert.equal(os.conclusao.aceite, "assinatura");
    assert.equal(os.conclusao.assinatura, CAMINHO);
    assert.equal(os.conclusao.canal, "escritorio");
    assert.deepEqual(os.conclusao_recusada.anexada, { instante: "2026-10-22T21:00:00.000Z", por: { uid: "interno-1", nome: "Mariana Lopes" } });
  });

  it("a recusa sem assinatura não guarda nada", async () => {
    await peloEscritorio();
    await recusa(
      completeServiceOrderFor(db, lider, doCelular({ aceite: "sem_aceite", assinatura: null, responsavel: { nome: "Portaria" } }), conferir, AGORA),
      "failed-precondition",
      "A OS já foi concluída.",
    );
    assert.equal((await lerOs()).conclusao_recusada, undefined);
    assert.equal((await eventos("os.completion_refused")).length, 0);
  });
});
