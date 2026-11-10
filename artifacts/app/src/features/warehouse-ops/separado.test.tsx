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

/**
 * O "Separado" de Pedidos (pergunta 59): o lacre e, para a coordenação, o
 * separado de cada linha, sem legenda. A linha diz o item com o tamanho e,
 * embaixo, o código do cliente e a posição (docs/mockups/NomeWmsSeparado.dc.html,
 * padrão do nome de 06/11/2026: o nome é o mesmo em todos os tamanhos).
 */

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
      { id: "pli_1", name: "Polo Masculino Piquet Preto - GG", client_item_code: "A.01.0806.005.GG", expected_quantity: 20, location: "B-02" },
      { id: "pli_2", product_name: "Toalha de Academia", client_item_code: "C.0659.001.U", quantity: 10, location: "C-02-4" },
      { id: "pli_3", product_name: "Boné", quantity: 5, location: "C-03-1" },
    ],
  } as WarehouseTask,
};

const LINHAS = linhasDoSeparado(PEDIDO);
const A_MENOS: LinhaDoSeparado[] = [{ ...LINHAS[0]!, separado: 18, detalhe: "A posição B-02 tinha 18" }, LINHAS[1]!, LINHAS[2]!];

function rotulos(html: string) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((achado) => achado[1]);
}

function render(linhas?: LinhaDoSeparado[]) {
  return renderToStaticMarkup(<SeparadoView lacre="L-0101" onLacre={noop} linhas={linhas} onLinha={noop} />);
}

describe("o Separado do pedido", () => {
  it("quem opera o armazém: só o lacre, como antes", () => {
    expect(textosDaTela(render())).toEqual(["Número do lacre"]);
  });

  it("a coordenação vê cada linha com o item e o tamanho, o código do cliente e a posição, o pedido e o separado", () => {
    expect(LINHAS).toEqual([
      { id: "pli_1", item: "Polo Masculino Piquet Preto · GG", codigo: "A.01.0806.005.GG", posicao: "B-02", pedido: 20, separado: 20, motivo: "falta", detalhe: "" },
      { id: "pli_2", item: "Toalha de Academia", codigo: "C.0659.001.U", posicao: "C-02-4", pedido: 10, separado: 10, motivo: "falta", detalhe: "" },
      { id: "pli_3", item: "Boné", codigo: "", posicao: "C-03-1", pedido: 5, separado: 5, motivo: "falta", detalhe: "" },
    ]);
    expect(textosDaTela(render(LINHAS))).toEqual([
      "Número do lacre",
      "Item",
      "Pedido",
      "Separado",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · B-02",
      "20 un.",
      "Toalha de Academia",
      "C.0659.001.U · C-02-4",
      "10 un.",
      "Boné",
      "C-03-1",
      "5 un.",
    ]);
  });

  it("os botões e o campo de cada linha dizem o item com o tamanho; o tamanho único fica sem · U", () => {
    expect(rotulos(render(LINHAS))).toEqual([
      "Menos um: Polo Masculino Piquet Preto · GG",
      "Separado de Polo Masculino Piquet Preto · GG",
      "Mais um: Polo Masculino Piquet Preto · GG",
      "Menos um: Toalha de Academia",
      "Separado de Toalha de Academia",
      "Mais um: Toalha de Academia",
      "Menos um: Boné",
      "Separado de Boné",
      "Mais um: Boné",
    ]);
    expect(render(LINHAS)).not.toContain("· U");
  });

  it("o nome gravado hoje só perde o tamanho do fim; sem o código do cliente, o nome fica como está", () => {
    const hoje = linhasDoSeparado({
      ...PEDIDO,
      pick: {
        ...PEDIDO.pick!,
        items: [
          { id: "pli_1", product_name: "Polo masculino piquet preto GG", client_item_code: "A.01.0806.005.GG", expected_quantity: 20 },
          { id: "pli_2", product_name: "Calça brim 42", expected_quantity: 4 },
          { id: "pli_3", sku_code: "BTG-000126", client_item_code: "A.01.0806.005.XG", expected_quantity: 2 },
        ],
      },
    });
    expect(hoje.map((linha) => linha.item)).toEqual(["Polo masculino piquet preto · GG", "Calça brim 42", "BTG-000126 · XG"]);
  });

  it("a linha a menos mostra a diferença e pede o motivo e o detalhe", () => {
    expect(textosDaTela(render(A_MENOS))).toEqual([
      "Número do lacre",
      "Item",
      "Pedido",
      "Separado",
      "Polo Masculino Piquet Preto · GG",
      "−2",
      "A.01.0806.005.GG · B-02",
      "20 un.",
      "Toalha de Academia",
      "C.0659.001.U · C-02-4",
      "10 un.",
      "Boné",
      "C-03-1",
      "5 un.",
      "Motivo da diferença em Polo Masculino Piquet Preto · GG",
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

  it("a linha a menos vai com o motivo e o detalhe; a completa, como antes; o nome não vai para o servidor", () => {
    expect(linhasParaSeparar(A_MENOS)).toEqual([
      { pick_line_id: "pli_1", qty_picked: 18, status: "confirmed", shortage_reason: "falta", shortage_detail: "A posição B-02 tinha 18" },
      { pick_line_id: "pli_2", qty_picked: 10, status: "confirmed" },
      { pick_line_id: "pli_3", qty_picked: 5, status: "confirmed" },
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
