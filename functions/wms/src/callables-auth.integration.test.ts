import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getFirestore } from "firebase-admin/firestore";

import { CLIENT_ACCESS_COLLECTION } from "./domain/customer-profile.js";
import { PLATFORM_ROLES, WMS_ROLES } from "./domain/platform-roles.js";

/**
 * A porta das callables do WMS: toda callable passa por getProfile antes de
 * qualquer outra coisa (login, perfil ativo, papel que o WMS atende e, para o
 * cliente, a armazenagem no contrato). As outras codebases travam a porta no
 * código, no callables.test.ts de cada uma; no WMS a trava é pelo
 * comportamento, com as callables de verdade pelo `.run`, no emulador. Uma
 * callable nova que pule a porta, ou que leia a entrada antes dela, reprova
 * aqui.
 */

const PROJECT_ID = "demo-dute-operations";

type Callable = {
  run: (request: never) => Promise<unknown>;
  __endpoint?: { callableTrigger?: unknown };
};

/** As que respondem sem login. lookupInvite: o token do convite é a credencial. */
const PUBLICAS = ["lookupInvite"];

/** Os papéis da plataforma que o WMS não atende: um papel novo entra sozinho. */
const FORA_DO_WMS = PLATFORM_ROLES.filter((role) => !(WMS_ROLES as readonly string[]).includes(role));

const SEM_ACESSO = "Seu perfil ainda não tem acesso a esta ação.";

const CASOS: Array<{ caso: string; uid: string | null; code: string; message: string }> = [
  { caso: "sem login", uid: null, code: "unauthenticated", message: "Faça login para continuar." },
  { caso: "sem perfil", uid: "sem-perfil", code: "permission-denied", message: "Usuário sem perfil ativo." },
  { caso: "acesso removido", uid: "desligado", code: "permission-denied", message: "Acesso removido." },
  { caso: "papel que não existe", uid: "papel-estranho", code: "permission-denied", message: "Perfil sem papel válido." },
  ...FORA_DO_WMS.map((role) => ({ caso: `papel ${role}`, uid: role, code: "permission-denied", message: SEM_ACESSO })),
  {
    caso: "cliente sem armazenagem no contrato",
    uid: "cliente-operacao",
    code: "permission-denied",
    message: "O contrato do seu cliente não inclui armazenagem.",
  },
];

const CLIENTE_SO_OPERACAO = "Cliente da Operação";

let callables: Map<string, Callable>;

/** As exportações do index.ts que são callables, pelo endpoint que o onCall declara. */
function callablesDe(module: Record<string, unknown>): Map<string, Callable> {
  const found = new Map<string, Callable>();
  for (const [name, value] of Object.entries(module)) {
    const candidate = value as Callable;
    if (typeof value === "function" && typeof candidate.run === "function" && candidate.__endpoint?.callableTrigger) {
      found.set(name, candidate);
    }
  }
  return found;
}

/** O nome de cada `export const x = onCall` do index.ts, como a conferência do invoker lê. */
function callablesDoCodigo(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
  return [...source.matchAll(/^export const (\w+) = onCall\b/gm)].map((match) => match[1]);
}

async function recusa(callable: Callable, uid: string | null) {
  try {
    await callable.run({
      auth: uid ? { uid, token: { email: `${uid}@dutelog.com.br` } } : undefined,
      data: {},
      rawRequest: { headers: {} },
    } as never);
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { code, message };
  }
  return { code: "aceitou", message: "" };
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  callables = callablesDe(await import("./index.js"));
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  const users = db.collection("users");
  await users.doc("desligado").set({ role: "interno", nome: "Desligado", access_disabled: true });
  await users.doc("papel-estranho").set({ role: "gerente", nome: "Papel estranho" });
  for (const role of FORA_DO_WMS) await users.doc(role).set({ role, nome: role });
  await users.doc("cliente-operacao").set({ role: "cliente", nome: "Cliente", customer_code: CLIENTE_SO_OPERACAO });
  await db.collection(CLIENT_ACCESS_COLLECTION).doc(CLIENTE_SO_OPERACAO).set({ customer_code: CLIENTE_SO_OPERACAO, modules: ["operacao"] });
});

describe("a porta das callables do WMS", () => {
  it("acha todas as callables do index.ts", () => {
    assert.deepEqual([...callables.keys()].sort(), callablesDoCodigo().sort());
    assert.ok(callables.size > 80, `só ${callables.size} callables`);
  });

  it("os papéis fora do WMS existem para a varredura", () => {
    assert.deepEqual([...FORA_DO_WMS].sort(), ["campo", "comercial", "painel", "rh"]);
  });

  for (const { caso, uid, code, message } of CASOS) {
    it(`recusa ${caso} em toda callable, na porta`, async () => {
      const erradas: string[] = [];
      for (const [name, callable] of callables) {
        if (PUBLICAS.includes(name)) continue;
        const got = await recusa(callable, uid);
        if (got.code !== code || got.message !== message) erradas.push(`${name}: ${String(got.code)} ${String(got.message)}`);
      }
      assert.deepEqual(erradas, []);
    });
  }

  it("lookupInvite responde sem login, só com o token", async () => {
    const lookupInvite = callables.get("lookupInvite");
    assert.ok(lookupInvite);
    await assert.rejects(
      lookupInvite.run({ auth: undefined, data: { token: "convite-que-nao-existe" }, rawRequest: { headers: {} } } as never),
      { code: "not-found", message: "Convite inválido ou não encontrado." },
    );
  });
});
