import assert from "node:assert/strict";
import { test } from "node:test";

import { chaveDoMovimento, linhasTransferidas, skuCodesTrocados, transferenciasPorPosicao } from "./transferir.mjs";

const alvo = { sku: "BTG-000142", codigo: "A.01.0810.002.M", nome: "Polo Masculino Piquet Azul-Gralha", tamanho: "M" };

test("o que sai e entra por prateleira: as caixas somadas onde estão, e a caixa sem saldo fica de fora", () => {
  assert.deepEqual(
    transferenciasPorPosicao([
      { codigo: "CX-000229", qtde: 12, posicao: "B-07" },
      { codigo: "CX-000230", qtde: 3, posicao: "A-03" },
      { codigo: "CX-000231", qtde: 2, posicao: "B-07" },
      { codigo: "CX-000232", qtde: 5, posicao: null },
    ]),
    [{ posicao: "A-03", qtde: 3 }, { posicao: "B-07", qtde: 14 }],
  );
  assert.deepEqual(transferenciasPorPosicao([{ codigo: "CX-000229", qtde: 4, posicao: null }]), []);
});

test("a linha do SKU errado passa para o certo; as outras ficam como estão", () => {
  const linhas = [
    { inbound_item_id: "i1", line_number: 1, sku_code: "BTG-000213", client_item_code: "A.02.0810.002.M", product_name: "Polo Feminino Piquet Azul-Gralha", size: "M", counted_qty: 12 },
    { inbound_item_id: "i2", line_number: 2, sku_code: "BTG-000143", client_item_code: "A.01.0810.002.G", product_name: "Polo Masculino Piquet Azul-Gralha", size: "G", counted_qty: 10 },
  ];
  const novas = linhasTransferidas(linhas, "BTG-000213", alvo);
  assert.deepEqual(novas[0], { inbound_item_id: "i1", line_number: 1, sku_code: "BTG-000142", client_item_code: "A.01.0810.002.M", product_name: "Polo Masculino Piquet Azul-Gralha", size: "M", counted_qty: 12 });
  assert.equal(novas[1], linhas[1]);
});

test("os SKUs da caixa trocam sem repetir, e a caixa por guardar, sem a lista, não ganha uma", () => {
  assert.deepEqual(skuCodesTrocados(["BTG-000143", "BTG-000213"], "BTG-000213", "BTG-000142"), ["BTG-000143", "BTG-000142"]);
  assert.deepEqual(skuCodesTrocados(["BTG-000142", "BTG-000213"], "BTG-000213", "BTG-000142"), ["BTG-000142"]);
  assert.equal(skuCodesTrocados(undefined, "BTG-000213", "BTG-000142"), undefined);
});

test("a chave de cada movimento é fixa por correção, passo e prateleira", () => {
  const correcao = { id: "cx-000229-a01-0810-002-m" };
  assert.equal(chaveDoMovimento(correcao, "saida", "B-07"), "corrigir-codigo:cx-000229-a01-0810-002-m:saida:B-07");
  assert.notEqual(chaveDoMovimento(correcao, "saida", "B-07"), chaveDoMovimento(correcao, "entrada", "B-07"));
});
