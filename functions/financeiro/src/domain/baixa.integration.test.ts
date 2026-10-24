import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { HttpsError } from "firebase-functions/https";

import { BAIXAS_COLLECTION, idDaBaixa } from "./baixa-omie.js";
import { actOnNfSettlementFor, listNfSettlementsFor } from "./baixa-gravacao.js";
import { advanceFaturaFor } from "./cobranca-gravacao.js";
import { PAGAMENTOS_COLLECTION } from "./cobranca.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerNfFor } from "./fatura-gravacao.js";
import { FATURAS_COLLECTION } from "./fatura.js";
import type { TransporteDaOmie } from "./omie.js";
import { runOmieBaixasFor } from "./omie-rotina.js";
import type { FinanceiroProfile } from "./profile.js";

/**
 * A baixa na Omie no emulador (parte 7.4g), com uma Omie de mentira que
 * responde como as páginas da API descrevem (PesquisarLancamentos,
 * LancarRecebimento e CancelarRecebimento) e guarda os recebimentos do título
 * da OS. O pagamento da fatura que saiu pela Omie põe a baixa na fila; a
 * rotina confere o título, lança uma vez e, no estorno, cancela. Dados
 * sintéticos.
 */

const PROJECT_ID = "demo-dute-financeiro";
const LIBERADO = "dute-homolog";
const CHAVES = { app_key: "chave-teste", app_secret: "segredo-teste" };
const financeiro: FinanceiroProfile = { uid: "fin-1", role: "financeiro", name: "Carla" };
const EMISSAO = "nfe_0123456789abcdef0123";
const OS = 9001;
const TITULO = 7001;
const INICIO = Date.parse("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;
let faturaId: string;
let minutos = 0;
const agora = () => new Date(INICIO + minutos * 60_000);

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "financeiro-baixa-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const demanda = (numero: string) => ({
  numero,
  titulo: `Desmontagem ${numero}`,
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  etapa: "a_faturar",
  etapa_desde: "2026-10-20T12:00:00.000Z",
  marcos: [],
  validacao: { rv: 1, autorizacao: "pedido_aceite" },
  autorizacao_ids: ["aut_itau"],
});

beforeEach(async () => {
  minutos = 0;
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.doc("demands/10045"), demanda("10045"));
  batch.set(db.doc("quotes/10045/revisoes/1"), { total_cents: 1_000_000 });
  batch.set(db.doc("client_authorizations/aut_itau"), { id: "aut_itau", customer_code: "ITAU", tipo: "pedido_aceite", status: "registrada", demandas: [{ numero: "10045", rv: 1 }], nf_ids: [] });
  await batch.commit();
  const registro = await registerNfFor(db, financeiro, { idempotency_key: "nf-1", demandas: ["10045"], nf: { numero: "815", emitida_em: "2026-10-20" }, vencimento: "2026-11-20", forma: "boleto" }, agora);
  faturaId = registro.id;
});

/** A fatura como a rotina da emissão (parte 7.4d) grava: a origem, a emissão e a OS. */
async function daOmie() {
  await db.collection(FATURAS_COLLECTION).doc(faturaId).update({ origem_nf: "omie", emissao_id: EMISSAO, omie: { os: OS, codigo_verificacao: "AB12", url_nfse: null, url_pdf: null } });
}

type Resposta = { status: number; corpo: unknown };
type Recebimento = { nCodLanc: number; cCodIntLanc: string; nValLanc: number; dDtLanc: string };

