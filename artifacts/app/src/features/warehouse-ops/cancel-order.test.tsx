import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { CancelarPedidoView, motivoValido, pedidoCancelavel, voltasDoPedido, type VoltaAPosicao } from "./cancel-order";

/**
 * Cancelar pedido no diálogo de Pedidos (pergunta 59): o motivo e o que volta
 * à posição, sem legenda. O item vai com o tamanho, como no Separado (padrão
 * do nome de 06/11/2026: o nome é o mesmo em todos os tamanhos).
 */

const noop = () => undefined;

function render(voltas: VoltaAPosicao[] = [], motivo = "") {
  return renderToStaticMarkup(<CancelarPedidoView motivo={motivo} voltas={voltas} onMotivo={noop} />);
}

function pedido(stage: OrderGroup["stage"], pick?: Partial<WarehouseTask>): OrderGroup {
  return { key: "ord_1", orderNumber: "PED-0047", orderId: "ord_1", stage, exceptionCount: 0, pick: pick as WarehouseTask };
}

const SEPARADO: Partial<WarehouseTask> = {
  id: "picking:pick_ord_1",
  status: "completed",
  items: [
    { id: "pli_1", name: "Camiseta polo P", client_item_code: "A.01.0310.001.P", picked_quantity: 40, location: "A-03-2" },
    { id: "pli_2", product_name: "Calça brim 42", picked_quantity: 30, location: "B-01-1" },
    { id: "pli_3", name: "Boné", picked_quantity: 0, location: "C-02-4" },
    { id: "pli_4", product_name: "Toalha de Academia", client_item_code: "C.0659.001.U", picked_quantity: 5, location: "C-01-1" },
  ],
};

describe("cancelar pedido", () => {
  it("antes da separação: só o motivo", () => {
    expect(textosDaTela(render())).toEqual(["Motivo"]);
  });

  it("já separado: o que volta à posição, com o item e o tamanho, a quantidade e a posição", () => {
    const voltas = voltasDoPedido(pedido("enviar", SEPARADO));
    expect(voltas).toEqual([
      { id: "pli_1", item: "Camiseta polo · P", quantidade: 40, posicao: "A-03-2" },
      { id: "pli_2", item: "Calça brim 42", quantidade: 30, posicao: "B-01-1" },
      { id: "pli_4", item: "Toalha de Academia", quantidade: 5, posicao: "C-01-1" },
    ]);
    expect(textosDaTela(render(voltas))).toEqual([
      "Motivo",
      "Voltam à posição",
      "Item",
      "Quantidade",
      "Posição",
      "Camiseta polo · P",
      "40 un.",
      "A-03-2",
      "Calça brim 42",
      "30 un.",
      "B-01-1",
      "Toalha de Academia",
      "5 un.",
      "C-01-1",
    ]);
    // Sem o código do cliente, o nome fica como está; o tamanho único não aparece.
    expect(render(voltas)).not.toContain("· U");
  });

  it("a separação em andamento devolve só as linhas já separadas, na quantidade separada", () => {
    // Na bancada: a polo separada inteira, a calça a menos (28 de 30), o boné zerado e a toalha por separar.
    const emAndamento: Partial<WarehouseTask> = {
      id: "picking:pick_ord_1",
      status: "in_progress",
      items: [
        { id: "pli_1", name: "Camiseta polo P", client_item_code: "A.01.0310.001.P", quantity: 40, separated_qty: 40, separated_at: "2026-11-12T13:05:00.000Z", location: "A-03-2" },
        { id: "pli_2", product_name: "Calça brim 42", quantity: 30, separated_qty: 28, separated_at: "2026-11-12T13:20:00.000Z", location: "B-01-1" },
        { id: "pli_3", name: "Boné", quantity: 6, separated_qty: 0, separated_at: "2026-11-12T13:30:00.000Z", location: "C-02-4" },
        { id: "pli_4", product_name: "Toalha de Academia", client_item_code: "C.0659.001.U", quantity: 5, location: "C-01-1" },
      ],
    };
    expect(voltasDoPedido(pedido("separar", emAndamento))).toEqual([
      { id: "pli_1", item: "Camiseta polo · P", quantidade: 40, posicao: "A-03-2" },
      { id: "pli_2", item: "Calça brim 42", quantidade: 28, posicao: "B-01-1" },
    ]);
  });

  it("a separação que não começou, ou começou sem nada separado, não devolve nada", () => {
    expect(voltasDoPedido(pedido("separar", { ...SEPARADO, status: "planned" }))).toEqual([]);
    // O que a separação concluída gravou (picked_quantity) não vale para a que está em andamento.
    expect(voltasDoPedido(pedido("separar", { ...SEPARADO, status: "in_progress" }))).toEqual([]);
    expect(voltasDoPedido(pedido("separar"))).toEqual([]);
  });

  it("cancela o pedido ainda no armazém; o que saiu para a entrega, não", () => {
    expect(pedidoCancelavel(pedido("separar"))).toBe(true);
    expect(pedidoCancelavel(pedido("enviar"))).toBe(true);
    expect(pedidoCancelavel(pedido("entregar"))).toBe(false);
    expect(pedidoCancelavel(pedido("entregue"))).toBe(false);
    expect(pedidoCancelavel({ ...pedido("separar"), orderId: undefined })).toBe(false);
  });

  it("o motivo tem de 3 a 500 caracteres, sem contar os espaços das pontas", () => {
    expect(motivoValido("  ab ")).toBe(false);
    expect(motivoValido("O cliente desistiu.")).toBe(true);
    expect(motivoValido("x".repeat(501))).toBe(false);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render(voltasDoPedido(pedido("enviar", SEPARADO)), "O cliente desistiu."))).toEqual([]);
  });
});
