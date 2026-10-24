import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { advanceDemandFor } from "./demandas.js";
import type { ComercialProfile } from "./profile.js";
import { advanceQuoteFor, saveQuoteFor } from "./quotes.js";

/**
 * Envio, fechamento, perda, revisão e orçamento da execução no emulador
 * (parte 10): a RV enviada nunca muda e mudar depois é a RV seguinte, com as
 * mesmas linhas, data-base e tabela; o fechamento grava o escopo sem preço e
 * converte o prospect; perda e reabertura; execução e validação até a
 * autorização; a aprovação dispensada na RV de execução; a demanda direta; e
 * o caso real do Itaú de ponta a ponta. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-comercial";

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner", name: "Leonardo", email: "leonardo@dutelog.com.br" };
const admin: ComercialProfile = { uid: "admin-1", role: "admin", name: "Admin" };
const wms: ComercialProfile = { uid: "wms-1", role: "wms", name: "Operador" };

/** 20/06/2026, meio-dia em São Paulo: a v1 da LPU do Itaú vale. */
const JUNHO = () => new Date("2026-06-20T15:00:00.000Z");
/** 22/06/2026: o cliente responde. */
const JUNHO_22 = () => new Date("2026-06-22T15:00:00.000Z");
/** 15/07/2026: o serviço (24 e 25/06) já foi executado; a v2 da LPU entra em 30/06. */
const JULHO = () => new Date("2026-07-15T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let chave = 0;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-demandas-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function precos(mesa: string, cadeira: string) {
  return {
    lpu_mesa: { codigo: "DTL-0001-T", descricao_cliente: "Transporte de mesa", preco: mesa },
    lpu_cadeira: { codigo: "DTL-0002-T", descricao_cliente: "Transporte de cadeira", preco: cadeira },
  };
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("users/owner-1", { role: "owner", nome: "Leonardo" });
  set("users/admin-1", { role: "admin", nome: "Admin" });
  set("users/com-1", { role: "comercial", nome: "Guilherme" });

  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", stage: "cliente", status: "active" });
  set("customers/PROSP", {
    code: "PROSP",
    customer_code: "PROSP",
    name: "Prospect Novo",
    stage: "prospect",
    status: "active",
    portal_status: "inactive",
    archived: false,
  });
  set("customers/SAFRA", { code: "SAFRA", customer_code: "SAFRA", name: "Safra", stage: "cliente", status: "active" });

  // O Itaú autoriza o faturamento depois da execução (pedido e aceite); o Safra fatura por medição mensal.
  set("contracts/itau-2026", {
    id: "itau-2026",
    customer_code: "ITAU",
    regime_padrao: "por_demanda",
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    status: "vigente",
    edicao: 1,
  });
  set("contracts/safra-2026", {
    id: "safra-2026",
    customer_code: "SAFRA",
    regime_padrao: "medicao_mensal",
    autorizacao: { tipo: "medicao_aprovada", prazo_perda_dias: null },
    status: "vigente",
    edicao: 1,
  });

  set("customer_contacts/ct_renata", { id: "ct_renata", customer_code: "ITAU", nome: "Renata", empresa: "Souza & Lopes", ativo: true });
  set("customer_contacts/ct_prosp", { id: "ct_prosp", customer_code: "PROSP", nome: "Rodrigo", empresa: null, ativo: true });
  set("customer_contacts/ct_safra", { id: "ct_safra", customer_code: "SAFRA", nome: "Lúcia", empresa: null, ativo: true });
  set("customer_locations/loc_ceic", { id: "loc_ceic", customer_code: "ITAU", nome: "CEIC", ativo: true });
  set("customer_locations/loc_cat", { id: "loc_cat", customer_code: "ITAU", nome: "CAT", ativo: true });

  const item = (id: string, nome: string, extra: Record<string, unknown> = {}) =>
    set(`lpu_items/${id}`, { id, item: nome, descricao: nome, servico: "Transporte", unidade: "UN", orcavel: true, ativo: true, ...extra });
  item("lpu_mesa", "Mesa de escritório");
  item("lpu_cadeira", "Cadeira giratória");
  item("lpu_cofre", "Cofre", { servico: "Içamento", unidade: "VB" });

  set("price_tables/pt_itau_v1", {
    id: "pt_itau_v1",
    nome: "LPU Itaú v1",
    customer_code: "ITAU",
    contract_id: "itau-2026",
    variante: "Comercial",
    vigente_de: "2025-07-01",
    vigente_ate: null,
    status: "ativa",
    condicoes: "Condições da LPU do Itaú.",
    validade_dias: null,
    precos: precos("40.00", "18.50"),
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
    condicoes: "Visita técnica inclusa.",
    validade_dias: 60,
    precos: precos("50.00", "20.00"),
  });
  await batch.commit();
});

/** A carga da v2 (30/06/2026): encerra a v1 na véspera, como cargas/tabela.ts. */
async function carregarV2() {
  await db.doc("price_tables/pt_itau_v1").update({ status: "encerrada", vigente_ate: "2026-06-29", encerrada_por: "pt_itau_v2" });
  await db.doc("price_tables/pt_itau_v2").set({
    id: "pt_itau_v2",
    nome: "LPU Itaú v2.0",
    customer_code: "ITAU",
    contract_id: "itau-2026",
    variante: "Comercial",
    vigente_de: "2026-06-30",
    vigente_ate: null,
    status: "ativa",
    substitui: "pt_itau_v1",
    precos: precos("45.50", "21.00"),
  });
}

function key(): string {
  chave += 1;
  return `req-${chave}`;
}

const CLIENTES: Record<string, { contrato_id: string | null; contato_id: string }> = {
  ITAU: { contrato_id: "itau-2026", contato_id: "ct_renata" },
  PROSP: { contrato_id: null, contato_id: "ct_prosp" },
  SAFRA: { contrato_id: "safra-2026", contato_id: "ct_safra" },
};

function proposta(customer: keyof typeof CLIENTES = "ITAU", overrides: Record<string, unknown> = {}) {
  return {
    action: "create",
    request_id: key(),
    customer_code: customer,
    ...CLIENTES[customer],
    canal: "email",
    tipo: "planejada",
    titulo: "Mudança de layout · 12º andar",
    ref_cliente: "CE8977",
    recebida_em: "2026-06-19T09:42:00-03:00",
    linhas: [
      { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "24" },
      { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
    ],
    ...overrides,
  };
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

async function count(path: string): Promise<number> {
  return (await db.collection(path).get()).size;
}

async function eventos(numero?: string): Promise<Array<Record<string, unknown>>> {
  const todos = (await db.collection("events").get()).docs.map((row) => row.data());
  return numero ? todos.filter((event) => event.entity_id === numero || (event.payload as Record<string, unknown>)?.numero === numero) : todos;
}

type Linha = Record<string, unknown>;

function linhasDe(quote: Record<string, unknown>): Linha[] {
  return quote.linhas as Linha[];
}

/** Ação no orçamento, com a situação e a edição que estão gravadas (o que a tela veria). */
async function orcamento(caller: ComercialProfile, action: string, numero: string, extra: Record<string, unknown> = {}, agora = JUNHO) {
  const quote = await doc(`quotes/${numero}`);
  return advanceQuoteFor(
    db,
    caller,
    { action, request_id: key(), numero, expected_status: quote.status, expected_edicao: quote.edicao, ...extra },
    { agora },
  );
}

/** Ação na demanda, com a etapa e a RV que estão gravadas. */
async function demanda(caller: ComercialProfile, action: string, numero: string, extra: Record<string, unknown> = {}, agora = JUNHO_22) {
  const [dem, quote] = await Promise.all([doc(`demands/${numero}`), doc(`quotes/${numero}`)]);
  return advanceDemandFor(
    db,
    caller,
    { action, request_id: key(), numero, expected_etapa: dem.etapa, expected_rv: quote.rv, ...extra },
    { agora },
  );
}

async function editar(numero: string, campos: Record<string, unknown>, agora = JUNHO) {
  const quote = await doc(`quotes/${numero}`);
  return saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: quote.edicao, ...campos }, { agora });
}

/** Monta, aprova (owner) e envia (comercial) uma proposta: aguardando o cliente. */
async function propostaEnviada(customer: keyof typeof CLIENTES = "ITAU", overrides: Record<string, unknown> = {}): Promise<string> {
  const { numero } = await saveQuoteFor(db, comercial, proposta(customer, overrides), { agora: JUNHO });
  await orcamento(comercial, "submit", numero);
  await orcamento(owner, "approve", numero);
  await orcamento(comercial, "send", numero);
  return numero;
}

/** Proposta enviada, fechada pelo cliente e executada em 24 e 25/06. */
async function demandaExecutada(customer: keyof typeof CLIENTES = "ITAU", overrides: Record<string, unknown> = {}): Promise<string> {
  const numero = await propostaEnviada(customer, overrides);
  await demanda(comercial, "close", numero);
  await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
  return numero;
}

const DINHEIRO = /valor|preco|preço|price|total|cents|centavo|amount|desconto|subtotal/i;

/**
 * Evento sem dinheiro nem pessoa: nenhuma chave de dinheiro, nenhum valor
 * com casas, nome, empresa, referência ou e-mail. Códigos de lista como o
 * motivo "preco" e a marca "preco_alterado" são códigos, não valores.
 */
