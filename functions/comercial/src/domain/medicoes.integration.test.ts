import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { registrarAditivo } from "./contratos.js";
import { recordAuthorizationFor } from "./autorizacoes.js";
import { advanceDemandFor } from "./demandas.js";
import { advanceMedicaoFor, saveMedicaoFor } from "./medicoes.js";
import type { ComercialProfile } from "./profile.js";
import { actorOf, advanceQuoteFor, saveQuoteFor } from "./quotes.js";

/**
 * Medição mensal no emulador (parte 16a): uma medição por contrato e
 * competência, só de contrato por medição mensal; cada linha precificada pela
 * tabela do contrato vigente na data da solicitação, inclusive quando a
 * tabela nova é carregada no meio da competência; as marcas (sábado na
 * tarifa de dia útil, rota fora da tabela, pedido sem anexo); enviar,
 * contestar, reabrir e aprovar com a situação e a edição conferidas; e a
 * aprovação criando a autorização de faturamento e levando as demandas a "a
 * faturar". Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-comercial";

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner", name: "Leonardo", email: "leonardo@dutelog.com.br" };
const admin: ComercialProfile = { uid: "admin-1", role: "admin", name: "Admin" };
const wms: ComercialProfile = { uid: "wms-1", role: "wms", name: "Operador" };
const financeiro: ComercialProfile = { uid: "fin-1", role: "financeiro", name: "Financeiro" };

const instante = (iso: string) => () => new Date(iso);
/** 01/10/2026 (quinta): as propostas saem com a tabela v1. */
const OUT_01 = instante("2026-10-01T15:00:00.000Z");
const OUT_02 = instante("2026-10-02T15:00:00.000Z");
const OUT_06 = instante("2026-10-06T15:00:00.000Z");
const OUT_17 = instante("2026-10-17T15:00:00.000Z");
/** 20/10/2026: a medição de outubro é montada. */
const OUT_20 = instante("2026-10-20T15:00:00.000Z");
/** 02/11/2026: enviada ao cliente. */
const NOV_02 = instante("2026-11-02T15:00:00.000Z");
/** 03/11/2026: enviada, contestada, reaberta e aprovada. */
const NOV_03 = instante("2026-11-03T15:00:00.000Z");

const MEDICAO = "safra-2026_2026-10";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let chave = 0;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-medicoes-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function precos(valores: Record<string, string>) {
  return Object.fromEntries(Object.entries(valores).map(([id, preco]) => [id, { codigo: `SF-${id}`, descricao_cliente: `Item ${id}`, preco }]));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("users/owner-1", { role: "owner", nome: "Leonardo" });
  set("users/com-1", { role: "comercial", nome: "Guilherme" });

  set("customers/SAFRA", { code: "SAFRA", customer_code: "SAFRA", name: "Safra", stage: "cliente", status: "active" });
  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", stage: "cliente", status: "active" });
  set("contracts/safra-2026", {
    id: "safra-2026",
    customer_code: "SAFRA",
    regime_padrao: "medicao_mensal",
    regimes: [],
    autorizacao: { tipo: "medicao_aprovada", prazo_perda_dias: null },
    vigente_de: "2026-01-01",
    vigente_ate: "2026-12-31",
    status: "vigente",
    edicao: 1,
  });
  set("contracts/itau-2026", {
    id: "itau-2026",
    customer_code: "ITAU",
    regime_padrao: "por_demanda",
    regimes: [],
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    vigente_de: "2026-01-01",
    vigente_ate: null,
    status: "vigente",
    edicao: 1,
  });
  set("customer_contacts/ct_safra", { id: "ct_safra", customer_code: "SAFRA", nome: "Lúcia", empresa: null, ativo: true });
  set("customer_contacts/ct_renata", { id: "ct_renata", customer_code: "ITAU", nome: "Renata", empresa: "Souza & Lopes", ativo: true });

  const item = (id: string, campos: Record<string, unknown>) =>
    set(`lpu_items/${id}`, { id, unidade: "UN", orcavel: true, ativo: true, ...campos });
  item("lpu_aj_util", { categoria: "Diárias", item: "Ajudante", servico: "Diária seg–sex", descricao: "Diária de ajudante" });
  item("lpu_aj_sab", { categoria: "Diárias", item: "Ajudante", servico: "Diária sábado", descricao: "Diária de ajudante" });
  item("lpu_aj_dom", { categoria: "Diárias", item: "Ajudante", servico: "Diária domingo e feriado", descricao: "Diária de ajudante" });
  item("lpu_vuc", { categoria: "Viagens", item: "VUC", servico: "Viagem", descricao: "Viagem de VUC" });
  item("lpu_truck", { categoria: "Viagens", item: "Truck", servico: "Viagem", descricao: "Viagem de truck" });

  // Só a v1 está carregada, em aberto: a v2 chega no meio de outubro (carregarV2).
  set("price_tables/pt_safra_v1", {
    id: "pt_safra_v1",
    nome: "LPU de teste v1",
    customer_code: "SAFRA",
    contract_id: "safra-2026",
    variante: "Comercial",
    vigente_de: "2026-01-01",
    vigente_ate: null,
    status: "ativa",
    precos: precos({ lpu_aj_util: "280.00", lpu_aj_sab: "364.00", lpu_aj_dom: "476.00", lpu_vuc: "620.00", lpu_truck: "1350.00" }),
  });
  set("price_tables/pt_padrao", {
    id: "pt_padrao",
    nome: "Tabela Padrão Dutelog",
    customer_code: null,
    contract_id: null,
    variante: "Comercial",
    vigente_de: "2025-01-01",
    vigente_ate: null,
    status: "ativa",
    precos: precos({ lpu_aj_util: "999.00", lpu_vuc: "999.00" }),
  });
  await batch.commit();
});

