import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COLUNAS, csvDoRelatorio, linhaDoSku, montarRelatorio, nomeDaFamilia, textoDoResumo } from "./relatorio.mjs";

/**
 * O relatório dos nomes fora do padrão, a parte pura: as linhas, a família,
 * a decisão e o CSV. Os registros são sintéticos, no formato de `skus` e
 * `products` (cod_cliente, produto, tamanho, genero, estoque_atual).
 */

const sku = (id, codigo, produto, extra = {}) => ({ id, customer_code: "BTG", cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, genero: "Masculino", estoque_atual: 10, ...extra });
const product = (codigo, produto, extra = {}) => ({ id: codigo, customer_code: "BTG", cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, ...extra });

const FAMILIA = [
  sku("BTG-000121", "A.01.0806.005.PP", "Polo masculino piquet preto", { estoque_atual: 11 }),
  sku("BTG-000122", "A.01.0806.005.P", "Polo masculino piquet preto p", { estoque_atual: 71 }),
  sku("BTG-000123", "A.01.0806.005.M", "Polo masculino piquet preto m", { estoque_atual: 198 }),
  sku("BTG-000124", "A.01.0806.005.G", "Polo masculino piquet preto G", { estoque_atual: 188 }),
  sku("BTG-000125", "A.01.0806.005.GG", "POLO MASCULINO PIQUET PRETO GG", { estoque_atual: 94 }),
  sku("BTG-000126", "A.01.0806.005.XG", "Polo masculino piquet preto - XG", { estoque_atual: 60 }),
  sku("BTG-000127", "A.01.0806.005.XGG", "Polo masculina piquet preto XGG", { estoque_atual: 10 }),
];
const PRODUCTS_DA_FAMILIA = FAMILIA.map((s) => product(s.cod_cliente, s.produto));

describe("relatório: a família", () => {
  it("os sete tamanhos ficam com o mesmo nome, aprovados, em ordem de tamanho", () => {
    const { linhas, resumo } = montarRelatorio({ skus: FAMILIA, products: PRODUCTS_DA_FAMILIA });
    assert.equal(linhas.length, 7);
    assert.deepEqual(
      linhas.map((l) => l.tamanho_proposto),
      ["PP", "P", "M", "G", "GG", "XG", "XGG"],
    );
    assert.ok(linhas.every((l) => l.nome_proposto === "Polo Masculino Piquet Preto"), linhas.map((l) => l.nome_proposto).join(" | "));
    assert.ok(linhas.every((l) => l.decisao === "aprovar"));
    assert.ok(linhas.every((l) => l.familia === "A.01.0806.005"));
    assert.equal(linhas[5].motivo, "tamanho no nome · caixa das letras · tamanho pelo código");
    assert.equal(resumo.familias, 1);
    assert.equal(resumo.familias_com_mudanca, 1);
    assert.deepEqual(resumo.por_decisao, { aprovar: 7 });
  });

  it("o erro de digitação de um tamanho recebe o nome da família e vira conferir", () => {
    const skus = [
      sku("BTG-000131", "A.02.0809.002.P", "Polo feminino piquet arpoador P", { genero: "Feminino" }),
      sku("BTG-000132", "A.02.0809.002.M", "Polo feminina piquet arpoador – M", { genero: "Feminino" }),
      sku("BTG-000133", "A.02.0809.002.G", "POLO FEMININO PIQUET ARPOARDOR G", { genero: "Feminino" }),
    ];
    const { linhas } = montarRelatorio({ skus, products: skus.map((s) => product(s.cod_cliente, s.produto)) });
    const g = linhas.find((l) => l.codigo === "A.02.0809.002.G");
    assert.equal(g.nome_proposto, "Polo Feminino Piquet Arpoador");
    assert.equal(g.decisao, "conferir");
    assert.equal(g.conferir, 'difere da família: "Polo Feminino Piquet Arpoardor"');
    assert.ok(linhas.filter((l) => l !== g).every((l) => l.decisao === "aprovar"));
  });

  it("empate no nome da família: ganha o de mais saldo; depois, o do menor tamanho", () => {
    const empate = (a, b) => [
      { linha: { estoque: a }, proprio: { nome: "Polo Azul", tamanho: "G" } },
      { linha: { estoque: b }, proprio: { nome: "Polo Azul-Marinho", tamanho: "P" } },
    ];
    assert.equal(nomeDaFamilia(empate(5, 50)), "Polo Azul-Marinho");
    assert.equal(nomeDaFamilia(empate(50, 5)), "Polo Azul");
    assert.equal(nomeDaFamilia(empate(5, 5)), "Polo Azul-Marinho");
  });

  it("já no padrão: decisão — e sem motivo", () => {
    const skus = [sku("BTG-000200", "A.01.0900.001.M", "Polo Masculino Piquet Preto", { tamanho: "M" })];
    const { linhas, resumo } = montarRelatorio({ skus, products: [product("A.01.0900.001.M", "Polo Masculino Piquet Preto")] });
    assert.equal(linhas[0].decisao, "—");
    assert.equal(linhas[0].motivo, "");
    assert.equal(resumo.familias_com_mudanca, 0);
  });
});