function semDinheiroNemPessoa(events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    assert.deepEqual(chavesDeDinheiro(event.payload), [], String(event.type));
    assert.doesNotMatch(JSON.stringify(event.payload), /\d[.,]\d|Renata|Rodrigo|Lúcia|Souza|CE8977|Itaú|Prospect Novo|@/, String(event.type));
    assert.doesNotMatch(`${event.title} ${event.description}`, /R\$|\d[.,]\d|Renata|Rodrigo|Itaú|Prospect Novo/, String(event.type));
  }
}

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

describe("enviar ao cliente e revisar (RV+1)", () => {
  it("enviar congela revisoes/0 de vez; mudar depois do envio abre a RV seguinte com as mesmas linhas e ids", async () => {
    const { numero } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await orcamento(comercial, "submit", numero);
    await orcamento(owner, "approve", numero);
    assert.equal((await doc(`quotes/${numero}/revisoes/0`)).enviado_em, null);

    const enviado = await orcamento(comercial, "send", numero);
    assert.deepEqual([enviado.status, enviado.etapa, enviado.rv, enviado.edicao], ["enviado", "aguardando_cliente", 0, 1]);
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual({ ...(quote.envio as Record<string, unknown>), em: "x" }, { por_uid: "com-1", em: "x", edicao: 1 });
    const congelada = await doc(`quotes/${numero}/revisoes/0`);
    assert.equal(congelada.enviado_por, "com-1");
    assert.equal(congelada.enviado_em, "2026-06-20T15:00:00.000Z");
    assert.deepEqual(congelada.aprovacao, quote.aprovacao);
    assert.equal(congelada.resposta_cliente, null);
    assert.equal((await doc(`demands/${numero}`)).etapa, "aguardando_cliente");
    const sent = (await eventos(numero)).find((event) => event.type === "quote.sent");
    assert.deepEqual(
      [(sent?.payload as Linha).etapa_antes, (sent?.payload as Linha).etapa_depois, (sent?.payload as Linha).status_depois],
      ["para_enviar", "aguardando_cliente", "enviado"],
    );

    // Enviada, a RV não muda: nem salvar, nem editar, nem aprovar de novo.
    await rejeita(editar(numero, { titulo: "Outro" }), "failed-precondition", /enviado/);
    await rejeita(orcamento(comercial, "edit", numero), "failed-precondition");
    await rejeita(orcamento(owner, "approve", numero), "failed-precondition");
    await rejeita(orcamento(comercial, "revise", numero), "invalid-argument", /motivo/);
    await rejeita(orcamento(comercial, "send", numero, { motivo: "correcao" }), "invalid-argument", /motivo/);
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), congelada);

    // O cliente pede mudança: RV01 em rascunho, com as mesmas linhas, ids, data-base e tabela.
    const revisada = await orcamento(comercial, "revise", numero, { motivo: "pedido_cliente" }, JULHO);
    assert.deepEqual([revisada.rv, revisada.rotulo, revisada.status, revisada.etapa, revisada.edicao], [1, `${numero} – RV01`, "rascunho", "em_montagem", 2]);
    const rv1 = await doc(`quotes/${numero}`);
    assert.equal(rv1.rv, 1);
    assert.equal(rv1.tipo_rv, "proposta");
    assert.equal(rv1.rotulo, `${numero} – RV01`);
    assert.deepEqual(rv1.linhas, quote.linhas);
    assert.equal(rv1.data_base, "2026-06-20");
    assert.deepEqual(rv1.tabela, quote.tabela);
    assert.equal(rv1.total_cents, quote.total_cents);
    assert.deepEqual([rv1.aprovacao, rv1.envio, rv1.aprovacao_dispensada], [null, null, null]);
    assert.deepEqual(rv1.revisao_de, { rv: 0, edicao: 1, motivo: "pedido_cliente" });
    const revisedEvent = (await eventos(numero)).find((event) => event.type === "quote.revised");
    assert.deepEqual(revisedEvent?.payload, {
      numero,
      rv: 1,
      rv_anterior: 0,
      tipo_rv: "proposta",
      motivo: "pedido_cliente",
      edicao: 2,
      etapa_antes: "aguardando_cliente",
      etapa_depois: "em_montagem",
    });

    // Outro toque com outra chave: já está feito, devolve o estado.
    const repetido = await advanceQuoteFor(
      db,
      comercial,
      { action: "revise", request_id: key(), numero, expected_status: "enviado", expected_edicao: 1, motivo: "pedido_cliente" },
      { agora: JULHO },
    );
    assert.deepEqual([repetido.ja_feito, repetido.rv], [true, 1]);

    // A RV01 se edita: a linha que fica mantém o id; a nova ganha outro. A tela velha (edição 1) não grava.
    const [mesa] = linhasDe(rv1);
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 1, titulo: "Atropelo" }, { agora: JULHO }),
      "failed-precondition",
      /edição/,
    );
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "30" },
          { origem: "avulso", quantidade: "1", preco: "300.00", motivo: "Fora da LPU", descricao: "Içamento de cofre" },
        ],
      },
      JULHO,
    );
    const editada = await doc(`quotes/${numero}`);
    assert.equal(linhasDe(editada)[0].id, mesa.id);
    assert.ok(!linhasDe(quote).some((linha) => linha.id === linhasDe(editada)[1].id));
    // Data-base e preço continuam os da RV 0, mesmo editando em julho.
    assert.equal(editada.data_base, "2026-06-20");
    assert.equal(linhasDe(editada)[0].preco, "40.00");
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), congelada);

    await orcamento(comercial, "submit", numero, {}, JULHO);
    await orcamento(owner, "approve", numero, {}, JULHO);
    await orcamento(comercial, "send", numero, {}, JULHO);
    const congelada1 = await doc(`quotes/${numero}/revisoes/1`);
    assert.equal(congelada1.rv, 1);
    assert.equal(congelada1.rotulo, `${numero} – RV01`);
    assert.equal(congelada1.enviado_por, "com-1");
    assert.deepEqual(congelada1.revisao_de, { rv: 0, edicao: 1, motivo: "pedido_cliente" });
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), congelada);
    assert.equal(await count(`quotes/${numero}/revisoes`), 2);
    semDinheiroNemPessoa(await eventos(numero));
  });

  it("aprovar e enviar: só o owner, do para aprovar, numa transação", async () => {
    const { numero } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await rejeita(orcamento(owner, "approve_and_send", numero), "failed-precondition");
    await orcamento(comercial, "submit", numero);
    await rejeita(orcamento(comercial, "approve_and_send", numero), "permission-denied");
    await rejeita(orcamento(admin, "approve_and_send", numero), "permission-denied");
    await rejeita(orcamento(wms, "approve_and_send", numero), "permission-denied");
    assert.equal((await doc(`quotes/${numero}`)).status, "para_aprovar");

    const resultado = await orcamento(owner, "approve_and_send", numero);
    assert.deepEqual([resultado.status, resultado.etapa], ["enviado", "aguardando_cliente"]);
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual({ ...(quote.aprovacao as Linha), em: "x" }, { por_uid: "owner-1", em: "x", edicao: 1 });
    assert.deepEqual({ ...(quote.envio as Linha), em: "x" }, { por_uid: "owner-1", em: "x", edicao: 1 });
    const congelada = await doc(`quotes/${numero}/revisoes/0`);
    assert.deepEqual(congelada.aprovacao, quote.aprovacao);
    assert.equal(congelada.enviado_por, "owner-1");
    // Quem montou continua no documento, não quem aprovou e enviou.
    assert.equal(congelada.autor_nome, "Guilherme");
    assert.deepEqual(congelada.linhas, quote.linhas);

    const doPasso = (await eventos(numero)).filter((event) => resultado.events.includes(String(event.id)));
    assert.deepEqual(doPasso.map((event) => event.type).sort(), ["demand.stage_changed", "quote.approved", "quote.sent"]);
    const etapa = doPasso.find((event) => event.type === "demand.stage_changed")?.payload as Linha;
    assert.deepEqual([etapa.etapa_antes, etapa.etapa_depois], ["para_aprovar", "aguardando_cliente"]);
    const marcos = (await doc(`demands/${numero}`)).marcos as Linha[];
    assert.deepEqual(marcos.map((marco) => marco.etapa), ["em_montagem", "para_aprovar", "aguardando_cliente"]);

    const repetido = await advanceQuoteFor(
      db,
      owner,
      { action: "approve_and_send", request_id: key(), numero, expected_status: "para_aprovar", expected_edicao: 1 },
      { agora: JUNHO },
    );
    assert.deepEqual([repetido.ja_feito, repetido.status], [true, "enviado"]);
  });

  it("a proposta não sai do rascunho direto para o cliente: passa pela aprovação", async () => {
    const { numero } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await rejeita(orcamento(comercial, "send", numero), "failed-precondition", /aprovação do owner/);
    await rejeita(orcamento(owner, "send", numero), "failed-precondition", /aprovação do owner/);
    await orcamento(comercial, "submit", numero);
    await rejeita(orcamento(comercial, "send", numero), "failed-precondition");
    assert.equal((await doc(`quotes/${numero}`)).status, "para_aprovar");
    assert.equal(await existe(`quotes/${numero}/revisoes/0`), false);
  });
});

