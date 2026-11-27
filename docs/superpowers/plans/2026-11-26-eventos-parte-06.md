# Eventos · parte 6: o envio com pedido e a ligação edição ↔ pedido

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Enviar para a Dutelog" cria o pedido de saída com os itens da
edição, na mesma transação, e os dois passam a se conhecer: a solicitação, o
pedido e as projeções do portal levam `event_edition_id`; a edição leva
`pedido.request_id` e `request_number`; cancelar a edição enviada cancela a
solicitação; o retorno do pedido de evento é só pela edição; e Pedidos › Para
aprovar diz "Evento · nome · label".

**Architecture:** o corpo de `createCustomerRequestTransaction` sai para
`createCustomerRequestInTransaction(transaction, db, pedido, actor)`, e a
função de hoje vira o `runTransaction` em volta dele. `domain/eventos/envio.ts`
monta a solicitação a partir da `EdicaoView` (puro), dá à parte 2 o
`deps.criarSolicitacao` e embrulha o cancelamento (a decisão da solicitação
primeiro, pela `decideCustomerRequestTransaction` de `cancelCustomerOrder`;
depois a transação da edição). Nenhuma callable nova: `sendEventEdition` e
`cancelEventEdition` (parte 2) ganham as dependências, `createCustomerRequest`
recusa o campo vindo do navegador e `receiveOrderReturn` recusa o pedido
ligado a uma edição. No app, só o tipo e o título da linha.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test` com
o emulador; React e vitest no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
envio e o pedido", "Os status e quem move cada um" (`enviado`, `cancelado`
pelo cliente), "As callables", "A edição, campo a campo" (o bloco `pedido`),
"O que achei no código e muda o desenho" e "Testes e travas". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md` (restrições e interfaces valem
aqui).

## Global Constraints

As do índice. Nesta parte, ainda: a solicitação da edição só nasce pelo
servidor (`sendEventEdition`); o `event_edition_id` vindo do navegador em
`createCustomerRequest` recusa, e a API REST (`api/module.ts`, `requestSchema`
`.strict()`) já o recusa sozinha. A chamada a `deps.criarSolicitacao` vem
antes de qualquer escrita do envio (o Firestore não lê depois de escrever na
mesma transação). `event_edition_id` só se grava quando existe: nenhum `null`
entra nos pedidos comuns. A confirmação, os ganchos do pedido e o cancelamento
pela coordenação em `confirmado` e `separado` são da parte 7.

## Review Focus

1. Clique duplo em "Enviar": a mesma chave devolve a mesma solicitação (um
   `customer_requests`, uma reserva); outra chave recusa "A edição já foi
   enviada." (T2).
2. Saldo insuficiente no envio: nada grava, a edição continua `rascunho` sem
   `pedido`, e a frase é a de sempre ("Saldo insuficiente para o SKU …") (T2).
3. O cliente cancelou a solicitação em Portal › Pedidos (`cancelCustomerOrder`)
   e depois cancela a edição: sem `already-exists`, a edição cancela e a
   solicitação continua `cancelled` (T3).
4. `receiveOrderReturn` recusa o pedido com `event_edition_id` mesmo com
   `retorno.status: a_receber` (T4).
5. O `event_edition_id` mandado pelo navegador recusa com a frase e nenhuma
   solicitação nasce (T6).

---

### Task 1: `event_edition_id` na solicitação, no pedido e nas projeções

**Files:**
- Modify: `functions/wms/src/domain/operations.ts` (`CreateOperationalRequestInput`, linhas 166 a 185; a solicitação e a projeção em `createCustomerRequestTransaction`, linhas 4556 a 4616; o pedido e o acompanhamento na aprovação de `decideCustomerRequestTransaction`, linhas 6183 a 6200 e 6293 a 6307)
- Test: `functions/wms/src/domain/eventos/envio.integration.test.ts` (casos 1 e 2; registre em `test:integration` logo depois de `lib/domain/eventos/edicao.integration.test.js`)

