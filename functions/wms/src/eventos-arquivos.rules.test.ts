import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

/**
 * Os arquivos da edição do evento no Storage
 * (docs/superpowers/specs/2026-11-26-eventos-design.md, "Fotos e documentos"):
 * as fotos e os documentos da Dutelog sobem por quem opera o armazém e abrem
 * para a equipe interna e o cliente dono, com a armazenagem no contrato; os
 * documentos com valor (`valores/`) só sobem e abrem para quem lê valores, e
 * o cliente dono os lê; o anexo do portal sobe pelo cliente com a armazenagem,
 * no caminho do próprio código. Nada se sobrescreve nem se apaga pelo
 * navegador: o arquivo só vale na edição depois da callable que o confere.
 */

const PROJECT_ID = "demo-dute-operations";
const EDICAO = "ced_0123456789abcdef";
const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

/** Quem opera o armazém (canWritePhotos): sobe as fotos e os documentos da Dutelog. */
const OPERAM = ["owner-a", "admin-a", "ops-a", "wms-a"];
/** A equipe interna (isInternal): lê as fotos, os documentos e o anexo do portal. */
const EQUIPE_INTERNA = ["owner-a", "admin-a", "ops-a", "wms-a", "financeiro-a", "support-a"];
/** Quem lê valores (canReadPrices do firestore.rules). */
const LEEM_VALORES = ["owner-a", "admin-a", "comercial-a", "financeiro-a"];

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const [uid, perfil] of Object.entries(PAPEIS)) await setDoc(doc(database, "users", uid), { nome: uid, ...perfil });
    // O Itaú tem a armazenagem no contrato; a Safra só a Operação; a BTG fica sem client_access (vale o padrão, com a armazenagem).
    await setDoc(doc(database, "client_access", "ITAU"), { customer_code: "ITAU", modules: ["wms", "financeiro"] });
    await setDoc(doc(database, "client_access", "SAFRA"), { customer_code: "SAFRA", modules: ["operacao"] });
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

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/**
 * Um nome de arquivo do padrão (prefixo, 16 hex e a extensão), único por caso
 * e por posição: o emulador do Storage não limpa o bucket entre os testes.
 */
function nome(prefixo: "ft" | "dc" | "an", caso: number, n: number, extensao: string) {
  return `${prefixo}_${String(caso).padStart(2, "0")}${String(n).padStart(14, "0")}.${extensao}`;
}

const foto = (codigo: string, arquivo: string, edicao = EDICAO) => `eventos/${codigo}/${edicao}/fotos/${arquivo}`;
const documento = (codigo: string, arquivo: string, edicao = EDICAO) => `eventos/${codigo}/${edicao}/docs/${arquivo}`;
const valores = (codigo: string, arquivo: string, edicao = EDICAO) => `eventos/${codigo}/${edicao}/valores/${arquivo}`;
const anexo = (codigo: string, arquivo: string, edicao = EDICAO) => `portal/${codigo}/eventos/${edicao}/${arquivo}`;

function storage(uid: string) {
  return testEnvironment.authenticatedContext(uid).storage();
}

function subir(uid: string | null, caminho: string, conteudo: Uint8Array, contentType: string) {
  const contexto = uid ? storage(uid) : testEnvironment.unauthenticatedContext().storage();
  return contexto.ref(caminho).put(conteudo, { contentType }).then((snapshot) => snapshot);
}

function ler(uid: string, caminho: string) {
  return storage(uid).ref(caminho).getMetadata();
}

