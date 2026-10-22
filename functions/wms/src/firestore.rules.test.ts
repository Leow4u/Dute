import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-dute-operations";
const CUSTOMER_A = "BTG Pactual";
const CUSTOMER_B = "CLIENTE ISOLADO";
const NEW_PLATFORM_ROLES = ["campo", "comercial", "rh", "painel"] as const;

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, "Execute este teste pelo Firebase Emulator.");
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function rulesSource() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../firestore.rules"), "utf8");
}

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const users = [
      ["owner-a", "owner", undefined],
      ["admin-a", "admin", undefined],
      ["ops-a", "interno", undefined],
      ["wms-a", "wms", undefined],
      ["finance-a", "financeiro", undefined],
      ["client-a", "cliente", CUSTOMER_A],
      ["client-b", "cliente", CUSTOMER_B],
      ["support-a", "suporte", undefined],
      // Papéis da plataforma que o WMS não atende (Fase 2).
      ["campo-a", "campo", undefined],
      ["comercial-a", "comercial", undefined],
      ["rh-a", "rh", undefined],
      ["painel-a", "painel", undefined],
      // Equipe interna também carrega customer_code "Dutelog" quando entra
      // por convite.
      ["ops-dutelog", "interno", "Dutelog"],
    ] as const;
    for (const [uid, role, customerCode] of users) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(customerCode ? { customer_code: customerCode } : {}),
      });
    }
    // Perfis com o acesso removido em Pessoas e acessos.
    await setDoc(doc(database, "users", "wms-off"), {
      nome: "wms-off",
      email: "wms-off@example.com",
      role: "wms",
      access_disabled: true,
    });
    await setDoc(doc(database, "users", "client-off"), {
      nome: "client-off",
      email: "client-off@example.com",
      role: "cliente",
      customer_code: CUSTOMER_A,
      access_disabled: true,
    });

    await setDoc(doc(database, "stock_balances", "balance-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      location_id: "A-01",
      qty_on_hand: 10,
      qty_reserved: 0,
      qty_available: 10,
    });
    await setDoc(doc(database, "warehouse_positions", "A-01"), {
      id: "A-01",
      code: "A-01",
      aisle: "A",
      shelf: 1,
      length_m: 1.8,
      depth_m: 0.75,
      height_m: 0.65,
      sequence: 1,
      customer_code: null,
      status: "active",
    });
    await setDoc(doc(database, "warehouse_boxes", "CX-000001"), {
      id: "CX-000001",
      code: "CX-000001",
      customer_code: CUSTOMER_A,
      location_id: "A-01",
      status: "stored",
      line_count: 0,
      unit_count: 0,
    });
    await setDoc(doc(database, "movements", "movement-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      quantity: 10,
      type: "inventory.received",
      created_at: new Date(),
    });
    await setDoc(doc(database, "client_inventory", "inventory-a"), {
      customer_code: CUSTOMER_A,
      sku_code: "BTG-TEST-1",
      qty_on_hand: 10,
      qty_reserved: 0,
      qty_available: 10,
      published_at: new Date(),
    });
    await setDoc(doc(database, "client_inventory", "inventory-b"), {
      customer_code: CUSTOMER_B,
      sku_code: "OTHER-1",
      qty_on_hand: 5,
      qty_reserved: 0,
      qty_available: 5,
      published_at: new Date(),
    });
    // Perfil de operação publicado para o portal (client_profiles).
    await setDoc(doc(database, "client_profiles", "profile-a"), {
      id: "profile-a",
      customer_code: CUSTOMER_A,
      name: "BTG Pactual",
      operation_template: "uniformes",
      sku_prefix: "BTG",
      portal_status: "active",
      status: "active",
      archived: false,
    });
    await setDoc(doc(database, "client_profiles", "profile-b"), {
      id: "profile-b",
      customer_code: CUSTOMER_B,
      name: "Cliente isolado",
      operation_template: "mobiliario",
      sku_prefix: "ISO",
      portal_status: "active",
      status: "active",
      archived: false,
    });
    // Trava de saída da abertura publicada para o portal (client_portal_status).
    await setDoc(doc(database, "client_portal_status", CUSTOMER_A), {
      customer_code: CUSTOMER_A,
      outbound_blocked: true,
    });
    await setDoc(doc(database, "client_portal_status", CUSTOMER_B), {
      customer_code: CUSTOMER_B,
      outbound_blocked: false,
    });
    await setDoc(doc(database, "customers", "profile-a-customer"), {
      code: CUSTOMER_A,
      name: "BTG Pactual",
      notes: "observação interna",
      status: "active",
    });
    await setDoc(doc(database, "products", "product-a"), {
      id: "product-a",
      customer_code: CUSTOMER_A,
      cod_cliente: "BTG-TEST-1",
      produto: "Produto real de teste",
      status: "active",
    });
    // Documentos do cliente: um visível e um arquivado (invisível).
    await setDoc(doc(database, "client_documents", "doc-visivel"), {
      customer_code: CUSTOMER_A,
      title: "NF de entrada",
      customer_visible: true,
      created_at: new Date(),
    });
    // Evento do portal (modelo de pedido): só as Cloud Functions leem e gravam.
    await setDoc(doc(database, "client_event_templates", "cev-a"), {
      customer_code: CUSTOMER_A,
      name: "Feira de Investimentos",
      status: "active",
      items: [{ sku_code: "BTG-TEST-1", product_name: "Produto real de teste", quantity: 1 }],
    });
    await setDoc(doc(database, "client_documents", "doc-arquivado"), {
      customer_code: CUSTOMER_A,
      title: "Documento arquivado",
      customer_visible: false,
      status: "archived",
      created_at: new Date(),
    });
    // Chat do agente pertencente ao client-a.
    await setDoc(doc(database, "agent_conversations", "conv-a"), {
      id: "conv-a",
      customer_code: CUSTOMER_A,
      user_id: "client-a",
      status: "active",
      created_at_iso: new Date().toISOString(),
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Equipe interna também conversa com o agente (tela única, 02/10/2026).
    for (const uid of ["wms-a", "finance-a"]) {
      await setDoc(doc(database, "agent_conversations", `conv-${uid}`), {
        id: `conv-${uid}`,
        customer_code: CUSTOMER_A,
        user_id: uid,
        status: "active",
        created_at_iso: new Date().toISOString(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
    await setDoc(doc(database, "agent_messages", "msg-a"), {
      id: "msg-a",
      conversation_id: "conv-a",
      customer_code: CUSTOMER_A,
      user_id: "client-a",
      role: "user",
      content: "Onde esta meu pedido?",
      created_at_iso: new Date().toISOString(),
      created_at: new Date(),
      source: "portal",
    });
    await setDoc(doc(database, "system_controls", "inventory"), {
      movements_frozen: false,
      opening_inventory_required: true,
      stock_initialized: false,
    });
    await setDoc(doc(database, "billing_price_list", "1"), {
      item: "Ad Valorem sobre estoque",
      auto_source: "ad_valorem",
      valor_unit: 0,
      ativo: true,
    });
    await setDoc(doc(database, "billing_config", "default"), {
      ad_valorem_rate: 0.005,
      cliente_nome: CUSTOMER_A,
    });
    await setDoc(
      doc(database, "billing_operational_snapshots", "2026-07"),
      {
        customer_code: CUSTOMER_A,
        competencia: "2026-07",
        mode: "baseline",
        usage: { custo_estoque: 1000, entradas_pecas: 10 },
      },
    );
    await setDoc(doc(database, "ai_agent_inbox", "alert-a"), {
      status: "open",
      entity_type: "estoque",
      customer_code: CUSTOMER_A,
    });
    await setDoc(doc(database, "invites", "invite-a"), {
      email: "invited@example.com",
      role: "cliente",
      customer_code: CUSTOMER_A,
      status: "pending",
      created_by: "owner-a",
    });
    for (const role of NEW_PLATFORM_ROLES) {
      await setDoc(doc(database, "invites", `invite-${role}`), {
        email: `${role}-novo@example.com`,
        role,
        customer_code: "Dutelog",
        status: "pending",
        created_by: "owner-a",
      });
    }
    // Projeções do portal ligadas a cada módulo contratado.
    await setDoc(doc(database, "client_invoices", "invoice-a"), {
      customer_code: CUSTOMER_A,
      competencia: "2026-09",
      total: 100,
    });
    await setDoc(doc(database, "client_order_tracking", "order-a"), {
      customer_code: CUSTOMER_A,
      status: "separando",
    });
    await setDoc(doc(database, "client_request_status", "request-a"), {
      customer_code: CUSTOMER_A,
      status: "aguardando",
    });
    await setDoc(doc(database, "orders", "order-a"), {
      customer_code: CUSTOMER_A,
      status: "aberto",
    });
    await setDoc(doc(database, "events", "event-a"), {
      type: "inventory.adjusted",
      entity_id: "balance-a",
      customer_code: CUSTOMER_A,
    });
    // Agregado global da operação, sem customer_code.
    await setDoc(doc(database, "ops_aggregates", "dashboard"), {
      total_pecas: 100,
      custo_total: 1000,
    });
  });
}

before(async () => {
  const { host, port } = emulatorAddress();
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: rulesSource() },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("ledger e mutações críticas", () => {
  it("permite leitura interna e bloqueia qualquer mutação do ledger no navegador", async () => {
    const database = testEnvironment
      .authenticatedContext("admin-a", { email: "admin-a@example.com" })
      .firestore();
    const movement = doc(database, "movements", "movement-a");

    await assertSucceeds(getDoc(movement));
    await assertFails(
      setDoc(doc(database, "movements", "movement-b"), {
        customer_code: CUSTOMER_A,
        sku_code: "BTG-TEST-1",
        quantity: 1,
      }),
    );
    await assertFails(updateDoc(movement, { quantity: 99 }));
    await assertFails(deleteDoc(movement));
  });

  it("posições do armazém: operação lê, ninguém grava pelo navegador, cliente não vê", async () => {
    const wms = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();
    await assertSucceeds(getDoc(doc(wms, "warehouse_positions", "A-01")));
    await assertFails(updateDoc(doc(wms, "warehouse_positions", "A-01"), { height_m: 2 }));

    const admin = testEnvironment
      .authenticatedContext("admin-a", { email: "admin-a@example.com" })
      .firestore();
    await assertSucceeds(getDoc(doc(admin, "warehouse_positions", "A-01")));
    await assertFails(
      setDoc(doc(admin, "warehouse_positions", "A-02"), { code: "A-02", aisle: "A", shelf: 2 }),
    );
    await assertFails(deleteDoc(doc(admin, "warehouse_positions", "A-01")));

    const client = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(getDoc(doc(client, "warehouse_positions", "A-01")));

    await assertSucceeds(getDoc(doc(wms, "warehouse_boxes", "CX-000001")));
    await assertFails(updateDoc(doc(wms, "warehouse_boxes", "CX-000001"), { location_id: "A-02" }));
    await assertFails(setDoc(doc(admin, "warehouse_boxes", "CX-000002"), { code: "CX-000002" }));
    await assertFails(getDoc(doc(client, "warehouse_boxes", "CX-000001")));
  });

  it("bloqueia saldo, pedido e tarefa WMS fora das Cloud Functions", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();

    await assertFails(
      updateDoc(doc(database, "stock_balances", "balance-a"), {
        qty_on_hand: 999,
      }),
    );
    await assertFails(
      setDoc(doc(database, "orders", "order-browser"), {
        customer_code: CUSTOMER_A,
        status: "ABERTO",
      }),
    );
    await assertFails(
      setDoc(doc(database, "pick_tasks", "pick-browser"), {
        customer_code: CUSTOMER_A,
        status: "planned",
      }),
    );
  });

  it("bloqueia catálogo, faturamento, alertas e RBAC fora das Cloud Functions", async () => {
    const database = testEnvironment
      .authenticatedContext("owner-a", { email: "owner-a@example.com" })
      .firestore();

    await assertFails(
      updateDoc(doc(database, "products", "product-a"), {
        produto: "Alteração direta indevida",
      }),
    );
    await assertFails(
      updateDoc(doc(database, "billing_config", "default"), {
        ad_valorem_rate: 0.9,
      }),
    );
    await assertSucceeds(
      getDoc(
        doc(database, "billing_operational_snapshots", "2026-07"),
      ),
    );
    await assertFails(
      updateDoc(
        doc(database, "billing_operational_snapshots", "2026-07"),
        { mode: "replace" },
      ),
    );
    await assertFails(
      updateDoc(doc(database, "ai_agent_inbox", "alert-a"), {
        status: "resolved",
      }),
    );
    await assertFails(
      updateDoc(doc(database, "users", "ops-a"), { role: "owner" }),
    );
    await assertFails(
      setDoc(doc(database, "invites", "browser-invite"), {
        email: "browser@example.com",
        role: "owner",
        status: "pending",
      }),
    );
  });

  it("mantém somente a aceitação do próprio convite disponível antes do perfil", async () => {
    const database = testEnvironment
      .authenticatedContext("invited-user", { email: "invited@example.com" })
      .firestore();
    await assertSucceeds(
      updateDoc(doc(database, "invites", "invite-a"), {
        status: "used",
        used_by: "invited-user",
        used_at: new Date(),
      }),
    );
  });
});

describe("acesso removido", () => {
  it("perfil interno com acesso removido não lê mais a operação", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-off", { email: "wms-off@example.com" })
      .firestore();
    await assertFails(getDoc(doc(database, "stock_balances", "balance-a")));
    await assertFails(getDoc(doc(database, "movements", "movement-a")));
  });

  it("cliente com acesso removido não lê mais a própria conta", async () => {
    const database = testEnvironment
      .authenticatedContext("client-off", { email: "client-off@example.com" })
      .firestore();
    await assertFails(getDoc(doc(database, "client_inventory", "inventory-a")));
  });

  it("ainda lê o próprio perfil, para o app mostrar que o acesso foi removido", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-off", { email: "wms-off@example.com" })
      .firestore();
    await assertSucceeds(getDoc(doc(database, "users", "wms-off")));
  });

  it("o mesmo papel com acesso ativo continua lendo", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();
    await assertSucceeds(getDoc(doc(database, "stock_balances", "balance-a")));
  });
});

