/**
 * Popula os emuladores do modo demo com dados fictícios, passando pelas
 * mesmas transações de domínio usadas em produção (inventário de abertura,
 * solicitação, aprovação e etapas do WMS). Ver docs/modo-demo.md.
 *
 * Recusa rodar fora do emulador ou em projeto que não comece com `demo-`.
 */
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  advanceWarehouseTaskTransaction,
  completeOpeningInventorySessionTransaction,
  createCustomerRequestTransaction,
  createOpeningInventorySessionTransaction,
  decideCustomerRequestTransaction,
  recordCycleCountTransaction,
  type OperationalActor,
} from "../domain/operations.js";

const PROJECT_ID = process.env.DEMO_PROJECT_ID ?? "demo-dute";
const CUSTOMER = "BTG Pactual";
/**
 * Host fictício das fotos. O domínio exige URL https; o script de capturas
 * (tools/demo/screenshots.mjs) intercepta este host e serve ilustrações.
 */
export const DEMO_ASSET_HOST = "https://demo-assets.dutelog.local";
export const DEMO_PASSWORD = "demo-dute-2026";

export const DEMO_USERS = [
  {
    uid: "demo-cliente",
    email: "cliente@demo.dutelog.com.br",
    nome: "Ana Ribeiro",
    role: "cliente",
    customer_code: CUSTOMER,
  },
  {
    uid: "demo-operacao",
    email: "operacao@demo.dutelog.com.br",
    nome: "Carlos Mendes",
    role: "owner",
    customer_code: CUSTOMER,
  },
] as const;

const operator: OperationalActor = {
  uid: "demo-operacao",
  email: "operacao@demo.dutelog.com.br",
  name: "Carlos Mendes",
  role: "wms",
  customer_code: CUSTOMER,
};

const client: OperationalActor = {
  uid: "demo-cliente",
  email: "cliente@demo.dutelog.com.br",
  name: "Ana Ribeiro",
  role: "cliente",
  customer_code: CUSTOMER,
};

type DemoItem = {
  sku: string;
  code: string;
  name: string;
  grupo: string;
  genero: string;
  category: string;
  size?: string;
  color?: string;
  location: string;
  qty: number;
  cost: number;
};

