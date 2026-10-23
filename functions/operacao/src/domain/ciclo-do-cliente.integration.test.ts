import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";

import { CLIENT_NOTIFICATIONS_COLLECTION, EMAIL_OUTBOX_COLLECTION, enviarSoAuditoria, runNotificationsFor } from "./avisos-gravacao.js";
import { completeServiceOrderFor } from "./conclusao-gravacao.js";
import { openDirectDemandFor } from "./demanda-direta-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";
import { registerItemFor, registerStepFor } from "./execucao-gravacao.js";
import { attachPhotoFor, type ConferirArquivo } from "./fotos-gravacao.js";
import { saveServiceOrderFor } from "./os-gravacao.js";
import { SERVICE_ORDERS_COLLECTION } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { requestServiceFor, type ConferirAnexo } from "./solicitacao-gravacao.js";

/**
 * O ciclo do cliente no emulador (parte 4.9, "pronto quando" da Fase 4): o
 * cliente pede a OS pelo portal; quem coordena abre a demanda direta e
 * planeja a OS com o dia, a equipe e o veículo; a líder executa no celular e
 * conclui com a assinatura; o Financeiro registra a NF. A rotina dos avisos
 * lê os eventos gravados pelas callables de verdade e dá o sino e o e-mail de
 * cada passo a quem ligou o modelo, com o link do portal: o andamento e, na
 * conclusão, o comprovante com a assinatura e as fotos do final. O evento da
 * NF vem no formato que o Financeiro grava, travado em functions/financeiro
 * (fatura.integration.test.ts).
 * Nenhum aviso de OS leva valor; o da NF só vai a quem lê valor. O ciclo é
 * no dia de hoje em São Paulo, porque o servidor carimba o evento com o
 * relógio de verdade e é por ele que a rotina anda. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const ORIGEM = "https://app.dutelog.com.br";
const REMETENTE = "Dutelog <avisos@dutelog.com.br>";
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ANA = "col_aaaaaaaaaaaaaaaa";
const VAN = "vei_aaaaaaaaaaaaaaaa";
const FATURA = `fat_${"a1".repeat(12)}`;
const DE_MANHA = () => new Date(`${DIA}T07:00:00-03:00`);
const NO_FIM_DO_DIA = () => new Date(`${DIA}T18:30:00-03:00`);

const cliente: OperacaoProfile = { uid: "cli-1", role: "cliente", name: "Roberto Souza", email: "roberto@itau.example", customer_code: "ITAU" };
const interno: OperacaoProfile = { uid: "interno-1", role: "interno", name: "Paula" };
const lider: OperacaoProfile = { uid: "uid-ana", role: "campo", name: "Ana" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-ciclo-do-cliente-test");
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
  set("customers/ITAU", { code: "ITAU", customer_code: "ITAU", name: "Itaú Unibanco", status: "active" });
  set("client_access/ITAU", { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
  // A gestora ligou todos os avisos; a gerenciadora da obra, os da OS e o da NF, que ela não lê.
  set("customer_contacts/ct_gestora", {
    customer_code: "ITAU",
    nome: "Renata Campos",
    email: "renata@itau.example",
    papel: "gestor_cliente",
    ativo: true,
    avisos: ["pedido_do_portal", "os_agendada", "os_iniciada", "os_concluida", "nf_emitida"],
  });
  set("customer_contacts/ct_obra", { customer_code: "ITAU", nome: "Obra", email: "obra@gerenciadora.example", papel: "gerenciadora", ativo: true, avisos: ["os_agendada", "os_concluida", "nf_emitida"] });
  set("customer_contacts/ct_saiu", { customer_code: "ITAU", nome: "Saiu", email: "saiu@itau.example", papel: "gestor_cliente", ativo: false, avisos: ["os_concluida"] });
  set(`collaborators/${ANA}`, { id: ANA, nome: "Ana Lima", cpf: "52998224725", funcao: "Líder", papeis: ["lider", "motorista"], vinculo: "proprio", usuario_uid: "uid-ana", ativo: true, edicao: 1 });
  set(`vehicles/${VAN}`, { id: VAN, placa: "DEF4G56", tipo: "VUC", modelo: null, capacidade_kg: 3500, capacidade_m3: 12, revisao_em: null, ativo: true, edicao: 1 });
  await batch.commit();
});

const ANEXOS = new Map([["portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", { contentType: "application/pdf", size: 180_000 }]]);
const conferirAnexo: ConferirAnexo = async (caminho) => ANEXOS.get(caminho) ?? null;
const NO_STORAGE = new Map<string, { contentType: string; size: number }>();
const conferir: ConferirArquivo = async (caminho) => NO_STORAGE.get(caminho) ?? null;

/** A rotina dos avisos com o envio desligado, no instante dado (o de verdade, mais ou menos um tanto). */
const rodar = (deslocamentoMs: number) =>
  runNotificationsFor(db, { origem: ORIGEM, remetente: REMETENTE, enviar: enviarSoAuditoria, agora: () => new Date(Date.now() + deslocamentoMs) });

