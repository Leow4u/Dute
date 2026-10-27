import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import {
  SeparadoView,
  linhasDoSeparado,
  linhasParaSeparar,
  separadoDaLinha,
  separadoValido,
  type LinhaDoSeparado,
} from "./separado";

/** O "Separado" de Pedidos (pergunta 59): o lacre e, para a coordenação, o separado de cada linha, sem legenda. */

const noop = () => undefined;

const PEDIDO: OrderGroup = {
  key: "ord_49",
  orderNumber: "PED-0049",
  orderId: "ord_49",
  stage: "separar",
  exceptionCount: 0,
  pick: {
    id: "picking:pick_ord_49",
    status: "in_progress",
    items: [
      { id: "pli_1", name: "Camiseta polo G", expected_quantity: 20, location: "A-04-1" },
      { id: "pli_2", product_name: "Boné", quantity: 10, location: "C-02-4" },
    ],
  } as WarehouseTask,
};

const LINHAS = linhasDoSeparado(PEDIDO);
const A_MENOS: LinhaDoSeparado[] = [{ ...LINHAS[0]!, separado: 18, detalhe: "A posição A-04-1 tinha 18" }, LINHAS[1]!];

function render(linhas?: LinhaDoSeparado[]) {
  return renderToStaticMarkup(<SeparadoView lacre="L-0101" onLacre={noop} linhas={linhas} onLinha={noop} />);
}

describe("o Separado do pedido", () => {
  it("quem opera o armazém: só o lacre, como antes", () => {
    expect(textosDaTela(render())).toEqual(["Número do lacre"]);
  });

  it("a coordenação vê cada linha com o pedido e o separado", () => {
    expect(LINHAS).toEqual([
      { id: "pli_1", item: "Camiseta polo G", posicao: "A-04-1", pedido: 20, separado: 20, motivo: "falta", detalhe: "" },
      { id: "pli_2", item: "Boné", posicao: "C-02-4", pedido: 10, separado: 10, motivo: "falta", detalhe: "" },
    ]);
    expect(textosDaTela(render(LINHAS))).toEqual(["Número do lacre", "Item", "Pedido", "Separado", "Camiseta polo G", "A-04-1", "20 un.", "Boné", "C-02-4", "10 un."]);
  });

  it("a linha a menos mostra a diferença e pede o motivo e o detalhe", () => {
    expect(textosDaTela(render(A_MENOS))).toEqual([
      "Número do lacre",
      "Item",
      "Pedido",
      "Separado",
      "Camiseta polo G",
      "−2",
      "A-04-1",
      "20 un.",
      "Boné",
      "C-02-4",
      "10 un.",
      "Motivo da diferença em Camiseta polo G",
      "Falta",
      "Avaria",
      "Detalhe",
    ]);
  });

  it("o separado fica entre 0 e o pedido", () => {
    expect(separadoDaLinha(LINHAS[0]!, 25)).toBe(20);
    expect(separadoDaLinha(LINHAS[0]!, -3)).toBe(0);
    expect(separadoDaLinha(LINHAS[0]!, Number.NaN)).toBe(0);
    expect(separadoDaLinha(LINHAS[0]!, 7)).toBe(7);
  });

  it("confirma com algo separado; sem nada, é Cancelar pedido", () => {
    expect(separadoValido(LINHAS)).toBe(true);
    expect(separadoValido(A_MENOS)).toBe(true);
    expect(separadoValido(LINHAS.map((linha) => ({ ...linha, separado: 0 })))).toBe(false);
    expect(separadoValido([{ ...A_MENOS[0]!, detalhe: "x".repeat(301) }, A_MENOS[1]!])).toBe(false);
  });

  it("a linha a menos vai com o motivo e o detalhe; a completa, como antes", () => {
    expect(linhasParaSeparar(A_MENOS)).toEqual([
      { pick_line_id: "pli_1", qty_picked: 18, status: "confirmed", shortage_reason: "falta", shortage_detail: "A posição A-04-1 tinha 18" },
      { pick_line_id: "pli_2", qty_picked: 10, status: "confirmed" },
    ]);
    expect(linhasParaSeparar([{ ...LINHAS[0]!, separado: 0, motivo: "avaria" }])).toEqual([
      { pick_line_id: "pli_1", qty_picked: 0, status: "confirmed", shortage_reason: "avaria" },
    ]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, com e sem a linha a menos", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(LINHAS))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(A_MENOS))).toEqual([]);
  });
});
