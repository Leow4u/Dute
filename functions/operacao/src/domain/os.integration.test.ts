import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { EVENTS_COLLECTION } from "./events.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION, SERVICE_ORDER_COUNTERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

const PROJECT_ID = "demo-dute-operacao";
const NUMERO = "10045";
const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const VALTER = "col_cccccccccccccccc";
const VAN = "vei_aaaaaaaaaaaaaaaa";
const TRUCK = "vei_bbbbbbbbbbbbbbbb";

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Marina" };
const campo: OperacaoProfile = { uid: "campo-1", role: "campo", name: "Paulo" };

const MESA = {
  id: "ln_1",
  lpu_item_id: "lpu_mesa",
  codigo: "DTL-10",
  item: "Estação",
  descricao: "Montagem de estação",
  servico: "Montagem",
  unidade: "UN",
  quantidade: "60",
  preco: "88.50",
  preco_tabela: "80.00",
  origem: "alterado",
  motivo: "negociado",
  total_cents: 17700,
};
const CADEIRA = { ...MESA, id: "ln_2", codigo: "3.05", item: "Cadeira", descricao: "Transporte de cadeira", servico: "Transporte", quantidade: "160" };

function colaborador(id: string, nome: string, extra: Record<string, unknown> = {}) {
  return { id, nome, cpf: "52998224725", funcao: "Montador", telefone: null, cnh: null, ativo: true, edicao: 1, ...extra };
}

function veiculo(id: string, placa: string, extra: Record<string, unknown> = {}) {
  return { id, placa, tipo: "Baú", modelo: "Delivery", capacidade_kg: 5000, capacidade_m3: 30, ativo: true, edicao: 1, ...extra };
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-os-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await db.collection("demands").doc(NUMERO).set({
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    escopo_rv: 0,
    executado_de: null,
    perda: null,
    cancelamento: null,
    validacao: null,
    origem: { local_id: "loc_faria", complemento: "doca pelo subsolo 2" },
    destino: { local_id: "loc_safra", complemento: null },
  });
  await db.collection("customer_locations").doc("loc_faria").set({
    customer_code: "ITAU",
    nome: "Faria Lima",
    endereco: { logradouro: "Av. Brig. Faria Lima", numero: "3500", complemento: "5º andar", bairro: "Itaim Bibi", cidade: "São Paulo", uf: "SP" },
  });
  await db.collection("customer_locations").doc("loc_safra").set({ customer_code: "SAFRA", nome: "Paulista", endereco: { logradouro: "Av. Paulista", numero: "2100" } });
  await db.collection("quotes").doc(NUMERO).set({ status: "enviado", rv: 0, customer_code: "ITAU", tipo_rv: "proposta" });
  await db.collection("quotes").doc(NUMERO).collection("revisoes").doc("0").set({
    linhas: [MESA, CADEIRA, { id: "ln_aj", origem: "ajuste", item: "Ajuste comercial", descricao: "Ajuste comercial", quantidade: "1", preco: "-10.00", total_cents: -1000 }],
  });
  await db.collection("collaborators").doc(ANA).set(colaborador(ANA, "Ana Souza", { papeis: ["lider", "motorista"], usuario_uid: "uid-ana", usuario_email: "ana@dutelog.com.br" }));
  await db.collection("collaborators").doc(BRUNO).set(colaborador(BRUNO, "Bruno Lima", { ativo: false }));
  await db.collection("collaborators").doc(VALTER).set(colaborador(VALTER, "Valter Moreira", { vinculo: "terceiro", empresa: "Rota Sul", papeis: ["motorista"] }));
  await db.collection("vehicles").doc(VAN).set(veiculo(VAN, "DEF4G56"));
  await db.collection("vehicles").doc(TRUCK).set(veiculo(TRUCK, "FGH2B34", { dono: "terceiro", empresa: "Rota Sul" }));
});

after(async () => {
  await deleteApp(app);
});

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

async function lerOs(numero: string) {
  return (await db.collection(SERVICE_ORDERS_COLLECTION).doc(numero).get()).data() ?? {};
}

async function eventos(tipo?: string) {
  const todos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((item) => item.data());
  return tipo ? todos.filter((evento) => evento.type === tipo) : todos;
}

const JANELA = { data: "2099-01-27", inicio: "07:30", fim: "18:00" };

