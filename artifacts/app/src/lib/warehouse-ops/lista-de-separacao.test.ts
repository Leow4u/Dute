import { describe, expect, it } from "vitest";

import {
  caixasDoItem,
  folhaDaLista,
  gruposDaSeparacao,
  hrefDaListaDeSeparacao,
  impressaEmTexto,
  pedidoDaBusca,
  resumoDoGrupo,
  type CaixaDaLista,
  type PosicaoDaLista,
} from "./lista-de-separacao";
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

/**
 * A caixa de cada item (parte 1c, decisão 10 de 10/11/2026): as caixas
 * guardadas na prateleira da linha cujo conteúdo de entrada tem o item, a
 * mais antiga primeiro. Só leitura: a separação ainda não baixa a caixa.
 */
function caixa(code: string, location: string, skus: string[], extra: Partial<CaixaDaLista> = {}): CaixaDaLista {
  return { code, customer_code: "BTG", status: "stored", location_id: location, sku_codes: skus, stored_at: "2026-10-20T12:00:00.000Z", ...extra };
}

describe("a caixa de cada item da lista", () => {
  const polo = linha("1", "A-03", "Polo Masculino Piquet Preto M", "A.01.0806.005.M", 120);

  it("só a caixa guardada na prateleira da linha, do cliente do pedido, que recebeu o SKU", () => {
    const caixas = [
      caixa("CX-000011", "A-03", ["SKU-1", "SKU-9"]),
      caixa("CX-000020", "A-04", ["SKU-1"]),
      caixa("CX-000021", "A-03", ["SKU-2"]),
      caixa("CX-000022", "A-03", ["SKU-1"], { status: "committing" }),
      caixa("CX-000023", "A-03", ["SKU-1"], { status: "cancelled" }),
      caixa("CX-000024", "A-03", ["SKU-1"], { customer_code: "ITAU" }),
      caixa("CX-000012", "a-03", ["sku-1"]),
    ];
    expect(caixasDoItem(polo, caixas, "btg")).toEqual(["CX-000011", "CX-000012"]);
  });

  it("a mais antiga primeiro, pela data da guarda; no empate, o código; a caixa sem data fica depois", () => {
    const caixas = [
      caixa("CX-000300", "A-03", ["SKU-1"], { stored_at: null }),
      caixa("CX-000200", "A-03", ["SKU-1"], { stored_at: "2026-10-21T09:00:00.000Z" }),
      caixa("CX-000100", "A-03", ["SKU-1"], { stored_at: "2026-10-21T09:00:00.000Z" }),
      caixa("CX-000900", "A-03", ["SKU-1"], { stored_at: "2026-10-17T15:30:00.000Z" }),
    ];
    expect(caixasDoItem(polo, caixas, "BTG")).toEqual(["CX-000900", "CX-000100", "CX-000200", "CX-000300"]);
  });

  it("a linha sem endereço ou sem SKU não tem caixa", () => {
    const caixas = [caixa("CX-000011", "A-03", ["SKU-1"]), caixa("CX-000012", "", ["SKU-1"])];
    expect(caixasDoItem({ ...polo, location: null }, caixas, "BTG")).toEqual([]);
    expect(caixasDoItem({ id: "1", location: "A-03", product_name: "Polo" }, caixas, "BTG")).toEqual([]);
  });

  it("na prateleira, as linhas seguem a caixa: quem separa abre uma caixa de cada vez", () => {
    const [grupo] = gruposDaSeparacao(
      [
        linha("1", "B-09", "Porta Cartão Couro", "B.0567.005.U", 6),
        linha("2", "B-09", "Copo Café", "B.0791.005.U", 1),
        linha("3", "B-09", "Lancheira Grande", "C.0612.002.U", 2),
        linha("4", "B-09", "Caneca Térmica", "C.0734.003.U", 1),
        linha("5", "B-09", "Agenda", "D.0100.001.U", 1),
      ],
      POSICOES,
      {
        cliente: "BTG",
        caixas: [
          caixa("CX-000190", "B-09", ["SKU-1"]),
          caixa("CX-000187", "B-09", ["SKU-2", "SKU-4"]),
          caixa("CX-000186", "B-09", ["SKU-3"]),
          caixa("CX-000189", "B-09", ["SKU-4"]),
        ],
      },
    );
    expect(grupo.linhas.map((item) => [item.nome, item.caixas])).toEqual([
      ["Lancheira Grande", ["CX-000186"]],
      ["Caneca Térmica", ["CX-000187", "CX-000189"]],
      ["Copo Café", ["CX-000187"]],
      ["Porta Cartão Couro", ["CX-000190"]],
      // A linha sem caixa na prateleira fica no fim do grupo.
      ["Agenda", []],
    ]);
  });

  it("sem as caixas lidas, a lista sai como antes, sem caixa na linha", () => {
    const [grupo] = gruposDaSeparacao([polo], POSICOES);
    expect(grupo.linhas[0].caixas).toEqual([]);
  });
});

