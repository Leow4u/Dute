import assert from "node:assert/strict";
import { test } from "node:test";

import { tamanhoDoCodigo } from "../padronizar-nomes/regras.mjs";
import { ErroDaCorrecao, conferirCorrecao } from "./comum.mjs";
import { ajustesTransferidos, caixaMudou, chaveDoMovimento, descreverPassos, linhasTransferidas, oErradoNaCaixa, skuCodesTrocados, transferenciasPorPosicao } from "./transferir.mjs";

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

// Como a recountWarehouseBox grava: o ajuste com sinal, o id da contagem e a hora.
const ajuste = (sku_code, qty, extra = {}) => ({ recount_id: "brc_1", sku_code, qty, at: "2026-11-17T17:05:00.000Z", ...extra });
const xg = { sku: "BTG-000074", codigo: "A.01.0806.005.XG", nome: "Polo Masculino Piquet Preto", tamanho: "XG" };

test("o que passa para o certo é o que a caixa tem do errado pela regra: a linha mais o ajuste da recontagem (17/11/2026)", () => {
  const linha = { sku_code: "BTG-000092", counted_qty: 41 };
  const recontada = { count_adjustments: [ajuste("BTG-000092", -1), ajuste("BTG-000090", -2)] };
  assert.deepEqual(
    (({ entrada, ajustado, qtde }) => ({ entrada, ajustado, qtde }))(oErradoNaCaixa(recontada, linha, "BTG-000092")),
    { entrada: 41, ajustado: -1, qtde: 40 },
    "o ajuste das GG da mesma caixa não conta",
  );
  assert.equal(oErradoNaCaixa({}, linha, "BTG-000092").qtde, 41, "sem recontagem, a linha");
  assert.equal(oErradoNaCaixa({ count_adjustments: [ajuste("BTG-000092", -41)] }, linha, "BTG-000092").qtde, 0, "a recontagem achou zero");
});

test("o ajuste da recontagem do errado vai junto para o certo; o dos outros itens fica", () => {
  const foraDaLista = ajuste("BTG-000092", 2, { client_item_code: "A.01.0806.005.XGG", product_name: "Polo Masculino Piquet Preto", size: "XGG", moved_from: [{ box_code: "CX-000215", qty: 2 }] });
  const antes = [ajuste("BTG-000092", -1, { round_id: "rodada-1" }), ajuste("BTG-000090", -2), foraDaLista, null];
  const depois = ajustesTransferidos(antes, "BTG-000092", xg);
  assert.deepEqual(depois[0], { ...antes[0], sku_code: "BTG-000074" }, "a contagem, a hora e a rodada ficam");
  assert.equal(depois[1], antes[1], "o ajuste das GG fica como estava");
  assert.deepEqual(depois[2], { ...foraDaLista, sku_code: "BTG-000074", client_item_code: "A.01.0806.005.XG", size: "XG" }, "o item fora da lista leva o código e o tamanho do certo, e de onde veio");
  assert.equal(depois[3], null);
  assert.deepEqual(ajustesTransferidos(undefined, "BTG-000092", xg), []);
});

test("a caixa que mudou depois do plano (outra recontagem, uma separação) recusa a retomada", () => {
  const caixa = (extra) => ({ lines: [{ sku_code: "BTG-000092", counted_qty: 41 }], ...extra });
  const doPlano = { codigo: "CX-000227", qtde: 40 };
  assert.equal(caixaMudou(caixa({ count_adjustments: [ajuste("BTG-000092", -1)] }), doPlano, "BTG-000092", "A.01.0806.005.XGG"), null);
  assert.equal(
    caixaMudou(caixa({ count_adjustments: [ajuste("BTG-000092", -1), ajuste("BTG-000092", -1, { recount_id: "brc_2" })] }), doPlano, "BTG-000092", "A.01.0806.005.XGG"),
    "a caixa CX-000227 mudou depois do plano: ele leva 40 de A.01.0806.005.XGG (BTG-000092), e ela tem 39 pela regra (recontagem: −1 em 17/11/2026, 14:05, contagem brc_1; −1 em 17/11/2026, 14:05, contagem brc_2)",
  );
  assert.match(caixaMudou(caixa({ taken_lines: [{ sku_code: "BTG-000092", qty: 41 }] }), { codigo: "CX-000227", qtde: 41 }, "BTG-000092", "A.01.0806.005.XGG"), /ela tem 0 pela regra \(a separação tirou 41\)$/);
  assert.equal(caixaMudou({ lines: [] }, doPlano, "BTG-000092", "A.01.0806.005.XGG"), null, "sem a linha, a conferência de sempre recusa");
});

test("a prateleira em que a recontagem deixou zero do errado não tem movimento, e o dry-run diz o ajuste que vai junto", () => {
  assert.deepEqual(transferenciasPorPosicao([{ codigo: "CX-000227", qtde: 0, posicao: "B-02" }]), []);
  const leitura = {
    plano: {
      de: "A.01.0806.005.XGG",
      sku_de: "BTG-000092",
      alvo: xg,
      caixas: [{ codigo: "CX-000227", qtde: 40, entrada: 41, ajustado: -1, posicao: "B-02" }],
      item_nf: { line_number: 2 },
    },
    passos: { movimentos: [{ posicao: "B-02", qtde: 40, saida: false, entrada: false }], caixa: false },
    remocao: { apaga: true, motivos: [] },
  };
  const textos = descreverPassos(leitura).map((p) => p.texto);
  assert.equal(textos[0], "SAIDA 40 de BTG-000092 (A.01.0806.005.XGG) em B-02 · Ajuste −, não cobra");
  assert.equal(textos[2], 'CX-000227: a linha de 41 un. passa para BTG-000074 · A.01.0806.005.XG · "Polo Masculino Piquet Preto" · tamanho XGG → XG · o ajuste da recontagem (−1) vai junto, e a caixa fica com 40 do certo (a etiqueta impressa fica velha)');
  const zerada = { ...leitura, plano: { ...leitura.plano, caixas: [{ codigo: "CX-000227", qtde: 0, entrada: 41, ajustado: -41, posicao: "B-02" }] }, passos: { movimentos: [], caixa: false } };
  assert.equal(descreverPassos(zerada).map((p) => p.texto)[0], "nenhum movimento: pela recontagem, as caixas não têm peça do errado; só a linha e o ajuste mudam de SKU");
});
