import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { COMERCIAL_OPERATIONS_COLLECTION } from "./operations.js";
import type { ComercialProfile } from "./profile.js";
import { advanceQuoteFor, saveQuoteFor } from "./quotes.js";

/**
 * Demanda e orçamento no emulador (parte 9, até a aprovação): número único
 * em transação, demanda sem preço e orçamento com preço recalculado pelo
 * servidor, data-base que segura a tabela, duplicar com a tabela de hoje,
 * transições com a edição conferida e a RV congelada na aprovação. Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-comercial";

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };
const outroComercial: ComercialProfile = { uid: "com-2", role: "comercial", name: "Outro" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner", name: "Leonardo", email: "leonardo@dutelog.com.br" };
const admin: ComercialProfile = { uid: "admin-1", role: "admin", name: "Admin" };
const wms: ComercialProfile = { uid: "wms-1", role: "wms", name: "Operador" };

/** 20/06/2026, meio-dia em São Paulo: a v1 da LPU ainda vale. */
const JUNHO = () => new Date("2026-06-20T15:00:00.000Z");
/** 15/07/2026: a v2 (desde 30/06) já vale. */
const JULHO = () => new Date("2026-07-15T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let chave = 0;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-quotes-test");
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
  set("users/com-2", { role: "comercial", nome: "Outro" });

  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", stage: "cliente", status: "active" });
  set("customers/PROSP", { code: "PROSP", customer_code: "PROSP", name: "Prospect Novo", stage: "prospect", status: "active" });
  set("customers/ARQ", { code: "ARQ", customer_code: "ARQ", name: "Arquivado", status: "archived", archived: true });
  set("customers/SAFRA", { code: "SAFRA", customer_code: "SAFRA", name: "Safra", stage: "cliente", status: "active" });

  set("contracts/itau-2026", { id: "itau-2026", customer_code: "ITAU", regime_padrao: "por_demanda", status: "vigente", edicao: 1 });
  set("contracts/itau-antigo", { id: "itau-antigo", customer_code: "ITAU", regime_padrao: "por_demanda", status: "encerrado", edicao: 2 });
  set("contracts/safra-2026", { id: "safra-2026", customer_code: "SAFRA", regime_padrao: "medicao_mensal", status: "vigente", edicao: 1 });

  set("customer_contacts/ct_renata", { id: "ct_renata", customer_code: "ITAU", nome: "Renata", empresa: "Souza & Lopes", ativo: true });
  set("customer_contacts/ct_safra", { id: "ct_safra", customer_code: "SAFRA", nome: "Fulano", empresa: null, ativo: true });
  set("customer_locations/loc_ceic", { id: "loc_ceic", customer_code: "ITAU", nome: "CEIC", ativo: true });
  set("customer_locations/loc_cat", { id: "loc_cat", customer_code: "ITAU", nome: "CAT", ativo: true });
  set("customer_locations/loc_safra", { id: "loc_safra", customer_code: "SAFRA", nome: "Sede", ativo: true });

  const item = (id: string, nome: string, extra: Record<string, unknown> = {}) =>
    set(`lpu_items/${id}`, { id, item: nome, descricao: nome, categoria: "Mobiliário", servico: "Transporte", unidade: "UN", orcavel: true, ativo: true, ...extra });
  item("lpu_mesa", "Mesa de escritório");
  item("lpu_cadeira", "Cadeira giratória");
  item("lpu_cofre", "Cofre", { servico: "Içamento", unidade: "VB" });
  item("lpu_armaz", "Armazenagem", { servico: "Armazenagem", unidade: "M3", orcavel: false });

  // A v1 da LPU do Itaú ainda é a ativa; a v2 entra no meio do teste de data-base.
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
  set("price_tables/pt_itau_noturna", {
    id: "pt_itau_noturna",
    nome: "LPU Itaú v1",
    customer_code: "ITAU",
    contract_id: "itau-2026",
    variante: "Noturna",
    vigente_de: "2025-07-01",
    vigente_ate: null,
    status: "ativa",
    precos: precos("60.00", "25.00"),
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
    precos: precos("45.50", "18.50"),
  });
}

function key(): string {
  chave += 1;
  return `req-${chave}`;
}

