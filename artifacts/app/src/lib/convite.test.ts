import { describe, expect, it } from "vitest";

import { referenciaDoConvite } from "./convite";

describe("a referência do convite nos eventos", () => {
  it("é a mesma conta do servidor e não leva o token", async () => {
    // O mesmo token e a mesma referência de functions/wms/src/convites.integration.test.ts.
    const token = "3f9c2a7be1d04c58a6f1e2d3c4b5a69788aa";
    const referencia = await referenciaDoConvite(token);
    expect(referencia).toBe("convite_c626df7ef6491777");
    expect(referencia).not.toContain(token.slice(0, 16));
  });
});