**Interfaces:**
- Consumes: `createCustomerRequestTransaction(db, pedido, actor)`, `decideCustomerRequestTransaction(db, input, actor)`, `CreateOperationalRequestInput`, `OperationalActor` de `domain/operations.ts`; `compact` (já usado ali).
- Produces: `CreateOperationalRequestInput.event_edition_id?: string | null`; o campo `event_edition_id` (string) em `customer_requests/{id}` e `client_request_status/{id}` na criação, e em `orders/{id}` e `client_order_tracking/{id}` na aprovação (`text(request.event_edition_id) || undefined`, dentro do `compact`; no `transaction.create` de `orders`, que não usa `compact`, só a chave quando existe).

- [ ] **Step 1: Write the failing tests**

`envio.integration.test.ts`, no molde de `edicao.integration.test.ts` (parte
2): os atores `cristiane` (cliente da BTG) e `manoel` (interno), o `beforeEach`
que limpa o emulador e semeia o saldo como `operations.integration.test.ts`
faz em "número do pedido e cancelamento pelo cliente" (linhas 3272 a 3295):
`stock_balances/bal-evento` (`sku_code: "BTG-000001"`, `client_item_code:
"POLO-P"`, `product_name: "Polo Masculino Piquet Preto"`, `location_id:
"A-01"`, `qty_on_hand: 2000`), `skus/BTG-000001` e `products/POLO-P`; o helper
`retirada(chave, quantidade)` como o de lá (linhas 3254 a 3267), com esse SKU.

```ts
it("1. a solicitação com event_edition_id leva o id à solicitação e ao portal; a comum não ganha o campo", async () => {
  const criada = await createCustomerRequestTransaction(db, { ...retirada("evento-1", 5), event_edition_id: "ced_0123456789abcdef" }, cristiane);
  assert.equal((await db.doc(`customer_requests/${criada.id}`).get()).get("event_edition_id"), "ced_0123456789abcdef");
  assert.equal((await db.doc(`client_request_status/${criada.id}`).get()).get("event_edition_id"), "ced_0123456789abcdef");
  const comum = await createCustomerRequestTransaction(db, retirada("comum-1", 1), cristiane);
  assert.equal("event_edition_id" in ((await db.doc(`customer_requests/${comum.id}`).get()).data() ?? {}), false);
});
it("2. a aprovação copia o id ao pedido e ao acompanhamento; o pedido comum fica sem o campo", async () => {
  // approve pelo manoel das duas solicitações do caso 1 (expected_status "open"): orders/{order_id}.event_edition_id e
  // client_order_tracking/{order_id}.event_edition_id === "ced_0123456789abcdef"; no pedido comum, "event_edition_id" in data === false nos dois (nem null)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/envio.integration.test.js"`
Expected: FAIL (o campo não chega a nenhum documento: `undefined`).

- [ ] **Step 3: Implement**

