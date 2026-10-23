import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { completeServiceOrderFor } from "./conclusao-gravacao.js";
import { openDirectDemandFor } from "./demanda-direta-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./fotos-gravacao.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { reviewServiceOrderFor } from "./revisao-gravacao.js";
import { getRoomBoardFor } from "./tv-leitura.js";

/**
 * O ciclo da Operação no emulador (parte 3.14, "pronto quando" da Fase 3):
 * a demanda direta e a do Comercial vão do pedido ao planejamento com duas
 * OS, à execução pelo celular da líder, à assinatura, à revisão com
 * divergência e ao Comercial (Execução a orçar ou aditivo). A TV mostra o
 * dia no caminho. Cada etapa e cada item ficam com o instante, e nenhum
 * valor entra em service_orders. Dados sintéticos. O ciclo é no dia de
 * hoje em São Paulo: o servidor grava updated_at com o relógio de verdade, e
 * é por ele que a TV acha as concluídas do dia; as callables recebem o
 * relógio do teste dentro desse dia.
 */

const PROJECT_ID = "demo-dute-operacao";
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ANA = "col_aaaaaaaaaaaaaaaa";
const VAN = "vei_aaaaaaaaaaaaaaaa";
const ABERTURA = () => new Date(`${DIA}T08:00:00-03:00`);
const NO_FIM_DO_DIA = () => new Date(`${DIA}T18:30:00-03:00`);

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const lider: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };
const painel: OperacaoProfile = { uid: "painel-1", role: "painel", name: "TV da sala" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-ciclo-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const MESA = { id: "ln_1", lpu_item_id: "lpu_mesa", codigo: "2.02", item: "Mesa", descricao: "Montagem de mesa", servico: "Montagem", unidade: "UN", quantidade: "60", preco: "88.50", total_cents: 531000 };
const CADEIRA = { ...MESA, id: "ln_2", lpu_item_id: "lpu_cadeira", codigo: "3.05", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", quantidade: "160", preco: "12.00", total_cents: 192000 };

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", status: "active" });
  set("customer_locations/loc_faria", { customer_code: "ITAU", nome: "Faria Lima", endereco: { logradouro: "Av. Brig. Faria Lima", numero: "3500" } });
  set("customer_locations/loc_cat", { customer_code: "ITAU", nome: "CAT", endereco: { logradouro: "Av. do Estado", numero: "5533" } });
  set("lpu_items/lpu_cadeira", { item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true });
  set(`collaborators/${ANA}`, { id: ANA, nome: "Ana Lima", cpf: "52998224725", funcao: "Líder", papeis: ["lider", "motorista"], vinculo: "proprio", usuario_uid: "uid-ana", ativo: true, edicao: 1 });
  set(`vehicles/${VAN}`, { id: VAN, placa: "DEF4G56", tipo: "VUC", modelo: null, capacidade_kg: 3500, capacidade_m3: 12, revisao_em: null, ativo: true, edicao: 1 });
  // A demanda do Comercial com o escopo fechado na RV 0, com preço só no orçamento.
  set("demands/10045", {
    numero: "10045",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    entrada: "comercial",
    etapa: "para_planejar",
    escopo_rv: 0,
    executado_de: null,
    perda: null,
    cancelamento: null,
    validacao: null,
    origem: { local_id: "loc_faria", complemento: "5º andar" },
    destino: { local_id: "loc_cat", complemento: null },
    os_numeros: [],
  });
  set("quotes/10045", { status: "enviado", rv: 0, customer_code: "ITAU", tipo_rv: "proposta" });
  set("quotes/10045/revisoes/0", { linhas: [MESA, CADEIRA] });
  await batch.commit();
});

const NO_STORAGE = new Map<string, { contentType: string; size: number }>();
const conferir: ConferirArquivo = async (caminho) => NO_STORAGE.get(caminho) ?? null;

async function lerOs(numero: string) {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get()).data() ?? {};
}

async function lerDemanda(numero: string) {
  return (await db.collection("demands").doc(numero).get()).data() ?? {};
}

async function tipos(): Promise<string[]> {
  return (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => String(doc.get("type")));
}

