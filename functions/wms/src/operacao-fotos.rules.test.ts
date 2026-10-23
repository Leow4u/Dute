import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

/**
 * Regras das fotos da OS no Storage (docs/plataforma/fase-3-operacao.md,
 * parte 3.7c): só quem coordena a Operação ou está escalado na OS sobe foto,
 * e só na OS agendada ou em execução; suporte só lê; nada se sobrescreve nem
 * apaga. O critério do escalado é o mesmo do firestore.rules (equipe_uids).
 * A assinatura do responsável (parte 3.9a) segue a mesma regra, só na OS em
 * execução.
 */

const PROJECT_ID = "demo-dute-operations";
const OS = "10045-01";

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
  "support-a": "suporte",
  "comercial-a": "comercial",
  "campo-a": "campo",
  "campo-b": "campo",
  "client-a": "cliente",
} as const;

const SOBEM = ["owner-a", "admin-a", "ops-a", "campo-a"] as const;
const NAO_SOBEM = ["wms-a", "support-a", "comercial-a", "campo-b", "client-a"] as const;
const LEEM = ["owner-a", "admin-a", "ops-a", "support-a", "campo-a"] as const;
const NAO_LEEM = ["wms-a", "comercial-a", "campo-b", "client-a"] as const;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ARQUIVO = "ft_0123456789abcdef.jpg";

async function semente(status: string) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, role] of Object.entries(PAPEIS)) {
      await setDoc(doc(database, "users", uid), { nome: uid, role, ...(role === "cliente" ? { customer_code: "ITAU" } : {}) });
    }
    await setDoc(doc(database, "service_orders", OS), { demanda: "10045", customer_code: "ITAU", status, equipe_uids: ["campo-a"], edicao: 1 });
  });
}

function storage(uid: string) {
  return testEnvironment.authenticatedContext(uid).storage();
}

function subir(uid: string, arquivo = ARQUIVO, conteudo: Uint8Array = JPEG, contentType = "image/jpeg", numero = OS) {
  return storage(uid).ref(`os/${numero}/fotos/${arquivo}`).put(conteudo, { contentType }).then((snapshot) => snapshot);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assinar(uid: string, arquivo: string, conteudo: Uint8Array = PNG, contentType = "image/png", numero = OS) {
  return storage(uid).ref(`os/${numero}/assinatura/${arquivo}`).put(conteudo, { contentType }).then((snapshot) => snapshot);
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
  await semente("agendada");
});

after(async () => {
  await testEnvironment?.cleanup();
});

describe("fotos da OS no Storage", () => {
  it("quem coordena e quem está escalado sobem; os outros papéis e quem não está na OS, não", async () => {
    for (const [indice, uid] of SOBEM.entries()) await assertSucceeds(subir(uid, `ft_${String(indice).repeat(16)}.jpg`));
    for (const uid of NAO_SOBEM) await assertFails(subir(uid, "ft_ffffffffffffffff.jpg"));
    await assertFails(testEnvironment.unauthenticatedContext().storage().ref(`os/${OS}/fotos/ft_eeeeeeeeeeeeeeee.jpg`).put(JPEG, { contentType: "image/jpeg" }).then((snapshot) => snapshot));
  });

  it("quem coordena, o suporte e quem está escalado leem; os outros, não", async () => {
    await assertSucceeds(subir("ops-a"));
    for (const uid of LEEM) await assertSucceeds(storage(uid).ref(`os/${OS}/fotos/${ARQUIVO}`).getMetadata());
    for (const uid of NAO_LEEM) await assertFails(storage(uid).ref(`os/${OS}/fotos/${ARQUIVO}`).getMetadata());
  });

  it("só na OS agendada ou em execução", async () => {
    await semente("em_execucao");
    await assertSucceeds(subir("campo-a", "ft_c000000000000003.jpg"));
    for (const status of ["aberta", "em_revisao", "revisada", "cancelada"]) {
      await semente(status);
      await assertFails(subir("ops-a", "ft_c000000000000001.jpg"));
      await assertFails(subir("campo-a", "ft_c000000000000002.jpg"));
    }
    await assertFails(subir("ops-a", "ft_c000000000000004.jpg", JPEG, "image/jpeg", "10045-09"));
  });

  it("nome, tipo e tamanho conferidos; nada se sobrescreve nem apaga", async () => {
    const QUARTO = "ft_4444444444444444.jpg";
    for (const [caso, tentativa] of [
      ["nome", () => subir("ops-a", "foto.jpg")],
      ["gif", () => subir("ops-a", "ft_0123456789abcdef.gif", JPEG, "image/gif")],
      ["pdf", () => subir("ops-a", QUARTO, JPEG, "application/pdf")],
      ["tamanho", () => subir("ops-a", QUARTO, new Uint8Array(8 * 1024 * 1024), "image/jpeg")],
    ] as const) {
      await assertFails(tentativa()).catch((error: unknown) => assert.fail(`${caso}: ${String(error)}`));
    }
    await assertSucceeds(subir("ops-a", QUARTO));
    await assertFails(subir("ops-a", QUARTO)).catch((error: unknown) => assert.fail(`sobrescrever: ${String(error)}`));
    await assertFails(storage("owner-a").ref(`os/${OS}/fotos/${QUARTO}`).delete()).catch((error: unknown) => assert.fail(`apagar: ${String(error)}`));
  });
});