function criar(overrides: Record<string, unknown> = {}) {
  return {
    action: "create",
    request_id: key(),
    customer_code: "ITAU",
    contrato_id: "itau-2026",
    canal: "email",
    tipo: "planejada",
    titulo: "Mudança de layout · 12º andar",
    ref_cliente: "CE8977",
    contato_id: "ct_renata",
    recebida_em: "2026-06-19",
    email_assunto: "RES: CE8977 · Remanejamento",
    email_link: "https://outlook.office.com/mail/id/AAMk",
    origem: { local_id: "loc_ceic", complemento: "12º andar" },
    destino: { local_id: "loc_cat", complemento: null },
    execucao: { datas: [], de: "2026-06-24", ate: "2026-06-25", a_definir: false },
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

async function count(path: string): Promise<number> {
  return (await db.collection(path).get()).size;
}

async function eventos(): Promise<Array<Record<string, unknown>>> {
  return (await db.collection("events").get()).docs.map((row) => row.data());
}

type Linha = Record<string, unknown>;

function linhasDe(quote: Record<string, unknown>): Linha[] {
  return quote.linhas as Linha[];
}

async function avancar(caller: ComercialProfile, action: string, numero: string, extra: Record<string, unknown> = {}) {
  const quote = await doc(`quotes/${numero}`);
  return advanceQuoteFor(
    db,
    caller,
    { action, request_id: key(), numero, expected_status: quote.status, expected_edicao: quote.edicao, ...extra },
    { agora: JUNHO },
  );
}

const DINHEIRO = /valor|preco|preço|price|total|cents|centavo|amount|desconto|subtotal/i;

describe("criar: demanda e orçamento com o mesmo número", () => {
  it("cria demands/10001 sem preço e quotes/10001 com o preço da tabela da data-base, com eventos sem valor", async () => {
    const result = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    assert.equal(result.numero, "10001");
    assert.equal(result.rotulo, "10001");
    assert.equal(result.rv, 0);
    assert.equal(result.edicao, 1);
    assert.equal(result.status, "rascunho");
    assert.equal(result.etapa, "em_montagem");

    const demanda = await doc("demands/10001");
    assert.equal(demanda.numero, "10001");
    assert.equal(demanda.customer_code, "ITAU");
    assert.equal(demanda.customer_name, "Itaú Unibanco");
    assert.equal(demanda.contrato_id, "itau-2026");
    assert.equal(demanda.cobranca, "por_demanda");
    assert.equal(demanda.entrada, "comercial");
    assert.equal(demanda.canal, "email");
    assert.equal(demanda.tipo, "planejada");
    assert.equal(demanda.titulo, "Mudança de layout · 12º andar");
    assert.equal(demanda.ref_cliente, "CE8977");
    assert.deepEqual(demanda.solicitante, { contato_id: "ct_renata", empresa: "Souza & Lopes" });
    assert.equal(demanda.recebida_em, "2026-06-19");
    assert.deepEqual(demanda.origem, { local_id: "loc_ceic", complemento: "12º andar" });
    assert.deepEqual(demanda.destino, { local_id: "loc_cat", complemento: null });
    assert.deepEqual(demanda.execucao, { datas: [], de: "2026-06-24", ate: "2026-06-25", a_definir: false });
    assert.equal(demanda.etapa, "em_montagem");
    assert.equal(typeof demanda.etapa_desde, "string");
    assert.deepEqual(demanda.marcos, [{ etapa: "em_montagem", em: "2026-06-20T15:00:00.000Z", por_uid: "com-1" }]);
    assert.equal(demanda.numero_legado, null);
    assert.match(String(demanda.request_id), /^req-\d+$/);
    assert.equal(demanda.schema_version, 1);
    // Reservados para as próximas partes.
    for (const campo of ["escopo_rv", "executado_de", "executado_ate", "perda", "cancelamento"]) assert.equal(demanda[campo], null, campo);
    assert.deepEqual(demanda.escopo, []);
    assert.deepEqual(demanda.os_ids, []);
    assert.equal(demanda.os_seq, 0);
    // A demanda não tem preço.
    assert.deepEqual(Object.keys(demanda).filter((campo) => DINHEIRO.test(campo)), []);

    const quote = await doc("quotes/10001");
    assert.equal(quote.numero, "10001");
    assert.equal(quote.customer_code, "ITAU");
    assert.equal(quote.rv, 0);
    assert.equal(quote.tipo_rv, "proposta");
    assert.equal(quote.status, "rascunho");
    assert.equal(quote.edicao, 1);
    assert.equal(quote.data_base, "2026-06-20");
    assert.deepEqual(quote.tabela, { id: "pt_itau_v1", nome: "LPU Itaú v1", variante: "Comercial" });
    assert.deepEqual(
      linhasDe(quote).map((linha) => [linha.lpu_item_id, linha.codigo, linha.preco, linha.origem, linha.total_cents]),
      [
        ["lpu_mesa", "DTL-0001-T", "40.00", "tabela", 96000],
        ["lpu_cadeira", "DTL-0002-T", "18.50", "tabela", 88800],
      ],
    );
    assert.equal(quote.subtotal_cents, 184800);
    assert.equal(quote.ajustes_cents, 0);
    assert.equal(quote.total_cents, 184800);
    assert.deepEqual(quote.marcas, []);
    assert.equal(quote.condicoes, "Condições da LPU do Itaú.");
    assert.equal(quote.validade_dias, null);
    assert.equal(quote.autor_uid, "com-1");
    assert.equal(quote.aprovacao, null);
    assert.equal(quote.devolucao, null);
    assert.equal(quote.schema_version, 1);

    const counter = await doc("demand_counters/geral");
    assert.equal(counter.ultimo, 10001);

    const events = await eventos();
    assert.deepEqual(events.map((event) => event.type).sort(), ["demand.created", "quote.created"]);
    for (const event of events) {
      assert.equal(event.customer_code, "ITAU");
      assert.equal(event.source, "functions_comercial");
      assert.doesNotMatch(JSON.stringify(event.payload), /cents|preco|40\.00|Renata|Souza|CE8977|Itaú/);
    }
    const created = events.find((event) => event.type === "quote.created");
    assert.deepEqual((created?.payload as Record<string, unknown>).linhas, { tabela: 2, alterado: 0, avulso: 0, ajuste: 0 });
  });

  it("prospect pode; arquivado, cadastro desconhecido e papel fora do Comercial não", async () => {
    const prospect = await saveQuoteFor(db, comercial, criar({ customer_code: "PROSP", contrato_id: null, contato_id: null, origem: null, destino: null }), { agora: JUNHO });
    const demanda = await doc(`demands/${prospect.numero}`);
    assert.equal(demanda.cobranca, "por_demanda");
    assert.equal(demanda.contrato_id, null);
    // Prospect sem tabela própria: Padrão Dutelog, com as condições e a validade dela.
    const quote = await doc(`quotes/${prospect.numero}`);
    assert.deepEqual(quote.tabela, { id: "pt_padrao", nome: "Tabela Padrão Dutelog", variante: "Comercial" });
    assert.equal(quote.validade_dias, 60);

    await rejeita(saveQuoteFor(db, comercial, criar({ customer_code: "ARQ", contrato_id: null, contato_id: null, origem: null, destino: null })), "failed-precondition", /arquivado/);
    await rejeita(saveQuoteFor(db, comercial, criar({ customer_code: "NADA", contrato_id: null, contato_id: null, origem: null, destino: null })), "not-found");
    await rejeita(saveQuoteFor(db, wms, criar()), "permission-denied");
    await rejeita(saveQuoteFor(db, comercial, { ...criar(), customer_code: undefined }), "invalid-argument");
  });

  it("contrato, contato e locais são do mesmo cliente; contrato encerrado não vale; a cobrança vem do contrato", async () => {
    await rejeita(saveQuoteFor(db, comercial, criar({ contrato_id: "safra-2026" })), "failed-precondition", /outro cliente/);
    await rejeita(saveQuoteFor(db, comercial, criar({ contrato_id: "itau-antigo" })), "failed-precondition", /encerrado/);
    await rejeita(saveQuoteFor(db, comercial, criar({ contrato_id: "nao-existe" })), "not-found");
    await rejeita(saveQuoteFor(db, comercial, criar({ contato_id: "ct_safra" })), "failed-precondition", /outro cliente/);
    await rejeita(saveQuoteFor(db, comercial, criar({ origem: { local_id: "loc_safra", complemento: null } })), "failed-precondition", /outro cliente/);
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1", destino_local: "loc_safra" }] })),
      "failed-precondition",
      /outro cliente/,
    );
    assert.equal(await count("demands"), 0);
    assert.equal(await count("quotes"), 0);

    const safra = await saveQuoteFor(
      db,
      comercial,
      criar({ customer_code: "SAFRA", contrato_id: "safra-2026", contato_id: "ct_safra", origem: null, destino: null, linhas: [] }),
      { agora: JUNHO },
    );
    assert.equal((await doc(`demands/${safra.numero}`)).cobranca, "medicao_mensal");
    // Safra sem tabela própria e com contrato: cai na Padrão (sem tabela nessa variante em contrato nenhum).
    assert.equal(((await doc(`quotes/${safra.numero}`)).tabela as Record<string, unknown>).id, "pt_padrao");
  });

  it("criações em paralelo recebem números seguidos, sem buraco nem repetição", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => saveQuoteFor(db, comercial, criar(), { agora: JUNHO })));
    assert.deepEqual(results.map((result) => result.numero).sort(), ["10001", "10002", "10003", "10004", "10005"]);
    assert.equal((await doc("demand_counters/geral")).ultimo, 10005);
    assert.equal(await count("demands"), 5);
    assert.equal(await count("quotes"), 5);
    for (const result of results) {
      assert.equal((await doc(`demands/${result.numero}`)).numero, result.numero);
      assert.equal((await doc(`quotes/${result.numero}`)).numero, result.numero);
    }
  });

  it("request_id repetido devolve o mesmo número, sem demanda nova; com outro conteúdo, already-exists", async () => {
    const input = criar();
    const primeiro = await saveQuoteFor(db, comercial, input, { agora: JUNHO });
    const repetido = await saveQuoteFor(db, comercial, input, { agora: JUNHO });
    assert.equal(repetido.numero, primeiro.numero);
    assert.equal(repetido.replayed, true);
    assert.equal(await count("demands"), 1);
    assert.equal(await count("quotes"), 1);
    assert.equal((await doc("demand_counters/geral")).ultimo, 10001);
    await rejeita(saveQuoteFor(db, comercial, { ...input, titulo: "Outro título" }), "already-exists");
    assert.equal(await count("demands"), 1);

    const segundo = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    assert.equal(segundo.numero, "10002");
  });

  it("contador acertado à mão continua dele: o próximo é o seguinte", async () => {
    await db.doc("demand_counters/geral").set({ ultimo: 10044 });
    const result = await saveQuoteFor(db, comercial, criar({ numero_legado: "1043" }), { agora: JUNHO });
    assert.equal(result.numero, "10045");
    assert.equal((await doc("demands/10045")).numero_legado, "1043");
    assert.deepEqual((await doc("quotes/10045")).marcas, ["legado"]);
    const achada = await db.collection("demands").where("numero_legado", "==", "1043").get();
    assert.deepEqual(achada.docs.map((row) => row.id), ["10045"]);
  });
});

