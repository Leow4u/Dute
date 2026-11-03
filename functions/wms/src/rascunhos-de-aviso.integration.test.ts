import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { getFirestore } from "firebase-admin/firestore";

/**
 * Os rascunhos de aviso do Agent Dute (syncOperationalNotifications): o mesmo
 * texto serve a todo cliente. Nenhum rascunho fala com a BTG nem cumprimenta
 * um contato dela quando o evento é de outro cliente; o rascunho interno diz
 * de que cliente é. A callable de verdade, pelo `.run`, no emulador.
 */

const PROJECT_ID = "demo-dute-operations";
const CLIENTE = "Cliente Novo";

type Callable = { run: (request: never) => Promise<unknown> };

/** Um evento de cada tipo de rascunho: quatro para o cliente e dois internos. */
const EVENTOS: { id: string; type: string; severity: string; description?: string }[] = [
  { id: "evt_estoque", type: "inventory.received", severity: "info" },
  { id: "evt_pedido", type: "order.status_changed", severity: "info" },
  { id: "evt_entrega", type: "shipment.dispatched", severity: "info" },
  { id: "evt_fatura", type: "billing.invoice_issued", severity: "info" },
  { id: "evt_excecao", type: "inbound.exception_found", severity: "attention" },
  { id: "evt_sinal", type: "operator.note", severity: "attention" },
];

/**
 * A caixa é detalhe interno (P8, decidido em 02/11/2026): o evento da
 * abertura do inventário, que diz a caixa e a posição, e qualquer evento que
 * cite um CX- viram rascunho interno.
 */
const EVENTOS_COM_CAIXA = [
  {
    id: "evt_abertura",
    type: "inventory.opening_counted",
    severity: "info",
    description: "Camiseta publicado com 10 unidade(s) no local A-01 (caixa CX-000001).",
  },
  {
    id: "evt_caixa_corrigida",
    type: "inventory.opening_line_moved",
    severity: "attention",
    description: "2 unidade(s) de CLI-000001: CX-000001 → CX-000002. Caixa trocada.",
  },
  {
    id: "evt_estoque_com_caixa",
    type: "inventory.received",
    severity: "info",
    description: "Entrada conferida na caixa CX-000003.",
  },
];

const INTERNO = {
  auth: { uid: "interno-a", token: { email: "interno-a@dutelog.com.br" } },
  rawRequest: { headers: {} },
};

let rascunhos: Map<string, Record<string, unknown>>;
let decide: Callable;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  // O index.js inicializa o app do Firebase: vem antes do getFirestore.
  const index = await import("./index.js");
  const sync = index.syncOperationalNotifications as unknown as Callable;
  decide = index.decideOperationalNotification as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  await db.collection("users").doc("interno-a").set({ role: "interno", nome: "Interno" });
  for (const evento of [...EVENTOS, ...EVENTOS_COM_CAIXA]) {
    await db.collection("events").doc(evento.id).set({
      type: evento.type,
      severity: evento.severity,
      title: `Título ${evento.id}`,
      ...(evento.description ? { description: evento.description } : {}),
      customer_code: CLIENTE,
      customer_name: CLIENTE,
      occurred_at: new Date().toISOString(),
      source: "functions",
    });
  }
  // A conclusão da chegada por caixa: o aviso sai na última guarda (decisão 20).
  for (const [id, type] of [["evt_caixa_entrada", "inventory.received"], ["evt_caixa_concluida", "inbound.checked"]]) {
    await db.collection("events").doc(id).set({
      type,
      severity: "info",
      title: `Título ${id}`,
      customer_code: CLIENTE,
      customer_name: CLIENTE,
      occurred_at: new Date().toISOString(),
      source: "functions",
      payload: { client_notice: "after_putaway" },
    });
  }
  await sync.run({ ...INTERNO, data: { customer_code: CLIENTE } } as never);
  const snapshot = await db.collection("operational_notifications").get();
  rascunhos = new Map(snapshot.docs.map((doc) => [String(doc.data().trigger_event_id), doc.data()]));
});

