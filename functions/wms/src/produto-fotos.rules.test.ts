import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

/**
 * Regras das fotos do produto no Storage (product-photos/**, o único prefixo
 * que o navegador grava direto, por features/warehouse-ops/shared.ts): a
 * equipe interna lê; quem opera o armazém (owner, admin, interno e wms) sobe
 * imagem abaixo de 15 MB; nada se sobrescreve nem apaga. O perfil vem do
 * users do Firestore, com o mesmo critério do firestore.rules: acesso
 * removido não vale.
 */

const PROJECT_ID = "demo-dute-operations";

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

const PAPEIS = {
  "owner-a": "owner",
  "admin-a": "admin",
  "ops-a": "interno",
  "wms-a": "wms",
  "fin-a": "financeiro",
  "support-a": "suporte",
  "comercial-a": "comercial",
  "campo-a": "campo",
  "rh-a": "rh",
  "painel-a": "painel",
  "client-a": "cliente",
} as const;

const SOBEM = ["owner-a", "admin-a", "ops-a", "wms-a"] as const;
const SO_LEEM = ["fin-a", "support-a"] as const;
const DE_FORA = ["comercial-a", "campo-a", "rh-a", "painel-a", "client-a", "desligado-a", "sem-perfil-a"] as const;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function storage(uid: string) {
  return testEnvironment.authenticatedContext(uid).storage();
}

/** O caminho que createProductPhotoUploadTarget devolve: cliente, item, mês e arquivo. */
function caminho(arquivo: string) {
  return `product-photos/BTG_Pactual/CAMISA-P/2026-10/1761360000000-${arquivo}`;
}

function subir(uid: string, arquivo: string, conteudo: Uint8Array = JPEG, contentType = "image/jpeg") {
  return storage(uid).ref(caminho(arquivo)).put(conteudo, { contentType }).then((snapshot) => snapshot);
}

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...endereco("FIRESTORE_EMULATOR_HOST"), rules: regras("firestore.rules") },
    storage: { ...endereco("FIREBASE_STORAGE_EMULATOR_HOST"), rules: regras("storage.rules") },
  });
});

beforeEach(async () => {
  // O emulador do Storage não limpa o bucket entre os testes: cada teste usa nomes próprios.
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), { nome: uid, role, ...(role === "cliente" ? { customer_code: "BTG Pactual" } : {}) });
    }
    await setDoc(doc(database, "users", "desligado-a"), { nome: "desligado-a", role: "interno", access_disabled: true });
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

describe("fotos do produto no Storage", () => {
  it("quem opera o armazém sobe; o financeiro, o suporte, os papéis de fora, o acesso removido e quem não entrou, não", async () => {
    for (const uid of SOBEM) await assertSucceeds(subir(uid, `sobe-${uid}.jpg`));
    for (const uid of [...SO_LEEM, ...DE_FORA]) await assertFails(subir(uid, `nao-sobe-${uid}.jpg`));
    await assertFails(testEnvironment.unauthenticatedContext().storage().ref(caminho("anonimo.jpg")).put(JPEG, { contentType: "image/jpeg" }).then((snapshot) => snapshot));
  });

  it("a equipe interna lê; o cliente, os papéis de fora, o acesso removido e quem não entrou, não", async () => {
    const ARQUIVO = "leitura.jpg";
    await assertSucceeds(subir("wms-a", ARQUIVO));
    for (const uid of [...SOBEM, ...SO_LEEM]) await assertSucceeds(storage(uid).ref(caminho(ARQUIVO)).getMetadata());
    for (const uid of DE_FORA) await assertFails(storage(uid).ref(caminho(ARQUIVO)).getMetadata());
    await assertFails(testEnvironment.unauthenticatedContext().storage().ref(caminho(ARQUIVO)).getMetadata());
  });

  it("só imagem, abaixo de 15 MB", async () => {
    await assertFails(subir("ops-a", "nota.pdf", JPEG, "application/pdf"));
    await assertFails(subir("ops-a", "grande.jpg", new Uint8Array(15 * 1024 * 1024)));
    await assertSucceeds(subir("ops-a", "quase.jpg", new Uint8Array(15 * 1024 * 1024 - 1)));
  });

  it("nada se sobrescreve nem apaga, nem por quem subiu", async () => {
    const ARQUIVO = "unica.jpg";
    await assertSucceeds(subir("ops-a", ARQUIVO));
    for (const uid of ["ops-a", "owner-a"]) {
      await assertFails(subir(uid, ARQUIVO));
      await assertFails(storage(uid).ref(caminho(ARQUIVO)).delete());
    }
  });
});
