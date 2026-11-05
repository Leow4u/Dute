import { describe, expect, it } from "vitest";
import type { WarehouseTask } from "../warehouse-ops/model";
import { montarCancelamento, opcoesDeRecebimentoOriginal, podeCancelarRecebimento } from "./cancelar-recebimento";

const task: WarehouseTask = {
  id: "receiving:inb_avulso_duplicado", reference: "inb_avulso_duplicado",
  customer: "CLIENTE-A", receipt_number: "AVL-DUPLICADO", invoice_number: "046143",
  source: "wms_unplanned_receipt", status: "created", quantity: 71,
};

describe("cancelamento da chegada antes da entrada", () => {
  it("aceita conferência e reserva de destino sem confundir quantidade contada com estoque", () => {
    expect(podeCancelarRecebimento({ ...task, received_at: "2026-11-04T18:00:00Z", items: [{ received_qty: 71 }] })).toBe(true);
    expect(podeCancelarRecebimento({ ...task, status: "checking" })).toBe(true);
    expect(podeCancelarRecebimento({ ...task, source: undefined })).toBe(true);
  });

  it.each(["received", "completed", "cancelled", "canceled", "unknown"])("não oferece cancelamento para %s", (status) => {
    expect(podeCancelarRecebimento({ ...task, status })).toBe(false);
  });

  it("não oferece cancelamento de uma chegada prevista ou com entrada registrada", () => {
    expect(podeCancelarRecebimento({ ...task, id: "receiving:inb_previsto", reference: "inb_previsto", source: "customer_request" })).toBe(false);
    expect(podeCancelarRecebimento({ ...task, items: [{ status: "received" }] })).toBe(false);
    expect(podeCancelarRecebimento({ ...task, source: "customer_request" })).toBe(false);
  });

  it("as originais são recebimentos do cliente ativo, incluindo já recebidos", () => {
    const original = { ...task, id: "receiving:inb_original", reference: "inb_original", receipt_number: "AVL-ORIGINAL", status: "received" };
    expect(opcoesDeRecebimentoOriginal(task, [task, original,
      { ...original, id: "receiving:outro_cliente", reference: "outro_cliente", customer: "CLIENTE-B" },
      { ...original, id: "receiving:cancelado", reference: "cancelado", status: "cancelled" },
      { ...original, id: "putaway:guarda", reference: "guarda" },
    ], "CLIENTE-A")).toEqual([original]);
  });

  it("monta motivo e original explícitos, omitindo observação vazia", () => {
    const payload = montarCancelamento({ task, customerCode: "CLIENTE-A", reason: "duplicate", originalId: "inb_original", note: "  ", key: "chave" });
    expect(payload).toEqual({ receipt_id: "inb_avulso_duplicado", customer_code: "CLIENTE-A", expected_status: "created", reason: "duplicate", duplicate_of_receipt_id: "inb_original", idempotency_key: "chave" });
    expect(payload).not.toHaveProperty("note");
  });

  it("exige original na duplicidade e observação em outro motivo", () => {
    expect(() => montarCancelamento({ task, customerCode: "CLIENTE-A", reason: "duplicate", originalId: "", note: "", key: "chave" })).toThrow("Selecione o recebimento original.");
    expect(() => montarCancelamento({ task, customerCode: "CLIENTE-A", reason: "other", originalId: "", note: "  ", key: "chave" })).toThrow("Informe o motivo na observação.");
  });

  it("omite original quando o motivo muda e mantém a observação limpa", () => {
    expect(montarCancelamento({ task, customerCode: "CLIENTE-A", reason: "mistake", originalId: "inb_original", note: "  Chegada incorreta.  ", key: "nova" })).toEqual({
      receipt_id: "inb_avulso_duplicado", customer_code: "CLIENTE-A", expected_status: "created", reason: "mistake", note: "Chegada incorreta.", idempotency_key: "nova",
    });
  });

  it("recusa cliente diferente, autorreferência e observação longa", () => {
    const input = { task, customerCode: "CLIENTE-A", reason: "duplicate" as const, originalId: "inb_original", note: "", key: "chave" };
    expect(() => montarCancelamento({ ...input, customerCode: "CLIENTE-B" })).toThrow("Recebimento de outro cliente.");
    expect(() => montarCancelamento({ ...input, originalId: "inb_avulso_duplicado" })).toThrow("Selecione o recebimento original.");
    expect(() => montarCancelamento({ ...input, note: "a".repeat(501) })).toThrow("Use até 500 caracteres na observação.");
  });
});
