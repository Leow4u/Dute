import { describe, expect, it, vi } from "vitest";

const chamada = vi.hoisted(() => vi.fn(async (_dados: Record<string, unknown>) => ({ data: { ok: true, round_id: "cr_1", title: "Contagem geral · 19/11/2026", status: "open" } })));
const nome = vi.hoisted(() => ({ atual: "" }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, callable: string) => {
    nome.atual = callable;
    return chamada;
  },
}));
vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));

import { detalheDaRecusa } from "./erro-da-callable";
import { concluirContagem, iniciarContagem } from "./rodadas";

/**
 * As chamadas da rodada da contagem (`startCountRound` e `completeCountRound`).
 * Nenhum campo vazio vai: o SDK do Firebase manda o `undefined` como `null`,
 * e o servidor recusa `null` no campo só opcional (o defeito de 11 e
 * 12/11/2026 na separação).
 */

function enviado(): Record<string, unknown> {
  const dados = chamada.mock.lastCall?.[0];
  if (!dados) throw new Error("Nada foi enviado.");
  return dados;
}

describe("iniciarContagem", () => {
  it("chama a callable startCountRound com o alcance e a chave, sem campo vazio", async () => {
    const resposta = await iniciarContagem({ customer_code: "BTG Pactual", scope: "aisle", aisle: "A", idempotency_key: "rodada-0001" });
    expect(nome.atual).toBe("startCountRound");
    expect(enviado()).toEqual({ customer_code: "BTG Pactual", scope: "aisle", aisle: "A", idempotency_key: "rodada-0001" });
    expect(resposta.round_id).toBe("cr_1");
    await iniciarContagem({ customer_code: "BTG Pactual", scope: "general", idempotency_key: "rodada-0002" });
    expect(enviado()).toEqual({ customer_code: "BTG Pactual", scope: "general", idempotency_key: "rodada-0002" });
    expect(JSON.stringify(enviado())).not.toContain("null");
  });
});

describe("concluirContagem", () => {
  it("chama a callable completeCountRound com o cliente, a rodada e a chave", async () => {
    chamada.mockResolvedValueOnce({ data: { ok: true, round_id: "cr_1", title: "Contagem geral · 19/11/2026", status: "closed", shelves_total: 2, shelves_counted: 1 } });
    const resposta = await concluirContagem({ customer_code: "BTG Pactual", round_id: "cr_1", idempotency_key: "concluir-0001" });
    expect(nome.atual).toBe("completeCountRound");
    expect(enviado()).toEqual({ customer_code: "BTG Pactual", round_id: "cr_1", idempotency_key: "concluir-0001" });
    expect(resposta.status).toBe("closed");
    expect(resposta.shelves_counted).toBe(1);
  });

  it("a recusa leva o código da callable e o motivo do servidor", async () => {
    chamada.mockRejectedValueOnce(
      Object.assign(new Error("A contagem «Contagem geral · 19/11/2026» já foi concluída."), {
        code: "functions/failed-precondition",
        details: { code: "COUNT_ROUND_NOT_OPEN", round_id: "cr_1" },
      }),
    );
    const erro = await concluirContagem({ customer_code: "BTG Pactual", round_id: "cr_1", idempotency_key: "concluir-0002" }).catch((falha: unknown) => falha);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { code?: string }).code).toBe("failed-precondition");
    expect(detalheDaRecusa(erro)).toBe("COUNT_ROUND_NOT_OPEN");
    expect((erro as Error).message).toContain("já foi concluída");
  });
});