describe("o servidor recalcula o preço", () => {
  it("linha de tabela com outro preço vira alterado, com motivo e o preço da tabela ao lado", async () => {
    const result = await saveQuoteFor(
      db,
      comercial,
      criar({
        linhas: [
          { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "3", preco: "50.00", motivo: "Espera de 2 h na doca" },
          { origem: "avulso", quantidade: "1", preco: "1450.00", motivo: "Fora da LPU", descricao: "Içamento de cofre pela escada", unidade: "VB" },
          { origem: "ajuste", quantidade: "1", preco: "-50.00", motivo: "Arredondamento combinado" },
        ],
      }),
      { agora: JUNHO },
    );
    const quote = await doc(`quotes/${result.numero}`);
    const [alterada, avulsa, ajuste] = linhasDe(quote);
    assert.equal(alterada.origem, "alterado");
    assert.equal(alterada.preco, "50.00");
    assert.equal(alterada.preco_tabela, "40.00");
    assert.equal(alterada.motivo, "Espera de 2 h na doca");
    assert.equal(alterada.total_cents, 15000);
    assert.equal(avulsa.origem, "avulso");
    assert.equal(avulsa.total_cents, 145000);
    assert.equal(ajuste.total_cents, -5000);
    assert.equal(quote.subtotal_cents, 160000);
    assert.equal(quote.ajustes_cents, -5000);
    assert.equal(quote.total_cents, 155000);
    assert.deepEqual(quote.marcas, ["preco_alterado", "item_avulso", "ajuste"]);
  });

  it("o app não manda total nem preço de tabela: campo de dinheiro a mais é recusado", async () => {
    await rejeita(
      saveQuoteFor(db, comercial, criar({ total_cents: 1 })),
      "invalid-argument",
      /total_cents/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1", total_cents: 1 }] })),
      "invalid-argument",
      /total_cents/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: 3 }] })),
      "invalid-argument",
    );
    assert.equal(await count("demands"), 0);
  });

  it("ajuste sem motivo, linha alterada sem motivo e total negativo são recusados, sem gravar nada", async () => {
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" }, { origem: "ajuste", quantidade: "1", preco: "-1.00" }] })),
      "invalid-argument",
      /motivo/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1", preco: "41.00" }] })),
      "invalid-argument",
      /motivo/,
    );
    await rejeita(
      saveQuoteFor(
        db,
        comercial,
        criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" }, { origem: "ajuste", quantidade: "1", preco: "-40.01", motivo: "Desconto" }] }),
      ),
      "invalid-argument",
      /negativo/,
    );
    await rejeita(
      saveQuoteFor(db, comercial, criar({ linhas: [{ origem: "tabela", lpu_item_id: "lpu_armaz", quantidade: "1" }] })),
      "invalid-argument",
      /armazenagem/i,
    );
    assert.equal(await count("demands"), 0);
    assert.equal(await count("quotes"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 0);
    assert.equal(await count("demand_counters"), 0);
  });
});