describe("abrir a OS com todo o saldo", () => {
  it("abre 10045-01 sem preço, com o nome do cliente e os locais copiados, e repetir devolve a mesma", async () => {
    const criada = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    assert.deepEqual([criada.numero, criada.edicao, criada.numeros], ["10045-01", 1, ["10045-01"]]);
    const deNovo = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    assert.equal(deNovo.replayed, true);

    const os = await lerOs("10045-01");
    const texto = JSON.stringify(os);
    assert.equal(os.status, "aberta");
    assert.deepEqual(os.itens.map((item: { id: string; planejado: string }) => [item.id, item.planejado]), [["ln_1", "60"], ["ln_2", "160"]]);
    assert.deepEqual(os.servicos, ["transporte", "montagem"]);
    assert.deepEqual(os.locais.origem, {
      local_id: "loc_faria",
      nome: "Faria Lima",
      endereco: "Av. Brig. Faria Lima, 3500 · 5º andar · Itaim Bibi · São Paulo/SP",
      complemento: "doca pelo subsolo 2",
      contato: null,
    });
    assert.equal(os.locais.destino.nome, null, "local de outro cliente não entra");
    assert.equal(os.janela, null);
    assert.deepEqual(os.equipe, []);
    // O campo lê a OS e não o cadastro do cliente: o nome vem copiado da demanda (parte 3.8a).
    assert.equal(os.cliente_nome, "Itaú Unibanco");
    for (const proibido of ["88.50", "17700", "negociado", "Ajuste", "preco"]) assert.equal(texto.includes(proibido), false, proibido);

    const [evento] = await eventos("os.created");
    assert.equal(evento.customer_code, "ITAU");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: NUMERO, seq: 1, linhas: 2 });
    assert.deepEqual((await db.collection("demands").doc(NUMERO).get()).data()?.os_numeros, ["10045-01"]);
    assert.equal((await db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(NUMERO).get()).data()?.ultimo, 1);
  });

  it("sem saldo não abre outra; campo não abre", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "um", demanda: NUMERO });
    const segunda = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "dois", demanda: NUMERO }));
    assert.equal(segunda.message, "Todo o saldo da demanda já está em OS.");
    const negado = await rejection(saveServiceOrderFor(db, campo, { action: "create", idempotency_key: "campo", demanda: NUMERO }));
    assert.equal(negado.code, "permission-denied");
  });

  it("demanda que saiu de Para planejar não vira OS", async () => {
    await db.collection("demands").doc(NUMERO).update({ executado_de: "2026-10-16" });
    const error = await rejection(saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "tarde", demanda: NUMERO }));
    assert.equal(error.code, "failed-precondition");
    assert.match(error.message, /Para planejar/);
  });
});