describe("isolamento entre clientes", () => {
  it("cliente lê somente a projeção publicada da própria conta", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();

    await assertSucceeds(getDoc(doc(database, "client_inventory", "inventory-a")));
    await assertFails(getDoc(doc(database, "client_inventory", "inventory-b")));
    await assertFails(getDoc(doc(database, "stock_balances", "balance-a")));

    const ownInventory = await assertSucceeds(
      getDocs(
        query(
          collection(database, "client_inventory"),
          where("customer_code", "==", CUSTOMER_A),
        ),
      ),
    );
    assert.equal(ownInventory.size, 1);
  });

  it("cliente lê o próprio perfil de operação, não o de outro contrato nem o cadastro interno", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();

    await assertSucceeds(getDoc(doc(database, "client_profiles", "profile-a")));
    await assertFails(getDoc(doc(database, "client_profiles", "profile-b")));
    const own = await assertSucceeds(
      getDocs(query(collection(database, "client_profiles"), where("customer_code", "==", CUSTOMER_A))),
    );
    assert.equal(own.size, 1);
    assert.equal(own.docs[0].get("operation_template"), "uniformes");
    // O cadastro completo (observações, contrato) continua interno.
    await assertFails(getDoc(doc(database, "customers", "profile-a-customer")));
    await assertFails(
      updateDoc(doc(database, "client_profiles", "profile-a"), { operation_template: "mobiliario" }),
    );
  });

  it("operação e financeiro leem o perfil de operação; ninguém grava pelo navegador", async () => {
    for (const uid of ["ops-a", "wms-a", "finance-a", "owner-a"]) {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      await assertSucceeds(getDoc(doc(database, "client_profiles", "profile-b")));
      await assertFails(setDoc(doc(database, "client_profiles", "novo"), { customer_code: CUSTOMER_A }));
    }
  });

  it("cliente lê a própria trava de saída da abertura, não a de outro contrato", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();

    const own = await assertSucceeds(getDoc(doc(database, "client_portal_status", CUSTOMER_A)));
    assert.equal(own.get("outbound_blocked"), true);
    await assertFails(getDoc(doc(database, "client_portal_status", CUSTOMER_B)));
  });

  it("operação lê a trava de saída da abertura; ninguém grava pelo navegador", async () => {
    for (const uid of ["wms-a", "ops-a", "owner-a"]) {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      await assertSucceeds(getDoc(doc(database, "client_portal_status", CUSTOMER_A)));
      await assertSucceeds(getDoc(doc(database, "client_portal_status", CUSTOMER_B)));
    }
    for (const uid of ["client-a", "client-b", "wms-a", "owner-a"]) {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      await assertFails(
        updateDoc(doc(database, "client_portal_status", CUSTOMER_A), { outbound_blocked: false }),
      );
      await assertFails(
        setDoc(doc(database, "client_portal_status", "CLIENTE NOVO"), {
          customer_code: "CLIENTE NOVO",
          outbound_blocked: false,
        }),
      );
      await assertFails(deleteDoc(doc(database, "client_portal_status", CUSTOMER_A)));
    }
  });

  it("cliente não altera nem a própria projeção", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(
      updateDoc(doc(database, "client_inventory", "inventory-a"), {
        qty_available: 1000,
      }),
    );
  });

  it("eventos do portal só passam pelas Cloud Functions, nem o próprio cliente acessa direto", async () => {
    for (const uid of ["client-a", "client-b", "owner-a", "ops-a"]) {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      await assertFails(getDoc(doc(database, "client_event_templates", "cev-a")));
      await assertFails(
        getDocs(query(collection(database, "client_event_templates"), where("customer_code", "==", CUSTOMER_A))),
      );
      await assertFails(updateDoc(doc(database, "client_event_templates", "cev-a"), { name: "Alterado" }));
      await assertFails(deleteDoc(doc(database, "client_event_templates", "cev-a")));
      await assertFails(
        setDoc(doc(database, "client_event_templates", `novo-${uid}`), { customer_code: CUSTOMER_A, name: "Novo" }),
      );
    }
  });
});