describe("editar o rascunho", () => {
  it("só em rascunho, com a edição lida; cada salvamento sobe a edição e reprecifica no servidor", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    const result = await saveQuoteFor(
      db,
      comercial,
      {
        action: "update",
        request_id: key(),
        numero,
        expected_edicao: 1,
        titulo: "Mudança de layout · 13º andar",
        linhas: [
          { id: linhasDe(await doc(`quotes/${numero}`))[0].id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "30" },
          { origem: "avulso", quantidade: "2", preco: "100.00", motivo: "Fora da LPU", descricao: "Cofre pequeno", lpu_item_id: "lpu_cofre" },
        ],
        observacoes_internas: "Elevador reservado.",
      },
      { agora: JUNHO },
    );
    assert.equal(result.edicao, 2);
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.edicao, 2);
    assert.equal(quote.total_cents, 30 * 4000 + 20000);
    assert.equal(quote.observacoes_internas, "Elevador reservado.");
    assert.equal((await doc(`demands/${numero}`)).titulo, "Mudança de layout · 13º andar");
    const linhas = linhasDe(quote);
    assert.equal(linhas.length, 2);
    assert.match(String(linhas[1].id), /^ln_/);
    assert.notEqual(linhas[1].id, linhas[0].id);

    // Edição velha: failed-precondition, sem gravar.
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 1, titulo: "Atropelo" }),
      "failed-precondition",
      /edição/,
    );
    // Linha com id que não é deste orçamento.
    await rejeita(
      saveQuoteFor(db, comercial, {
        action: "update",
        request_id: key(),
        numero,
        expected_edicao: 2,
        linhas: [{ id: "ln_forjada", origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "1" }],
      }),
      "invalid-argument",
      /linha/i,
    );
    assert.equal((await doc(`demands/${numero}`)).titulo, "Mudança de layout · 13º andar");

    const updated = (await eventos()).filter((event) => event.type === "quote.updated");
    assert.equal(updated.length, 1);
    assert.deepEqual((updated[0].payload as Record<string, unknown>).linhas, { tabela: 1, alterado: 0, avulso: 1, ajuste: 0 });
    assert.doesNotMatch(JSON.stringify(updated[0].payload), /cents|preco|Elevador/);
  });

  it("fora do rascunho não edita: para aprovar e aprovado recusam", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await avancar(comercial, "submit", numero);
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 1, titulo: "x" }),
      "failed-precondition",
      /rascunho/,
    );
  });
});