describe("fechar, perder e reabrir", () => {
  it("fechar converte o prospect sem projeção e grava o escopo sem preço; a resposta fica na RV enviada", async () => {
    const numero = await propostaEnviada("PROSP", {
      linhas: [
        { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10", preco: "55.00", motivo: "Escada" },
        { origem: "avulso", quantidade: "1", preco: "300.00", motivo: "Fora da tabela", descricao: "Içamento de cofre", unidade: "VB" },
        { origem: "ajuste", quantidade: "1", preco: "-50.00", motivo: "Arredondamento" },
      ],
    });
    assert.equal((await doc("customers/PROSP")).stage, "prospect");

    // Contato de outro cliente e resposta no futuro: recusados.
    await rejeita(demanda(comercial, "close", numero, { contato_id: "ct_renata" }), "failed-precondition", /outro cliente/);
    await rejeita(demanda(comercial, "close", numero, { em: "2026-06-23T10:00:00-03:00" }), "invalid-argument", /depois de agora/);

    const fechado = await demanda(comercial, "close", numero, {
      em: "2026-06-21T10:30:00-03:00",
      contato_id: "ct_prosp",
      link: "https://outlook.office.com/mail/id/AAMk",
    });
    assert.deepEqual([fechado.etapa, fechado.rv, fechado.status], ["para_planejar", 0, "enviado"]);

    const dem = await doc(`demands/${numero}`);
    assert.equal(dem.etapa, "para_planejar");
    assert.equal(dem.escopo_rv, 0);
    const linhasRv0 = linhasDe(await doc(`quotes/${numero}/revisoes/0`));
    assert.deepEqual(dem.escopo, [
      {
        linha_id: linhasRv0[0].id,
        lpu_item_id: "lpu_mesa",
        codigo: "DTL-0001-T",
        item: "Mesa de escritório",
        descricao: "Transporte de mesa",
        servico: "Transporte",
        unidade: "UN",
        quantidade: "10",
        origem_local: null,
        destino_local: null,
      },
      {
        linha_id: linhasRv0[1].id,
        lpu_item_id: null,
        codigo: null,
        item: "Içamento de cofre",
        descricao: "Içamento de cofre",
        servico: null,
        unidade: "VB",
        quantidade: "1",
        origem_local: null,
        destino_local: null,
      },
    ]);
    // A demanda continua sem preço, inclusive no escopo.
    assert.deepEqual(chavesDeDinheiro(dem), []);
    assert.deepEqual((dem.marcos as Linha[]).at(-1)?.etapa, "para_planejar");

    const resposta = (await doc(`quotes/${numero}/revisoes/0`)).resposta_cliente as Linha;
    assert.deepEqual(
      { ...resposta, registrada_em: "x" },
      {
        tipo: "fechado",
        em: "2026-06-21T13:30:00.000Z",
        contato_id: "ct_prosp",
        link: "https://outlook.office.com/mail/id/AAMk",
        registrada_por: "com-1",
        registrada_em: "x",
      },
    );

    // O prospect vira cliente na mesma operação, sem sigla, módulos nem projeção.
    const cadastro = await doc("customers/PROSP");
    assert.equal(cadastro.stage, "cliente");
    assert.ok(cadastro.stage_changed_at instanceof Timestamp);
    for (const campo of ["sku_prefix", "operation_template", "modules", "client_access"]) assert.equal(campo in cadastro, false, campo);
    assert.equal(cadastro.portal_status, "inactive");
    assert.equal(await existe("client_profiles/PROSP"), false);
    assert.equal(await count("client_profiles"), 0);

    const doFechamento = (await eventos()).filter((event) => fechado.events.includes(String(event.id)));
    assert.deepEqual(doFechamento.map((event) => event.type).sort(), [
      "commercial_customer.became_client",
      "demand.stage_changed",
      "demand.won",
    ]);
    assert.deepEqual(
      { ...(doFechamento.find((event) => event.type === "demand.won")?.payload as Linha), segundos_desde_anterior: 0 },
      { numero, rv: 0, virou_cliente: true, segundos_desde_anterior: 0 },
    );
    const virou = doFechamento.find((event) => event.type === "commercial_customer.became_client");
    assert.deepEqual([virou?.payload, virou?.customer_code, virou?.entity_type], [{ numero }, "PROSP", "customer"]);
    semDinheiroNemPessoa(await eventos());

    // Outro toque com outra chave: já está fechada.
    const repetido = await advanceDemandFor(
      db,
      comercial,
      { action: "close", request_id: key(), numero, expected_etapa: "aguardando_cliente", expected_rv: 0 },
      { agora: JUNHO_22 },
    );
    assert.deepEqual([repetido.ja_feito, repetido.etapa], [true, "para_planejar"]);
    assert.equal((await eventos()).filter((event) => event.type === "demand.won").length, 1);
  });

  it("fechar só a proposta enviada: rascunho e etapa vista diferente são recusados", async () => {
    const { numero } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await rejeita(demanda(comercial, "close", numero), "failed-precondition", /proposta enviada/);
    await rejeita(
      advanceDemandFor(db, comercial, { action: "close", request_id: key(), numero, expected_etapa: "aguardando_cliente", expected_rv: 0 }),
      "failed-precondition",
      /mudou/,
    );
    await rejeita(
      advanceDemandFor(db, wms, { action: "close", request_id: key(), numero, expected_etapa: "em_montagem", expected_rv: 0 }),
      "permission-denied",
    );
    await rejeita(
      advanceDemandFor(db, comercial, { action: "close", request_id: key(), numero: "10999", expected_etapa: "em_montagem", expected_rv: 0 }),
      "not-found",
    );
  });

  it("perder: qualquer motivo antes do fechamento; depois, só cancelado pelo cliente; outro pede nota", async () => {
    // Em montagem, por preço: a demanda para, e o orçamento não anda até reabrir.
    const { numero: montagem } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    const perdida = await demanda(comercial, "lose", montagem, { motivo: "preco" });
    assert.equal(perdida.etapa, "perdida");
    const dem = await doc(`demands/${montagem}`);
    assert.deepEqual({ ...(dem.perda as Linha), em: "x" }, { motivo: "preco", nota: null, etapa_antes: "em_montagem", rv: 0, em: "x", por_uid: "com-1" });
    const lost = (await eventos(montagem)).find((event) => event.type === "demand.lost");
    assert.deepEqual({ ...(lost?.payload as Linha), segundos_desde_anterior: 0 }, { numero: montagem, rv: 0, etapa_antes: "em_montagem", motivo: "preco", segundos_desde_anterior: 0 });
    await rejeita(orcamento(comercial, "submit", montagem), "failed-precondition", /perdida/);
    await rejeita(editar(montagem, { titulo: "x" }), "failed-precondition", /perdida/);
    await rejeita(demanda(comercial, "lose", montagem, { motivo: "prazo" }), "failed-precondition", /antes de faturar/);

    // Aguardando o cliente: "outro" pede nota.
    const aguardando = await propostaEnviada();
    await rejeita(demanda(comercial, "lose", aguardando, { motivo: "outro" }), "failed-precondition", /nota/);
    await rejeita(demanda(comercial, "lose", aguardando, { motivo: "achou_caro" }), "invalid-argument");
    await demanda(comercial, "lose", aguardando, { motivo: "outro", nota: "O cliente desistiu do andar." });
    assert.equal(((await doc(`demands/${aguardando}`)).perda as Linha).nota, "O cliente desistiu do andar.");

    // Fechada (para planejar): preço, prazo e sem resposta não valem mais.
    const fechada = await propostaEnviada();
    await demanda(comercial, "close", fechada);
    for (const motivo of ["preco", "prazo", "desistencia", "sem_resposta", "outro"]) {
      await rejeita(demanda(comercial, "lose", fechada, { motivo, nota: "x" }), "failed-precondition", /cancelamento do cliente/);
    }
    const cancelada = await demanda(comercial, "lose", fechada, { motivo: "cancelado_cliente" });
    assert.equal(cancelada.etapa, "perdida");
    assert.equal(((await doc(`demands/${fechada}`)).perda as Linha).etapa_antes, "para_planejar");
    semDinheiroNemPessoa(await eventos());
  });

  it("a demanda direta da Operação, sem orçamento, não anda pelo Comercial e diz por quê (parte 3.4c)", async () => {
    await db.doc("demands/10090").set({ numero: "10090", customer_code: "ITAU", entrada: "direta", tipo: "paraquedas", etapa: "para_planejar" });
    const recusa = await rejeita(
      advanceDemandFor(db, comercial, { action: "lose", request_id: key(), numero: "10090", expected_etapa: "para_planejar", expected_rv: 0, motivo: "cancelado_cliente" }),
      "failed-precondition",
      /direta e ainda não tem orçamento/,
    );
    assert.match(recusa.message, /Operação/);
    await rejeita(
      advanceDemandFor(db, comercial, { action: "lose", request_id: key(), numero: "10091", expected_etapa: "para_planejar", expected_rv: 0, motivo: "preco" }),
      "not-found",
    );
    assert.equal((await doc("demands/10090")).etapa, "para_planejar");
  });

  it("reabrir: a proposta enviada e recusada volta numa RV nova; a perdida antes do envio e a fechada voltam com a mesma RV", async () => {
    // Enviada e sem resposta: RV01 em montagem; a RV00 enviada não muda.
    const enviada = await propostaEnviada();
    const congelada = await doc(`quotes/${enviada}/revisoes/0`);
    await demanda(comercial, "lose", enviada, { motivo: "sem_resposta" });
    const reaberta = await demanda(comercial, "reopen", enviada, {}, JULHO);
    assert.deepEqual([reaberta.etapa, reaberta.rv, reaberta.status, reaberta.rotulo], ["em_montagem", 1, "rascunho", `${enviada} – RV01`]);
    await rejeita(demanda(comercial, "reopen", enviada, {}, JULHO), "failed-precondition", /não está perdida/);
    const dem = await doc(`demands/${enviada}`);
    assert.equal(dem.etapa, "em_montagem");
    assert.equal(dem.perda, null);
    assert.deepEqual(
      (dem.perdas_anteriores as Linha[]).map((perda) => [perda.motivo, perda.etapa_antes, perda.rv, perda.reaberta_por]),
      [["sem_resposta", "aguardando_cliente", 0, "com-1"]],
    );
    const quote = await doc(`quotes/${enviada}`);
    assert.deepEqual([quote.rv, quote.status, quote.tipo_rv, quote.data_base], [1, "rascunho", "proposta", "2026-06-20"]);
    assert.deepEqual(quote.revisao_de, { rv: 0, edicao: 1, motivo: "reabertura" });
    assert.deepEqual(await doc(`quotes/${enviada}/revisoes/0`), congelada);
    const tipos = (await eventos(enviada)).map((event) => event.type);
    assert.ok(tipos.includes("demand.reopened") && tipos.includes("quote.revised"));
    const reopened = (await eventos(enviada)).find((event) => event.type === "demand.reopened")?.payload;
    assert.deepEqual(reopened, { numero: enviada, rv: 1, etapa_antes: "perdida", etapa_depois: "em_montagem", rv_aberta: true });

    // Perdida em montagem: volta em montagem, na mesma RV.
    const { numero: montagem } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await demanda(comercial, "lose", montagem, { motivo: "desistencia" });
    const volta = await demanda(comercial, "reopen", montagem);
    assert.deepEqual([volta.etapa, volta.rv, volta.status], ["em_montagem", 0, "rascunho"]);
    // Outro toque, com outra chave: já está reaberta.
    const repetido = await advanceDemandFor(
      db,
      comercial,
      { action: "reopen", request_id: key(), numero: montagem, expected_etapa: "perdida", expected_rv: 0 },
      { agora: JUNHO_22 },
    );
    assert.equal(repetido.ja_feito, true);

    // Fechada e cancelada pelo cliente: volta a planejar, com a RV fechada.
    const fechada = await propostaEnviada();
    await demanda(comercial, "close", fechada);
    await demanda(comercial, "lose", fechada, { motivo: "cancelado_cliente" });
    const replanejada = await demanda(comercial, "reopen", fechada);
    assert.deepEqual([replanejada.etapa, replanejada.rv], ["para_planejar", 0]);
    assert.equal(await count(`quotes/${fechada}/revisoes`), 1);
  });
});

describe("execução, validação e a aprovação dispensada", () => {
  it("registrar a execução leva a execução a orçar; validar leva a aguardando autorização (contrato com pedido e aceite)", async () => {
    const numero = await propostaEnviada();
    await demanda(comercial, "close", numero);
    await rejeita(
      demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JUNHO_22),
      "invalid-argument",
      /depois de hoje/,
    );
    await rejeita(
      demanda(comercial, "register_execution", numero, { executado_de: "2026-06-25", executado_ate: "2026-06-24" }, JULHO),
      "invalid-argument",
      /antes do início/,
    );
    const executada = await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
    assert.equal(executada.etapa, "execucao_a_orcar");
    const dem = await doc(`demands/${numero}`);
    assert.deepEqual([dem.executado_de, dem.executado_ate], ["2026-06-24", "2026-06-25"]);
    const registro = (await eventos(numero)).find((event) => event.type === "demand.execution_registered");
    assert.deepEqual(registro?.payload, { numero, executado_de: "2026-06-24", executado_ate: "2026-06-25" });

    // A proposta não se valida antes da execução, e a RV de execução não abre antes dela.
    const outra = await propostaEnviada();
    await rejeita(demanda(comercial, "validate", outra), "failed-precondition", /fecha/);
    await rejeita(orcamento(comercial, "revise", outra, { motivo: "execucao" }), "failed-precondition", /execução/);

    // Sem desvio: a RV fechada é validada como está.
    const validada = await demanda(comercial, "validate", numero, { contato_id: "ct_renata", em: "2026-07-14T16:00:00-03:00" }, JULHO);
    assert.equal(validada.etapa, "aguardando_autorizacao");
    const depois = await doc(`demands/${numero}`);
    assert.deepEqual(
      { ...(depois.validacao as Linha), em: "x" },
      { rv: 0, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "x", por_uid: "com-1" },
    );
    assert.equal(depois.medicao_pendente, false);
    const congelada = await doc(`quotes/${numero}/revisoes/0`);
    assert.equal((congelada.resposta_cliente as Linha).tipo, "fechado");
    assert.equal((congelada.validacao_cliente as Linha).tipo, "validada");
    assert.equal((congelada.validacao_cliente as Linha).em, "2026-07-14T19:00:00.000Z");
    const evento = (await eventos(numero)).find((event) => event.type === "quote.validated");
    assert.deepEqual(evento?.payload, {
      numero,
      rv: 0,
      tipo_rv: "proposta",
      etapa_antes: "execucao_a_orcar",
      etapa_depois: "aguardando_autorizacao",
      autorizacao_exigida: true,
      medicao_pendente: false,
      virou_cliente: false,
    });
  });

  it("sem contrato a validação leva a a faturar; com medição mensal, a faturar com a medição pendente; a faturar não se perde", async () => {
    const semContrato = await demandaExecutada("PROSP");
    const aFaturar = await demanda(comercial, "validate", semContrato, {}, JULHO);
    assert.equal(aFaturar.etapa, "a_faturar");
    assert.equal((await doc(`demands/${semContrato}`)).medicao_pendente, false);
    await rejeita(demanda(comercial, "lose", semContrato, { motivo: "cancelado_cliente" }, JULHO), "failed-precondition", /antes de faturar/);

    const safra = await demandaExecutada("SAFRA");
    const medicao = await demanda(comercial, "validate", safra, {}, JULHO);
    assert.equal(medicao.etapa, "a_faturar");
    const dem = await doc(`demands/${safra}`);
    assert.equal(dem.medicao_pendente, true);
    assert.equal((dem.validacao as Linha).etapa, "a_faturar");
    const evento = (await eventos(safra)).find((event) => event.type === "quote.validated")?.payload as Linha;
    assert.deepEqual([evento.autorizacao_exigida, evento.medicao_pendente], [false, true]);
  });

  it("dispensa: a RV de execução que só reduz quantidades de linhas de tabela vai ao cliente sem nova aprovação", async () => {
    const numero = await demandaExecutada();
    const revisada = await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    assert.deepEqual([revisada.rv, revisada.etapa, revisada.status], [1, "execucao_a_orcar", "rascunho"]);
    assert.equal((await doc(`quotes/${numero}`)).tipo_rv, "execucao");
    // A RV de execução guarda a dispensa calculada: a tela sabe que pode oferecer "Enviar ao cliente".
    assert.deepEqual((await doc(`quotes/${numero}`)).dispensa, { dispensada: true });
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "20" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        ],
      },
      JULHO,
    );
    assert.deepEqual((await doc(`quotes/${numero}`)).dispensa, { dispensada: true });

    const enviada = await orcamento(comercial, "send", numero, {}, JULHO);
    assert.deepEqual([enviada.status, enviada.etapa], ["enviado", "aguardando_cliente"]);
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.aprovacao, null);
    assert.deepEqual({ ...(quote.aprovacao_dispensada as Linha), em: "x" }, { por_uid: "com-1", em: "x", edicao: 3, rv_fechada: 0 });
    const congelada = await doc(`quotes/${numero}/revisoes/1`);
    assert.deepEqual(congelada.aprovacao_dispensada, quote.aprovacao_dispensada);
    assert.equal(congelada.enviado_por, "com-1");
    const marcos = (await doc(`demands/${numero}`)).marcos as Linha[];
    assert.deepEqual(
      marcos.slice(-2).map((marco) => [marco.marco ?? marco.etapa, marco.rv ?? null]),
      [
        ["aprovacao_dispensada", 1],
        ["aguardando_cliente", null],
      ],
    );
    const doEnvio = (await eventos(numero)).filter((event) => enviada.events.includes(String(event.id)));
    assert.deepEqual(doEnvio.map((event) => event.type).sort(), ["demand.stage_changed", "quote.approval_waived", "quote.sent"]);
    semDinheiroNemPessoa(doEnvio);
  });

  it("sem dispensa: total acima do fechado ou linha avulsa passa pela aprovação do owner", async () => {
    const numero = await demandaExecutada();
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    // Mais mesas do que o fechado: o total passa.
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "30" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        ],
      },
      JULHO,
    );
    assert.deepEqual((await doc(`quotes/${numero}`)).dispensa, { dispensada: false, motivo: "o total passa o da RV fechada" });
    await rejeita(orcamento(comercial, "send", numero, {}, JULHO), "failed-precondition", /total passa/);
    // Menos mesas, mas com uma linha avulsa: também não.
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10" },
          { origem: "avulso", quantidade: "1", preco: "10.00", motivo: "Espera", descricao: "Hora parada" },
        ],
      },
      JULHO,
    );
    await rejeita(orcamento(comercial, "send", numero, {}, JULHO), "failed-precondition", /avulso/);
    assert.equal(await existe(`quotes/${numero}/revisoes/1`), false);

    await orcamento(comercial, "submit", numero, {}, JULHO);
    await orcamento(owner, "approve", numero, {}, JULHO);
    const enviada = await orcamento(comercial, "send", numero, {}, JULHO);
    assert.deepEqual([enviada.status, enviada.etapa], ["enviado", "aguardando_cliente"]);
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.aprovacao_dispensada, null);
    assert.equal((quote.aprovacao as Linha).por_uid, "owner-1");
    assert.ok(!((await doc(`demands/${numero}`)).marcos as Linha[]).some((marco) => marco.marco === "aprovacao_dispensada"));
    assert.ok(!(await eventos(numero)).some((event) => event.type === "quote.approval_waived"));
  });

  it("data-base herdada: a RV de execução de julho continua na tabela de junho, mesmo com a v2 vigente", async () => {
    const numero = await demandaExecutada();
    await carregarV2();
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "20" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "40" },
        ],
      },
      JULHO,
    );
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.data_base, "2026-06-20");
    assert.deepEqual(quote.tabela, { id: "pt_itau_v1", nome: "LPU Itaú v1", variante: "Comercial" });
    assert.deepEqual(linhasDe(quote).map((linha) => linha.preco), ["40.00", "18.50"]);
    assert.equal(quote.total_cents, 20 * 4000 + 40 * 1850);
    // A v1 foi encerrada pela v2, mas cobre a data-base: sem marca, e a dispensa vale.
    assert.deepEqual(quote.marcas, []);
    const enviada = await orcamento(comercial, "send", numero, {}, JULHO);
    assert.equal(enviada.status, "enviado");
    assert.deepEqual((await doc(`quotes/${numero}/revisoes/1`)).marcas, []);
  });

  it("orçar execução (create_execution): demanda direta paraquedas, executada, RV 0 de execução e data-base da criação", async () => {
    const entrada = {
      action: "create_execution",
      customer_code: "ITAU",
      contrato_id: "itau-2026",
      contato_id: "ct_renata",
      canal: "telefone",
      titulo: "Transporte de 60 monitores para o CAT",
      recebida_em: "2026-07-10T07:30:00-03:00",
      executado_de: "2026-07-10",
      executado_ate: "2026-07-11",
      linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "2" }],
    };
    await rejeita(saveQuoteFor(db, comercial, { ...entrada, request_id: key(), tipo: "planejada" }, { agora: JULHO }), "invalid-argument", /tipo/);
    await rejeita(saveQuoteFor(db, comercial, { ...entrada, request_id: key(), entrada: "comercial" }, { agora: JULHO }), "invalid-argument", /entrada/);
    await rejeita(
      saveQuoteFor(db, comercial, { ...entrada, request_id: key(), executado_ate: "2026-07-16" }, { agora: JULHO }),
      "invalid-argument",
      /depois de hoje/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, { ...entrada, request_id: key(), executado_de: "2026-07-12" }, { agora: JULHO }),
      "invalid-argument",
      /antes do início/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, { ...proposta(), entrada: "direta" }, { agora: JULHO }),
      "failed-precondition",
      /create_execution/,
    );
    assert.equal(await count("demands"), 0);

    const criada = await saveQuoteFor(db, comercial, { ...entrada, request_id: key() }, { agora: JULHO });
    assert.deepEqual([criada.rv, criada.status, criada.etapa], [0, "rascunho", "execucao_a_orcar"]);
    const dem = await doc(`demands/${criada.numero}`);
    assert.deepEqual(
      [dem.entrada, dem.tipo, dem.canal, dem.executado_de, dem.executado_ate, dem.etapa, dem.escopo_rv],
      ["direta", "paraquedas", "telefone", "2026-07-10", "2026-07-11", "execucao_a_orcar", null],
    );
    assert.deepEqual((dem.marcos as Linha[]).map((marco) => marco.etapa), ["execucao_a_orcar"]);
    const quote = await doc(`quotes/${criada.numero}`);
    assert.deepEqual([quote.rv, quote.tipo_rv, quote.data_base, quote.status], [0, "execucao", "2026-07-15", "rascunho"]);
    assert.equal(linhasDe(quote)[0].preco, "40.00");
    const tipos = (await eventos(criada.numero)).map((event) => [event.type, (event.payload as Linha).tipo_rv ?? (event.payload as Linha).entrada ?? (event.payload as Linha).direta]);
    assert.deepEqual(tipos.sort(), [
      ["demand.created", "direta"],
      ["demand.execution_registered", true],
      ["quote.created", "execucao"],
    ]);

    // Sem RV fechada para comparar: a execução direta passa pela aprovação.
    await rejeita(orcamento(comercial, "send", criada.numero, {}, JULHO), "failed-precondition", /RV fechada/);
    await orcamento(comercial, "submit", criada.numero, {}, JULHO);
    await orcamento(owner, "approve", criada.numero, {}, JULHO);
    const enviada = await orcamento(comercial, "send", criada.numero, {}, JULHO);
    assert.equal(enviada.etapa, "aguardando_cliente");
    // Já executada: perder agora é só cancelamento do cliente.
    await rejeita(demanda(comercial, "lose", criada.numero, { motivo: "preco" }, JULHO), "failed-precondition", /cancelamento do cliente/);
    const validada = await demanda(comercial, "validate", criada.numero, {}, JULHO);
    assert.equal(validada.etapa, "aguardando_autorizacao");
    assert.equal(((await doc(`quotes/${criada.numero}/revisoes/0`)).resposta_cliente as Linha).tipo, "validada");
  });
});

