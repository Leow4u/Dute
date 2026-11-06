import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { camposDoCatalogo, planoDeRenomes } from "./aplicar.mjs";
import { DECISOES } from "./decisoes.mjs";
import { montarRelatorio } from "./relatorio.mjs";

/**
 * O passo 3, a parte pura: o plano que sai do relatório com as escolhas de
 * 06/11/2026 por cima, e os campos que mudam em skus e products. A gravação
 * no banco roda no cenário do emulador (cenario-aplicar.mjs).
 */

const sku = (id, codigo, produto, extra = {}) => ({ id, customer_code: "BTG", cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, genero: "Masculino", estoque_atual: 10, ...extra });
const product = (s) => ({ id: s.cod_cliente, customer_code: "BTG", cod_cliente: s.cod_cliente, cod_cliente_key: s.cod_cliente.toUpperCase(), produto: s.produto });
const plano = (skus, decisoes) => planoDeRenomes(montarRelatorio({ skus, products: skus.map(product) }).linhas, decisoes);

describe("passo 3: o plano", () => {
  it("a família vai para o padrão, com o tamanho do código, sem escolha", () => {
    const { renomes, fora, sem_mudanca: semMudanca } = plano([
      sku("BTG-000121", "A.01.0806.005.PP", "Polo masculino piquet preto"),
      sku("BTG-000122", "A.01.0806.005.P", "Polo masculino piquet preto p", { tamanho: "P" }),
      sku("BTG-000126", "A.01.0806.005.XG", "Polo masculina piquet preto - XG", { tamanho: "XG" }),
    ]);
    assert.deepEqual(
      renomes.map((r) => [r.sku, r.nome, r.tamanho_hoje, r.tamanho, r.escolha]),
      [
        ["BTG-000121", "Polo Masculino Piquet Preto", "", "PP", false],
        ["BTG-000122", "Polo Masculino Piquet Preto", "P", "P", false],
        ["BTG-000126", "Polo Masculino Piquet Preto", "XG", "XG", false],
      ],
    );
    assert.deepEqual(fora, []);
    assert.equal(semMudanca, 0);
  });

  it("as escolhas de 06/11 entram por cima: a grafia da família e os dois copos de café", () => {
    const { renomes } = plano([
      sku("BTG-000104", "A.01.0809.002.PP", "POLO MASCULINO PIQUET ARPOARDOR PP"),
      sku("BTG-000107", "A.01.0809.002.P", "POLO MASCULINA PIQUET ARPOARDOR P"),
      sku("BTG-000075", "A.01.0809.002.M", "POLO MASCULINO PIQUET ARPOADOR M"),
      sku("BTG-000201", "B.0790.005.U", "COPO CAFÉ - P", { genero: "" }),
      sku("BTG-000202", "B.0791.005.U", "COPO CAFÉ - G", { genero: "" }),
    ]);
    assert.deepEqual(
      renomes.map((r) => [r.codigo, r.nome, r.escolha]),
      [
        ["A.01.0809.002.PP", "Polo Masculino Piquet Arpoador", true],
        ["A.01.0809.002.P", "Polo Masculino Piquet Arpoador", true],
        ["A.01.0809.002.M", "Polo Masculino Piquet Arpoador", true],
        ["B.0790.005.U", "Copo Café Pequeno", true],
        ["B.0791.005.U", "Copo Café Grande", true],
      ],
    );
  });

  it("o nome que é só o tamanho e o código com dois SKUs ativos ficam de fora", () => {
    const { renomes, fora } = plano([
      sku("BTG-000301", "A.01.0301.001.XG", "XG"),
      sku("BTG-000302", "A.01.0302.001.M", "Camiseta lisa M"),
      sku("BTG-000303", "A.01.0302.001.M", "Camiseta lisa M"),
    ]);
    assert.deepEqual(renomes, []);
    assert.deepEqual(
      fora.map((r) => [r.sku, r.motivo]),
      [
        ["BTG-000301", "nome é só o tamanho"],
        ["BTG-000302", "código com 2 SKUs ativos (BTG-000302, BTG-000303)"],
        ["BTG-000303", "código com 2 SKUs ativos (BTG-000302, BTG-000303)"],
      ],
    );
  });

  it("o que já está no padrão não entra; a escolha já aplicada conta como achada", () => {
    const resultado = plano([
      sku("BTG-000104", "A.01.0809.002.PP", "Polo Masculino Piquet Arpoador", { tamanho: "PP" }),
      sku("BTG-000107", "A.01.0809.002.P", "Polo Masculino Piquet Arpoador", { tamanho: "P" }),
    ]);
    assert.deepEqual(resultado.renomes, []);
    assert.equal(resultado.sem_mudanca, 2);
    assert.ok(!resultado.escolhas_sem_uso.some((e) => e.includes("Arpoardor")), resultado.escolhas_sem_uso.join(", "));
  });

  it("a escolha que não acha produto aparece, para o engano de digitação nela não passar calado", () => {
    const { escolhas_sem_uso: semUso } = plano([sku("BTG-000121", "A.01.0806.005.PP", "Polo masculino piquet preto")], {
      nomes: { "Polo Masculino Piquet Pretto": "Polo Masculino Piquet Preto" },
      codigos: { "a.01.9999.001.u": "Outro" },
    });
    assert.deepEqual(semUso, ['nome "Polo Masculino Piquet Pretto"', "código A.01.9999.001.U"]);
  });

  it("as cinco escolhas de 06/11 estão no plano", () => {
    assert.deepEqual(Object.keys(DECISOES.nomes).sort(), ["Copo Termico Thermocup", "Lancheira Grande Az", "Polo Masculino Basica Preta", "Polo Masculino Piquet Arpoardor"]);
    assert.deepEqual(DECISOES.codigos, { "B.0790.005.U": "Copo Café Pequeno", "B.0791.005.U": "Copo Café Grande" });
  });
});

describe("passo 3: os campos de skus e products", () => {
  const renome = { nome: "Polo Masculino Piquet Preto", nome_hoje: "Polo masculino piquet preto - XG", tamanho: "XG", tamanho_hoje: "" };

  it("o nome vai para produto e para name e product_name quando o documento os tem", () => {
    assert.deepEqual(camposDoCatalogo({ produto: "x" }, renome), { produto: renome.nome, tamanho: "XG" });
    assert.deepEqual(camposDoCatalogo({ produto: "x", name: "x", product_name: "x", size: "" }, renome), {
      produto: renome.nome,
      name: renome.nome,
      product_name: renome.nome,
      tamanho: "XG",
      size: "XG",
    });
  });

  it("o tamanho igual não é regravado, nem a capacidade de um copo", () => {
    assert.deepEqual(camposDoCatalogo({ produto: "x", tamanho: "475ML" }, { nome: "Copo Beercup em Inox", tamanho: "475ML", tamanho_hoje: "475ML" }), {
      produto: "Copo Beercup em Inox",
    });
  });
});
