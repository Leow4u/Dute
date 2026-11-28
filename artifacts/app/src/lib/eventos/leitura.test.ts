import { describe, expect, it } from "vitest";

import { edicaoDaLeitura, eventoDaLeitura, precoDaLeitura } from "./leitura";

/**
 * A leitura das três coleções pelo portal (as regras do Firestore, ao vivo):
 * o mesmo contrato de viewDaEdicao (functions/wms/src/domain/eventos/edicao.ts),
 * com os carimbos em ISO, o ausente em null e as listas sempre listas.
 */

const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

describe("a leitura das edições, dos eventos e dos preços", () => {
  it("edicaoDaLeitura converte Timestamp em ISO, listas ausentes em [], a hora ausente ou vazia do previsto em null e recusa sem status; eventoDaLeitura recusa sem name", () => {
    const lida = edicaoDaLeitura("ced_0123456789abcdef", {
      customer_code: "BTG",
      event_id: "cve_0123456789abcdef",
      event_name: "B2B Conference Necton",
      label: "2027",
      status: "rascunho",
      edicao: 4,
      onde: { local: "Hotel Unique" },
      cronograma: [
        { id: "mo_00000001", tipo: "montagem", previsto: { data: "2027-01-28", hora: "", ate: "19:00" } },
        { id: "mo_00000002", tipo: "evento", previsto: { data: "2027-01-29" }, feito: { inicio: timestamp("2027-01-29T11:00:00.000Z"), origem: "registro" } },
      ],
      itens: [{ sku_code: "BTG-000001", product_name: "Polo", quantity: 2 }],
      coleta: { quantidade: 2190 },
      updated_at: timestamp("2026-11-27T17:32:00.000Z"),
      created_at: new Date("2026-11-27T17:00:00.000Z"),
    });
    expect(lida).not.toBeNull();
    expect(lida).toMatchObject({
      id: "ced_0123456789abcdef",
      status: "rascunho",
      edicao: 4,
      onde: { local: "Hotel Unique", endereco: null, contato: { nome: null, telefone: null } },
      coleta: { onde: null, quantidade: 2190, voltou: null, distribuidos: null },
      documentos: [],
      fotos: [],
      pedido: null,
      retorno: null,
      updated_at: "2026-11-27T17:32:00.000Z",
      created_at: "2026-11-27T17:00:00.000Z",
    });
    expect(lida!.cronograma[0].previsto).toEqual({ data: "2027-01-28", hora: null, ate: "19:00", local: null, observacao: null });
    expect(lida!.cronograma[1].previsto.hora).toBeNull();
    expect(lida!.cronograma[1].feito).toMatchObject({ inicio: "2027-01-29T11:00:00.000Z", fim: null, origem: "registro" });
    expect(lida!.itens[0]).toEqual({
      sku_code: "BTG-000001",
      client_item_code: null,
      product_name: "Polo",
      size: null,
      category: null,
      quantity: 2,
      foi: null,
      voltou: null,
      avariadas: null,
      nao_voltaram: null,
      observacao: null,
    });
    expect(lida!.itens_total).toBe(0);
    expect(edicaoDaLeitura("ced_1", { customer_code: "BTG", event_name: "Sem status" })).toBeNull();
    expect(edicaoDaLeitura("ced_1", { customer_code: "BTG", status: "aprovado" })).toBeNull();

    expect(eventoDaLeitura("cve_1", { customer_code: "BTG", status: "active" })).toBeNull();
    expect(eventoDaLeitura("cve_1", { customer_code: "BTG", name: "Feira", status: "active", editions_count: 2, last_edition_id: "ced_1" })).toEqual({
      id: "cve_1",
      customer_code: "BTG",
      name: "Feira",
      description: null,
      status: "active",
      editions_count: 2,
      last_edition_id: "ced_1",
      last_edition_label: null,
    });
    expect(eventoDaLeitura("cve_2", { customer_code: "BTG", name: "Antigo", status: "archived" })?.status).toBe("archived");

    expect(precoDaLeitura("ced_1", { customer_code: "BTG", valor_declarado_cents: 10_000_000, fechado_cents: null })).toEqual({
      id: "ced_1",
      valor_declarado_cents: 10_000_000,
      fechado_cents: null,
    });
    expect(precoDaLeitura("ced_2", {})).toEqual({ id: "ced_2", valor_declarado_cents: null, fechado_cents: null });
  });
});
