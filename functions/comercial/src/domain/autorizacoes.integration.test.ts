import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { recordAuthorizationFor } from "./autorizacoes.js";
import { advanceDemandFor } from "./demandas.js";
import type { ComercialProfile } from "./profile.js";
import { advanceQuoteFor, saveQuoteFor } from "./quotes.js";

/**
 * Autorização de faturamento no emulador (parte 15): o registro liga uma ou
 * várias demandas que esperam a autorização e as leva a "a faturar"; uma
 * demanda pode ter mais de uma (o complemento); o cancelamento devolve a
 * etapa quando não sobra outra; divergências viram marcas; o financeiro
 * registra, mas não chama as outras callables. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-comercial";

const comercial: ComercialProfile = { uid: "com-1", role: "comercial", name: "Guilherme", email: "comercial@dutelog.com.br" };
const owner: ComercialProfile = { uid: "owner-1", role: "owner", name: "Leonardo", email: "leonardo@dutelog.com.br" };
const financeiro: ComercialProfile = { uid: "fin-1", role: "financeiro", name: "Financeiro" };
const wms: ComercialProfile = { uid: "wms-1", role: "wms", name: "Operador" };

/** CNPJs sintéticos com dígitos certos: matriz e filial da mesma raiz, e outra raiz. */
const MATRIZ = "11222333000181";
const FILIAL = "11.222.333/0002-62";
const OUTRA_RAIZ = "12345678000195";

/** 20/06/2026: o orçamento; 15/07: executado e validado; 20/07: chega a autorização. */
const JUNHO = () => new Date("2026-06-20T15:00:00.000Z");
const JUNHO_22 = () => new Date("2026-06-22T15:00:00.000Z");
const JULHO = () => new Date("2026-07-15T15:00:00.000Z");
const JULHO_20 = () => new Date("2026-07-20T15:00:00.000Z");

/** Cada RV de proposta: 24 mesas a 40,00 e 48 cadeiras a 18,50. */
const TOTAL_RV = 24 * 4000 + 48 * 1850;

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let chave = 0;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "comercial-autorizacoes-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("users/owner-1", { role: "owner", nome: "Leonardo" });
  set("users/com-1", { role: "comercial", nome: "Guilherme" });
  set("users/fin-1", { role: "financeiro", nome: "Financeiro" });

  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Banco Cliente", document: MATRIZ, stage: "cliente", status: "active" });
  set("customers/PROSP", { code: "PROSP", customer_code: "PROSP", name: "Prospect Novo", stage: "prospect", status: "active" });

  // O cliente com pedido e aceite autoriza o faturamento depois da execução, com prazo de perda de 90 dias.
  set("contracts/itau-2026", {
    id: "itau-2026",
    customer_code: "ITAU",
    regime_padrao: "por_demanda",
    autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: 90 },
    codigo_servico: "1602",
    status: "vigente",
    edicao: 1,
  });

  set("customer_contacts/ct_renata", { id: "ct_renata", customer_code: "ITAU", nome: "Renata", empresa: "Gerenciadora", ativo: true });
  set("customer_contacts/ct_prosp", { id: "ct_prosp", customer_code: "PROSP", nome: "Rodrigo", empresa: null, ativo: true });

  const item = (id: string, nome: string) =>
    set(`lpu_items/${id}`, { id, item: nome, descricao: nome, servico: "Transporte", unidade: "UN", orcavel: true, ativo: true });
  item("lpu_mesa", "Mesa de escritório");
  item("lpu_cadeira", "Cadeira giratória");
  const precos = {
    lpu_mesa: { codigo: "DTL-0001-T", descricao_cliente: "Transporte de mesa", preco: "40.00" },
    lpu_cadeira: { codigo: "DTL-0002-T", descricao_cliente: "Transporte de cadeira", preco: "18.50" },
  };
  set("price_tables/pt_itau_v1", {
    id: "pt_itau_v1",
    nome: "LPU de teste",
    customer_code: "ITAU",
    contract_id: "itau-2026",
    variante: "Comercial",
    vigente_de: "2025-07-01",
    vigente_ate: null,
    status: "ativa",
    precos,
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
    precos,
  });
  await batch.commit();
});

function key(): string {
  chave += 1;
  return `req-${chave}`;
}

