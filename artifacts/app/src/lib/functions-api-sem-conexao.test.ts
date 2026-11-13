import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chamar } = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("./firebase", () => ({ firebaseApp: {} }));
vi.mock("./firebase-functions", () => ({ functionsDoApp: () => ({}) }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => chamar }));

import { CODIGO_SEM_CONEXAO, CODIGO_SEM_RESPOSTA, SEM_CONEXAO, SEM_RESPOSTA } from "./conexao";
import { callFunctionsApi } from "./functions-api";

/**
 * A ação sem rede (docs/plataforma/diagnostico-carregamento.md, seção 9,
 * item 2, e decisão 1 do celular): é recusada na hora com "Sem conexão", e a
 * chamada que não teve resposta não diz "Falha interna no servidor". Com o
 * aparelho conectado, a chamada sem resposta é o servidor sem resposta, não
 * "Sem conexão" (carregamento v2, parte 7a).
 */

const APROVAR = "/api/customer-requests/req-1/approve";
const corpo = { body: JSON.stringify({ expected_status: "pending", idempotency_key: "req-1:approve:pending" }) };

beforeEach(() => {
  chamar.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => vi.unstubAllGlobals());

describe("a ação sem rede", () => {
  it("com o aparelho sem rede, é recusada sem sair", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const response = await callFunctionsApi(APROVAR, "POST", corpo);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("com o aparelho conectado, a chamada que não teve resposta é o servidor sem resposta, não \"Sem conexão\"", async () => {
    // O SDK do Firebase, quando o fetch nem chega a uma resposta (status 0).
    chamar.mockRejectedValue(Object.assign(new Error("internal"), { code: "functions/internal" }));
    const response = await callFunctionsApi(APROVAR, "POST", corpo);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ message: SEM_RESPOSTA, code: CODIGO_SEM_RESPOSTA });
  });

  it("a rede que cai enquanto a chamada estava fora é \"Sem conexão\"", async () => {
    chamar.mockImplementation(async () => {
      vi.stubGlobal("navigator", { onLine: false });
      throw Object.assign(new Error("internal"), { code: "functions/internal" });
    });
    const response = await callFunctionsApi(APROVAR, "POST", corpo);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("a falha do servidor continua sendo do servidor", async () => {
    chamar.mockRejectedValue(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }));
    const response = await callFunctionsApi(APROVAR, "POST", corpo);
    expect(response?.status).toBe(500);
    expect(await response?.json()).toEqual({
      message: "Falha interna no servidor. Tente novamente ou avise o time técnico.",
      code: "internal",
    });
  });

  it("a recusa do servidor passa com a mensagem dele", async () => {
    chamar.mockRejectedValue(Object.assign(new Error("A solicitação mudou em outra tela."), { code: "functions/aborted" }));
    const response = await callFunctionsApi(APROVAR, "POST", corpo);
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ message: "A solicitação mudou em outra tela.", code: "aborted" });
  });
});