/** A líder executa a OS no celular: as etapas, os itens (e o que passou, incluído em campo), a foto do final e a assinatura. */
async function executarEConcluir(numero: string, feitos: Record<string, string>, aMais: Record<string, string> = {}) {
  const passo = (etapa: string, hora: string) =>
    registerStepFor(db, lider, { idempotency_key: `${numero}-${etapa}`, numero, etapa, instante: `${DIA}T${hora}-03:00` }, NO_FIM_DO_DIA);
  await passo("saida_patio", "09:05");
  await passo("chegada_origem", "09:40");
  await passo("carregamento", "10:00");
  await passo("saida_origem", "11:00");
  await passo("chegada_destino", "11:40");
  for (const [linha, executado] of Object.entries(feitos)) {
    await registerItemFor(db, lider, { action: "executed", idempotency_key: `${numero}-${linha}`, numero, linha, executado, instante: `${DIA}T15:00-03:00` }, NO_FIM_DO_DIA);
  }
  for (const [linha, quantidade] of Object.entries(aMais)) {
    await registerItemFor(
      db,
      lider,
      { action: "added", idempotency_key: `${numero}-${linha}-a-mais`, numero, linha, quantidade, pedido_por: "Renata Campos · Facilities", motivo: "Cadeiras a mais na sala 412", instante: `${DIA}T15:30-03:00` },
      NO_FIM_DO_DIA,
    );
  }
  NO_STORAGE.set(`os/${numero}/fotos/ft_f000000000000001.jpg`, { contentType: "image/jpeg", size: 220_000 });
  NO_STORAGE.set(`os/${numero}/assinatura/as_0123456789abcdef.png`, { contentType: "image/png", size: 18_000 });
  await attachPhotoFor(db, lider, { idempotency_key: `${numero}-foto`, numero, arquivo: "ft_f000000000000001.jpg", instante: `${DIA}T16:40-03:00`, etapa: "fim" }, conferir, NO_FIM_DO_DIA);
  await completeServiceOrderFor(
    db,
    lider,
    {
      idempotency_key: `${numero}-fim`,
      numero,
      instante: `${DIA}T16:45-03:00`,
      aceite: "assinatura",
      responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
      assinatura: "as_0123456789abcdef.png",
      diferencas: [],
    },
    conferir,
    NO_FIM_DO_DIA,
  );
}

/** Nenhum valor em nenhuma OS: nem preço, nem total, nem a chave de valor. */
async function semValorNasOs() {
  const todas = (await db.collection(SERVICE_ORDERS_COLLECTION).get()).docs.map((doc) => JSON.stringify(doc.data()));
  assert.ok(todas.length > 0);
  for (const texto of todas) assert.doesNotMatch(texto, /preco|total_cents|valor|88\.50|"12\.00"|R\$/);
}

