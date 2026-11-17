import assert from "node:assert/strict";
import { test } from "node:test";

import { contaDoSku, entradaDaCaixa, linhaDoMovimento, retiradoDaCaixa, textoDaCaixa, textoDaConta, textoDasDatas } from "./ler-estoque.mjs";

const instante = (iso) => ({ toDate: () => new Date(iso) });

test("o movimento diz a chegada e a NF, também na guarda por linha, que só tem a tarefa", () => {
  const chegadas = new Map([["rcpt-1", { numero: "AVL-1A2B", nf: "48377" }]]);
  const recebimento = { created_at: instante("2026-10-30T17:05:00Z"), tipo_mov: "ENTRADA", quantity: 30, location_id: "RECEBIMENTO", source: "wms_receiving", receipt_id: "rcpt-1" };
  assert.equal(linhaDoMovimento(recebimento, chegadas), "30/10/2026, 14:05 · ENTRADA 30 em RECEBIMENTO · recebimento · chegada AVL-1A2B (NF 48377) [wms_receiving]");
  const guarda = { created_at: instante("2026-10-30T17:20:00Z"), tipo_mov: "ENTRADA", quantity: 30, location_id: "B-02", source: "wms_putaway", putaway_task_id: "put-1" };
  assert.equal(linhaDoMovimento(guarda, chegadas, new Map([["put-1", "rcpt-1"]])), "30/10/2026, 14:20 · ENTRADA 30 em B-02 · guarda · chegada AVL-1A2B (NF 48377) [wms_putaway]");
  const daCaixa = { ...guarda, putaway_task_id: undefined, receipt_id: "rcpt-1", box_code: "CX-000227" };
  assert.match(linhaDoMovimento(daCaixa, chegadas), /· chegada AVL-1A2B \(NF 48377\) · CX-000227 \[wms_putaway\]$/);
});

test("o ajuste diz o motivo; a entrega, o pedido", () => {
  const ajuste = { created_at: instante("2026-11-03T13:00:00Z"), tipo_mov: "ENTRADA", quantity: 16, location_id: "B-10", source: "functions_manual_inventory", reason: "E-mail Cristiane 29/10, item 14: etiqueta do fornecedor da CX-000136: G 88" };
  assert.match(linhaDoMovimento(ajuste), /· ajuste · "E-mail Cristiane 29\/10, item 14: etiqueta do fornecedor da CX-000136: G 88" \[functions_manual_inventory\]$/);
  const entrega = { created_at: instante("2026-11-17T12:00:00Z"), tipo_mov: "SAIDA", quantity: 30, location_id: "B-02", source: "wms_shipping", order_number: "PED-0001" };
  assert.match(linhaDoMovimento(entrega), /SAIDA 30 em B-02 · entrega · pedido PED-0001 \[wms_shipping\]$/);
});

test("o que entrou na caixa: o conteúdo dela, ou as linhas da abertura; e o que a separação tirou", () => {
  const doRecebimento = { code: "CX-000227", lines: [{ sku_code: "BTG-000090", counted_qty: 30 }, { sku_code: "BTG-000092", counted_qty: 41 }], taken_lines: [{ sku_code: "BTG-000090", qty: 30 }] };
  assert.equal(entradaDaCaixa(doRecebimento, [], "BTG-000092"), 41);
  assert.equal(retiradoDaCaixa(doRecebimento, "BTG-000090"), 30);
  assert.equal(retiradoDaCaixa(doRecebimento, "BTG-000092"), 0);
  const daAbertura = { code: "CX-000138", lines: [] };
  const linhas = [
    { box_code: "CX-000138", sku_code: "BTG-000100", counted_qty: 61 },
    { box_code: "CX-000136", sku_code: "BTG-000100", counted_qty: 5 },
  ];
  assert.equal(entradaDaCaixa(daAbertura, linhas, "BTG-000100"), 61);
});

test("as datas por prateleira, como o Onde está", () => {
  assert.equal(
    textoDasDatas([
      { local: "A-09", pecas: 32, datas: [{ desde: "2026-10-16", pecas: 32 }] },
      { local: "B-02", pecas: 60, datas: [{ desde: "2026-10-30", pecas: 30 }, { desde: "2026-11-06", pecas: 30 }] },
      { local: "RECEBIMENTO", pecas: 4, datas: [] },
    ]),
    "A-09 desde 16/10/2026 32 · B-02 desde 30/10/2026 30, desde 06/11/2026 30 · RECEBIMENTO 4",
  );
  assert.equal(textoDasDatas([]), "nenhuma");
});

