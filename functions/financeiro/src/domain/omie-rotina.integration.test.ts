import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { BILLING_PERIODS_COLLECTION } from "./armazenagem.js";
import { actOnNfEmissionFor, emitNfOmieFor } from "./emissao-gravacao.js";
import { EMISSOES_COLLECTION } from "./emissao-omie.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import { FATURAS_COLLECTION, faturaIdDaNf, faturaIdDaNfse } from "./fatura.js";
import type { TransporteDaOmie } from "./omie.js";
import { runOmieSyncFor } from "./omie-rotina.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A rotina da NFS-e pela Omie no emulador (parte 7.4d), com uma Omie de
 * mentira que responde como as páginas da API descrevem (ListarClientes,
 * IncluirOS, StatusOS, FaturarOS, ReenviarOS e CancelarOS). Cada passada dá
 * um passo por emissão; o relógio anda entre as passadas. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-financeiro";
const LIBERADO = "dute-homolog";
const CHAVES = { app_key: "chave-teste", app_secret: "segredo-teste" };
const financeiro: FinanceiroProfile = { uid: "fin-1", role: "financeiro", name: "Carla" };
const ID = "nfe_0123456789abcdef0123";
const OUTRA = "nfe_ffffffffffffffffffff";
const INICIO = Date.parse("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let minutos = 0;
const agora = () => new Date(INICIO + minutos * 60_000);

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "financeiro-omie-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const demanda = (numero: string, extra: Record<string, unknown> = {}) => ({
  numero,
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  entrada: "comercial",
  cobranca: "por_demanda",
  etapa: "a_faturar",
  validacao: { rv: 1, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite" },
  autorizacao_ids: ["aut_itau"],
  ...extra,
});