describe("revisão da parte 10: aditivo em negociação, recusa, descarte, dispensa e respostas", () => {
  it("o aditivo aberto não segura a execução; recusado pelo cliente, a demanda volta ao escopo fechado e a RV seguinte não reusa o número", async () => {
    const numero = await propostaEnviada();
    await demanda(comercial, "close", numero);
    const escopo = (await doc(`demands/${numero}`)).escopo;
    const rv0 = await doc(`quotes/${numero}/revisoes/0`);

    // O cliente pede um cofre a mais: RV01 de aditivo, em montagem.
    const aberto = await orcamento(comercial, "revise", numero, { motivo: "aditivo" }, JUNHO_22);
    assert.deepEqual([aberto.rv, aberto.etapa], [1, "em_montagem"]);
    // O serviço é executado enquanto o aditivo é montado: a execução se registra, e a etapa segue a do aditivo.
    const executada = await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
    assert.deepEqual([executada.etapa, executada.rv], ["em_montagem", 1]);
    const dem = await doc(`demands/${numero}`);
    assert.deepEqual([dem.executado_de, dem.executado_ate], ["2026-06-24", "2026-06-25"]);
    assert.deepEqual({ ...(dem.registro_execucao as Linha), em: "x" }, { etapa_antes: "em_montagem", rv: 1, em: "x", por_uid: "com-1" });
    const execucaoRepetida = await advanceDemandFor(
      db,
      comercial,
      {
        action: "register_execution",
        request_id: key(),
        numero,
        expected_etapa: "em_montagem",
        expected_rv: 1,
        executado_de: "2026-06-24",
        executado_ate: "2026-06-25",
      },
      { agora: JULHO },
    );
    assert.equal(execucaoRepetida.ja_feito, true);

    // O aditivo segue: uma linha avulsa, aprovação e envio. Depois, aguardando o cliente.
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "24" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
          { origem: "avulso", quantidade: "1", preco: "300.00", motivo: "Fora da LPU", descricao: "Içamento de cofre" },
        ],
      },
      JULHO,
    );
    await orcamento(comercial, "submit", numero, {}, JULHO);
    await orcamento(owner, "approve", numero, {}, JULHO);
    await orcamento(comercial, "send", numero, {}, JULHO);
    assert.equal((await doc(`demands/${numero}`)).etapa, "aguardando_cliente");
    const rv1 = await doc(`quotes/${numero}/revisoes/1`);

    // A recusa não vem antes do envio do aditivo, nem é de outra coisa que não o aditivo enviado.
    await rejeita(demanda(comercial, "refuse_addendum", numero, { em: "2026-07-14T10:00:00-03:00" }, JULHO), "invalid-argument", /antes do envio/);
    const recusa = await demanda(comercial, "refuse_addendum", numero, { contato_id: "ct_renata", em: "2026-07-15T12:00:00-03:00" }, JULHO);
    assert.deepEqual([recusa.etapa, recusa.rv, recusa.status, recusa.rotulo], ["execucao_a_orcar", 0, "enviado", numero]);

    // O orçamento volta à RV00 como foi enviada; a RV01 guarda a recusa e nada mais muda nela.
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual([quote.rv, quote.tipo_rv, quote.status, quote.ultima_rv_enviada], [0, "proposta", "enviado", 1]);
    assert.deepEqual(linhasDe(quote), linhasDe(rv0));
    assert.deepEqual([quote.total_cents, quote.aprovacao, quote.tabela], [rv0.total_cents, rv0.aprovacao, rv0.tabela]);
    assert.deepEqual({ ...(quote.envio as Linha) }, { por_uid: "com-1", em: rv0.enviado_em, edicao: rv0.edicao });
    const rv1Depois = await doc(`quotes/${numero}/revisoes/1`);
    assert.deepEqual(
      { ...(rv1Depois.resposta_cliente as Linha), registrada_em: "x" },
      { tipo: "recusada", em: "2026-07-15T15:00:00.000Z", contato_id: "ct_renata", link: null, registrada_por: "com-1", registrada_em: "x" },
    );
    assert.deepEqual({ ...rv1Depois, resposta_cliente: null }, rv1);
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), rv0);
    const depois = await doc(`demands/${numero}`);
    assert.deepEqual([depois.escopo_rv, depois.escopo], [0, escopo]);
    assert.deepEqual((depois.aditivos_recusados as Linha[]).map((item) => [item.rv, item.por_uid]), [[1, "com-1"]]);
    assert.deepEqual(chavesDeDinheiro(depois), []);

    // Outro toque, com outra chave: já está recusado.
    const recusaRepetida = await advanceDemandFor(
      db,
      comercial,
      { action: "refuse_addendum", request_id: key(), numero, expected_etapa: "aguardando_cliente", expected_rv: 1 },
      { agora: JULHO },
    );
    assert.deepEqual([recusaRepetida.ja_feito, recusaRepetida.rv, recusaRepetida.etapa], [true, 0, "execucao_a_orcar"]);

    // A RV de execução sai do escopo fechado, com o número seguinte ao do aditivo que o cliente recebeu.
    const execucao = await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    assert.deepEqual([execucao.rv, execucao.etapa, execucao.rotulo], [2, "execucao_a_orcar", `${numero} – RV02`]);
    const rv2 = await doc(`quotes/${numero}`);
    assert.deepEqual(linhasDe(rv2).map((linha) => linha.id), linhasDe(rv0).map((linha) => linha.id));
    assert.deepEqual(rv2.revisao_de, { rv: 0, edicao: quote.edicao, motivo: "execucao" });
    assert.deepEqual(rv2.dispensa, { dispensada: true });

    const refused = (await eventos(numero)).find((event) => event.type === "quote.refused");
    assert.deepEqual(
      { ...(refused?.payload as Linha), segundos_desde_anterior: 0 },
      {
        numero,
        rv: 1,
        tipo_rv: "aditivo",
        rv_restaurada: 0,
        etapa_antes: "aguardando_cliente",
        etapa_depois: "execucao_a_orcar",
        segundos_desde_anterior: 0,
      },
    );
    semDinheiroNemPessoa(await eventos(numero));
  });

  it("descartar a RV seguinte não enviada: a reabertura em que o cliente aceita a RV recebida e o aditivo aberto por engano", async () => {
    // Perdida sem resposta e reaberta (RV01 em montagem); o cliente volta aceitando a RV00 que recebeu.
    const numero = await propostaEnviada();
    const rv0 = await doc(`quotes/${numero}/revisoes/0`);
    await demanda(comercial, "lose", numero, { motivo: "sem_resposta" });
    await demanda(comercial, "reopen", numero, {}, JULHO);
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "10" },
        ],
      },
      JULHO,
    );
    const vista = await doc(`quotes/${numero}`);
    const descartada = await orcamento(comercial, "discard", numero, {}, JULHO);
    assert.deepEqual([descartada.rv, descartada.status, descartada.etapa, descartada.rotulo], [0, "enviado", "aguardando_cliente", numero]);
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual(linhasDe(quote), linhasDe(rv0));
    assert.equal(quote.total_cents, rv0.total_cents);
    assert.ok(Number(quote.edicao) > Number(vista.edicao));
    assert.deepEqual({ ...(quote.descarte as Linha), em: "x" }, {
      rv: 1,
      tipo_rv: "proposta",
      status: "rascunho",
      edicao: vista.edicao,
      por_uid: "com-1",
      em: "x",
    });
    assert.equal(await count(`quotes/${numero}/revisoes`), 1);
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), rv0);
    const repetido = await advanceQuoteFor(
      db,
      comercial,
      { action: "discard", request_id: key(), numero, expected_status: "rascunho", expected_edicao: vista.edicao },
      { agora: JULHO },
    );
    assert.deepEqual([repetido.ja_feito, repetido.rv, repetido.status], [true, 0, "enviado"]);
    // A tela velha da RV01 não grava mais.
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: vista.edicao, titulo: "x" }, { agora: JULHO }),
      "failed-precondition",
    );
    // A RV00 enviada recebe o fechamento.
    const fechado = await demanda(comercial, "close", numero, {}, JULHO);
    assert.deepEqual([fechado.etapa, fechado.rv], ["para_planejar", 0]);
    assert.equal(((await doc(`quotes/${numero}/revisoes/0`)).resposta_cliente as Linha).tipo, "fechado");

    // Aditivo aberto por engano e já aprovado: some com a cópia da aprovação; o número volta a ficar livre.
    await orcamento(comercial, "revise", numero, { motivo: "aditivo" }, JULHO);
    await orcamento(comercial, "submit", numero, {}, JULHO);
    await orcamento(owner, "approve", numero, {}, JULHO);
    assert.equal(await existe(`quotes/${numero}/revisoes/1`), true);
    const volta = await orcamento(comercial, "discard", numero, {}, JULHO);
    assert.deepEqual([volta.rv, volta.etapa, volta.status], [0, "para_planejar", "enviado"]);
    assert.equal(await existe(`quotes/${numero}/revisoes/1`), false);
    const deNovo = await orcamento(comercial, "revise", numero, { motivo: "aditivo" }, JULHO);
    assert.equal(deNovo.rv, 1);

    const descartes = (await eventos(numero)).filter((event) => event.type === "quote.discarded").map((event) => event.payload as Linha);
    assert.deepEqual(
      descartes.map((payload) => [payload.rv, payload.tipo_rv, payload.rv_restaurada, payload.status_antes, payload.etapa_antes, payload.etapa_depois]).sort(),
      [
        [1, "aditivo", 0, "aprovado", "para_enviar", "para_planejar"],
        [1, "proposta", 0, "rascunho", "em_montagem", "aguardando_cliente"],
      ],
    );
    semDinheiroNemPessoa(await eventos(numero));

    // A primeira RV e a RV enviada não se descartam.
    const { numero: novo } = await saveQuoteFor(db, comercial, proposta(), { agora: JUNHO });
    await rejeita(orcamento(comercial, "discard", novo), "failed-precondition", /primeira RV/);
    const enviada = await propostaEnviada();
    await rejeita(orcamento(comercial, "discard", enviada), "failed-precondition", /enviado/);
  });

  it("dispensa: a RV de execução sem o ajuste (o desconto) da RV fechada passa pela aprovação do owner", async () => {
    const numero = await demandaExecutada("ITAU", {
      linhas: [
        { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "24" },
        { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        { origem: "ajuste", quantidade: "1", preco: "-100.00", motivo: "Arredondamento combinado" },
      ],
    });
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    const revisada = await doc(`quotes/${numero}`);
    const [mesa, cadeira] = linhasDe(revisada);
    // 20 mesas e sem o ajuste: 1.688,00, abaixo do fechado (1.748,00), mas o desconto aprovado sumiu.
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "20" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        ],
      },
      JULHO,
    );
    await rejeita(orcamento(comercial, "send", numero, {}, JULHO), "failed-precondition", /RV fechada \(ajuste\) saiu/);
    assert.equal(await existe(`quotes/${numero}/revisoes/1`), false);
    assert.ok(!(await eventos(numero)).some((event) => event.type === "quote.approval_waived"));
    // A RV guarda a dispensa calculada a cada passo: com o ajuste, e depois sem ele.
    assert.deepEqual(revisada.dispensa, { dispensada: false, motivo: "a linha 3 é ajuste" });
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.total_cents, 20 * 4000 + 48 * 1850);
    assert.deepEqual(quote.dispensa, { dispensada: false, motivo: "a linha 3 da RV fechada (ajuste) saiu" });
  });

  it("fechado em e validado em não vêm antes do envio; validar e fechar não se confundem na repetição", async () => {
    // Enviada em 20/06 às 12:00 (São Paulo).
    const numero = await propostaEnviada();
    await rejeita(demanda(comercial, "close", numero, { em: "2026-06-20T08:00:00-03:00" }), "invalid-argument", /antes do envio/);
    // Dentro da folga do relógio (5 minutos), vale.
    await demanda(comercial, "close", numero, { em: "2026-06-20T11:58:00-03:00" });
    // Outra pessoa, com a tela de antes do fechamento, manda validar: não é "já feito", é recusado.
    await rejeita(
      advanceDemandFor(db, admin, { action: "validate", request_id: key(), numero, expected_etapa: "aguardando_cliente", expected_rv: 0 }, { agora: JUNHO_22 }),
      "failed-precondition",
    );
    await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    await orcamento(comercial, "send", numero, {}, JULHO);
    await rejeita(
      demanda(comercial, "validate", numero, { em: "2026-07-14T10:00:00-03:00" }, JULHO),
      "invalid-argument",
      /Validado em não pode ser antes do envio/,
    );

    // O aditivo validado antes da execução vira o escopo; "fechar" repetido sobre ele não é "já feito".
    const outra = await propostaEnviada();
    await demanda(comercial, "close", outra);
    await orcamento(comercial, "revise", outra, { motivo: "aditivo" }, JUNHO_22);
    await orcamento(comercial, "submit", outra, {}, JUNHO_22);
    await orcamento(owner, "approve", outra, {}, JUNHO_22);
    await orcamento(comercial, "send", outra, {}, JUNHO_22);
    const validado = await demanda(comercial, "validate", outra, {}, JUNHO_22);
    assert.deepEqual([validado.etapa, validado.rv], ["para_planejar", 1]);
    const dem = await doc(`demands/${outra}`);
    assert.deepEqual([dem.escopo_rv, dem.escopo_origem], [1, "aditivo"]);
    await rejeita(
      advanceDemandFor(db, comercial, { action: "close", request_id: key(), numero: outra, expected_etapa: "aguardando_cliente", expected_rv: 1 }, { agora: JUNHO_22 }),
      "failed-precondition",
    );
    const validaDeNovo = await advanceDemandFor(
      db,
      comercial,
      { action: "validate", request_id: key(), numero: outra, expected_etapa: "aguardando_cliente", expected_rv: 1 },
      { agora: JUNHO_22 },
    );
    assert.equal(validaDeNovo.ja_feito, true);
  });

  it("item inativo depois do fechamento: a RV de execução herdada continua editável; linha nova com ele, não", async () => {
    const numero = await demandaExecutada();
    await db.doc("lpu_items/lpu_cadeira").update({ ativo: false });
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    await editar(numero, { titulo: "Mudança de layout · 12º andar (execução)" }, JULHO);
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "20" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "40" },
        ],
      },
      JULHO,
    );
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual(
      linhasDe(quote).map((linha) => [linha.id, linha.lpu_item_id, linha.quantidade, linha.preco]),
      [
        [mesa.id, "lpu_mesa", "20", "40.00"],
        [cadeira.id, "lpu_cadeira", "40", "18.50"],
      ],
    );
    await rejeita(
      editar(
        numero,
        {
          linhas: [
            { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "20" },
            { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "1" },
          ],
        },
        JULHO,
      ),
      "invalid-argument",
      /inativo/,
    );
  });
});