/** A Omie de mentira: o título da OS e os recebimentos dele; as falhas e as respostas perdidas injetadas por método. */
function omieDeMentira(roteiro: { falhas?: Record<string, Resposta[]>; perder?: Record<string, number>; aoChamar?: (call: string) => Promise<void> } = {}) {
  const chamadas: string[] = [];
  const recebimentos: Recebimento[] = [];
  const perder: Record<string, number> = { ...(roteiro.perder ?? {}) };
  let proximo = 8001;
  const transporte: TransporteDaOmie = async (url, corpo) => {
    const { call, param, app_key } = JSON.parse(corpo) as { call: string; param: Array<Record<string, unknown>>; app_key: string };
    assert.equal(app_key, CHAVES.app_key);
    chamadas.push(call);
    await roteiro.aoChamar?.(call);
    const injetada = roteiro.falhas?.[call]?.shift();
    if (injetada) return injetada;
    const p = param[0] ?? {};
    let resposta: Resposta;
    switch (call) {
      case "PesquisarLancamentos": {
        assert.ok(url.endsWith("/financas/pesquisartitulos/"));
        assert.deepEqual([p.nCodOS, p.cNatureza], [OS, "R"]);
        const lancamentos = recebimentos.map((recebimento) => ({ ...recebimento }));
        resposta = {
          status: 200,
          corpo: {
            nPagina: 1,
            nTotPaginas: 1,
            nRegistros: 1,
            titulosEncontrados: [{ cabecTitulo: { nCodTitulo: TITULO, nCodOS: OS, cStatus: "AVENCER", nCodCC: 4001, nValorTitulo: 10000 }, lancamentos, resumo: { cLiquidado: "N" } }],
          },
        };
        break;
      }
      case "LancarRecebimento":
        assert.ok(url.endsWith("/financas/contareceber/"));
        assert.deepEqual([p.codigo_lancamento, p.codigo_conta_corrente], [TITULO, 4001]);
        if (recebimentos.some((recebimento) => recebimento.cCodIntLanc === p.codigo_baixa_integracao)) {
          return { status: 500, corpo: { faultstring: "ERROR: Já existe um lançamento com o código de integração informado!" } };
        }
        recebimentos.push({ nCodLanc: proximo, cCodIntLanc: String(p.codigo_baixa_integracao), nValLanc: Number(p.valor), dDtLanc: String(p.data) });
        resposta = { status: 200, corpo: { codigo_lancamento: TITULO, codigo_baixa: proximo, codigo_baixa_integracao: p.codigo_baixa_integracao, liquidado: "N", valor_baixado: p.valor, codigo_status: "0", descricao_status: "Recebimento lançado com sucesso!" } };
        proximo += 1;
        break;
      case "CancelarRecebimento": {
        assert.ok(url.endsWith("/financas/contareceber/"));
        const indice = recebimentos.findIndex((recebimento) => (p.codigo_baixa !== undefined ? recebimento.nCodLanc === p.codigo_baixa : recebimento.cCodIntLanc === p.codigo_baixa_integracao));
        if (indice < 0) return { status: 500, corpo: { faultstring: "ERROR: Baixa não encontrada!" } };
        const [cancelado] = recebimentos.splice(indice, 1);
        resposta = { status: 200, corpo: { codigo_baixa: cancelado.nCodLanc, codigo_status: "0", descricao_status: "Recebimento cancelado com sucesso!" } };
        break;
      }
      default:
        throw new Error(`chamada inesperada: ${call}`);
    }
    // A Omie gravou, mas a resposta não chegou.
    if (perder[call]) {
      perder[call] -= 1;
      throw new Error("socket hang up");
    }
    return resposta;
  };
  return { transporte, chamadas, recebimentos };
}

const pagar = (chave: string, valor = "5000.00") => advanceFaturaFor(db, financeiro, { acao: "pay", idempotency_key: chave, fatura_id: faturaId, valor, recebido_em: "2026-10-22", forma: "pix" }, agora);
const estornar = (chave: string, pagamentoId: string) =>
  advanceFaturaFor(db, financeiro, { acao: "reverse_payment", idempotency_key: chave, fatura_id: faturaId, pagamento_id: pagamentoId, motivo: "Lançado em duplicidade" }, agora);

async function rodar(transporte: TransporteDaOmie, depois = 0, projectId = LIBERADO, chaves: typeof CHAVES | null = CHAVES) {
  minutos += depois;
  return runOmieBaixasFor(db, { projectId, chaves, transporte, agora });
}

async function baixa(pagamentoId: string) {
  return (await db.doc(`${BAIXAS_COLLECTION}/${idDaBaixa(pagamentoId)}`).get()).data() ?? {};
}

async function eventos(tipo: string) {
  return (await db.collection(EVENTS_COLLECTION).where("type", "==", tipo).get()).docs.map((doc) => doc.data());
}