// Endereços prefixados pela área dona do estoque: STORE (loja), EVT
// (eventos/mobiliário) e MKT (marketing).
export const DEMO_ITEMS: DemoItem[] = [
  { sku: "DM-1001", code: "A.01.501", name: "POLO PIQUET INSTITUCIONAL", grupo: "VESTUÁRIO", genero: "Masculino", category: "VESTUARIO", size: "M", color: "Azul-marinho", location: "STORE/RUA-A/PRAT-01/N1", qty: 240, cost: 89.9 },
  { sku: "DM-1002", code: "A.01.502", name: "POLO PIQUET INSTITUCIONAL", grupo: "VESTUÁRIO", genero: "Masculino", category: "VESTUARIO", size: "G", color: "Azul-marinho", location: "STORE/RUA-A/PRAT-01/N2", qty: 198, cost: 89.9 },
  { sku: "DM-1003", code: "A.02.311", name: "CAMISA SOCIAL SLIM", grupo: "VESTUÁRIO", genero: "Feminino", category: "VESTUARIO", size: "P", color: "Branca", location: "STORE/RUA-A/PRAT-02/N1", qty: 86, cost: 149 },
  { sku: "DM-1004", code: "A.01.620", name: "MOLETOM CARECA", grupo: "VESTUÁRIO", genero: "Masculino", category: "VESTUARIO", size: "G", color: "Cinza mescla", location: "STORE/RUA-A/PRAT-02/N2", qty: 132, cost: 179 },
  { sku: "DM-1005", code: "A.02.640", name: "JAQUETA CORTA-VENTO", grupo: "VESTUÁRIO", genero: "Feminino", category: "VESTUARIO", size: "M", color: "Preta", location: "STORE/RUA-A/PRAT-03/N1", qty: 64, cost: 259 },
  { sku: "DM-1006", code: "A.03.105", name: "BONÉ ABA CURVA", grupo: "ACESSÓRIOS", genero: "Outros", category: "ACESSORIOS", color: "Azul-marinho", location: "STORE/RUA-B/PRAT-01/N1", qty: 310, cost: 49.9 },
  { sku: "DM-1007", code: "A.03.210", name: "MOCHILA EXECUTIVA", grupo: "BOLSAS E MALAS", genero: "Outros", category: "BOLSAS", color: "Preta", location: "STORE/RUA-B/PRAT-02/N1", qty: 95, cost: 329 },
  { sku: "DM-1008", code: "A.03.330", name: "GARRAFA TÉRMICA 500ML", grupo: "BEBIDAS E MESA", genero: "Outros", category: "BRINDES", color: "Inox", location: "STORE/RUA-B/PRAT-03/N1", qty: 420, cost: 69.9 },
  { sku: "DM-1009", code: "A.03.410", name: "CADERNO CAPA DURA A5", grupo: "ESCRITÓRIOS E PAPELARIA", genero: "Outros", category: "BRINDES", color: "Azul", location: "MKT/RUA-C/PRAT-01/N1", qty: 600, cost: 29.9 },
  { sku: "DM-1010", code: "A.03.420", name: "CANETA METÁLICA", grupo: "ESCRITÓRIOS E PAPELARIA", genero: "Outros", category: "BRINDES", color: "Prata", location: "MKT/RUA-C/PRAT-01/N2", qty: 1500, cost: 12.5 },
  { sku: "DM-1011", code: "A.03.150", name: "GUARDA CHUVA AUTOMÁTICO", grupo: "ACESSÓRIOS", genero: "Outros", category: "ACESSORIOS", color: "Preto", location: "MKT/RUA-C/PRAT-02/N1", qty: 180, cost: 79 },
  { sku: "DM-2001", code: "MAT-EVT-010", name: "MAT-EVT MESA BISTRÔ", grupo: "MATERIAL DE EVENTO", genero: "—", category: "MOBILIARIO", location: "EVT/PAL-01", qty: 12, cost: 890 },
  { sku: "DM-2002", code: "MAT-EVT-011", name: "MAT-EVT BANQUETA ALTA", grupo: "MATERIAL DE EVENTO", genero: "—", category: "MOBILIARIO", location: "EVT/PAL-02", qty: 36, cost: 420 },
  { sku: "DM-2003", code: "MAT-EVT-020", name: "MAT-EVT BALCÃO DE RECEPÇÃO", grupo: "MATERIAL DE EVENTO", genero: "—", category: "MOBILIARIO", location: "EVT/PAL-03", qty: 3, cost: 3800 },
  { sku: "DM-2004", code: "MAT-EVT-030", name: "MAT-EVT BACKDROP 3X2M", grupo: "MATERIAL DE EVENTO", genero: "—", category: "MOBILIARIO", location: "EVT/PAL-04", qty: 4, cost: 2100 },
];

function assertEmulatorOnly() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Seed demo exige FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST (rode via firebase emulators).",
    );
  }
  if (!PROJECT_ID.startsWith("demo-")) {
    throw new Error(`Seed demo recusado: projeto "${PROJECT_ID}" não começa com demo-.`);
  }
}

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(await response.text());
}

async function seedUsers(db: Firestore, app: ReturnType<typeof initializeApp>) {
  const auth = getAuth(app);
  for (const user of DEMO_USERS) {
    await auth.deleteUser(user.uid).catch(() => undefined);
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      password: DEMO_PASSWORD,
      displayName: user.nome,
    });
    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      nome: user.nome,
      role: user.role,
      customer_code: user.customer_code,
      status: "active",
    });
  }
}

async function seedOpeningInventory(db: Firestore) {
  const session = await createOpeningInventorySessionTransaction(
    db,
    {
      customer_code: CUSTOMER,
      reference: "INVENTARIO-ABERTURA-DEMO",
      notes: "Inventário de abertura (dados fictícios).",
      idempotency_key: "demo-opening-session",
    },
    operator,
  );
  const sessionId = String(session.session_id);
  for (const [index, item] of DEMO_ITEMS.entries()) {
    await recordCycleCountTransaction(
      db,
      {
        mode: "opening",
        session_id: sessionId,
        customer_code: CUSTOMER,
        sku_code: item.sku,
        client_item_code: item.code,
        product_name: item.name,
        product_registration: "new",
        category: item.category,
        genero: item.genero,
        grupo: item.grupo,
        size: item.size,
        color: item.color,
        photo_urls: [`${DEMO_ASSET_HOST}/${item.sku}.svg`],
        location_id: item.location,
        counted_qty: item.qty,
        unit_cost: item.cost,
        reason: "Inventário físico de abertura",
        reference: "ABERTURA-DEMO",
        occurred_at: new Date(Date.UTC(2026, 7, 3, 12, index)).toISOString(),
        idempotency_key: `demo-opening-${item.sku}`,
      } as Parameters<typeof recordCycleCountTransaction>[1],
      operator,
    );
  }
  await completeOpeningInventorySessionTransaction(
    db,
    {
      customer_code: CUSTOMER,
      session_id: sessionId,
      idempotency_key: "demo-opening-complete",
    },
    operator,
  );
}