describe("assinatura da OS no Storage", () => {
  beforeEach(async () => {
    await semente("em_execucao");
  });

  it("quem coordena e quem está escalado sobem; os outros papéis e quem não está na OS, não", async () => {
    for (const [indice, uid] of SOBEM.entries()) await assertSucceeds(assinar(uid, `as_a${String(indice).repeat(15)}.png`));
    for (const uid of NAO_SOBEM) await assertFails(assinar(uid, "as_afffffffffffffff.png"));
  });

  it("quem coordena, o suporte e quem está escalado leem; os outros, não", async () => {
    const ARQ = "as_b000000000000001.png";
    await assertSucceeds(assinar("campo-a", ARQ));
    for (const uid of LEEM) await assertSucceeds(storage(uid).ref(`os/${OS}/assinatura/${ARQ}`).getMetadata());
    for (const uid of NAO_LEEM) await assertFails(storage(uid).ref(`os/${OS}/assinatura/${ARQ}`).getMetadata());
  });

  it("só na OS em execução", async () => {
    for (const status of ["aberta", "agendada", "em_revisao", "revisada", "cancelada"]) {
      await semente(status);
      await assertFails(assinar("ops-a", "as_c000000000000001.png")).catch((error: unknown) => assert.fail(`${status}: ${String(error)}`));
      await assertFails(assinar("campo-a", "as_c000000000000002.png")).catch((error: unknown) => assert.fail(`${status}: ${String(error)}`));
    }
  });

  it("nome, tipo e tamanho conferidos; nada se sobrescreve nem apaga", async () => {
    const ARQ = "as_d000000000000001.png";
    for (const [caso, tentativa] of [
      ["nome da foto", () => assinar("ops-a", "ft_d000000000000002.png")],
      ["nome livre", () => assinar("ops-a", "assinatura.png")],
      ["svg", () => assinar("ops-a", "as_d000000000000003.png", PNG, "image/svg+xml")],
      ["tamanho", () => assinar("ops-a", "as_d000000000000004.png", new Uint8Array(8 * 1024 * 1024), "image/png")],
    ] as const) {
      await assertFails(tentativa()).catch((error: unknown) => assert.fail(`${caso}: ${String(error)}`));
    }
    await assertSucceeds(assinar("ops-a", ARQ));
    await assertFails(assinar("ops-a", ARQ)).catch((error: unknown) => assert.fail(`sobrescrever: ${String(error)}`));
    await assertFails(storage("owner-a").ref(`os/${OS}/assinatura/${ARQ}`).delete()).catch((error: unknown) => assert.fail(`apagar: ${String(error)}`));
  });
});
