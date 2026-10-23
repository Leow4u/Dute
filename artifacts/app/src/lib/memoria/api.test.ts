import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CALLABLES_DO_NUCLEO } from "./api";

describe("as callables do núcleo", () => {
  it("a lista do app é a das exportadas por functions/core", () => {
    const index = readFileSync(new URL("../../../../../functions/core/src/index.ts", import.meta.url), "utf8");
    const exportadas = [...index.matchAll(/^export const (\w+) = onCall\(/gm)].map(([, nome]) => nome);
    expect([...CALLABLES_DO_NUCLEO].sort()).toEqual(exportadas.sort());
  });
});
