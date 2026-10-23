import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerOccurrenceFor, registerStepFor } from "./execucao-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * O andamento da OS pelo escritório no emulador (parte 3.7a): a etapa grava
 * o instante e põe a OS Em execução, com o evento; repetir não duplica;
 * fora de ordem nada se grava; a ocorrência não leva o texto ao evento.
 * Os itens (parte 3.7b): o feito vai até o previsto e a inclusão em campo
 * soma a ele, sem mexer no saldo da demanda.
 */

const PROJECT_ID = "demo-dute-operacao";
const ANA = "col_aaaaaaaaaaaaaaaa";
const AGORA = () => new Date("2026-10-22T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const campo: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-execucao-test");
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
    status: "agendada",
    escopo_rv: 0,
    itens: [{ id: "ln_1", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", unidade: "UN", planejado: "160" }],
    servicos: ["transporte"],
    locais: { origem: null, destino: null },
    janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
    equipe: [{ colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true }],
    equipe_uids: ["uid-ana"],
    veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "DEF4G56", tipo: "Baú", modelo: null, dono: "proprio", empresa: null }],
    instrucoes: null,
    edicao: 2,
    cancelamento: null,
  });
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
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

const passo = (etapa: string, instante: string, chave = `k-${etapa}`) => ({
  idempotency_key: chave,
  numero: "10045-01",
  etapa,
  instante,
  informado_por: ANA,
  meio: "telefone",
});

describe("etapas pelo escritório", () => {
  it("a primeira grava o instante, põe a OS em execução e gera os eventos no instante dela; repetir não duplica", async () => {
    const resultado = await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    assert.deepEqual(resultado, { numero: "10045-01", edicao: 3, status: "em_execucao" });
    const os = await lerOs();
    assert.equal(os.status, "em_execucao");
    assert.equal(os.edicao, 3);
    assert.deepEqual(os.etapas, [
      {
        etapa: "saida_patio",
        instante: "2026-10-22T10:05:00.000Z",
        canal: "escritorio",
        meio: "telefone",
        informado_por: ANA,
        registrado_por: { uid: "interno-1", role: "interno" },
        registrado_em: "2026-10-22T15:00:00.000Z",
      },
    ]);
    const [iniciada] = await eventos("os.started");
    assert.deepEqual(iniciada.payload, { id: "10045-01", demanda: "10045", instante: "2026-10-22T10:05:00.000Z" });
    assert.equal(iniciada.occurred_at, "2026-10-22T10:05:00.000Z");
    assert.equal(iniciada.customer_code, "ITAU");
    const [registrada] = await eventos("os.step_recorded");
    assert.deepEqual(registrada.payload, {
      id: "10045-01",
      demanda: "10045",
      etapa: "saida_patio",
      instante: "2026-10-22T10:05:00.000Z",
      canal: "escritorio",
      informado_por: ANA,
    });
    assert.doesNotMatch(JSON.stringify([iniciada, registrada]), /Ana Lima|DEF4G56/);

    const repetida = await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    assert.equal(repetida.replayed, true);
    assert.equal((await lerOs()).etapas.length, 1);
    assert.equal((await eventos("os.step_recorded")).length, 1);
  });

  it("a seguinte não gera os.started; fora de ordem nada se grava", async () => {
    await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    await registerStepFor(db, interno, passo("carregamento", "2026-10-22T07:50-03:00"), AGORA);
    assert.equal((await eventos("os.started")).length, 1);
    assert.equal((await eventos("os.step_recorded")).length, 2);
    await recusa(
      registerStepFor(db, interno, passo("chegada_origem", "2026-10-22T08:00-03:00"), AGORA),
      "failed-precondition",
      "Chegada na origem vem antes de Carregamento, que já foi registrada.",
    );
    const os = await lerOs();
    assert.equal(os.edicao, 4);
    assert.deepEqual(os.etapas.map((item: { etapa: string }) => item.etapa), ["saida_patio", "carregamento"]);
  });

  it("campo ainda não registra pelo escritório; OS que não existe é recusada", async () => {
    await recusa(registerStepFor(db, campo, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA), "permission-denied", "Seu perfil não grava o cadastro da Operação.");
    await recusa(
      registerStepFor(db, interno, { ...passo("saida_patio", "2026-10-22T07:05-03:00"), numero: "10045-09" }, AGORA),
      "not-found",
      "OS não encontrada.",
    );
    assert.equal((await lerOs()).status, "agendada");
  });
});

