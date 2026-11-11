import assert from "node:assert/strict";
import { test } from "node:test";

import { camposDoCadastro, linhasCorrigidas, nomeProposto } from "./corrigir.mjs";
import { CORRECOES } from "./correcoes.mjs";

const BTG = "BTG Pactual";
const sku = (id, codigo, produto, extra = {}) => ({ id, customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo, produto, status: "active", ...extra });
const correcao = (extra = {}) => ({ cliente: BTG, de: "A.02.0810.002.M", para: "A.01.0810.002.M", caixas: ["CX-000229"], genero: "Masculino", nome: "familia", ...extra });
const errado = sku("BTG-000181", "A.02.0810.002.M", "Polo Feminino Piquet Preto", { tamanho: "M", genero: "Feminino" });

test("a correção da CX-000229 é a do e-mail do Guilherme", () => {
  const [cx229] = CORRECOES;
  assert.deepEqual([cx229.cliente, cx229.de, cx229.para, cx229.caixas, cx229.genero, cx229.nome], [BTG, "A.02.0810.002.M", "A.01.0810.002.M", ["CX-000229"], "Masculino", "familia"]);
  assert.equal(new Set(CORRECOES.map((c) => c.id)).size, CORRECOES.length, "o id de cada correção é único");
});

test("o nome vem da família do código novo, no padrão", () => {
  const skus = [
    errado,
    sku("BTG-000150", "A.01.0810.002.P", "POLO MASCULINO PIQUET PRETO P", { tamanho: "P" }),
    sku("BTG-000151", "A.01.0810.002.G", "Polo Masculino Piquet Preto", { tamanho: "G" }),
    sku("BTG-000160", "A.02.0810.002.P", "Polo Feminino Piquet Preto", { tamanho: "P" }),
  ];
  const nome = nomeProposto({ skus, correcao: correcao(), skuAtual: errado });
  assert.equal(nome.nome, "Polo Masculino Piquet Preto");
  assert.equal(nome.origem, "família A.01.0810.002 (P, G)");
  assert.equal(nome.erro, undefined);
  assert.equal(nome.nomes_da_familia, undefined);
});

test("família com dois nomes: o mais comum, com os nomes para conferir", () => {
  const skus = [
    errado,
    sku("BTG-000150", "A.01.0810.002.P", "Polo Masculino Piquet Preto", { tamanho: "P" }),
    sku("BTG-000151", "A.01.0810.002.G", "Polo Masculino Piquet Preto", { tamanho: "G" }),
    sku("BTG-000152", "A.01.0810.002.GG", "Polo Masculino Piquet Preta", { tamanho: "GG" }),
  ];
  const nome = nomeProposto({ skus, correcao: correcao(), skuAtual: errado });
  assert.equal(nome.nome, "Polo Masculino Piquet Preto");
  assert.deepEqual(nome.nomes_da_familia, ['"Polo Masculino Piquet Preto" (2)', '"Polo Masculino Piquet Preta" (1)']);
});

test("a família de outro cliente e o SKU arquivado não contam", () => {
  const skus = [
    errado,
    sku("PAN-000001", "A.01.0810.002.P", "Polo Masculino Pan", { customer_code: "PAN" }),
    sku("BTG-000150", "A.01.0810.002.P", "Polo Masculino Velha", { archived: true, status: "archived" }),
  ];
  const nome = nomeProposto({ skus, correcao: correcao(), skuAtual: errado });
  assert.equal(nome.nome, "Polo Masculino Piquet Preto", "sem família: o nome de hoje com Masculino");
  assert.match(nome.origem, /^nome de hoje com Masculino/);
});

test("sem família e sem gênero no nome de hoje, pede o nome exato", () => {
  const semGenero = sku("BTG-000181", "A.02.0810.002.M", "Polo Piquet Preto", { tamanho: "M" });
  const nome = nomeProposto({ skus: [semGenero], correcao: correcao(), skuAtual: semGenero });
  assert.equal(nome.nome, "");
  assert.match(nome.erro, /não diz o gênero/);
  assert.match(nome.erro, /nome: "\.\.\."/);
});

test("o nome da correção vale como está, no padrão, e precisa dizer o gênero", () => {
  const exato = nomeProposto({ skus: [errado], correcao: correcao({ nome: "POLO MASCULINO PIQUET PRETO M" }), skuAtual: errado });
  assert.equal(exato.nome, "Polo Masculino Piquet Preto", "o tamanho sai do nome e a caixa das letras entra no padrão");
  assert.equal(exato.origem, "o nome da correção");
  const outroGenero = nomeProposto({ skus: [errado], correcao: correcao({ nome: "Polo Feminino Piquet Preto" }), skuAtual: errado });
  assert.match(outroGenero.erro, /não fecha com o padrão|não diz Masculino/);
});

test("a família com o nome do outro gênero não passa", () => {
  const skus = [errado, sku("BTG-000150", "A.01.0810.002.P", "Polo Feminino Piquet Preto", { tamanho: "P" })];
  const nome = nomeProposto({ skus, correcao: correcao(), skuAtual: errado });
  assert.equal(nome.nome, "");
  assert.match(nome.erro, /Polo Feminino Piquet Preto/);
});

test("as linhas da caixa: só a do SKU corrigido muda", () => {
  const linhas = [
    { inbound_item_id: "i1", sku_code: "BTG-000181", client_item_code: "A.02.0810.002.M", product_name: "Polo Feminino Piquet Preto", size: "M", counted_qty: 12 },
    { inbound_item_id: "i2", sku_code: "BTG-000151", client_item_code: "A.01.0810.002.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 10 },
  ];
  const { linhas: novas, mudaram } = linhasCorrigidas(linhas, "BTG-000181", "A.01.0810.002.M", "Polo Masculino Piquet Preto");
  assert.equal(mudaram, 1);
  assert.deepEqual(novas[0], { ...linhas[0], client_item_code: "A.01.0810.002.M", product_name: "Polo Masculino Piquet Preto" });
  assert.equal(novas[1], linhas[1]);
});

test("o cadastro muda nos campos que o documento tem", () => {
  const novo = { para: "A.01.0810.002.M", nome: "Polo Masculino Piquet Preto", genero: "Masculino" };
  assert.deepEqual(camposDoCadastro({ produto: "x" }, novo), { cod_cliente: "A.01.0810.002.M", cod_cliente_key: "A.01.0810.002.M", produto: "Polo Masculino Piquet Preto", genero: "Masculino" });
  assert.deepEqual(camposDoCadastro({ produto: "x", name: "x", client_item_code: "A.02.0810.002.M" }, novo), {
    cod_cliente: "A.01.0810.002.M",
    cod_cliente_key: "A.01.0810.002.M",
    produto: "Polo Masculino Piquet Preto",
    genero: "Masculino",
    name: "Polo Masculino Piquet Preto",
    client_item_code: "A.01.0810.002.M",
  });
});
