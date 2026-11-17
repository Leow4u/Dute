import assert from "node:assert/strict";
import { test } from "node:test";

import { tamanhoDoCodigo } from "../padronizar-nomes/regras.mjs";
import { ErroDaCorrecao, conferirCorrecao } from "./comum.mjs";
import { chaveDoMovimento, descreverPassos, linhasTransferidas, recusaDaRecontagem, skuCodesTrocados, transferenciasPorPosicao } from "./transferir.mjs";

const alvo = { sku: "BTG-000142", codigo: "A.01.0810.002.M", nome: "Polo Masculino Piquet Azul-Gralha", tamanho: "M" };

test("o tamanho só muda na transferência: o XGG que era XG vai para o SKU do XG", () => {
  const xgg = { cliente: "BTG Pactual", de: "A.01.0806.005.XGG", para: "A.01.0806.005.XG", caixas: ["CX-000227"], genero: "Masculino" };
  assert.doesNotThrow(() => conferirCorrecao(xgg, tamanhoDoCodigo, { tamanhoPodeMudar: true }));
  assert.throws(
    () => conferirCorrecao(xgg, tamanhoDoCodigo),
    (erro) => erro instanceof ErroDaCorrecao && /o tamanho muda \(A\.01\.0806\.005\.XGG → A\.01\.0806\.005\.XG\)/.test(erro.message),
    "no mesmo SKU, o tamanho do cadastro não muda",
  );
  const mesmoTamanho = { ...xgg, de: "A.02.0810.002.M", para: "A.01.0810.002.M" };
  assert.doesNotThrow(() => conferirCorrecao(mesmoTamanho, tamanhoDoCodigo));
});

test("o dry-run diz o tamanho que muda na linha da caixa", () => {
  const leitura = {
    plano: {
      de: "A.01.0806.005.XGG",
      sku_de: "BTG-000092",
      alvo: { sku: "BTG-000074", codigo: "A.01.0806.005.XG", nome: "Polo Masculino Piquet Preto", tamanho: "XG" },
      caixas: [{ codigo: "CX-000227", qtde: 41, posicao: "B-02" }],
      item_nf: { line_number: 2 },
    },
    passos: { movimentos: [{ posicao: "B-02", qtde: 41, saida: false, entrada: false }], caixa: false },
    remocao: { apaga: false, motivos: ["fica com 10 (B-02 51 hoje)"] },
  };
  const textos = descreverPassos(leitura).map((p) => p.texto);
  assert.deepEqual(textos.slice(0, 3), [
    "SAIDA 41 de BTG-000092 (A.01.0806.005.XGG) em B-02 · Ajuste −, não cobra",
    "ENTRADA 41 em BTG-000074 (A.01.0806.005.XG) em B-02 · Ajuste +, não cobra",
    'CX-000227: a linha de 41 un. passa para BTG-000074 · A.01.0806.005.XG · "Polo Masculino Piquet Preto" · tamanho XGG → XG (a etiqueta impressa fica velha)',
  ]);
  assert.equal(textos.at(-1), "não apaga BTG-000092: fica com 10 (B-02 51 hoje)");
});

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

test("a caixa recontada no SKU errado ou no certo recusa; o ajuste de outro item da caixa não atrapalha", () => {
  const plano = { de: "A.01.0806.005.XGG", skuDe: "BTG-000092", para: "A.01.0806.005.XG", skuPara: "BTG-000074" };
  const ajuste = (sku_code, qty, extra = {}) => ({ recount_id: "brc_1", sku_code, qty, at: "2026-11-17T17:05:00.000Z", ...extra });
  assert.equal(
    recusaDaRecontagem({ count_adjustments: [ajuste("BTG-000092", -1)] }, "CX-000227", plano),
    "a recontagem já ajustou A.01.0806.005.XGG (BTG-000092) na caixa CX-000227 (−1 em 17/11/2026, 14:05, contagem brc_1): as peças da caixa nesse item não são mais as da linha, e a correção não mexe no que a recontagem acertou",
  );
  assert.equal(
    recusaDaRecontagem({ count_adjustments: [ajuste("BTG-000074", 41, { from_loose: 41 })] }, "CX-000227", plano),
    "a recontagem já ajustou A.01.0806.005.XG (BTG-000074) na caixa CX-000227 (+41 em 17/11/2026, 14:05, 41 do saldo sem caixa, contagem brc_1): confira se ela já não pôs o código certo na caixa antes de corrigir",
  );
  assert.equal(recusaDaRecontagem({ count_adjustments: [ajuste("BTG-000090", -2)] }, "CX-000227", plano), null, "o ajuste das GG da mesma caixa");
  assert.equal(recusaDaRecontagem({ taken_lines: [{ sku_code: "BTG-000090", qty: 30 }] }, "CX-000227", plano), null, "a caixa nunca recontada");
});