function itemBySku(sku: string) {
  const item = DEMO_ITEMS.find((candidate) => candidate.sku === sku);
  if (!item) throw new Error(`Item demo ${sku} não encontrado.`);
  return item;
}

async function createRequest(
  db: Firestore,
  key: string,
  title: string,
  destination: string,
  priority: "baixa" | "normal" | "alta" | "critica",
  lines: Array<[string, number]>,
) {
  const created = await createCustomerRequestTransaction(
    db,
    {
      type: "retirada",
      priority,
      title,
      destination,
      customer_code: CUSTOMER,
      idempotency_key: `demo-request-${key}`,
      items: lines.map(([sku, quantity]) => {
        const item = itemBySku(sku);
        return {
          sku_code: item.sku,
          client_item_code: item.code,
          product_name: item.name,
          unit_cost: item.cost,
          quantity,
        };
      }),
    } as Parameters<typeof createCustomerRequestTransaction>[1],
    client,
  );
  return String(created.id);
}

async function approve(db: Firestore, requestId: string) {
  return (await decideCustomerRequestTransaction(
    db,
    {
      request_id: requestId,
      action: "approve",
      expected_status: "open",
      idempotency_key: `demo-approve-${requestId}`,
    },
    operator,
  )) as Record<string, unknown>;
}

async function advance(
  db: Firestore,
  taskUid: string,
  expectedStatus: string,
  operation?: Record<string, unknown>,
) {
  return (await advanceWarehouseTaskTransaction(
    db,
    {
      task_uid: taskUid,
      expected_status: expectedStatus,
      operation,
      idempotency_key: `demo:${taskUid}:${expectedStatus}`,
    },
    operator,
  )) as Record<string, unknown>;
}

/** Leva um pedido aprovado até a etapa pedida, pelas transições reais. */
async function runOrder(
  db: Firestore,
  approved: Record<string, unknown>,
  until: "picking" | "packing" | "shipping" | "delivered",
  seal: string,
) {
  const pickTaskId = String(approved.pick_task_id);
  const orderId = String(approved.order_id);
  await advance(db, `picking:${pickTaskId}`, "planned");
  if (until === "picking") return;

  const pickLines = await db
    .collection("pick_lines")
    .where("pick_task_id", "==", pickTaskId)
    .get();
  const picking = await advance(db, `picking:${pickTaskId}`, "in_progress", {
    picking_lines: pickLines.docs.map((document) => ({
      pick_line_id: document.id,
      qty_picked: Number(document.data().qty_to_pick),
      status: "confirmed",
    })),
  });
  const packTaskId = String(picking.pack_task_id);
  if (until === "packing") return;

  await advance(db, `packing:${packTaskId}`, "ready");
  const orderItems = await db
    .collection("order_items")
    .where("order_id", "==", orderId)
    .get();
  const packing = await advance(db, `packing:${packTaskId}`, "in_progress", {
    volume_label: "Volume 1",
    seal_code: seal,
    package_count: 1,
    packing_lines: orderItems.docs.map((document) => ({
      order_item_id: document.id,
      qty_packed: Number(
        document.data().picked_qty || document.data().allocated_qty,
      ),
      status: "confirmed",
    })),
  });
  const shipmentId = String(packing.shipment_id);
  if (until === "shipping") return;

  await advance(db, `shipping:${shipmentId}`, "ready_to_dispatch", {
    carrier: "Dutelog",
    driver_name: "Roberto Lima",
    vehicle_plate: "DMO-2A26",
  });
  await advance(db, `shipping:${shipmentId}`, "dispatched", {
    proof_reference: `PROTOCOLO-${seal}`,
    delivery_notes: "Recebido na recepção do escritório.",
  });
}