const CLIENTES: Record<string, { contrato_id: string | null; contato_id: string }> = {
  ITAU: { contrato_id: "itau-2026", contato_id: "ct_renata" },
  PROSP: { contrato_id: null, contato_id: "ct_prosp" },
};

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

async function orcamento(caller: ComercialProfile, action: string, numero: string, extra: Record<string, unknown> = {}, agora = JUNHO) {
  const quote = await doc(`quotes/${numero}`);
  return advanceQuoteFor(
    db,
    caller,
    { action, request_id: key(), numero, expected_status: quote.status, expected_edicao: quote.edicao, ...extra },
    { agora },
  );
}

async function demanda(caller: ComercialProfile, action: string, numero: string, extra: Record<string, unknown> = {}, agora = JUNHO_22) {
  const [dem, quote] = await Promise.all([doc(`demands/${numero}`), doc(`quotes/${numero}`)]);
  return advanceDemandFor(
    db,
    caller,
    { action, request_id: key(), numero, expected_etapa: dem.etapa, expected_rv: quote.rv, ...extra },
    { agora },
  );
}

/** Proposta montada, aprovada, enviada, fechada e executada em 24 e 25/06: execução a orçar. */
async function executada(customer: keyof typeof CLIENTES = "ITAU"): Promise<string> {
  const { numero } = await saveQuoteFor(
    db,
    comercial,
    {
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
    },
    { agora: JUNHO },
  );
  await orcamento(comercial, "submit", numero);
  await orcamento(owner, "approve", numero);
  await orcamento(comercial, "send", numero);
  await demanda(comercial, "close", numero);
  await demanda(comercial, "register_execution", numero, { executado_de: "2026-06-24", executado_ate: "2026-06-25" }, JULHO);
  return numero;
}

/** Executada e validada sem desvio (a RV fechada): aguardando autorização no contrato com pedido e aceite. */
async function aguardando(customer: keyof typeof CLIENTES = "ITAU"): Promise<string> {
  const numero = await executada(customer);
  await demanda(comercial, "validate", numero, {}, JULHO);
  return numero;
}

function registro(demandas: Array<{ numero: string; rv?: number }>, extra: Record<string, unknown> = {}) {
  return {
    action: "record",
    request_id: key(),
    customer_code: "ITAU",
    tipo: "pedido_aceite",
    pedido: "4500000412",
    aceite: "1000000877",
    recebida_em: "2026-07-18",
    valor: "3696.00",
    demandas,
    tomador_documento: MATRIZ,
    centro_custo: "41220",
    ref_cliente: "FL9464",
    escopo: "Desmontagem e transporte · 12º andar",
    email_link: "https://outlook.office.com/mail/id/AAMk-pedido",
    ...extra,
  };
}

function registrar(caller: ComercialProfile, data: Record<string, unknown>, agora = JULHO_20) {
  return recordAuthorizationFor(db, caller, data, { agora });
}

function cancelar(caller: ComercialProfile, autorizacao_id: string, agora = JULHO_20) {
  return recordAuthorizationFor(
    db,
    caller,
    { action: "cancel", request_id: key(), autorizacao_id, motivo: "Registrada na demanda errada." },
    { agora },
  );
}

type Linha = Record<string, unknown>;

const DINHEIRO = /valor|preco|preço|price|total|cents|centavo|amount|desconto|subtotal|soma/i;

/** Evento sem dinheiro nem número do cliente: nem chave de dinheiro, nem pedido, aceite, tomador ou centro de custo. */
function semDinheiroNemNumeroDoCliente(events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    const payload = JSON.stringify(event.payload);
    assert.doesNotMatch(Object.keys((event.payload as Linha) ?? {}).join(" "), DINHEIRO, String(event.type));
    assert.doesNotMatch(payload, /4500000|1000000|11222333|12345678|41220|FL9464|CE8977|\d[.,]\d|Renata|Gerenciadora|@/, String(event.type));
    assert.doesNotMatch(`${event.title} ${event.description}`, /R\$|\d[.,]\d|4500000|1000000|Banco Cliente/, String(event.type));
  }
}