describe("data-base", () => {
  it("o orçamento criado antes da troca de tabela continua na tabela antiga quando editado depois", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await carregarV2();

    await saveQuoteFor(
      db,
      comercial,
      {
        action: "update",
        request_id: key(),
        numero,
        expected_edicao: 1,
        linhas: [
          { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10" },
          { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "1" },
        ],
      },
      { agora: JULHO },
    );
    const quote = await doc(`quotes/${numero}`);
    assert.equal(quote.data_base, "2026-06-20");
    assert.deepEqual(quote.tabela, { id: "pt_itau_v1", nome: "LPU Itaú v1", variante: "Comercial" });
    assert.deepEqual(linhasDe(quote).map((linha) => linha.preco), ["40.00", "18.50"]);
    // A v1 foi encerrada pela v2: a aprovação vê a marca.
    assert.deepEqual(quote.marcas, ["tabela_vencida"]);

    // Trocar a variante só em rascunho, reprecificando pela data-base (não por hoje).
    await saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 2, variante: "Noturna" }, { agora: JULHO });
    const noturna = await doc(`quotes/${numero}`);
    assert.deepEqual(noturna.tabela, { id: "pt_itau_noturna", nome: "LPU Itaú v1", variante: "Noturna" });
    assert.deepEqual(linhasDe(noturna).map((linha) => [linha.preco, linha.origem]), [["60.00", "tabela"], ["25.00", "tabela"]]);
    await saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 3, variante: "Comercial" }, { agora: JULHO });
    assert.equal(((await doc(`quotes/${numero}`)).tabela as Record<string, unknown>).id, "pt_itau_v1");

    // Um orçamento novo, em julho, já nasce na v2.
    const novo = await saveQuoteFor(db, comercial, criar(), { agora: JULHO });
    const quoteNovo = await doc(`quotes/${novo.numero}`);
    assert.equal(quoteNovo.data_base, "2026-07-15");
    assert.equal((quoteNovo.tabela as Record<string, unknown>).id, "pt_itau_v2");
  });

  it("variante sem tabela do cliente nem da Padrão: sem tabela, e só item avulso", async () => {
    const result = await saveQuoteFor(
      db,
      comercial,
      criar({
        customer_code: "PROSP",
        contrato_id: null,
        contato_id: null,
        origem: null,
        destino: null,
        variante: "Fim de semana",
        linhas: [{ origem: "avulso", quantidade: "1", preco: "300.00", motivo: "Sem tabela", descricao: "Diária de equipe" }],
      }),
      { agora: JUNHO },
    );
    const quote = await doc(`quotes/${result.numero}`);
    assert.deepEqual(quote.tabela, { id: null, nome: null, variante: "Fim de semana" });
    assert.deepEqual(quote.marcas, ["item_avulso", "sem_tabela"]);
    await rejeita(
      saveQuoteFor(db, comercial, criar({ customer_code: "PROSP", contrato_id: null, contato_id: null, origem: null, destino: null, variante: "Fim de semana" })),
      "invalid-argument",
      /sem tabela/,
    );
  });
});

