import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { registrarAditivo, salvarContrato } from "./contratos.js";
import { COMERCIAL_OPERATIONS_COLLECTION, type ComercialActor } from "./operations.js";

/**
 * Contratos e aditivos numa transação de verdade (parte 8): contrato é de
 * cliente, a atualização confere a edição, o aditivo de prorrogação muda a
 * vigência, o de preço liga tabelas do mesmo contrato, e o evento não leva
 * número do cliente nem valor. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-comercial";
const CLIENTE = "CLIENTE-A";
const OUTRO = "CLIENTE-B";
const NUMERO_NO_CLIENTE = "CT-998877";
const equipe: ComercialActor = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-contratos-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const customers = db.collection("customers");
  await Promise.all([
    customers.doc("cliente-a").set({ code: CLIENTE, customer_code: CLIENTE, name: "Cliente A", stage: "cliente", status: "active" }),
    customers.doc("cliente-b").set({ code: OUTRO, customer_code: OUTRO, name: "Cliente B", status: "active" }),
    customers.doc("prospect-p").set({ customer_code: "PROSP", name: "Prospect P", stage: "prospect", status: "active" }),
    customers.doc("arquivado").set({ code: "ARQ", customer_code: "ARQ", name: "Arquivado", status: "archived" }),
  ]);
});

after(async () => {
  await deleteApp(app);
});

function contrato(overrides: Record<string, unknown> = {}) {
  return {
    customer_code: CLIENTE,
    nome: "Contrato de serviços",
    numeros: [{ tipo: "contrato", numero: NUMERO_NO_CLIENTE }],
    objeto: "Mudanças e montagem de mobiliário.",
    vigente_de: "2026-07-01",
    vigente_ate: "2027-06-30",
    renovacao: { tipo: "aditivo", aviso_dias: 30 },
    reajuste: { tipo: "negociado" },
    regimes: [{ servico: "Mudança", regime: "por_demanda" }],
    regime_padrao: "por_demanda",
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
    pagamento: {
      tipo: "faixas_do_dia_da_nf",
      faixas: [
        { de: 1, ate: 10, dia: 30, mes: "mesmo" },
        { de: 11, ate: 20, dia: 10, mes: "seguinte" },
        { de: 21, ate: 31, dia: 30, mes: "seguinte" },
      ],
    },
    codigo_servico: "1602",
    documentos: [{ nome: "Contrato assinado", referencia: "OneDrive/Contratos/cliente-a.pdf" }],
    status: "vigente",
    ...overrides,
  };
}

/** Cria com o id escolhido, como a carga de contratos (a callable não aceita id na criação). */
async function criar(id: string, overrides: Record<string, unknown> = {}, key = `criar-${id}`) {
  return salvarContrato(db, equipe, { idempotency_key: key, acao: "criar", contrato_id: id, contrato: contrato(overrides) }, { idNaCriacao: true });
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

async function count(path: string) {
  return (await db.collection(path).get()).size;
}

async function eventos() {
  return (await db.collection("events").get()).docs.map((doc) => doc.data());
}

async function tabela(id: string, data: Record<string, unknown>) {
  await db.collection("price_tables").doc(id).set({
    id,
    variante: "comercial",
    vigente_de: "2026-06-30",
    vigente_ate: "2027-06-30",
    ...data,
  });
}

describe("saveContract", () => {
  it("o comercial cria o contrato do cliente, com evento e recibo", async () => {
    const result = await criar("ct-a");
    assert.deepEqual(result, { ok: true, contrato_id: "ct-a", edicao: 1, criado: true, campos: [], events: [result.events[0]] });

    const doc = (await db.collection("contracts").doc("ct-a").get()).data() ?? {};
    assert.equal(doc.customer_code, CLIENTE);
    assert.equal(doc.edicao, 1);
    assert.equal(doc.vigente_ate, "2027-06-30");
    assert.deepEqual(doc.renovacao, { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null });
    assert.deepEqual(doc.reajuste, { tipo: "negociado", indice: null, data_base: null });
    assert.equal(doc.status, "vigente");
    assert.ok(doc.created_at instanceof Timestamp);
    assert.ok(doc.updated_at instanceof Timestamp);
    assert.equal(doc.created_by.uid, "com-1");
    for (const campo of ["valor", "preco", "price", "valor_estimado"]) assert.equal(campo in doc, false, campo);

    const [event] = await eventos();
    assert.equal(event.type, "contract.created");
    assert.equal(event.customer_code, CLIENTE);
    assert.equal(event.entity_type, "contract");
    assert.equal(event.entity_id, "ct-a");
    assert.deepEqual(event.payload, { contrato_id: "ct-a", regime: "por_demanda", vigente_de: "2026-07-01", vigente_ate: "2027-06-30" });
    assert.equal(JSON.stringify(event).includes(NUMERO_NO_CLIENTE), false, "o evento não leva o número do cliente");
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 1);
  });

  it("pela callable, o contrato novo não aceita id: o servidor gera (parte 6.22)", async () => {
    const error = await rejection(
      salvarContrato(db, equipe, { idempotency_key: "com-id", acao: "criar", contrato_id: "cliente-a-2026", contrato: contrato() }),
    );
    assert.equal(error.code, "invalid-argument");
    assert.match(error.message, /gerado no servidor/);
    assert.equal((await db.collection("contracts").doc("cliente-a-2026").get()).exists, false);
  });

  it("sem id, o contrato ganha id automático", async () => {
    const result = await salvarContrato(db, equipe, { idempotency_key: "auto", acao: "criar", contrato: contrato() });
    assert.match(result.contrato_id, /^[A-Za-z0-9]{20}$/);
    assert.ok((await db.collection("contracts").doc(result.contrato_id).get()).exists);
  });

  it("contrato para prospect é recusado, sem gravar nada", async () => {
    const error = await rejection(criar("ct-p", { customer_code: "PROSP" }));
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /ainda é prospect: contrato é de cliente/);
    assert.equal(await count("contracts"), 0);
    assert.equal(await count("events"), 0);
    assert.equal(await count(COMERCIAL_OPERATIONS_COLLECTION), 0);
  });

  it("cadastro inexistente ou arquivado é recusado", async () => {
    const semCadastro = await rejection(criar("ct-x", { customer_code: "NINGUEM" }));
    assert.equal(semCadastro.code, "failed-precondition");
    assert.match(semCadastro.message, /não encontrado/);
    const arquivado = await rejection(criar("ct-arq", { customer_code: "ARQ" }));
    assert.match(arquivado.message, /arquivado/);
    assert.equal(await count("contracts"), 0);
  });

  it("cadastro antigo, só com `code` e sem `stage`, é cliente", async () => {
    await db.collection("customers").doc("antigo").set({ code: "ANTIGO", name: "Antigo" });
    assert.equal((await criar("ct-antigo", { customer_code: "ANTIGO" })).criado, true);
  });

  it("id com o número do contrato no cliente é invalid-argument, sem gravar nada", async () => {
    for (const id of [NUMERO_NO_CLIENTE, "cliente-a-998877"]) {
      const error = await rejection(criar(id, {}, `criar-numero-${id}`));
      assert.equal(error.code, "invalid-argument", id);
      assert.match(error.message, /^contrato_id: .*número do contrato no cliente/, id);
    }
    assert.equal(await count("contracts"), 0);
    assert.equal(await count("events"), 0);
  });

  it("criar com id que já existe é already-exists", async () => {
    await criar("ct-a");
    const error = await rejection(criar("ct-a", {}, "outra-chave"));
    assert.equal(error.code, "already-exists");
  });

  it("a mesma chave devolve o resultado gravado, sem escrever de novo", async () => {
    const first = await criar("ct-a");
    const second = await criar("ct-a");
    assert.deepEqual(second, { ...first, replayed: true });
    assert.equal(await count("events"), 1);
  });

  it("entrada inválida é invalid-argument, nunca internal", async () => {
    for (const data of [
      null,
      { idempotency_key: "k", acao: "criar", contrato: contrato({ valor: "1500.00" }) },
      { idempotency_key: "k", acao: "criar", contrato: contrato({ vigente_de: "30/06/2026" }) },
      { idempotency_key: "k", acao: "atualizar", contrato_id: "ct-a", contrato: contrato() },
    ]) {
      const error = await rejection(salvarContrato(db, equipe, data));
      assert.equal(error.code, "invalid-argument", JSON.stringify(data));
    }
  });

  it("atualizar grava os campos alterados, sobe a edição e registra o evento", async () => {
    await criar("ct-a");
    const result = await salvarContrato(db, equipe, {
      idempotency_key: "upd-1",
      acao: "atualizar",
      contrato_id: "ct-a",
      edicao: 1,
      contrato: contrato({ status: "encerrado", vigente_ate: "2027-01-31" }),
    });
    assert.deepEqual(result.campos, ["vigente_ate", "status"]);
    assert.equal(result.edicao, 2);
    const doc = (await db.collection("contracts").doc("ct-a").get()).data() ?? {};
    assert.equal(doc.status, "encerrado");
    assert.equal(doc.vigente_ate, "2027-01-31");
    assert.equal(doc.edicao, 2);
    assert.equal(doc.created_by.uid, "com-1");
    const updated = (await eventos()).find((event) => event.type === "contract.updated");
    assert.deepEqual(updated?.payload, { contrato_id: "ct-a", campos: ["vigente_ate", "status"], edicao: 2, status: "encerrado" });
    assert.equal(updated?.title, "Contrato encerrado");
  });

  it("atualizar com a edição velha é recusado", async () => {
    await criar("ct-a");
    await salvarContrato(db, equipe, { idempotency_key: "upd-1", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato({ nome: "Novo nome" }) });
    const error = await rejection(
      salvarContrato(db, equipe, { idempotency_key: "upd-2", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato({ nome: "Outro" }) }),
    );
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /mudou desde que foi aberto/);
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("nome"), "Novo nome");
  });

  it("atualizar sem mudança não grava contrato nem evento", async () => {
    await criar("ct-a");
    const result = await salvarContrato(db, equipe, { idempotency_key: "upd-0", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato() });
    assert.deepEqual(result, { ok: true, contrato_id: "ct-a", edicao: 1, criado: false, campos: [], events: [] });
    assert.equal(await count("events"), 1);
  });

  it("o cliente do contrato não muda", async () => {
    await criar("ct-a");
    const error = await rejection(
      salvarContrato(db, equipe, { idempotency_key: "upd-c", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato({ customer_code: OUTRO }) }),
    );
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /cliente do contrato não muda/);
  });

  it("atualizar contrato que não existe é not-found", async () => {
    const error = await rejection(
      salvarContrato(db, equipe, { idempotency_key: "upd-n", acao: "atualizar", contrato_id: "ct-n", edicao: 1, contrato: contrato() }),
    );
    assert.equal(error.code, "not-found");
  });
});