describe("a baixa na Omie", () => {
  it("o pagamento da fatura que saiu pela Omie põe a baixa na fila; a rotina confere o título e lança o recebimento uma vez", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    assert.ok(pagamentoId);
    const fila = await baixa(pagamentoId);
    assert.deepEqual(
      [fila.etapa, fila.fatura_id, fila.emissao_id, fila.valor_cents, fila.recebido_em, fila.codigo, (fila.omie as Record<string, unknown>).os],
      ["na_fila", faturaId, EMISSAO, 500_000, "2026-10-22", `DUTE${pagamentoId.slice(4, 20)}`, OS],
    );

    await rodar(omie.transporte); // confere o título
    assert.deepEqual([(await baixa(pagamentoId)).conferida, ((await baixa(pagamentoId)).omie as Record<string, unknown>).titulo], [true, TITULO]);
    const lancou = await rodar(omie.transporte); // lança
    assert.equal(lancou.lancadas, 1);
    const lancada = await baixa(pagamentoId);
    assert.deepEqual([lancada.etapa, (lancada.omie as Record<string, unknown>).baixa], ["lancada", 8001]);
    assert.deepEqual(omie.recebimentos.map((recebimento) => [recebimento.cCodIntLanc, recebimento.nValLanc, recebimento.dDtLanc]), [[lancada.codigo, 5000, "22/10/2026"]]);
    assert.equal((await rodar(omie.transporte, 60)).passos, 0);
    assert.deepEqual(omie.chamadas, ["PesquisarLancamentos", "LancarRecebimento"]);

    const [evento] = await eventos("nf.settlement_posted");
    assert.deepEqual([evento.entity_type, evento.entity_id, evento.customer_code, evento.payload, (evento.actor as Record<string, unknown>).role], ["nf_baixa", idDaBaixa(pagamentoId), "ITAU", { id: idDaBaixa(pagamentoId), pagamento_id: pagamentoId }, "sistema"]);
  });

  it("a resposta perdida não duplica: a Omie gravou, a Dute não soube, e a conferência seguinte acha o recebimento", async () => {
    await daOmie();
    const omie = omieDeMentira({ perder: { LancarRecebimento: 1 } });
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    await rodar(omie.transporte); // confere
    await rodar(omie.transporte); // lança, e a resposta se perde
    assert.deepEqual([(await baixa(pagamentoId!)).etapa, (await baixa(pagamentoId!)).conferida, (await baixa(pagamentoId!)).tentativas], ["na_fila", false, 1]);
    assert.equal((await rodar(omie.transporte, 1)).passos, 0); // ainda não é hora
    await rodar(omie.transporte, 2); // confere e acha o recebimento
    assert.equal((await baixa(pagamentoId!)).etapa, "lancada");
    assert.equal(omie.recebimentos.length, 1);
    assert.deepEqual(omie.chamadas, ["PesquisarLancamentos", "LancarRecebimento", "PesquisarLancamentos"]);
  });

  it("o estorno da baixa lançada: confere o título e cancela o recebimento na Omie; o evento diz que saiu", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    await rodar(omie.transporte);
    await rodar(omie.transporte);
    await estornar("est-1", pagamentoId!);
    assert.deepEqual([(await baixa(pagamentoId!)).etapa, (await baixa(pagamentoId!)).conferida], ["cancelando", false]);
    await rodar(omie.transporte); // confere: o recebimento está lá
    const cancelou = await rodar(omie.transporte); // cancela
    assert.equal(cancelou.canceladas, 1);
    assert.equal((await baixa(pagamentoId!)).etapa, "cancelada");
    assert.deepEqual(omie.recebimentos, []);
    assert.deepEqual(omie.chamadas, ["PesquisarLancamentos", "LancarRecebimento", "PesquisarLancamentos", "CancelarRecebimento"]);
    assert.equal((await eventos("nf.settlement_cancelled")).length, 1);
    // O estorno na Dute continua o mesmo.
    assert.equal((await db.doc(`${PAGAMENTOS_COLLECTION}/${pagamentoId}`).get()).get("status"), "estornado");
  });

  it("o estorno antes de conferir o título cancela a baixa aqui, sem chamar a Omie, com o evento de quem estornou", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    await estornar("est-1", pagamentoId!);
    assert.equal((await baixa(pagamentoId!)).etapa, "cancelada");
    assert.equal((await rodar(omie.transporte)).passos, 0);
    assert.deepEqual(omie.chamadas, []);
    const [evento] = await eventos("nf.settlement_cancelled");
    assert.deepEqual([evento.entity_id, (evento.actor as Record<string, unknown>).uid], [idDaBaixa(pagamentoId!), "fin-1"]);
  });

  it("o estorno durante o lançamento: o resultado da Omie se descarta, e o cancelamento confere e desfaz o que ela gravou", async () => {
    await daOmie();
    let pagamentoId = "";
    const omie = omieDeMentira({
      aoChamar: async (call) => {
        if (call === "LancarRecebimento") await estornar("est-1", pagamentoId);
      },
    });
    pagamentoId = (await pagar("pag-1")).pagamento_id!;
    await rodar(omie.transporte); // confere
    const lancou = await rodar(omie.transporte); // lança; no meio, o estorno
    assert.deepEqual([lancou.descartadas, (await baixa(pagamentoId)).etapa], [1, "cancelando"]);
    assert.equal(omie.recebimentos.length, 1);
    await rodar(omie.transporte); // confere: a Omie gravou
    await rodar(omie.transporte); // cancela
    assert.equal((await baixa(pagamentoId)).etapa, "cancelada");
    assert.deepEqual(omie.recebimentos, []);
  });

  it("a Omie fora do ar não desfaz o recebimento na Dute: a baixa espera, o intervalo dobra e ela para na sexta falha", async () => {
    await daOmie();
    const fora = { status: 500, corpo: { faultstring: "SOAP-ERROR: Broken response from Application Server (PROTO_BYEBYE)" } };
    const omie = omieDeMentira({ falhas: { PesquisarLancamentos: Array.from({ length: 6 }, () => fora) } });
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    for (const espera of [0, 2, 4, 8, 16, 32]) await rodar(omie.transporte, espera);
    const parada = await baixa(pagamentoId!);
    assert.deepEqual([parada.etapa, parada.motivo_da_parada, parada.tentativas], ["parada", "falhas_seguidas", 6]);
    assert.equal(omie.chamadas.length, 6);
    assert.deepEqual((await eventos("nf.settlement_stopped")).map((evento) => evento.payload), [{ id: idDaBaixa(pagamentoId!), motivo: "falhas_seguidas" }]);
    // O pagamento e a fatura não mudam.
    assert.equal((await db.doc(`${PAGAMENTOS_COLLECTION}/${pagamentoId}`).get()).get("status"), "registrado");
    assert.equal((await db.collection(FATURAS_COLLECTION).doc(faturaId).get()).get("recebido_cents"), 500_000);
  });

  it("sem as chaves, não chama a Omie e a baixa para; fora da liberação, não faz nada", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    assert.equal((await rodar(omie.transporte, 0, "dute-prod")).liberada, false);
    assert.equal((await baixa(pagamentoId!)).etapa, "na_fila");
    const semChaves = await rodar(omie.transporte, 0, LIBERADO, null);
    assert.deepEqual([semChaves.sem_chaves, semChaves.paradas, semChaves.passos], [true, 1, 0]);
    assert.deepEqual([(await baixa(pagamentoId!)).etapa, (await baixa(pagamentoId!)).motivo_da_parada], ["parada", "sem_chaves"]);
    assert.deepEqual(omie.chamadas, []);
  });

  it("a fatura registrada à mão não tem baixa", async () => {
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    assert.ok(pagamentoId);
    assert.equal((await db.collection(BAIXAS_COLLECTION).get()).size, 0);
    await estornar("est-1", pagamentoId);
    assert.equal((await db.collection(BAIXAS_COLLECTION).get()).size, 0);
    assert.deepEqual(await eventos("nf.settlement_cancelled"), []);
  });
});

