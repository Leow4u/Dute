import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  CLIENT_NOTIFICATION_READS_COLLECTION,
  CLIENT_NOTIFICATIONS_COLLECTION,
  CURSOR_ID,
  EMAIL_OUTBOX_COLLECTION,
  NOTIFICATION_CURSORS_COLLECTION,
  TENTATIVAS_DO_EMAIL,
  enviarFila,
  enviarSoAuditoria,
  markNotificationsReadFor,
  relatoDosDesistidos,
  runNotificationsFor,
  type EnviarEmail,
} from "./avisos-gravacao.js";
import { EVENTS_COLLECTION } from "./events.js";

/**
 * A rotina dos avisos no emulador (parte 4.6a): a primeira rodada só marca o
 * cursor; depois, cada evento novo vira um aviso no sino e, para quem ligou
 * o modelo, um e-mail na fila, uma vez só, mesmo rodando de novo; o evento
 * do último minuto espera a próxima rodada; o cliente sem o módulo, o com o
 * portal desligado e o evento de outra codebase não dão aviso; a fila envia,
 * audita ou tenta de novo. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-operacao";
const ORIGEM = "https://app.dutelog.com.br";
const REMETENTE = "Dutelog <avisos@dutelog.com.br>";
const AS_10H = new Date("2026-10-28T13:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "operacao-avisos-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function minutos(base: Date, quantos: number): Date {
  return new Date(base.getTime() + quantos * 60_000);
}

async function evento(id: string, type: string, payload: Record<string, unknown>, criadoEm: Date, extra: Record<string, unknown> = {}) {
  await db.collection(EVENTS_COLLECTION).doc(id).set({
    id,
    type,
    source: type.startsWith("nf.") ? "functions_financeiro" : "functions_operacao",
    customer_code: "ITAU",
    payload,
    occurred_at: criadoEm.toISOString(),
    created_at: Timestamp.fromDate(criadoEm),
    ...extra,
  });
}

async function rodar(agora: Date, enviar: EnviarEmail = enviarSoAuditoria) {
  return runNotificationsFor(db, { origem: ORIGEM, remetente: REMETENTE, enviar, agora: () => agora });
}

async function avisos() {
  return (await db.collection(CLIENT_NOTIFICATIONS_COLLECTION).get()).docs.map((doc) => doc.data()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function emails() {
  return (await db.collection(EMAIL_OUTBOX_COLLECTION).get()).docs.map((doc) => doc.data()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  batch.set(db.collection("client_access").doc("ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
  // A Safra contratou só a armazenagem e as faturas: a OS dela não dá aviso.
  batch.set(db.collection("client_access").doc("SAFRA"), { customer_code: "SAFRA", modules: ["wms", "financeiro"] });
  batch.set(db.collection("customer_contacts").doc("ct_gestora"), { customer_code: "ITAU", email: "gestora@itau.com", papel: "gestor_cliente", ativo: true, avisos: ["os_agendada", "nf_emitida"] });
  batch.set(db.collection("customer_contacts").doc("ct_obra"), { customer_code: "ITAU", email: "obra@gerenciadora.com", papel: "gerenciadora", ativo: true, avisos: ["os_agendada", "nf_emitida"] });
  batch.set(db.collection("customer_contacts").doc("ct_safra"), { customer_code: "SAFRA", email: "gestor@safra.com", papel: "gestor_cliente", ativo: true, avisos: ["os_agendada"] });
  batch.set(db.collection("service_orders").doc("10050-01"), { id: "10050-01", customer_code: "ITAU", tipo: "servico", servicos: ["transporte"], janela: { data: "2026-10-29", inicio: "08:00", fim: "12:00" } });
  batch.set(db.collection("service_orders").doc("10060-01"), { id: "10060-01", customer_code: "SAFRA", tipo: "servico", servicos: ["transporte"], janela: { data: "2026-10-29", inicio: "08:00", fim: null } });
  batch.set(db.collection("client_faturas").doc("fat_itau"), { id: "fat_itau", customer_code: "ITAU", nf: { numero: "1234" }, valor_cents: 50000, vencimento: "2026-11-27" });
  await batch.commit();
});

describe("a rotina dos avisos", () => {
  it("a primeira rodada só marca o cursor: o que veio antes não vira aviso", async () => {
    await evento("evt_antes", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, -60));
    const resultado = await rodar(AS_10H);
    assert.equal(resultado.iniciou, true);
    assert.equal(resultado.eventos, 0);
    assert.deepEqual(await avisos(), []);
    const cursor = await db.collection(NOTIFICATION_CURSORS_COLLECTION).doc(CURSOR_ID).get();
    assert.equal(cursor.get("created_at").toMillis(), AS_10H.getTime());
    // A segunda rodada parte do cursor: o evento de antes continua fora.
    assert.equal((await rodar(minutos(AS_10H, 5))).avisos, 0);
  });

  it("o evento novo vira um aviso no sino e um e-mail para quem ligou o modelo, uma vez só", async () => {
    await rodar(AS_10H);
    await evento("evt_os", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, 1));
    await evento("evt_nf", "nf.registered", { id: "fat_itau" }, minutos(AS_10H, 2));
    const resultado = await rodar(minutos(AS_10H, 5));
    assert.deepEqual(resultado, { iniciou: false, eventos: 2, avisos: 2, emails: 2, enviados: 0, auditados: 2, falhas: 0, desistidos: [] });

    const [daNf, daOs] = await avisos();
    assert.equal(daOs.id, "ntf_evt_os");
    assert.equal(daOs.customer_code, "ITAU");
    assert.equal(daOs.titulo, "OS 10050-01 agendada");
    assert.equal(daOs.texto, "Transporte · 29/10/2026 08:00–12:00");
    assert.equal(daOs.link, "/portal/servicos?os=10050-01");
    assert.equal(daNf.texto, "R$ 500,00 · vence 27/11/2026");

    const [daNfPorEmail, daOsPorEmail] = await emails();
    // A OS vai à gestora e à gerenciadora; a NF, que leva valor, só à gestora.
    assert.deepEqual(daOsPorEmail.to, ["gestora@itau.com", "obra@gerenciadora.com"]);
    assert.deepEqual(daNfPorEmail.to, ["gestora@itau.com"]);
    assert.equal(daOsPorEmail.status, "audit");
    assert.match(daOsPorEmail.text, /https:\/\/app\.dutelog\.com\.br\/portal\/servicos\?os=10050-01/);

    // Rodar de novo, mesmo com o cursor de volta ao começo, não duplica.
    await db.collection(NOTIFICATION_CURSORS_COLLECTION).doc(CURSOR_ID).set({ created_at: Timestamp.fromDate(AS_10H), evento_id: "" });
    const outra = await rodar(minutos(AS_10H, 6));
    assert.equal(outra.eventos, 2);
    assert.equal(outra.avisos, 0);
    assert.equal(outra.emails, 0);
    assert.equal((await avisos()).length, 2);
    assert.equal((await emails()).length, 2);
  });

  it("o evento do último minuto espera a próxima rodada", async () => {
    await rodar(AS_10H);
    await evento("evt_os", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, 4.5));
    assert.equal((await rodar(minutos(AS_10H, 5))).eventos, 0);
    assert.equal((await rodar(minutos(AS_10H, 6))).avisos, 1);
  });

  it("o cliente sem o módulo, o evento de outra codebase e o evento sem aviso ficam de fora", async () => {
    await rodar(AS_10H);
    await evento("evt_safra", "os.scheduled", { id: "10060-01" }, minutos(AS_10H, 1), { customer_code: "SAFRA" });
    await evento("evt_wms", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, 1), { source: "functions_wms" });
    await evento("evt_sem_data", "os.planned", { id: "10050-01", data: null }, minutos(AS_10H, 1));
    await evento("evt_cancelada", "os.cancelled", { id: "10050-01" }, minutos(AS_10H, 1));
    await evento("evt_sem_os", "os.started", { id: "10099-01" }, minutos(AS_10H, 1));
    const resultado = await rodar(minutos(AS_10H, 5));
    assert.equal(resultado.eventos, 4);
    assert.equal(resultado.avisos, 0);
    assert.deepEqual(await avisos(), []);
    assert.deepEqual(await emails(), []);
  });

  it("o cliente com o portal desligado não recebe aviso, nem no sino nem por e-mail; o portal religado volta a receber os novos (pergunta 71)", async () => {
    await rodar(AS_10H);
    await db.collection("client_access").doc("ITAU").set({ portal_ativo: false }, { merge: true });
    await evento("evt_cortado", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, 1));
    const cortado = await rodar(minutos(AS_10H, 5));
    assert.deepEqual([cortado.eventos, cortado.avisos, cortado.emails], [1, 0, 0]);
    assert.deepEqual([await avisos(), await emails()], [[], []]);

    // Religado, o evento novo dá aviso; o de quando estava desligado não volta.
    await db.collection("client_access").doc("ITAU").set({ portal_ativo: true }, { merge: true });
    await evento("evt_religado", "os.scheduled", { id: "10050-01" }, minutos(AS_10H, 6));
    const religado = await rodar(minutos(AS_10H, 10));
    assert.deepEqual([religado.eventos, religado.avisos, religado.emails], [1, 1, 1]);
    assert.deepEqual((await avisos()).map((aviso) => aviso.id), ["ntf_evt_religado"]);
  });

  it("o alerta de itens parados aprovado no núcleo vira aviso; o proposto e o do cliente sem armazenagem, não (parte 5.4f)", async () => {
    await rodar(AS_10H);
    const alerta = { customer_code: "ITAU", regra: { parado_dias: 90, sem_giro_dias: 180 }, itens_enviados: [{ sku_code: "ITAU-000001", client_item_code: "POLO-M", saldo: 30 }] };
    await db.collection("ai_stock_alerts").doc("alerta_itau").set({ id: "alerta_itau", status: "aprovada", ...alerta });
    await db.collection("ai_stock_alerts").doc("alerta_proposto").set({ id: "alerta_proposto", status: "proposta", ...alerta });
    await db.collection("ai_stock_alerts").doc("alerta_obra").set({ id: "alerta_obra", status: "aprovada", ...alerta, customer_code: "OBRA" });
    await db.collection("client_access").doc("OBRA").set({ customer_code: "OBRA", modules: ["operacao"] });
    await db.collection("customer_contacts").doc("ct_gestora").update({ avisos: ["os_agendada", "nf_emitida", "estoque_parado"] });
    const doNucleo = { source: "functions_core" };
    await evento("evt_parado", "estoque_parado.aprovado", { id: "alerta_itau", itens: 1 }, minutos(AS_10H, 1), doNucleo);
    await evento("evt_proposto", "estoque_parado.aprovado", { id: "alerta_proposto", itens: 1 }, minutos(AS_10H, 1), doNucleo);
    await evento("evt_obra", "estoque_parado.aprovado", { id: "alerta_obra", itens: 1 }, minutos(AS_10H, 1), { ...doNucleo, customer_code: "OBRA" });
    await evento("evt_descartado", "estoque_parado.descartado", { id: "alerta_itau", itens: 0 }, minutos(AS_10H, 1), doNucleo);
    await evento("evt_outra_fonte", "estoque_parado.aprovado", { id: "alerta_itau", itens: 1 }, minutos(AS_10H, 1));
    const resultado = await rodar(minutos(AS_10H, 5));
    assert.equal(resultado.eventos, 4);
    assert.equal(resultado.avisos, 1);
    assert.equal(resultado.emails, 1);
    const [aviso] = await avisos();
    assert.equal(aviso.id, "ntf_evt_parado");
    assert.equal(aviso.titulo, "1 item parado no estoque");
    assert.equal(aviso.texto, "Sem movimento há 90 dias ou mais · POLO-M");
    assert.equal(aviso.link, "/portal/estoque");
    const [email] = await emails();
    assert.deepEqual(email.to, ["gestora@itau.com"]);
    assert.match(email.text, /https:\/\/app\.dutelog\.com\.br\/portal\/estoque/);
  });

  it("sem contato com o modelo ligado, só o sino", async () => {
    await rodar(AS_10H);
    await evento("evt_concluida", "os.completed", { id: "10050-01", instante: minutos(AS_10H, 1).toISOString() }, minutos(AS_10H, 1));
    const resultado = await rodar(minutos(AS_10H, 5));
    assert.equal(resultado.avisos, 1);
    assert.equal(resultado.emails, 0);
    assert.deepEqual(await emails(), []);
  });
});

describe("a fila de e-mail", () => {
  async function pendente(id: string, tentativas = 0) {
    await db.collection(EMAIL_OUTBOX_COLLECTION).doc(id).set({ id, to: ["gestora@itau.com"], subject: "Assunto", text: "Texto", status: "pending", tentativas });
  }

  it("o enviado guarda o id do provedor e não sai de novo", async () => {
    await pendente("mail_a");
    let chamadas = 0;
    const enviar: EnviarEmail = async (email) => {
      chamadas += 1;
      assert.equal(email.from, REMETENTE);
      assert.equal(email.id, "mail_a");
      return { status: "sent", provider_id: "re_1" };
    };
    assert.deepEqual(await enviarFila(db, enviar, REMETENTE), { enviados: 1, auditados: 0, falhas: 0, desistidos: [] });
    const enviado = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc("mail_a").get()).data()!;
    assert.equal(enviado.status, "sent");
    assert.equal(enviado.provider_id, "re_1");
    assert.ok(enviado.enviado_em);
    assert.deepEqual(await enviarFila(db, enviar, REMETENTE), { enviados: 0, auditados: 0, falhas: 0, desistidos: [] });
    assert.equal(chamadas, 1);
  });

  it("a falha tenta de novo e, na quinta, fica como falha", async () => {
    await pendente("mail_b", TENTATIVAS_DO_EMAIL - 2);
    const falhar: EnviarEmail = async () => {
      throw new Error("Resend recusou o envio (500): fora do ar");
    };
    const primeira = await enviarFila(db, falhar, REMETENTE);
    assert.equal(primeira.falhas, 1);
    assert.deepEqual(primeira.desistidos, []);
    let lido = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc("mail_b").get()).data()!;
    assert.equal(lido.status, "pending");
    assert.equal(lido.tentativas, TENTATIVAS_DO_EMAIL - 1);
    assert.match(lido.erro, /fora do ar/);
    const quinta = await enviarFila(db, falhar, REMETENTE);
    lido = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc("mail_b").get()).data()!;
    assert.equal(lido.status, "failed");
    assert.equal(lido.tentativas, TENTATIVAS_DO_EMAIL);
    assert.deepEqual(quinta.desistidos, [{ id: "mail_b", erro: "Resend recusou o envio (500): fora do ar" }]);
  });

  it("o e-mail que desistiu vira uma linha de erro com a primeira linha fixa e sem o endereço", () => {
    assert.equal(relatoDosDesistidos([]), null);
    assert.equal(
      relatoDosDesistidos([
        { id: "mail_b", erro: "Resend recusou o envio (422): gestora@itau.com não existe" },
        { id: "mail_c", erro: "Resend recusou o envio (500): fora do ar" },
      ]),
      [
        `E-mail sem envio depois de ${TENTATIVAS_DO_EMAIL} tentativas (runNotifications)`,
        "mail_b: Resend recusou o envio (422): <e-mail> não existe",
        "mail_c: Resend recusou o envio (500): fora do ar",
      ].join("\n"),
    );
  });
});

describe("o sino visto (parte 4.6c)", () => {
  const roberto = { uid: "cli-itau", role: "cliente" as const, customer_code: "ITAU" };

  it("grava até quando o login viu os avisos; repetir só avança o instante", async () => {
    assert.deepEqual(await markNotificationsReadFor(db, roberto, {}, () => AS_10H), { lidos_ate: AS_10H.toISOString() });
    let marca = (await db.collection(CLIENT_NOTIFICATION_READS_COLLECTION).doc("cli-itau").get()).data()!;
    assert.equal(marca.customer_code, "ITAU");
    assert.equal(marca.lidos_ate.toMillis(), AS_10H.getTime());
    await markNotificationsReadFor(db, roberto, undefined, () => minutos(AS_10H, 3));
    marca = (await db.collection(CLIENT_NOTIFICATION_READS_COLLECTION).doc("cli-itau").get()).data()!;
    assert.equal(marca.lidos_ate.toMillis(), minutos(AS_10H, 3).getTime());
    assert.equal((await db.collection(EVENTS_COLLECTION).get()).size, 0, "marcar como visto não é evento");
  });

  it("campo a mais ou quem não é cliente, recusa", async () => {
    await assert.rejects(markNotificationsReadFor(db, roberto, { ate: "2026-10-28" }), /Campo não aceito/);
    await assert.rejects(markNotificationsReadFor(db, { uid: "interno-1", role: "interno" }, {}), /Só o cliente/);
    assert.equal((await db.collection(CLIENT_NOTIFICATION_READS_COLLECTION).get()).size, 0);
  });
});