describe("leitura em lista do portal do cliente", () => {
  it("lista documentos visíveis quando a consulta declara customer_visible", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    // A consulta precisa repetir a condição da regra; sem isso o Firestore
    // nega a lista inteira (regressão observada em produção em 30/07).
    const visiveis = await assertSucceeds(
      getDocs(
        query(
          collection(database, "client_documents"),
          where("customer_code", "==", CUSTOMER_A),
          where("customer_visible", "==", true),
        ),
      ),
    );
    assert.equal(visiveis.size, 1);
    assert.equal(visiveis.docs[0].id, "doc-visivel");
  });

  it("nega a lista de documentos sem o filtro de visibilidade", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(
      getDocs(
        query(
          collection(database, "client_documents"),
          where("customer_code", "==", CUSTOMER_A),
        ),
      ),
    );
  });

  it("não entrega documento arquivado nem pelo id direto", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(
      getDoc(doc(database, "client_documents", "doc-arquivado")),
    );
  });

  it("cliente de outro contrato não lê documentos alheios", async () => {
    const database = testEnvironment
      .authenticatedContext("client-b", { email: "client-b@example.com" })
      .firestore();
    await assertFails(
      getDocs(
        query(
          collection(database, "client_documents"),
          where("customer_code", "==", CUSTOMER_A),
          where("customer_visible", "==", true),
        ),
      ),
    );
  });
});