describe("ocorrências pelo escritório", () => {
  it("grava na OS com o texto e o evento só com o número da ocorrência", async () => {
    const pedido = {
      idempotency_key: "oc-1",
      numero: "10045-01",
      descricao: "Ana Lima avisou: elevador de carga parado",
      instante: "2026-10-22T09:00-03:00",
      informado_por: ANA,
      meio: "whatsapp",
    };
    const resultado = await registerOccurrenceFor(db, interno, pedido, AGORA);
    assert.deepEqual(resultado, { numero: "10045-01", edicao: 3, status: "agendada", ocorrencia: "oc_01" });
    const os = await lerOs();
    assert.equal(os.status, "agendada");
    assert.deepEqual(os.ocorrencias.map((item: { id: string; descricao: string }) => [item.id, item.descricao]), [["oc_01", "Ana Lima avisou: elevador de carga parado"]]);
    const [evento] = await eventos("os.occurrence_recorded");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: "10045", ocorrencia: "oc_01", instante: "2026-10-22T12:00:00.000Z", canal: "escritorio" });
    assert.doesNotMatch(JSON.stringify(evento), /elevador|Ana Lima/);
    await registerOccurrenceFor(db, interno, pedido, AGORA);
    assert.equal((await lerOs()).ocorrencias.length, 1);
  });
});

describe("itens pela execução", () => {
  const feito = (executado: string, chave = `f-${executado}`) => ({
    action: "executed",
    idempotency_key: chave,
    numero: "10045-01",
    linha: "ln_1",
    executado,
    instante: "2026-10-22T11:20-03:00",
    informado_por: ANA,
  });

  it("antes da primeira etapa recusa; depois grava o feito e o evento com o anterior", async () => {
    await recusa(registerItemFor(db, interno, feito("10"), AGORA), "failed-precondition", "Registre a primeira etapa antes dos itens.");
    await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    const resultado = await registerItemFor(db, interno, feito("128"), AGORA);
    assert.deepEqual(resultado, { numero: "10045-01", edicao: 4, status: "em_execucao", linha: "ln_1" });
    const [item] = (await lerOs()).itens;
    assert.equal(item.executado, "128");
    assert.equal(item.executado_em, "2026-10-22T14:20:00.000Z");
    assert.equal(item.planejado, "160");
    const [evento] = await eventos("os.item_executed");
    assert.deepEqual(evento.payload, {
      id: "10045-01",
      demanda: "10045",
      linha: "ln_1",
      quantidade: "128",
      anterior: null,
      instante: "2026-10-22T14:20:00.000Z",
      canal: "escritorio",
      informado_por: ANA,
    });
    await recusa(
      registerItemFor(db, interno, feito("161"), AGORA),
      "failed-precondition",
      "Cadeira: o feito (161) passa do previsto (160). Inclua o que foi além do planejado.",
    );
  });

  it("a inclusão em campo cria a linha nova uma vez só, soma ao feito e não leva quem pediu ao evento", async () => {
    await db.doc("lpu_items/lpu_giratoria").set({ item: "Cadeira giratória", descricao: "Transporte de cadeira giratória", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true });
    await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    const pedido = {
      action: "added",
      idempotency_key: "inc-1",
      numero: "10045-01",
      lpu_item_id: "lpu_giratoria",
      quantidade: "4",
      pedido_por: "Renata Campos · Facilities",
      motivo: "Cadeiras a mais na sala 412",
      instante: "2026-10-22T09:32-03:00",
    };
    const primeira = await registerItemFor(db, interno, pedido, AGORA);
    const repetida = await registerItemFor(db, interno, pedido, AGORA);
    assert.equal(repetida.linha, primeira.linha);
    assert.match(primeira.linha, /^cp_[a-f0-9]{16}$/);
    const itens = (await lerOs()).itens;
    assert.equal(itens.length, 2);
    const nova = itens[1];
    assert.deepEqual([nova.item, nova.planejado, nova.executado, nova.incluido_em_campo], ["Cadeira giratória", "0", "4", true]);
    assert.deepEqual(nova.incluidos.map((inclusao: { pedido_por: string; quantidade: string }) => [inclusao.pedido_por, inclusao.quantidade]), [["Renata Campos · Facilities", "4"]]);
    const [evento] = await eventos("os.item_added_in_field");
    assert.equal(evento.payload.nova_linha, true);
    assert.equal(evento.payload.lpu_item_id, "lpu_giratoria");
    assert.doesNotMatch(JSON.stringify(evento), /Renata|sala 412/);
    // O feito da linha nova vai até o incluído.
    await recusa(
      registerItemFor(db, interno, { ...feito("5"), linha: primeira.linha }, AGORA),
      "failed-precondition",
      "Cadeira giratória: o feito (5) passa do previsto (4). Inclua o que foi além do planejado.",
    );
  });
});
