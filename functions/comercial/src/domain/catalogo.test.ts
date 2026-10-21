import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LPU_ITEMS_COLLECTION,
  chaveNormalizada,
  itemOrcavel,
  limparTexto,
  lpuItemDoc,
  lpuItemId,
  normalizarTexto,
} from "./catalogo.js";

/**
 * Catálogo do Comercial (`lpu_items`): o item não tem preço e tem id próprio,
 * um digest de categoria, item, serviço e unidade normalizados. O código do
 * cliente (DTL-...) se repete e fica só no preço da tabela.
 */

const mesa = { categoria: "Mobiliário", item: "Mesa de escritório", servico: "Montagem", unidade: "UN" };

describe("normalização do texto do catálogo", () => {
  it("compara sem acento, sem maiúsculas e sem espaço sobrando", () => {
    assert.equal(normalizarTexto("  Mesa   de\tESCRITÓRIO "), "mesa de escritorio");
    assert.equal(normalizarTexto("Serviço"), "servico");
  });

  it("unidade com expoente vira algarismo", () => {
    assert.equal(normalizarTexto("M²"), "m2");
    assert.equal(normalizarTexto("M³/MÊS"), "m3/mes");
  });

  it("o texto mostrado só perde espaço sobrando", () => {
    assert.equal(limparTexto("  Mesa   de\nescritório "), "Mesa de escritório");
    assert.equal(limparTexto("M²"), "M²");
  });
});

describe("id do item do catálogo", () => {
  it("é determinístico, com prefixo e digest", () => {
    const id = lpuItemId(mesa);
    assert.match(id, /^lpu_[0-9a-f]{32}$/);
    assert.equal(lpuItemId({ ...mesa }), id);
  });

  it("a mesma chave escrita de outro jeito dá o mesmo id", () => {
    const id = lpuItemId(mesa);
    assert.equal(
      lpuItemId({ categoria: " MOBILIARIO ", item: "mesa  de Escritorio", servico: "montagem", unidade: "un" }),
      id,
    );
    assert.equal(
      lpuItemId({ categoria: "Área", item: "Piso", servico: "Limpeza", unidade: "M²" }),
      lpuItemId({ categoria: "area", item: "piso", servico: "limpeza", unidade: "m2" }),
    );
  });

  it("muda quando muda categoria, item, serviço ou unidade", () => {
    const id = lpuItemId(mesa);
    for (const campo of ["categoria", "item", "servico", "unidade"] as const) {
      assert.notEqual(lpuItemId({ ...mesa, [campo]: `${mesa[campo]} 2` }), id, campo);
    }
    // O serviço é parte da chave: montar e desmontar a mesma mesa são itens diferentes.
    assert.notEqual(lpuItemId({ ...mesa, servico: "Desmontagem" }), id);
  });

  it("os campos não se misturam: trocar texto de um campo para outro muda o id", () => {
    assert.notEqual(
      lpuItemId({ categoria: "a", item: "b c", servico: "d", unidade: "e" }),
      lpuItemId({ categoria: "a b", item: "c", servico: "d", unidade: "e" }),
    );
  });

  it("campo vazio é recusado", () => {
    for (const campo of ["categoria", "item", "servico", "unidade"] as const) {
      assert.throws(() => lpuItemId({ ...mesa, [campo]: "   " }), /vazi/, campo);
    }
  });

  it("a chave normalizada é a que entra no digest", () => {
    assert.deepEqual(chaveNormalizada({ ...mesa, unidade: "M²" }), {
      categoria: "mobiliario",
      item: "mesa de escritorio",
      servico: "montagem",
      unidade: "m2",
    });
  });
});

describe("item orçável", () => {
  it("armazenagem não passa por orçamento: a cobrança é do WMS", () => {
    assert.equal(itemOrcavel({ categoria: "Armazenagem", item: "Pallet", servico: "Prestação de serviço" }), false);
    assert.equal(itemOrcavel({ categoria: "Guarda", item: "Pallet", servico: "Armazenamento" }), false);
    assert.equal(itemOrcavel({ categoria: "ARMAZENAGEM MENSAL", item: "Caixa", servico: "Fornecimento" }), false);
  });

  it("armazenagem só no item também conta (categoria Serviços, como numa LPU de cliente)", () => {
    const galpao = { categoria: "Serviços", item: "Armazenamento em galpão", servico: "Prestação de Serviço", unidade: "M³/MÊS" };
    assert.equal(itemOrcavel(galpao), false);
    assert.equal(lpuItemDoc({ ...galpao, descricao: "Guarda de mobiliário em galpão", origem_tabela_id: "pt_x" }).orcavel, false);
    assert.equal(itemOrcavel({ ...galpao, item: "Mesa de escritório" }), true);
  });

  it("a descrição não decide: orcavel depende só da chave do item, como o id", () => {
    const docItem = lpuItemDoc({ ...mesa, servico: "Transporte", descricao: "Retirada da mesa para armazenagem", origem_tabela_id: "pt_x" });
    assert.equal(docItem.orcavel, true);
  });

  it("transporte para o armazém continua orçável", () => {
    assert.equal(itemOrcavel({ categoria: "Transporte para armazém", item: "Mesa de escritório", servico: "Transporte" }), true);
    assert.equal(itemOrcavel(mesa), true);
  });
});

describe("documento do item", () => {
  it("sem preço, com a chave normalizada e ativo", () => {
    const docItem = lpuItemDoc({ ...mesa, descricao: "Montagem de mesa de escritório", origem_tabela_id: "pt_x" });
    assert.equal(LPU_ITEMS_COLLECTION, "lpu_items");
    assert.equal(docItem.id, lpuItemId(mesa));
    assert.equal(docItem.categoria, "Mobiliário");
    assert.equal(docItem.item, "Mesa de escritório");
    assert.equal(docItem.servico, "Montagem");
    assert.equal(docItem.unidade, "UN");
    assert.equal(docItem.descricao, "Montagem de mesa de escritório");
    assert.equal(docItem.orcavel, true);
    assert.equal(docItem.ativo, true);
    assert.equal(docItem.origem_tabela_id, "pt_x");
    assert.deepEqual(docItem.chave, chaveNormalizada(mesa));
    for (const chave of Object.keys(docItem)) {
      assert.doesNotMatch(chave, /preco|preço|price|valor|cents|codigo/i, `item do catálogo com ${chave}`);
    }
  });
});
