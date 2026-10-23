import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * Regras do cadastro da Operação (docs/plataforma/fase-3-operacao.md, parte 1):
 * owner, admin e interno leem collaborators e vehicles. O CPF fica nesses
 * documentos, então campo, suporte, comercial e cliente não leem. Ninguém
 * grava pelo navegador.
 */

const PROJECT_ID = "demo-dute-operations";

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

const PAPEIS = {
  "owner-a": "owner",
  "admin-a": "admin",
  "ops-a": "interno",
  "wms-a": "wms",
  "support-a": "suporte",
  "finance-a": "financeiro",
  "campo-a": "campo",
  "comercial-a": "comercial",
  "rh-a": "rh",
  "painel-a": "painel",
  "client-a": "cliente",
} as const;

const LEEM = ["owner-a", "admin-a", "ops-a"] as const;
const NAO_LEEM = ["wms-a", "support-a", "finance-a", "campo-a", "comercial-a", "rh-a", "painel-a", "client-a"] as const;

async function seed() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), {
        nome: uid,
        email: `${uid}@example.com`,
        role,
        ...(role === "cliente" ? { customer_code: "BTG Pactual" } : {}),
      });
    }
    await setDoc(doc(database, "users", "ops-off"), {
      nome: "ops-off",
      email: "ops-off@example.com",
      role: "interno",
      access_disabled: true,
    });
    await setDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa"), {
      id: "col_aaaaaaaaaaaaaaaa",
      nome: "Ana Souza",
      cpf: "52998224725",
      funcao: "Motorista",
      telefone: "11987654321",
      cnh: { categoria: "C", validade: "2028-04-01" },
      ativo: true,
      edicao: 1,
    });
    await setDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa"), {
      id: "vei_aaaaaaaaaaaaaaaa",
      placa: "ABC1D23",
      tipo: "VUC",
      capacidade_kg: 3500,
      capacidade_m3: 12.5,
      ativo: true,
      edicao: 1,
    });
  });
}