test("a caixa recontada: o ajuste da recontagem e o que fica pela regra (entrada − retirado + ajustes)", () => {
  // A CX-000136 da abertura: 72 G, 10 tirados pela separação e 2 a menos na recontagem de 17/11.
  const recontada = { code: "CX-000136", lines: [], taken_lines: [{ sku_code: "BTG-000100", qty: 10 }], count_adjustments: [{ recount_id: "brc_1", sku_code: "BTG-000100", qty: -2, at: "2026-11-17T17:05:00.000Z" }] };
  const linhas = [{ box_code: "CX-000136", sku_code: "BTG-000100", counted_qty: 72 }];
  const conta = contaDoSku(recontada, linhas, "BTG-000100");
  assert.deepEqual([conta.entrou, conta.saiu, conta.fica], [72, 10, 60]);
  assert.equal(textoDaConta(conta), "entrou 72 · separação tirou 10 · recontagem −2 em 17/11/2026, 14:05, contagem brc_1 · fica 60");
  // O item que só a recontagem pôs na caixa (fora da lista): não entrou, e fica.
  const comForaDaLista = { code: "CX-000138", lines: [], count_adjustments: [{ recount_id: "brc_2", sku_code: "BTG-000101", qty: 3, at: "2026-11-17T17:10:00.000Z", moved_from: [{ box_code: "CX-000140", qty: 3 }] }] };
  assert.equal(textoDaConta(contaDoSku(comForaDaLista, [], "BTG-000101")), "entrou 0 · separação tirou 0 · recontagem +3 em 17/11/2026, 14:10, 3 da CX-000140, contagem brc_2 · fica 3");
  // Sem recontagem, a conta de antes.
  const intacta = { code: "CX-000227", lines: [{ sku_code: "BTG-000090", counted_qty: 30 }], taken_lines: [{ sku_code: "BTG-000090", qty: 30 }] };
  assert.equal(textoDaConta(contaDoSku(intacta, [], "BTG-000090")), "entrou 30 · separação tirou 30 · fica 0");
});

test("--caixa: a caixa inteira, com a recontagem e o que fica de cada item", () => {
  const caixa = {
    status: "stored",
    location_id: "B-10",
    unit_count: 41,
    lines: [],
    taken_lines: [{ sku_code: "BTG-000099", qty: 1 }],
    count_adjustments: [
      { recount_id: "brc_2", sku_code: "BTG-000099", qty: -1, at: "2026-11-17T17:10:00.000Z" },
      { recount_id: "brc_2", sku_code: "BTG-000101", qty: 3, at: "2026-11-17T17:10:00.000Z", client_item_code: "A.01.0805.002.GG", moved_from: [{ box_code: "CX-000140", qty: 3 }] },
    ],
  };
  const abertura = [{ box_code: "CX-000138", sku_code: "BTG-000099", client_item_code: "A.01.0805.002.G", counted_qty: 41, location_id: "B-10" }];
  assert.equal(
    textoDaCaixa("CX-000138", caixa, abertura),
    "CX-000138 · stored em B-10 · 41 un. no registro · entrou: A.01.0805.002.G 41 · separação tirou: BTG-000099 1 · recontagem: A.01.0805.002.G −1 em 17/11/2026, 14:10, contagem brc_2; A.01.0805.002.GG +3 em 17/11/2026, 14:10, 3 da CX-000140, contagem brc_2 · fica: A.01.0805.002.G 39, A.01.0805.002.GG 3",
  );
  // A caixa do recebimento, sem recontagem: o conteúdo dela, e o que fica é a entrada menos o retirado.
  const doRecebimento = { status: "stored", location_id: "B-02", unit_count: 71, lines: [{ sku_code: "BTG-000090", client_item_code: "A.01.0806.005.GG", counted_qty: 30 }, { sku_code: "BTG-000074", client_item_code: "A.01.0806.005.XG", counted_qty: 41 }], taken_lines: [{ sku_code: "BTG-000090", qty: 30 }] };
  assert.equal(textoDaCaixa("CX-000227", doRecebimento, []), "CX-000227 · stored em B-02 · 71 un. no registro · entrou: A.01.0806.005.GG 30, A.01.0806.005.XG 41 · separação tirou: BTG-000090 30 · fica: A.01.0806.005.XG 41");
});