/** A renovação da tabela (vigente desde 15/10), carregada depois: encerra a v1 na véspera, como cargas/tabela.ts. */
async function carregarV2() {
  await db.doc("price_tables/pt_safra_v1").update({ status: "encerrada", vigente_ate: "2026-10-14", encerrada_por: "pt_safra_v2" });
  await db.doc("price_tables/pt_safra_v2").set({
    id: "pt_safra_v2",
    nome: "LPU de teste v2",
    customer_code: "SAFRA",
    contract_id: "safra-2026",
    variante: "Comercial",
    vigente_de: "2026-10-15",
    vigente_ate: null,
    status: "ativa",
    substitui: "pt_safra_v1",
    precos: precos({ lpu_aj_util: "290.00", lpu_aj_sab: "377.00", lpu_aj_dom: "493.00", lpu_vuc: "640.00", lpu_truck: "1400.00" }),
  });
}

function key(): string {
  chave += 1;
  return `req-${chave}`;
}

async function rejeita(promise: Promise<unknown>, code: string, message?: RegExp): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return error;
  }
  assert.fail("deveria recusar");
}

async function doc(path: string): Promise<Record<string, unknown>> {
  const snapshot = await db.doc(path).get();
  assert.ok(snapshot.exists, `${path} não existe`);
  return snapshot.data() ?? {};
}

async function existe(path: string): Promise<boolean> {
  return (await db.doc(path).get()).exists;
}

async function eventos(): Promise<Array<Record<string, unknown>>> {
  return (await db.collection("events").get()).docs.map((row) => row.data());
}

type Linha = Record<string, unknown>;

// --- Demandas do Safra pelo caminho do orçamento ---------------------------------------

async function orcamento(caller: ComercialProfile, action: string, numero: string, agora = OUT_01) {
  const quote = await doc(`quotes/${numero}`);
  return advanceQuoteFor(db, caller, { action, request_id: key(), numero, expected_status: quote.status, expected_edicao: quote.edicao }, { agora });
}

async function demanda(action: string, numero: string, extra: Record<string, unknown>, agora: () => Date) {
  const [dem, quote] = await Promise.all([doc(`demands/${numero}`), doc(`quotes/${numero}`)]);
  return advanceDemandFor(db, comercial, { action, request_id: key(), numero, expected_etapa: dem.etapa, expected_rv: quote.rv, ...extra }, { agora });
}

/** Proposta do Safra montada, aprovada pelo owner e enviada: aguardando o cliente. */
async function propostaEnviada(customer = "SAFRA"): Promise<string> {
  const { numero } = await saveQuoteFor(
    db,
    comercial,
    {
      action: "create",
      request_id: key(),
      customer_code: customer,
      contrato_id: customer === "SAFRA" ? "safra-2026" : "itau-2026",
      contato_id: customer === "SAFRA" ? "ct_safra" : "ct_renata",
      canal: "email",
      tipo: "planejada",
      titulo: "Transporte de mobiliário",
      recebida_em: "2026-09-30T09:42:00-03:00",
      linhas: [{ origem: "tabela", lpu_item_id: customer === "SAFRA" ? "lpu_aj_util" : "lpu_vuc", quantidade: "2" }],
    },
    { agora: OUT_01 },
  );
  await orcamento(comercial, "submit", numero);
  await orcamento(owner, "approve", numero);
  await orcamento(comercial, "send", numero);
  return numero;
}

async function fechada(): Promise<string> {
  const numero = await propostaEnviada();
  await demanda("close", numero, {}, OUT_02);
  return numero;
}

// --- Medição -------------------------------------------------------------------------------

async function abrir(contratoId = "safra-2026", competencia = "2026-10", caller = comercial, request_id = key()) {
  return saveMedicaoFor(db, caller, { action: "create", request_id, contrato_id: contratoId, competencia }, { agora: OUT_20 });
}

function linha(campos: Record<string, unknown> = {}): Linha {
  return {
    os: "OS 9001",
    solicitada_em: "2026-10-01",
    area_solicitante: "Facilities",
    executada_em: "2026-10-05",
    janela: "diurna",
    origem: "Sede",
    destino: "Agência Centro",
    mercadoria: "18 caixas de arquivo",
    itens: [
      { origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2" },
      { origem: "tabela", lpu_item_id: "lpu_vuc", quantidade: "1" },
    ],
    anexo: { nome: "OS 9001.pdf", referencia: "e-mail de 01/10, anexo OS 9001.pdf" },
    ...campos,
  };
}

async function salvar(campos: Record<string, unknown>, agora = OUT_20, caller: ComercialProfile = comercial, medicaoId = MEDICAO) {
  const atual = await doc(`medicoes/${medicaoId}`);
  return saveMedicaoFor(
    db,
    caller,
    { action: "upsert_line", request_id: key(), medicao_id: medicaoId, expected_edicao: atual.edicao, linha: linha(campos) },
    { agora },
  );
}

async function avancar(action: string, extra: Record<string, unknown> = {}, agora = NOV_03, caller: ComercialProfile = comercial) {
  const atual = await doc(`medicoes/${MEDICAO}`);
  return advanceMedicaoFor(
    db,
    caller,
    { action, request_id: key(), medicao_id: MEDICAO, expected_status: atual.status, expected_edicao: atual.edicao, ...extra },
    { agora },
  );
}

function linhasDe(medicao: Record<string, unknown>): Linha[] {
  return medicao.linhas as Linha[];
}

function itensDe(linhaGravada: Linha): Linha[] {
  return linhaGravada.itens as Linha[];
}

const DINHEIRO = /valor|preco|preço|price|total|cents|centavo|amount|desconto|subtotal/i;

function chavesDeDinheiro(valor: unknown, caminho = ""): string[] {
  if (Array.isArray(valor)) return valor.flatMap((item, indice) => chavesDeDinheiro(item, `${caminho}[${indice}]`));
  if (valor && typeof valor === "object" && !(valor instanceof Timestamp)) {
    return Object.entries(valor as Record<string, unknown>).flatMap(([chave, item]) => [
      ...(DINHEIRO.test(chave) ? [`${caminho}.${chave}`] : []),
      ...chavesDeDinheiro(item, `${caminho}.${chave}`),
    ]);
  }
  return [];
}

/** Evento sem dinheiro nem pessoa, sem a OS do cliente, a área, os locais, a mercadoria ou a nota. */
function semDinheiroNemPessoa(events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    assert.deepEqual(chavesDeDinheiro(event.payload), [], String(event.type));
    const texto = `${JSON.stringify(event.payload)} ${event.title} ${event.description}`;
    assert.doesNotMatch(texto, /\d[.,]\d|R\$|Lúcia|Safra|OS 900|Facilities|Agência|caixas|Jundiaí|cobrado|@/, String(event.type));
  }
}

