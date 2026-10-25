import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerOccurrenceFor, registerPresenceFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor } from "./fotos-gravacao.js";
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
const DIEGO = "col_dddddddddddddddd";
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
    equipe: [
      { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true },
      { colaborador_id: DIEGO, nome: "Diego Alves", papel: "montador", vinculo: "freelancer", empresa: null, no_app: false },
    ],
    equipe_uids: ["uid-ana"],
    veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "DEF4G56", tipo: "Baú", modelo: null, dono: "proprio", empresa: null }],
    instrucoes: null,
    edicao: 2,
    cancelamento: null,
  });
  // O login do campo ligado à Ana (parte 3.4a): é ela quem informa pelo celular.
  await db.collection("collaborators").doc(ANA).set({ id: ANA, nome: "Ana Lima", cpf: "52998224725", ativo: true, edicao: 1, usuario_uid: "uid-ana" });
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

  it("pelo celular o meio não vale; outro papel não registra; OS que não existe é recusada", async () => {
    await recusa(registerStepFor(db, campo, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA), "invalid-argument", "O registro do celular não leva o meio.");
    await recusa(
      registerStepFor(db, { uid: "u-com", role: "comercial", name: "Comercial" }, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA),
      "permission-denied",
      "Seu perfil não grava o cadastro da Operação.",
    );
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

  it("o feito guardado no celular sem sinal não sobrescreve o que o escritório registrou depois", async () => {
    await registerStepFor(db, interno, passo("saida_patio", "2026-10-22T07:05-03:00"), AGORA);
    await registerItemFor(db, interno, { ...feito("120"), instante: "2026-10-22T11:30-03:00" }, AGORA);
    // O celular da Ana guardou 96 às 11:20 e só teve sinal depois.
    await recusa(
      registerItemFor(db, campo, { action: "executed", idempotency_key: "c-feito", numero: "10045-01", linha: "ln_1", executado: "96", instante: "2026-10-22T11:20-03:00" }, AGORA),
      "failed-precondition",
      "Cadeira: o feito das 11:20 é de antes do último registrado (120, às 11:30).",
    );
    const [item] = (await lerOs()).itens;
    assert.deepEqual([item.executado, item.executado_em], ["120", "2026-10-22T14:30:00.000Z"]);
    assert.deepEqual((await eventos("os.item_executed")).map((evento) => evento.payload.quantidade), ["120"]);
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

describe("fotos pela execução", () => {
  const foto = (arquivo: string, extra: Record<string, unknown> = {}) => ({
    idempotency_key: `foto-${arquivo}`,
    numero: "10045-01",
    arquivo,
    instante: "2026-10-22T07:52-03:00",
    etapa: "carregamento",
    legenda: "Carga na doca",
    ...extra,
  });
  const noStorage = new Map([["os/10045-01/fotos/ft_0123456789abcdef.jpg", { contentType: "image/jpeg", size: 240_000 }]]);
  const conferir = async (caminho: string) => noStorage.get(caminho) ?? null;

  it("anexa a foto conferida uma vez só e o evento não leva a legenda", async () => {
    const pedido = foto("ft_0123456789abcdef.jpg");
    const resultado = await attachPhotoFor(db, interno, pedido, conferir, AGORA);
    assert.deepEqual(resultado, { numero: "10045-01", edicao: 3, status: "agendada", foto: "ft_0123456789abcdef" });
    await attachPhotoFor(db, interno, pedido, conferir, AGORA);
    const fotos = (await lerOs()).fotos;
    assert.equal(fotos.length, 1);
    assert.deepEqual([fotos[0].caminho, fotos[0].etapa, fotos[0].legenda], ["os/10045-01/fotos/ft_0123456789abcdef.jpg", "carregamento", "Carga na doca"]);
    const [evento] = await eventos("os.photo_attached");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: "10045", foto: "ft_0123456789abcdef", etapa: "carregamento", ocorrencia: null, linha: null, instante: "2026-10-22T10:52:00.000Z", canal: "escritorio" });
    assert.doesNotMatch(JSON.stringify(evento), /doca/);
  });

  it("o arquivo que não está no Storage não entra na OS", async () => {
    await recusa(attachPhotoFor(db, interno, foto("ft_ffffffffffffffff.jpg"), conferir, AGORA), "failed-precondition", "A foto não chegou ao armazenamento. Envie de novo.");
    assert.equal((await lerOs()).fotos, undefined);
    assert.equal((await eventos("os.photo_attached")).length, 0);
  });
});

describe("o campo escalado, pelo celular", () => {
  const outroCampo: OperacaoProfile = { uid: "uid-outro", role: "campo", name: "Outro" };

  it("registra a etapa como a colaboradora do login, sem meio; quem não está na OS é recusado", async () => {
    await registerStepFor(db, campo, { idempotency_key: "c-1", numero: "10045-01", etapa: "saida_patio", instante: "2026-10-22T07:05-03:00" }, AGORA);
    const [etapa] = (await lerOs()).etapas;
    assert.deepEqual([etapa.canal, etapa.informado_por, etapa.meio, etapa.registrado_por], ["celular", ANA, null, { uid: "uid-ana", role: "campo" }]);
    const [evento] = await eventos("os.step_recorded");
    assert.deepEqual([evento.payload.canal, evento.payload.informado_por], ["celular", ANA]);
    await recusa(
      registerStepFor(db, outroCampo, { idempotency_key: "c-2", numero: "10045-01", etapa: "carregamento", instante: "2026-10-22T07:50-03:00" }, AGORA),
      "permission-denied",
      "Você não está escalado nesta OS.",
    );
    await recusa(
      registerStepFor(db, campo, { idempotency_key: "c-3", numero: "10045-01", etapa: "carregamento", instante: "2026-10-22T07:50-03:00", informado_por: DIEGO }, AGORA),
      "invalid-argument",
      "No celular, quem informa é quem registra.",
    );
    assert.equal((await lerOs()).etapas.length, 1);
  });

  it("a líder marca a presença do freelancer; a segunda marca não muda nada nem gera evento", async () => {
    const entrada = (chave: string, hora: string) => ({ idempotency_key: chave, numero: "10045-01", colaborador_id: DIEGO, tipo: "entrada", instante: `2026-10-22T${hora}-03:00` });
    const primeira = await registerPresenceFor(db, campo, entrada("p-1", "07:45"), AGORA);
    assert.deepEqual(primeira, { numero: "10045-01", edicao: 3, status: "agendada", registrada: true });
    const segunda = await registerPresenceFor(db, interno, entrada("p-2", "07:50"), AGORA);
    assert.equal(segunda.registrada, false);
    const [presenca] = (await lerOs()).presencas;
    assert.deepEqual([presenca.colaborador_id, presenca.entrada.instante, presenca.entrada.por_colaborador], [DIEGO, "2026-10-22T10:45:00.000Z", ANA]);
    const marcas = await eventos("os.presence_recorded");
    assert.equal(marcas.length, 1);
    assert.deepEqual(marcas[0].payload, { id: "10045-01", demanda: "10045", colaborador_id: DIEGO, tipo: "entrada", instante: "2026-10-22T10:45:00.000Z", canal: "celular" });
  });

  it("anexa a foto pelo celular", async () => {
    const conferir = async () => ({ contentType: "image/jpeg", size: 1000 });
    await attachPhotoFor(db, campo, { idempotency_key: "f-c", numero: "10045-01", arquivo: "ft_aaaaaaaaaaaaaaaa.jpg", instante: "2026-10-22T08:00-03:00" }, conferir, AGORA);
    const [foto] = (await lerOs()).fotos;
    assert.deepEqual([foto.canal, foto.informado_por], ["celular", ANA]);
  });
});
