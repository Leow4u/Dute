import { afterEach, describe, expect, it, vi } from "vitest";

const chamada = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => chamada }));
vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));

import { iniciarCaixa, pedidoFoiRejeitado } from "./caixas-do-recebimento";

it("preserva código e causa da callable para distinguir rejeição de resultado incerto", async () => {
  const causa = Object.assign(
    new Error("A caixa foi alterada. Atualize a tela."),
    { code: "functions/failed-precondition" },
  );
  chamada.mockRejectedValueOnce(causa);
  await expect(
    iniciarCaixa({ receipt_id: "inb_teste", idempotency_key: "tentativa-1" }),
  ).rejects.toMatchObject({
    message: "A caixa foi alterada. Atualize a tela.",
    code: "functions/failed-precondition",
    cause: causa,
  });
});

describe("tentativas rejeitadas pelo servidor", () => {
  it.each([
    "failed-precondition",
    "aborted",
    "invalid-argument",
    "permission-denied",
    "unauthenticated",
    "not-found",
    "already-exists",
    "out-of-range",
  ])("%s permite atualizar a tela antes de uma nova tentativa", (code) => {
    expect(pedidoFoiRejeitado({ code: `functions/${code}` })).toBe(true);
  });
  it.each([
    "unavailable",
    "deadline-exceeded",
    "unknown",
    "internal",
    "cancelled",
  ])("%s mantém a chave pois o resultado pode ser incerto", (code) => {
    expect(pedidoFoiRejeitado({ code: `functions/${code}` })).toBe(false);
  });
  it("erro sem código também mantém o pedido exato", () => {
    expect(pedidoFoiRejeitado(new Error("Falha de rede"))).toBe(false);
  });
});

/**
 * Sem rede (docs/plataforma/diagnostico-carregamento.md, seção 9, item 2) e
 * com o servidor sem resposta (carregamento v2, parte 7a): o texto diz qual,
 * pelo aparelho, e as duas continuam contando como resultado incerto.
 */
describe("a chamada sem resposta", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("com o aparelho conectado, diz que o servidor não respondeu, não \"Sem conexão\", e conta como resultado incerto", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    // O SDK do Firebase, quando o fetch nem chega a uma resposta (status 0).
    const causa = Object.assign(new Error("internal"), { code: "functions/internal" });
    chamada.mockRejectedValueOnce(causa);
    const falha = await iniciarCaixa({ receipt_id: "inb_teste", idempotency_key: "tentativa-1" }).catch((erro: unknown) => erro);
    expect(falha).toMatchObject({ message: "Sem resposta do servidor.", code: "functions/internal", cause: causa });
    // A chave da tentativa fica: o pedido pode ter chegado ao servidor.
    expect(pedidoFoiRejeitado(falha)).toBe(false);
  });

  it("com o aparelho sem rede, diz que faltou conexão e conta como resultado incerto", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const causa = Object.assign(new Error("Failed to fetch"), { code: "functions/internal" });
    chamada.mockRejectedValueOnce(causa);
    const falha = await iniciarCaixa({ receipt_id: "inb_teste", idempotency_key: "tentativa-1" }).catch((erro: unknown) => erro);
    expect(falha).toMatchObject({ message: "Sem conexão. Tente de novo quando o sinal voltar.", code: "functions/internal", cause: causa });
    expect(pedidoFoiRejeitado(falha)).toBe(false);
  });
});