describe("chat do Agent Dute em tempo real", () => {
  it("dono lista as próprias mensagens da conversa", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    // É a mesma consulta do listener em tempo real; antes ela era negada
    // porque a regra de leitura exigia o formato dos campos.
    const mensagens = await assertSucceeds(
      getDocs(
        query(
          collection(database, "agent_messages"),
          where("customer_code", "==", CUSTOMER_A),
          where("user_id", "==", "client-a"),
        ),
      ),
    );
    assert.equal(mensagens.size, 1);
  });

  it("dono lista as próprias conversas", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    const conversas = await assertSucceeds(
      getDocs(
        query(
          collection(database, "agent_conversations"),
          where("customer_code", "==", CUSTOMER_A),
          where("user_id", "==", "client-a"),
        ),
      ),
    );
    assert.equal(conversas.size, 1);
  });

  for (const uid of ["wms-a", "finance-a"]) {
    it(`${uid} lista as próprias conversas com o agente`, async () => {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      const conversas = await assertSucceeds(
        getDocs(
          query(
            collection(database, "agent_conversations"),
            where("customer_code", "==", CUSTOMER_A),
            where("user_id", "==", uid),
          ),
        ),
      );
      assert.equal(conversas.size, 1);
    });
  }

  it("outro usuário não lê a conversa alheia", async () => {
    const database = testEnvironment
      .authenticatedContext("client-b", { email: "client-b@example.com" })
      .firestore();
    await assertFails(getDoc(doc(database, "agent_messages", "msg-a")));
    await assertFails(
      getDocs(
        query(
          collection(database, "agent_messages"),
          where("customer_code", "==", CUSTOMER_A),
          where("user_id", "==", "client-a"),
        ),
      ),
    );
  });

  it("preço de catálogo fica com o financeiro e com o cliente dono", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "catalog_prices", "price-a"), {
        customer_code: CUSTOMER_A,
        sku_code: "SKU-1",
        item_code: "ITEM-1",
        preco_unit: 10,
      });
    });
    const finance = testEnvironment
      .authenticatedContext("finance-a", { email: "finance-a@example.com" })
      .firestore();
    const warehouse = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();
    const coordinator = testEnvironment
      .authenticatedContext("ops-a", { email: "ops-a@example.com" })
      .firestore();
    const client = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    const otherClient = testEnvironment
      .authenticatedContext("client-b", { email: "client-b@example.com" })
      .firestore();
    await assertSucceeds(getDoc(doc(finance, "catalog_prices", "price-a")));
    await assertFails(getDoc(doc(warehouse, "catalog_prices", "price-a")));
    await assertFails(getDoc(doc(coordinator, "catalog_prices", "price-a")));
    await assertSucceeds(getDoc(doc(client, "catalog_prices", "price-a")));
    await assertFails(getDoc(doc(otherClient, "catalog_prices", "price-a")));
    await assertFails(
      setDoc(doc(finance, "catalog_prices", "price-a"), { preco_unit: 99 }),
    );
  });

  it("wms não lê billing_periods (motivo do listener removido)", async () => {
    const database = testEnvironment
      .authenticatedContext("wms-a", { email: "wms-a@example.com" })
      .firestore();
    await assertFails(getDocs(collection(database, "billing_periods")));
  });
});