beforeEach(async () => {
  minutos = 0;
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  const set = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  set("customers/itau", { customer_code: "ITAU", legal_name: "Itaú Unibanco S.A.", document: "60.701.190/0001-04" });
  set("customers/safra", { customer_code: "SAFRA", legal_name: "Banco Safra S.A.", document: "58.160.789/0001-28" });
  set("demands/10045", demanda("10045"));
  set("quotes/10045/revisoes/1", { total_cents: 1_234_500 });
  set("client_authorizations/aut_itau", { id: "aut_itau", customer_code: "ITAU", tipo: "pedido_aceite", status: "registrada", demandas: [{ numero: "10045", rv: 1 }], demanda_numeros: ["10045"], nf_ids: [] });
  set("demands/10050", demanda("10050", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }));
  set("quotes/10050/revisoes/0", { total_cents: 10_000 });
  set(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`, { customer_code: "ITAU", competencia: "2026-09", status: "emitido", invoice_snapshot: { total_cents: 7_508 } });
  await batch.commit();
});

type Resposta = { status: number; corpo: unknown };

/**
 * A Omie de mentira: uma OS por código de integração, a RPS que anda pela
 * lista de status, as falhas injetadas por método e as respostas perdidas
 * (a Omie grava e a resposta não chega, como no tempo limite).
 */
function omieDeMentira(roteiro: { ambiente?: "H" | "P"; rps?: string[]; falhas?: Record<string, Resposta[]>; perder?: Record<string, number>; aoChamar?: (call: string) => Promise<void> } = {}) {
  const chamadas: string[] = [];
  const oss = new Map<string, { nCodOS: number; faturada: boolean; cancelada: boolean }>();
  const rps = [...(roteiro.rps ?? ["002", "004"])];
  // Como na Omie, a RPS fica na última situação do roteiro (a recusada continua recusada).
  let ultima = "002";
  const perder = { ...(roteiro.perder ?? {}) };
  let proximaOs = 9001;
  const transporte: TransporteDaOmie = async (url, corpo) => {
    const { call, param, app_key } = JSON.parse(corpo) as { call: string; param: Array<Record<string, unknown>>; app_key: string };
    assert.equal(app_key, CHAVES.app_key);
    chamadas.push(call);
    await roteiro.aoChamar?.(call);
    const injetada = roteiro.falhas?.[call]?.shift();
    if (injetada) return injetada;
    const resposta = responder(url, call, param[0] ?? {});
    if ((perder[call] ?? 0) > 0) {
      perder[call] -= 1;
      throw new Error("This operation was aborted");
    }
    return resposta;
  };
  const responder = (url: string, call: string, p: Record<string, unknown>): Resposta => {
    const codigo = String(p.cCodIntOS ?? (p.Cabecalho as Record<string, unknown> | undefined)?.cCodIntOS ?? "");
    const os = oss.get(codigo);
    switch (call) {
      case "ListarClientes":
        assert.ok(url.endsWith("/geral/clientes/"));
        return { status: 200, corpo: { clientes_cadastro: [{ codigo_cliente_omie: 5001, cnpj_cpf: (p.clientesFiltro as Record<string, string>).cnpj_cpf, inativo: "N" }] } };
      case "IncluirOS":
        if (os) return { status: 500, corpo: { faultstring: `ERROR: Ordem de Serviço já cadastrada para o código de integração [${codigo}]!`, faultcode: "SOAP-ENV:Client-102" } };
        oss.set(codigo, { nCodOS: proximaOs, faturada: false, cancelada: false });
        proximaOs += 1;
        return { status: 200, corpo: { cCodIntOS: codigo, nCodOS: oss.get(codigo)!.nCodOS, cNumOS: "000123", cCodStatus: "0", cDescStatus: "Ordem de Serviço cadastrada com sucesso!" } };
      case "StatusOS": {
        if (!os) return { status: 500, corpo: { faultstring: "ERROR: OS não encontrada." } };
        const status = rps[0] ?? ultima;
        const lista = os.faturada ? [{ cStatusRps: status, nNfse: status === "004" ? "00000815" : "", cCodVerif: "AB12", cUrlNfse: "https://nfse.exemplo/815", cUrlPdfDest: "https://omie.exemplo/815.pdf", mensagens: status === "003" ? [{ cCodigo: "E160", cDescricao: "Inscrição municipal do tomador inválida.", cCorrecao: "Corrija o cliente na Omie." }] : [] }] : [];
        if (os.faturada && p.lMsg) ultima = rps.shift() ?? ultima;
        return { status: 200, corpo: { cCodIntOS: codigo, nCodOS: os.nCodOS, cNumOS: "000123", cAmbiente: roteiro.ambiente ?? "H", cFaturada: os.faturada ? "S" : "N", cCancelada: os.cancelada ? "S" : "N", ListaRpsNfse: lista } };
      }
      case "FaturarOS":
        assert.ok(url.endsWith("/servicos/osp/"));
        if (os!.faturada) return { status: 500, corpo: { faultstring: "ERROR: A Ordem de Serviço já está faturada." } };
        os!.faturada = true;
        return { status: 200, corpo: { cCodIntOS: codigo, nCodOS: os!.nCodOS, cCodStatus: "0" } };
      case "ReenviarOS":
        return { status: 200, corpo: { cCodIntOS: codigo, cCodStatus: "0" } };
      case "CancelarOS":
        if (os!.cancelada) return { status: 500, corpo: { faultstring: "ERROR: A Ordem de Serviço já está cancelada." } };
        os!.cancelada = true;
        return { status: 200, corpo: { cCodIntOS: codigo, cCodStatus: "0" } };
      default:
        throw new Error(`chamada inesperada: ${call}`);
    }
  };
  return { transporte, chamadas, oss };
}

const emitir = (id = ID, extra: Record<string, unknown> = {}) =>
  emitNfOmieFor(db, financeiro, { idempotency_key: `em-${id}`, demandas: ["10045"], armazenagem: ["ITAU__2026-09"], vencimento: "2026-11-20", forma: "boleto", ...extra }, { projectId: LIBERADO, agora, novoId: () => id });

async function rodar(transporte: TransporteDaOmie, depois = 0, projectId = LIBERADO, chaves: typeof CHAVES | null = CHAVES) {
  minutos += depois;
  return runOmieSyncFor(db, { projectId, chaves, transporte, agora });
}

async function emissao(id = ID) {
  return (await db.doc(`${EMISSOES_COLLECTION}/${id}`).get()).data() ?? {};
}

async function tiposDosEventos() {
  return (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => String(doc.get("type"))).sort();
}

describe("a rotina da Omie", () => {
  it("do pedido à fatura: acha o cliente, inclui a OS, confere o ambiente, fatura, acompanha e, autorizada, a fatura nasce com a NFS-e", async () => {
    const omie = omieDeMentira();
    await emitir();
    await rodar(omie.transporte); // acha o cliente
    await rodar(omie.transporte); // inclui a OS
    assert.equal((await emissao()).etapa, "os_incluida");
    await rodar(omie.transporte); // confere o ambiente
    await rodar(omie.transporte); // fatura
    assert.equal((await emissao()).etapa, "na_prefeitura");
    const cedo = await rodar(omie.transporte, 1); // a prefeitura ainda não é hora
    assert.equal(cedo.passos, 0);
    await rodar(omie.transporte, 1); // 002: espera
    assert.deepEqual([(await emissao()).etapa, (await emissao()).consultas], ["na_prefeitura", 1]);
    const ultima = await rodar(omie.transporte, 5); // 004: autorizada
    assert.equal(ultima.autorizadas, 1);
    assert.deepEqual(omie.chamadas, ["ListarClientes", "IncluirOS", "StatusOS", "FaturarOS", "StatusOS", "StatusOS"]);

    const gravada = await emissao();
    const faturaId = faturaIdDaNfse("815");
    assert.deepEqual([gravada.etapa, gravada.fatura_id, (gravada.omie as Record<string, unknown>).nfse], ["autorizada", faturaId, "00000815"]);
    const fatura = (await db.doc(`${FATURAS_COLLECTION}/${faturaId}`).get()).data() ?? {};
    assert.deepEqual(
      [fatura.customer_code, (fatura.nf as Record<string, unknown>).numero, (fatura.nf as Record<string, unknown>).serie, fatura.valor_cents, fatura.origem_nf, fatura.emissao_id],
      ["ITAU", "815", "1", 1_234_500 + 7_508, "omie", ID],
    );
    const demandaFaturada = (await db.doc("demands/10045").get()).data() ?? {};
    assert.deepEqual([demandaFaturada.etapa, demandaFaturada.emissao_nf], ["faturada", undefined]);
    const periodo = (await db.doc(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`).get()).data() ?? {};
    assert.deepEqual([(periodo.faturamento as Record<string, unknown>).fatura_id, periodo.emissao_nf], [faturaId, undefined]);
    assert.deepEqual(await tiposDosEventos(), ["nf.emission_authorized", "nf.emission_requested", "nf.registered"]);
    // Nada mais a fazer.
    assert.equal((await rodar(omie.transporte, 60)).passos, 0);
  });

  it("a NFS-e que cita mais de 50 autorizações vira fatura, e a rotina segue", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `aut_${String(i).padStart(2, "0")}`);
    const batch = db.batch();
    for (const id of ids) {
      batch.set(db.doc(`client_authorizations/${id}`), { id, customer_code: "ITAU", tipo: "pedido_aceite", status: "registrada", demandas: [{ numero: "10045", rv: 1 }], demanda_numeros: ["10045"], nf_ids: [] });
    }
    batch.update(db.doc("demands/10045"), { autorizacao_ids: ids });
    await batch.commit();
    const omie = omieDeMentira({ rps: ["004"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    const ultima = await rodar(omie.transporte, 5);
    assert.equal(ultima.autorizadas, 1);
    const gravada = await emissao();
    assert.deepEqual([gravada.etapa, gravada.fatura_id], ["autorizada", faturaIdDaNfse("815")]);
  });

  it("a Omie em produção na homologação para a emissão antes de faturar", async () => {
    const omie = omieDeMentira({ ambiente: "P" });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    assert.deepEqual(omie.chamadas, ["ListarClientes", "IncluirOS", "StatusOS"]);
    const gravada = await emissao();
    assert.deepEqual([gravada.etapa, gravada.motivo_da_parada], ["parada", "ambiente_errado"]);
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf.id"), ID);
    assert.deepEqual(await tiposDosEventos(), ["nf.emission_requested", "nf.emission_stopped"]);
  });

  it("a OS que já existe na Omie não duplica: a rotina confere a que está lá e segue", async () => {
    const omie = omieDeMentira();
    await emitir();
    await rodar(omie.transporte);
    omie.oss.set(ID, { nCodOS: 7777, faturada: false, cancelada: false });
    await rodar(omie.transporte); // IncluirOS recusa: já cadastrada
    await rodar(omie.transporte); // StatusOS acha a 7777
    assert.equal(((await emissao()).omie as Record<string, unknown>).os, 7777);
    await rodar(omie.transporte); // fatura a 7777
    assert.deepEqual(omie.chamadas, ["ListarClientes", "IncluirOS", "StatusOS", "FaturarOS"]);
    assert.equal(omie.oss.size, 1);
  });

  it("rejeitada pela prefeitura, não vira fatura; retomada, reenvia e autoriza", async () => {
    const omie = omieDeMentira({ rps: ["003", "004"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    const rejeitada = await emissao();
    assert.deepEqual([rejeitada.etapa, rejeitada.mensagem], ["rejeitada", "Inscrição municipal do tomador inválida."]);
    assert.equal((await db.collection(FATURAS_COLLECTION).get()).size, 0);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "a_faturar");

    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "r-1", id: ID, acao: "retomar", expected_edicao: rejeitada.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // ReenviarOS
    await rodar(omie.transporte, 2); // 004
    assert.equal((await emissao()).etapa, "autorizada");
    assert.equal(omie.chamadas.filter((call) => call === "ReenviarOS").length, 1);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
    assert.ok((await tiposDosEventos()).includes("nf.emission_rejected"));
  });

  it("desistir da rejeitada cancela a OS na Omie e só então solta as reservas", async () => {
    const omie = omieDeMentira({ rps: ["003"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    const rejeitada = await emissao();
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-1", id: ID, acao: "desistir", expected_edicao: rejeitada.edicao as number }, { projectId: LIBERADO, agora });
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf.id"), ID);
    await rodar(omie.transporte); // StatusOS: a RPS recusada, sem nota a cancelar
    assert.deepEqual([(await emissao()).etapa, (await db.doc("demands/10045").get()).get("emissao_nf.id")], ["cancelando", ID]);
    await rodar(omie.transporte);
    assert.deepEqual(omie.chamadas.slice(-2), ["StatusOS", "CancelarOS"]);
    assert.equal((await emissao()).etapa, "desistida");
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf"), undefined);
    assert.equal((await db.doc(`${BILLING_PERIODS_COLLECTION}/ITAU__2026-09`).get()).get("emissao_nf"), undefined);
    const solta = (await db.collection(EVENTS_COLLECTION).where("type", "==", "nf.emission_released").get()).docs[0]?.get("payload");
    assert.deepEqual(solta, { id: ID, demandas: ["10045"], competencias: ["2026-09"] });
  });

  it("a resposta perdida do FaturarOS não fatura de novo: a rotina confere, segue para a prefeitura e a fatura nasce", async () => {
    const omie = omieDeMentira({ perder: { FaturarOS: 1 } });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte); // o cliente, a OS, o ambiente e o FaturarOS sem resposta
    const semResposta = await emissao();
    assert.deepEqual([semResposta.etapa, semResposta.conferir, semResposta.tentativas], ["os_incluida", true, 1]);
    await rodar(omie.transporte, 2); // StatusOS: já faturada
    assert.equal((await emissao()).etapa, "na_prefeitura");
    await rodar(omie.transporte, 2); // 004
    assert.equal((await emissao()).etapa, "autorizada");
    assert.deepEqual(omie.chamadas, ["ListarClientes", "IncluirOS", "StatusOS", "FaturarOS", "StatusOS", "StatusOS"]);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
  });

  it("desistir da OS que a pessoa já cancelou na Omie: a conferência acha a OS cancelada, e a reserva sai", async () => {
    const omie = omieDeMentira({ rps: ["003"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    const rejeitada = await emissao();
    assert.equal(rejeitada.etapa, "rejeitada");
    omie.oss.get(ID)!.cancelada = true; // cancelada à mão na Omie
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-omie", id: ID, acao: "desistir", expected_edicao: rejeitada.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // StatusOS: cancelada
    assert.equal((await emissao()).etapa, "desistida");
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf"), undefined);
    assert.equal(omie.chamadas.includes("CancelarOS"), false);
  });

  it("o CancelarOS recusado porque alguém cancelou na Omie no meio tempo: a conferência seguinte solta a reserva", async () => {
    const omie = omieDeMentira({
      rps: ["003"],
      aoChamar: async (call) => {
        if (call === "CancelarOS") omie.oss.get(ID)!.cancelada = true;
      },
    });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    const rejeitada = await emissao();
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-meio", id: ID, acao: "desistir", expected_edicao: rejeitada.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // StatusOS: recusada, cancela
    await rodar(omie.transporte); // CancelarOS: já cancelada
    assert.deepEqual([(await emissao()).etapa, (await emissao()).conferir], ["cancelando", true]);
    await rodar(omie.transporte, 2); // StatusOS: cancelada
    assert.equal((await emissao()).etapa, "desistida");
    assert.deepEqual(omie.chamadas.slice(-3), ["StatusOS", "CancelarOS", "StatusOS"]);
  });

  it("desistir da prefeitura sem resposta não cancela a NFS-e que saiu no meio tempo: para, e tentar de novo registra a fatura", async () => {
    const omie = omieDeMentira({ rps: ["002", "002", "004"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2); // 002
    await rodar(omie.transporte, 73 * 60); // 002 depois de 72 horas
    const demorou = await emissao();
    assert.deepEqual([demorou.etapa, demorou.motivo_da_parada], ["parada", "prefeitura_demorou"]);
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-demorou", id: ID, acao: "desistir", expected_edicao: demorou.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // StatusOS: 004, a nota saiu
    const autorizada = await emissao();
    assert.deepEqual([autorizada.etapa, autorizada.motivo_da_parada, (autorizada.omie as Record<string, unknown>).nfse], ["parada", "nfse_autorizada", "00000815"]);
    assert.equal(omie.chamadas.includes("CancelarOS"), false);
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf.id"), ID);
    // Desistir de novo espera o cancelamento na Omie.
    await assert.rejects(
      actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-autorizada", id: ID, acao: "desistir", expected_edicao: autorizada.edicao as number }, { projectId: LIBERADO, agora }),
      /A NFS-e 815 foi autorizada/,
    );
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "r-autorizada", id: ID, acao: "retomar", expected_edicao: autorizada.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // StatusOS: 004, a fatura nasce
    assert.equal((await emissao()).etapa, "autorizada");
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
  });

  it("o reenvio recomeça o relógio da prefeitura: a RPS corrigida dias depois espera de novo, em vez de parar", async () => {
    const omie = omieDeMentira({ rps: ["002", "003", "002", "004"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2); // 002
    await rodar(omie.transporte, 70 * 60); // 003, 70 horas depois do faturamento
    const rejeitada = await emissao();
    assert.equal(rejeitada.etapa, "rejeitada");
    minutos += 5 * 60; // a pessoa corrige na Omie horas depois
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "r-tarde", id: ID, acao: "retomar", expected_edicao: rejeitada.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // ReenviarOS
    await rodar(omie.transporte, 2); // 002: a prefeitura processa a RPS reenviada
    assert.deepEqual([(await emissao()).etapa, (await emissao()).motivo_da_parada], ["na_prefeitura", null]);
    await rodar(omie.transporte, 5); // 004
    assert.equal((await emissao()).etapa, "autorizada");
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
  });

  it("tentar de novo depois da demora da prefeitura dá outras 72 horas, em vez de parar na primeira consulta", async () => {
    const omie = omieDeMentira({ rps: ["002", "002", "002", "004"] });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2); // 002
    await rodar(omie.transporte, 73 * 60); // 002 depois de 72 horas
    const demorou = await emissao();
    assert.equal(demorou.motivo_da_parada, "prefeitura_demorou");
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "r-demorou-de-novo", id: ID, acao: "retomar", expected_edicao: demorou.edicao as number }, { projectId: LIBERADO, agora });
    await rodar(omie.transporte); // 002: espera de novo
    assert.deepEqual([(await emissao()).etapa, (await emissao()).motivo_da_parada], ["na_prefeitura", null]);
    await rodar(omie.transporte, 2); // 004
    assert.equal((await emissao()).etapa, "autorizada");
  });

  it("a chave inválida para a emissão e a passada inteira", async () => {
    const omie = omieDeMentira({ falhas: { ListarClientes: [{ status: 403, corpo: { faultstring: "A chave de acesso não está preenchida ou não é válida.", faultcode: "SOAP-ENV:Server" } }] } });
    await emitir(ID);
    await emitir(OUTRA, { demandas: ["10050"], armazenagem: [] });
    const resumo = await rodar(omie.transporte);
    assert.deepEqual([resumo.passos, resumo.parou_pela_chave], [1, true]);
    const paradas = [await emissao(ID), await emissao(OUTRA)].map((item) => item.etapa).sort();
    assert.deepEqual(paradas, ["na_fila", "parada"]);
  });

  it("o CT-e registrado à mão com o mesmo número não impede a fatura da NFS-e da Omie", async () => {
    const omie = omieDeMentira();
    await registerNfFor(db, financeiro, { idempotency_key: "nf-safra", demandas: ["10050"], nf: { numero: "815", emitida_em: "2026-10-23" }, vencimento: "2026-11-20", forma: "pix" }, agora);
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    await rodar(omie.transporte, 5);
    assert.equal((await emissao()).etapa, "autorizada");
    const daOmie = (await db.doc(`${FATURAS_COLLECTION}/${faturaIdDaNfse("815")}`).get()).data() ?? {};
    const aMao = (await db.doc(`${FATURAS_COLLECTION}/${faturaIdDaNf("1", "815")}`).get()).data() ?? {};
    assert.deepEqual([daOmie.customer_code, daOmie.origem_nf, aMao.customer_code, aMao.origem_nf], ["ITAU", "omie", "SAFRA", undefined]);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "faturada");
  });

  it("a fatura que não pode nascer para a emissão, a reserva continua e desistir não cancela a nota", async () => {
    const omie = omieDeMentira();
    // A mesma NFS-e já com fatura na Dute (o dado que não deveria existir).
    await db.doc(`${FATURAS_COLLECTION}/${faturaIdDaNfse("815")}`).set({ id: faturaIdDaNfse("815"), customer_code: "ITAU", status: "emitida", origem_nf: "omie" });
    await emitir();
    for (let passo = 0; passo < 4; passo += 1) await rodar(omie.transporte);
    await rodar(omie.transporte, 2);
    await rodar(omie.transporte, 5);
    const gravada = await emissao();
    assert.deepEqual([gravada.etapa, gravada.motivo_da_parada], ["parada", "fatura_recusada"]);
    assert.match(String(gravada.mensagem), /A NFS-e 815 já tem fatura na Dute/);
    assert.equal((await db.doc("demands/10045").get()).get("emissao_nf.id"), ID);
    assert.equal((await db.doc("demands/10045").get()).get("etapa"), "a_faturar");
    // A nota vale na prefeitura: desistir não a cancela.
    await assert.rejects(
      actOnNfEmissionFor(db, financeiro, { idempotency_key: "d-recusada", id: ID, acao: "desistir", expected_edicao: gravada.edicao as number }, { projectId: LIBERADO, agora }),
      /A NFS-e 815 foi autorizada/,
    );
    assert.equal(omie.chamadas.includes("CancelarOS"), false);
  });

  it("se uma pessoa mexeu na emissão durante a chamada, o resultado da Omie se descarta", async () => {
    const omie = omieDeMentira({
      aoChamar: async (call) => {
        if (call === "ListarClientes") await db.doc(`${EMISSOES_COLLECTION}/${ID}`).update({ edicao: 99 });
      },
    });
    await emitir();
    const resumo = await rodar(omie.transporte);
    assert.equal(resumo.descartadas, 1);
    assert.equal(((await emissao()).omie as Record<string, unknown>).cliente, null);
  });

  it("fora da liberação, não faz nada", async () => {
    const omie = omieDeMentira();
    await emitir();
    assert.equal((await rodar(omie.transporte, 0, "dute-prod")).liberada, false);
    assert.equal((await rodar(omie.transporte, 0, "dute-prod", null)).liberada, false);
    assert.deepEqual(omie.chamadas, []);
    assert.equal((await emissao()).etapa, "na_fila");
  });

  it("sem as chaves, não chama a Omie: a emissão para com o motivo, desistir solta as reservas e, com as chaves, a retomada anda", async () => {
    const omie = omieDeMentira();
    await emitir();
    await emitir(OUTRA, { demandas: ["10050"], armazenagem: [] });
    assert.deepEqual(await rodar(omie.transporte, 0, LIBERADO, null), { liberada: true, sem_chaves: true, passos: 0, autorizadas: 0, paradas: 2, descartadas: 0, parou_pela_chave: false });
    assert.deepEqual(omie.chamadas, []);
    const parada = await emissao();
    assert.deepEqual([parada.etapa, parada.etapa_anterior, parada.motivo_da_parada, parada.mensagem], ["parada", "na_fila", "sem_chaves", "As chaves da API da Omie não estão neste ambiente."]);
    assert.deepEqual(await tiposDosEventos(), ["nf.emission_requested", "nf.emission_requested", "nf.emission_stopped", "nf.emission_stopped"]);
    const motivos = (await db.collection(EVENTS_COLLECTION).where("type", "==", "nf.emission_stopped").get()).docs.map((doc) => (doc.get("payload") as Record<string, unknown>).motivo);
    assert.deepEqual(motivos, ["sem_chaves", "sem_chaves"]);
    // A parada não volta à fila sozinha: a passada seguinte não mexe nela.
    assert.deepEqual([(await rodar(omie.transporte, 10, LIBERADO, null)).paradas, (await emissao()).edicao], [0, parada.edicao]);

    // Desistir da que nunca saiu solta as reservas na hora.
    const outra = await emissao(OUTRA);
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "desistir-outra", id: OUTRA, acao: "desistir", expected_edicao: outra.edicao }, { projectId: LIBERADO, agora });
    assert.equal((await emissao(OUTRA)).etapa, "desistida");
    assert.equal((await db.doc("demands/10050").get()).get("emissao_nf"), undefined);

    // Com as chaves, retomar volta à fila e a rotina chama a Omie.
    await actOnNfEmissionFor(db, financeiro, { idempotency_key: "retomar", id: ID, acao: "retomar", expected_edicao: parada.edicao }, { projectId: LIBERADO, agora });
    assert.equal((await emissao()).etapa, "na_fila");
    await rodar(omie.transporte, 1);
    assert.deepEqual(omie.chamadas, ["ListarClientes"]);
  });
});
