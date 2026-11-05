import { describe, expect, it, vi } from "vitest";

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