describe("financeiro consegue calcular a fatura", () => {
  // getBillingPeriod lê estas seis fontes num Promise.all: se qualquer uma
  // negar, a chamada inteira falha e a tela mostra R$ 0,00 como se o mês
  // não tivesse movimento.
  const fontesDaFatura = [
    "products",
    "client_inventory",
    "movements",
    "billing_price_list",
    "billing_manual",
    "system_controls",
  ] as const;

  it("lê todas as fontes que o cálculo da fatura exige", async () => {
    const database = testEnvironment
      .authenticatedContext("finance-a", { email: "finance-a@example.com" })
      .firestore();
    for (const fonte of fontesDaFatura) {
      await assertSucceeds(getDocs(collection(database, fonte)));
    }
  });

  it("lê o estado operacional que define o modo de apuração", async () => {
    const database = testEnvironment
      .authenticatedContext("finance-a", { email: "finance-a@example.com" })
      .firestore();
    const controle = await assertSucceeds(
      getDoc(doc(database, "system_controls", "inventory")),
    );
    assert.equal(controle.data()?.opening_inventory_required, true);
  });

  it("continua sem poder escrever na operação", async () => {
    const database = testEnvironment
      .authenticatedContext("finance-a", { email: "finance-a@example.com" })
      .firestore();
    await assertFails(
      updateDoc(doc(database, "system_controls", "inventory"), {
        movements_frozen: true,
      }),
    );
    await assertFails(
      updateDoc(doc(database, "movements", "movement-a"), { quantity: 999 }),
    );
    await assertFails(
      updateDoc(doc(database, "products", "product-a"), { produto: "hack" }),
    );
  });

  it("cliente não alcança as fontes internas de faturamento", async () => {
    const database = testEnvironment
      .authenticatedContext("client-a", { email: "client-a@example.com" })
      .firestore();
    await assertFails(getDocs(collection(database, "movements")));
    await assertFails(getDocs(collection(database, "products")));
    await assertFails(getDoc(doc(database, "system_controls", "inventory")));
  });
});