describe("planejar várias OS com fatias do saldo", () => {
  it("cria as OS na ordem, copia equipe e veículos e grava um evento por OS, sem nome nem placa", async () => {
    const plano = await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano",
      demanda: NUMERO,
      ordens: [
        {
          itens: [{ id: "ln_1", planejado: "60" }, { id: "ln_2", planejado: "100" }],
          janela: JANELA,
          equipe: [{ colaborador_id: ANA, papel: "lider" }, { colaborador_id: VALTER }],
          veiculos: [VAN, TRUCK],
          instrucoes: "Elevador de carga reservado 07:00–12:00.",
          contatos: { origem: { nome: "Renata Campos", telefone: "(11) 98765-4321" } },
        },
        { itens: [{ id: "ln_2", planejado: "60" }] },
      ],
    });
    assert.deepEqual(plano.numeros, ["10045-01", "10045-02"]);

    const primeira = await lerOs("10045-01");
    assert.equal(primeira.status, "agendada");
    assert.deepEqual(primeira.janela, JANELA);
    assert.deepEqual(primeira.equipe, [
      { colaborador_id: ANA, nome: "Ana Souza", papel: "lider", vinculo: "proprio", empresa: null, no_app: true },
      { colaborador_id: VALTER, nome: "Valter Moreira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul", no_app: false },
    ]);
    assert.deepEqual(primeira.equipe_uids, ["uid-ana"]);
    assert.deepEqual(primeira.veiculos.map((item: { placa: string; dono: string }) => [item.placa, item.dono]), [["DEF4G56", "proprio"], ["FGH2B34", "terceiro"]]);
    assert.deepEqual(primeira.locais.origem.contato, { nome: "Renata Campos", telefone: "11987654321" });
    assert.equal(primeira.instrucoes, "Elevador de carga reservado 07:00–12:00.");
    assert.equal(JSON.stringify(primeira).includes("52998224725"), false, "a OS não leva CPF");

    const segunda = await lerOs("10045-02");
    assert.equal(segunda.status, "aberta");
    assert.deepEqual(segunda.itens.map((item: { id: string; planejado: string }) => [item.id, item.planejado]), [["ln_2", "60"]]);
    assert.deepEqual(segunda.servicos, ["transporte"]);

    const planejadas = await eventos("os.planned");
    assert.equal(planejadas.length, 2);
    const texto = JSON.stringify(planejadas);
    for (const proibido of ["Ana", "Valter", "DEF4G56", "Renata", "Rota Sul", "Elevador"]) assert.equal(texto.includes(proibido), false, proibido);
    const daPrimeira = planejadas.find((evento) => evento.entity_id === "10045-01");
    assert.deepEqual(daPrimeira?.payload.equipe, [
      { colaborador_id: ANA, papel: "lider", vinculo: "proprio" },
      { colaborador_id: VALTER, papel: "motorista", vinculo: "terceiro" },
    ]);
    assert.deepEqual((await db.collection("demands").doc(NUMERO).get()).data()?.os_numeros, ["10045-01", "10045-02"]);
    assert.equal((await db.collection(SERVICE_ORDER_COUNTERS_COLLECTION).doc(NUMERO).get()).data()?.ultimo, 2);
  });

  it("acima do saldo, nada é gravado", async () => {
    const error = await rejection(saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "demais",
      demanda: NUMERO,
      ordens: [{ itens: [{ id: "ln_1", planejado: "40" }] }, { itens: [{ id: "ln_1", planejado: "20.001" }] }],
    }));
    assert.equal(error.message, "DTL-10 Estação: o saldo é 20 e a OS pede 20.001.");
    assert.equal((await db.collection(SERVICE_ORDERS_COLLECTION).get()).size, 0);
    assert.equal((await eventos()).length, 0);
  });

  it("pessoa desativada e data que já passou são recusadas", async () => {
    const parado = await rejection(saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "inativo",
      demanda: NUMERO,
      ordens: [{ itens: [{ id: "ln_1", planejado: "1" }], equipe: [{ colaborador_id: BRUNO }] }],
    }));
    assert.match(parado.message, /não está ativo/);
    const passada = await rejection(saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "ontem",
      demanda: NUMERO,
      ordens: [{ itens: [{ id: "ln_1", planejado: "1" }] }, { itens: [{ id: "ln_2", planejado: "1" }], janela: { data: "2020-01-01" } }],
    }));
    assert.equal(passada.message, "OS 2: A data do agendamento já passou.");
  });

  it("dois planejamentos ao mesmo tempo nunca passam do saldo", async () => {
    const pedido = (chave: string) =>
      saveServiceOrderFor(db, interno, { action: "plan", idempotency_key: chave, demanda: NUMERO, ordens: [{ itens: [{ id: "ln_1", planejado: "40" }] }] });
    const resultados = await Promise.allSettled([pedido("a"), pedido("b"), pedido("c")]);
    assert.equal(resultados.filter((item) => item.status === "fulfilled").length, 1);
    const ordens = (await db.collection(SERVICE_ORDERS_COLLECTION).get()).docs.map((doc) => doc.data());
    const total = ordens.flatMap((os) => os.itens).filter((item) => item.id === "ln_1").reduce((soma, item) => soma + Number(item.planejado), 0);
    assert.equal(total, 40);
  });

  it("com um aditivo em negociação, o resto do escopo fechado ainda se planeja", async () => {
    await saveServiceOrderFor(db, interno, { action: "plan", idempotency_key: "p1", demanda: NUMERO, ordens: [{ itens: [{ id: "ln_1", planejado: "30" }] }] });
    await db.collection("quotes").doc(NUMERO).set({ status: "rascunho", rv: 1, customer_code: "ITAU", tipo_rv: "aditivo" });
    const resto = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "resto", demanda: NUMERO });
    assert.equal(resto.numero, "10045-02");
    const os = await lerOs("10045-02");
    assert.deepEqual(os.itens.map((item: { id: string; planejado: string }) => [item.id, item.planejado]), [["ln_1", "30"], ["ln_2", "160"]]);
  });
});