function signedAs(uid: string) {
  return testEnvironment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
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

describe("cadastro da Operação: leitura", () => {
  it("owner, admin e interno leem colaborador e veículo", async () => {
    for (const uid of LEEM) {
      const database = signedAs(uid);
      const colaborador = await assertSucceeds(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
      assert.equal(colaborador.data()?.cpf, "52998224725", uid);
      await assertSucceeds(getDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    }
  });

  it("wms, suporte, campo, comercial, financeiro, rh, painel e cliente não leem", async () => {
    for (const uid of NAO_LEEM) {
      const database = signedAs(uid);
      await assertFails(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
      await assertFails(getDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    }
  });

  it("interno com acesso removido não lê", async () => {
    const database = signedAs("ops-off");
    await assertFails(getDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa")));
  });
});

describe("OS: leitura", () => {
  it("owner, admin, interno e suporte leem a OS; campo, comercial e cliente não", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "service_orders", "10045-01"), {
        numero: "10045-01",
        customer_code: "ITAU",
        status: "aberta",
        itens: [{ id: "ln_1", quantidade: "2" }],
      });
    });
    for (const uid of ["owner-a", "admin-a", "ops-a", "support-a"]) {
      await assertSucceeds(getDoc(doc(signedAs(uid), "service_orders", "10045-01")));
    }
    for (const uid of ["campo-a", "comercial-a", "finance-a", "wms-a", "client-a"]) {
      await assertFails(getDoc(doc(signedAs(uid), "service_orders", "10045-01")));
    }
  });

  it("o cliente com a Operação contratada lê só as próprias OS, e só com ela no contrato (parte 2.7)", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "service_orders", "10046-01"), { numero: "10046-01", customer_code: "BTG Pactual", status: "aberta", itens: [] });
      await setDoc(doc(database, "service_orders", "10047-01"), { numero: "10047-01", customer_code: "ITAU", status: "aberta", itens: [] });
      await setDoc(doc(database, "users", "client-op"), { nome: "client-op", email: "op@example.com", role: "cliente", customer_code: "BTG Pactual" });
    });
    // Sem client_access vale o padrão (armazenagem e faturas): a OS não abre.
    await assertFails(getDoc(doc(signedAs("client-op"), "service_orders", "10046-01")));
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "client_access", "BTG Pactual"), { customer_code: "BTG Pactual", modules: ["wms", "operacao"] });
    });
    const cliente = signedAs("client-op");
    await assertSucceeds(getDoc(doc(cliente, "service_orders", "10046-01")));
    await assertFails(getDoc(doc(cliente, "service_orders", "10047-01")));
    await assertSucceeds(getDocs(query(collection(cliente, "service_orders"), where("customer_code", "==", "BTG Pactual"))));
    await assertFails(getDocs(collection(cliente, "service_orders")));
    await assertFails(setDoc(doc(cliente, "service_orders", "10046-02"), { numero: "10046-02", customer_code: "BTG Pactual" }));
    // Tirar a Operação do contrato tira a leitura.
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "client_access", "BTG Pactual"), { customer_code: "BTG Pactual", modules: ["wms", "financeiro"] });
    });
    await assertFails(getDoc(doc(signedAs("client-op"), "service_orders", "10046-01")));
  });

  it("o campo lê só a OS em que está escalado, e lista só com o filtro dele (parte 3.4b)", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "users", "campo-b"), { nome: "campo-b", email: "campo-b@example.com", role: "campo" });
      await setDoc(doc(database, "users", "campo-off"), { nome: "campo-off", email: "campo-off@example.com", role: "campo", access_disabled: true });
      await setDoc(doc(database, "service_orders", "10045-01"), { numero: "10045-01", customer_code: "ITAU", status: "agendada", itens: [], equipe_uids: ["campo-a", "campo-off"] });
      await setDoc(doc(database, "service_orders", "10045-02"), { numero: "10045-02", customer_code: "ITAU", status: "agendada", itens: [], equipe_uids: ["campo-b"] });
      await setDoc(doc(database, "service_orders", "10045-03"), { numero: "10045-03", customer_code: "ITAU", status: "aberta", itens: [] });
    });
    const campoA = signedAs("campo-a");
    await assertSucceeds(getDoc(doc(campoA, "service_orders", "10045-01")));
    await assertFails(getDoc(doc(campoA, "service_orders", "10045-02")));
    await assertFails(getDoc(doc(campoA, "service_orders", "10045-03")));
    await assertSucceeds(getDocs(query(collection(campoA, "service_orders"), where("equipe_uids", "array-contains", "campo-a"))));
    await assertFails(getDocs(query(collection(campoA, "service_orders"), where("equipe_uids", "array-contains", "campo-b"))));
    await assertFails(getDocs(collection(campoA, "service_orders")));
    // Acesso removido em Pessoas tira a leitura, mesmo escalado.
    await assertFails(getDoc(doc(signedAs("campo-off"), "service_orders", "10045-01")));
    // Escalado não vira coordenação: nem o cadastro (tem CPF) nem gravar a OS.
    await assertFails(getDoc(doc(campoA, "collaborators", "col_aaaaaaaaaaaaaaaa")));
    await assertFails(updateDoc(doc(campoA, "service_orders", "10045-01"), { status: "em_execucao" }));
    // Outro papel escalado por engano não lê pela equipe.
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "service_orders", "10045-04"), { numero: "10045-04", customer_code: "ITAU", status: "agendada", itens: [], equipe_uids: ["comercial-a"] });
    });
    await assertFails(getDoc(doc(signedAs("comercial-a"), "service_orders", "10045-04")));
  });

  it("o painel da TV não lê nada pelo navegador: o quadro vem da callable (parte 3.12)", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "service_orders", "10045-01"), { numero: "10045-01", customer_code: "ITAU", status: "agendada", itens: [], equipe_uids: ["painel-a"] });
      await setDoc(doc(database, "demands", "10045"), { numero: "10045", customer_code: "ITAU", etapa: "em_execucao" });
      await setDoc(doc(database, "customers", "ITAU"), { customer_code: "ITAU", name: "Itaú Unibanco" });
      await setDoc(doc(database, "events", "ev1"), { type: "os.started", customer_code: "ITAU" });
    });
    const tv = signedAs("painel-a");
    await assertFails(getDoc(doc(tv, "service_orders", "10045-01")));
    await assertFails(getDocs(query(collection(tv, "service_orders"), where("equipe_uids", "array-contains", "painel-a"))));
    await assertFails(getDocs(query(collection(tv, "service_orders"), where("status", "==", "agendada"))));
    for (const [colecao, id] of [["demands", "10045"], ["customers", "ITAU"], ["events", "ev1"], ["collaborators", "col_aaaaaaaaaaaaaaaa"], ["vehicles", "vei_aaaaaaaaaaaaaaaa"]] as const) {
      await assertFails(getDoc(doc(tv, colecao, id)));
    }
    await assertFails(updateDoc(doc(tv, "service_orders", "10045-01"), { status: "em_execucao" }));
  });

  it("ninguém grava a OS nem lê o contador pelo navegador", async () => {
    const database = signedAs("owner-a");
    await assertFails(setDoc(doc(database, "service_orders", "10045-02"), { numero: "10045-02" }));
    await assertFails(getDoc(doc(database, "service_order_counters", "10045")));
  });
});

describe("cadastro da Operação: escrita", () => {
  it("nem o owner grava, altera ou apaga pelo navegador", async () => {
    const database = signedAs("owner-a");
    await assertFails(setDoc(doc(database, "collaborators", "col_bbbbbbbbbbbbbbbb"), { nome: "Outra" }));
    await assertFails(updateDoc(doc(database, "collaborators", "col_aaaaaaaaaaaaaaaa"), { funcao: "Ajudante" }));
    await assertFails(deleteDoc(doc(database, "vehicles", "vei_aaaaaaaaaaaaaaaa")));
    await assertFails(setDoc(doc(database, "operacao_operations", "op1"), { ok: true }));
  });
});
