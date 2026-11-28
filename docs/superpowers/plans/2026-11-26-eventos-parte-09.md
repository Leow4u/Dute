# Eventos · parte 9: o retorno ao estoque

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o retorno da edição registrado numa transação só: item a item
(voltou, avariadas, não voltaram), a ENTRADA do que voltou na EXPEDICAO com a
guarda de volta à prateleira de onde saiu, as avariadas como devolução para
a triagem de Devoluções, a coleta, o `feito` do momento `retorno_ao_estoque`
e a edição em `retornado`; o bloco do retorno na ficha da Armazenagem; o
item "Retorno do evento para registrar" no Início; a linha da régua.

**Architecture:** `functions/wms/src/domain/eventos/retorno.ts` (as regras
puras e a transação `receiveEventReturnTransaction`), reaproveitando de
`../operations.js` o que o cancelamento usa para devolver o separado à
EXPEDICAO (`createMovement`, `readRows`, `skuBalancesQuery`, `clientSplit`,
`balancesAfter`, `updateClientInventory`, `applyCatalogStockAggregates`),
`resolveGuardDestination` de `../warehouse-positions.js` e
`LOCAL_DO_CANCELADO` de `../order-cancel.js`; a devolução das avariadas
escrita na mesma transação, no formato de `createReturnReceiptTransaction`
(que abre transação própria e por isso não entra), com a paridade travada
no teste; uma callable de uma linha (`requireWarehouseWrite`); no app,
`lib/eventos/retorno.ts` puro e o bloco `features/eventos/retorno-da-edicao.tsx`
dentro da ficha da parte 8; o Início pela leitura da agenda da parte 7.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test` com
o emulador; React, react-query, vitest, axe-core no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
retorno ao estoque", "Os status e quem move cada um", "As callables", "A
edição, campo a campo", "As telas › Armazenagem" (o retorno na ficha e o
Início), "Limites e mensagens", "Testes e travas". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`.

## Global Constraints

As do índice. Nesta parte, ainda: a ENTRADA do retorno é interna, origem
`functions_event_return`, fora de `ORIGENS_QUE_CONTAM` (o relógio do
estoque) e de `billingMovementDirection` (a cobrança): nenhum dos dois muda,
e a régua prova; nada se escreve em `orders` (o pedido fica `ENTREGUE`; o
`receiveOrderReturn` recusa o pedido de evento desde a parte 6); um retorno
por edição; o portal não muda (parte 11); nenhum valor em `retorno.ts`, no
bloco da ficha nem no payload.

## Review Focus

1. O retorno com o pedido `EXPEDIDO` recusa com "O pedido ainda não foi
   entregue." e nada se grava: nem saldo, nem movimento, nem a edição (T1,
   caso 3).
2. Depois do retorno, outra chave recusa com "O retorno desta edição já foi
   registrado." e a ENTRADA não se repete; a mesma chave devolve o mesmo
   resultado (T1, caso 2).
3. O SKU separado de duas prateleiras volta pela guarda à prateleira de onde
   saiu mais; a que não recebe mais guarda deixa a guarda sem destino, e quem
   guarda escolhe (T1, casos 1 e 7).
4. A edição só com coleta (sem pedido) registra o retorno sem mexer no
   estoque e sem devolução (T1, caso 6).
5. O `wms` abre o bloco do retorno sem preço algum: o bloco não lê
   `client_event_prices` e a lista dos textos não tem "R$" (T4).

---

### Task 1: `retorno.ts`, as regras e a transação

**Files:**
- Create: `functions/wms/src/domain/eventos/retorno.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`, no mecanismo de `patch.cronograma.<n>.observacao`: `itens.<n>.observacao` → "A observação de <client_item_code ou sku_code da linha>", `itens.<n>.voltou` → "O que voltou de <código>", `itens.<n>.avariadas` → "As avariadas de <código>", `itens` → "O retorno" com unidade "itens", `coleta.voltou` → "O que voltou da coleta"; a `observacao` da raiz não entra no mapa global, porque a parte 8 usa a mesma chave para o momento: o rótulo dela vem de `ROTULOS_DO_RETORNO`, o mapa por chamada, que prevalece sobre `ROTULO_DO_CAMPO`)
- Modify: `functions/wms/package.json` (`test:unit`: `lib/domain/eventos/retorno.test.js`; `test:integration`: `lib/domain/eventos/retorno.integration.test.js`, depois de `momentos.integration.test.js`)
- Test: `functions/wms/src/domain/eventos/retorno.test.ts` (puro) e `functions/wms/src/domain/eventos/retorno.integration.test.ts` (emulador; T2 acrescenta os casos da devolução)

