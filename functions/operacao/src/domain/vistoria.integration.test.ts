import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { completeServiceOrderFor } from "./conclusao-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./fotos-gravacao.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { reopenServiceOrderFor } from "./revisao-gravacao.js";
import { sendSurveyToCommercialFor } from "./vistoria-gravacao.js";

/**
 * A vistoria no emulador (parte 3.11a): a coordenação abre a vistoria da
 * demanda do Comercial ainda não fechada, uma por vez; a líder chega, tira as
 * fotos e envia ao Comercial; a OS vai para Revisada com a vistoria e o Fim,
 * a demanda recebe o resumo (itens somados, caminhos das fotos) e os eventos
 * só contam; repetir não duplica; a vistoria não tem itens da OS, aceite
 * nem reabertura. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const ANA = "col_aaaaaaaaaaaaaaaa"; // líder, com o app
const BRUNO = "col_bbbbbbbbbbbbbbbb"; // ajudante, com o app
const AGORA = () => new Date("2026-10-22T21:00:00.000Z");

const lider: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };
const ajudante: OperacaoProfile = { uid: "uid-bruno", role: "campo", name: "Bruno" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const owner: OperacaoProfile = { uid: "owner-1", role: "owner", name: "Leonardo" };

const FOTO_1 = "ft_a000000000000001";
const FOTO_2 = "ft_a000000000000002";
const NO_STORAGE = new Map<string, { contentType: string; size: number }>([
  [`os/10045-01/fotos/${FOTO_1}.jpg`, { contentType: "image/jpeg", size: 220_000 }],
  [`os/10045-01/fotos/${FOTO_2}.jpg`, { contentType: "image/jpeg", size: 240_000 }],
]);
const conferir: ConferirArquivo = async (caminho) => NO_STORAGE.get(caminho) ?? null;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-vistoria-test");
  db = getFirestore(app);
});

const DEMANDA_DO_COMERCIAL = {
  numero: "10045",
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  entrada: "comercial",
  etapa: "em_montagem",
  escopo_rv: null,
  executado_de: null,
  validacao: null,
  perda: null,
  cancelamento: null,
  origem: { local_id: "loc_ceic", complemento: "12º andar" },
  destino: { local_id: "loc_cat", complemento: null },
  execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: "2026-10-22" },
  os_numeros: [],
};

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("demands/10045", DEMANDA_DO_COMERCIAL);
  set("demands/10050", { ...DEMANDA_DO_COMERCIAL, numero: "10050", entrada: "direta", aberta_pela: "operacao", etapa: "para_planejar" });
  set("demands/10060", { ...DEMANDA_DO_COMERCIAL, numero: "10060", etapa: "para_planejar", escopo_rv: 0 });
  set("demands/10070", { ...DEMANDA_DO_COMERCIAL, numero: "10070", etapa: "perdida", perda: { motivo: "preco" } });
  set("customer_locations/loc_ceic", {
    id: "loc_ceic",
    customer_code: "ITAU",
    nome: "CEIC",
    endereco: { logradouro: "Av. Paulista", numero: "1842", cidade: "São Paulo", uf: "SP" },
  });
  set(`collaborators/${ANA}`, { id: ANA, nome: "Ana Lima", cpf: "52998224725", funcao: "Líder", ativo: true, edicao: 1, papeis: ["lider"], usuario_uid: "uid-ana" });
  set(`collaborators/${BRUNO}`, { id: BRUNO, nome: "Bruno Teixeira", cpf: "11144477735", funcao: "Ajudante", ativo: true, edicao: 1, papeis: ["ajudante"], usuario_uid: "uid-bruno" });
  const item = (id: string, nome: string, extra: Record<string, unknown> = {}) =>
    set(`lpu_items/${id}`, { id, item: nome, descricao: nome, servico: "Transporte", unidade: "UN", orcavel: true, ativo: true, ...extra });
  item("lpu_cadeira", "Transporte de cadeira");
  item("lpu_estacao", "Desmontagem de estação", { servico: "Desmontagem" });
  item("lpu_velho", "Item antigo", { ativo: false });
  await batch.commit();
});

after(async () => {
  await deleteApp(app);
});

async function lerOs(numero = "10045-01") {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get()).data() ?? {};
}

async function lerDemanda(numero = "10045") {
  return (await db.collection("demands").doc(numero).get()).data() ?? {};
}

async function eventos() {
  return (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => doc.data());
}

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

const abrir = (demanda = "10045", chave = "v-abre") =>
  saveServiceOrderFor(db, interno, {
    action: "survey",
    idempotency_key: chave,
    demanda,
    equipe: [{ colaborador_id: ANA, papel: "lider" }, { colaborador_id: BRUNO }],
    contatos: { origem: { nome: "Renata", telefone: "(11) 98888-7777" } },
    instrucoes: "Levantar o 12º andar inteiro.",
  });

/** Abre a vistoria, agenda para o dia (a janela de hoje não cabe no relógio fixo do teste) e a líder chega. */
async function vistoriaNoLocal() {
  await abrir();
  await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").update({ status: "agendada", janela: { data: "2026-10-22", inicio: "14:00", fim: "16:00" } });
  await registerStepFor(db, lider, { idempotency_key: "e-1", numero: "10045-01", etapa: "chegada_origem", instante: "2026-10-22T14:05-03:00" }, AGORA);
  for (const [indice, [arquivo, legenda]] of [[FOTO_1, "Recepção"], [FOTO_2, "Estações"]].entries()) {
    await attachPhotoFor(
      db,
      lider,
      { idempotency_key: `f-${indice}`, numero: "10045-01", arquivo: `${arquivo}.jpg`, instante: "2026-10-22T14:30-03:00", legenda },
      conferir,
      AGORA,
    );
  }
}

