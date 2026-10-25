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
const EVENTOS = [
  { id: "evt_estoque", type: "inventory.received", severity: "info" },
  { id: "evt_pedido", type: "order.status_changed", severity: "info" },
  { id: "evt_entrega", type: "shipment.dispatched", severity: "info" },
  { id: "evt_fatura", type: "billing.invoice_issued", severity: "info" },
  { id: "evt_excecao", type: "inbound.exception_found", severity: "attention" },
  { id: "evt_sinal", type: "operator.note", severity: "attention" },
];

let rascunhos: Map<string, Record<string, unknown>>;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  // O index.js inicializa o app do Firebase: vem antes do getFirestore.
  const sync = (await import("./index.js")).syncOperationalNotifications as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  await db.collection("users").doc("interno-a").set({ role: "interno", nome: "Interno" });
  for (const evento of EVENTOS) {
    await db.collection("events").doc(evento.id).set({
      type: evento.type,
      severity: evento.severity,
      title: `Título ${evento.id}`,
      customer_code: CLIENTE,
      customer_name: CLIENTE,
      occurred_at: new Date().toISOString(),
      source: "functions",
    });
  }
  await sync.run({
    auth: { uid: "interno-a", token: { email: "interno-a@dutelog.com.br" } },
    data: { customer_code: CLIENTE },
    rawRequest: { headers: {} },
  } as never);
  const snapshot = await db.collection("operational_notifications").get();
  rascunhos = new Map(snapshot.docs.map((doc) => [String(doc.data().trigger_event_id), doc.data()]));
});

describe("os rascunhos de aviso do Agent Dute", () => {
  it("um rascunho de outro cliente não fala com a BTG nem com um contato dela", () => {
    assert.deepEqual([...rascunhos.keys()].sort(), EVENTOS.map((evento) => evento.id).sort());
    for (const [evento, rascunho] of rascunhos) {
      const texto = [rascunho.subject, rascunho.body, rascunho.recommended_action].join("\n");
      assert.doesNotMatch(texto, /BTG|Cristiane/, `${evento}: ${texto}`);
    }
  });

  it("o do cliente cumprimenta sem nome; o interno diz de que cliente é", () => {
    assert.equal(rascunhos.get("evt_estoque")?.subject, "Estoque atualizado pela Dutelog");
    assert.match(String(rascunhos.get("evt_estoque")?.body), /^Olá\.\n\nTítulo evt_estoque\./);
    assert.equal(rascunhos.get("evt_excecao")?.subject, `Atenção operacional: ${CLIENTE}`);
    assert.equal(rascunhos.get("evt_sinal")?.subject, `Sinal operacional para acompanhamento: ${CLIENTE}`);
  });
});
