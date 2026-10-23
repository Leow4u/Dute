import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION } from "./events.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { reopenServiceOrderFor, reviewServiceOrderFor } from "./revisao-gravacao.js";

/**
 * A revisão no emulador (parte 3.10a): a OS em revisão vai para Revisada com
 * o consumido de cada linha; a demanda recebe o resumo da Operação; a
 * demanda direta vai à Execução a orçar com a última OS revisada e volta a
 * Para planejar se a OS é reaberta antes do orçamento; o aditivo pedido fica
 * no resumo para o Comercial; repetir não duplica.
 */

const PROJECT_ID = "demo-dute-operacao";
const AGORA = () => new Date("2026-10-22T21:10:00.000Z");
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const admin: OperacaoProfile = { uid: "admin-1", role: "admin", name: "Leonardo" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const REGISTRO = { canal: "celular", meio: null, informado_por: null, registrado_por: { uid: "uid-ana", role: "campo" }, registrado_em: "2026-10-22T20:40:00.000Z" };

function osEmRevisao(numero: string, demanda: string, itens: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: numero,
    numero,
    demanda,
    seq: Number(numero.slice(-2)),
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "em_revisao",
    escopo_rv: null,
    itens,
    servicos: ["transporte"],
    locais: { origem: null, destino: null },
    janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
    equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" }],
    equipe_uids: ["uid-ana"],
    veiculos: [],
    instrucoes: null,
    edicao: 8,
    cancelamento: null,
    etapas: [
      { ...REGISTRO, etapa: "saida_patio", instante: "2026-10-22T10:05:00.000Z" },
      { ...REGISTRO, etapa: "fim", instante: "2026-10-22T20:20:00.000Z" },
    ],
    conclusao: { ...REGISTRO, instante: "2026-10-22T20:25:00.000Z", aceite: "sem_aceite", responsavel: { nome: "Portaria" }, assinatura: null, diferencas: [] },
    ...extra,
  };
}

const PEDIDA = { id: "ip_1", lpu_item_id: "lpu_cadeira", codigo: "3.05", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", unidade: "UN", planejado: "40" };

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-revisao-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  // A demanda direta aberta pela Operação (parte 3.4d), com uma OS concluída.
  await db.collection("demands").doc("10301").set({
    numero: "10301",
    customer_code: "ITAU",
    entrada: "direta",
    aberta_pela: "operacao",
    etapa: "para_planejar",
    marcos: [{ etapa: "para_planejar", em: "2026-10-22T09:00:00.000Z", por_uid: "interno-1" }],
    escopo_rv: null,
    itens_pedidos: [{ ...PEDIDA, quantidade: "40" }],
    executado_de: null,
    executado_ate: null,
    registro_execucao: null,
    validacao: null,
    perda: null,
    cancelamento: null,
    os_numeros: ["10301-01"],
  });
  await db.collection(SERVICE_ORDERS_COLLECTION).doc("10301-01").set(osEmRevisao("10301-01", "10301", [{ ...PEDIDA, executado: "44" }]));
});

after(async () => {
  await deleteApp(app);
});

async function lerOs(numero: string) {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get()).data() ?? {};
}