const envio = (extra: Record<string, unknown> = {}) => ({
  idempotency_key: "v-envia",
  numero: "10045-01",
  instante: "2026-10-22T15:40-03:00",
  ambientes: [
    { nome: "Recepção", itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "8" }], fotos: [FOTO_1] },
    { nome: "Estações", itens: [{ lpu_item_id: "lpu_estacao", quantidade: "12" }, { lpu_item_id: "lpu_cadeira", quantidade: "16" }], fotos: [FOTO_2] },
  ],
  medidas: [{ nome: "Porta", valor: "0,90 m" }],
  acesso: { horario_de_carga: "Depois das 18h", vaga_de_carga: "Doca 2" },
  observacoes: "Elevador de serviço só até as 19h.",
  ...extra,
});

describe("abrir a vistoria", () => {
  it("a OS sem itens, no local de origem da demanda, com a equipe; o número é da demanda; uma por vez", async () => {
    const aberta = await abrir();
    assert.deepEqual([aberta.numero, aberta.numeros], ["10045-01", ["10045-01"]]);
    const os = await lerOs();
    assert.deepEqual([os.tipo, os.status, os.itens, os.servicos, os.escopo_rv], ["vistoria", "aberta", [], ["vistoria"], null]);
    assert.deepEqual(os.locais, {
      origem: {
        local_id: "loc_ceic",
        nome: "CEIC",
        endereco: "Av. Paulista, 1842 · São Paulo/SP",
        complemento: "12º andar",
        contato: { nome: "Renata", telefone: "11988887777" },
      },
      destino: null,
    });
    assert.deepEqual(os.equipe_uids, ["uid-ana", "uid-bruno"]);
    assert.deepEqual((await lerDemanda()).os_numeros, ["10045-01"]);
    const [evento] = await eventos();
    assert.equal(evento.type, "os.survey_opened");
    assert.deepEqual(evento.payload, {
      id: "10045-01",
      demanda: "10045",
      seq: 1,
      data: null,
      equipe: [
        { colaborador_id: ANA, papel: "lider", vinculo: "proprio" },
        { colaborador_id: BRUNO, papel: "ajudante", vinculo: "proprio" },
      ],
      veiculos: [],
    });

    // Repetir a chamada devolve a mesma vistoria; outra, com a primeira em aberto, é recusada.
    assert.equal((await abrir()).replayed, true);
    await recusa(abrir("10045", "v-outra"), "failed-precondition", "A demanda já tem a vistoria 10045-01 em aberto.");
    // Cancelada, abre outra, com o número seguinte.
    await saveServiceOrderFor(db, interno, { action: "cancel", idempotency_key: "v-cancela", numero: "10045-01", expected_edicao: 1, motivo: "Cliente remarcou" });
    assert.equal((await abrir("10045", "v-nova")).numero, "10045-02");
  });

  it("só na demanda do Comercial ainda não fechada, e só quem coordena", async () => {
    await recusa(abrir("10050"), "failed-precondition", "A demanda direta não tem vistoria: a Operação executa e o Comercial orça depois.");
    await recusa(abrir("10060"), "failed-precondition", "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.");
    await recusa(abrir("10070"), "failed-precondition", "A demanda foi perdida no Comercial.");
    await recusa(abrir("10099"), "not-found", "Demanda não encontrada.");
    await recusa(
      saveServiceOrderFor(db, lider, { action: "survey", idempotency_key: "v-campo", demanda: "10045" }),
      "permission-denied",
      "Seu perfil não grava o cadastro da Operação.",
    );
    // A vistoria não muda itens.
    await abrir();
    await recusa(
      saveServiceOrderFor(db, interno, { action: "set_items", idempotency_key: "v-itens", numero: "10045-01", expected_edicao: 1, itens: [{ id: "ln_1", planejado: "1" }] }),
      "failed-precondition",
      "A vistoria não tem itens do escopo: os itens levantados vão no envio ao Comercial.",
    );
    assert.equal((await eventos()).filter((evento) => evento.type === "os.survey_opened").length, 1);
  });
});

