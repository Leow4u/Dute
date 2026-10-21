import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  createOpeningInventorySessionTransaction,
  recordCycleCountTransaction,
  removeOpeningInventoryLineTransaction,
  type OperationalActor,
} from "./operations.js";
import { seedDefaultWarehouseLayout, upsertWarehousePositions } from "./warehouse-positions.js";
import {
  createWarehouseBox,
  listWarehouseBoxes,
  removeWarehouseBox,
  suggestWarehousePosition,
} from "./warehouse-boxes.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const coordenacao = { uid: "ops-1", name: "Leonardo", role: "interno", email: "ops@dutelog.com.br" };
const operacao: OperationalActor = { uid: "wms-1", name: "Operador", role: "wms", email: "wms@dutelog.com.br" };
const cliente = { uid: "cli-1", name: "Cristiane", role: "cliente", customer_code: BTG };
const box = { length_m: 0.5, width_m: 0.5, height_m: 0.35, gross_weight_kg: 12.4 };

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "warehouse-boxes-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await seedDefaultWarehouseLayout(db, coordenacao);
  // Produto novo ganha SKU na sigla do cliente (domain/catalog-codes.ts).
  await db.collection("customers").doc("BTG_Pactual").set({ code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active" });
  // Zona da BTG: A-01 a A-03. O resto fica livre.
  await upsertWarehousePositions(
    db,
    {
      positions: [1, 2, 3].map((shelf) => ({ aisle: "A", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })),
    },
    coordenacao,
  );
});

after(async () => {
  await deleteApp(app);
});

async function events(type: string) {
  return (await db.collection("events").where("type", "==", type).get()).docs.map((row) => row.data());
}

function store(locationId: string, key: string, extra: Record<string, unknown> = {}) {
  return createWarehouseBox(db, { customer_code: BTG, ...box, location_id: locationId, idempotency_key: key, ...extra }, operacao);
}

function openingLine(sessionId: string, boxCode: string, overrides: Record<string, unknown> = {}) {
  return recordCycleCountTransaction(
    db,
    {
      mode: "opening",
      session_id: sessionId,
      customer_code: BTG,
      // Produto novo ganha o SKU gerado (o primeiro depois da limpeza é
      // BTG-000001); o código aqui serve à segunda caixa, como existente.
      sku_code: "BTG-000001",
      client_item_code: "A.01.0802.007.G",
      product_name: "Camisa social branca manga longa",
      product_registration: "new",
      category: "Uniforme",
      genero: "Masculino",
      grupo: "Camisa",
      photo_urls: ["https://storage.googleapis.com/demo-dute-operations/product-photos/camisa.jpg"],
      photo_storage_paths: ["customers/BTG_Pactual/product-photos/camisa.jpg"],
      location_id: "A-01",
      counted_qty: 12,
      unit_cost: 189.9,
      reason: "Inventário físico de abertura",
      box_code: boxCode,
      idempotency_key: `line-${boxCode}-${overrides.idempotency_key ?? "1"}`,
      ...overrides,
    },
    operacao,
  );
}

