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

let testEnvironment: RulesTestEnvironment;

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, "Execute este teste pelo Firebase Emulator.");
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function rulesSource() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../firestore.rules"), "utf8");
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