function chavesDeDinheiro(valor: unknown, caminho = ""): string[] {
  if (Array.isArray(valor)) return valor.flatMap((item, indice) => chavesDeDinheiro(item, `${caminho}[${indice}]`));
  if (valor && typeof valor === "object" && !(valor instanceof Timestamp)) {
    return Object.entries(valor as Record<string, unknown>).flatMap(([nome, item]) => [
      ...(DINHEIRO.test(nome) ? [`${caminho}.${nome}`] : []),
      ...chavesDeDinheiro(item, `${caminho}.${nome}`),
    ]);
  }
  return [];
}

describe("registrar a autorização (N:N)", () => {
  it("duas demandas com a soma batendo: autorização sem marca e as duas a faturar", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const antes = (await eventos()).length;
    const resultado = await registrar(comercial, registro([{ numero: a }, { numero: b }]));

    assert.equal(resultado.status, "registrada");
    assert.equal(resultado.valor_cents, 2 * TOTAL_RV);
    assert.equal(resultado.soma_cents, 2 * TOTAL_RV);
    assert.deepEqual(resultado.marcas, []);
    assert.deepEqual(
      resultado.demandas.map((d) => [d.numero, d.rv, d.rotulo, d.valor_cents, d.etapa]),
      [
        [a, 0, a, TOTAL_RV, "a_faturar"],
        [b, 0, b, TOTAL_RV, "a_faturar"],
      ],
    );
    assert.match(resultado.autorizacao_id, /^aut_[0-9a-f]{20}$/);

    const autorizacao = await doc(`client_authorizations/${resultado.autorizacao_id}`);
    assert.deepEqual(
      { ...autorizacao, created_at: "x", updated_at: "x", operation_id: "x" },
      {
        id: resultado.autorizacao_id,
        customer_code: "ITAU",
        contrato_id: "itau-2026",
        tipo: "pedido_aceite",
        origem: "manual",
        pedido: "4500000412",
        aceite: "1000000877",
        chave_pedido_aceite: "4500000412|1000000877",
        recebida_em: "2026-07-18",
        valor_cents: 2 * TOTAL_RV,
        soma_cents: 2 * TOTAL_RV,
        saldo_cents: 2 * TOTAL_RV,
        demandas: [
          { numero: a, rv: 0, rotulo: a, valor_cents: TOTAL_RV },
          { numero: b, rv: 0, rotulo: b, valor_cents: TOTAL_RV },
        ],
        demanda_numeros: [a, b],
        demandas_pendentes: [],
        medicao_id: null,
        competencia: null,
        contato_id: null,
        tomador_documento: MATRIZ,
        codigo_servico: "1602",
        centro_custo: "41220",
        ref_cliente: "FL9464",
        escopo: "Desmontagem e transporte · 12º andar",
        email_link: "https://outlook.office.com/mail/id/AAMk-pedido",
        documento: null,
        marcas: [],
        status: "registrada",
        registrada_por: "com-1",
        registrada_por_papel: "comercial",
        registrada_em: "2026-07-20T15:00:00.000Z",
        cancelada_por: null,
        cancelada_em: null,
        motivo_cancelamento: null,
        nf_ids: [],
        enviada_portal_em: null,
        omie_lancada_em: null,
        schema_version: 1,
        created_at: "x",
        updated_at: "x",
        operation_id: "x",
      },
    );

    for (const numero of [a, b]) {
      const dem = await doc(`demands/${numero}`);
      assert.equal(dem.etapa, "a_faturar");
      assert.deepEqual(dem.autorizacao_ids, [resultado.autorizacao_id]);
      assert.equal(dem.etapa_desde, "2026-07-20T15:00:00.000Z");
      assert.deepEqual((dem.marcos as Linha[]).at(-1), { etapa: "a_faturar", em: "2026-07-20T15:00:00.000Z", por_uid: "com-1" });
      assert.deepEqual(chavesDeDinheiro(dem), []);
    }

    const novos = (await eventos()).slice(0);
    assert.equal(novos.length - antes, 3);
    const registrado = novos.find((event) => event.type === "client_authorization.recorded");
    assert.deepEqual(registrado?.payload, {
      autorizacao_id: resultado.autorizacao_id,
      tipo: "pedido_aceite",
      contrato_id: "itau-2026",
      demandas: [a, b],
      a_faturar: [a, b],
      marcas: [],
    });
    assert.equal(registrado?.entity_type, "client_authorization");
    assert.equal(registrado?.entity_id, resultado.autorizacao_id);
    assert.equal(registrado?.customer_code, "ITAU");
    const etapas = novos.filter((event) => event.type === "demand.stage_changed" && event.occurred_at === "2026-07-20T15:00:00.000Z");
    assert.deepEqual(
      etapas.map((event) => [(event.payload as Linha).numero, (event.payload as Linha).etapa_antes, (event.payload as Linha).etapa_depois]).sort(),
      [
        [a, "aguardando_autorizacao", "a_faturar"],
        [b, "aguardando_autorizacao", "a_faturar"],
      ],
    );
    semDinheiroNemNumeroDoCliente(novos.filter((event) => event.occurred_at === "2026-07-20T15:00:00.000Z"));

    // A faturar não se perde: para isso, cancele a autorização antes.
    await rejeita(demanda(comercial, "lose", a, { motivo: "cancelado_cliente" }, JULHO_20), "failed-precondition", /antes de faturar/);
  });

  it("uma demanda com mais de uma autorização: o complemento mantém a faturar e soma o id", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const primeira = await registrar(comercial, registro([{ numero: a }, { numero: b }]));
    const complemento = await registrar(comercial, registro([{ numero: a }], { aceite: "1000000901", valor: "120.00" }));

    // A primeira já cobria as RVs inteiras (e também a demanda b): o complemento passa da soma.
    assert.deepEqual(complemento.marcas, ["valor_diverge"]);
    assert.equal(complemento.saldo_cents, null);
    assert.deepEqual(complemento.demandas.map((d) => d.etapa), ["a_faturar"]);
    assert.deepEqual((await doc(`demands/${a}`)).autorizacao_ids, [primeira.autorizacao_id, complemento.autorizacao_id]);
    assert.deepEqual((await doc(`demands/${b}`)).autorizacao_ids, [primeira.autorizacao_id]);
    const evento = (await eventos()).find(
      (event) => event.type === "client_authorization.recorded" && (event.payload as Linha).autorizacao_id === complemento.autorizacao_id,
    );
    assert.deepEqual((evento?.payload as Linha).a_faturar, []);
    assert.deepEqual((evento?.payload as Linha).marcas, ["valor_diverge"]);
    assert.match(String(evento?.description), /complemento/);
  });

  it("autorização parcial e o complemento que fecha o saldo: só a parcial marca valor_diverge", async () => {
    const a = await aguardando();
    const parcial = await registrar(comercial, registro([{ numero: a }], { valor: "1728.00" }));
    assert.deepEqual([parcial.marcas, parcial.soma_cents, parcial.saldo_cents], [["valor_diverge"], TOTAL_RV, TOTAL_RV]);

    const complemento = await registrar(comercial, registro([{ numero: a }], { aceite: "1000000901", valor: "120.00" }));
    assert.deepEqual([complemento.marcas, complemento.soma_cents, complemento.saldo_cents], [[], TOTAL_RV, 12_000]);
    const gravada = await doc(`client_authorizations/${complemento.autorizacao_id}`);
    assert.deepEqual([gravada.marcas, gravada.saldo_cents], [[], 12_000]);

    // Cancelada a parcial, o saldo volta a ser a RV inteira: outro complemento de 120,00 marca.
    await cancelar(comercial, parcial.autorizacao_id);
    const outro = await registrar(comercial, registro([{ numero: a }], { aceite: "1000000902", valor: "120.00" }));
    assert.deepEqual([outro.marcas, outro.saldo_cents], [["valor_diverge"], TOTAL_RV - 12_000]);
  });

  it("valor diferente da soma das RVs: registra e marca valor_diverge", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const resultado = await registrar(comercial, registro([{ numero: a }, { numero: b }], { valor: "3696.01" }));
    assert.deepEqual(resultado.marcas, ["valor_diverge"]);
    assert.equal(resultado.valor_cents, 2 * TOTAL_RV + 1);
    assert.equal(resultado.soma_cents, 2 * TOTAL_RV);
    assert.deepEqual(resultado.demandas.map((d) => d.etapa), ["a_faturar", "a_faturar"]);
    assert.deepEqual((await doc(`client_authorizations/${resultado.autorizacao_id}`)).marcas, ["valor_diverge"]);
  });

  it("a RV citada vale pelo total enviado; RV diferente da validada marca rv_nao_validada; RV não enviada é recusada", async () => {
    // RV01 de execução, só com 22 mesas, validada pelo cliente.
    const numero = await executada();
    await orcamento(comercial, "revise", numero, { motivo: "execucao" }, JULHO);
    const quote = await doc(`quotes/${numero}`);
    const [mesa, cadeira] = quote.linhas as Linha[];
    await saveQuoteFor(
      db,
      comercial,
      {
        action: "update",
        request_id: key(),
        numero,
        expected_edicao: quote.edicao,
        linhas: [
          { id: mesa.id, origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "22" },
          { id: cadeira.id, origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "48" },
        ],
      },
      { agora: JULHO },
    );
    await orcamento(comercial, "send", numero, {}, JULHO);
    await demanda(comercial, "validate", numero, {}, JULHO);
    const rv1 = 22 * 4000 + 48 * 1850;

    await rejeita(registrar(comercial, registro([{ numero, rv: 2 }], { valor: "1768.00" })), "failed-precondition", /RV02 não foi enviada/);

    const validada = await registrar(comercial, registro([{ numero }], { valor: "1768.00" }));
    assert.equal(rv1, 176_800);
    assert.deepEqual([validada.demandas[0].rv, validada.demandas[0].valor_cents, validada.marcas], [1, rv1, []]);
    assert.equal(validada.demandas[0].rotulo, `${numero} – RV01`);

    const outra = await registrar(comercial, registro([{ numero, rv: 0 }], { aceite: "1000000999", valor: "1848.00" }));
    assert.deepEqual([outra.demandas[0].rv, outra.demandas[0].valor_cents, outra.marcas], [0, TOTAL_RV, ["rv_nao_validada"]]);
  });

  it("tomador da filial não marca; de outra raiz marca tomador_outra_raiz; CNPJ inválido é recusado", async () => {
    const [a, b, c] = [await aguardando(), await aguardando(), await aguardando()];
    const filial = await registrar(comercial, registro([{ numero: a }], { valor: "1848.00", tomador_documento: FILIAL }));
    assert.deepEqual(filial.marcas, []);
    assert.equal((await doc(`client_authorizations/${filial.autorizacao_id}`)).tomador_documento, "11222333000262");

    const outra = await registrar(comercial, registro([{ numero: b }], { aceite: "1000000902", valor: "1848.00", tomador_documento: OUTRA_RAIZ }));
    assert.deepEqual(outra.marcas, ["tomador_outra_raiz"]);

    await rejeita(
      registrar(comercial, registro([{ numero: c }], { aceite: "1000000903", valor: "1848.00", tomador_documento: "11222333000199" })),
      "invalid-argument",
      /CNPJ do tomador inválido/,
    );
    assert.equal((await doc(`demands/${c}`)).etapa, "aguardando_autorizacao");
  });

  it("tomador com a raiz mascarada, como no e-mail do cliente: completa com a raiz do cadastro, ou pede o CNPJ inteiro", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const mascarado = await registrar(comercial, registro([{ numero: a }], { valor: "1848.00", tomador_documento: "11.222.XXX/0002-62" }));
    assert.deepEqual(mascarado.marcas, []);
    assert.equal((await doc(`client_authorizations/${mascarado.autorizacao_id}`)).tomador_documento, "11222333000262");

    const casos: Array<[string, RegExp]> = [
      ["12.345.XXX/0001-95", /outra raiz/],
      ["11.222.XXX/0002-63", /não fecha/],
      ["11.222.333/XXXX-62", /CNPJ do tomador inválido/],
    ];
    for (const [tomador, mensagem] of casos) {
      await rejeita(
        registrar(comercial, registro([{ numero: b }], { aceite: "1000000904", valor: "1848.00", tomador_documento: tomador })),
        "invalid-argument",
        mensagem,
      );
    }
    assert.equal((await doc(`demands/${b}`)).etapa, "aguardando_autorizacao");
    assert.equal(await count("client_authorizations"), 1);

    // O cadastro sem CNPJ não tem como completar.
    await db.doc("customers/ITAU").update({ document: null });
    await rejeita(
      registrar(comercial, registro([{ numero: b }], { aceite: "1000000904", valor: "1848.00", tomador_documento: "11.222.XXX/0002-62" })),
      "invalid-argument",
      /não tem CNPJ/,
    );
  });
});

