import { describe, expect, it } from "vitest";

import { adicionarAjuste, adicionarAvulsa, catalogoDaTabela, linhaDaTabela, type LinhaForm } from "../comercial/montar";
import {
  fechamentoEmTexto,
  itensParaUsar,
  pedidoDosParecidos,
  periodoEmTexto,
  quantidadeDoCaso,
  quantidadesUsadas,
  semelhancaEmTexto,
  trabalhoEmTexto,
  usarQuantidades,
  valorDoCaso,
  type CasoParecido,
} from "./parecidos";

/**
 * Os orçamentos parecidos na montagem (parte 5.3c): o pedido sai das linhas da
 * tabela; "Usar as quantidades" só mexe nas linhas, com o realizado do caso.
 * Dados sintéticos.
 */

const CATALOGO = catalogoDaTabela(
  {
    lpu_mesa: { codigo: "1.01", descricao_cliente: "Mesa", preco: "40" },
    lpu_cadeira: { codigo: "1.02", descricao_cliente: "Cadeira", preco: "12" },
    lpu_armario: { codigo: "1.03", descricao_cliente: "Armário", preco: "90" },
  },
  new Map(),
);

const item = (lpu: string) => CATALOGO.find((linha) => linha.lpuItemId === lpu)!;

function linhas(): LinhaForm[] {
  const base = [linhaDaTabela(item("lpu_mesa"), "l1", "12"), linhaDaTabela(item("lpu_cadeira"), "l2", "1.234,5")];
  const comAvulsa = adicionarAvulsa(base, "l3").linhas;
  return adicionarAjuste(comAvulsa, "l4").linhas;
}

const CASO: CasoParecido = {
  demanda: "10031",
  titulo: "Remanejamento do 10º andar",
  itens: [
    { lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", orcado: "12", realizado: "14" },
    { lpu_item_id: "lpu_armario", item: "Armário", unidade: "UN", orcado: "2", realizado: "0" },
    { lpu_item_id: "lpu_cofre", item: "Cofre", unidade: "VB", orcado: "1", realizado: "1" },
    { lpu_item_id: null, item: "Caixa", unidade: null, orcado: null, realizado: "1.5" },
  ],
  orcado_cents: 180_000,
  realizado_cents: 196_000,
  executado_de: "2026-09-10",
  executado_ate: "2026-09-11",
  os: 2,
  minutos_de_trabalho: 420,
  fechada_em: "2026-09-15T15:00:00.000Z",
  semelhanca_pct: 96,
  itens_em_comum: 1,
};

describe("o pedido dos parecidos", () => {
  it("só as linhas da tabela com item da LPU e quantidade, em decimal com ponto e em ordem do item", () => {
    expect(pedidoDosParecidos("10050", linhas())).toEqual({
      demanda: "10050",
      itens: [
        { lpu_item_id: "lpu_cadeira", quantidade: "1234.5" },
        { lpu_item_id: "lpu_mesa", quantidade: "12" },
      ],
    });
  });

  it("sem linha da tabela com quantidade, não há o que comparar", () => {
    expect(pedidoDosParecidos("10050", [])).toBeNull();
    expect(pedidoDosParecidos("10050", [{ ...linhaDaTabela(item("lpu_mesa"), "l1", "0") }])).toBeNull();
    expect(pedidoDosParecidos("10050", adicionarAvulsa([], "l3").linhas)).toBeNull();
  });
});

describe("os textos do caso", () => {
  it("a semelhança, o fechamento, as quantidades, os valores, o período e o trabalho", () => {
    expect(semelhancaEmTexto(CASO)).toBe("96% parecido");
    expect(fechamentoEmTexto(CASO)).toBe("Fechada em 15/09/2026");
    expect(fechamentoEmTexto({ fechada_em: null })).toBeNull();
    expect([quantidadeDoCaso("14", "UN"), quantidadeDoCaso("1.5", null), quantidadeDoCaso("3.5", "M²"), quantidadeDoCaso(null, "UN")]).toEqual(["14 un", "1,5 un", "3,5 m²", "—"]);
    expect([valorDoCaso(196_000).replace(/\s/g, " "), valorDoCaso(null)]).toEqual(["R$ 1.960,00", "—"]);
    expect(periodoEmTexto(CASO)).toBe("10/09/2026 a 11/09/2026");
    expect(periodoEmTexto({ executado_de: "2026-09-10", executado_ate: "2026-09-10" })).toBe("10/09/2026");
    expect(periodoEmTexto({ executado_de: null, executado_ate: null })).toBeNull();
    expect([trabalhoEmTexto(CASO), trabalhoEmTexto({ os: 1, minutos_de_trabalho: null }), trabalhoEmTexto({ os: 0, minutos_de_trabalho: null })]).toEqual(["7h em 2 OS", "1 OS", null]);
  });
});

describe("usar as quantidades", () => {
  it("só os itens que a tabela tem e que foram feitos, com o realizado", () => {
    // O armário foi orçado e não foi feito; o cofre não está na tabela; a caixa é avulsa.
    expect(itensParaUsar(CASO, CATALOGO)).toEqual([{ lpuItemId: "lpu_mesa", quantidade: "14" }]);
    // Sem o realizado, vale o orçado; o "1.234" do servidor é um e pouco, não mil.
    expect(itensParaUsar({ itens: [{ lpu_item_id: "lpu_cadeira", item: "Cadeira", unidade: "UN", orcado: "1.234", realizado: null }] }, CATALOGO)).toEqual([
      { lpuItemId: "lpu_cadeira", quantidade: "1.234" },
    ]);
  });

  it("a linha que já tem o item fica com a quantidade do caso; o item novo entra pela tabela; o resto não muda", () => {
    const caso = { itens: [...CASO.itens, { lpu_item_id: "lpu_armario", item: "Armário", unidade: "UN", orcado: "3", realizado: "3" }] };
    let n = 0;
    const depois = usarQuantidades(linhas(), caso, CATALOGO, () => `nova-${(n += 1)}`);
    expect(depois.map((linha) => [linha.chave, linha.origem, linha.lpuItemId, linha.quantidade])).toEqual([
      ["l1", "tabela", "lpu_mesa", "14"],
      ["l2", "tabela", "lpu_cadeira", "1.234,5"],
      ["l3", "avulso", null, "1"],
      ["l4", "ajuste", null, "1"],
      ["nova-1", "tabela", "lpu_armario", "3"],
    ]);
    expect(quantidadesUsadas(depois, caso, CATALOGO)).toBe(true);
    expect(quantidadesUsadas(linhas(), caso, CATALOGO)).toBe(false);
    expect(quantidadesUsadas(linhas(), { itens: [] }, CATALOGO)).toBe(false);
  });
});