describe("abrir a medição", () => {
  it("só de contrato com regime medicao_mensal; o contrato por demanda é recusado", async () => {
    await rejeita(abrir("itau-2026"), "failed-precondition", /não cobra por medição mensal/);
    await rejeita(abrir("nao-existe"), "not-found");
    assert.equal(await existe("medicoes/itau-2026_2026-10"), false);
  });

  it("uma por contrato e competência: a competência repetida é recusada; a futura também", async () => {
    const aberta = await abrir();
    assert.deepEqual([aberta.medicao_id, aberta.status, aberta.edicao, aberta.total_cents, aberta.linhas], [MEDICAO, "rascunho", 1, 0, 0]);
    const medicao = await doc(`medicoes/${MEDICAO}`);
    assert.deepEqual(
      [medicao.customer_code, medicao.contrato_id, medicao.competencia, medicao.variante, medicao.status],
      ["SAFRA", "safra-2026", "2026-10", "Comercial", "rascunho"],
    );
    await rejeita(abrir(), "already-exists", /outubro\/2026/);
    await rejeita(abrir("safra-2026", "2026-11"), "failed-precondition", /ainda não começou/);
    await rejeita(abrir("safra-2026", "2025-12"), "failed-precondition", /fora da vigência/);
    // A mesma chave repete a resposta, sem gravar de novo.
    const chaveRepetida = key();
    await abrir("safra-2026", "2026-09", comercial, chaveRepetida);
    const repetida = await abrir("safra-2026", "2026-09", comercial, chaveRepetida);
    assert.equal(repetida.replayed, true);
    const criados = (await eventos()).filter((event) => event.type === "medicao.created");
    assert.equal(criados.length, 2);
    assert.deepEqual(criados.find((event) => event.entity_id === MEDICAO)?.payload, {
      medicao_id: MEDICAO,
      contrato_id: "safra-2026",
      competencia: "2026-10",
      demandas: 0,
    });
  });

  it("depois do aditivo de prorrogação, a medição do último mês do período anterior ainda abre", async () => {
    await db.doc("contracts/safra-2026").update({ vigente_de: "2025-11-01", vigente_ate: "2026-10-31" });
    const aditivo = await registrarAditivo(db, actorOf(comercial), {
      idempotency_key: key(),
      contrato_id: "safra-2026",
      aditivo: { numero: 1, tipo: "prorrogacao", vigente_de: "2026-11-01", vigente_ate: "2027-10-31", documento: null },
    });
    assert.equal(aditivo.vigencia_alterada, true);
    const contrato = await doc("contracts/safra-2026");
    assert.deepEqual([contrato.vigente_de, contrato.vigente_ate], ["2026-11-01", "2027-10-31"]);
    const abrirEm = (competencia: string) =>
      saveMedicaoFor(db, comercial, { action: "create", request_id: key(), contrato_id: "safra-2026", competencia }, { agora: NOV_02 });
    assert.equal((await abrirEm("2026-10")).medicao_id, MEDICAO, "o mês da renovação");
    assert.equal((await abrirEm("2026-11")).status, "rascunho");
    await rejeita(abrirEm("2025-10"), "failed-precondition", /fora da vigência/);
  });

  it("owner, admin e comercial; os outros papéis, não", async () => {
    await rejeita(abrir("safra-2026", "2026-10", wms), "permission-denied");
    await rejeita(abrir("safra-2026", "2026-10", financeiro), "permission-denied");
    assert.equal((await abrir("safra-2026", "2026-10", admin)).status, "rascunho");
    assert.equal((await abrir("safra-2026", "2026-09", owner)).status, "rascunho");
  });
});