describe("caixas e endereçamento dirigido", () => {

  it("prévia manual alcança uma prateleira fora das três sugestões sem gravar nada", async () => {
    await upsertWarehousePositions(db, {
      positions: [{ aisle: "A", shelf: 4, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG }],
    }, coordenacao);
    const automatic = await suggestWarehousePosition(db, { customer_code: BTG, ...box }, operacao);
    assert.deepEqual([automatic.position?.code, ...automatic.alternatives.map((item) => item.code)], ["A-01", "A-02", "A-03"]);
    const before = (await db.collection("events").get()).size;
    const preview = await suggestWarehousePosition(db, { customer_code: BTG, ...box, location_id: " a-04 " }, operacao);
    assert.equal(preview.position?.code, "A-04");
    assert.equal(preview.position?.reason, "Prateleira selecionada manualmente.");
    assert.deepEqual(preview.position?.placement, automatic.position?.placement);
    assert.deepEqual(preview.alternatives, []);
    assert.equal(preview.checked, 1);
    assert.equal(preview.zone_positions, 4);
    assert.equal(preview.rejected, null);
    assert.equal((await db.collection("warehouse_boxes").get()).size, 0);
    assert.equal((await db.collection("events").get()).size, before);
    assert.equal((await db.collection("warehouse_positions").doc("A-04").get()).get("occupancy_revision"), undefined);
  });

  it("prévia manual recusa posição inexistente, de outra zona e posição inativa", async () => {
    await db.collection("warehouse_positions").doc("A-04").update({ customer_code: "Outro cliente" });
    const preview = (location_id: string) => suggestWarehousePosition(db, { customer_code: BTG, ...box, location_id }, operacao);
    for (const code of ["A-99", "A-04"]) {
      await assert.rejects(preview(code), { code: "not-found", message: "Prateleira não cadastrada na zona deste cliente." });
    }
    for (const status of ["blocked", "review"]) {
      await db.collection("warehouse_positions").doc("A-02").update({ status });
      await assert.rejects(preview("A-02"), { code: "failed-precondition" });
    }
    await assert.rejects(
      suggestWarehousePosition(db, { customer_code: BTG, ...box, location_id: "A-01" }, cliente),
      { code: "permission-denied" },
    );
  });

  it("prévia da abertura não libera encaixe sem sessão aberta", async () => {
    await store("A-02", "frente-cheia", { length_m: 1.8, width_m: 0.5, height_m: 0.4 });
    const incoming = {
      customer_code: BTG, length_m: 0.5, width_m: 0.4, height_m: 0.305,
      allow_tilt: true, allow_stacking: true, location_id: "A-02", opening_inventory: true,
    };
    await assert.rejects(suggestWarehousePosition(db, incoming, operacao), /não cabe/);
    await assert.rejects(createWarehouseBox(db, { ...incoming, idempotency_key: "sem-sessao" }, operacao), /não cabe/);
    await assert.rejects(createWarehouseBox(db, { ...incoming, session_id: "opening_fake", idempotency_key: "sessao-falsa" }, operacao), /não cabe/);
  });

  it("prévia manual respeita exclusão e caixas em guarda, sem trocar pela primeira livre", async () => {
    await assert.rejects(
      suggestWarehousePosition(db, { customer_code: BTG, ...box, location_id: "A-02", exclude: ["a-02"] }, operacao),
      { code: "failed-precondition" },
    );
    await db.collection("warehouse_boxes").doc("CX-000099").set({
      code: "CX-000099", customer_code: BTG, status: "committing", location_id: "A-02",
      length_m: 1.8, width_m: 0.5, height_m: 0.35,
      front_m: 1.8, depth_m: 0.5, placed_height_m: 0.35, gross_weight_kg: 2,
    });
    for (const status of ["committing", "stored"]) {
      await db.collection("warehouse_boxes").doc("CX-000099").update({ status });
      await assert.rejects(
        suggestWarehousePosition(db, { customer_code: BTG, ...box, location_id: "A-02" }, operacao),
        { code: "failed-precondition" },
      );
      assert.equal((await suggestWarehousePosition(db, { customer_code: BTG, ...box }, operacao)).position?.code, "A-01");
    }
  });

  it("prévia manual preserva medidas, orientação, permissão para tombar e limite de peso", async () => {
    await db.collection("warehouse_positions").doc("A-02").update({ length_m: 0.38 });
    const dimensions = { length_m: 0.6, width_m: 0.4, height_m: 0.35, gross_weight_kg: 2 };
    const input = { customer_code: BTG, ...dimensions, location_id: "A-02" };
    await assert.rejects(suggestWarehousePosition(db, input, operacao), { code: "failed-precondition" });
    const tilted = await suggestWarehousePosition(db, { ...input, allow_tilt: true }, operacao);
    assert.equal(tilted.position?.code, "A-02");
    assert.equal(tilted.position?.placement.orientation, "height_length_width");
    await assert.rejects(
      suggestWarehousePosition(db, { ...input, allow_tilt: true, orientation: "length_width_height" }, operacao),
      { code: "failed-precondition" },
    );
    await db.collection("warehouse_positions").doc("A-02").update({ length_m: 1.8, max_weight_kg: 1 });
    await assert.rejects(suggestWarehousePosition(db, input, operacao), { code: "failed-precondition" });
    await db.collection("warehouse_positions").doc("A-02").update({ max_weight_kg: null, depth_m: 0.3 });
    await assert.rejects(suggestWarehousePosition(db, input, operacao), { code: "failed-precondition" });
    await db.collection("warehouse_positions").doc("A-02").update({ depth_m: 0.75, height_m: 0.3 });
    await assert.rejects(suggestWarehousePosition(db, input, operacao), { code: "failed-precondition" });
  });

  it("prévia manual só empilha com autorização e preserva o apoio escolhido", async () => {
    for (let i = 0; i < 3; i += 1) await store("A-02", `preview-support-${i}`, { length_m: 0.6, width_m: 0.6, height_m: 0.3 });
    const input = { customer_code: BTG, length_m: 0.6, width_m: 0.6, height_m: 0.3, gross_weight_kg: 2, location_id: "A-02" };
    await assert.rejects(suggestWarehousePosition(db, input, operacao), { code: "failed-precondition" });
    const preview = await suggestWarehousePosition(db, { ...input, allow_stacking: true, support_box_code: "CX-000002" }, operacao);
    assert.equal(preview.position?.placement.support_box_code, "CX-000002");
    assert.equal(preview.position?.placement.base_height_m, 0.3);
    await assert.rejects(
      suggestWarehousePosition(db, { ...input, allow_stacking: true, support_box_code: null }, operacao),
      { code: "failed-precondition" },
    );
    await assert.rejects(
      suggestWarehousePosition(db, { ...input, allow_stacking: true, support_box_code: "CX-999999" }, operacao),
      { code: "failed-precondition" },
    );
    const result = await createWarehouseBox(db, {
      ...input, allow_stacking: true, support_box_code: preview.position!.placement.support_box_code,
      orientation: preview.position!.placement.orientation, idempotency_key: "preview-confirmed",
    }, operacao);
    assert.equal(result.box.location_id, "A-02");
    assert.equal(result.box.support_box_code, "CX-000002");
  });


  it("confirma empilhamento em A-02, audita o apoio e preserva idempotência", async () => {
    for (let i = 0; i < 3; i += 1) await store("A-02", `stack-floor-${i}`, { length_m: 0.6, width_m: 0.6, height_m: 0.3 });
    const dimensions = { length_m: 0.6, width_m: 0.6, height_m: 0.3, gross_weight_kg: 2 };
    const suggestion = await suggestWarehousePosition(db, {
      customer_code: BTG, ...dimensions, allow_stacking: true, exclude: ["A-01"],
    }, operacao);
    assert.equal(suggestion.position?.code, "A-02");
    const placement = suggestion.position!.placement;
    assert.equal(placement.support_box_code, "CX-000001");
    const input = { customer_code: BTG, ...dimensions, location_id: "A-02", allow_stacking: true,
      support_box_code: placement.support_box_code, orientation: placement.orientation, idempotency_key: "stacked" };
    const result = await createWarehouseBox(db, input, operacao);
    assert.equal(result.box.support_box_code, "CX-000001");
    assert.equal(result.box.base_height_m, 0.3);
    assert.equal(result.box.front_m, 0.6);
    const replayed = await createWarehouseBox(db, input, operacao);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.box.code, result.box.code);
    const saved = (await db.collection("warehouse_boxes").doc(result.box.code).get()).data()!;
    assert.equal(saved.support_box_code, "CX-000001");
    const audit = (await events("warehouse.box_stored")).find((entry) => entry.entity_id === result.box.code)!;
    assert.equal(audit.payload.box.base_height_m, 0.3);
    await assert.rejects(removeWarehouseBox(db, { code: "CX-000001", customer_code: BTG }, operacao), /serve de apoio/);
    await removeWarehouseBox(db, { code: result.box.code, customer_code: BTG }, operacao);
    await removeWarehouseBox(db, { code: "CX-000001", customer_code: BTG }, operacao);
  });

  it("duas guardas concorrentes não usam o mesmo apoio", async () => {
    const base = await store("A-02", "stack-concurrent-base", { height_m: 0.3 });
    const input = { customer_code: BTG, ...box, height_m: 0.3, location_id: "A-02",
      allow_stacking: true, support_box_code: base.box.code };
    const results = await Promise.allSettled([
      createWarehouseBox(db, { ...input, idempotency_key: "stack-a" }, operacao),
      createWarehouseBox(db, { ...input, idempotency_key: "stack-b" }, operacao),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const stored = await listWarehouseBoxes(db, BTG);
    assert.equal(stored.filter((record) => record.support_box_code === base.box.code).length, 1);
  });

  it("revalida apoio removido ou de outra posição sem mudar silenciosamente a guarda", async () => {
    const base = await store("A-02", "stack-stale-base", { height_m: 0.3 });
    const input = { customer_code: BTG, ...box, height_m: 0.3, location_id: "A-01",
      allow_stacking: true, support_box_code: base.box.code, idempotency_key: "stack-stale" };
    await assert.rejects(createWarehouseBox(db, input, operacao), /não cabe/);
    await removeWarehouseBox(db, { code: base.box.code, customer_code: BTG }, operacao);
    await assert.rejects(createWarehouseBox(db, { ...input, location_id: "A-02" }, operacao), /não cabe/);
  });

  it("sugere a primeira prateleira da zona, guarda caixas até encher e repete sem duplicar", async () => {
    const first = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(first.position?.code, "A-01");
    assert.equal(first.position?.tier, 3);
    assert.equal(first.zone_positions, 3);

    const created = await store("a-01", "cx-1", { suggestion: { position: "A-01", reason: first.position?.reason, alternatives: ["A-02", "A-03"] } });
    assert.equal(created.box.code, "CX-000001");
    assert.equal(created.box.location_id, "A-01");
    assert.equal(created.box.front_m, 0.5);
    const positionRef = db.collection("warehouse_positions").doc("A-01");
    assert.equal((await positionRef.get()).data()!.occupancy_revision, 1);
    const replayed = await store("a-01", "cx-1", { suggestion: { position: "A-01", reason: first.position?.reason, alternatives: ["A-02", "A-03"] } });
    assert.equal(replayed.box.code, "CX-000001");
    assert.equal(replayed.replayed, true);
    // Repetir a chamada não reserva capacidade outra vez.
    assert.equal((await positionRef.get()).data()!.occupancy_revision, 1);
    await store("A-01", "cx-2");
    await store("A-01", "cx-3");
    assert.deepEqual((await listWarehouseBoxes(db, BTG)).map((row) => row.code), ["CX-000003", "CX-000002", "CX-000001"]);

    await assert.rejects(store("A-01", "cx-4"), /não cabe na prateleira A-01/);
    // Só as três guardas confirmadas participam da revisão da ocupação.
    assert.equal((await positionRef.get()).data()!.occupancy_revision, 3);
    const next = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(next.position?.code, "A-02");
    assert.equal(next.checked, 3);
    const stored = await events("warehouse.box_stored");
    assert.equal(stored.length, 3);
    assert.match(String(stored.find((event) => event.entity_id === "CX-000001")?.description), /na posição sugerida/);
  });

  it("só guarda na zona do cliente e em prateleira ativa; recusa não bloqueia outras caixas", async () => {
    await assert.rejects(store("B-01", "fora-da-zona"), /não é da zona de BTG Pactual/);
    await assert.rejects(store("Z-99", "inexistente"), /não está cadastrada/);
    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "A", shelf: 3, length_m: 1.8, depth_m: 0.75, height_m: 0.65, status: "blocked" }] },
      coordenacao,
    );
    await assert.rejects(store("A-03", "bloqueada"), /bloqueada/);
    await assert.rejects(store("A-01", "sem-permissao", {}).then(() => createWarehouseBox(db, { customer_code: BTG, ...box, location_id: "A-02", idempotency_key: "cliente" }, cliente)), /somente administração ou operação/);

    const beforeRefusal = (await db.collection("warehouse_positions").doc("A-01").get()).data()!;
    const refused = await store("A-02", "recusa", { refusal: { position: "A-01", reason: "Prateleira ocupada por material fora do sistema" } });
    assert.equal(refused.box.location_id, "A-02");
    const a01 = (await db.collection("warehouse_positions").doc("A-01").get()).data()!;
    assert.deepEqual(a01, beforeRefusal);
    const refusals = await events("warehouse.position_refused");
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0]!.entity_id, "A-01");
    const after = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: [] }, operacao);
    assert.equal(after.position?.code, "A-01");
    assert.equal(after.checked, 2);
    assert.match(String(refusals[0]!.description), /estado da prateleira não foi alterado/);
  });

  it("persiste a orientação real e permite cinco caixas de 35 cm de frente sem alterar medidas originais", async () => {
    const dimensions = { length_m: 0.6, width_m: 0.4, height_m: 0.35, gross_weight_kg: 5 };
    for (let index = 0; index < 5; index += 1) {
      const suggestion = await suggestWarehousePosition(db, { customer_code: BTG, ...dimensions, allow_tilt: true }, operacao);
      assert.equal(suggestion.position?.code, "A-01");
      const orientation = suggestion.position!.placement.orientation;
      assert.equal(orientation, "height_length_width");
      const input = { customer_code: BTG, ...dimensions, allow_tilt: true, orientation, location_id: "A-01", idempotency_key: `tilt-${index}` };
      const created = await createWarehouseBox(db, input, operacao);
      assert.deepEqual([created.box.length_m, created.box.width_m, created.box.height_m], [0.6, 0.4, 0.35]);
      assert.deepEqual([created.box.front_m, created.box.depth_m, created.box.placed_height_m], [0.35, 0.6, 0.4]);
      assert.equal(created.box.orientation, orientation);
      assert.equal(created.box.allow_tilt, true);
      const saved = (await db.collection("warehouse_boxes").doc(created.box.code).get()).data()!;
      assert.equal(saved.orientation, orientation);
      assert.equal(saved.placed_height_m, 0.4);
      const replayed = await createWarehouseBox(db, input, operacao);
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.box.code, created.box.code);
    }
    const next = await suggestWarehousePosition(db, { customer_code: BTG, ...dimensions, allow_tilt: true }, operacao);
    assert.equal(next.position?.code, "A-02");
    await assert.rejects(createWarehouseBox(db, {
      customer_code: BTG, ...dimensions, allow_tilt: true, orientation: "height_length_width",
      location_id: "A-01", idempotency_key: "tilt-overflow",
    }, operacao), /não cabe/);
    const stored = await events("warehouse.box_stored");
    assert.equal(stored.length, 5);
    assert.equal((stored[0]!.payload as { box: { orientation: string } }).box.orientation, "height_length_width");
  });

  it("não tomba sem permissão e reconfere a orientação confirmada na transação", async () => {
    const dimensions = { length_m: 0.6, width_m: 0.4, height_m: 0.35, gross_weight_kg: 5 };
    await assert.rejects(createWarehouseBox(db, {
      customer_code: BTG, ...dimensions, orientation: "height_length_width",
      location_id: "A-01", idempotency_key: "sem-opt-in",
    }, operacao), /não cabe/);
    const suggestion = await suggestWarehousePosition(db, { customer_code: BTG, ...dimensions, allow_tilt: true }, operacao);
    assert.equal(suggestion.position?.placement.orientation, "height_length_width");
    await upsertWarehousePositions(db, {
      positions: [{ aisle: "A", shelf: 1, length_m: 1.8, depth_m: 0.55, height_m: 0.65, customer_code: BTG }],
    }, coordenacao);
    await assert.rejects(createWarehouseBox(db, {
      customer_code: BTG, ...dimensions, allow_tilt: true, orientation: suggestion.position!.placement.orientation,
      location_id: "A-01", idempotency_key: "orientacao-nao-cabe",
    }, operacao), /não cabe/);
    // Outra orientação cabe, mas precisa ser confirmada explicitamente.
    const created = await createWarehouseBox(db, {
      customer_code: BTG, ...dimensions, allow_tilt: true, orientation: "height_width_length",
      location_id: "A-01", idempotency_key: "nova-orientacao",
    }, operacao);
    assert.equal(created.box.placed_height_m, 0.6);
    assert.equal(created.box.depth_m, 0.4);
  });

  it("caixa em confirmação reserva espaço; caixa em contagem ainda não ocupa a prateleira", async () => {
    await db.collection("warehouse_boxes").doc("RESERVADA").set({
      customer_code: BTG, location_id: "A-01", status: "committing", front_m: 1.5, gross_weight_kg: 5,
    });
    await db.collection("warehouse_boxes").doc("RASCUNHO").set({
      customer_code: BTG, location_id: "A-02", status: "counting", front_m: 10, gross_weight_kg: 5,
    });
    const suggestion = await suggestWarehousePosition(db, { customer_code: BTG, ...box }, operacao);
    assert.equal(suggestion.position?.code, "A-02");
    await assert.rejects(store("A-01", "reservado"), /não cabe/);
    const created = await store("A-02", "livre");
    assert.equal(created.box.location_id, "A-02");
  });

  it("rejeita caixa alta ou pesada demais e explica a zona cheia", async () => {
    await assert.rejects(store("A-01", "alta", { height_m: 0.7 }), /não cabe/);
    await upsertWarehousePositions(
      db,
      { positions: [{ aisle: "A", shelf: 1, length_m: 1.8, depth_m: 0.75, height_m: 0.65, max_weight_kg: 20 }] },
      coordenacao,
    );
    await store("A-01", "peso-1");
    await assert.rejects(store("A-01", "peso-2"), /peso máximo 20 kg/);
    const noZone = await suggestWarehousePosition(db, { customer_code: "Cliente Sem Zona", ...box, sku_codes: [] }, operacao);
    assert.equal(noZone.position, null);
    assert.match(String(noZone.rejected), /Atribua uma rua/);
  });

  it("não apaga caixa em confirmação nem descarta linhas em conferência", async () => {
    for (const [code, status, draft_line_count] of [
      ["RESERVADA", "committing", 0],
      ["CONTANDO", "counting", 1],
      ["REVISADA", "reviewed", 1],
      ["VAZIA", "counting", 0],
    ] as const) {
      await db.collection("warehouse_boxes").doc(code).set({
        customer_code: BTG, status, draft_line_count, line_count: 0, unit_count: 0,
      });
    }
    await assert.rejects(removeWarehouseBox(db, { code: "RESERVADA", customer_code: BTG }, operacao), /está sendo guardada/);
    for (const code of ["CONTANDO", "REVISADA"]) {
      await assert.rejects(removeWarehouseBox(db, { code, customer_code: BTG }, operacao), /produtos em conferência/);
    }
    await removeWarehouseBox(db, { code: "VAZIA", customer_code: BTG }, operacao);
    assert.equal((await db.collection("warehouse_boxes").doc("VAZIA").get()).exists, false);
    assert.equal((await events("warehouse.box_removed")).length, 1);
  });

  it("linhas da abertura entram na caixa: somam o saldo da posição, contam na caixa e saem na correção", async () => {
    const session = await createOpeningInventorySessionTransaction(
      db,
      { customer_code: BTG, reference: "ABERTURA", idempotency_key: "sessao-1" },
      operacao,
    );
    const sessionId = String(session.session_id);
    await store("A-01", "cx-1", { session_id: sessionId });
    await store("A-01", "cx-2", { session_id: sessionId });

    await assert.rejects(openingLine(sessionId, "CX-000009"), /não encontrada/);
    await assert.rejects(openingLine(sessionId, "CX-000001", { location_id: "A-02" }), /está em A-01, não em A-02/);

    const first = await openingLine(sessionId, "CX-000001");
    assert.equal(first.box_code, "CX-000001");
    assert.equal(first.qty_counted, 12);
    const second = await openingLine(sessionId, "CX-000002", { product_registration: "existing", counted_qty: 18 });
    assert.equal(second.qty_before, 12);
    assert.equal(second.qty_available, 30);

    const balances = await db.collection("stock_balances").where("customer_code", "==", BTG).get();
    assert.equal(balances.size, 1);
    assert.equal(balances.docs[0]!.data().qty_on_hand, 30);
    assert.equal(balances.docs[0]!.data().location_id, "A-01");
    const lines = await db.collection("opening_inventory_lines").where("session_id", "==", sessionId).get();
    assert.deepEqual(lines.docs.map((row) => row.data().box_code).sort(), ["CX-000001", "CX-000002"]);
    const boxOne = (await db.collection("warehouse_boxes").doc("CX-000001").get()).data()!;
    const boxTwo = (await db.collection("warehouse_boxes").doc("CX-000002").get()).data()!;
    assert.deepEqual([boxOne.line_count, boxOne.unit_count, boxOne.sku_codes], [1, 12, ["BTG-000001"]]);
    assert.deepEqual([boxTwo.line_count, boxTwo.unit_count], [1, 18]);
    assert.ok(Math.abs(Number(boxTwo.total_cost) - 18 * 189.9) < 1e-6);
    const sku = (await db.collection("skus").doc("BTG-000001").get()).data()!;
    assert.equal(sku.estoque_atual, 30);

    // O mesmo SKU já está em A-01: a próxima caixa dele vai para A-01 (ainda cabe uma).
    const suggestion = await suggestWarehousePosition(db, { customer_code: BTG, ...box, sku_codes: ["BTG-000001"] }, operacao);
    assert.equal(suggestion.position?.code, "A-01");
    assert.equal(suggestion.position?.tier, 1);

    // Correção da segunda caixa: o saldo volta a 12, a caixa fica vazia e pode ser removida.
    const secondLine = lines.docs.find((row) => row.data().box_code === "CX-000002")!;
    await removeOpeningInventoryLineTransaction(
      db,
      { customer_code: BTG, session_id: sessionId, opening_line_id: secondLine.id, idempotency_key: "remove-2" },
      operacao,
    );
    const balanceAfter = (await db.collection("stock_balances").where("customer_code", "==", BTG).get()).docs[0]!.data();
    assert.equal(balanceAfter.qty_on_hand, 12);
    assert.equal(balanceAfter.qty_available, 12);
    const boxTwoAfter = (await db.collection("warehouse_boxes").doc("CX-000002").get()).data()!;
    assert.deepEqual([boxTwoAfter.line_count, boxTwoAfter.unit_count], [0, 0]);
    assert.equal((await db.collection("skus").doc("BTG-000001").get()).data()!.estoque_atual, 12);
    const reversal = (await db.collection("movements").where("source", "==", "functions_opening_inventory_reversal").get()).docs[0]!.data();
    assert.equal(reversal.quantity ?? reversal.qtd ?? reversal.quantidade, 18);

    await assert.rejects(removeWarehouseBox(db, { code: "CX-000001" }, operacao), /ainda tem 1 produto/);
    await assert.rejects(removeWarehouseBox(db, { code: "CX-000002" }, cliente), /somente administração ou operação/);
    const removed = await removeWarehouseBox(db, { code: "cx-000002", customer_code: BTG }, operacao);
    assert.equal(removed.code, "CX-000002");
    assert.equal((await db.collection("warehouse_boxes").doc("CX-000002").get()).exists, false);
    assert.equal((await events("warehouse.box_removed")).length, 1);
    await assert.rejects(removeWarehouseBox(db, { code: "CX-000002" }, operacao), /não encontrada/);
  });
});
