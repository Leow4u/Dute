import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./model";

describe("mensagem de erro das Functions", () => {
  it("mostra só a mensagem quando o corpo do erro vem em JSON", () => {
    const body = JSON.stringify({
      message: "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
      code: "unavailable",
    });
    expect(getErrorMessage(new Error(body))).toBe(
      "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
    );
  });

  it("mantém o texto quando o erro não é JSON", () => {
    expect(getErrorMessage(new Error("HTTP 500"))).toBe("HTTP 500");
    expect(getErrorMessage("falhou")).toBe("Erro inesperado");
  });
});