describe("linhas da medição", () => {
  it("cada linha pela tabela vigente na data da solicitação, com a troca de tabela carregada no meio da competência", async () => {
    await abrir();
    const primeira = await salvar({ os: "OS 9001", solicitada_em: "2026-10-01", executada_em: "2026-10-05" });
    assert.equal(primeira.total_cents, 118_000);
    // Pedida em 15/10, quando a v2 ainda não estava carregada: sai pela v1.
    const segunda = await salvar({ os: "OS 9002", solicitada_em: "2026-10-15", executada_em: "2026-10-16" });
    assert.equal(segunda.total_cents, 236_000);
    assert.equal(segunda.linhas_reprecificadas, 0);

    await carregarV2();
    // A próxima gravação precifica de novo todas as linhas: a de 15/10 passa à v2; a de 01/10 fica na v1.
    const terceira = await salvar({ os: "OS 9003", solicitada_em: "2026-10-16", executada_em: "2026-10-19", itens: [{ origem: "tabela", lpu_item_id: "lpu_truck", quantidade: "1" }] });
    assert.equal(terceira.linhas_reprecificadas, 1);
    const medicao = await doc(`medicoes/${MEDICAO}`);
    const porOs = new Map(linhasDe(medicao).map((row) => [row.os, row]));
    assert.equal(porOs.get("OS 9001")?.tabela_id, "pt_safra_v1");
    assert.deepEqual(itensDe(porOs.get("OS 9001")!).map((row) => [row.preco, row.total_cents]), [["280.00", 56_000], ["620.00", 62_000]]);
    assert.equal(porOs.get("OS 9002")?.tabela_id, "pt_safra_v2");
    assert.deepEqual(itensDe(porOs.get("OS 9002")!).map((row) => [row.preco, row.total_cents]), [["290.00", 58_000], ["640.00", 64_000]]);
    assert.equal(porOs.get("OS 9003")?.total_cents, 140_000);
    assert.equal(medicao.total_cents, 118_000 + 122_000 + 140_000);
    assert.equal(terceira.total_cents, medicao.total_cents);
    assert.deepEqual(linhasDe(medicao).map((row) => row.os), ["OS 9001", "OS 9002", "OS 9003"], "em ordem de execução");
    const evento = (await eventos()).find((event) => event.type === "medicao.line_saved" && (event.payload as Linha).linhas_reprecificadas === 1);
    assert.ok(evento, "o evento conta as linhas precificadas de novo");
    semDinheiroNemPessoa(await eventos());
  });

  it("o envio confere os preços: a tabela carregada depois da última gravação recusa o envio, sem mudar nada, até gravar de novo", async () => {
    await abrir();
    const salva = await salvar({ os: "OS 9002", solicitada_em: "2026-10-15", executada_em: "2026-10-16" });
    assert.equal(salva.total_cents, 118_000, "pela v1, a única carregada");
    await carregarV2();
    const antes = await doc(`medicoes/${MEDICAO}`);
    await rejeita(avancar("send"), "failed-precondition", /O preço de 1 linha mudou desde a última gravação/);
    const depois = await doc(`medicoes/${MEDICAO}`);
    assert.deepEqual([depois.status, depois.edicao, depois.total_cents], ["rascunho", antes.edicao, 118_000]);
    assert.deepEqual(depois.linhas, antes.linhas);
    // Gravada de novo (a mesma linha), a v2 vale; a pessoa vê o total novo e envia.
    const regravada = await salvar({ id: salva.linha_id, os: "OS 9002", solicitada_em: "2026-10-15", executada_em: "2026-10-16" });
    assert.equal(regravada.total_cents, 122_000);
    const enviada = await avancar("send");
    assert.deepEqual([enviada.status, enviada.total_cents], ["enviada", 122_000]);
    assert.equal((await doc(`medicoes/${MEDICAO}`)).total_cents, 122_000);
  });

  it("o preço que o app manda não vale: o servidor recalcula; sem tabela do contrato na data, só avulso; nunca a Padrão", async () => {
    await abrir();
    const salva = await salvar({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2", preco: "280.00" }] });
    assert.equal(salva.total_cents, 56_000);
    await rejeita(
      salvar({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2", preco: "10.00" }] }),
      "invalid-argument",
      /OS 9001, item 1: .*motivo/,
    );
    await rejeita(salvar({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: 2 }] }), "invalid-argument");
    await rejeita(salvar({ total_cents: 1 }), "invalid-argument");
    await rejeita(salvar({ executada_em: "2026-09-30", solicitada_em: "2026-09-29" }), "invalid-argument", /setembro\/2026/);
    await rejeita(salvar({ executada_em: "2026-10-21" }), "invalid-argument", /depois de hoje/);
    await rejeita(salvar({ area_solicitante: "lucia@safra.com" }), "invalid-argument", /só a área/);
    await rejeita(salvar({ area_solicitante: "Lúcia 11 98765-4321" }), "invalid-argument", /só a área/);
  });

  it("sábado na tarifa de dia útil é marcado com a tarifa de sábado apontada; avulso e pedido sem anexo também", async () => {
    await abrir();
    await salvar({ os: "OS 9004", solicitada_em: "2026-10-02", executada_em: "2026-10-03", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "3" }] });
    await rejeita(salvar({ os: "OS 9005", solicitada_em: "2026-10-02", executada_em: "2026-10-03", dia_tipo: "util" }), "invalid-argument", /é sábado/);
    await salvar({
      os: "OS 9006",
      solicitada_em: "2026-10-08",
      executada_em: "2026-10-12",
      dia_tipo: "domingo_feriado",
      anexo: null,
      itens: [
        { origem: "avulso", quantidade: "1", preco: "1904.00", motivo: "Rota intermunicipal fora da LPU", descricao: "Truck Sede → Arquivo Jundiaí" },
        { origem: "tabela", lpu_item_id: "lpu_aj_dom", quantidade: "4" },
      ],
    });
    const medicao = await doc(`medicoes/${MEDICAO}`);
    const [sabado, feriado] = linhasDe(medicao);
    assert.equal(sabado.dia_tipo, "sabado");
    assert.deepEqual(sabado.marcas, ["dia_nao_bate_tarifa"]);
    assert.deepEqual(
      itensDe(sabado).map((row) => [row.lpu_item_id, row.preco, row.dia_nao_bate, row.trocar_por]),
      [["lpu_aj_util", "280.00", true, "lpu_aj_sab"]],
      "marca e aponta, sem trocar o item",
    );
    assert.deepEqual(feriado.marcas, ["rota_fora_da_tabela", "sem_pedido_anexo"]);
    assert.deepEqual(medicao.marcas, { dia_nao_bate_tarifa: 1, rota_fora_da_tabela: 1, sem_pedido_anexo: 1 });
    const salvos = (await eventos()).filter((event) => event.type === "medicao.line_saved").map((event) => (event.payload as Linha).marcas);
    assert.deepEqual(salvos.map((marcas) => JSON.stringify(marcas)).sort(), ['["dia_nao_bate_tarifa"]', '["rota_fora_da_tabela","sem_pedido_anexo"]']);

    // "Aplicar sábado": a pessoa troca o item; a marca sai.
    const aplicada = await salvar({
      id: sabado.id,
      os: "OS 9004",
      solicitada_em: "2026-10-02",
      executada_em: "2026-10-03",
      itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_sab", quantidade: "3" }],
    });
    assert.equal(aplicada.linha_id, sabado.id);
    const depois = linhasDe(await doc(`medicoes/${MEDICAO}`));
    assert.equal(depois.length, 2);
    assert.deepEqual(depois[0].marcas, []);
    assert.equal(depois[0].total_cents, 109_200);
    semDinheiroNemPessoa(await eventos());
  });

  it("a edição vista é conferida; a linha que não existe é recusada; retirar a linha solta a demanda", async () => {
    const numero = await fechada();
    await abrir();
    const salva = await salvar({ demanda_numero: numero });
    assert.equal((await doc(`demands/${numero}`)).medicao_id, MEDICAO);
    await rejeita(
      saveMedicaoFor(db, comercial, { action: "upsert_line", request_id: key(), medicao_id: MEDICAO, expected_edicao: 1, linha: linha() }, { agora: OUT_20 }),
      "failed-precondition",
      /mudou desde que foi aberta/,
    );
    await rejeita(salvar({ id: "ml_nao_existe" }), "not-found");
    const retirada = await saveMedicaoFor(
      db,
      comercial,
      { action: "remove_line", request_id: key(), medicao_id: MEDICAO, expected_edicao: salva.edicao, linha_id: salva.linha_id },
      { agora: OUT_20 },
    );
    assert.deepEqual([retirada.linhas, retirada.total_cents, retirada.edicao], [0, 0, salva.edicao + 1]);
    assert.equal((await doc(`demands/${numero}`)).medicao_id, null);
    const evento = (await eventos()).find((event) => event.type === "medicao.line_removed");
    assert.deepEqual(evento?.payload, { medicao_id: MEDICAO, competencia: "2026-10", linha_id: salva.linha_id, edicao: salva.edicao + 1, demanda: numero });
  });

  it("a demanda entra só numa medição, do mesmo contrato", async () => {
    const numero = await fechada();
    const itau = await propostaEnviada("ITAU");
    await abrir();
    await abrir("safra-2026", "2026-09");
    await salvar({ demanda_numero: numero });
    await rejeita(
      salvar({ demanda_numero: numero, executada_em: "2026-09-29", solicitada_em: "2026-09-28" }, OUT_20, comercial, "safra-2026_2026-09"),
      "failed-precondition",
      /já está na medição safra-2026_2026-10/,
    );
    await rejeita(salvar({ demanda_numero: itau }), "failed-precondition", /outro cliente/);
    await rejeita(salvar({ demanda_numero: "99999" }), "not-found");
    // A mesma demanda em duas linhas da mesma medição (duas OS da mesma demanda).
    await salvar({ demanda_numero: numero, os: "OS 9001-B", executada_em: "2026-10-06" });
    assert.deepEqual((await doc(`medicoes/${MEDICAO}`)).demandas, [numero]);
  });
});