describe("duplicar", () => {
  it("número novo, data-base de hoje, preço da tabela de hoje e as linhas que mudaram marcadas", async () => {
    const origem = await saveQuoteFor(
      db,
      comercial,
      criar({
        linhas: [
          { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "10" },
          { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "4" },
          { origem: "avulso", quantidade: "1", preco: "300.00", motivo: "Fora da LPU", descricao: "Içamento" },
        ],
      }),
      { agora: JUNHO },
    );
    await carregarV2();

    const copia = await saveQuoteFor(db, comercial, { action: "duplicate", request_id: key(), origem_numero: origem.numero }, { agora: JULHO });
    assert.equal(copia.numero, "10002");
    assert.equal(copia.status, "rascunho");
    const quote = await doc(`quotes/${copia.numero}`);
    assert.equal(quote.data_base, "2026-07-15");
    assert.equal(quote.edicao, 1);
    assert.equal(quote.rv, 0);
    assert.equal(quote.autor_uid, "com-1");
    assert.deepEqual(quote.tabela, { id: "pt_itau_v2", nome: "LPU Itaú v2.0", variante: "Comercial" });
    assert.deepEqual(
      linhasDe(quote).map((linha) => [linha.lpu_item_id, linha.preco, linha.origem, linha.preco_anterior]),
      [
        ["lpu_mesa", "45.50", "tabela", "40.00"],
        ["lpu_cadeira", "18.50", "tabela", null],
        [null, "300.00", "avulso", null],
      ],
    );
    assert.equal(quote.total_cents, 45500 + 7400 + 30000);
    // As linhas são novas: o id é da demanda nova.
    const idsOrigem = linhasDe(await doc(`quotes/${origem.numero}`)).map((linha) => linha.id);
    for (const linha of linhasDe(quote)) assert.ok(!idsOrigem.includes(linha.id));

    const demanda = await doc(`demands/${copia.numero}`);
    assert.equal(demanda.customer_code, "ITAU");
    assert.equal(demanda.titulo, "Mudança de layout · 12º andar");
    assert.equal(demanda.ref_cliente, null);
    assert.equal(demanda.email_link, null);
    assert.equal(demanda.recebida_em, "2026-07-15");
    assert.equal(demanda.duplicado_de, origem.numero);
    assert.equal(demanda.etapa, "em_montagem");

    // O orçamento de origem não muda.
    const original = await doc(`quotes/${origem.numero}`);
    assert.equal(original.edicao, 1);
    assert.equal((original.tabela as Record<string, unknown>).id, "pt_itau_v1");

    const created = (await eventos()).filter((event) => event.type === "quote.created" && event.entity_id === copia.numero);
    assert.equal(created.length, 1);
    assert.equal((created[0].payload as Record<string, unknown>).duplicado_de, origem.numero);
    assert.equal((created[0].payload as Record<string, unknown>).linhas_reprecificadas, 1);
  });

  it("orçamento de origem inexistente é not-found", async () => {
    await rejeita(saveQuoteFor(db, comercial, { action: "duplicate", request_id: key(), origem_numero: "10999" }), "not-found");
  });
});