/**
 * A folha impressa (parte 1b; docs/mockups/WmsSepararListaImpressa.dc.html):
 * o cabeçalho do pedido com os textos prontos e o endereço da tela.
 */
describe("a folha da lista de separação", () => {
  const grupos = gruposDaSeparacao(
    [linha("1", "A-03", "Polo Masculino Piquet Preto M", "A.01.0806.005.M", 3200), linha("2", "B-09", "Copo Café", "B.0791.005.U", 135)],
    POSICOES,
  );

  it("o pedido, o cliente, o destino, o Para quando com o ano, o total e quem imprimiu, no horário de São Paulo", () => {
    expect(
      folhaDaLista({
        numero: " PED-0001 ",
        cliente: "BTG Pactual",
        destino: " Agência Faria Lima ",
        paraQuando: "2026-11-16T14:36:00.000Z",
        por: "Guilherme Dantas",
        agora: new Date("2026-11-11T02:05:00.000Z"),
        grupos,
      }),
    ).toEqual({
      numero: "PED-0001",
      cliente: "BTG Pactual",
      destino: "Agência Faria Lima",
      paraQuando: "Seg 16/11/2026 11:36",
      resumo: "2 itens · 3.335 un.",
      // 02:05 UTC do dia 11 ainda é o dia 10 em São Paulo.
      impressaEm: "10/11/2026 23:05",
      por: "Guilherme Dantas",
      grupos,
    });
  });

  it("sem destino, sem prazo e sem nome, os campos ficam vazios (o papel mostra o traço)", () => {
    const folha = folhaDaLista({ numero: "PED-0002", agora: new Date("2026-11-10T17:20:00.000Z"), grupos: [] });
    expect(folha).toMatchObject({ cliente: "", destino: "", paraQuando: "", por: "", resumo: "0 itens · 0 un.", impressaEm: "10/11/2026 14:20" });
    expect(folhaDaLista({ numero: "PED-0002", paraQuando: "sem data", agora: new Date("2026-11-10T17:20:00.000Z"), grupos: [] }).paraQuando).toBe("");
  });

  it("a hora da impressão sai com dois dígitos e sem vírgula", () => {
    expect(impressaEmTexto(new Date("2026-01-05T12:07:00.000Z"))).toBe("05/01/2026 09:07");
    expect(impressaEmTexto(new Date("2026-01-05T03:00:00.000Z"))).toBe("05/01/2026 00:00");
  });

  it("o endereço da lista leva o pedido na busca, e a tela o lê de volta", () => {
    expect(hrefDaListaDeSeparacao("ord_req 1/á")).toBe("/pedidos/lista?pedido=ord_req%201%2F%C3%A1");
    expect(pedidoDaBusca("pedido=ord_req%201%2F%C3%A1")).toBe("ord_req 1/á");
    expect(pedidoDaBusca("?pedido=ord_123")).toBe("ord_123");
    expect(pedidoDaBusca("pedido=%20")).toBeNull();
    expect(pedidoDaBusca("")).toBeNull();
  });
});