describe("o que a autorização recusa", () => {
  it("demanda de outro cliente: recusada, e nada é gravado", async () => {
    const a = await aguardando();
    const prospect = await executada("PROSP");
    await demanda(comercial, "validate", prospect, {}, JULHO);
    assert.equal((await doc(`demands/${prospect}`)).etapa, "a_faturar");
    const antes = (await eventos()).length;

    await rejeita(registrar(comercial, registro([{ numero: a }, { numero: prospect }])), "failed-precondition", /outro cliente/);
    assert.equal(await count("client_authorizations"), 0);
    assert.equal((await doc(`demands/${a}`)).etapa, "aguardando_autorizacao");
    assert.equal((await doc(`demands/${a}`)).autorizacao_ids, undefined);
    assert.equal((await eventos()).length, antes);
  });

  it("demanda fora de aguardando autorização (e a faturar sem autorização): recusada, mesmo junto de uma que pode", async () => {
    const a = await aguardando();
    const semValidar = await executada();
    await rejeita(
      registrar(comercial, registro([{ numero: a }, { numero: semValidar }])),
      "failed-precondition",
      new RegExp(`${semValidar} está com a execução a orçar`),
    );
    assert.equal(await count("client_authorizations"), 0);
    assert.equal((await doc(`demands/${a}`)).etapa, "aguardando_autorizacao");

    // A faturar sem nenhuma autorização (contrato que não pede) não recebe complemento.
    await db.doc(`demands/${a}`).update({ etapa: "a_faturar" });
    await rejeita(registrar(comercial, registro([{ numero: a }], { valor: "1848.00" })), "failed-precondition", /a faturar/);
    await rejeita(registrar(comercial, registro([{ numero: "99999" }], { valor: "1848.00" })), "not-found", /99999/);
  });

  it("a entrada: pedido e aceite no tipo pedido_aceite, valor com ponto e maior que zero, recebida até hoje, demanda sem repetir", async () => {
    const a = await aguardando();
    const casos: Array<[Record<string, unknown>, RegExp]> = [
      [{ aceite: null }, /informe o aceite/],
      [{ pedido: "" }, /informe o pedido/],
      [{ tipo: "portal", pedido: null, aceite: null }, /pedido do portal/],
      [{ tipo: "outro", pedido: null, aceite: null, email_link: null }, /prova da autorização/],
      [{ valor: "3.696,00" }, /decimal com ponto/],
      [{ valor: 3696 }, /./],
      [{ valor: "0.00" }, /maior que zero/],
      [{ recebida_em: "2026-07-21" }, /depois de hoje/],
      [{ recebida_em: "18/07/2026" }, /Data inválida/],
      [{ demandas: [{ numero: a }, { numero: a }] }, /duas vezes/],
      [{ demandas: [] }, /ao menos uma demanda/],
      [{ pedido: "45000 <script>" }, /Pedido: letras/],
      [{ email_link: "outlook.com/x" }, /Link do e-mail/],
      [{ preco: "10.00" }, /./],
      [{ action: "editar" }, /Ação inválida/],
      [{ tipo: "medicao_aprovada", pedido: null, aceite: null, documento: { nome: "Medição.pdf", referencia: "pasta do cliente" } }, /medição mensal/],
    ];
    for (const [extra, mensagem] of casos) {
      await rejeita(registrar(comercial, registro([{ numero: a }], extra)), "invalid-argument", mensagem);
    }
    assert.equal(await count("client_authorizations"), 0);

  });

  it("o tipo segue o contrato: no de pedido e aceite, outro registro ou portal são recusados", async () => {
    const a = await aguardando();
    const casos: Array<Record<string, unknown>> = [
      { tipo: "outro", pedido: null, aceite: null },
      { tipo: "outro", aceite: null, documento: { nome: "Autorização.pdf", referencia: "pasta do cliente" } },
      { tipo: "portal", aceite: null },
    ];
    for (const extra of casos) {
      await rejeita(
        registrar(comercial, registro([{ numero: a }], { valor: "1848.00", ...extra })),
        "failed-precondition",
        new RegExp(`${a} é de contrato com autorização por pedido e aceite`),
      );
    }
    assert.equal(await count("client_authorizations"), 0);
    assert.equal((await doc(`demands/${a}`)).etapa, "aguardando_autorizacao");

    // A validação sem o tipo do contrato (o legado) aceita outro registro, com o link do e-mail como prova.
    const dem = await doc(`demands/${a}`);
    await db.doc(`demands/${a}`).update({ validacao: { ...(dem.validacao as Linha), autorizacao: null } });
    const outro = await registrar(comercial, registro([{ numero: a }], { tipo: "outro", pedido: null, aceite: null, valor: "1848.00" }));
    assert.equal(outro.status, "registrada");
    assert.equal((await doc(`client_authorizations/${outro.autorizacao_id}`)).chave_pedido_aceite, null);
  });
});

