import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * Regras da solicitação de OS pelo portal (docs/plataforma/fase-4-financeiro.md,
 * parte 4.4a): no Firestore, quem coordena a Operação e o suporte leem as
 * solicitações; o cliente lê só as próprias, com a Operação no contrato;
 * ninguém grava pelo navegador. No Storage, o cliente com a Operação no
 * contrato sobe o anexo no caminho do próprio código (PDF ou imagem, até
 * 10 MB, sem sobrescrever); quem coordena e o suporte leem.
 */

const PROJECT_ID = "demo-dute-operations";
const SOL_ITAU = "sol_0123456789abcdef";
const SOL_SAFRA = "sol_fedcba9876543210";

let testEnvironment: RulesTestEnvironment;

function endereco(variavel: string) {
  const address = process.env[variavel];
  assert.ok(address, `Execute este teste pelo Firebase Emulator (${variavel}).`);
  const [host, rawPort] = address.split(":");
  return { host, port: Number(rawPort) };
}

function regras(arquivo: string) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(currentDirectory, "../../../", arquivo), "utf8");
}

const PAPEIS: Record<string, { role: string; customer_code?: string }> = {
  "owner-a": { role: "owner" },
  "admin-a": { role: "admin" },
  "ops-a": { role: "interno" },
  "support-a": { role: "suporte" },
  "wms-a": { role: "wms" },
  "campo-a": { role: "campo" },
  "comercial-a": { role: "comercial" },
  "financeiro-a": { role: "financeiro" },
  "client-itau": { role: "cliente", customer_code: "ITAU" },
  "client-safra": { role: "cliente", customer_code: "SAFRA" },
  "client-btg": { role: "cliente", customer_code: "BTG" },
};

const LEEM_TODAS = ["owner-a", "admin-a", "ops-a", "support-a"];
const NAO_LEEM = ["wms-a", "campo-a", "comercial-a", "financeiro-a"];

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, perfil] of Object.entries(PAPEIS)) await setDoc(doc(database, "users", uid), { nome: uid, ...perfil });
    await setDoc(doc(database, "client_access", "ITAU"), { customer_code: "ITAU", modules: ["wms", "operacao", "financeiro"] });
    // A Safra tem a Operação no contrato, mas é outro cliente; a BTG fica sem client_access (vale o padrão, sem a Operação).
    await setDoc(doc(database, "client_access", "SAFRA"), { customer_code: "SAFRA", modules: ["operacao"] });
    await setDoc(doc(database, "service_requests", SOL_ITAU), { id: SOL_ITAU, customer_code: "ITAU", status: "recebida", tipo_servico: "transporte" });
    await setDoc(doc(database, "service_requests", SOL_SAFRA), { id: SOL_SAFRA, customer_code: "SAFRA", status: "recebida", tipo_servico: "mudanca" });
  });
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
    storage: { ...endereco("FIREBASE_STORAGE_EMULATOR_HOST"), rules: regras("storage.rules") },
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

function firestore(uid: string) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