async function recusa(promessa: Promise<unknown>, codigo: string, mensagem: string | RegExp) {
  await assert.rejects(promessa, (error: unknown) => {
    assert.ok(error instanceof HttpsError, String(error));
    assert.equal(error.code, codigo);
    if (typeof mensagem === "string") assert.equal(error.message, mensagem);
    else assert.match(error.message, mensagem);
    return true;
  });
}

const agir = (id: string, acao: "retomar" | "dispensar", edicao: number, chave = `${acao}-${id}`, projectId = LIBERADO, quem: FinanceiroProfile = financeiro) =>
  actOnNfSettlementFor(db, quem, { idempotency_key: chave, id, acao, expected_edicao: edicao }, { projectId, agora });

describe("a baixa na tela (parte 7.4h)", () => {
  it("a lista traz as abertas, paradas e em andamento, com o cliente e a NF; as que acabaram ficam de fora", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: primeiro } = await pagar("pag-1", "1000.00");
    await rodar(omie.transporte);
    await rodar(omie.transporte); // lançada
    minutos += 1;
    const { pagamento_id: segundo } = await pagar("pag-2", "2000.00");
    const { baixas } = await listNfSettlementsFor(db, financeiro);
    assert.deepEqual(
      baixas.map((item) => [item.id, item.etapa, item.customer_name, item.nf_numero, item.valor_cents, item.recebido_em]),
      [[idDaBaixa(segundo!), "na_fila", "Itaú Unibanco", "815", 200_000, "2026-10-22"]],
    );
    assert.ok(!baixas.some((item) => item.id === idDaBaixa(primeiro!)));
    await recusa(listNfSettlementsFor(db, { uid: "op-1", role: "interno" }), "permission-denied", /.+/);
  });

  it("retomar a parada sem as chaves volta à fila, e com as chaves a rotina lança; o evento de quem retomou", async () => {
    await daOmie();
    const omie = omieDeMentira();
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    const id = idDaBaixa(pagamentoId!);
    await rodar(omie.transporte, 0, LIBERADO, null);
    const parada = await baixa(pagamentoId!);
    assert.equal(parada.motivo_da_parada, "sem_chaves");
    const retomada = await agir(id, "retomar", parada.edicao as number);
    assert.deepEqual([retomada.etapa, (await baixa(pagamentoId!)).etapa], ["na_fila", "na_fila"]);
    // Repetir a mesma ação devolve o mesmo resultado.
    assert.equal((await agir(id, "retomar", parada.edicao as number)).replayed, true);
    await rodar(omie.transporte);
    await rodar(omie.transporte);
    assert.equal((await baixa(pagamentoId!)).etapa, "lancada");
    const [evento] = await eventos("nf.settlement_resumed");
    assert.deepEqual([evento.payload, (evento.actor as Record<string, unknown>).uid], [{ id, etapa_depois: "na_fila" }, "fin-1"]);
  });

  it("dispensar a parada acaba a baixa, com o motivo no evento; a edição velha, a que não parou e fora da liberação recusam", async () => {
    await daOmie();
    const omie = omieDeMentira({ falhas: { PesquisarLancamentos: Array.from({ length: 6 }, () => ({ status: 500, corpo: { faultstring: "Erro de negócio qualquer." } })) } });
    const { pagamento_id: pagamentoId } = await pagar("pag-1");
    const id = idDaBaixa(pagamentoId!);
    await recusa(agir(id, "dispensar", 1), "failed-precondition", "Só a baixa parada se dispensa.");
    for (const espera of [0, 2, 4, 8, 16, 32]) await rodar(omie.transporte, espera);
    const parada = await baixa(pagamentoId!);
    assert.equal(parada.etapa, "parada");
    await recusa(agir(id, "dispensar", (parada.edicao as number) - 1), "failed-precondition", "A baixa mudou. Abra de novo.");
    await recusa(agir(id, "dispensar", parada.edicao as number, "fora", "dute-prod"), "failed-precondition", /não está liberada/);
    await recusa(agir(id, "dispensar", parada.edicao as number, "sem-papel", LIBERADO, { uid: "com-1", role: "comercial" }), "permission-denied", /.+/);
    const dispensada = await agir(id, "dispensar", parada.edicao as number);
    assert.equal(dispensada.etapa, "dispensada");
    const gravada = await baixa(pagamentoId!);
    assert.deepEqual([gravada.etapa, (gravada.dispensada as Record<string, unknown>).motivo_da_parada], ["dispensada", "falhas_seguidas"]);
    assert.deepEqual((await eventos("nf.settlement_dismissed")).map((evento) => evento.payload), [{ id, motivo: "falhas_seguidas" }]);
    assert.equal((await rodar(omie.transporte, 60)).passos, 0);
    assert.deepEqual((await listNfSettlementsFor(db, financeiro)).baixas, []);
  });
});