describe("o caso real do Itaú, de ponta a ponta", () => {
  it("proposta enviada, fechada, executada, RV de execução enviada, validada e aguardando a autorização", async () => {
    // O Guilherme monta; o Leonardo aprova; o Guilherme envia.
    const { numero } = await saveQuoteFor(
      db,
      comercial,
      proposta("ITAU", {
        origem: { local_id: "loc_ceic", complemento: "12º andar" },
        destino: { local_id: "loc_cat", complemento: null },
        email_link: "https://outlook.office.com/mail/id/AAMk",
      }),
      { agora: JUNHO },
    );
    await orcamento(comercial, "submit", numero);
    await orcamento(owner, "approve", numero);
    await orcamento(comercial, "send", numero);
    // A Renata (Souza & Lopes) fecha por e-mail.
    await demanda(comercial, "close", numero, { contato_id: "ct_renata", link: "https://outlook.office.com/mail/id/AAMk-aceite" });
    assert.equal((await doc(`demands/${numero}`)).etapa, "para_planejar");
    // Executado em 24 e 25/06; a v2 da LPU entra no meio.
    await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
    await carregarV2();
    // A RV01 de execução: foram 22 mesas e 48 cadeiras.
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    const [mesa, cadeira] = linhasDe(await doc(`quotes/${numero}`));
    await editar(
      numero,
      {
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "22" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        ],
      },
      JULHO,
    );
    // Só quantidades, abaixo do fechado: vai sem nova aprovação.
    await orcamento(comercial, "send", numero, {}, JULHO);
    // A Renata valida a RV01; o Itaú autoriza o faturamento depois (pedido e aceite, parte 15).
    const final = await demanda(comercial, "validate", numero, { contato_id: "ct_renata" }, JULHO);
    assert.deepEqual([final.etapa, final.rv, final.rotulo], ["aguardando_autorizacao", 1, `${numero} – RV01`]);

    const dem = await doc(`demands/${numero}`);
    assert.equal(dem.escopo_rv, 0);
    assert.deepEqual(
      (dem.escopo as Linha[]).map((linha) => [linha.lpu_item_id, linha.quantidade, linha.origem_local, linha.destino_local]),
      [
        ["lpu_mesa", "24", null, null],
        ["lpu_cadeira", "48", null, null],
      ],
    );
    assert.deepEqual([dem.executado_de, dem.executado_ate], ["2026-06-24", "2026-06-25"]);
    assert.deepEqual(
      { ...(dem.validacao as Linha), em: "x" },
      { rv: 1, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "x", por_uid: "com-1" },
    );
    assert.deepEqual(
      (dem.marcos as Linha[]).map((marco) => marco.marco ?? marco.etapa),
      [
        "em_montagem",
        "para_aprovar",
        "para_enviar",
        "aguardando_cliente",
        "para_planejar",
        "execucao_a_orcar",
        "aprovacao_dispensada",
        "aguardando_cliente",
        "aguardando_autorizacao",
      ],
    );
    assert.deepEqual(chavesDeDinheiro(dem), []);

    const rv0 = await doc(`quotes/${numero}/revisoes/0`);
    const rv1 = await doc(`quotes/${numero}/revisoes/1`);
    assert.equal((rv0.resposta_cliente as Linha).tipo, "fechado");
    assert.equal((rv0.resposta_cliente as Linha).contato_id, "ct_renata");
    assert.equal(rv0.total_cents, 24 * 4000 + 48 * 1850);
    assert.equal((rv1.resposta_cliente as Linha).tipo, "validada");
    assert.equal(rv1.tipo_rv, "execucao");
    assert.equal(rv1.data_base, "2026-06-20");
    assert.equal((rv1.tabela as Linha).id, "pt_itau_v1");
    assert.equal(rv1.total_cents, 22 * 4000 + 48 * 1850);
    assert.deepEqual(
      linhasDe(rv1).map((linha) => linha.id),
      linhasDe(rv0).map((linha) => linha.id),
    );
    assert.equal((await doc("customers/ITAU")).stage, "cliente");

    const todos = await eventos(numero);
    const tipos = todos.map((event) => event.type).sort();
    for (const tipo of [
      "demand.created",
      "quote.created",
      "quote.submitted",
      "quote.approved",
      "quote.sent",
      "demand.won",
      "demand.execution_registered",
      "quote.revised",
      "quote.approval_waived",
      "quote.validated",
    ]) {
      assert.ok(tipos.includes(tipo), `faltou ${tipo}`);
    }
    assert.equal(tipos.filter((tipo) => tipo === "quote.sent").length, 2);
    assert.ok(!tipos.includes("commercial_customer.became_client"));
    semDinheiroNemPessoa(todos);
  });
});

