import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CALLABLES_DO_CADASTRO, mensagemDoErro } from "./api";

const here = dirname(fileURLToPath(import.meta.url));
const indexDoComercial = readFileSync(resolve(here, "../../../../../functions/comercial/src/index.ts"), "utf8");

describe("callables do cadastro comercial", () => {
  it.each(CALLABLES_DO_CADASTRO)("%s existe em functions/comercial", (nome) => {
    expect(indexDoComercial).toMatch(new RegExp(`^export const ${nome} = onCall\\(`, "m"));
  });

  it("a mensagem do servidor passa; internal vira aviso genérico", () => {
    expect(mensagemDoErro(Object.assign(new Error("O cadastro X já é cliente."), { code: "functions/failed-precondition" }))).toBe(
      "O cadastro X já é cliente.",
    );
    expect(mensagemDoErro(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }))).toMatch(/Falha interna/);
    expect(mensagemDoErro("x")).toMatch(/Falha interna/);
  });
});
