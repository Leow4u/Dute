import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { assertAuth } from "./profile.js";

describe("login de quem chama o Financeiro", () => {
  it("sem login é unauthenticated", () => {
    assert.throws(
      () => assertAuth({ data: {} } as CallableRequest<unknown>),
      (error: unknown) => error instanceof HttpsError && error.code === "unauthenticated",
    );
  });
});