describe("cancelar e mudar os itens", () => {
  it("cancelar devolve a fatia ao saldo e não leva o motivo no evento", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    const cancelada = await saveServiceOrderFor(db, interno, {
      action: "cancel",
      idempotency_key: "cancela",
      numero: "10045-01",
      expected_edicao: 1,
      motivo: "Cliente adiou",
    });
    assert.equal(cancelada.edicao, 2);
    const os = await lerOs("10045-01");
    assert.equal(os.status, "cancelada");
    assert.equal(os.cancelamento.motivo, "Cliente adiou");
    const [evento] = await eventos("os.cancelled");
    assert.equal(JSON.stringify(evento).includes("adiou"), false);
    const deNovo = await rejection(saveServiceOrderFor(db, interno, { action: "cancel", idempotency_key: "de-novo", numero: "10045-01", expected_edicao: 2, motivo: "Outra vez" }));
    assert.match(deNovo.message, /cancelada/);
    const outra = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "volta", demanda: NUMERO });
    assert.equal(outra.numero, "10045-02");
    assert.equal((await lerOs("10045-02")).itens.length, 2);
  });

  it("muda a fatia dentro do saldo, recusa acima dele e grava os.items_changed", async () => {
    await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano",
      demanda: NUMERO,
      ordens: [{ itens: [{ id: "ln_1", planejado: "20" }] }, { itens: [{ id: "ln_1", planejado: "30" }, { id: "ln_2", planejado: "160" }] }],
    });
    const mudou = await saveServiceOrderFor(db, interno, {
      action: "set_items",
      idempotency_key: "mais",
      numero: "10045-01",
      expected_edicao: 1,
      itens: [{ id: "ln_1", planejado: "30" }],
    });
    assert.equal(mudou.edicao, 2);
    assert.deepEqual((await lerOs("10045-01")).itens.map((item: { planejado: string }) => item.planejado), ["30"]);
    const demais = await rejection(saveServiceOrderFor(db, interno, {
      action: "set_items",
      idempotency_key: "demais",
      numero: "10045-01",
      expected_edicao: 2,
      itens: [{ id: "ln_1", planejado: "30" }, { id: "ln_2", planejado: "1" }],
    }));
    assert.equal(demais.message, "3.05 Cadeira: o saldo é 0 e a OS pede 1.");
    const [evento] = await eventos("os.items_changed");
    assert.deepEqual(evento.payload, { id: "10045-01", demanda: NUMERO, linhas: 1, edicao_antes: 1, edicao_depois: 2 });
  });
});