describe("relatório: o que vira conferir", () => {
  it("products com outro nome, sem registro em products e código duplicado", () => {
    const skus = [
      sku("BTG-000301", "A.01.0901.001.P", "Camisa social branca P"),
      sku("BTG-000302", "A.01.0901.001.M", "Camisa social branca M"),
      sku("BTG-000303", "A.01.0901.001.M", "Camisa social branca M"),
      sku("BTG-000304", "A.01.0901.001.G", "Camisa social branca G"),
    ];
    const products = [product("A.01.0901.001.P", "Camisa social branca P"), product("A.01.0901.001.M", "CAMISA SOCIAL BRANCA"), product("A.01.0901.001.G", "Camisa social branca G")];
    const { linhas } = montarRelatorio({ skus, products });
    const porSku = Object.fromEntries(linhas.map((l) => [l.sku, l]));
    assert.equal(porSku["BTG-000301"].decisao, "aprovar");
    assert.equal(porSku["BTG-000302"].conferir, 'código com 2 SKUs ativos (BTG-000302, BTG-000303) · products com outro nome: "CAMISA SOCIAL BRANCA"');
    assert.equal(porSku["BTG-000303"].decisao, "conferir");
    assert.equal(porSku["BTG-000304"].decisao, "aprovar");
    const semProducts = montarRelatorio({ skus: [skus[0]], products: [] }).linhas[0];
    assert.equal(semProducts.conferir, "sem registro em products");
  });

  it("products é lido por cliente e código: dois clientes com o mesmo código não se misturam", () => {
    const skus = [sku("BTG-000001", "A.01.0001.001.M", "Polo Masculino Piquet Preto"), { ...sku("ACM-000001", "A.01.0001.001.M", "Camiseta Acme Branca"), customer_code: "ACME" }];
    const products = [product("A.01.0001.001.M", "Polo Masculino Piquet Preto"), { ...product("A.01.0001.001.M", "Camiseta Acme Branca"), customer_code: "ACME" }];
    const { linhas } = montarRelatorio({ skus, products });
    assert.ok(linhas.every((l) => !l.conferir.includes("products")), linhas.map((l) => l.conferir).join(" | "));
  });

  it("gênero do nome diferente do campo e campo Tamanho diferente do código", () => {
    const skus = [sku("BTG-000401", "A.01.0805.002.PP", "Polo feminina piquet azul marinho PP", { tamanho: "P" })];
    const { linhas } = montarRelatorio({ skus, products: [product("A.01.0805.002.PP", skus[0].produto)] });
    assert.equal(linhas[0].nome_proposto, "Polo Feminino Piquet Azul-Marinho");
    assert.equal(linhas[0].tamanho_proposto, "PP");
    assert.equal(linhas[0].conferir, "campo Tamanho (P) diferente do código (PP) · gênero do nome (Feminino) diferente do campo Gênero (Masculino)");
  });
});

describe("relatório: filtros e leitura", () => {
  it("arquivados ficam fora e são contados; --com-arquivados inclui com a marca", () => {
    const skus = [...FAMILIA, sku("BTG-000999", "A.01.0806.005.EG", "Polo masculino piquet preto EG", { archived: true })];
    const sem = montarRelatorio({ skus, products: PRODUCTS_DA_FAMILIA });
    assert.equal(sem.linhas.length, 7);
    assert.equal(sem.resumo.arquivados_ignorados, 1);
    const com = montarRelatorio({ skus, products: PRODUCTS_DA_FAMILIA, comArquivados: true });
    assert.equal(com.linhas.length, 8);
    assert.ok(com.linhas.find((l) => l.sku === "BTG-000999").conferir.includes("arquivado"));
  });

  it("cliente e família filtram; a família aceita minúsculas", () => {
    const skus = [...FAMILIA, sku("BTG-000501", "C.0659.001.U", "Toalha de academia"), { ...sku("ACM-000001", "X.01.0001.001.P", "Camiseta ACME P"), customer_code: "ACME" }];
    const btg = montarRelatorio({ skus, products: [], cliente: "BTG" });
    assert.equal(btg.linhas.length, 8);
    const familia = montarRelatorio({ skus, products: [], familia: "a.01.0806.005" });
    assert.equal(familia.linhas.length, 7);
  });

  it("linhaDoSku lê os nomes antigos dos campos", () => {
    const linha = linhaDoSku("BTG-000001", { customer_code: "BTG", client_item_code: "A.01.0001.001.M", product_name: "Polo", size: "M", status: "archived", estoque_atual: "3" });
    assert.deepEqual(linha, { sku: "BTG-000001", cliente: "BTG", codigo: "A.01.0001.001.M", nome: "Polo", tamanho: "M", genero: "", estoque: 3, arquivado: true });
  });
});

describe("relatório: o CSV e o resumo", () => {
  it("BOM, ponto e vírgula, CRLF e aspas onde precisa", () => {
    const { linhas } = montarRelatorio({ skus: [sku("BTG-000601", "A.01.0601.001.P", 'Polo "piquet"; mescla P')], products: [] });
    const csv = csvDoRelatorio(linhas);
    assert.ok(csv.startsWith("﻿"));
    const [cabecalho, primeira] = csv.slice(1).split("\r\n");
    assert.equal(cabecalho, COLUNAS.map(([, rotulo]) => rotulo).join(";"));
    assert.ok(primeira.includes('"Polo ""piquet""; mescla P"'));
    assert.ok(csv.endsWith("\r\n"));
  });

  it("o resumo em texto diz o que foi lido e o que mudou", () => {
    const { resumo } = montarRelatorio({ skus: FAMILIA, products: PRODUCTS_DA_FAMILIA });
    const texto = textoDoResumo(resumo);
    assert.ok(texto.includes("7 SKUs lidos (7 products), 0 arquivados fora."));
    assert.ok(texto.includes("7 linhas em 1 famílias; 1 famílias com mudança."));
    assert.ok(texto.includes("Decisão: aprovar 7."));
    assert.ok(texto.includes("tamanho no nome 6"));
  });
});
