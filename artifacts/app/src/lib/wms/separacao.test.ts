import { describe, expect, it, vi } from "vitest";

const chamada = vi.hoisted(() => vi.fn(async (_dados: Record<string, unknown>) => ({ data: { ok: true } })));
vi.mock("firebase/functions", () => ({ httpsCallable: () => chamada }));
vi.mock("../firebase", () => ({ firebaseApp: {} }));
vi.mock("../firebase-functions", () => ({ functionsDoApp: () => ({}) }));

import { dividirLinha, fecharVolume, semCamposVazios, separarMenos } from "./separacao";

/**
 * O SDK do Firebase manda o campo `undefined` como `null` (@firebase/functions,
 * `encode`), e o servidor recusa `null` nos campos opcionais. Antes desta
 * correção, "Fechar volume" sem peso (sempre, no celular) e "Separar menos"
 * sem detalhe voltavam "Entrada inválida para a separação.".
 */

function enviado(): Record<string, unknown> {
  const dados = chamada.mock.lastCall?.[0];
  if (!dados) throw new Error("Nada foi enviado.");
  return dados;
}

describe("o campo sem valor não vai para o servidor", () => {
  it("Fechar volume sem peso não manda weight_kg", async () => {
    await fecharVolume({ pick_task_id: "pick_1", volume_id: "v1", weight_kg: undefined, idempotency_key: "fechar-0001" });
    expect("weight_kg" in enviado()).toBe(false);
    expect(enviado()).toEqual({ pick_task_id: "pick_1", volume_id: "v1", idempotency_key: "fechar-0001" });
  });

  it("Fechar volume com peso manda o peso", async () => {
    await fecharVolume({ pick_task_id: "pick_1", volume_id: "v1", weight_kg: 10.8, idempotency_key: "fechar-0002" });
    expect(enviado().weight_kg).toBe(10.8);
  });

  it("Separar menos sem detalhe não manda shortage_detail", async () => {
    await separarMenos({ pick_task_id: "pick_1", pick_line_id: "pli_1", separated_qty: 1, shortage_reason: "falta", shortage_detail: "  ", idempotency_key: "menos-0001" });
    expect("shortage_detail" in enviado()).toBe(false);
    expect(enviado()).toMatchObject({ separated_qty: 1, shortage_reason: "falta", separated: true });
  });

  it("a parte da divisão sem peso não manda weight_kg, e o volume aberto que não existe vai como null", async () => {
    await dividirLinha({
      pick_task_id: "pick_1",
      pick_line_id: "pli_1",
      idempotency_key: "dividir-0001",
      split_volumes: [
        { number: 16, qty: 54, weight_kg: undefined },
        { number: 17, qty: 41 },
      ],
      open_volume_id: null,
      open_volume_units: 0,
      line_separated_at: null,
    });
    const partes = enviado().split_volumes as Array<Record<string, unknown>>;
    expect(partes.map((parte) => "weight_kg" in parte)).toEqual([false, false]);
    expect(enviado()).toMatchObject({ open_volume_id: null, open_volume_units: 0, line_separated_at: null, separated: true });
  });
});

describe("semCamposVazios", () => {
  it("tira só o undefined, em qualquer nível; null, 0, texto vazio e false ficam", () => {
    expect(semCamposVazios({ a: undefined, b: null, c: 0, d: "", e: false, f: [{ g: undefined, h: 1 }], i: { j: undefined } })).toEqual({
      b: null,
      c: 0,
      d: "",
      e: false,
      f: [{ h: 1 }],
      i: {},
    });
    expect(Object.keys(semCamposVazios({ a: undefined, b: 1 }))).toEqual(["b"]);
  });
});