describe("agendar", () => {
  it("copia equipe e veículos ativos, recusa quem está desativado e não leva nome nem placa no evento", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    const parado = await rejection(saveServiceOrderFor(db, interno, {
      action: "schedule",
      idempotency_key: "ruim",
      numero: "10045-01",
      expected_edicao: 1,
      janela: JANELA,
      equipe: [{ colaborador_id: BRUNO }],
      veiculos: [VAN],
    }));
    assert.equal(parado.code, "failed-precondition");
    const agendada = await saveServiceOrderFor(db, interno, {
      action: "schedule",
      idempotency_key: "boa",
      numero: "10045-01",
      expected_edicao: 1,
      janela: { data: "2099-01-01", inicio: "15:00" },
      equipe: [{ colaborador_id: ANA }],
      veiculos: [VAN],
    });
    assert.equal(agendada.edicao, 2);
    const os = await lerOs("10045-01");
    assert.equal(os.status, "agendada");
    assert.deepEqual(os.janela, { data: "2099-01-01", inicio: "15:00", fim: null });
    assert.equal(os.equipe[0].nome, "Ana Souza");
    assert.equal(os.equipe[0].papel, "lider");
    assert.equal(os.veiculos[0].placa, "DEF4G56");
    const [evento] = await eventos("os.scheduled");
    for (const proibido of ["Ana", "DEF4G56"]) assert.equal(JSON.stringify(evento).includes(proibido), false, proibido);
    assert.deepEqual(evento.payload.veiculos, [VAN]);
  });

  it("sem equipe e sem veículo agenda: a falta é alerta no Início, não bloqueio", async () => {
    await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "abre", demanda: NUMERO });
    const agendada = await saveServiceOrderFor(db, interno, {
      action: "schedule",
      idempotency_key: "so-data",
      numero: "10045-01",
      expected_edicao: 1,
      janela: { data: "2099-01-01" },
      equipe: [],
      veiculos: [],
    });
    assert.equal(agendada.edicao, 2);
    assert.equal((await lerOs("10045-01")).status, "agendada");
  });

  it("a OS de antes da parte 3.4 é lida e, agendada de novo, troca a agenda pelo modelo novo", async () => {
    await db.collection(SERVICE_ORDERS_COLLECTION).doc("10045-01").set({
      numero: "10045-01",
      demanda: NUMERO,
      seq: 1,
      customer_code: "ITAU",
      status: "agendada",
      escopo_rv: 0,
      itens: [{ id: "ln_1", item: "Estação", descricao: "Montagem de estação", servico: "Montagem", quantidade: "60" }],
      origem_local_id: "loc_faria",
      destino_local_id: null,
      edicao: 2,
      cancelamento: null,
      agenda: { data: "2099-01-01", hora: "15:00", equipe: [ANA], veiculo_id: VAN },
    });
    const saldo = await saveServiceOrderFor(db, interno, { action: "create", idempotency_key: "resto", demanda: NUMERO });
    assert.deepEqual((await lerOs(saldo.numero)).itens.map((item: { id: string }) => item.id), ["ln_2"], "a quantidade antiga conta no saldo");
    await saveServiceOrderFor(db, interno, {
      action: "schedule",
      idempotency_key: "nova",
      numero: "10045-01",
      expected_edicao: 2,
      janela: { data: "2099-01-02" },
      equipe: [{ colaborador_id: ANA }],
      veiculos: [VAN],
    });
    const os = await lerOs("10045-01");
    assert.equal(os.agenda, undefined);
    assert.equal(os.janela.data, "2099-01-02");
  });

  it("demanda perdida no Comercial não agenda nem muda itens, mas cancela; reaberta, agenda de novo", async () => {
    const agenda = { janela: { data: "2099-01-01" }, equipe: [{ colaborador_id: ANA }], veiculos: [VAN] };
    await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano",
      demanda: NUMERO,
      ordens: [{ itens: [{ id: "ln_1", planejado: "30" }] }, { itens: [{ id: "ln_1", planejado: "30" }] }],
    });
    await saveServiceOrderFor(db, interno, { action: "schedule", idempotency_key: "ag-1", numero: "10045-01", expected_edicao: 1, ...agenda });

    await db.collection("demands").doc(NUMERO).update({
      etapa: "perdida",
      perda: { motivo: "cancelado_cliente", nota: null, etapa_antes: "para_planejar", rv: 0 },
    });
    const reagendar = await rejection(saveServiceOrderFor(db, interno, {
      action: "schedule",
      idempotency_key: "ag-1b",
      numero: "10045-01",
      expected_edicao: 2,
      ...agenda,
      janela: { data: "2099-01-02" },
    }));
    assert.equal(reagendar.message, "A demanda foi perdida no Comercial. Cancele a OS.");
    const itens = await rejection(saveServiceOrderFor(db, interno, {
      action: "set_items",
      idempotency_key: "it",
      numero: "10045-02",
      expected_edicao: 1,
      itens: [{ id: "ln_1", planejado: "1" }],
    }));
    assert.match(itens.message, /perdida/);
    assert.equal((await lerOs("10045-01")).janela.data, "2099-01-01");
    assert.equal((await eventos("os.scheduled")).length, 1);

    const cancelada = await saveServiceOrderFor(db, interno, { action: "cancel", idempotency_key: "cancela", numero: "10045-01", expected_edicao: 2, motivo: "Demanda perdida" });
    assert.equal(cancelada.edicao, 3);

    await db.collection("demands").doc(NUMERO).update({ etapa: "para_planejar", perda: null });
    const reaberta = await saveServiceOrderFor(db, interno, { action: "schedule", idempotency_key: "ag-2", numero: "10045-02", expected_edicao: 1, ...agenda });
    assert.equal(reaberta.edicao, 2);
  });
});