describe("coordenador fora do faturamento (decisão de produto 30/07)", () => {
  it("interno não lê coleções de faturamento", async () => {
    const database = testEnvironment
      .authenticatedContext("ops-a", { email: "ops-a@example.com" })
      .firestore();
    await assertFails(getDocs(collection(database, "billing_periods")));
    await assertFails(getDocs(collection(database, "billing_price_list")));
    await assertFails(getDocs(collection(database, "billing_manual")));
  });

  it("interno segue lendo o operacional que coordena", async () => {
    const database = testEnvironment
      .authenticatedContext("ops-a", { email: "ops-a@example.com" })
      .firestore();
    await assertSucceeds(getDocs(collection(database, "products")));
    await assertSucceeds(getDocs(collection(database, "movements")));
    await assertSucceeds(
      getDoc(doc(database, "system_controls", "inventory")),
    );
  });

  it("suporte e financeiro mantêm a leitura de faturamento", async () => {
    for (const uid of ["finance-a"]) {
      const database = testEnvironment
        .authenticatedContext(uid, { email: `${uid}@example.com` })
        .firestore();
      await assertSucceeds(getDocs(collection(database, "billing_periods")));
    }
  });
});

function signedAs(uid: string) {
  return testEnvironment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
}

async function setClientAccess(customerCode: string, modules: string[]) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "client_access", customerCode), {
      customer_code: customerCode,
      modules,
    });
  });
}