describe("demandas de outro regime ou de outro contrato", () => {
  it("no contrato misto, a demanda cobrada por demanda não entra na medição; a linha sem demanda entra", async () => {
    // O regime padrão é por demanda (pedido e aceite); só a equipe fixa é por medição mensal.
    await db.doc("contracts/safra-2026").update({
      regime_padrao: "por_demanda",
      regimes: [{ servico: "Equipe fixa", regime: "medicao_mensal" }],
      autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    });
    const porDemanda = await fechada();
    assert.equal((await doc(`demands/${porDemanda}`)).cobranca, "por_demanda");
    await abrir();
    await rejeita(salvar({ demanda_numero: porDemanda }), "failed-precondition", /cobrada por demanda, com a autorização do contrato/);
    assert.equal((await doc(`demands/${porDemanda}`)).medicao_id, undefined);
    assert.equal((await salvar({ os: "OS 9030" })).linhas, 1);
  });

  it("a demanda presa à medição não troca de contrato; a que mudou por fora fica pendente na aprovação, sem ser tocada", async () => {
    await db.doc("contracts/safra-eventos").set({
      id: "safra-eventos",
      customer_code: "SAFRA",
      regime_padrao: "por_demanda",
      regimes: [],
      autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
      vigente_de: "2026-01-01",
      vigente_ate: null,
      status: "vigente",
      edicao: 1,
    });
    // Em montagem, presa à medição: o rascunho do orçamento ainda se edita, mas o contrato não troca.
    const { numero: montagem } = await saveQuoteFor(
      db,
      comercial,
      {
        action: "create",
        request_id: key(),
        customer_code: "SAFRA",
        contrato_id: "safra-2026",
        contato_id: "ct_safra",
        canal: "email",
        tipo: "planejada",
        titulo: "Transporte de arquivo",
        recebida_em: "2026-09-30T09:42:00-03:00",
        linhas: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2" }],
      },
      { agora: OUT_01 },
    );
    // Validada pelo orçamento, a faturar com a medição pendente.
    const validada = await fechada();
    await demanda("register_execution", validada, { executado_de: "2026-10-05", executado_ate: "2026-10-05" }, OUT_06);
    await demanda("validate", validada, {}, OUT_06);
    await abrir();
    await salvar({ demanda_numero: montagem, os: "OS 9040" });
    await salvar({ demanda_numero: validada, os: "OS 9041" });

    const quote = await doc(`quotes/${montagem}`);
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero: montagem, expected_edicao: quote.edicao, contrato_id: "safra-eventos" }, { agora: OUT_20 }),
      "failed-precondition",
      /está na medição safra-2026_2026-10: retire a linha dela da medição antes de trocar o contrato/,
    );
    assert.equal((await doc(`demands/${montagem}`)).contrato_id, "safra-2026");

    // Por fora (dado antigo ou escrita fora das callables): a validada passou a outro contrato, por demanda.
    await db.doc(`demands/${validada}`).update({ contrato_id: "safra-eventos", cobranca: "por_demanda" });
    const antes = await doc(`demands/${validada}`);
    await avancar("send", {}, NOV_02);
    const aprovada = await avancar("approve");
    assert.deepEqual(aprovada.demandas_a_faturar, []);
    const porNumero = (a: { numero: string }, b: { numero: string }) => a.numero.localeCompare(b.numero);
    assert.deepEqual(
      [...(aprovada.demandas_pendentes ?? [])].sort(porNumero),
      [
        { numero: montagem, motivo: "RV em montagem, sem envio ao cliente" },
        { numero: validada, motivo: "demanda de outro contrato" },
      ].sort(porNumero),
    );
    const depois = await doc(`demands/${validada}`);
    assert.deepEqual(
      [depois.etapa, depois.medicao_pendente, depois.autorizacao_ids, depois.validacao],
      [antes.etapa, antes.medicao_pendente, undefined, antes.validacao],
      "a demanda de outro contrato não é autorizada pela medição",
    );
    assert.deepEqual((await doc(`client_authorizations/aut_${MEDICAO}`)).demanda_numeros, []);
  });
});