describe("orçar a execução da direta aberta pela Operação (parte 3.10d)", () => {
  /**
   * A direta que a Operação abriu (operacao/demanda-direta.ts) e revisou
   * (operacao/revisao-gravacao.ts): sem contrato, em Execução a orçar, com o
   * período executado e o resumo por linha do que se cobra.
   */
  async function diretaDaOperacao(numero: string, customer = "ITAU", extra: Record<string, unknown> = {}) {
    await db.doc(`demands/${numero}`).set({
      numero,
      customer_code: customer,
      customer_name: customer === "ITAU" ? "Itaú Unibanco" : customer,
      contrato_id: null,
      cobranca: "por_demanda",
      entrada: "direta",
      canal: "telefone",
      tipo: "paraquedas",
      titulo: "Retirada de mobiliário",
      recebida_em: "2026-07-10T10:30:00.000Z",
      execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null },
      etapa: "execucao_a_orcar",
      etapa_desde: "2026-07-12T21:00:00.000Z",
      marcos: [
        { etapa: "para_planejar", em: "2026-07-10T10:30:00.000Z", por_uid: "coord-1" },
        { etapa: "execucao_a_orcar", em: "2026-07-12T21:00:00.000Z", por_uid: "coord-1" },
      ],
      escopo_rv: null,
      escopo: [],
      executado_de: "2026-07-11",
      executado_ate: "2026-07-12",
      registro_execucao: { etapa_antes: "para_planejar", rv: null, em: "2026-07-12T21:00:00.000Z", por_uid: "coord-1", origem: "operacao" },
      aditivos_recusados: [],
      validacao: null,
      os_numeros: [`${numero}-01`],
      perda: null,
      cancelamento: null,
      aberta_pela: "operacao",
      operacao: {
        os_revisadas: [`${numero}-01`],
        os_em_aberto: [],
        periodo: { de: "2026-07-11", ate: "2026-07-12" },
        itens: [
          { linha: "ip_1", lpu_item_id: "lpu_mesa", item: "Mesa de escritório", unidade: "UN", executado: "12", a_cobrar: "12", absorvido: "0", aditivo: "0" },
          { linha: "ip_2", lpu_item_id: "lpu_cadeira", item: "Cadeira giratória", unidade: "UN", executado: "40", a_cobrar: "38", absorvido: "2", aditivo: "0" },
          { linha: "ip_3", lpu_item_id: "lpu_cofre", item: "Cofre", unidade: "VB", executado: "1", a_cobrar: "1", absorvido: "0", aditivo: "0" },
          { linha: "cp_1", lpu_item_id: null, item: "Içamento pela fachada", unidade: "VB", executado: "1", a_cobrar: "1", absorvido: "0", aditivo: "0" },
          { linha: "ip_4", lpu_item_id: "lpu_mesa", item: "Mesa de escritório", unidade: "UN", executado: "1", a_cobrar: "0", absorvido: "1", aditivo: "0" },
        ],
        aditivo: [],
        atualizado_em: "2026-07-12T21:00:00.000Z",
      },
      ...extra,
    });
  }

  function orcar(numero: string, extra: Record<string, unknown> = {}) {
    return { action: "price_execution", request_id: key(), numero, ...extra };
  }

  it("o orçamento nasce com o que a Operação manda cobrar, pela tabela do contrato escolhido; o resto volta para lançar", async () => {
    await diretaDaOperacao("10301");
    const entrada = orcar("10301", { contrato_id: "itau-2026" });
    const criado = await saveQuoteFor(db, comercial, entrada, { agora: JULHO });
    assert.deepEqual([criado.rv, criado.status, criado.etapa, criado.rotulo], [0, "rascunho", "execucao_a_orcar", "10301"]);
    assert.deepEqual(criado.fora_da_tabela, [
      { item: "Cofre", unidade: "VB", quantidade: "1" },
      { item: "Içamento pela fachada", unidade: "VB", quantidade: "1" },
    ]);

    const quote = await doc("quotes/10301");
    assert.deepEqual([quote.rv, quote.tipo_rv, quote.status, quote.data_base, (quote.tabela as Linha).id], [0, "execucao", "rascunho", "2026-07-15", "pt_itau_v1"]);
    assert.deepEqual(
      linhasDe(quote).map((linha) => [linha.origem, linha.lpu_item_id, linha.quantidade, linha.preco]),
      [
        ["tabela", "lpu_mesa", "12", "40.00"],
        ["tabela", "lpu_cadeira", "38", "18.50"],
      ],
    );
    assert.equal(quote.total_cents, 12 * 4000 + 38 * 1850);

    // A demanda passa a ter o contrato; a etapa, a execução e o resumo da Operação ficam como estavam.
    const dem = await doc("demands/10301");
    assert.deepEqual([dem.contrato_id, dem.cobranca, dem.etapa, dem.executado_de, dem.executado_ate], ["itau-2026", "por_demanda", "execucao_a_orcar", "2026-07-11", "2026-07-12"]);
    assert.equal((dem.operacao as Linha).atualizado_em, "2026-07-12T21:00:00.000Z");

    const daDemanda = await eventos("10301");
    assert.deepEqual(daDemanda.map((event) => [event.type, (event.payload as Linha).tipo_rv]), [["quote.created", "execucao"]]);
    semDinheiroNemPessoa(daDemanda);

    // O app repetindo a chamada: o recibo devolve o mesmo resultado, sem outro orçamento nem evento.
    const repetido = await saveQuoteFor(db, comercial, entrada, { agora: JULHO });
    assert.deepEqual([repetido.replayed, repetido.events, repetido.fora_da_tabela], [true, criado.events, criado.fora_da_tabela]);
    assert.equal((await eventos("10301")).length, 1);
    // Outro toque, com outra chave: já tem orçamento.
    await rejeita(saveQuoteFor(db, comercial, orcar("10301"), { agora: JULHO }), "failed-precondition", /já tem orçamento/);

    // Daí em diante, o caminho de toda RV de execução: o "Para" na montagem, aprovação, envio e validação.
    await rejeita(orcamento(comercial, "submit", "10301", {}, JULHO), "failed-precondition", /Falta Para/);
    await editar("10301", { contato_id: "ct_renata" }, JULHO);
    await rejeita(orcamento(comercial, "send", "10301", {}, JULHO), "failed-precondition", /RV fechada/);
    await orcamento(comercial, "submit", "10301", {}, JULHO);
    await orcamento(owner, "approve", "10301", {}, JULHO);
    assert.equal((await orcamento(comercial, "send", "10301", {}, JULHO)).etapa, "aguardando_cliente");
    assert.equal((await demanda(comercial, "validate", "10301", {}, JULHO)).etapa, "aguardando_autorizacao");
  });

  it("o cliente com tabela própria não cai na padrão: sem contrato, tudo volta para lançar; sem tabela própria, vale a padrão", async () => {
    await diretaDaOperacao("10302");
    const semContrato = await saveQuoteFor(db, comercial, orcar("10302"), { agora: JULHO });
    assert.equal(semContrato.fora_da_tabela?.length, 4);
    const quote = await doc("quotes/10302");
    assert.deepEqual([(quote.tabela as Linha).id, linhasDe(quote).length, quote.total_cents], [null, 0, 0]);
    assert.equal((await doc("demands/10302")).contrato_id, null);

    await diretaDaOperacao("10303", "PROSP", { customer_name: "Prospect Novo" });
    await saveQuoteFor(db, comercial, orcar("10303"), { agora: JULHO });
    const padrao = await doc("quotes/10303");
    assert.equal((padrao.tabela as Linha).id, "pt_padrao");
    assert.deepEqual(linhasDe(padrao).map((linha) => linha.preco), ["50.00", "20.00"]);

    // O contrato de medição mensal: a cobrança da demanda passa a ser a dele.
    await diretaDaOperacao("10308", "SAFRA", { customer_name: "Safra" });
    await saveQuoteFor(db, comercial, orcar("10308", { contrato_id: "safra-2026" }), { agora: JULHO });
    const dem = await doc("demands/10308");
    assert.deepEqual([dem.contrato_id, dem.cobranca], ["safra-2026", "medicao_mensal"]);
  });

  it("só a direta aberta pela Operação, já executada, sem orçamento e com contrato do próprio cliente", async () => {
    await rejeita(saveQuoteFor(db, comercial, orcar("10399"), { agora: JULHO }), "not-found");
    await diretaDaOperacao("10304", "ITAU", { aberta_pela: null });
    await rejeita(saveQuoteFor(db, comercial, orcar("10304"), { agora: JULHO }), "failed-precondition", /aberta pela Operação/);
    await diretaDaOperacao("10305", "ITAU", { etapa: "para_planejar", executado_de: null, executado_ate: null });
    await rejeita(saveQuoteFor(db, comercial, orcar("10305"), { agora: JULHO }), "failed-precondition", /com a Operação até a execução/);
    await diretaDaOperacao("10306", "ITAU", { cancelamento: { motivo: "cliente" } });
    await rejeita(saveQuoteFor(db, comercial, orcar("10306"), { agora: JULHO }), "failed-precondition", /cancelada/);
    await diretaDaOperacao("10307");
    await rejeita(saveQuoteFor(db, comercial, orcar("10307", { contrato_id: "safra-2026" }), { agora: JULHO }), "failed-precondition", /outro cliente/);
    await rejeita(saveQuoteFor(db, wms, orcar("10307"), { agora: JULHO }), "permission-denied");
    await rejeita(saveQuoteFor(db, comercial, orcar("10307", { linhas: [] }), { agora: JULHO }), "invalid-argument", /linhas/);
    assert.equal(await count("quotes"), 0);
    assert.equal(await eventos().then((todos) => todos.length), 0);
    assert.equal((await doc("demands/10307")).contrato_id, null);
  });
});