**Interfaces:**
- Consumes: `entradaDe<T>(schema, raw, rotulos?: Record<string, string>)` (o mapa por chamada prevalece sobre `ROTULO_DO_CAMPO`), `viewDaEdicao`, `type EdicaoView`, `ROTULO_DO_CAMPO` de `./edicao.js` (parte 2); `createEventoEvent` de `./eventos-auditoria.js` (parte 2; payload `retorno_registrado {edition_id, return_id, itens, voltaram, avariadas, nao_voltaram}`); `EDICOES_COLLECTION` (o teste lê a edição por ela, sem o literal, e só a grava à mão onde o caso diz, como o 3), `OPERATIONS_COLLECTION`, `actorRef(actor: OperationalActor): ActorRef` e `type ActorRef = { uid: string; name: string | null; role: string }` de `./edicao-gravacao.js` (parte 2); só no teste, para o ajudante `edicaoNoEvento()` fazer a edição nascer pelo caminho real, `saveEventEditionTransaction` e `sendEventEditionTransaction(db, input, actor, deps)` de `./edicao-gravacao.js` (parte 2), `criarSolicitacaoDaEdicao(db, actor)` de `./envio.js` (parte 6) e `decideCustomerRequestTransaction` de `../operations.js`, cuja aprovação confirma a edição pelo gancho da parte 7 (`confirmarEdicaoNaAprovacao`); `lerEdicao(transaction, db, editionId)` (a leitura da equipe, `not-found` "Edição não encontrada."), `type FeitoDoMomento` de `./momentos.js` (parte 8); `LIMITES`, `naoVoltaram` de `./dominio.js` (parte 1); de `../operations.js`: `createMovement(transaction, db, id, {type, quantity, customerCode, skuCode, clientItemCode, productName, locationId, beforeQty, afterQty, source, occurredAt, entity}, actor)`, `movementId`, `readRows`, `skuBalancesQuery`, `clientSplit`, `balancesAfter`, `updateClientInventory` (`operations.ts:1010`), `resolveCatalogAggregateTargets`, `applyCatalogStockAggregates(transaction, target, {onHand, cost})` (`:1270`), `assertInventoryOperationsEnabled`, `type OperationalActor`, `type Row`; `resolveGuardDestination(destination, positions, customerCode)` de `../warehouse-positions.js:121`; `LOCAL_DO_CANCELADO` de `../order-cancel.js`; `nomeComTamanho({nome, codigo, tamanho})` de `../nome-do-produto.js`; `digest` local (sha256 hex, como `count-rounds.ts`), sem cópia de `actorRef`.
- Produces:
  - `EVENT_RETURN_SOURCE = "functions_event_return"`.
  - `ItemDoRetornoSchema` (`.strict()`: `sku_code` 1..120, `client_item_code` ≤120 nullish, `voltou` e `avariadas` int 0..1_000_000, `observacao` ≤120 nullish); `ReceberRetornoSchema` (`.strict()`: `edition_id` 1..120, `chegou_em` string, `itens` array ≤100, `coleta: { voltou: int 0..1_000_000 }` opcional, `observacao` ≤500 nullish, `idempotency_key` 8..200); `type ReceberRetorno`.
  - `ROTULOS_DO_RETORNO: Record<string, string> = { observacao: "A observação do retorno" }`, o mapa por chamada que toda leitura de `ReceberRetornoSchema` passa a `entradaDe` (a callable, o teste puro e o ajudante da integração); a parte 8 passa o dela, `{ observacao: "A observação do momento" }`, e nenhuma das duas grava `observacao` em `ROTULO_DO_CAMPO`.
  - `nomeDoItem(item: { product_name; client_item_code; size }): string` = `nomeComTamanho({ nome, codigo, tamanho })`.
  - `problemaDoRetorno(edicao: EdicaoView, pedido: { status: string } | null, input: ReceberRetorno): string | null`, nesta ordem: `enviado`/`confirmado`/`separado` → "A edição ainda não está no evento."; `retornado`/`fechado` ou `retorno` já gravado → "O retorno desta edição já foi registrado."; `cancelado` → "A edição foi cancelada."; `chegou_em` que não é instante → "Informe a hora da chegada"; com `pedido` e `status !== "ENTREGUE"` → "O pedido ainda não foi entregue."; linha de SKU fora da edição → "O item <sku_code> não é desta edição."; item com `foi > 0` sem linha → "Falta a linha do retorno de <nome>"; `voltou + avariadas > foi` → "<nome>: voltou e avariadas passam do que foi (<foi>)"; `coleta.quantidade > 0` sem `coleta.voltou` → "Informe o que voltou da coleta"; `coleta.voltou > quantidade` → "O que voltou da coleta passa do que foi coletado (<quantidade>)".
  - `type LinhaDoRetorno = { sku_code; client_item_code: string | null; product_name; size: string | null; foi; voltou; avariadas; nao_voltaram; observacao: string | null }`; `linhasDoRetorno(edicao, input): LinhaDoRetorno[]` (um por item com `foi > 0`, `nao_voltaram = naoVoltaram(foi, voltou, avariadas)`); `totaisDoRetorno(linhas): { itens; voltaram; avariadas; nao_voltaram }`.
  - `prateleiraDeOrigem(reservas: ReadonlyArray<{ sku_code; location_id; consumed_qty }>, skuCode): string | null` = a prateleira de onde o SKU saiu mais (empate: a primeira em ordem alfabética); sem reserva, null.
  - `type ResultadoDoRetorno = { ok: true; edition_id; status: "retornado"; return_id: string | null; itens; voltaram; avariadas; nao_voltaram; coleta: { voltou; distribuidos } | null; guardas: Array<{ putaway_task_id; sku_code; quantity; destination: string | null }>; events: OperationalEventSummary[] }`.
  - `receiveEventReturnTransaction(db, input: ReceberRetorno, actor: OperationalActor): Promise<ResultadoDoRetorno>`, uma `db.runTransaction`, leituras antes das escritas. Lê: o recibo `op_evento_return_<digest({ edition: edition_id, nonce: idempotency_key })>` (mesma chave e `input_hash` → o `result`; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."); `assertInventoryOperationsEnabled`; `lerEdicao` e `viewDaEdicao`; com `pedido.order_id`, `orders/{id}`, `stock_reservations where order_id ==` (as `consumed`, para a origem) e `warehouse_positions`; `problemaDoRetorno` → `failed-precondition`; por SKU com `voltou > 0`, `skuBalancesQuery` e `resolveCatalogAggregateTargets`. Escreve, por SKU com `voltou > 0`: o saldo da EXPEDICAO (a linha existente pelo `location_id`, ou nova `bal_<digest({ customerCode, skuCode, locationId })>` com `source: EVENT_RETURN_SOURCE`) com `qty_on_hand + voltou`, `qty_available = on_hand − reserved` e `status`; a ENTRADA `createMovement(movementId(operationId, "return_in_<n>"), { type: "ENTRADA", quantity: voltou, locationId: LOCAL_DO_CANCELADO, source: EVENT_RETURN_SOURCE, occurredAt: chegou_em, entity: { edition_id, order_id, order_number, putaway_task_id, destino: LOCAL_DO_CANCELADO, movement_kind: "event_return_in" } })`; a guarda `putaway_tasks/put_<digest({ editionId, skuCode, motivo: "event_return" })>` como a do cancelamento (`operations.ts:7016-7080`): `source_location_id: LOCAL_DO_CANCELADO`, `location_id` e `destination_location_id` só quando `resolveGuardDestination(prateleiraDeOrigem(…), positions, customerCode)` devolve `code`, `quantity`, `total_units`, `status: "planned"`, `title: "Guardar <nome>"`, `next_action: "Devolver à prateleira o que voltou do evento."`, `source: EVENT_RETURN_SOURCE`, `event_edition_id`, `order_id`, `order_number`; `updateClientInventory({ onHandDelta: voltou, split: clientSplit(balancesAfter(rows, [a escrita da EXPEDICAO])) })` (a EXPEDICAO não entra em `qty_available` nem em `qty_receiving`); `applyCatalogStockAggregates(target, { onHand: voltou, cost: voltou × unit_cost do saldo, quando há })`. Depois, a devolução (T2) e a edição: `itens[]` com `voltou`, `avariadas`, `nao_voltaram`, `observacao`; `coleta.voltou` e `coleta.distribuidos = quantidade − voltou` (só com `coleta.quantidade > 0`); `retorno: { chegou_em, registrado_por: actorRef(actor), registrado_em, observacao, return_id }`; o momento `retorno_ao_estoque`, quando existe, ganha o `FeitoDoMomento` `{ inicio: chegou_em, fim: null, observacao: null, origem: "retorno", registrado_por, registrado_em, corrigido_em: null }`; `status: "retornado"`, `edicao + 1`, `updated_*`; `createEventoEvent({ type: "evento.retorno_registrado", customer_code, edition_id, descricao: "<event_name> · <label>", payload })`; o recibo (`kind: "evento.return"`, `input_hash`, `result` sem `undefined`).

- [ ] **Step 1: Write the failing unit test**

`retorno.test.ts` (node:test, puro; `NECTON` é a `EdicaoView` montada no
teste: três itens com `foi` 1000, 700 e 300, `coleta.quantidade: 2190`,
`no_evento`; `ENTRADA`, o retorno certo: 996 + 2, 699 + 1, 299 + 0 e a coleta
1930): um `it` por recusa de `problemaDoRetorno`, as dez acima na ordem, com
os valores da Necton (sem a linha da caneca → "Falta a linha do retorno de
Caneca Necton"; polo 999 + 2 → "Polo Masculino Piquet Arpoador · G: voltou e
avariadas passam do que foi (1000)"; `BTG-999`; coleta 2191; `ENTRADA` → null);
e:

```ts
it("a conta da Necton: 1.994 voltaram, 3 avariadas, 3 não voltaram", () => {
  const linhas = linhasDoRetorno(NECTON, ENTRADA);
  assert.deepEqual(linhas.map((l) => l.nao_voltaram), [2, 0, 1]);
  assert.deepEqual(totaisDoRetorno(linhas), { itens: 3, voltaram: 1994, avariadas: 3, nao_voltaram: 3 });
});
it("a prateleira de origem é de onde o SKU saiu mais; sem reserva, nenhuma", () => {
  const reservas = [{ sku_code: "BTG-000101", location_id: "A-02", consumed_qty: 400 }, { sku_code: "BTG-000101", location_id: "A-01", consumed_qty: 600 }];
  assert.equal(prateleiraDeOrigem(reservas, "BTG-000101"), "A-01");
  assert.equal(prateleiraDeOrigem(reservas, "BTG-000102"), null);
});
it("a entrada recusa dizendo o campo", () => {
  const entrada = (raw: unknown) => entradaDe(ReceberRetornoSchema, raw, ROTULOS_DO_RETORNO); // como a callable lê
  assert.throws(() => entrada(comLinha({ sku_code: "BTG-000101", client_item_code: "A.01.0809.002", voltou: 996, avariadas: 2, observacao: "x".repeat(121) })), { code: "invalid-argument", message: "A observação de A.01.0809.002 passa de 120 caracteres" });
  assert.throws(() => entrada({ ...ENTRADA, observacao: "x".repeat(501) }), { message: "A observação do retorno passa de 500 caracteres" });
  assert.equal("observacao" in ROTULO_DO_CAMPO, false); // a parte 8 usa a mesma chave para o momento: o rótulo vem da chamada
  for (const errada of [comLinha({ sku_code: "BTG-000101", voltou: -1, avariadas: 0 }), { ...ENTRADA, extra: 1 }]) assert.throws(() => entrada(errada), { code: "invalid-argument" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/retorno.test.js`
Expected: FAIL (`./retorno.js` não existe).

- [ ] **Step 3: Implement the pure part of `retorno.ts`, `ROTULOS_DO_RETORNO`, the `ROTULO_DO_CAMPO` paths, and register the unit test**

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

`retorno.integration.test.ts`, com o `beforeEach` que limpa o emulador, os
atores e os ajudantes de `order-cancel.integration.test.ts` (`cliente`,
`coordenacao`, `armazem`, `avancar`, `separarEEmbalar`, `saldos`), as
posições `A-01` e `A-02` da zona da BTG e os saldos: `BTG-000101`
(`A.01.0809.002`, "Polo Masculino Piquet Arpoador", `size: "G"`) 600 na A-01
e 400 na A-02; `BTG-000102` (`J.0149.003`, "Sacola Quadrada BTG", "N1") 700
na A-02; `BTG-000103` (`B.0412.001`, "Caneca Necton") 300 na A-01. O ajudante
`edicaoNoEvento()` faz a edição nascer pelo caminho real, como
`confirmacao.integration.test.ts` (parte 7), sem gravar a edição à mão:
`saveEventEditionTransaction` com `cliente` (`name` "B2B Conference Necton"
e, no `patch`, `label: "2027"`, `onde.local` "Hotel Unique", o cronograma
`coleta_no_cliente` 2027-01-28 05:00, `entrega_no_local` 2027-01-28 08:30,
`evento` 2027-01-28 09:00 até 18:00 e `retorno_ao_estoque` 2027-01-30 09:00,
os três itens, 2.000 peças, e `coleta.quantidade: 2190`); o envio por
`sendEventEditionTransaction(db, { id, expected_edicao, idempotency_key, customer_code }, cliente, { criarSolicitacao: criarSolicitacaoDaEdicao(db, cliente) })`,
que cria a solicitação com os três itens e o `event_edition_id` na mesma
transação (parte 6); a aprovação por
`decideCustomerRequestTransaction(db, { request_id, action: "approve", expected_status: "open", idempotency_key }, coordenacao)`,
sem opção, que confirma a edição pelo gancho da parte 7, com o "separar
até" padrão (como o caso 6 de `confirmacao.integration.test.ts`); a
separação e o packing de sempre, `separarEEmbalar(order_id, pick_task_id)`
com os ids da aprovação, cujo gancho deixa a edição `separado` com o `foi`;
e a entrega de sempre, `entregar(shipmentId)`, com o `shipmentId` que
`separarEEmbalar` devolve:
`avancar("shipping:<shipmentId>", "ready_to_dispatch", { carrier: "Dutelog" })` e
`avancar("shipping:<shipmentId>", "dispatched", { proof_reference: "Recebido na doca do hotel", delivery_notes: "Recebido pelo cliente." })`.
Nenhum id é fixo: o ajudante devolve o `id` da edição, que
`saveEventEditionTransaction` gera, e o `order_id` e o `order_number` da
aprovação, e confere que os ganchos da parte 7 deixaram `no_evento` e `foi`
`[1000, 700, 300]`.
`CHEGOU = "2027-01-30T12:30:00.000Z"`; `retornar(chave, input?)` lê a
entrada por `entradaDe(ReceberRetornoSchema, …, ROTULOS_DO_RETORNO)`, como a
callable, com o `edition_id` que o ajudante devolveu, e chama a transação
com `armazem`.

```ts
it("1. o retorno da Necton: a ENTRADA na EXPEDICAO, a guarda de volta à origem, a edição retornada e o evento", ...)
// result: voltaram 1994, avariadas 3, nao_voltaram 3, coleta { voltou: 1930, distribuidos: 260 }; guardas: polo → A-01 (600 > 400), sacola → A-02, caneca → A-01
// stock_balances EXPEDICAO 996, 699, 299, as prateleiras em 0; client_inventory do polo: qty_on_hand 996, qty_available 0, qty_receiving 0
// movements: três ENTRADA, source "functions_event_return", occurred_at CHEGOU, entity.edition_id; billingMovementDirection(cada um, { snapshot: false }) === null
// a edição: retornado, itens[].voltou/avariadas/nao_voltaram, coleta 1930/260, retorno.chegou_em, retorno.registrado_por.uid "wms-1", o momento retorno_ao_estoque do cronograma (o id que o save gerou) com feito { inicio: CHEGOU, origem: "retorno" }, edicao = a lida logo antes do retorno + 1 (sem número fixo: os ganchos da parte 7 também somam)
// events: um "evento.retorno_registrado" com payload { edition_id, return_id, itens: 3, voltaram: 1994, avariadas: 3, nao_voltaram: 3 }
it("2. a mesma chave devolve o mesmo; outra chave recusa 'O retorno desta edição já foi registrado.' e os movimentos continuam três", ...)
it("3. com o pedido EXPEDIDO (a edição posta em no_evento à mão) recusa 'O pedido ainda não foi entregue.' e nada muda", ...)
it("4. a linha que falta e a que passa do que foi recusam dizendo o item", ...)
it("5. a observação de 121 caracteres e a coleta sem o que voltou recusam dizendo o campo", ...)
it("6. a edição só com coleta, sem pedido, registra a coleta e vira retornado sem movimento nem devolução", ...)
it("7. a guarda de volta é a de sempre, e a prateleira que saiu do cadastro deixa a guarda sem destino", ...)
// avancar(`putaway:${polo.putaway_task_id}`, "planned", { source_location_id: "EXPEDICAO", destination_location_id: "A-01", location_id: "A-01", quantity: 996 }): A-01 996, EXPEDICAO 0, client_inventory qty_available 996
// com A-02 em status "inactive" antes do retorno, a guarda da sacola nasce sem destination_location_id
it("8. o estoque congelado não grava nada", ...) // system_controls/inventory como em operations.integration.test.ts
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/retorno.integration.test.js"`
Expected: FAIL (a transação não existe).

- [ ] **Step 7: Implement `receiveEventReturnTransaction` and register the integration test**

A devolução (T2) ainda não: `return_id` fica null neste passo.

- [ ] **Step 8: Run tests to verify they pass**

Run: o comando do passo 6. Expected: PASS nos casos 1 a 8 (o caso 1 ainda
sem `returns`).

- [ ] **Step 9: Commit**

```bash
git add functions/wms/src/domain/eventos/retorno.ts functions/wms/src/domain/eventos/retorno.test.ts functions/wms/src/domain/eventos/retorno.integration.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/package.json
git commit -m "feat(wms): o retorno da edição do evento, com a ENTRADA na EXPEDICAO e a guarda de volta"
```

### Task 2: a devolução das avariadas

**Files:**
- Modify: `functions/wms/src/domain/eventos/retorno.ts`
- Test: `functions/wms/src/domain/eventos/retorno.integration.test.ts` (casos 9 a 11)

**Interfaces:**
- Consumes: `createReturnReceiptTransaction` de `../operations.js:3681` (só no teste, para a paridade); as coleções `returns` e `return_items`.
- Produces: `RETORNO_DO_EVENTO_FONTE = "retorno_do_evento"`, `chaveDaDevolucaoDoEvento(editionId) = "evento:<editionId>"`, `returnIdDoEvento(customerCode, editionId) = "ret_" + digest({ customer: customerCode, nonce: chaveDaDevolucaoDoEvento(editionId) })` (a fórmula de `createReturnReceiptTransaction`); `devolucaoDasAvariadas(transaction, db, { customerCode, edicao: EdicaoView, linhas: LinhaDoRetorno[], chegouEm, observacao, operationId }, actor): { return_id: string; event: OperationalEventSummary } | null` — só com alguma linha `avariadas > 0`; grava `returns/{returnIdDoEvento}` com os campos de `createReturnReceiptTransaction` (`source: RETORNO_DO_EVENTO_FONTE`, `reference: "Evento <event_name> · <label> · <order_number>"`, `notes` = a observação do retorno, `status: "received"`, `item_count`, `qty_total`, `qty_pending_disposition`, `received_at: chegouEm`, `created_by`, carimbos), um `return_items/reti_<returnId>_<nn>` por linha com `avariadas > 0` (`quantity: avariadas`, `condition: "damaged_return"`, `notes: observacao`, `status: "pending_disposition"`, `disposition: "pending"`, `source: "wms_return"`, `received_at`, `line_number`, `sku_code`, `client_item_code`, `product_name`) e o evento `return.received` (`title: "Devolução recebida para triagem"`, `severity: "attention"`, `entity_type: "return"`, id `evt_<digest({ operationId, suffix: "return_received" })>`, payload `{ return_id, reference, source, item_count, qty_total, items }`), tudo na transação do retorno. A edição grava `retorno.return_id`; o resultado e o `evento.retorno_registrado` levam o `return_id`.

- [ ] **Step 1: Write the failing tests**

```ts
it("9. as 3 avariadas nascem como devolução para triagem, com a referência da edição e do pedido, e a edição guarda o return_id", ...)
// returns: source "retorno_do_evento", reference `Evento B2B Conference Necton · 2027 · ${order_number}`, qty_total 3, item_count 2, qty_pending_disposition 3, received_at CHEGOU
// return_items: polo 2 e sacola 1, condition "damaged_return", notes "alça quebrada" na linha que a mandou, status "pending_disposition"; a caneca (0) sem linha
// o evento return.received existe; edicao.retorno.return_id === result.return_id === returns.id
it("10. a devolução tem os campos da devolução de sempre (paridade com createReturnReceiptTransaction)", ...)
// uma devolução avulsa pela função de operations.ts; toda chave de returns e de return_items dela (fora unit_cost) existe na do evento
it("11. sem avariadas não nasce devolução e return_id é null", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: o `emulators:exec` do T1. Expected: FAIL nos casos 9 a 11.

- [ ] **Step 3: Implement `devolucaoDasAvariadas` inside the transaction**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do T1, passo 6, e `node --test lib/domain/order-return.integration.test.js` no mesmo `emulators:exec` (o retorno do pedido de sempre continua igual). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/retorno.ts functions/wms/src/domain/eventos/retorno.integration.test.ts
git commit -m "feat(wms): as avariadas do retorno do evento nascem como devolução para triagem"
```

### Task 3: a callable, a matriz e o wrapper do app

**Files:**
- Modify: `functions/wms/src/index.ts` (uma linha no bloco "Eventos", depois de `saveEventEditionTeam`)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (uma linha na `MATRIZ`)
- Modify: `artifacts/app/src/lib/wms/eventos.ts` (`CALLABLES_DOS_EVENTOS` e o wrapper), `artifacts/app/src/lib/eventos/tipos.ts` (os tipos)
- Test: `artifacts/app/src/lib/wms/eventos.test.ts` (um `it`); `artifacts/app/src/lib/platform-lists.test.ts` já percorre a lista

**Interfaces:**
- Consumes: `getProfile`, `requireWarehouseWrite`, `PROJECT_ID`, `db` do `index.ts`; `assertEventosLiberado` (parte 1); `entradaDe(schema, raw, rotulos?)` (parte 2); `ReceberRetornoSchema`, `ROTULOS_DO_RETORNO`, `receiveEventReturnTransaction` (T1); `ARMAZEM` e `SO_ARMAZEM` da matriz; `semCamposVazios`, `erroDaCallable`, `functionsDoApp`, `firebaseApp` como em `lib/wms/mover-caixa.ts`.
- Produces: `export const receiveEventReturn = onCall(async (request) => { const profile = await getProfile(request); requireWarehouseWrite(profile); assertEventosLiberado(PROJECT_ID); return receiveEventReturnTransaction(db, entradaDe(ReceberRetornoSchema, request.data ?? {}, ROTULOS_DO_RETORNO), profile); });` numa linha (o mapa por chamada dá "A observação do retorno"); `receiveEventReturn: { passam: ARMAZEM, recusa: SO_ARMAZEM }`; no app, `"receiveEventReturn"` em `CALLABLES_DOS_EVENTOS`, os tipos `ItemDoRetorno`, `ReceberRetorno`, `ResultadoDoRetorno` em `lib/eventos/tipos.ts` e `receberRetorno(entrada: ReceberRetorno): Promise<ResultadoDoRetorno>`.

- [ ] **Step 1: Write the failing tests**

Na `MATRIZ`, a linha acima. Em `lib/wms/eventos.test.ts`: `receberRetorno`
chama `httpsCallable(…, "receiveEventReturn")` sem campos `undefined` (um
item com `observacao: undefined` chega sem a chave; sem `coleta`, a chave não
vai); `CALLABLES_DOS_EVENTOS` contém `"receiveEventReturn"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/platform-lists.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js"`
Expected: FAIL (a matriz tem linha sem callable; o wrapper não existe).

- [ ] **Step 3: Implement the callable, the list and the wrapper**

- [ ] **Step 4: Run tests to verify they pass**

Run: os do passo 2, mais `node --test lib/callables-auth.integration.test.js`
no mesmo `emulators:exec` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/tipos.ts
git commit -m "feat(wms): a callable receiveEventReturn, a matriz e o wrapper do app"
```

### Task 4: o bloco do retorno na ficha

**Files:**
- Create: `artifacts/app/src/lib/eventos/retorno.ts`
- Create: `artifacts/app/src/features/eventos/retorno-da-edicao.tsx`
- Modify: `artifacts/app/src/lib/eventos/ficha.ts` (parte 8: `LinhaDaFicha["acao"]` ganha `"registrar_retorno"`; `acaoDoMomento`: `retorno_ao_estoque` em `no_evento` com `opera` → `"registrar_retorno"`), `artifacts/app/src/pages/evento-view.tsx` e `artifacts/app/src/pages/evento.tsx` (parte 8: `PropsDaFicha` ganha `retorno: PropsDoRetorno | null`; o bloco abaixo de "A edição, momento a momento" em `no_evento`, `retornado` e `fechado`, nos dois últimos só com o `retorno` gravado; a mutação)
- Test: `artifacts/app/src/lib/eventos/retorno.test.ts`, `artifacts/app/src/features/eventos/retorno-da-edicao.test.tsx` (textos, `axe` e a interação); `artifacts/app/src/lib/eventos/ficha.test.ts` (parte 8: o `it` "as linhas na ordem da prancha" passa a esperar `"registrar_retorno"` na oitava posição, a Necton em `no_evento`; e duas asserções) e `artifacts/app/src/pages/evento-view.test.tsx` (parte 8: os estados dela, os cinco da T4 e o das três fotos da T6, passam `retorno: null`, porque a prop é obrigatória; a lista `PERMITIDOS` ganha os textos do bloco do retorno e o "Registrar retorno" da linha do momento; e três asserções)

**Interfaces:**
- Consumes: `EdicaoView`, `ReceberRetorno` de `lib/eventos/tipos.ts`; `naoVoltaram`, `LIMITES`, `nomeComTamanho` de `@workspace/dominio`; `textoDoMostrando(mostrando, total)`, `textoDoVerMais(proximos)`, `PAGINA_DO_VER_MAIS` de `lib/eventos/itens.ts` (parte 4); `LinhaDaFicha`, `linhasDaFicha`, `acaoDoMomento`, `textoDoPrevisto` de `lib/eventos/ficha.ts` e `EventoView(props: PropsDaFicha)` com `opera`, `onAdicionarFotos(momento_id, files)` (parte 8); `receberRetorno` (T3); `BotaoDeAcao`/`EstadoDaAcao`, `useTentativaDaEscrita`, `desfechoDoErro`; `canOperateWarehouse` de `lib/permissions`.
- Produces (`lib/eventos/ficha.ts`, parte 8, modificado): `LinhaDaFicha["acao"]` ganha `"registrar_retorno"`; `acaoDoMomento(momento, status, opera)` devolve `"registrar_retorno"` para o `retorno_ao_estoque` em `no_evento` com `opera` e, nos outros status ou sem `opera`, null, como na parte 8; a linha "Retorno ao estoque Dutelog" de `linhasDaFicha` leva essa ação, que a ficha desenha como "Registrar retorno".
- Produces (`lib/eventos/retorno.ts`): `LINHAS_A_VISTA_NO_RETORNO = 8`; `type LinhaDaTela = { sku_code; client_item_code: string | null; nome; foi; voltou: number | null; avariadas: number | null; observacao: string; tocada: boolean }`; `linhasIniciais(edicao)` (os itens com `foi > 0`, `nome = nomeComTamanho`); `preencherIguais(linhas)` (as não tocadas ganham `voltou = foi`, `avariadas = 0`, `tocada`); `comDiferenca(linha)` (tocada e `voltou + avariadas < foi` ou `avariadas > 0`); `contagens(linhas): { todos; comDiferenca; porConferir }`; `filtrarLinhas(linhas, filtro: "todos" | "diferenca" | "conferir", busca)` (nome ou código, sem acento e caixa); `problemaDaLinha(linha)` = "Voltou e avariadas passam do que foi (<foi>)"; `totaisDaTela(linhas): { foi; voltou; avariadas; naoVoltaram }`; `fraseDoRodape(totais)` = "<foi> peças foram · <voltou> voltam ao estoque · <n> não voltaram · <a> avariadas · a devolução nasce com elas" (com 1: "1 não voltou", "1 avariada · a devolução nasce com ela"; sem avariadas: "nenhuma avariada"; números em pt-BR); `distribuidosDaColeta(quantidade, voltou)`; `podeConfirmarRetorno(linhas, coleta): string | null` = "Confira os N itens por conferir, ou marque que os outros voltaram iguais." ou "Informe o que voltou da coleta" (o nome não repete o `podeConfirmar(role)` de `agenda.ts`, parte 7); `entradaDoRetorno({ editionId, chegouEm: Date, linhas, coletaVoltou, observacao, chave }): ReceberRetorno` (sem `undefined`; `coleta` só com quantidade).
- Produces (`retorno-da-edicao.tsx`): `type PropsDoRetorno = { podeRegistrar: boolean; estado: EstadoDaAcao; erro: string | null; onConfirmar: (entrada: ReceberRetorno) => Promise<void>; onFotos: () => void }`, exportado (o que a ficha recebe em `PropsDaFicha.retorno`), e `RetornoDaEdicao({ edicao, ...retorno }: { edicao: EdicaoView } & PropsDoRetorno)`. Em `no_evento` com `podeRegistrar`, o cartão da prancha: "Registrar o retorno ao estoque", "<textoDoPrevisto do momento> · <N> itens · <M> peças foram" (o previsto do momento `retorno_ao_estoque`, pelo `textoDoPrevisto` da parte 8: com o `previsto.hora` null (decisão 12 da spec: só a entrega no local exige a hora), a linha diz só o dia, "previsto 30/01 · <N> itens · <M> peças foram"), "Chegou em" (`datetime-local`, aria "Quando o retorno chegou", padrão agora), a busca ("Item ou código"; aria "Buscar item ou código"), os filtros `aria-pressed` "Todos", "Com diferença", "Por conferir" com o número, "Os outros N voltaram iguais", a tabela Item, Código, Foi, Voltou, Avariadas, Observação (inputs com aria "Voltou: <nome>", "Avariadas: <nome>", "Observação: <nome>", `maxLength` 120), a linha "Produtos coletados no cliente" (Foi, "Voltou: produtos coletados no cliente", "<n> distribuídos"), oito linhas à vista com `textoDoMostrando` e `textoDoVerMais`, o rodapé com `fraseDoRodape`, "Fotos do retorno" (`onFotos`: o "Adicionar fotos" da parte 8, `onAdicionarFotos`, com o `id` do momento `retorno_ao_estoque`) e "Confirmar retorno" (`BotaoDeAcao`, andamento "Registrando…"); a recusa (`podeConfirmarRetorno` ou `erro`) numa linha `role="alert"` do rodapé, com o foco na primeira linha por conferir; o "Registrar retorno" da linha do momento leva o foco a "Chegou em". Em `retornado` e `fechado`, só leitura, com o `retorno` gravado: "O que voltou ao estoque", "Chegou em <data hora> · <quem registrou>", a tabela como dados e o rodapé (sem o `retorno` gravado, a ficha não desenha o bloco).
- Produces (`pages/evento-view.tsx` e `pages/evento.tsx`, parte 8, modificados): `PropsDaFicha` ganha `retorno: PropsDoRetorno | null`; a página o dá `null` fora de `no_evento` a `fechado` (de `rascunho` a `separado` e em `cancelado`) e, em `no_evento`, `retornado` e `fechado`, `{ podeRegistrar, estado, erro, onConfirmar, onFotos }`; `EventoView` desenha `RetornoDaEdicao({ edicao, ...retorno })` abaixo de "A edição, momento a momento" quando `retorno` não é null, menos em `retornado` e `fechado` sem o `retorno` gravado (`edicao.retorno` null), onde o bloco não aparece.

- [ ] **Step 1: Write the failing tests**

`lib/eventos/retorno.test.ts` (vitest): a Necton da T1 em `EdicaoView`
(`linhasIniciais` → 3 linhas, `porConferir: 3`); depois de `voltou 996,
avariadas 2` no polo, `comDiferenca: 1`, `porConferir: 2`;
`preencherIguais` → `porConferir: 0`; `fraseDoRodape` → "2.000 peças foram ·
1.994 voltam ao estoque · 3 não voltaram · 3 avariadas · a devolução nasce
com elas" e, sem avariadas, termina em "nenhuma avariada"; `problemaDaLinha`
com 999 + 2 → "Voltou e avariadas passam do que foi (1000)";
`podeConfirmarRetorno` com duas por conferir → "Confira os 2 itens por
conferir, ou marque que os outros voltaram iguais."; `entradaDoRetorno` sem
`undefined`, `chegou_em` em ISO, `coleta: { voltou: 1930 }`;
`distribuidosDaColeta(2190, 1930) === 260`.
`ficha.test.ts`: `acaoDoMomento(retorno, "no_evento", true) === "registrar_retorno"`
e, em `confirmado`, null; e o `it` "as linhas na ordem da prancha" da parte 8
passa a esperar, para `admin`, as ações
`[null, "ver_pedido", "editar", "editar", "editar", "registrar_fim", "registrar", "registrar_retorno", "registrar", null]`
(a oitava, "Retorno ao estoque Dutelog", deixa de ser null; a lista do
`suporte` não muda).

`retorno-da-edicao.test.tsx`, no molde de `estoque-mapa-mover-view.test.tsx`
(`renderToStaticMarkup`; `textosDaTela` com as camadas do `BotaoDeAcao`
`["Registrando…", "Conferir"]`): a lista dos textos do bloco em `no_evento`
com dez itens (os rótulos acima, os nomes e códigos dos itens, os números,
`/^previsto .+ · \d+ itens · [\d.]+ peças foram$/`, `/^Os outros \d+ voltaram
iguais$/`, `/^\d+ distribuídos$/`, "Mostrando 8 de 10 itens", "Ver mais 2
itens", o rodapé por regex); `textosForaDaLista` vazio e nenhum texto com
"R$"; com o previsto do `retorno_ao_estoque` sem hora (`previsto.hora`
null, sem `ate` nem `local`, numa cópia do fixture, que continua com a hora
em todos os momentos), a linha do cartão diz só o dia,
`/^previsto \d{2}\/\d{2} · \d+ itens · [\d.]+ peças foram$/`; o `axe` em
`no_evento` e em `retornado`; sem `podeRegistrar` (o
`suporte`), nenhum input nem botão; a interação (como
`guarda-da-caixa.interacao.test.tsx`): 996 e 2 no polo mudam "Com diferença"
para 1, "Os outros 2 voltaram iguais" zera "Por conferir", "Confirmar
retorno" antes disso mostra a frase de `podeConfirmarRetorno` e não chama
`onConfirmar`; depois, chama com a entrada da tela.

`evento-view.test.tsx` (parte 8): os estados dela (os cinco da T4 e o das
três fotos da T6) passam `retorno: null` (a prop é obrigatória; com ela
null, o bloco não aparece);
a lista `PERMITIDOS` ganha "Registrar retorno" (a ação da linha "Retorno ao
estoque Dutelog") e os textos do bloco do retorno com os dados do fixture:
os rótulos e as regex da lista de `retorno-da-edicao.test.tsx`, os nomes e
os códigos dos itens, os números, as camadas do `BotaoDeAcao` de "Confirmar
retorno" ("Registrando…" e "Conferir") e, do bloco só de leitura, "O que
voltou ao estoque" e `/^Chegou em .+ · .+$/`; `foraDaLista(html, PERMITIDOS)`
continua `[]` em cada estado do teste e na Necton em `no_evento` com o
bloco. As três asserções: a ficha da Necton em `no_evento`, com `retorno`
(`podeRegistrar: true`), tem "Registrar o retorno ao estoque" e "Registrar
retorno"; em `confirmado`, com `retorno: null`, nenhum dos dois; e a
`fechado` com `edicao.retorno` null (a da parte 8, que nasce antes do
retorno), mesmo com `retorno` (`podeRegistrar: false`), não tem "O que
voltou ao estoque".

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/retorno.test.ts src/lib/eventos/ficha.test.ts src/features/eventos/retorno-da-edicao.test.tsx src/pages/evento-view.test.tsx`
Expected: FAIL (módulos não existem; `acaoDoMomento` devolve null).

- [ ] **Step 3: Implement the pure rules, the block and the page wiring**

Em `evento.tsx`: `useMutation({ mutationFn: receberRetorno })` com a chave
de `useTentativaDaEscrita`; sucesso → toast "Retorno registrado" (a edição
ao vivo já chega em `retornado`); erro → `desfechoDoErro`, a frase do
servidor no bloco; `podeRegistrar = canOperateWarehouse(role) && status ===
"no_evento"`; o `retorno` de `PropsDaFicha` é `null` fora de `no_evento`,
`retornado` e `fechado` e, nos três, `{ podeRegistrar, estado, erro, onConfirmar, onFotos }`,
com o `estado` e o `erro` da mutação e o `onFotos` do "Adicionar fotos" da
parte 8 no momento `retorno_ao_estoque`. Carregamento v2 e a trava
`lib/carregando/trava.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/retorno.ts artifacts/app/src/lib/eventos/retorno.test.ts artifacts/app/src/lib/eventos/ficha.ts artifacts/app/src/lib/eventos/ficha.test.ts artifacts/app/src/features/eventos/retorno-da-edicao.tsx artifacts/app/src/features/eventos/retorno-da-edicao.test.tsx artifacts/app/src/pages/evento-view.tsx artifacts/app/src/pages/evento-view.test.tsx artifacts/app/src/pages/evento.tsx
git commit -m "feat(app): o bloco do retorno ao estoque na ficha da edição"
```

### Task 5: "Retorno do evento para registrar" no Início

**Files:**
- Modify: `artifacts/app/src/lib/eventos/agenda.ts` (`edicoesNoEvento`, ao lado de `edicoesEnviadas`; `HomeEventEdition` já nasce com `status` na parte 7), `artifacts/app/src/lib/home-inbox.ts` (o item), `artifacts/app/src/lib/inicio-do-wms.ts` (`ICONE_DO_ITEM`), `artifacts/app/src/lib/use-inicio-do-wms.ts` (a segunda leitura)
- Test: `artifacts/app/src/lib/home-inbox.test.ts`, `artifacts/app/src/pages/home-view.test.tsx` (uma asserção)

**Interfaces:**
- Consumes: `buildHomeInbox({ …, eventEditions?: HomeEventEdition[] })`, `HomeEventEdition = { id; event_name; label; customer_code; status: StatusDaEdicao }`, o item `event-editions` (que já filtra `status === "enviado"`), `consultaDaAgenda(db, "em_andamento")`, `edicoesEnviadas` (cada documento por `edicaoDaLeitura`, na forma `{ id, event_name, label, customer_code, status }`), `CONFIRMA_EDICAO_ROLES` (parte 7); `edicaoDaLeitura(id, data): EdicaoView | null` de `lib/eventos/leitura.ts` (parte 4); `WMS_OPERATOR_ROLES` de `lib/modules.ts`; `EVENTOS_LIBERADO` (parte 1).
- Produces: nada muda em `HomeEventEdition` nem no item `event-editions`, que nascem com o `status` na parte 7; o Início lê uma lista só, `eventEditions`, e esta parte só concatena a ela as edições no evento, como a parte 10 concatena as retornadas e filtra `status === "retornado"` para "Edição para fechar", sem parâmetro à parte; `edicoesNoEvento(): Promise<HomeEventEdition[]>` = `getDocs(consultaDaAgenda(firestore, "em_andamento"))`, cada documento por `edicaoDaLeitura(doc.id, doc.data())` (o que volta `null` sai) e a view em `{ id, event_name, label, customer_code, status }`, como `edicoesEnviadas` (parte 7); em `buildHomeInbox`, logo depois de `receipts` e só para `role` em `WMS_OPERATOR_ROLES`, `{ id: "event-returns", tone: "attention", title: "Retorno do evento para registrar" | "<n> retornos de evento para registrar", detail: listPreview(["<cliente> · <evento> · <label>", …], 2), href: "/eventos", actionLabel: "Registrar retorno" }` para as edições com `status === "no_evento"`; `ICONE_DO_ITEM["event-returns"] = RotateCcw`; em `useInicioDoWms`, `seesRetornos = ligado && EVENTOS_LIBERADO && canAccessModule(role, WMS_OPERATOR_ROLES)` e `useQuery({ queryKey: ["eventos", "em-andamento"], queryFn: edicoesNoEvento, enabled: seesRetornos, refetchInterval: 60_000, refetchOnWindowFocus: false })`, concatenada às enviadas em `eventEditions` e tratada como a leitura da parte 7 em `carregando`, `relendo`, `falhaSoNaReleitura`, `reler` e `falhas` ("eventos"), fora de `leiturasDaApi`.

- [ ] **Step 1: Write the failing tests**

Em `home-inbox.test.ts`:

```ts
it("a edição no evento pede o retorno a quem opera, de todos os clientes", () => {
  const noEvento = (id: string, customer_code: string, event_name: string) => ({ id, status: "no_evento" as const, customer_code, event_name, label: "2027" });
  const eventEditions = [noEvento("ced_1", "BTG Pactual", "B2B Conference Necton"), noEvento("ced_2", "Itaú", "Convenção regional"), { ...noEvento("ced_3", "BTG Pactual", "Feira"), status: "enviado" as const }];
  const item = buildHomeInbox({ role: "wms", eventEditions }).items.find((i) => i.id === "event-returns");
  expect([item?.tone, item?.title, item?.detail, item?.href, item?.actionLabel]).toEqual(["attention", "2 retornos de evento para registrar", "BTG Pactual · B2B Conference Necton · 2027 · Itaú · Convenção regional · 2027", "/eventos", "Registrar retorno"]);
  expect(buildHomeInbox({ role: "admin", eventEditions: eventEditions.slice(0, 1) }).items.map((i) => i.title)).toContain("Retorno do evento para registrar");
  expect(buildHomeInbox({ role: "suporte", eventEditions }).items.map((i) => i.id)).not.toContain("event-returns");
  // a enviada é da parte 7, que já filtra status === "enviado": só ela conta em "event-editions", e só para a coordenação
  expect(buildHomeInbox({ role: "admin", eventEditions }).items.find((i) => i.id === "event-editions")?.title).toBe("1 evento para confirmar");
  expect(buildHomeInbox({ role: "wms", eventEditions: eventEditions.slice(2) }).items.map((i) => i.id)).not.toContain("event-returns");
});
```

Em `home-view.test.tsx`, no `it("cada item tem o ícone do que é")`:
`itensDoInicioDoWms([{ ...ITENS[0], id: "event-returns" }])[0].icon.displayName` é `"RotateCcw"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/home-inbox.test.ts src/pages/home-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the read, the item and the icon**

A leitura é direta no Firestore, fora de `cloud-api.ts` (como a da parte 7):
`CONSULTAS_DAS_TELAS` não a vê, e `status == "no_evento"` é uma igualdade só,
sem índice composto. O contador do menu e da entrada vem de
`lib/resumo-do-modulo.ts`, pela única regra do "Precisa de você".

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/resumo-do-modulo.test.ts src/lib/eventos/agenda.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/home-inbox.ts artifacts/app/src/lib/home-inbox.test.ts artifacts/app/src/lib/inicio-do-wms.ts artifacts/app/src/lib/use-inicio-do-wms.ts artifacts/app/src/pages/home-view.test.tsx
git commit -m "feat(app): o retorno do evento para registrar no Início da Armazenagem"
```

### Task 6: a linha da régua

**Files:**
- Modify: `functions/wms/src/billing-callables.integration.test.ts` (linhas 596-645, o caso "só o recebimento e a expedição se cobram; o que o armazém faz por dentro, não")
- Test: `functions/wms/src/domain/eventos/retorno.test.ts` (duas asserções)

**Interfaces:**
- Consumes: `movimento(source, sinal, qtde, dia)` do caso; `billingMovementDirection` de `domain/billing-scope.js`; `sentidoDoMovimento` de `domain/sentido-do-movimento.js`; `EVENT_RETURN_SOURCE` (T1).
- Produces: a linha `["n_retorno_evento", movimento("functions_event_return", 1, 6, 7)]` ao lado de `n_devolucao`, com o comentário do caso citando o retorno do evento; os totais do caso continuam `[10, 4, 2]`, `total_cents` 1900 e o `usage` igual.

- [ ] **Step 1: Write the assertions and the line**

Em `retorno.test.ts`: `sentidoDoMovimento(EVENT_RETURN_SOURCE, "ENTRADA") === null`
(fora do relógio do estoque) e
`billingMovementDirection({ source: EVENT_RETURN_SOURCE, tipo_mov: "ENTRADA", sinal: 1, qtde: 6 }, { snapshot: false }) === null`
(fora da cobrança). Na régua, a linha nova: o caso só passa se a ENTRADA do
retorno não entrar em `entradas_pecas` (que fica 10).

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/retorno.test.js; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/billing-callables.integration.test.js"`
Expected: PASS (a origem interna não cobra; se alguém um dia puser
`functions_event_return` em `billingMovementDirection` ou em
`ORIGENS_QUE_CONTAM`, as três asserções reprovam).

- [ ] **Step 3: Run the whole suites once**

Run: `cd C:\DEV\Dute; corepack pnpm run typecheck; npm --prefix functions/wms run test:unit; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `callables-papeis`, `callables-auth`,
`order-return` e a conferência das consultas (o retorno não traz consulta
nova com índice composto: `stock_reservations` por `order_id` é uma
igualdade só; os saldos usam `skuBalancesQuery`).

- [ ] **Step 4: Commit**

```bash
git add functions/wms/src/billing-callables.integration.test.ts functions/wms/src/domain/eventos/retorno.test.ts
git commit -m "test(wms): a ENTRADA do retorno do evento não cobra, na régua"
```

### Pronto quando

No emulador, pelos testes: a edição da Necton em `no_evento`, com o pedido
entregue, recebe o retorno de 2.000 peças com 1.994 de volta na EXPEDICAO,
3 avariadas em Devoluções (`returns` e `return_items` pendentes de
disposição), 3 não voltaram só na edição e no evento, 1.930 da coleta, o
`feito` do momento e `retornado`; a guarda leva o que voltou à prateleira de
origem e o Estoque bate; o Início lista "Retorno do evento para registrar";
a régua, a cobrança e o relógio do estoque não mudam; o CI inteiro verde. O
PR registra em `docs/superpowers/plans/2026-11-26-eventos.md` o que mudou
de nome, se mudou.
