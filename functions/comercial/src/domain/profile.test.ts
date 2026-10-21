import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Firestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { PLATFORM_ROLES } from "./platform-roles.js";
import { comercialStatusFor, getProfile, requireComercialCaller } from "./profile.js";

/** Banco que falha se for lido: prova que a recusa vem antes de qualquer leitura. */
const untouchedDb = new Proxy({} as Firestore, {
  get() {
    throw new Error("o banco não deveria ser lido");
  },
});

function request(uid?: string): CallableRequest<unknown> {
  return {
    data: {},
    rawRequest: {} as CallableRequest<unknown>["rawRequest"],
    acceptsStreaming: false,
    auth: uid ? ({ uid, token: { email: `${uid}@dutelog.com.br` } } as CallableRequest<unknown>["auth"]) : undefined,
  } as CallableRequest<unknown>;
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpsError, `esperava HttpsError, veio ${String(error)}`);
    return error;
  }
  assert.fail("deveria recusar");
}

describe("comercialStatus: o que o app recebe", () => {
  it("na homologação, owner, admin e comercial veem o Comercial; só o owner aprova", () => {
    assert.deepEqual(comercialStatusFor("dute-homolog", "owner"), { liberado: true, papel: "owner", pode_aprovar: true });
    assert.deepEqual(comercialStatusFor("dute-homolog", "admin"), { liberado: true, papel: "admin", pode_aprovar: false });
    assert.deepEqual(comercialStatusFor("dute-homolog", "comercial"), {
      liberado: true,
      papel: "comercial",
      pode_aprovar: false,
    });
  });

  it("na homologação, os outros 8 papéis não veem", () => {
    for (const role of PLATFORM_ROLES.filter((item) => !["owner", "admin", "comercial"].includes(item))) {
      assert.deepEqual(comercialStatusFor("dute-homolog", role), { liberado: false, papel: role, pode_aprovar: false }, role);
    }
  });

  it("na produção, os mesmos papéis da homologação", () => {
    assert.deepEqual(comercialStatusFor("dute-prod", "owner"), { liberado: true, papel: "owner", pode_aprovar: true });
    assert.deepEqual(comercialStatusFor("dute-prod", "comercial"), { liberado: true, papel: "comercial", pode_aprovar: false });
    assert.deepEqual(comercialStatusFor("dute-prod", "wms"), { liberado: false, papel: "wms", pode_aprovar: false });
  });

  it("fora da lista de liberação ninguém vê, nem o owner", () => {
    for (const projectId of ["dute-btg", ""]) {
      for (const role of PLATFORM_ROLES) {
        assert.deepEqual(comercialStatusFor(projectId, role), { liberado: false, papel: role, pode_aprovar: false }, `${projectId} ${role}`);
      }
    }
  });
});

describe("entrada das callables do Comercial", () => {
  it("fora da liberação recusa antes de ler o perfil", async () => {
    const error = await rejection(requireComercialCaller(untouchedDb, request("u1"), "dute-btg"));
    assert.equal(error.code, "failed-precondition");
  });

  it("sem login recusa com unauthenticated, sem ler o banco", async () => {
    const error = await rejection(getProfile(untouchedDb, request()));
    assert.equal(error.code, "unauthenticated");
    const viaCaller = await rejection(requireComercialCaller(untouchedDb, request(), "dute-homolog"));
    assert.equal(viaCaller.code, "unauthenticated");
  });
});