describe("o ciclo da demanda direta", () => {
  it("pedido → duas OS → execução no celular → assinatura → revisão com divergência → Execução a orçar, com a TV no caminho", async () => {
    const { numero } = await openDirectDemandFor(
      db,
      interno,
      {
        idempotency_key: "direta",
        customer_code: "ITAU",
        titulo: "Troca de cadeiras do 5º andar",
        canal: "telefone",
        pedido_por: { nome: "Renata Campos", telefone: "11987654321" },
        recebida_em: `${DIA}T07:50-03:00`,
        executar_ate: `${DIA}T18:00-03:00`,
        origem: { local_id: "loc_faria", complemento: "5º andar" },
        itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "40" }],
      },
      ABERTURA,
    );
    const [cadeira] = (await lerDemanda(numero)).itens_pedidos as Array<{ id: string }>;

    const plano = await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano-direta",
      demanda: numero,
      ordens: [
        { itens: [{ id: cadeira.id, planejado: "25" }], janela: { data: DIA, inicio: "09:00", fim: "17:00" }, equipe: [{ colaborador_id: ANA, papel: "lider" }], veiculos: [VAN] },
        { itens: [{ id: cadeira.id, planejado: "15" }] },
      ],
    });
    assert.equal(plano.numeros.length, 2);
    const [primeira, segunda] = plano.numeros;

    const deManha = await getRoomBoardFor(db, painel, ABERTURA);
    assert.deepEqual(deManha.ordens.map((os) => [os.numero, os.coluna]), [[primeira, "agendada"]]);

    await executarEConcluir(primeira, { [cadeira.id]: "25" }, { [cadeira.id]: "2" });
    const os = await lerOs(primeira);
    assert.equal(os.status, "em_revisao");
    assert.deepEqual(os.etapas.map((etapa: { etapa: string }) => etapa.etapa), ["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "fim"]);
    assert.ok(os.etapas.every((etapa: { instante: string }) => etapa.instante.startsWith(DIA) && etapa.instante.endsWith(":00.000Z")));
    assert.equal(os.itens[0].executado, "27");
    assert.equal(os.itens[0].incluidos[0].quantidade, "2");

    const noFim = await getRoomBoardFor(db, painel, NO_FIM_DO_DIA);
    assert.deepEqual(noFim.ordens.map((item) => [item.numero, item.coluna, item.aceite]), [[primeira, "concluida", "assinatura"]]);

    // A outra OS ficou para outro dia e foi cancelada: a revisada é a última.
    await saveServiceOrderFor(db, interno, { action: "cancel", idempotency_key: "cancela", numero: segunda, expected_edicao: 1, motivo: "Ficou para outro dia" });
    await reviewServiceOrderFor(db, interno, { idempotency_key: "revisa", numero: primeira, linhas: [{ linha: cadeira.id, decisao: "cobrar" }] }, NO_FIM_DO_DIA);

    const demanda = await lerDemanda(numero);
    assert.equal(demanda.etapa, "execucao_a_orcar");
    assert.deepEqual(demanda.operacao.os_revisadas, [primeira]);
    assert.equal(demanda.operacao.itens[0].a_cobrar, "27");
    const gravados = await tipos();
    for (const tipo of ["demand.direct_opened", "os.planned", "os.started", "os.step_recorded", "os.item_executed", "os.item_added_in_field", "os.photo_attached", "os.completed", "os.signed", "os.cancelled", "os.reviewed", "demand.execution_reviewed"]) {
      assert.ok(gravados.includes(tipo), tipo);
    }
    await semValorNasOs();
  });
});

describe("o ciclo da demanda do Comercial", () => {
  it("escopo fechado → OS do saldo → execução com item a mais → revisão pede o aditivo ao Comercial, sem valor na OS", async () => {
    const plano = await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano-comercial",
      demanda: "10045",
      ordens: [
        { itens: [{ id: "ln_1", planejado: "30" }, { id: "ln_2", planejado: "160" }], janela: { data: DIA, inicio: "09:00", fim: "17:00" }, equipe: [{ colaborador_id: ANA, papel: "lider" }], veiculos: [VAN] },
        { itens: [{ id: "ln_1", planejado: "30" }] },
      ],
    });
    const [primeira, segunda] = plano.numeros;
    assert.deepEqual((await lerDemanda("10045")).os_numeros, [primeira, segunda]);

    await executarEConcluir(primeira, { ln_1: "30", ln_2: "160" }, { ln_2: "4" });
    await reviewServiceOrderFor(db, interno, { idempotency_key: "revisa-comercial", numero: primeira, linhas: [{ linha: "ln_2", decisao: "aditivo" }] }, NO_FIM_DO_DIA);

    const demanda = await lerDemanda("10045");
    assert.equal(demanda.etapa, "para_planejar");
    assert.deepEqual(demanda.operacao.os_revisadas, [primeira]);
    assert.deepEqual(demanda.operacao.os_em_aberto, [segunda]);
    assert.deepEqual(
      demanda.operacao.aditivo.map((linha: Record<string, unknown>) => [linha.os, linha.linha, linha.quantidade]),
      [[primeira, "ln_2", "4"]],
    );
    assert.doesNotMatch(JSON.stringify(demanda.operacao), /preco|cents|88\.50/);
    assert.ok((await tipos()).includes("os.addendum_requested"));
    await semValorNasOs();
  });
});