/** Um aviso ao cliente gravado antes da correção, com a caixa no texto. */
async function avisoAntigoComCaixa(id: string, status: "draft" | "approved") {
  await getFirestore().collection("operational_notifications").doc(id).set({
    status,
    audience: "client",
    topic: "inventory",
    customer_code: CLIENTE,
    customer_name: CLIENTE,
    title: "Produto contado no inventário de abertura",
    subject: "Estoque atualizado pela Dutelog",
    body: "Olá.\n\nProduto contado no inventário de abertura.\nCamiseta publicado com 10 unidade(s) no local A-01 (caixa CX-000001).",
    recipients: ["compras@cliente.com.br"],
  });
}

describe("os rascunhos de aviso do Agent Dute", () => {
  it("um rascunho de outro cliente não fala com a BTG nem com um contato dela", () => {
    assert.deepEqual(
      [...rascunhos.keys()].sort(),
      [...EVENTOS, ...EVENTOS_COM_CAIXA].map((evento) => evento.id).sort(),
    );
    for (const [evento, rascunho] of rascunhos) {
      const texto = [rascunho.subject, rascunho.body, rascunho.recommended_action].join("\n");
      assert.doesNotMatch(texto, /BTG|Cristiane/, `${evento}: ${texto}`);
    }
  });

  it("a conclusão da chegada por caixa não vira rascunho: o aviso sai na última guarda", () => {
    assert.equal(rascunhos.has("evt_caixa_entrada"), false);
    assert.equal(rascunhos.has("evt_caixa_concluida"), false);
  });

  it("o do cliente cumprimenta sem nome; o interno diz de que cliente é", () => {
    assert.equal(rascunhos.get("evt_estoque")?.subject, "Estoque atualizado pela Dutelog");
    assert.match(String(rascunhos.get("evt_estoque")?.body), /^Olá\.\n\nTítulo evt_estoque\./);
    assert.equal(rascunhos.get("evt_excecao")?.subject, `Atenção operacional: ${CLIENTE}`);
    assert.equal(rascunhos.get("evt_sinal")?.subject, `Sinal operacional para acompanhamento: ${CLIENTE}`);
  });

  it("a caixa é detalhe interno: o evento da abertura e o que cita CX- viram rascunho interno", () => {
    for (const evento of EVENTOS_COM_CAIXA) {
      const rascunho = rascunhos.get(evento.id);
      assert.equal(rascunho?.audience, "internal", evento.id);
      assert.equal(rascunho?.subject, `Registro interno do estoque: ${CLIENTE}`, evento.id);
    }
    for (const [evento, rascunho] of rascunhos) {
      if (rascunho.audience !== "client") continue;
      const texto = [rascunho.title, rascunho.subject, rascunho.body].join("\n");
      assert.doesNotMatch(texto, /CX-\d/, `${evento}: ${texto}`);
    }
  });

  it("aviso ao cliente gravado antes, com CX-, não se aprova nem se envia", async () => {
    await avisoAntigoComCaixa("notif_antigo_rascunho", "draft");
    await avisoAntigoComCaixa("notif_antigo_aprovado", "approved");
    const recusa = /O aviso ao cliente cita uma caixa \(CX-\): a caixa é detalhe interno\. Arquive este rascunho\./;
    await assert.rejects(
      decide.run({ ...INTERNO, data: { notification_id: "notif_antigo_rascunho", action: "approve" } } as never),
      recusa,
    );
    await assert.rejects(
      decide.run({ ...INTERNO, data: { notification_id: "notif_antigo_aprovado", action: "mark_sent" } } as never),
      recusa,
    );
    const db = getFirestore();
    const rascunho = await db.collection("operational_notifications").doc("notif_antigo_rascunho").get();
    const aprovado = await db.collection("operational_notifications").doc("notif_antigo_aprovado").get();
    assert.equal(rascunho.data()?.status, "draft");
    assert.equal(aprovado.data()?.status, "approved");
    assert.equal(aprovado.data()?.email_delivery, undefined);
    // Arquivar continua valendo: é o caminho para tirar o rascunho da fila.
    await decide.run({ ...INTERNO, data: { notification_id: "notif_antigo_rascunho", action: "archive" } } as never);
    const arquivado = await db.collection("operational_notifications").doc("notif_antigo_rascunho").get();
    assert.equal(arquivado.data()?.status, "archived");
  });
});