describe("enviar, contestar, reabrir e aprovar", () => {
  it("a situação e a edição vistas são conferidas a cada passo; a contestada volta ao rascunho", async () => {
    await abrir();
    await rejeita(avancar("send"), "failed-precondition", /sem linhas/);
    await salvar({});
    await rejeita(avancar("approve"), "failed-precondition", /em rascunho/);
    await rejeita(avancar("reopen"), "failed-precondition", /em rascunho/);

    const antes = await doc(`medicoes/${MEDICAO}`);
    const enviada = await avancar("send");
    assert.deepEqual([enviada.status, enviada.edicao, enviada.ja_feito], ["enviada", Number(antes.edicao) + 1, false]);
    assert.equal((await doc(`medicoes/${MEDICAO}`)).enviada_em, "2026-11-03T15:00:00.000Z");
    // O mesmo envio de novo, com o que a tela tinha visto: já feito, sem gravar.
    const repetido = await advanceMedicaoFor(
      db,
      comercial,
      { action: "send", request_id: key(), medicao_id: MEDICAO, expected_status: "rascunho", expected_edicao: antes.edicao },
      { agora: NOV_03 },
    );
    assert.deepEqual([repetido.ja_feito, repetido.status, repetido.events], [true, "enviada", []]);
    // Enviada, a linha não muda.
    await rejeita(salvar({ os: "OS 9010" }), "failed-precondition", /só o rascunho/);
    await rejeita(
      advanceMedicaoFor(db, comercial, { action: "approve", request_id: key(), medicao_id: MEDICAO, expected_status: "enviada", expected_edicao: 1 }, { agora: NOV_03 }),
      "failed-precondition",
      /mudou/,
    );

    await rejeita(avancar("contest", {}), "invalid-argument");
    const contestada = await avancar("contest", { nota: "O cliente não reconhece a OS 9001 e pede a tarifa cobrada no sábado." });
    assert.equal(contestada.status, "contestada");
    const comNota = await doc(`medicoes/${MEDICAO}`);
    assert.match(String((comNota.contestacao as Linha).nota), /não reconhece/);
    await rejeita(avancar("approve"), "failed-precondition", /contestada/);
    await rejeita(salvar({ os: "OS 9010" }), "failed-precondition", /reabra/);

    const reaberta = await avancar("reopen");
    assert.equal(reaberta.status, "rascunho");
    const rascunho = await doc(`medicoes/${MEDICAO}`);
    assert.equal(rascunho.contestacao, null);
    assert.equal((rascunho.contestacoes_anteriores as Linha[]).length, 1);
    await salvar({ os: "OS 9010", executada_em: "2026-10-07" });
    assert.equal((await avancar("send")).status, "enviada");
    assert.deepEqual(
      ((await doc(`medicoes/${MEDICAO}`)).marcos as Linha[]).map((marco) => marco.status),
      ["rascunho", "enviada", "contestada", "rascunho", "enviada"],
    );
    const tipos = (await eventos()).map((event) => event.type);
    for (const tipo of ["medicao.sent", "medicao.contested", "medicao.reopened"]) assert.ok(tipos.includes(tipo), tipo);
    semDinheiroNemPessoa(await eventos());
  });

  it("aprovar cria a autorização medicao_aprovada ligada às demandas e leva a a faturar as que o cliente fechou", async () => {
    // D1: validada pelo orçamento, a faturar com a medição pendente.
    const d1 = await fechada();
    await demanda("register_execution", d1, { executado_de: "2026-10-05", executado_ate: "2026-10-05" }, OUT_06);
    await demanda("validate", d1, {}, OUT_06);
    assert.equal((await doc(`demands/${d1}`)).medicao_pendente, true);
    // D2: fechada e executada, sem RV de execução.
    const d2 = await fechada();
    await demanda("register_execution", d2, { executado_de: "2026-10-16", executado_ate: "2026-10-16" }, OUT_17);
    assert.equal((await doc(`demands/${d2}`)).etapa, "execucao_a_orcar");
    // D3: fechada, sem a execução registrada (a medição registra).
    const d3 = await fechada();
    // D4: proposta enviada, sem fechamento.
    const d4 = await propostaEnviada();

    await abrir();
    await salvar({ demanda_numero: d1, os: "OS 9001", solicitada_em: "2026-10-01", executada_em: "2026-10-05" });
    await salvar({ demanda_numero: d2, os: "OS 9002", solicitada_em: "2026-10-15", executada_em: "2026-10-16" });
    await salvar({ demanda_numero: d3, os: "OS 9003", solicitada_em: "2026-10-02", executada_em: "2026-10-03", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_sab", quantidade: "3" }] });
    await salvar({ demanda_numero: d4, os: "OS 9004", solicitada_em: "2026-10-06", executada_em: "2026-10-07" });
    await salvar({ os: "OS 9005", solicitada_em: "2026-10-08", executada_em: "2026-10-09", anexo: null });
    await avancar("send", {}, NOV_02);
    const enviada = await doc(`medicoes/${MEDICAO}`);

    await rejeita(avancar("approve", { em: "2026-10-30T10:00:00-03:00" }), "invalid-argument", /antes do envio/);
    await rejeita(avancar("approve", { em: "2026-11-10T10:00:00-03:00" }), "invalid-argument", /depois de agora/);
    await rejeita(avancar("approve", { contato_id: "ct_renata" }), "failed-precondition", /outro cliente/);
    const aprovada = await avancar("approve", {
      em: "2026-11-03T10:30:00-03:00",
      contato_id: "ct_safra",
      link: "https://outlook.office.com/mail/id/aprovacao-medicao",
    });
    const autorizacaoId = `aut_${MEDICAO}`;
    assert.equal(aprovada.status, "aprovada");
    assert.equal(aprovada.autorizacao_id, autorizacaoId);
    assert.deepEqual(aprovada.demandas_a_faturar, [d1, d2, d3].sort());
    assert.deepEqual(aprovada.demandas_pendentes, [{ numero: d4, motivo: "proposta sem fechamento" }]);

    const autorizacao = await doc(`client_authorizations/${autorizacaoId}`);
    assert.equal(autorizacao.tipo, "medicao_aprovada");
    assert.equal(autorizacao.customer_code, "SAFRA");
    assert.equal(autorizacao.contrato_id, "safra-2026");
    assert.equal(autorizacao.medicao_id, MEDICAO);
    // O mesmo formato da autorização registrada à mão: situação registrada, valor_cents, demanda_numeros.
    assert.equal(autorizacao.status, "registrada");
    assert.equal(autorizacao.origem, "medicao");
    assert.deepEqual(autorizacao.demanda_numeros, [d1, d2, d3].sort());
    assert.deepEqual(autorizacao.demandas, []);
    assert.deepEqual(autorizacao.demandas_pendentes, [{ numero: d4, motivo: "proposta sem fechamento" }]);
    assert.equal(autorizacao.valor_cents, enviada.total_cents);
    assert.equal(autorizacao.total_cents, undefined);
    assert.deepEqual([autorizacao.pedido, autorizacao.aceite, autorizacao.marcas, autorizacao.nf_ids], [null, null, [], []]);
    assert.equal(autorizacao.registrada_por, comercial.uid);
    assert.equal(autorizacao.email_link, "https://outlook.office.com/mail/id/aprovacao-medicao");
    assert.equal(autorizacao.recebida_em, "2026-11-03T13:30:00.000Z");
    assert.equal(autorizacao.contato_id, "ct_safra");

    const medicao = await doc(`medicoes/${MEDICAO}`);
    assert.equal(medicao.status, "aprovada");
    assert.equal(medicao.aprovada_em, "2026-11-03T13:30:00.000Z");
    assert.equal(medicao.autorizacao_id, autorizacaoId);
    assert.equal((medicao.aprovacao as Linha).link, "https://outlook.office.com/mail/id/aprovacao-medicao");

    const [dem1, dem2, dem3, dem4] = await Promise.all([d1, d2, d3, d4].map((numero) => doc(`demands/${numero}`)));
    for (const dem of [dem1, dem2, dem3]) {
      assert.equal(dem.etapa, "a_faturar");
      assert.equal(dem.medicao_pendente, false);
      assert.deepEqual(dem.autorizacao_ids, [autorizacaoId]);
      assert.equal(dem.autorizacao_id, undefined);
      assert.equal(dem.medicao_id, MEDICAO);
    }
    assert.equal((dem2.validacao as Linha).origem, "medicao");
    assert.equal((dem2.validacao as Linha).autorizacao, "medicao_aprovada");
    assert.deepEqual([dem3.executado_de, dem3.executado_ate], ["2026-10-03", "2026-10-03"]);
    assert.equal(dem4.etapa, "aguardando_cliente", "a proposta sem fechamento fica como está");
    assert.equal(dem4.autorizacao_ids, undefined);

    const todos = await eventos();
    const tipos = todos.map((event) => event.type);
    assert.ok(tipos.includes("medicao.approved"));
    assert.ok(tipos.includes("client_authorization.recorded"));
    const aprovado = todos.find((event) => event.type === "medicao.approved");
    assert.deepEqual(
      { ...(aprovado?.payload as Linha), segundos_desde_anterior: "x" },
      {
        medicao_id: MEDICAO,
        competencia: "2026-10",
        edicao: Number(enviada.edicao) + 1,
        autorizacao_id: autorizacaoId,
        demandas: 4,
        demandas_a_faturar: 3,
        demandas_pendentes: 1,
        segundos_desde_anterior: "x",
      },
    );
    const registrada = todos.find((event) => event.type === "client_authorization.recorded");
    assert.equal(registrada?.entity_type, "client_authorization");
    assert.deepEqual(registrada?.payload, {
      autorizacao_id: autorizacaoId,
      tipo: "medicao_aprovada",
      contrato_id: "safra-2026",
      demandas: [d1, d2, d3].sort(),
      a_faturar: [d1, d2, d3].sort(),
      marcas: [],
      medicao_id: MEDICAO,
    });
    const etapas = todos.filter((event) => event.type === "demand.stage_changed" && (event.payload as Linha).etapa_depois === "a_faturar");
    assert.deepEqual(
      etapas.filter((event) => [d2, d3].includes(String(event.entity_id))).map((event) => [event.entity_id, (event.payload as Linha).etapa_antes]).sort(),
      [
        [d2, "execucao_a_orcar"],
        [d3, "para_planejar"],
      ].sort(),
    );
    assert.ok(todos.some((event) => event.type === "demand.execution_registered" && event.entity_id === d3));
    semDinheiroNemPessoa(todos.filter((event) => String(event.type).startsWith("medicao.") || event.type === "client_authorization.recorded"));

    // Aprovada, a medição não anda mais.
    for (const action of ["send", "contest", "reopen"]) await rejeita(avancar(action, action === "contest" ? { nota: "x" } : {}), "failed-precondition");
    await rejeita(salvar({ os: "OS 9020" }), "failed-precondition", /só o rascunho/);

    // A pendente não fica sem saída: fechada, executada e validada depois, vai a "a faturar" com a autorização
    // da medição (a linha dela já foi aprovada), sem a pendência, e sai das pendentes.
    assert.equal(dem4.medicao_id, MEDICAO);
    await demanda("close", d4, {}, NOV_03);
    await demanda("register_execution", d4, { executado_de: "2026-10-07", executado_ate: "2026-10-07" }, NOV_03);
    const validada = await demanda("validate", d4, {}, NOV_03);
    assert.equal(validada.etapa, "a_faturar");
    const d4Depois = await doc(`demands/${d4}`);
    assert.deepEqual(
      [d4Depois.etapa, d4Depois.medicao_pendente, d4Depois.autorizacao_ids, (d4Depois.validacao as Linha).autorizacao_id],
      ["a_faturar", false, [autorizacaoId], autorizacaoId],
    );
    const medicaoDepois = await doc(`medicoes/${MEDICAO}`);
    assert.deepEqual(medicaoDepois.demandas_pendentes, []);
    assert.deepEqual([...(medicaoDepois.demandas_a_faturar as string[])].sort(), [d1, d2, d3, d4].sort());
    assert.equal(medicaoDepois.edicao, Number(medicao.edicao) + 1);
    const autorizacaoDepois = await doc(`client_authorizations/${autorizacaoId}`);
    assert.deepEqual([...(autorizacaoDepois.demanda_numeros as string[])].sort(), [d1, d2, d3, d4].sort());
    assert.deepEqual(autorizacaoDepois.demandas, []);
    assert.deepEqual(autorizacaoDepois.demandas_pendentes, []);
    const validacao = (await eventos()).find((event) => event.type === "quote.validated" && event.entity_id === d4);
    assert.deepEqual(
      [(validacao?.payload as Linha).medicao_pendente, (validacao?.payload as Linha).autorizacao_id],
      [false, autorizacaoId],
    );
  });

  it("a medição sem demanda também cria a autorização, sem demanda ligada", async () => {
    await abrir();
    await salvar({});
    await avancar("send");
    const aprovada = await avancar("approve");
    assert.deepEqual([aprovada.demandas_a_faturar, aprovada.demandas_pendentes], [[], []]);
    assert.deepEqual((await doc(`client_authorizations/aut_${MEDICAO}`)).demanda_numeros, []);
  });
});

describe("cancelar a autorização da medição aprovada (o mesmo recordAuthorization da autorização registrada à mão)", () => {
  async function cancelar(id: string, extra: Record<string, unknown> = {}, caller: ComercialProfile = comercial) {
    return recordAuthorizationFor(
      db,
      caller,
      { action: "cancel", request_id: key(), autorizacao_id: id, motivo: "Aprovada por engano", ...extra },
      { agora: NOV_03 },
    );
  }

  it("devolve as demandas à espera da medição e cancela; de novo só devolve o estado", async () => {
    const d1 = await fechada();
    await demanda("register_execution", d1, { executado_de: "2026-10-05", executado_ate: "2026-10-05" }, OUT_06);
    await demanda("validate", d1, {}, OUT_06);
    const d2 = await fechada();
    await demanda("register_execution", d2, { executado_de: "2026-10-16", executado_ate: "2026-10-16" }, OUT_17);
    await abrir();
    await salvar({ demanda_numero: d1, os: "OS 9001", solicitada_em: "2026-10-01", executada_em: "2026-10-05" });
    await salvar({ demanda_numero: d2, os: "OS 9002", solicitada_em: "2026-10-15", executada_em: "2026-10-16" });
    await avancar("send", {}, NOV_02);
    await avancar("approve");
    const id = `aut_${MEDICAO}`;
    assert.deepEqual((await doc(`demands/${d1}`)).autorizacao_ids, [id]);

    const cancelada = await cancelar(id);
    assert.deepEqual([cancelada.status, cancelada.ja_feito, cancelada.customer_code], ["cancelada", false, "SAFRA"]);
    assert.deepEqual(cancelada.demandas.map((item) => item.numero).sort(), [d1, d2].sort());
    const autorizacao = await doc(`client_authorizations/${id}`);
    assert.deepEqual([autorizacao.status, autorizacao.cancelada_por, autorizacao.motivo_cancelamento], ["cancelada", comercial.uid, "Aprovada por engano"]);
    for (const numero of [d1, d2]) {
      const dem = await doc(`demands/${numero}`);
      assert.deepEqual([dem.autorizacao_ids, dem.medicao_pendente], [[], true], numero);
      assert.equal(dem.autorizacao_id, undefined);
    }
    const evento = (await eventos()).find((event) => event.type === "client_authorization.cancelled");
    assert.deepEqual(evento?.payload, {
      autorizacao_id: id,
      tipo: "medicao_aprovada",
      contrato_id: "safra-2026",
      demandas: [d1, d2].sort(),
      devolvidas: [d1, d2].sort(),
      marcas: [],
      medicao_id: MEDICAO,
    });

    const repetida = await cancelar(id);
    assert.deepEqual([repetida.status, repetida.ja_feito, repetida.events], ["cancelada", true, []]);
  });

  it("a medição sem demanda também se cancela, e o financeiro cancela como cancela a de pedido e aceite", async () => {
    await abrir();
    await salvar({});
    await avancar("send");
    await avancar("approve");
    const id = `aut_${MEDICAO}`;
    const cancelada = await cancelar(id, {}, financeiro);
    assert.deepEqual([cancelada.status, cancelada.demandas], ["cancelada", []]);
    assert.equal((await doc(`client_authorizations/${id}`)).status, "cancelada");
  });

  it("lê a autorização no formato antigo da medição (status a_faturar, demandas como números, autorizacao_id na demanda)", async () => {
    const d1 = await fechada();
    await demanda("register_execution", d1, { executado_de: "2026-10-05", executado_ate: "2026-10-05" }, OUT_06);
    await demanda("validate", d1, {}, OUT_06);
    const id = "aut_antiga";
    await db.doc(`client_authorizations/${id}`).set({
      id,
      tipo: "medicao_aprovada",
      origem: "medicao",
      status: "a_faturar",
      customer_code: "SAFRA",
      contrato_id: "safra-2026",
      medicao_id: MEDICAO,
      demandas: [d1],
      demandas_a_faturar: [d1],
      demandas_pendentes: [],
      total_cents: 118_000,
      recebida_em: "2026-11-03T13:30:00.000Z",
    });
    await db.doc(`demands/${d1}`).update({ autorizacao_id: id, medicao_pendente: false });

    const cancelada = await cancelar(id);
    assert.deepEqual([cancelada.status, cancelada.valor_cents, cancelada.demandas.map((item) => item.numero)], ["cancelada", 118_000, [d1]]);
    const dem = await doc(`demands/${d1}`);
    assert.deepEqual([dem.autorizacao_ids, dem.autorizacao_id, dem.medicao_pendente], [[], undefined, true]);
    assert.equal((await doc(`client_authorizations/${id}`)).status, "cancelada");
  });
});
