import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { CancelarPedidoView, motivoValido, pedidoCancelavel, voltasDoPedido, type VoltaAPosicao } from "./cancel-order";

/** Cancelar pedido no diálogo de Pedidos (pergunta 59): o motivo e o que volta à posição, sem legenda. */

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
    { id: "pli_1", name: "Camiseta polo P", picked_quantity: 40, location: "A-03-2" },
    { id: "pli_2", product_name: "Calça brim 42", picked_quantity: 30, location: "B-01-1" },
    { id: "pli_3", name: "Boné", picked_quantity: 0, location: "C-02-4" },
  ],
};

describe("cancelar pedido", () => {
  it("antes da separação: só o motivo", () => {
    expect(textosDaTela(render())).toEqual(["Motivo"]);
  });

  it("já separado: o que volta à posição, com a quantidade e a posição de cada item", () => {
    const voltas = voltasDoPedido(pedido("enviar", SEPARADO));
    expect(voltas).toEqual([
      { id: "pli_1", item: "Camiseta polo P", quantidade: 40, posicao: "A-03-2" },
      { id: "pli_2", item: "Calça brim 42", quantidade: 30, posicao: "B-01-1" },
    ]);
    expect(textosDaTela(render(voltas))).toEqual([
      "Motivo",
      "Voltam à posição",
      "Item",
      "Quantidade",
      "Posição",
      "Camiseta polo P",
      "40 un.",
      "A-03-2",
      "Calça brim 42",
      "30 un.",
      "B-01-1",
    ]);
  });

  it("a separação que não terminou não devolve nada", () => {
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