O campo no tipo; `event_edition_id: input.event_edition_id ?? undefined` nos
dois `compact` da criação; na aprovação, `const eventEditionId =
text(request.event_edition_id) || undefined;`, só a chave quando existe no
`orders`, e `event_edition_id: eventEditionId` no `updateClientTracking`.
Registre o teste em `test:integration`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `node --test lib/domain/operations.integration.test.js`
no mesmo `emulators:exec`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/operations.ts functions/wms/src/domain/eventos/envio.integration.test.ts functions/wms/package.json
git commit -m "feat(wms): a solicitação e o pedido levam o id da edição do evento"
```

### Task 2: o envio cria a solicitação na mesma transação

**Files:**
- Create: `functions/wms/src/domain/eventos/envio.ts`
- Modify: `functions/wms/src/domain/operations.ts` (`createCustomerRequestTransaction`, linhas 4235 a 4260 e o fecho do `runTransaction`: o corpo vira `createCustomerRequestInTransaction`)
- Modify: `functions/wms/src/index.ts` (a linha de `sendEventEdition`, no bloco Eventos depois de `archiveClientEventTemplate`, hoje a linha 7252; o import de `./domain/eventos/envio.js`)
- Test: `functions/wms/src/domain/eventos/envio.test.ts` (`test:unit`, ao fim da lista); `envio.integration.test.ts` (casos 3 a 6)

**Interfaces:**
- Consumes: `sendEventEditionTransaction(db, input, actor, deps)`, `saveEventEditionTransaction`, `lerEdicaoDoCliente`, `EdicaoView` e `viewDaEdicao` (parte 2); `CreateOperationalRequestInput`, `OperationalActor`, `OperationalEventSummary`, `createCustomerRequestTransaction` (`domain/operations.ts`); `Transaction` de `firebase-admin/firestore`.
- Produces:
  - `createCustomerRequestInTransaction(transaction: Transaction, db: Firestore, pedido: CreateOperationalRequestInput, actor: OperationalActor): Promise<{ id: string; request_number: string; status: "open"; item_count: number; quantity_total: number; reserved_quantity: number; events: OperationalEventSummary[] }>` — o corpo de hoje inteiro (o recibo `op_request_…`, a abertura, a reserva, a numeração, a solicitação, a projeção, o evento), exportado; `createCustomerRequestTransaction(db, pedido, actor)` passa a ser `db.runTransaction((transaction) => createCustomerRequestInTransaction(transaction, db, pedido, actor))`.
  - `chaveDaSolicitacaoDaEdicao(editionId: string): string` = `"evento:" + editionId` (a solicitação nasce com o id `creq_` + 32 hex de `digest({ customer, nonce })` de `operations.ts`: repetir o envio devolve a mesma).
  - `solicitacaoDaEdicao(edicao: EdicaoView): CreateOperationalRequestInput` — `type: "retirada"`, `priority: "normal"`, `title` = "Evento · <event_name> · <label>", `description` = "Evento <event_name>, edição <label>: entrega em <onde.local>", `destination: [onde.local, onde.endereco].filter(Boolean).join(" · ")`, `due_at` = `new Date("<previsto.data>T<previsto.hora>:00-03:00").toISOString()` do momento `entrega_no_local` (como `pages/client/envios.tsx` monta o `due_at`; sem o momento, `undefined`), `items`: um por item da edição (`sku_code`, `client_item_code` ou `undefined`, `product_name`, `quantity`), `attachments: []`, `customer_code`, `idempotency_key: chaveDaSolicitacaoDaEdicao(id)`, `event_edition_id: id`.
  - `criarSolicitacaoDaEdicao(db: Firestore, actor: OperationalActor): (transaction: Transaction, edicao: EdicaoView) => Promise<{ request_id: string; request_number: string }>` — chama `createCustomerRequestInTransaction(transaction, db, solicitacaoDaEdicao(edicao), actor)` e devolve `{ request_id: id, request_number }`.

- [ ] **Step 1: Write the failing tests**

`envio.test.ts` (node:test, puro), com uma `EdicaoView` da Necton no próprio
teste (`event_name: "B2B Conference Necton"`, `label: "2027"`, `onde.local:
"Hotel Unique"`, `onde.endereco: "Av. Brigadeiro Luís Antônio, 4700"`,
`entrega_no_local` previsto `2027-01-28` às `08:30`, dois itens, o segundo sem
`client_item_code`):

```ts
it("a solicitação da edição: retirada, título, descrição, destino, o prazo da entrega no local, os itens e a chave", () => {
  const pedido = solicitacaoDaEdicao(edicao);
  assert.equal(pedido.type, "retirada");
  assert.equal(pedido.title, "Evento · B2B Conference Necton · 2027");
  assert.equal(pedido.description, "Evento B2B Conference Necton, edição 2027: entrega em Hotel Unique");
  assert.equal(pedido.destination, "Hotel Unique · Av. Brigadeiro Luís Antônio, 4700");
  assert.equal(pedido.due_at, "2027-01-28T11:30:00.000Z");
  assert.deepEqual(pedido.items[0], { sku_code: "BTG-000001", client_item_code: "POLO-P", product_name: "Polo Masculino Piquet Preto", quantity: 1200 });
  assert.equal("client_item_code" in pedido.items[1], false);
  assert.deepEqual([pedido.idempotency_key, pedido.event_edition_id, pedido.customer_code], ["evento:ced_0123456789abcdef", "ced_0123456789abcdef", "BTG Pactual"]);
});
it("sem endereço, o destino é só o local; a chave da solicitação é evento:<id>", () => { /* destination === "Hotel Unique"; chaveDaSolicitacaoDaEdicao("ced_1") === "evento:ced_1" */ });
```

Em `envio.integration.test.ts`, a edição nasce por `saveEventEditionTransaction`
(`cristiane`, o evento e o `onde` acima, cronograma `entrega_no_local`
2027-01-28 08:30, `evento` 2027-01-28 09:00 até 18:00, `retorno_ao_estoque`
2027-01-30 10:00, um item de 1.200 do `BTG-000001`) e o envio é
`sendEventEditionTransaction(db, { id, expected_edicao, idempotency_key, customer_code }, cristiane, { criarSolicitacao: criarSolicitacaoDaEdicao(db, cristiane) })`:

```ts
it("3. enviar com itens cria a solicitação na mesma transação, e a edição guarda request_id e request_number", ...)
// customer_requests/{request_id}: title, description, destination e due_at iguais aos do unitário, type "retirada", request_number "PED-0001",
// status "open", event_edition_id === id; client_request_status/{request_id}.event_edition_id === id; stock_balances/bal-evento.qty_reserved === 1200;
// a edição: status "enviado", pedido.request_id === request_id, pedido.request_number === "PED-0001"; o evento edicao_enviada com payload.request_id === request_id
it("4. clique duplo: a mesma chave devolve a mesma solicitação sem segunda reserva; outra chave recusa 'A edição já foi enviada.'", ...)
// customer_requests.size === 1 e qty_reserved === 1200 depois das duas chamadas
it("5. saldo insuficiente: recusa com a frase de sempre e nada grava", ...)
// item de 2500: "Saldo insuficiente para o SKU BTG-000001. Disponível: 2000; solicitado: 2500."; a edição continua rascunho, pedido null, sem solicitação, qty_reserved 0
it("6. a edição só com coleta envia sem solicitação", ...)
// itens [], coleta.quantidade 300, cronograma só com evento e coleta_no_cliente: status "enviado", pedido null, sem solicitação, payload.request_id === null
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/envio.test.js` e o `emulators:exec` do T1.
Expected: FAIL (`./envio.js` não existe; o envio grava `pedido` null).

- [ ] **Step 3: Implement `envio.ts`, the refactor and the callable**

A extração move para dentro de `createCustomerRequestInTransaction` tudo que
hoje antecede o `runTransaction` (`kind`, `input`, os ids, `inputHash`,
`total`, `description`, `eventId`), sem mudar o corpo. A linha de
`sendEventEdition` passa `{ criarSolicitacao: criarSolicitacaoDaEdicao(db, { ...profile, customer_code }) }`
como `deps`. Registre `lib/domain/eventos/envio.test.js` em `test:unit`.

- [ ] **Step 4: Run tests to verify they pass**

Run: os dois comandos do passo 2, mais `node --test lib/domain/operations.integration.test.js lib/customer-request.integration.test.js lib/domain/eventos/edicao.integration.test.js`
no mesmo `emulators:exec` (a extração não muda nada para quem chama).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/envio.ts functions/wms/src/domain/eventos/envio.test.ts functions/wms/src/domain/eventos/envio.integration.test.ts functions/wms/src/domain/operations.ts functions/wms/src/index.ts functions/wms/package.json
git commit -m "feat(wms): o envio da edição cria a solicitação na mesma transação"
```