describe("service_requests no Firestore", () => {
  it("quem coordena e o suporte leem todas; o resto da equipe, não", async () => {
    for (const uid of LEEM_TODAS) {
      await assertSucceeds(getDoc(doc(firestore(uid), "service_requests", SOL_ITAU)));
      await assertSucceeds(getDocs(collection(firestore(uid), "service_requests")));
    }
    for (const uid of NAO_LEEM) await assertFails(getDoc(doc(firestore(uid), "service_requests", SOL_ITAU)));
  });

  it("o cliente lê só as próprias e só com a Operação no contrato", async () => {
    await assertSucceeds(getDoc(doc(firestore("client-itau"), "service_requests", SOL_ITAU)));
    await assertSucceeds(getDocs(query(collection(firestore("client-itau"), "service_requests"), where("customer_code", "==", "ITAU"))));
    await assertFails(getDoc(doc(firestore("client-itau"), "service_requests", SOL_SAFRA)));
    await assertFails(getDocs(collection(firestore("client-itau"), "service_requests")));
    await assertSucceeds(getDoc(doc(firestore("client-safra"), "service_requests", SOL_SAFRA)));
    await assertFails(getDoc(doc(firestore("client-btg"), "service_requests", SOL_ITAU)));
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "service_requests", SOL_ITAU)));
  });

  it("ninguém grava pelo navegador, nem o cliente na própria solicitação", async () => {
    for (const uid of ["owner-a", "ops-a", "client-itau"]) {
      await assertFails(setDoc(doc(firestore(uid), "service_requests", "sol_aaaaaaaaaaaaaaaa"), { customer_code: "ITAU", status: "recebida" }));
      await assertFails(updateDoc(doc(firestore(uid), "service_requests", SOL_ITAU), { status: "aceita" }));
      await assertFails(deleteDoc(doc(firestore(uid), "service_requests", SOL_ITAU)));
    }
  });
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function storage(uid: string) {
  return testEnvironment.authenticatedContext(uid).storage();
}

function subir(uid: string, codigo: string, arquivo: string, conteudo: Uint8Array = PDF, contentType = "application/pdf") {
  return storage(uid).ref(`portal/${codigo}/solicitacoes/${arquivo}`).put(conteudo, { contentType }).then((snapshot) => snapshot);
}

describe("anexo da solicitação no Storage", () => {
  // O emulador do Storage não limpa o bucket entre os testes: cada teste usa nomes próprios.
  it("o cliente com a Operação sobe no caminho do próprio código; os outros, não", async () => {
    await assertSucceeds(subir("client-itau", "ITAU", "an_1111111111111111.pdf"));
    await assertSucceeds(subir("client-itau", "ITAU", "an_1111111111111112.jpg", new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"));
    await assertFails(subir("client-itau", "SAFRA", "an_1111111111111113.pdf"));
    await assertFails(subir("client-btg", "BTG", "an_1111111111111114.pdf"));
    for (const uid of ["owner-a", "ops-a", "support-a", "campo-a"]) await assertFails(subir(uid, "ITAU", "an_1111111111111115.pdf"));
    await assertFails(testEnvironment.unauthenticatedContext().storage().ref("portal/ITAU/solicitacoes/an_1111111111111116.pdf").put(PDF, { contentType: "application/pdf" }).then((snapshot) => snapshot));
  });

  it("só PDF ou imagem, com o nome do formato, até 10 MB, sem sobrescrever nem apagar", async () => {
    await assertFails(subir("client-itau", "ITAU", "an_2222222222222221.exe", PDF, "application/octet-stream"));
    await assertFails(subir("client-itau", "ITAU", "an_2222222222222222.pdf", PDF, "text/html"));
    await assertFails(subir("client-itau", "ITAU", "nota.pdf"));
    await assertFails(subir("client-itau", "ITAU", "an_2222222222222223.pdf", new Uint8Array(10 * 1024 * 1024 + 1)));
    await assertSucceeds(subir("client-itau", "ITAU", "an_2222222222222224.pdf"));
    await assertFails(subir("client-itau", "ITAU", "an_2222222222222224.pdf"));
    await assertFails(storage("client-itau").ref("portal/ITAU/solicitacoes/an_2222222222222224.pdf").delete());
  });

  it("quem coordena, o suporte e o próprio cliente leem; o outro cliente e o resto da equipe, não", async () => {
    await assertSucceeds(subir("client-itau", "ITAU", "an_3333333333333333.pdf"));
    const caminho = "portal/ITAU/solicitacoes/an_3333333333333333.pdf";
    for (const uid of ["owner-a", "admin-a", "ops-a", "support-a", "client-itau"]) await assertSucceeds(storage(uid).ref(caminho).getMetadata());
    for (const uid of ["client-safra", "client-btg", "wms-a", "campo-a", "comercial-a", "financeiro-a"]) await assertFails(storage(uid).ref(caminho).getMetadata());
  });
});
