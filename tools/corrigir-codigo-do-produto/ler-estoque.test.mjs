import assert from "node:assert/strict";
import { test } from "node:test";

import { entradaDaCaixa, linhaDoMovimento, retiradoDaCaixa, textoDasDatas } from "./ler-estoque.mjs";

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