describe("papéis da plataforma (Fase 2)", () => {
  for (const role of NEW_PLATFORM_ROLES) {
    it(`aceite de convite cria o próprio perfil com o papel ${role}`, async () => {
      const database = testEnvironment
        .authenticatedContext(`novo-${role}`, { email: `${role}-novo@example.com` })
        .firestore();
      await assertSucceeds(
        setDoc(doc(database, "users", `novo-${role}`), {
          nome: `Novo ${role}`,
          email: `${role}-novo@example.com`,
          role,
          customer_code: "Dutelog",
          invite_id: `invite-${role}`,
        }),
      );
    });

    it(`${role} não lê nada da operação, do faturamento nem do portal`, async () => {
      const database = signedAs(`${role}-a`);
      await assertSucceeds(getDoc(doc(database, "users", `${role}-a`)));
      for (const [collectionName, id] of [
        ["customers", "profile-a-customer"],
        ["client_profiles", "profile-a"],
        ["stock_balances", "balance-a"],
        ["orders", "order-a"],
        ["events", "event-a"],
        ["movements", "movement-a"],
        ["products", "product-a"],
        ["warehouse_positions", "A-01"],
        ["billing_operational_snapshots", "2026-07"],
        ["billing_config", "default"],
        ["client_inventory", "inventory-a"],
        ["client_invoices", "invoice-a"],
        ["ops_aggregates", "dashboard"],
        ["ai_agent_inbox", "alert-a"],
        ["agent_conversations", "conv-a"],
      ] as const) {
        // Mudança de propósito (Comercial, parte 6): o comercial lê o
        // cadastro de clientes; o resto da lista continua fechado para ele
        // (comercial-cadastro.rules.test.ts).
        if (role === "comercial" && collectionName === "customers") {
          await assertSucceeds(getDoc(doc(database, collectionName, id)));
          continue;
        }
        await assertFails(getDoc(doc(database, collectionName, id)));
      }
      await assertFails(
        setDoc(doc(database, "agent_conversations", `conv-${role}`), {
          id: `conv-${role}`,
          customer_code: CUSTOMER_A,
          user_id: `${role}-a`,
          status: "active",
          created_at_iso: new Date().toISOString(),
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );
    });
  }

  it("papel fora da lista continua sem perfil", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "invites", "invite-viewer"), {
        email: "viewer@example.com",
        role: "viewer",
        status: "pending",
      });
    });
    const database = testEnvironment
      .authenticatedContext("viewer", { email: "viewer@example.com" })
      .firestore();
    await assertFails(
      setDoc(doc(database, "users", "viewer"), {
        nome: "Viewer",
        email: "viewer@example.com",
        role: "viewer",
        invite_id: "invite-viewer",
      }),
    );
  });

  it("suporte lê a operação e o faturamento, como hoje", async () => {
    const database = signedAs("support-a");
    await assertSucceeds(getDoc(doc(database, "stock_balances", "balance-a")));
    await assertSucceeds(getDoc(doc(database, "billing_config", "default")));
    await assertSucceeds(getDoc(doc(database, "ops_aggregates", "dashboard")));
  });
});

describe("módulos contratados do cliente (Fase 2)", () => {
  function portalReads(uid: string) {
    const database = signedAs(uid);
    return {
      inventory: () => getDoc(doc(database, "client_inventory", "inventory-a")),
      orders: () => getDoc(doc(database, "client_order_tracking", "order-a")),
      requests: () => getDoc(doc(database, "client_request_status", "request-a")),
      documents: () => getDoc(doc(database, "client_documents", "doc-visivel")),
      invoices: () => getDoc(doc(database, "client_invoices", "invoice-a")),
    };
  }

  it("cliente sem client_access lê o portal como hoje (armazenagem e faturas)", async () => {
    const reads = portalReads("client-a");
    await assertSucceeds(reads.inventory());
    await assertSucceeds(reads.orders());
    await assertSucceeds(reads.requests());
    await assertSucceeds(reads.documents());
    await assertSucceeds(reads.invoices());
  });

  it("cliente só com operação não lê nada do WMS nem as faturas", async () => {
    await setClientAccess(CUSTOMER_A, ["operacao"]);
    const reads = portalReads("client-a");
    await assertFails(reads.inventory());
    await assertFails(reads.orders());
    await assertFails(reads.requests());
    await assertFails(reads.documents());
    await assertFails(reads.invoices());
    const database = signedAs("client-a");
    await assertFails(
      getDocs(query(collection(database, "client_inventory"), where("customer_code", "==", CUSTOMER_A))),
    );
    // O perfil continua legível: é por ele que o portal monta o menu.
    await assertSucceeds(getDoc(doc(database, "client_profiles", "profile-a")));
  });

  it("cliente com armazenagem e sem financeiro lê o estoque, não as faturas", async () => {
    await setClientAccess(CUSTOMER_A, ["wms"]);
    const reads = portalReads("client-a");
    await assertSucceeds(reads.inventory());
    await assertSucceeds(reads.orders());
    await assertFails(reads.invoices());
  });

  it("cliente com todos os módulos lê tudo do próprio contrato e nada do outro", async () => {
    await setClientAccess(CUSTOMER_A, ["wms", "operacao", "financeiro"]);
    const reads = portalReads("client-a");
    await assertSucceeds(reads.inventory());
    await assertSucceeds(reads.invoices());
    await assertFails(getDoc(doc(signedAs("client-a"), "client_inventory", "inventory-b")));
  });

  it("o contrato de outro cliente não muda o que este lê", async () => {
    await setClientAccess(CUSTOMER_B, ["operacao"]);
    await assertSucceeds(portalReads("client-a").inventory());
  });

  it("equipe com customer_code Dutelog não depende de client_access", async () => {
    await setClientAccess("Dutelog", ["operacao"]);
    const database = signedAs("ops-dutelog");
    await assertSucceeds(getDoc(doc(database, "client_inventory", "inventory-a")));
    await assertSucceeds(getDoc(doc(database, "client_order_tracking", "order-a")));
    await assertSucceeds(getDoc(doc(database, "stock_balances", "balance-a")));
  });

  it("ninguém lê nem grava client_access pelo navegador", async () => {
    await setClientAccess(CUSTOMER_A, ["wms", "financeiro"]);
    for (const uid of ["client-a", "owner-a", "admin-a", "ops-a"]) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "client_access", CUSTOMER_A)));
      await assertFails(
        setDoc(doc(database, "client_access", CUSTOMER_A), {
          customer_code: CUSTOMER_A,
          modules: ["wms", "operacao", "financeiro"],
        }),
      );
    }
  });

  it("cliente não lê os agregados globais da operação; a equipe lê", async () => {
    await assertFails(getDoc(doc(signedAs("client-a"), "ops_aggregates", "dashboard")));
    await assertFails(getDoc(doc(signedAs("client-b"), "ops_aggregates", "dashboard")));
    await assertSucceeds(getDoc(doc(signedAs("ops-a"), "ops_aggregates", "dashboard")));
    await assertSucceeds(getDoc(doc(signedAs("finance-a"), "ops_aggregates", "dashboard")));
  });
});