describe("recordAditivo", () => {
  function aditivo(overrides: Record<string, unknown> = {}) {
    return {
      numero: 1,
      assinado_em: "2027-06-15",
      tipo: "prorrogacao",
      vigente_de: "2027-07-01",
      vigente_ate: "2028-06-30",
      documento: { nome: "Aditivo 1", referencia: "OneDrive/Contratos/aditivo-1.pdf" },
      ...overrides,
    };
  }

  function registrar(overrides: Record<string, unknown> = {}, key = "ad-1", contratoId = "ct-a") {
    return registrarAditivo(db, equipe, { idempotency_key: key, contrato_id: contratoId, aditivo: aditivo(overrides) });
  }

  it("aditivo de prorrogação muda a vigência do contrato na mesma transação e fica no histórico", async () => {
    await criar("ct-a");
    const result = await registrar();
    assert.equal(result.vigencia_alterada, true);
    assert.equal(result.aditivo_id, "1");
    assert.equal(result.edicao, 2);

    const doc = (await db.collection("contracts").doc("ct-a").get()).data() ?? {};
    assert.equal(doc.vigente_de, "2027-07-01");
    assert.equal(doc.vigente_ate, "2028-06-30");
    assert.equal(doc.edicao, 2);

    const historico = (await db.collection("contracts").doc("ct-a").collection("aditivos").doc("1").get()).data() ?? {};
    assert.equal(historico.numero, 1);
    assert.equal(historico.tipo, "prorrogacao");
    assert.equal(historico.customer_code, CLIENTE);
    assert.equal(historico.vigencia_alterada, true);
    assert.deepEqual(historico.vigencia_anterior, { de: "2026-07-01", ate: "2027-06-30" });
    assert.equal(historico.documento_localizado, true);
    assert.ok(historico.registrado_em instanceof Timestamp);

    const event = (await eventos()).find((item) => item.type === "contract.amendment_added");
    assert.deepEqual(event?.payload, {
      contrato_id: "ct-a",
      aditivo_id: "1",
      tipo: "prorrogacao",
      vigencia_alterada: true,
      vigente_ate: "2028-06-30",
      tabelas: 0,
      documento_localizado: true,
    });
    assert.equal(event?.customer_code, CLIENTE);
  });

  it("a edição do contrato muda com a prorrogação: o formulário aberto antes é recusado", async () => {
    await criar("ct-a");
    await registrar();
    const error = await rejection(
      salvarContrato(db, equipe, { idempotency_key: "upd-old", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato({ nome: "X" }) }),
    );
    assert.equal(error.code, "failed-precondition");
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("vigente_ate"), "2028-06-30");
  });

  it("aditivo antigo, registrado depois, não volta a vigência", async () => {
    await criar("ct-a");
    const result = await registrar({ numero: 1, vigente_de: "2025-07-01", vigente_ate: "2026-06-30" });
    assert.equal(result.vigencia_alterada, false);
    assert.equal(result.edicao, 1);
    const doc = (await db.collection("contracts").doc("ct-a").get()).data() ?? {};
    assert.equal(doc.vigente_ate, "2027-06-30");
    assert.equal(doc.edicao, 1);
    const event = (await eventos()).find((item) => item.type === "contract.amendment_added");
    assert.equal(event?.payload.vigencia_alterada, false);
    assert.equal("vigente_ate" in (event?.payload ?? {}), false);
  });

  it("em contrato encerrado, o aditivo entra só no histórico: a vigência e a edição não mudam", async () => {
    await criar("ct-a", { status: "encerrado" });
    const result = await registrar();
    assert.equal(result.vigencia_alterada, false);
    assert.equal(result.edicao, 1);
    assert.equal(result.vigente_ate, "2027-06-30");
    const doc = (await db.collection("contracts").doc("ct-a").get()).data() ?? {};
    assert.equal(doc.status, "encerrado");
    assert.equal(doc.vigente_de, "2026-07-01");
    assert.equal(doc.vigente_ate, "2027-06-30");
    assert.equal(doc.edicao, 1);
    const historico = (await db.collection("contracts").doc("ct-a").collection("aditivos").doc("1").get()).data() ?? {};
    assert.equal(historico.vigencia_alterada, false);
    assert.equal(historico.vigencia_anterior, null);
    const event = (await eventos()).find((item) => item.type === "contract.amendment_added");
    assert.equal(event?.payload.vigencia_alterada, false);
  });

  it("contrato reaberto volta a ser prorrogado pelo aditivo", async () => {
    await criar("ct-a", { status: "encerrado" });
    await salvarContrato(db, equipe, { idempotency_key: "reabrir", acao: "atualizar", contrato_id: "ct-a", edicao: 1, contrato: contrato() });
    const result = await registrar();
    assert.equal(result.vigencia_alterada, true);
    assert.equal(result.edicao, 3);
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("vigente_ate"), "2028-06-30");
  });

  it("aditivo de preço liga a tabela do mesmo contrato e prorroga", async () => {
    await criar("ct-a");
    await tabela("tab-com", { customer_code: CLIENTE, contract_id: "ct-a" });
    await tabela("tab-not", { customer_code: CLIENTE, contract_id: "ct-a", variante: "noturna" });
    const result = await registrar({ numero: 4, tipo: "preco", tabela_ids: ["tab-com", "tab-not"] }, "ad-4");
    assert.equal(result.aditivo_id, "4");
    assert.equal(result.vigencia_alterada, true);
    const historico = (await db.collection("contracts").doc("ct-a").collection("aditivos").doc("4").get()).data() ?? {};
    assert.deepEqual(historico.tabela_ids, ["tab-com", "tab-not"]);
    assert.equal(historico.tipo, "preco");
    const event = (await eventos()).find((item) => item.type === "contract.amendment_added");
    assert.equal(event?.payload.tabelas, 2);
    assert.equal(event?.description, "Aditivo de preço; vigência prorrogada até 30/06/2028; 2 tabelas ligadas.");
  });

  it("aditivo de preço sem vigência nova liga a tabela e mantém a vigência", async () => {
    await criar("ct-a");
    await tabela("tab-com", { customer_code: CLIENTE, contract_id: "ct-a" });
    const result = await registrar({ numero: 2, tipo: "preco", vigente_de: null, vigente_ate: null, tabela_ids: ["tab-com"] }, "ad-2");
    assert.equal(result.vigencia_alterada, false);
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("vigente_ate"), "2027-06-30");
  });

  it("tabela de outro contrato, de outro cliente ou inexistente é recusada, sem gravar nada", async () => {
    await criar("ct-a");
    await criar("ct-b", { customer_code: OUTRO });
    await tabela("tab-outro-contrato", { customer_code: CLIENTE, contract_id: "ct-z" });
    await tabela("tab-outro-cliente", { customer_code: OUTRO, contract_id: "ct-a" });
    await tabela("tab-padrao", { customer_code: null, contract_id: null });
    for (const [id, message] of [
      ["tab-outro-contrato", /não é deste contrato/],
      ["tab-outro-cliente", /não é deste contrato/],
      ["tab-padrao", /não é deste contrato/],
      ["tab-nenhuma", /não encontrada/],
    ] as const) {
      const error = await rejection(registrar({ numero: 4, tipo: "preco", tabela_ids: [id] }, `ad-${id}`));
      assert.equal(error.code, "failed-precondition", id);
      assert.match(error.message, message, id);
    }
    assert.equal(await count("contracts/ct-a/aditivos"), 0);
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("vigente_ate"), "2027-06-30");
  });

  it("aditivo de preço sem tabela é invalid-argument", async () => {
    await criar("ct-a");
    const error = await rejection(registrar({ tipo: "preco", tabela_ids: [] }));
    assert.equal(error.code, "invalid-argument");
  });

  it("sem documento localizado, entra com a marca", async () => {
    await criar("ct-a");
    await registrar({ documento: null });
    const historico = (await db.collection("contracts").doc("ct-a").collection("aditivos").doc("1").get()).data() ?? {};
    assert.equal(historico.documento, null);
    assert.equal(historico.documento_localizado, false);
  });

  it("aditivo registrado não se altera: o mesmo número com outra chave é already-exists", async () => {
    await criar("ct-a");
    await registrar();
    const error = await rejection(registrar({ vigente_ate: "2029-06-30" }, "ad-1b"));
    assert.equal(error.code, "already-exists");
    assert.equal((await db.collection("contracts").doc("ct-a").get()).get("vigente_ate"), "2028-06-30");
  });

  it("a mesma chave devolve o resultado gravado", async () => {
    await criar("ct-a");
    const first = await registrar();
    const second = await registrar();
    assert.deepEqual(second, { ...first, replayed: true });
    assert.equal((await eventos()).filter((event) => event.type === "contract.amendment_added").length, 1);
  });

  it("contrato inexistente é not-found", async () => {
    const error = await rejection(registrar({}, "ad-x", "ct-nenhum"));
    assert.equal(error.code, "not-found");
  });
});