async function porModelo(colecao: string): Promise<Map<string, Record<string, unknown>>> {
  const lidos = (await db.collection(colecao).get()).docs.map((doc) => doc.data());
  return new Map(lidos.map((dados) => [String(dados.modelo), dados]));
}

/** A NF registrada no Financeiro: a NF do portal e o evento, como `registerNf` grava os dois na mesma transação. */
async function registrarNfComoOFinanceiro(demanda: string) {
  const batch = db.batch();
  batch.set(db.doc(`client_faturas/${FATURA}`), {
    id: FATURA,
    customer_code: "ITAU",
    status: "emitida",
    nf: { numero: "1234", serie: "1", emitida_em: DIA },
    valor_cents: 1_484_500,
    recebido_cents: 0,
    saldo_cents: 1_484_500,
    vencimento: "2026-11-20",
    forma: "boleto",
    demandas: [{ numero: demanda, titulo: "Transporte de paletes" }],
  });
  batch.set(db.doc("events/evt_nf_1234"), {
    id: "evt_nf_1234",
    type: "nf.registered",
    title: "NF registrada",
    description: "A NF emitida fora do sistema foi registrada e as demandas dela ficaram faturadas.",
    severity: "info",
    entity_type: "fatura",
    entity_id: FATURA,
    customer_code: "ITAU",
    payload: { id: FATURA, demandas: [demanda], autorizacoes: 1, emitida_em: DIA, vencimento: "2026-11-20", forma: "boleto" },
    occurred_at: new Date().toISOString(),
    source: "functions_financeiro",
    operation_id: "op_nf_1234",
    actor: { uid: "fin-1", role: "financeiro", name: "Carla" },
    created_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

describe("o ciclo do cliente", () => {
  it("pede pelo portal → demanda direta → OS agendada → execução e assinatura no celular → NF; cada passo vira sino e e-mail, sem valor na OS", async () => {
    // A primeira rodada só marca onde a rotina começa.
    assert.equal((await rodar(-1_000)).iniciou, true);

    const { solicitacao_id: solicitacao } = await requestServiceFor(
      db,
      cliente,
      {
        idempotency_key: "sol-1",
        tipo_servico: "transporte",
        data: DIA,
        horario: "14:00",
        origem: "Rua das Indústrias, 450 · Galpão 3",
        destino: "Av. Paulista, 1000",
        descricao: "Levar 12 paletes de mobiliário.",
        anexos: [{ arquivo: "an_0123456789abcdef.pdf", nome: "Lista de paletes.pdf" }],
      },
      conferirAnexo,
      DE_MANHA,
    );
    assert.equal((await db.collection(SERVICE_ORDERS_COLLECTION).get()).size, 0);

    const { numero: demanda } = await openDirectDemandFor(
      db,
      interno,
      {
        idempotency_key: "dem-portal",
        customer_code: "ITAU",
        titulo: "Transporte de paletes",
        canal: "portal",
        executar_ate: `${DIA}T18:00-03:00`,
        itens: [{ item: "Paletes de mobiliário", unidade: "UN", quantidade: "12" }],
        solicitacao_id: solicitacao,
      },
      () => new Date(`${DIA}T07:30:00-03:00`),
    );
    const [linha] = ((await db.doc(`demands/${demanda}`).get()).get("itens_pedidos") ?? []) as Array<{ id: string }>;
    const plano = await saveServiceOrderFor(db, interno, {
      action: "plan",
      idempotency_key: "plano",
      demanda,
      ordens: [{ itens: [{ id: linha.id, planejado: "12" }], janela: { data: DIA, inicio: "14:00", fim: "18:00" }, equipe: [{ colaborador_id: ANA, papel: "lider" }], veiculos: [VAN] }],
    });
    const [os] = plano.numeros;

    // No celular da líder: as etapas, o item, a foto do final e a assinatura do responsável.
    for (const [etapa, hora] of [["saida_patio", "13:20"], ["chegada_origem", "14:00"], ["carregamento", "14:10"], ["saida_origem", "15:00"], ["chegada_destino", "15:40"]]) {
      await registerStepFor(db, lider, { idempotency_key: `${os}-${etapa}`, numero: os, etapa, instante: `${DIA}T${hora}-03:00` }, NO_FIM_DO_DIA);
    }
    await registerItemFor(db, lider, { action: "executed", idempotency_key: `${os}-item`, numero: os, linha: linha.id, executado: "12", instante: `${DIA}T16:00-03:00` }, NO_FIM_DO_DIA);
    NO_STORAGE.set(`os/${os}/fotos/ft_f000000000000001.jpg`, { contentType: "image/jpeg", size: 220_000 });
    NO_STORAGE.set(`os/${os}/assinatura/as_0123456789abcdef.png`, { contentType: "image/png", size: 18_000 });
    await attachPhotoFor(db, lider, { idempotency_key: `${os}-foto`, numero: os, arquivo: "ft_f000000000000001.jpg", instante: `${DIA}T16:20-03:00`, etapa: "fim" }, conferir, NO_FIM_DO_DIA);
    await completeServiceOrderFor(
      db,
      lider,
      {
        idempotency_key: `${os}-fim`,
        numero: os,
        instante: `${DIA}T16:30-03:00`,
        aceite: "assinatura",
        responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
        assinatura: "as_0123456789abcdef.png",
        diferencas: [],
      },
      conferir,
      NO_FIM_DO_DIA,
    );
    assert.equal((await db.collection(SERVICE_ORDERS_COLLECTION).doc(os).get()).get("status"), "em_revisao");
    await registrarNfComoOFinanceiro(demanda);

    // A rotina lê o que passou do último minuto: com o relógio dois minutos à frente, todo o ciclo.
    const rodada = await rodar(2 * 60_000);
    assert.deepEqual([rodada.iniciou, rodada.avisos, rodada.emails, rodada.auditados, rodada.falhas], [false, 5, 5, 5, 0]);

    const sino = await porModelo(CLIENT_NOTIFICATIONS_COLLECTION);
    assert.deepEqual(
      [...sino.values()].map((aviso) => [aviso.modelo, aviso.customer_code, aviso.titulo, aviso.link]).sort(),
      [
        ["nf_emitida", "ITAU", "NF 1234 emitida", "/portal/faturas"],
        ["os_agendada", "ITAU", `OS ${os} agendada`, `/portal/servicos?os=${os}`],
        ["os_concluida", "ITAU", `OS ${os} concluída`, `/portal/servicos/comprovante?os=${os}`],
        ["os_iniciada", "ITAU", `OS ${os} em execução`, `/portal/servicos?os=${os}`],
        ["pedido_do_portal", "ITAU", "Solicitação recebida", "/portal/servicos"],
      ],
    );
    // O item livre do portal não tem serviço da tabela: o aviso diz o dia e o horário.
    const dia = DIA.split("-").reverse().join("/");
    assert.equal(sino.get("os_agendada")?.texto, `${dia} 14:00–18:00`);
    assert.equal(sino.get("os_iniciada")?.texto, "desde 13:20");
    assert.equal(sino.get("os_concluida")?.texto, `concluída em ${dia} 16:30`);
    assert.equal(sino.get("pedido_do_portal")?.texto, `Transporte / frete · ${dia} 14:00`);
    assert.equal(sino.get("nf_emitida")?.texto, "R$ 14.845,00 · vence 20/11/2026");

    // O e-mail de cada passo vai a quem ligou o modelo; o da NF, que tem valor, só à gestora.
    const emails = await porModelo(EMAIL_OUTBOX_COLLECTION);
    assert.deepEqual(
      [...emails.values()].map((email) => [email.modelo, (email.to as string[]).join(","), email.status]).sort(),
      [
        ["nf_emitida", "renata@itau.example", "audit"],
        ["os_agendada", "obra@gerenciadora.example,renata@itau.example", "audit"],
        ["os_concluida", "obra@gerenciadora.example,renata@itau.example", "audit"],
        ["os_iniciada", "renata@itau.example", "audit"],
        ["pedido_do_portal", "renata@itau.example", "audit"],
      ],
    );
    // O da conclusão leva ao comprovante do portal, com a assinatura e as fotos do final, que a conclusão listou.
    assert.equal(emails.get("os_concluida")?.subject, `OS ${os} concluída · Dutelog`);
    assert.ok(String(emails.get("os_concluida")?.text).includes(`O comprovante, com a assinatura e as fotos do final, está no portal:\n${ORIGEM}/portal/servicos/comprovante?os=${os}`));
    const conclusao = (await db.collection(SERVICE_ORDERS_COLLECTION).doc(os).get()).get("conclusao");
    assert.deepEqual([conclusao.assinatura, conclusao.arquivos_do_final], [`os/${os}/assinatura/as_0123456789abcdef.png`, ["ft_f000000000000001.jpg"]]);

    // Nenhum aviso nem e-mail de OS ou da solicitação leva valor, endereço ou o que o cliente escreveu.
    for (const colecao of [CLIENT_NOTIFICATIONS_COLLECTION, EMAIL_OUTBOX_COLLECTION]) {
      for (const [modelo, dados] of await porModelo(colecao)) {
        if (modelo === "nf_emitida") continue;
        assert.doesNotMatch(JSON.stringify(dados), /R\$|cents|valor|Indústrias|Paulista|paletes|Renata Campos/, `${colecao}:${modelo}`);
      }
    }
    assert.doesNotMatch(JSON.stringify((await db.collection(SERVICE_ORDERS_COLLECTION).doc(os).get()).data()), /preco|total_cents|valor|R\$/);

    // Rodar de novo não repete nada.
    const deNovo = await rodar(3 * 60_000);
    assert.deepEqual([deNovo.eventos, deNovo.avisos, deNovo.emails], [0, 0, 0]);
    assert.equal((await db.collection(CLIENT_NOTIFICATIONS_COLLECTION).get()).size, 5);
    const tipos = (await db.collection(EVENTS_COLLECTION).get()).docs.map((doc) => String(doc.get("type")));
    for (const tipo of ["portal.service_requested", "portal.service_accepted", "demand.direct_opened", "os.planned", "os.started", "os.completed", "os.signed", "nf.registered"]) {
      assert.ok(tipos.includes(tipo), tipo);
    }
  });
});