describe("enviar a vistoria ao Comercial", () => {
  it("a OS vai para Revisada com a vistoria e o Fim; a demanda recebe o resumo; os eventos só contam; repetir não duplica", async () => {
    await vistoriaNoLocal();
    // A vistoria não tem itens da OS, carga nem aceite.
    await recusa(
      registerStepFor(db, lider, { idempotency_key: "e-2", numero: "10045-01", etapa: "carregamento", instante: "2026-10-22T14:40-03:00" }, AGORA),
      "invalid-argument",
      "A vistoria não tem a etapa Carregamento.",
    );
    await recusa(
      registerItemFor(db, lider, { action: "executed", idempotency_key: "i-1", numero: "10045-01", linha: "ln_1", executado: "1", instante: "2026-10-22T14:40-03:00" }, AGORA),
      "failed-precondition",
      "A vistoria não tem itens da OS: os itens levantados vão no envio ao Comercial.",
    );
    await recusa(
      completeServiceOrderFor(
        db,
        lider,
        { idempotency_key: "c-1", numero: "10045-01", instante: "2026-10-22T15:40-03:00", aceite: "sem_aceite", responsavel: { nome: "Portaria" } },
        conferir,
        AGORA,
      ),
      "failed-precondition",
      "A vistoria não se conclui com aceite: envie a vistoria ao Comercial.",
    );
    // Pelo celular, só a líder envia.
    await recusa(sendSurveyToCommercialFor(db, ajudante, envio(), AGORA), "permission-denied", "Só o líder envia a vistoria pelo celular.");

    const enviada = await sendSurveyToCommercialFor(db, lider, envio(), AGORA);
    // Aberta (1), chegada (2), duas fotos (3 e 4) e o envio (5).
    assert.deepEqual([enviada.status, enviada.edicao], ["revisada", 5]);
    const os = await lerOs();
    assert.equal(os.status, "revisada");
    assert.deepEqual((os.etapas as Array<{ etapa: string }>).map((etapa) => etapa.etapa), ["chegada_origem", "fim"]);
    assert.deepEqual([os.vistoria.instante, os.vistoria.canal, os.vistoria.informado_por], ["2026-10-22T18:40:00.000Z", "celular", ANA]);
    assert.deepEqual(os.vistoria.medidas, [{ nome: "Porta", valor: "0,90 m" }]);

    const demanda = await lerDemanda();
    assert.deepEqual(demanda.vistoria.itens, [
      { lpu_item_id: "lpu_cadeira", item: "Transporte de cadeira", unidade: "UN", quantidade: "24" },
      { lpu_item_id: "lpu_estacao", item: "Desmontagem de estação", unidade: "UN", quantidade: "12" },
    ]);
    assert.deepEqual(
      demanda.vistoria.ambientes.map((ambiente: { nome: string; fotos: string[] }) => [ambiente.nome, ambiente.fotos]),
      [
        ["Recepção", [`os/10045-01/fotos/${FOTO_1}.jpg`]],
        ["Estações", [`os/10045-01/fotos/${FOTO_2}.jpg`]],
      ],
    );
    assert.deepEqual([demanda.vistoria.os, demanda.vistoria.enviada_em], ["10045-01", "2026-10-22T18:40:00.000Z"]);
    // A demanda continua do Comercial: a etapa e o orçamento não mudam.
    assert.deepEqual([demanda.etapa, demanda.escopo_rv], ["em_montagem", null]);

    const depois = await eventos();
    const enviados = depois.filter((evento) => evento.type === "os.survey_sent");
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].payload, {
      id: "10045-01",
      demanda: "10045",
      instante: "2026-10-22T18:40:00.000Z",
      canal: "celular",
      informado_por: ANA,
      ambientes: 2,
      itens: 2,
      fotos: 2,
      medidas: 1,
    });
    assert.equal(depois.filter((evento) => evento.type === "os.step_recorded" && evento.payload.etapa === "fim").length, 1);
    // Os nomes, as medidas e as observações não vão ao evento.
    assert.doesNotMatch(JSON.stringify(depois.map((evento) => evento.payload)), /Recepção|Porta|Elevador|Doca/);

    // O celular reenviando: o recibo devolve o mesmo resultado, sem outro evento.
    const repetida = await sendSurveyToCommercialFor(db, lider, envio(), AGORA);
    assert.deepEqual([repetida.replayed, repetida.status], [true, "revisada"]);
    assert.equal((await eventos()).length, depois.length);
    // Outro envio, com outra chave: a vistoria já foi.
    await recusa(sendSurveyToCommercialFor(db, lider, envio({ idempotency_key: "v-de-novo" }), AGORA), "failed-precondition", "A OS já foi concluída.");
    // Enviada, não se reabre; a demanda pode ter outra vistoria.
    await recusa(
      reopenServiceOrderFor(db, owner, { idempotency_key: "r-1", numero: "10045-01", motivo: "Faltou um ambiente" }, AGORA),
      "failed-precondition",
      "A vistoria enviada ao Comercial não se reabre: abra outra vistoria da demanda.",
    );
    assert.equal((await abrir("10045", "v-segunda")).numero, "10045-02");
  });

  it("item fora do catálogo e foto que não está na OS não enviam nada", async () => {
    await vistoriaNoLocal();
    await recusa(
      sendSurveyToCommercialFor(db, lider, envio({ ambientes: [{ nome: "Arquivo", itens: [{ lpu_item_id: "lpu_velho", quantidade: "2" }], fotos: [FOTO_1] }] }), AGORA),
      "invalid-argument",
      "Arquivo: um item não está ativo no catálogo.",
    );
    await recusa(
      sendSurveyToCommercialFor(
        db,
        lider,
        envio({ idempotency_key: "v-2", ambientes: [{ nome: "Arquivo", itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "2" }], fotos: ["ft_b000000000000009"] }] }),
        AGORA,
      ),
      "invalid-argument",
      "Arquivo: uma foto não está na OS. Envie a foto antes.",
    );
    assert.equal((await lerOs()).status, "em_execucao");
    assert.equal((await lerDemanda()).vistoria, undefined);
  });
});
