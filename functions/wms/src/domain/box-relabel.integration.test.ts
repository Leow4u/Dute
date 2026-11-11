import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { etiquetaParaTrocar, recordBoxBalanceLabelPrint } from "./box-relabel.js";
import type { OperationalActor } from "./operations.js";

/**
 * Etiquetas para trocar (separação com caixas, parte 3d), no emulador. Antes,
 * a caixa de onde saiu peça ficava com a etiqueta do conteúdo de entrada e
 * nada dizia que ela precisava de etiqueta nova.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const guilherme: OperationalActor = { uid: "wms-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "wms", customer_code: "Dutelog" };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "box-relabel-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const caixa = (code: string, extra: Record<string, unknown>) =>
    db
      .collection("warehouse_boxes")
      .doc(code)
      .set({ id: code, code, customer_code: BTG, status: "stored", location_id: "A-05", stored_at: "2026-10-22T13:00:00.000Z", unit_count: 42, ...extra });
  await Promise.all([
    // Aberta: saíram 30 das 42.
    caixa("CX-000027", { taken_lines: [{ sku_code: "BTG-000083", qty: 30 }], taken_units: 30, balance_at: "2026-11-11T14:00:00.000Z" }),
    // Intacta.
    caixa("CX-000028", {}),
    // Vazia: saiu da prateleira.
    caixa("CX-000029", { status: "emptied", taken_lines: [{ sku_code: "BTG-000086", qty: 42 }], taken_units: 42, balance_at: "2026-11-11T16:00:00.000Z" }),
  ]);
});

let chaves = 0;
function chave() {
  chaves += 1;
  return `etiqueta-${String(chaves).padStart(6, "0")}`;
}

function registrar(box_codes: string[], idempotency_key = chave()) {
  return recordBoxBalanceLabelPrint(db, { box_codes, idempotency_key }, guilherme) as Promise<Record<string, unknown>>;
}

async function caixa(code: string) {
  return (await db.collection("warehouse_boxes").doc(code).get()).data() ?? {};
}

async function eventos() {
  return (await db.collection("events").where("type", "==", "warehouse.box_balance_label_printed").get()).docs.map((doc) => doc.data());
}

async function recusa(acao: Promise<unknown>): Promise<HttpsError> {
  try {
    await acao;
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  throw new assert.AssertionError({ message: "Deveria ter recusado." });
}

describe("Etiquetas para trocar (separação com caixas, parte 3d)", () => {
  it("a caixa aberta precisa de etiqueta até a impressão do saldo dela ser registrada; a intacta e a vazia, não", async () => {
    assert.deepEqual(
      [etiquetaParaTrocar(await caixa("CX-000027")), etiquetaParaTrocar(await caixa("CX-000028")), etiquetaParaTrocar(await caixa("CX-000029"))],
      [true, false, false],
    );
    const resultado = await registrar(["cx-000027", "CX-000028", "CX-000029"]);
    assert.deepEqual([resultado.ok, resultado.printed, resultado.skipped], [true, ["CX-000027"], ["CX-000028", "CX-000029"]]);

    const aberta = await caixa("CX-000027");
    assert.deepEqual(
      [aberta.balance_label_printed_at, aberta.balance_label_printed_for, aberta.balance_label_print_count, aberta.balance_label_printed_by.name],
      [resultado.printed_at, "2026-11-11T14:00:00.000Z", 1, "Guilherme Dantas"],
    );
    assert.equal(etiquetaParaTrocar(aberta), false);
    // O saldo, o conteúdo e a posição da caixa não mudam: é só o registro do clique.
    assert.deepEqual([aberta.status, aberta.taken_units, aberta.balance_at, aberta.location_id], ["stored", 30, "2026-11-11T14:00:00.000Z", "A-05"]);
    // A intacta e a vazia não registram nada.
    assert.equal((await caixa("CX-000028")).balance_label_printed_at, undefined);
    assert.equal((await caixa("CX-000029")).balance_label_printed_at, undefined);

    const [evento, ...outros] = await eventos();
    assert.equal(outros.length, 0);
    assert.deepEqual(
      [evento.title, evento.description, evento.entity_type, evento.entity_id, evento.customer_code, evento.actor.uid],
      ["Etiqueta da caixa CX-000027 trocada · A-05", "Etiqueta com o saldo de 12 un.", "warehouse_boxes", "CX-000027", BTG, "wms-1"],
    );
    assert.deepEqual(evento.payload, { box_code: "CX-000027", location_id: "A-05", balance_units: 12, balance_at: "2026-11-11T14:00:00.000Z", print_count: 1 });
    const avisos = (await db.collection("ai_agent_inbox").get()).docs.map((doc) => doc.get("event_id"));
    assert.equal(avisos.includes(evento.id), false);
  });

  it("quando o saldo muda de novo, a etiqueta impressa deixa de valer; a reimpressão conta", async () => {
    await registrar(["CX-000027"]);
    // Outra linha tirou mais 5 da caixa.
    await db.collection("warehouse_boxes").doc("CX-000027").update({ taken_units: 35, balance_at: "2026-11-12T09:00:00.000Z" });
    assert.equal(etiquetaParaTrocar(await caixa("CX-000027")), true);
    const outra = await registrar(["CX-000027"]);
    assert.deepEqual(outra.printed, ["CX-000027"]);
    const aberta = await caixa("CX-000027");
    assert.deepEqual([aberta.balance_label_printed_for, aberta.balance_label_print_count], ["2026-11-12T09:00:00.000Z", 2]);
    const descricoes = (await eventos()).map((evento) => evento.description).sort();
    assert.deepEqual(descricoes, ["Etiqueta com o saldo de 12 un.", "Etiqueta com o saldo de 7 un. · impressão 2"]);
  });

  it("a mesma chave devolve o mesmo resultado, a caixa que não existe é recusada e nada fica pela metade", async () => {
    const primeira = await registrar(["CX-000027"], "etiqueta-repetida-01");
    const repetida = await registrar(["CX-000027"], "etiqueta-repetida-01");
    assert.deepEqual(repetida, primeira);
    assert.equal((await caixa("CX-000027")).balance_label_print_count, 1);
    assert.equal((await eventos()).length, 1);

    const erro = await recusa(registrar(["CX-000027", "CX-000900"]));
    assert.deepEqual([erro.code, erro.message], ["not-found", "Caixa CX-000900 não encontrada."]);
    assert.equal((await caixa("CX-000027")).balance_label_print_count, 1);

    assert.equal((await recusa(recordBoxBalanceLabelPrint(db, { box_codes: [], idempotency_key: "etiqueta-vazia-0001" }, guilherme))).code, "invalid-argument");
    assert.equal((await recusa(recordBoxBalanceLabelPrint(db, { box_codes: ["CX-000027"], idempotency_key: "curta" }, guilherme))).code, "invalid-argument");
  });
});
