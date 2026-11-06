import { describe, expect, it } from "vitest";

import { SEM_CONEXAO } from "./conexao";
import { erroDaResposta } from "./erro-da-resposta";
import { humanApiError } from "./permissions";

/**
 * O toast mostrava o JSON cru da resposta (docs/plataforma/diagnostico-carregamento.md,
 * seção 9, item 2): o `fetchJson` das telas guardava o corpo inteiro na
 * mensagem, e a Pedidos o passava ao `humanApiError`, que não o lia.
 */

describe("o erro da resposta", () => {
  it("leva a mensagem do servidor, o código e o status, não o corpo cru", () => {
    const erro = erroDaResposta(503, JSON.stringify({ message: SEM_CONEXAO, code: "sem_conexao" }));
    expect(erro.message).toBe(SEM_CONEXAO);
    expect(erro.code).toBe("sem_conexao");
    expect(erro.status).toBe(503);
  });

  it("aceita o corpo sem código, o `error` no lugar da mensagem e o texto puro", () => {
    expect(erroDaResposta(403, JSON.stringify({ message: "Ação permitida somente para a coordenação." })).message).toBe(
      "Ação permitida somente para a coordenação.",
    );
    expect(erroDaResposta(400, JSON.stringify({ error: "Informe o motivo." })).message).toBe("Informe o motivo.");
    expect(erroDaResposta(502, "Bad Gateway").message).toBe("Bad Gateway");
    expect(erroDaResposta(500, "").message).toBe("HTTP 500");
    expect(erroDaResposta(500, "{ quebrado").message).toBe("{ quebrado");
  });
});

describe("a mensagem do toast", () => {
  it("lê a mensagem do corpo que o fetchJson guardou no erro", () => {
    const corpo = JSON.stringify({ message: SEM_CONEXAO, code: "sem_conexao" });
    expect(humanApiError(new Error(corpo), "Tente novamente em instantes.")).toBe(SEM_CONEXAO);
    expect(humanApiError(new Error(JSON.stringify({ error: "Pedido já separado." })), "Tente de novo.")).toBe("Pedido já separado.");
  });

  it("sem mensagem no corpo, fica o texto padrão da tela, nunca o JSON", () => {
    expect(humanApiError(new Error(JSON.stringify({ code: "internal" })), "Tente novamente em instantes.")).toBe("Tente novamente em instantes.");
    expect(humanApiError(new Error("{ quebrado"), "Tente novamente em instantes.")).toBe("Tente novamente em instantes.");
  });

  it("continua lendo o ApiError e o texto puro como antes", () => {
    expect(humanApiError({ data: { message: "Sem permissão." } }, "Erro")).toBe("Sem permissão.");
    expect(humanApiError(new Error("HTTP 403 Forbidden: Sem permissão."), "Erro")).toBe("Sem permissão.");
    expect(humanApiError(new Error("HTTP 500"), "Erro")).toBe("Erro");
  });
});