describe("a perda por prazo de faturamento (Fase 7, parte 7.5a, pergunta 22)", () => {
  const AGOSTO = () => new Date("2026-08-15T15:00:00.000Z");
  const OUTUBRO = () => new Date("2026-10-15T15:00:00.000Z");

  /** Executada em 24 e 25/06, validada e a faturar; o contrato perde o direito de faturar em 90 dias. */
  async function aFaturar(): Promise<string> {
    const numero = await demandaExecutada();
    await db.doc(`demands/${numero}`).update({ etapa: "a_faturar", validacao: { rv: 0, etapa: "a_faturar", autorizacao: "nenhuma", em: "2026-06-26T12:00:00.000Z" } });
    await db.doc("contracts/itau-2026").update({ "autorizacao.prazo_perda_dias": 90 });
    return numero;
  }

  it("só com o prazo do contrato vencido, também a partir de A faturar; reabrir volta a A faturar", async () => {
    const numero = await aFaturar();
    // 25/06 + 90 dias = 23/09: em 15/08 o prazo ainda corre.
    await rejeita(demanda(comercial, "lose", numero, { motivo: "prazo_faturamento" }, AGOSTO), "failed-precondition", /prazo do contrato vencido/);
    // Os outros motivos seguem só antes de faturar.
    await rejeita(demanda(comercial, "lose", numero, { motivo: "preco" }, OUTUBRO), "failed-precondition", /antes de faturar/);

    const perdida = await demanda(comercial, "lose", numero, { motivo: "prazo_faturamento" }, OUTUBRO);
    assert.equal(perdida.etapa, "perdida");
    const gravada = await doc(`demands/${numero}`);
    assert.deepEqual([(gravada.perda as Record<string, unknown>).motivo, (gravada.perda as Record<string, unknown>).etapa_antes], ["prazo_faturamento", "a_faturar"]);
    const perdas = (await eventos(numero)).filter((evento) => evento.type === "demand.lost");
    assert.deepEqual(perdas.map((evento) => (evento.payload as Record<string, unknown>).motivo), ["prazo_faturamento"]);

    await demanda(comercial, "reopen", numero, {}, OUTUBRO);
    assert.equal((await doc(`demands/${numero}`)).etapa, "a_faturar");
  });

  it("a demanda reservada por uma emissão da NFS-e pela Omie não se perde (Fase 7, parte 7.4b)", async () => {
    const numero = await aFaturar();
    await db.doc(`demands/${numero}`).update({ emissao_nf: { id: "nfe_0123456789abcdef0123", desde: "2026-10-15T14:00:00.000Z" } });
    await rejeita(demanda(comercial, "lose", numero, { motivo: "prazo_faturamento" }, OUTUBRO), "failed-precondition", /na emissão da NFS-e pela Omie/);
    assert.equal((await doc(`demands/${numero}`)).etapa, "a_faturar");
    // Sem a reserva (a emissão desistida), perde como antes.
    await db.doc(`demands/${numero}`).update({ emissao_nf: null });
    assert.equal((await demanda(comercial, "lose", numero, { motivo: "prazo_faturamento" }, OUTUBRO)).etapa, "perdida");
  });

  it("o contrato sem prazo de perda não deixa perder por prazo", async () => {
    const numero = await aFaturar();
    await db.doc("contracts/itau-2026").update({ "autorizacao.prazo_perda_dias": null });
    await rejeita(demanda(comercial, "lose", numero, { motivo: "prazo_faturamento" }, OUTUBRO), "failed-precondition", /prazo do contrato vencido/);
    assert.equal((await doc(`demands/${numero}`)).etapa, "a_faturar");
  });
});