describe("contratos do Comercial (parte 8)", () => {
  const LEITORES = ["owner-a", "admin-a", "comercial-a", "finance-a"] as const;
  const FORA = [
    "ops-a",
    "ops-dutelog",
    "wms-a",
    "support-a",
    "campo-a",
    "rh-a",
    "painel-a",
    "client-a",
    "client-b",
    "comercial-off",
  ] as const;

  beforeEach(async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "users", "comercial-off"), {
        nome: "comercial-off",
        email: "comercial-off@example.com",
        role: "comercial",
        access_disabled: true,
      });
      await setDoc(doc(database, "contracts", "ct-a"), {
        id: "ct-a",
        customer_code: CUSTOMER_A,
        nome: "Contrato de serviços",
        vigente_de: "2026-07-01",
        vigente_ate: "2027-06-30",
        status: "vigente",
        edicao: 1,
      });
      await setDoc(doc(database, "contracts", "ct-a", "aditivos", "1"), {
        id: "1",
        numero: 1,
        tipo: "prorrogacao",
        contrato_id: "ct-a",
        customer_code: CUSTOMER_A,
      });
    });
  });

  for (const uid of LEITORES) {
    it(`${uid} lê contrato e aditivos, inclusive em lista`, async () => {
      const database = signedAs(uid);
      await assertSucceeds(getDoc(doc(database, "contracts", "ct-a")));
      await assertSucceeds(getDocs(collection(database, "contracts")));
      await assertSucceeds(getDocs(query(collection(database, "contracts"), where("customer_code", "==", CUSTOMER_A))));
      await assertSucceeds(getDoc(doc(database, "contracts", "ct-a", "aditivos", "1")));
      await assertSucceeds(getDocs(collection(database, "contracts", "ct-a", "aditivos")));
    });
  }

  it("operação, campo, suporte, rh, painel, cliente e acesso removido não leem contrato nem aditivo", async () => {
    for (const uid of FORA) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "contracts", "ct-a")));
      await assertFails(getDocs(collection(database, "contracts")));
      await assertFails(getDoc(doc(database, "contracts", "ct-a", "aditivos", "1")));
      await assertFails(getDocs(collection(database, "contracts", "ct-a", "aditivos")));
    }
    const anonimo = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonimo, "contracts", "ct-a")));
    await assertFails(getDoc(doc(anonimo, "contracts", "ct-a", "aditivos", "1")));
  });

  it("ninguém grava contrato nem aditivo pelo navegador, nem o owner", async () => {
    for (const uid of LEITORES) {
      const database = signedAs(uid);
      await assertFails(
        setDoc(doc(database, "contracts", `ct-${uid}`), {
          customer_code: CUSTOMER_A,
          nome: "Contrato novo",
          vigente_de: "2026-07-01",
          vigente_ate: null,
          status: "vigente",
        }),
      );
      await assertFails(updateDoc(doc(database, "contracts", "ct-a"), { vigente_ate: "2030-12-31" }));
      await assertFails(deleteDoc(doc(database, "contracts", "ct-a")));
      await assertFails(setDoc(doc(database, "contracts", "ct-a", "aditivos", "2"), { numero: 2, tipo: "prorrogacao" }));
      await assertFails(updateDoc(doc(database, "contracts", "ct-a", "aditivos", "1"), { tipo: "preco" }));
      await assertFails(deleteDoc(doc(database, "contracts", "ct-a", "aditivos", "1")));
    }
  });

  it("os recibos do Comercial continuam fechados", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "comercial_operations", "op-1"), { kind: "contract_save" });
    });
    for (const uid of LEITORES) {
      await assertFails(getDoc(doc(signedAs(uid), "comercial_operations", "op-1")));
    }
  });
});