describe("cancelar a autorização", () => {
  it("devolve a aguardando autorização a demanda sem outra autorização; a que tem complemento segue a faturar", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const primeira = await registrar(comercial, registro([{ numero: a }, { numero: b }]));
    const complemento = await registrar(comercial, registro([{ numero: a }], { aceite: "1000000901", valor: "120.00" }));

    const cancelada = await cancelar(comercial, primeira.autorizacao_id);
    assert.equal(cancelada.status, "cancelada");
    assert.equal(cancelada.ja_feito, false);
    assert.deepEqual(cancelada.demandas.map((d) => [d.numero, d.etapa]), [
      [a, "a_faturar"],
      [b, "aguardando_autorizacao"],
    ]);
    const demA = await doc(`demands/${a}`);
    const demB = await doc(`demands/${b}`);
    assert.deepEqual([demA.etapa, demA.autorizacao_ids], ["a_faturar", [complemento.autorizacao_id]]);
    assert.deepEqual([demB.etapa, demB.autorizacao_ids], ["aguardando_autorizacao", []]);
    assert.deepEqual((demB.marcos as Linha[]).slice(-2).map((marco) => marco.etapa), ["a_faturar", "aguardando_autorizacao"]);
    const autorizacao = await doc(`client_authorizations/${primeira.autorizacao_id}`);
    assert.deepEqual(
      [autorizacao.status, autorizacao.cancelada_por, autorizacao.cancelada_em, autorizacao.motivo_cancelamento],
      ["cancelada", "com-1", "2026-07-20T15:00:00.000Z", "Registrada na demanda errada."],
    );
    const evento = (await eventos()).find((event) => event.type === "client_authorization.cancelled");
    assert.deepEqual(evento?.payload, {
      autorizacao_id: primeira.autorizacao_id,
      tipo: "pedido_aceite",
      contrato_id: "itau-2026",
      demandas: [a, b],
      devolvidas: [b],
      marcas: [],
    });
    semDinheiroNemNumeroDoCliente([evento ?? {}]);

    // Cancelar de novo só devolve o estado.
    const antes = (await eventos()).length;
    const deNovo = await cancelar(comercial, primeira.autorizacao_id);
    assert.equal(deNovo.ja_feito, true);
    assert.equal((await eventos()).length, antes);

    // Cancelado o complemento, a outra volta também; e aguardando, ela se perde de novo.
    await cancelar(comercial, complemento.autorizacao_id);
    assert.equal((await doc(`demands/${a}`)).etapa, "aguardando_autorizacao");
    const perdida = await demanda(comercial, "lose", b, { motivo: "cancelado_cliente" }, JULHO_20);
    assert.equal(perdida.etapa, "perdida");
    const reaberta = await demanda(comercial, "reopen", b, {}, JULHO_20);
    assert.equal(reaberta.etapa, "aguardando_autorizacao");

    // Cancelada a autorização, o mesmo pedido e aceite podem ser registrados de novo.
    const nova = await registrar(comercial, registro([{ numero: a }, { numero: b }]));
    assert.deepEqual(nova.demandas.map((d) => d.etapa), ["a_faturar", "a_faturar"]);
  });

  it("autorização já usada no faturamento não se cancela; a que não existe é not-found", async () => {
    const a = await aguardando();
    const registrada = await registrar(comercial, registro([{ numero: a }], { valor: "1848.00" }));
    await db.doc(`client_authorizations/${registrada.autorizacao_id}`).update({ nf_ids: ["nf_1"] });
    await rejeita(cancelar(comercial, registrada.autorizacao_id), "failed-precondition", /usada no faturamento/);
    assert.equal((await doc(`demands/${a}`)).etapa, "a_faturar");
    await rejeita(cancelar(comercial, "aut_naoexiste"), "not-found");
    await rejeita(
      recordAuthorizationFor(db, comercial, { action: "cancel", request_id: key(), autorizacao_id: registrada.autorizacao_id, motivo: "" }, { agora: JULHO_20 }),
      "invalid-argument",
      /por que/,
    );
  });
});