describe("enviar para aprovação, devolver, aprovar e editar", () => {
  it("o fluxo inteiro, com marcos, eventos e a RV congelada em revisoes/0", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });

    const submit = await avancar(comercial, "submit", numero);
    assert.deepEqual([submit.status, submit.etapa, submit.ja_feito], ["para_aprovar", "para_aprovar", false]);
    assert.equal((await doc(`demands/${numero}`)).etapa, "para_aprovar");

    // O comercial não aprova.
    await rejeita(avancar(comercial, "approve", numero), "permission-denied");
    await rejeita(avancar(admin, "approve", numero), "permission-denied");

    // O owner devolve com nota.
    await rejeita(avancar(owner, "return", numero), "invalid-argument", /nota/);
    const devolvido = await avancar(owner, "return", numero, { nota: "Conferir a quantidade de cadeiras." });
    assert.deepEqual([devolvido.status, devolvido.etapa], ["rascunho", "em_montagem"]);
    const quoteDevolvida = await doc(`quotes/${numero}`);
    assert.deepEqual(
      { ...(quoteDevolvida.devolucao as Record<string, unknown>), em: "x" },
      { nota: "Conferir a quantidade de cadeiras.", por_uid: "owner-1", em: "x" },
    );

    await avancar(comercial, "submit", numero);
    const aprovado = await avancar(owner, "approve", numero);
    assert.deepEqual([aprovado.status, aprovado.etapa], ["aprovado", "para_enviar"]);
    const quote = await doc(`quotes/${numero}`);
    assert.deepEqual({ ...(quote.aprovacao as Record<string, unknown>), em: "x" }, { por_uid: "owner-1", em: "x", edicao: 1 });

    const revisao = await doc(`quotes/${numero}/revisoes/0`);
    assert.equal(revisao.rv, 0);
    assert.equal(revisao.edicao, 1);
    assert.equal(revisao.total_cents, quote.total_cents);
    assert.deepEqual(revisao.linhas, quote.linhas);
    assert.deepEqual(revisao.tabela, quote.tabela);
    assert.equal(revisao.data_base, "2026-06-20");
    assert.deepEqual(revisao.aprovacao, quote.aprovacao);
    assert.equal((revisao.demanda as Record<string, unknown>).titulo, "Mudança de layout · 12º andar");

    const demanda = await doc(`demands/${numero}`);
    assert.equal(demanda.etapa, "para_enviar");
    assert.deepEqual(
      (demanda.marcos as Array<Record<string, unknown>>).map((marco) => [marco.etapa, marco.por_uid]),
      [
        ["em_montagem", "com-1"],
        ["para_aprovar", "com-1"],
        ["em_montagem", "owner-1"],
        ["para_aprovar", "com-1"],
        ["para_enviar", "owner-1"],
      ],
    );

    const tipos = (await eventos()).map((event) => event.type).sort();
    assert.deepEqual(tipos, [
      "demand.created",
      "demand.stage_changed",
      "demand.stage_changed",
      "demand.stage_changed",
      "demand.stage_changed",
      "quote.approved",
      "quote.created",
      "quote.returned",
      "quote.submitted",
      "quote.submitted",
    ]);
    for (const event of await eventos()) {
      assert.doesNotMatch(JSON.stringify(event.payload), /cents|preco|Conferir|Renata/, String(event.type));
      assert.doesNotMatch(`${event.title} ${event.description}`, /R\$|\d[.,]\d/);
    }
    const passo = (await eventos()).find((event) => event.type === "quote.approved")?.payload as Record<string, unknown>;
    assert.equal(passo.etapa_antes, "para_aprovar");
    assert.equal(passo.etapa_depois, "para_enviar");
    assert.equal(passo.status_antes, "para_aprovar");
    assert.equal(passo.status_depois, "aprovado");
    assert.equal(typeof passo.segundos_desde_anterior, "number");
  });

  it("editar volta ao rascunho na mesma RV; aprovar de novo regrava revisoes/0 com a nova edição", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await avancar(comercial, "submit", numero);
    await avancar(owner, "approve", numero);
    const congelada = await doc(`quotes/${numero}/revisoes/0`);

    // Aprovado não aceita salvamento: a cópia congelada fica igual.
    await rejeita(
      saveQuoteFor(db, comercial, { action: "update", request_id: key(), numero, expected_edicao: 1, linhas: [] }),
      "failed-precondition",
    );
    assert.deepEqual(await doc(`quotes/${numero}/revisoes/0`), congelada);

    const editado = await avancar(comercial, "edit", numero);
    assert.deepEqual([editado.status, editado.etapa, editado.rv], ["rascunho", "em_montagem", 0]);
    assert.equal((await doc(`quotes/${numero}`)).aprovacao, null);

    await saveQuoteFor(
      db,
      comercial,
      { action: "update", request_id: key(), numero, expected_edicao: 1, linhas: [{ origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "2" }] },
      { agora: JUNHO },
    );
    await avancar(comercial, "submit", numero);
    await avancar(owner, "approve", numero);
    const regravada = await doc(`quotes/${numero}/revisoes/0`);
    assert.equal(regravada.edicao, 2);
    assert.equal(regravada.total_cents, 8000);
    assert.equal(await count(`quotes/${numero}/revisoes`), 1);
  });

  it("o owner aprova direto do rascunho o orçamento que ele montou; o de outra pessoa, não", async () => {
    const meu = await saveQuoteFor(db, owner, criar(), { agora: JUNHO });
    const aprovado = await avancar(owner, "approve", meu.numero);
    assert.equal(aprovado.status, "aprovado");
    assert.equal((await doc(`quotes/${meu.numero}/revisoes/0`)).edicao, 1);

    const doGuilherme = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await rejeita(avancar(owner, "approve", doGuilherme.numero), "failed-precondition", /rascunho/);
  });

  it("quem montou puxa de volta o que mandou para aprovação; outro comercial e o admin, não", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await avancar(comercial, "submit", numero);
    await rejeita(avancar(outroComercial, "return", numero, { nota: "x" }), "permission-denied");
    await rejeita(avancar(admin, "return", numero, { nota: "x" }), "permission-denied");
    const result = await avancar(comercial, "return", numero);
    assert.equal(result.status, "rascunho");
  });

  it("enviar para aprovação exige cliente, Para, título e uma linha", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar({ contato_id: null, titulo: null, linhas: [] }), { agora: JUNHO });
    const error = await rejeita(avancar(comercial, "submit", numero), "failed-precondition");
    assert.match(error.message, /Para/);
    assert.match(error.message, /título/);
    assert.match(error.message, /linha/);
    assert.equal((await doc(`quotes/${numero}`)).status, "rascunho");
  });

  it("situação ou edição diferente da que a tela viu: failed-precondition; repetir a ação já feita devolve o estado", async () => {
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await rejeita(
      advanceQuoteFor(db, comercial, { action: "submit", request_id: key(), numero, expected_status: "rascunho", expected_edicao: 7 }),
      "failed-precondition",
      /edição/,
    );
    await rejeita(
      advanceQuoteFor(db, owner, { action: "approve", request_id: key(), numero, expected_status: "para_aprovar", expected_edicao: 1 }),
      "failed-precondition",
    );

    const entrada = { action: "submit", numero, expected_status: "rascunho", expected_edicao: 1 };
    const chaveDoToque = key();
    const primeiro = await advanceQuoteFor(db, comercial, { ...entrada, request_id: chaveDoToque }, { agora: JUNHO });
    assert.equal(primeiro.ja_feito, false);
    const eventosAntes = (await eventos()).length;
    // A mesma chave (o app repetindo a chamada): o recibo devolve o resultado gravado.
    const recibo = await advanceQuoteFor(db, comercial, { ...entrada, request_id: chaveDoToque }, { agora: JUNHO });
    assert.deepEqual([recibo.replayed, recibo.status, recibo.events], [true, "para_aprovar", primeiro.events]);
    // Outro toque, com outra chave: já está feito, devolve o estado e não grava evento.
    const repetido = await advanceQuoteFor(db, comercial, { ...entrada, request_id: key() }, { agora: JUNHO });
    assert.deepEqual([repetido.ja_feito, repetido.status, repetido.etapa], [true, "para_aprovar", "para_aprovar"]);
    assert.equal((await eventos()).length, eventosAntes);

    // O owner aprova duas vezes: a segunda só devolve o estado.
    await avancar(owner, "approve", numero);
    const outra = await advanceQuoteFor(
      db,
      owner,
      { action: "approve", request_id: key(), numero, expected_status: "para_aprovar", expected_edicao: 1 },
      { agora: JUNHO },
    );
    assert.deepEqual([outra.ja_feito, outra.status], [true, "aprovado"]);
    assert.equal((await doc(`demands/${numero}`)).etapa, "para_enviar");
  });

  it("orçamento desconhecido é not-found; papel fora do Comercial é permission-denied", async () => {
    await rejeita(
      advanceQuoteFor(db, comercial, { action: "submit", request_id: key(), numero: "10999", expected_status: "rascunho", expected_edicao: 1 }),
      "not-found",
    );
    const { numero } = await saveQuoteFor(db, comercial, criar(), { agora: JUNHO });
    await rejeita(
      advanceQuoteFor(db, wms, { action: "submit", request_id: key(), numero, expected_status: "rascunho", expected_edicao: 1 }),
      "permission-denied",
    );
  });
});