### Task 3: o cancelamento pelo cliente cancela a solicitação

**Files:**
- Modify: `functions/wms/src/domain/eventos/envio.ts` (`cancelarEdicaoComSolicitacao`)
- Modify: `functions/wms/src/domain/eventos/edicao-gravacao.ts` (`cancelEventEditionTransaction`, o ramo `enviado`: `pedido.cancelado_em`)
- Modify: `functions/wms/src/index.ts` (a linha de `cancelEventEdition`: chama `cancelarEdicaoComSolicitacao` no lugar de `cancelEventEditionTransaction`)
- Test: `envio.integration.test.ts` (casos 7 a 10)

**Interfaces:**
- Consumes: `cancelEventEditionTransaction(db, input, actor)`, `lerEdicaoDoCliente`, `viewDaEdicao`, o tipo `CancelarEdicao` de `CancelarEdicaoSchema` (parte 2); `decideCustomerRequestTransaction` (`domain/operations.ts`).
- Produces:
  - `cancelarEdicaoComSolicitacao(db: Firestore, input: CancelarEdicao & { customer_code: string }, actor: OperationalActor & { customer_code: string }): Promise<{ id: string; resultado: "excluida" | "cancelada" }>` — lê a edição num `db.runTransaction` só de leitura com `lerEdicaoDoCliente`; em `enviado` com `pedido.request_id`, lê `customer_requests/{request_id}`: `open` → `decideCustomerRequestTransaction(db, { request_id, action: actor.role === "cliente" ? "cancel" : "reject", reason: input.motivo ?? undefined, expected_status: "open", idempotency_key: "evento-cancel:" + input.id }, actor)`; `cancelled` ou `rejected` → segue; qualquer outro → `failed-precondition` "A Dutelog já confirmou esta solicitação. Para mudar, fale com a equipe." (a frase de `decideCustomerRequestTransaction`); por fim `cancelEventEditionTransaction(db, input, actor)`. Fora de `enviado`, ou sem `pedido`, é só a transação da parte 2.
  - `cancelEventEditionTransaction` grava `pedido.cancelado_em` (ISO do instante) no ramo `enviado` quando `pedido` não é null; o resto como na parte 2.