describe("quem registra", () => {
  it("o financeiro registra e cancela, mas não chama as outras callables do Comercial", async () => {
    const a = await aguardando();
    const registrada = await registrar(financeiro, registro([{ numero: a }], { valor: "1848.00" }));
    assert.equal(registrada.status, "registrada");
    const autorizacao = await doc(`client_authorizations/${registrada.autorizacao_id}`);
    assert.deepEqual([autorizacao.registrada_por, autorizacao.registrada_por_papel], ["fin-1", "financeiro"]);
    const evento = (await eventos()).find((event) => event.type === "client_authorization.recorded");
    assert.deepEqual((evento?.actor as Linha).role, "financeiro");
    assert.equal((await cancelar(financeiro, registrada.autorizacao_id)).status, "cancelada");

    const quote = await doc(`quotes/${a}`);
    const dem = await doc(`demands/${a}`);
    await rejeita(
      saveQuoteFor(db, financeiro, { action: "update", request_id: key(), numero: a, expected_edicao: quote.edicao, titulo: "Outro" }, { agora: JULHO_20 }),
      "permission-denied",
    );
    await rejeita(
      advanceQuoteFor(db, financeiro, { action: "revise", request_id: key(), numero: a, expected_status: quote.status, expected_edicao: quote.edicao, motivo: "correcao" }, { agora: JULHO_20 }),
      "permission-denied",
    );
    await rejeita(
      advanceDemandFor(db, financeiro, { action: "lose", request_id: key(), numero: a, expected_etapa: dem.etapa, expected_rv: quote.rv, motivo: "cancelado_cliente" }, { agora: JULHO_20 }),
      "permission-denied",
    );
  });

  it("operação e cliente não registram", async () => {
    const a = await aguardando();
    for (const caller of [wms, { uid: "cli-1", role: "cliente", customer_code: "ITAU" } as ComercialProfile]) {
      await rejeita(registrar(caller, registro([{ numero: a }], { valor: "1848.00" })), "permission-denied", /não tem acesso ao Comercial/);
    }
    assert.equal(await count("client_authorizations"), 0);
  });
});