describe("os arquivos da edição do evento no Storage", () => {
  it("1. fotos e documentos da Dutelog: quem opera (owner, admin, interno, wms) sobe; financeiro, suporte, comercial, campo, o cliente e quem não logou não", async () => {
    let n = 0;
    for (const uid of OPERAM) {
      n += 1;
      await assertSucceeds(subir(uid, foto("ITAU", nome("ft", 1, n, "jpg")), JPEG, "image/jpeg"));
      await assertSucceeds(subir(uid, documento("ITAU", nome("dc", 1, n, "pdf")), PDF, "application/pdf"));
    }
    for (const uid of ["financeiro-a", "support-a", "comercial-a", "campo-a", "client-itau", null]) {
      n += 1;
      await assertFails(subir(uid, foto("ITAU", nome("ft", 1, n, "jpg")), JPEG, "image/jpeg"));
      await assertFails(subir(uid, documento("ITAU", nome("dc", 1, n, "pdf")), PDF, "application/pdf"));
    }
  });

  it("2. fotos e documentos: a equipe interna (owner, admin, interno, wms, financeiro, suporte) e o próprio cliente leem; o outro cliente, o comercial e o campo não", async () => {
    const daFoto = foto("ITAU", nome("ft", 2, 1, "jpg"));
    const doDocumento = documento("ITAU", nome("dc", 2, 1, "xlsx"));
    await assertSucceeds(subir("ops-a", daFoto, JPEG, "image/jpeg"));
    await assertSucceeds(subir("wms-a", doDocumento, XLSX, PLANILHA));
    for (const uid of [...EQUIPE_INTERNA, "client-itau"]) {
      await assertSucceeds(ler(uid, daFoto));
      await assertSucceeds(ler(uid, doDocumento));
    }
    for (const uid of ["client-safra", "client-btg", "comercial-a", "campo-a"]) {
      await assertFails(ler(uid, daFoto));
      await assertFails(ler(uid, doDocumento));
    }
  });

  it("3. valores: owner, admin, comercial e financeiro sobem e leem; o próprio cliente lê; wms, interno, suporte e o outro cliente não sobem nem leem", async () => {
    let n = 0;
    for (const uid of LEEM_VALORES) {
      n += 1;
      await assertSucceeds(subir(uid, valores("ITAU", nome("dc", 3, n, "pdf")), PDF, "application/pdf"));
    }
    for (const uid of ["wms-a", "ops-a", "support-a", "campo-a", "client-itau", "client-btg", "client-safra"]) {
      n += 1;
      await assertFails(subir(uid, valores("ITAU", nome("dc", 3, n, "pdf")), PDF, "application/pdf"));
    }
    const daProposta = valores("ITAU", nome("dc", 3, 1, "pdf"));
    for (const uid of [...LEEM_VALORES, "client-itau"]) await assertSucceeds(ler(uid, daProposta));
    for (const uid of ["wms-a", "ops-a", "support-a", "campo-a", "client-btg", "client-safra"]) await assertFails(ler(uid, daProposta));
  });

  it("4. o anexo do portal: o cliente com armazenagem sobe no próprio código (o sem client_access também); o sem armazenagem, o outro código e a equipe não; a equipe interna e o próprio cliente leem", async () => {
    const doItau = anexo("ITAU", nome("an", 4, 1, "pdf"));
    await assertSucceeds(subir("client-itau", doItau, PDF, "application/pdf"));
    await assertSucceeds(subir("client-btg", anexo("BTG", nome("an", 4, 2, "pdf")), PDF, "application/pdf"));
    await assertFails(subir("client-safra", anexo("SAFRA", nome("an", 4, 3, "pdf")), PDF, "application/pdf"));
    await assertFails(subir("client-itau", anexo("SAFRA", nome("an", 4, 4, "pdf")), PDF, "application/pdf"));
    let n = 4;
    for (const uid of ["owner-a", "ops-a", "wms-a", null]) {
      n += 1;
      await assertFails(subir(uid, anexo("ITAU", nome("an", 4, n, "pdf")), PDF, "application/pdf"));
    }
    for (const uid of [...EQUIPE_INTERNA, "client-itau"]) await assertSucceeds(ler(uid, doItau));
    for (const uid of ["client-safra", "client-btg", "comercial-a", "campo-a"]) await assertFails(ler(uid, doItau));
  });
});