- [ ] **Step 1: Write the failing tests**

```ts
it("7. o cliente cancela a enviada: a solicitação vai a cancelled, a reserva volta, o portal diz cancelled e a edição guarda pedido.cancelado_em", ...)
// cancelarEdicaoComSolicitacao(db, { id, idempotency_key: "cancela-1", customer_code }, cristiane) → "cancelada"; customer_requests.status e
// client_request_status.status "cancelled"; qty_reserved 0; a edição: status "cancelado", typeof pedido.cancelado_em === "string", pedido.request_id mantido
it("8. a coordenação cancela a enviada com motivo: a solicitação é recusada com o motivo", ...)
// manoel, motivo "Cliente adiou o evento": customer_requests.status "rejected", decision_reason "Cliente adiou o evento"
it("9. a solicitação já cancelada em Portal › Pedidos não trava o cancelamento da edição", ...)
// antes, como cancelCustomerOrder: decideCustomerRequestTransaction(db, { request_id, action: "cancel", expected_status: "open", idempotency_key: `cancel:${request_id}` }, cristiane)
// depois: cancelarEdicaoComSolicitacao resolve "cancelada" sem already-exists
it("10. a solicitação já aprovada em Pedidos recusa, e a edição continua enviada", ...)
// approve pelo manoel; a cristiane recebe failed-precondition "A Dutelog já confirmou esta solicitação. Para mudar, fale com a equipe."; status "enviado"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: o `emulators:exec` do T1. Expected: FAIL (a função não existe).

- [ ] **Step 3: Implement**

A decisão da solicitação vem antes da transação da edição, de propósito: se a
segunda falhar, a edição continua `enviado` e a repetição a cancela (a decisão
repetida devolve o recibo); na ordem inversa, o armazém poderia aprovar a
solicitação de uma edição já cancelada.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2. Expected: PASS nos casos 1 a 10.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/envio.ts functions/wms/src/domain/eventos/edicao-gravacao.ts functions/wms/src/domain/eventos/envio.integration.test.ts functions/wms/src/index.ts
git commit -m "feat(wms): cancelar a edição enviada cancela a solicitação"
```

### Task 4: `receiveOrderReturn` recusa o pedido de evento

**Files:**
- Modify: `functions/wms/src/domain/order-return.ts` (`problemaDoRetorno`, linhas 74 a 82)
- Test: `functions/wms/src/domain/order-return.test.ts` (um `assert` novo no primeiro `it`); `functions/wms/src/domain/order-return.integration.test.ts` (um `it` novo)

**Interfaces:**
- Consumes: `problemaDoRetorno(pedido)`, `receiveOrderReturnFlow(db, input, actor, agora)` de `domain/order-return.ts`.
- Produces: `problemaDoRetorno` devolve `"O retorno deste pedido é registrado na edição do evento."` quando `texto(pedido.event_edition_id)` não é vazio, logo depois da checagem do cliente e antes da do `retorno`; `receiveOrderReturnFlow` recusa com `failed-precondition` e a frase, sem criar `returns`.

- [ ] **Step 1: Write the failing tests**

No unitário, no primeiro `it`: `assert.equal(problemaDoRetorno({ customer_code: "BTG Pactual", event_edition_id: "ced_0123456789abcdef", retorno: { status: "a_receber" } }), "O retorno deste pedido é registrado na edição do evento.")`.
Na integração:

```ts
it("o pedido ligado a uma edição do evento não se recebe aqui, mesmo com o retorno a receber", async () => {
  await db.doc("orders/ord_118").update({ event_edition_id: "ced_0123456789abcdef" });
  const recusa = await rejection(receiveOrderReturnFlow(db, { order_id: "ord_118", items: [ITEM] }, wms, AGORA));
  assert.equal(recusa.code, "failed-precondition");
  assert.equal(recusa.message, "O retorno deste pedido é registrado na edição do evento.");
  assert.equal((await db.collection("returns").get()).size, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/order-return.test.js; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/order-return.integration.test.js"`
Expected: FAIL (hoje o retorno a receber passa e a devolução nasce).

- [ ] **Step 3: Implement the check in `problemaDoRetorno`**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/order-return.ts functions/wms/src/domain/order-return.test.ts functions/wms/src/domain/order-return.integration.test.ts
git commit -m "feat(wms): o retorno do pedido de evento é só pela edição"
```

### Task 5: a linha "Evento · nome · label" em Pedidos

**Files:**
- Modify: `artifacts/app/src/pages/customer-requests.tsx` (`CustomerRequest`, linhas 45 a 93: `event_edition_id?: string | null`; `requestTitle`, linhas 1178 a 1180)
- Test: `artifacts/app/src/pages/pedidos.evento.test.tsx` (novo; o bloco de `vi.mock`, o `servir`, o `beforeEach` e os helpers `linha` e `grupoParaAprovar` de `pedidos.aprovar.test.tsx`, linhas 27 a 207)

**Interfaces:**
- Consumes: `requestTitle`, `CustomerRequest` de `pages/customer-requests.tsx` (`pedidos.tsx` os importa na linha 132); `textosForaDaLista`, `violacoesDeAcessibilidade` de `src/test`.
- Produces: `requestTitle(request)` = `request.title || request.description || "Solicitação sem descrição"` quando `request.event_edition_id` existe; senão como hoje (`description || title || …`). A linha de "Para aprovar" da solicitação do evento diz o `title` ("Evento · B2B Conference Necton · 2027"); a lista do portal (`pages/client/shared.tsx`, `requestTitle`) já prefere o `title` e não muda.

- [ ] **Step 1: Write the failing test**

```ts
it("a solicitação do evento diz 'Evento · nome · label' em Para aprovar; a comum continua pela descrição", async () => {
  // estado.solicitacoes = [solicitacao("1042", 12), { ...solicitacao("evento", 1200), title: "Evento · B2B Conference Necton · 2027",
  //   description: "Evento B2B Conference Necton, edição 2027: entrega em Hotel Unique", event_edition_id: "ced_0123456789abcdef", items: [{ sku_code: "BTG-000001", quantity: 1200 }] }]
  const grupo = grupoParaAprovar();
  expect(linha("Evento · B2B Conference Necton · 2027")).toBeTruthy();
  expect(grupo.textContent).not.toContain("entrega em Hotel Unique");
  expect(linha("Pedido 1042")).toBeTruthy();
  expect(textosForaDaLista(grupo.outerHTML, [...PERMITIDOS, "Evento · B2B Conference Necton · 2027", /^Retirada · BTG Pactual · 1 item · 1\.200 un\.$/])).toEqual([]);
  expect(await violacoesDeAcessibilidade(grupo.outerHTML)).toEqual([]);
});
it("requestTitle prefere o título só na solicitação do evento", () => {
  expect(requestTitle({ id: "a", title: "T", description: "D" })).toBe("D");
  expect(requestTitle({ id: "a", title: "T", description: "D", event_edition_id: "ced_x" })).toBe("T");
});
```

`PERMITIDOS` é a lista do grupo em `pedidos.aprovar.test.tsx` (linha 1344), copiada.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/pedidos.evento.test.tsx`
Expected: FAIL (a linha diz a descrição; `event_edition_id` não compila no tipo).

