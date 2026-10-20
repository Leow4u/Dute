import { describe, expect, it } from "vitest";
import { conferenceAttempt, conferenceCanEditLine, conferenceSkus, conferenceStatusLabel, isConferencePending, isConferenceRevisionConflict, type OpeningConferenceLine } from "./opening-conference";
import { formatBoxPlacement, occupiedPositions, warehouseBoxFromRecord } from "./warehouse-boxes";

const line = (status: OpeningConferenceLine["status"], extra: Partial<OpeningConferenceLine> = {}): OpeningConferenceLine => ({
  id: "linha-1", status, counted_qty: 3, unit_cost: 10, ...extra,
});

describe("estados da abertura por caixa", () => {
  it("uma caixa em conferência não ocupa posição nem parece guardada", () => {
    const box = warehouseBoxFromRecord({ code: "CX-000001", status: "counting", draft_line_count: 2, draft_unit_count: 7, conference_revision: 4, location_id: "" });
    expect(box.draft_unit_count).toBe(7);
    expect(box.conference_revision).toBe(4);
    expect(box.unit_count).toBe(0);
    expect(occupiedPositions([box])).toBe(0);
    expect(conferenceStatusLabel(box)).toBe("Em conferência");
    expect(isConferencePending(box)).toBe(true);
  });
  it.each(["counting", "reviewed", "committing"])("%s impede encerrar inventário", (status) => {
    expect(isConferencePending({ status })).toBe(true);
  });
  it("na recuperação, só pendentes e falhas podem ser corrigidas", () => {
    for (const status of ["pending", "failed"] as const) expect(conferenceCanEditLine({ status: "committing" }, line(status))).toBe(true);
    for (const status of ["processing", "committed"] as const) expect(conferenceCanEditLine({ status: "committing" }, line(status))).toBe(false);
    expect(conferenceCanEditLine({ status: "reviewed" }, line("pending"))).toBe(false);
    expect(conferenceCanEditLine({ status: "stored" }, line("committed"))).toBe(false);
  });
  it("sugere com SKUs reais dos tamanhos conferidos, sem inventar família pelo código", () => {
    expect(conferenceSkus([
      line("pending", { sku_code: "SKU-G" }), line("pending", { client_item_code: "camisa-m" }),
      line("pending", { client_item_code: "NOVA-PP" }), line("pending", { sku_code: "SKU-G" }),
    ], [{ clientCode: "CAMISA-M", skuCode: "SKU-M" }])).toEqual(["SKU-G", "SKU-M"]);
  });
  it("repetir a mesma operação após perda de resposta não gera outra chave", () => {
    const body = { box_code: "CX-000001", expected_revision: 3, counted_qty: 2, occurred_at: "antes" };
    const attempt = conferenceAttempt(undefined, "save", body, () => "chave-1");
    const retried = conferenceAttempt(attempt, "save", { ...body, expected_revision: 4, occurred_at: "depois" }, () => "chave-2");
    expect(retried).toBe(attempt);
    expect({ ...retried.payload, idempotency_key: retried.key }).toEqual({
      box_code: "CX-000001", expected_revision: 3, counted_qty: 2, occurred_at: "antes", idempotency_key: "chave-1",
    });
    expect(conferenceAttempt(attempt, "save", { ...body, counted_qty: 5 }, () => "chave-2").key).toBe("chave-2");
    expect(conferenceAttempt(attempt, "remove", body, () => "chave-3").key).toBe("chave-3");
  });
  it("outra caixa nunca reaproveita tentativa de estado ou guarda", () => {
    const first = conferenceAttempt(undefined, "review", { box_code: "CX-000001", expected_revision: 4, action: "review" }, () => "primeira");
    const second = conferenceAttempt(first, "review", { box_code: "CX-000002", expected_revision: 4, action: "review" }, () => "segunda");
    expect(second.key).toBe("segunda");
    expect(second.payload.box_code).toBe("CX-000002");
  });
  it("somente revisão rejeitada permite iniciar outro corpo; rede mantém tentativa", () => {
    expect(isConferenceRevisionConflict("A caixa mudou em outra tela. Atualize antes de continuar.")).toBe(true);
    expect(isConferenceRevisionConflict("Tempo limite excedido")).toBe(false);
    expect(isConferenceRevisionConflict("Failed to fetch")).toBe(false);
  });
  it("mostra a orientação efetiva sem alterar as medidas originais", () => {
    const box = warehouseBoxFromRecord({ code: "CX-1", length_m: 0.6, width_m: 0.35, height_m: 0.5,
      front_m: 0.35, depth_m: 0.5, placed_height_m: 0.6, orientation: "width_height_length", allow_tilt: true });
    expect(box.length_m).toBe(0.6);
    expect(box.placed_height_m).toBe(0.6);
    expect(box.allow_tilt).toBe(true);
    expect(formatBoxPlacement({ front_m: 0.35, depth_m: 0.5, height_m: 0.6, orientation: "width_height_length" })).toBe("Frente 35 × profundidade 50 × altura 60 cm");
  });
});