async function seedRequests(db: Firestore) {
  const delivered = await createRequest(
    db,
    "abastecimento-sp",
    "Abastecimento semanal — escritório SP",
    "Escritório São Paulo",
    "normal",
    [["DM-1001", 24], ["DM-1002", 18], ["DM-1006", 30]],
  );
  await runOrder(db, await approve(db, delivered), "delivered", "LCR-0412");

  const event = await createRequest(
    db,
    "evento-lounge",
    "Evento — lounge de clientes",
    "Centro de convenções (SP)",
    "alta",
    [["DM-2001", 6], ["DM-2002", 18], ["DM-2004", 1]],
  );
  await runOrder(db, await approve(db, event), "shipping", "LCR-0418");

  const onboarding = await createRequest(
    db,
    "kit-onboarding",
    "Kits de boas-vindas — novos colaboradores",
    "Escritório São Paulo",
    "normal",
    [["DM-1007", 15], ["DM-1008", 15], ["DM-1009", 15], ["DM-1010", 15]],
  );
  await runOrder(db, await approve(db, onboarding), "picking", "LCR-0421");

  await createRequest(
    db,
    "abastecimento-rj",
    "Abastecimento quinzenal — escritório RJ",
    "Escritório Rio de Janeiro",
    "normal",
    [["DM-1003", 10], ["DM-1004", 12], ["DM-1011", 20]],
  );
}

function invoiceLines(lines: Array<[string, string, string, number, number]>) {
  return lines.map(([grupo, item, unidade, qtde, valorUnit], ordem) => {
    const totalCents = Math.round(qtde * valorUnit * 100);
    return {
      price_list_id: `demo-${ordem}`,
      grupo,
      item,
      unidade,
      qtde,
      valor_unit: valorUnit,
      total_cents: totalCents,
      total: totalCents / 100,
      auto: false,
      auto_source: null,
      observacao: null,
      ordem,
    };
  });
}

async function seedInvoices(db: Firestore) {
  const invoices = [
    {
      competencia: "2026-08",
      status: "pago",
      payment_status: "paid",
      lines: invoiceLines([
        ["Armazenagem", "Posição palete", "Palete/mês", 112, 44.9],
        ["Recebimento", "Recebimento por palete", "Palete", 9, 30],
        ["Expedição", "Expedição por caixa", "Caixa", 46, 10],
        ["Expedição", "Expedição por palete", "Palete", 4, 30],
        ["Transporte", "Abastecimento SP (até 350 kg)", "Viagem", 4, 184.68],
      ]),
    },
    {
      competencia: "2026-09",
      status: "emitido",
      payment_status: "issued",
      lines: invoiceLines([
        ["Armazenagem", "Posição palete", "Palete/mês", 120, 44.9],
        ["Recebimento", "Recebimento por palete", "Palete", 12, 30],
        ["Recebimento", "Recebimento por caixa", "Caixa", 38, 10],
        ["Expedição", "Expedição por caixa", "Caixa", 61, 10],
        ["Expedição", "Expedição por palete", "Palete", 7, 30],
        ["Serviços", "Etiquetagem Zebra", "Etiqueta", 380, 1.2],
        ["Transporte", "Abastecimento SP (até 350 kg)", "Viagem", 4, 184.68],
        ["Transporte", "Abastecimento RJ (até 350 kg)", "Viagem", 2, 761.91],
      ]),
    },
  ];
  for (const invoice of invoices) {
    const totalCents = invoice.lines.reduce((sum, line) => sum + line.total_cents, 0);
    const groups = [...new Set(invoice.lines.map((line) => line.grupo))].map((grupo) => {
      const itens = invoice.lines.filter((line) => line.grupo === grupo);
      const cents = itens.reduce((sum, line) => sum + line.total_cents, 0);
      return { grupo, total_cents: cents, total: cents / 100, itens };
    });
    const [year, month] = invoice.competencia.split("-").map(Number);
    const issuedAt = new Date(Date.UTC(year, month, 3, 13));
    const dueDate = new Date(Date.UTC(year, month, 13, 13));
    await db.collection("client_invoices").doc(invoice.competencia).set({
      id: invoice.competencia,
      customer_code: CUSTOMER,
      competencia: invoice.competencia,
      status: invoice.status,
      payment_status: invoice.payment_status,
      total_cents: totalCents,
      total: totalCents / 100,
      currency: "BRL",
      emitido_em: issuedAt.toISOString(),
      due_date: dueDate.toISOString(),
      lines: invoice.lines,
      groups,
      published_at: issuedAt,
      updated_at: issuedAt,
    });
  }
}

async function main() {
  assertEmulatorOnly();
  const app = initializeApp({ projectId: PROJECT_ID }, `seed-demo-${Date.now()}`);
  const db = getFirestore(app);
  try {
    await clearFirestore();
    await seedUsers(db, app);
    await seedOpeningInventory(db);
    await seedRequests(db);
    await seedInvoices(db);
    console.log(`Demo pronta em ${PROJECT_ID}.`);
    for (const user of DEMO_USERS) {
      console.log(`  ${user.role.padEnd(8)} ${user.email} / ${DEMO_PASSWORD}`);
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