- [ ] **Step 3: Implement the type and `requestTitle`**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, `npx vitest run src/pages/pedidos.aprovar.test.tsx src/pages/customer-requests.carregamento.test.tsx`
e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/pages/customer-requests.tsx artifacts/app/src/pages/pedidos.evento.test.tsx
git commit -m "feat(app): a linha do pedido de evento em Pedidos diz o evento"
```

### Task 6: o id não entra pelo navegador; a régua e `customer-request` verdes

**Files:**
- Modify: `functions/wms/src/index.ts` (`CreateCustomerRequestSchema`, linhas 411 a 441: `event_edition_id: z.string().trim().min(1).max(120).optional()`; `createCustomerRequest`, linhas 6578 a 6593: a recusa logo depois do `safeParse`)
- Modify: `docs/superpowers/plans/2026-11-26-eventos.md` (a linha "Campo novo do pedido" das interfaces; a entrada de `envio.ts` no File Structure e as duas funções da parte 6 em "Funções do domínio" já estão lá e só se conferem)
- Test: `functions/wms/src/customer-request.integration.test.ts` (um `it` novo)

**Interfaces:**
- Consumes: `createCustomerRequest` (a callable de verdade, pelo `.run`, como o teste já faz).
- Produces: `createCustomerRequest` recusa `invalid-argument` `"O pedido de um evento nasce pelo envio da edição."` quando `event_edition_id` vem em `request.data`, antes de `requireCustomerScope` e do caminho do Agent Dute; o campo existe no schema para a recusa dizer o campo, nunca para passar.

- [ ] **Step 1: Write the failing test**

```ts
it("o id da edição do evento não entra pelo navegador: recusa com a frase e nada nasce", async () => {
  await assert.rejects(
    pedir({ type: "retirada", idempotency_key: "evento-pelo-navegador", destination: "Hotel Unique", event_edition_id: "ced_0123456789abcdef", items: [item(1)] }),
    (error: unknown) => {
      const erro = error as { code?: string; message?: string };
      assert.deepEqual([erro.code, erro.message], ["invalid-argument", "O pedido de um evento nasce pelo envio da edição."]);
      return true;
    },
  );
  assert.equal((await db.collection("customer_requests").get()).size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/customer-request.integration.test.js"`
Expected: FAIL (hoje o campo é descartado pelo `z.object` e a recusa é a de saldo, `failed-precondition`).

- [ ] **Step 3: Implement the field and the refusal**

- [ ] **Step 4: Run the gates that the spec names for this part**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/customer-request.integration.test.js lib/domain/order-return.integration.test.js lib/billing-callables.integration.test.js lib/callables-auth.integration.test.js lib/callables-papeis.integration.test.js"`
Expected: PASS (a régua não muda: o pedido de evento se cobra na expedição
como qualquer pedido de saída; sem callable nova, a matriz fica igual). Depois
`cd C:\DEV\Dute; corepack pnpm run typecheck; npm --prefix functions/wms run test:unit; npm --prefix functions/wms run test:integration`.
Expected: PASS.

- [ ] **Step 5: Update the index and commit**

No índice, o acréscimo é só na linha "Campo novo do pedido", que passa a
citar também `CreateOperationalRequestInput` e
`createCustomerRequestInTransaction`, os dois em `domain/operations.ts`. O
resto já está lá e só se confere, sem duplicar: a entrada
`domain/eventos/envio.ts` (parte 6) do File Structure e, em "Funções do
domínio", as duas da parte 6, `createCustomerRequestInTransaction(transaction, db, pedido, actor)`
(extraída em `domain/operations.ts`) e `cancelarEdicaoComSolicitacao(db, input, actor)`
(`envio.ts`).

```bash
git add functions/wms/src/index.ts functions/wms/src/customer-request.integration.test.ts docs/superpowers/plans/2026-11-26-eventos.md
git commit -m "feat(wms): o id da edição do evento não entra pelo navegador"
```

### Pronto quando

No emulador, pelos testes: a edição da Necton é enviada e nasce `PED-0001`
ligado a ela, com a reserva, o título e o prazo da entrega no local; o clique
duplo não duplica; o saldo insuficiente não grava nada; o cliente cancela e a
reserva volta; `receiveOrderReturn` recusa o pedido de evento; Pedidos › Para
aprovar diz o evento. `customer-request`, `order-return`, a régua e o CI
inteiro verdes; nenhuma tela nova nesta parte.
