import { describe, expect, it } from "vitest";

import { gruposDaSeparacao, resumoDoGrupo, type PosicaoDaLista } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";

/**
 * A lista de separação por prateleira (docs/plataforma/separacao-com-caixas.md,
 * parte 1a; docs/mockups/WmsSepararLista.dc.html). Antes, "Ver itens" saía na
 * ordem do id da linha: a do carrinho do cliente, e a linha 100 depois da 10.
 * Dados sintéticos.
 */

const POSICOES: PosicaoDaLista[] = [
  { code: "A-03", sequence: 3 },
  { code: "A-05", sequence: 5 },
  { code: "B-09", sequence: 24 },
];

function linha(id: string, location: string | null, nome: string, codigo: string, quantidade: number, numero?: number): WarehouseTaskItem {
  return { id, location, product_name: nome, client_item_code: codigo, sku_code: `SKU-${id}`, expected_quantity: quantidade, line_number: numero };
}

describe("a lista de separação por prateleira", () => {
  it("as prateleiras vêm na ordem de caminhada, não na do carrinho", () => {
    const grupos = gruposDaSeparacao(
      [
        linha("1", "B-09", "Copo Café", "B.0791.005.U", 1),
        linha("2", "A-05", "Calça Social Masculino Preta", "A.01.0712.001.42", 40),
        linha("3", "A-03", "Polo Masculino Piquet Preto", "A.01.0806.005.G", 80),
        linha("4", "B-09", "Porta Cartão Couro", "B.0567.005.U", 6),
      ],
      POSICOES,
    );
    expect(grupos.map((grupo) => grupo.posicao)).toEqual(["A-03", "A-05", "B-09"]);
    expect(grupos.map(resumoDoGrupo)).toEqual(["1 item · 80 un.", "1 item · 40 un.", "2 itens · 7 un."]);
    expect(grupos[2].linhas.map((item) => item.nome)).toEqual(["Copo Café", "Porta Cartão Couro"]);
  });

  it("a prateleira fora do cadastro vem depois, em ordem; a linha sem endereço fica no fim", () => {
    const grupos = gruposDaSeparacao(
      [
        linha("1", null, "Caneca", "C.0734.003.U", 1),
        linha("2", "DEVOLUCAO", "Copo", "B.0572.003.U", 1),
        linha("3", "C-10", "Mochila", "C.0900.001.U", 1),
        linha("4", "C-2", "Squeeze", "C.0901.001.U", 1),
        linha("5", "b-09", "Lancheira", "C.0612.002.U", 2),
      ],
      POSICOES,
    );
    expect(grupos.map((grupo) => grupo.posicao)).toEqual(["b-09", "C-2", "C-10", "DEVOLUCAO", ""]);
  });

  it("os tamanhos da família saem em ordem, com o nome e o tamanho", () => {
    const [grupo] = gruposDaSeparacao(
      [
        linha("1", "A-03", "Polo Masculino Piquet Preto XG", "A.01.0806.005.XG", 90),
        linha("2", "A-03", "Polo Masculino Piquet Preto G", "A.01.0806.005.G", 80),
        linha("3", "A-03", "Polo Masculino Piquet Preto P", "A.01.0806.005.P", 60),
        linha("4", "A-03", "Polo Masculino Piquet Preto GG", "A.01.0806.005.GG", 100),
        linha("5", "A-03", "Polo Masculino Piquet Preto M", "A.01.0806.005.M", 120),
      ],
      POSICOES,
    );
    expect(grupo.linhas.map((item) => item.nome)).toEqual([
      "Polo Masculino Piquet Preto · P",
      "Polo Masculino Piquet Preto · M",
      "Polo Masculino Piquet Preto · G",
      "Polo Masculino Piquet Preto · GG",
      "Polo Masculino Piquet Preto · XG",
    ]);
    expect(resumoDoGrupo(grupo)).toBe("5 itens · 450 un.");
  });

  it("com mais de 99 linhas, a 100 vem depois da 99, não depois da 10", () => {
    // A ordem em que o Firestore devolve as linhas: pelo id, "_10", "_100", "_101", "_11"...
    const ids = Array.from({ length: 116 }, (_, indice) => String(indice + 1).padStart(2, "0")).sort();
    expect(ids.slice(9, 13)).toEqual(["10", "100", "101", "102"]);
    const [grupo] = gruposDaSeparacao(
      ids.map((id) => linha(`pli_ord_${id}`, "B-09", "Copo Stanley", "B.0672.003.U.B", 1, Number(id))),
      POSICOES,
    );
    expect(grupo.itens).toBe(116);
    expect(grupo.linhas.map((item) => Number(item.item.line_number))).toEqual(Array.from({ length: 116 }, (_, indice) => indice + 1));
  });

  it("sem o cadastro de posições, a ordem é a do código da prateleira", () => {
    const grupos = gruposDaSeparacao([linha("1", "B-09", "Copo", "B.1.U", 1), linha("2", "A-03", "Polo", "A.1.U", 1)]);
    expect(grupos.map((grupo) => grupo.posicao)).toEqual(["A-03", "B-09"]);
  });
});
