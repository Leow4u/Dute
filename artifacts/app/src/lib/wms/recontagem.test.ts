import { describe, expect, it, vi } from "vitest";

const chamada = vi.hoisted(() => vi.fn(async (_dados: Record<string, unknown>) => ({ data: { ok: true, box_recount_id: "brc_1", box_code: "CX-000012", location_id: "A-03" } })));
const nome = vi.hoisted(() => ({ atual: "" }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, callable: string) => {
    nome.atual = callable;
    return chamada;
  },
}));
vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));

import { detalheDaRecusa, recontarCaixa } from "./recontagem";

/**
 * A chamada da recontagem por caixa (`recountWarehouseBox`). O SDK do
 * Firebase manda o campo `undefined` como `null` (@firebase/functions,
 * `encode`), e o servidor recusa `null` no campo só opcional: o defeito de
 * 11 e 12/11/2026 na separação. Nenhum campo vazio vai, em nível nenhum.
 */

function enviado(): Record<string, unknown> {
  const dados = chamada.mock.lastCall?.[0];
  if (!dados) throw new Error("Nada foi enviado.");
  return dados;
}

describe("recontarCaixa", () => {
  it("chama a callable recountWarehouseBox com a caixa, a lista contada, a rodada e a chave", async () => {
    await recontarCaixa({
      customer_code: "BTG Pactual",
      box_code: "CX-000012",
      location_id: "A-03",
      lines: [{ sku_code: "BTG-000123", counted_qty: 48 }],
      extra_lines: [{ sku_code: "BTG-000125", counted_qty: 2 }],
      round_id: "recontagem-2026-11-17",
      idempotency_key: "recontar-0001",
    });
    expect(nome.atual).toBe("recountWarehouseBox");
    expect(enviado()).toEqual({
      customer_code: "BTG Pactual",
      box_code: "CX-000012",
      location_id: "A-03",
      lines: [{ sku_code: "BTG-000123", counted_qty: 48 }],
      extra_lines: [{ sku_code: "BTG-000125", counted_qty: 2 }],
      round_id: "recontagem-2026-11-17",
      idempotency_key: "recontar-0001",
    });
  });

  it("o campo sem valor não vai para o servidor", async () => {
    await recontarCaixa({
      customer_code: "BTG Pactual",
      box_code: "CX-000012",
      location_id: "A-03",
      lines: [{ sku_code: "BTG-000123", counted_qty: 0 }],
      extra_lines: undefined,
      round_id: "recontagem-2026-11-17",
      idempotency_key: "recontar-0002",
    });
    expect("extra_lines" in enviado()).toBe(false);
    expect(JSON.stringify(enviado())).not.toContain("null");
  });

  it("a recusa leva o código da callable e o motivo do servidor", async () => {
    chamada.mockRejectedValueOnce(
      Object.assign(new Error("O item BTG-000123 não está mais na lista da caixa CX-000012 (outra contagem ou a separação mudou a caixa): atualize a tela e conte de novo."), {
        code: "functions/failed-precondition",
        details: { code: "BOX_RECOUNT_LIST_CHANGED", sku_code: "BTG-000123" },
      }),
    );
    const erro = await recontarCaixa({
      customer_code: "BTG Pactual",
      box_code: "CX-000012",
      location_id: "A-03",
      lines: [{ sku_code: "BTG-000123", counted_qty: 48 }],
      round_id: "recontagem-2026-11-17",
      idempotency_key: "recontar-0003",
    }).catch((falha: unknown) => falha);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { code?: string }).code).toBe("failed-precondition");
    expect(detalheDaRecusa(erro)).toBe("BOX_RECOUNT_LIST_CHANGED");
    expect((erro as Error).message).toContain("não está mais na lista da caixa CX-000012");
  });
});