describe("idempotência", () => {
  it("a mesma chave devolve o resultado gravado; com outro conteúdo, already-exists; o mesmo pedido e aceite ativo, already-exists", async () => {
    const [a, b] = [await aguardando(), await aguardando()];
    const entrada = registro([{ numero: a }, { numero: b }]);
    const primeiro = await registrar(comercial, entrada);
    const antes = (await eventos()).length;

    const repetido = await registrar(comercial, entrada);
    assert.equal(repetido.replayed, true);
    assert.equal(repetido.autorizacao_id, primeiro.autorizacao_id);
    assert.equal(await count("client_authorizations"), 1);
    assert.equal((await eventos()).length, antes);
    assert.deepEqual((await doc(`demands/${a}`)).autorizacao_ids, [primeiro.autorizacao_id]);

    await rejeita(registrar(comercial, { ...entrada, valor: "3700.00" }), "already-exists", /outro conteúdo/);

    // Outra chave com o mesmo pedido e aceite (máscara diferente): já registrado.
    await rejeita(
      registrar(comercial, registro([{ numero: a }], { pedido: "4500-000412", aceite: " 1000000877 ", valor: "1848.00" })),
      "already-exists",
      /já estão registrados/,
    );
    assert.equal(await count("client_authorizations"), 1);
  });
});