async function lerDemanda(numero: string) {
  return (await db.collection("demands").doc(numero).get()).data() ?? {};
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

const revisar = (extra: Record<string, unknown> = {}) => ({ idempotency_key: "r-1", numero: "10301-01", linhas: [{ linha: "ip_1", decisao: "cobrar" }], ...extra });

describe("revisar a OS da demanda direta", () => {
  it("vai para Revisada; a demanda recebe o resumo e vai à Execução a orçar; repetir não duplica", async () => {
    const resultado = await reviewServiceOrderFor(db, interno, revisar(), AGORA);
    assert.deepEqual(resultado, { numero: "10301-01", edicao: 9, status: "revisada" });
    const os = await lerOs("10301-01");
    assert.equal(os.status, "revisada");
    assert.equal(os.itens[0].consumido, "44");
    assert.deepEqual(
      os.revisao.linhas.map((linha: Record<string, unknown>) => [linha.linha, linha.sinal, linha.decisao, linha.a_cobrar]),
      [["ip_1", "a_mais", "cobrar", "44"]],
    );

    const demanda = await lerDemanda("10301");
    assert.deepEqual(demanda.operacao.os_revisadas, ["10301-01"]);
    assert.deepEqual(demanda.operacao.os_em_aberto, []);
    assert.deepEqual(demanda.operacao.itens[0], { linha: "ip_1", lpu_item_id: "lpu_cadeira", item: "Cadeira", unidade: "UN", executado: "44", a_cobrar: "44", absorvido: "0", aditivo: "0" });
    assert.deepEqual([demanda.etapa, demanda.executado_de, demanda.executado_ate, demanda.registro_execucao.origem], ["execucao_a_orcar", "2026-10-22", "2026-10-22", "operacao"]);
    assert.equal(demanda.marcos.at(-1).etapa, "execucao_a_orcar");

    const [revisada] = await eventos("os.reviewed");
    assert.deepEqual(revisada.payload.decisoes, { cobrar: 1, aditivo: 0, absorver: 0, proxima_os: 0, encerrar: 0 });
    assert.deepEqual([revisada.payload.minutos_planejados, revisada.payload.minutos_reais], [630, 620]);
    const [executada] = await eventos("demand.execution_reviewed");
    assert.deepEqual(executada.payload, { id: "10301", de: "2026-10-22", ate: "2026-10-22", os: 1 });

    assert.equal((await reviewServiceOrderFor(db, interno, revisar(), AGORA)).replayed, true);
    assert.equal((await eventos("os.reviewed")).length, 1);
  });

  it("divergência sem decisão não revisa nada; o campo não revisa", async () => {
    await recusa(reviewServiceOrderFor(db, interno, revisar({ linhas: [] }), AGORA), "invalid-argument", "Cadeira: decida a divergência (+4).");
    await recusa(reviewServiceOrderFor(db, { uid: "uid-ana", role: "campo", name: "Ana" }, revisar(), AGORA), "permission-denied", "Seu perfil não grava o cadastro da Operação.");
    assert.equal((await lerOs("10301-01")).status, "em_revisao");
    assert.equal((await lerDemanda("10301")).operacao, undefined);
  });

  it("reabrir: só owner e admin; volta à execução e a demanda volta a Para planejar antes do orçamento", async () => {
    await reviewServiceOrderFor(db, interno, revisar(), AGORA);
    const reabrir = { idempotency_key: "o-1", numero: "10301-01", motivo: "Faltou registrar a segunda viagem" };
    await recusa(reopenServiceOrderFor(db, interno, reabrir, AGORA), "permission-denied", "Só owner e admin reabrem a OS revisada.");
    await reopenServiceOrderFor(db, admin, reabrir, AGORA);
    const os = await lerOs("10301-01");
    assert.deepEqual([os.status, os.revisao, os.conclusao, os.itens[0].consumido], ["em_execucao", undefined, undefined, undefined]);
    assert.equal(os.revisoes_anteriores.length, 1);
    assert.equal(os.revisoes_anteriores[0].reaberta.motivo, "Faltou registrar a segunda viagem");
    const demanda = await lerDemanda("10301");
    assert.deepEqual([demanda.etapa, demanda.executado_de, demanda.registro_execucao], ["para_planejar", null, null]);
    assert.deepEqual(demanda.operacao.os_em_aberto, ["10301-01"]);
    const [reaberta] = await eventos("os.reopened");
    assert.deepEqual(reaberta.payload, { id: "10301-01", demanda: "10301", demanda_reaberta: true });
  });

  it("com o orçamento da execução aberto no Comercial, a OS não se reabre", async () => {
    await reviewServiceOrderFor(db, interno, revisar(), AGORA);
    await db.collection("quotes").doc("10301").set({ status: "rascunho", rv: 0, tipo_rv: "execucao", customer_code: "ITAU" });
    await recusa(
      reopenServiceOrderFor(db, admin, { idempotency_key: "o-2", numero: "10301-01", motivo: "Conferir" }, AGORA),
      "failed-precondition",
      "O Comercial já abriu o orçamento da execução desta demanda.",
    );
    assert.equal((await lerOs("10301-01")).status, "revisada");
  });
});

describe("revisar a OS da demanda do Comercial", () => {
  it("o que passa do saldo livre vai para aditivo, no resumo; a etapa da demanda é do Comercial", async () => {
    const MESA = { id: "ln_1", lpu_item_id: "lpu_mesa", codigo: "2.02", item: "Mesa", descricao: "Montagem de mesa", servico: "Montagem", unidade: "UN" };
    await db.collection("demands").doc("10045").set({ numero: "10045", customer_code: "ITAU", entrada: "comercial", etapa: "para_planejar", escopo_rv: 0, validacao: null });
    await db.collection("quotes").doc("10045").collection("revisoes").doc("0").set({ linhas: [{ ...MESA, quantidade: "60", preco: "88.50", total_cents: 531000 }] });
    await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").set(osEmRevisao("10045-01", "10045", [{ ...MESA, planejado: "60", executado: "64" }], { escopo_rv: 0 }));
    await recusa(
      reviewServiceOrderFor(db, interno, { idempotency_key: "c-1", numero: "10045-01", linhas: [{ linha: "ln_1", decisao: "cobrar" }] }, AGORA),
      "failed-precondition",
      "Mesa: o saldo livre da demanda é 0; o que passa dele vai para aditivo.",
    );
    await reviewServiceOrderFor(db, interno, { idempotency_key: "c-2", numero: "10045-01", linhas: [{ linha: "ln_1", decisao: "aditivo" }] }, AGORA);
    const demanda = await lerDemanda("10045");
    assert.equal(demanda.etapa, "para_planejar");
    assert.deepEqual(demanda.operacao.aditivo, [
      { os: "10045-01", linha: "ln_1", lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", quantidade: "4", pedido_em: "2026-10-22T21:10:00.000Z" },
    ]);
    assert.doesNotMatch(JSON.stringify(demanda.operacao), /preco|88\.50|cents/);
    const [pedido] = await eventos("os.addendum_requested");
    assert.deepEqual(pedido.payload, { id: "10045-01", demanda: "10045", linhas: 1 });
  });
});
