# Eventos · parte 7: a confirmação, os ganchos do pedido e a agenda da Armazenagem

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a edição enviada é confirmada pela coordenação com o "separar até"
(a aprovação da solicitação na mesma transação), anda com o pedido sem
ninguém digitar (packing concluído → `separado`, com os volumes e o `foi`;
entrega → `no_evento`; recusa e cancelamento do pedido → `cancelado`), e
aparece na agenda `/eventos` da Armazenagem e no "Precisa de você" do Início.
O preço fica para a parte 10; a ficha, para a parte 8.

**Architecture:** `domain/eventos/confirmacao.ts` tem duas faces. A transação
própria `confirmEventEditionTransaction` serve a edição sem pedido (recibo
`op_evento_confirm_…`). Os ganchos servem a edição com pedido, dentro das
transações de `operations.ts`: `lerEdicaoDoPedido` antes da primeira escrita
e `confirmarEdicaoNaAprovacao`, `cancelarEdicaoPeloPedido`,
`separarEdicaoNoPacking` e `entregarEdicaoNaExpedicao` depois, só quando a
solicitação, o pedido ou a tarefa apontam `event_edition_id` (parte 6). Com
pedido, confirmar é `decideCustomerRequestTransaction` com `approve` e a
opção `eventEdition`; cancelar pela coordenação é a recusa (`reject`) ou
`cancelWarehouseOrderTransaction`: um ato, um recibo (o do pedido), os
eventos dos dois. No app, a agenda lê `client_event_editions` ao vivo por
`useLeitura` (como Pedidos lê `orders`), um grupo por status, com as regras
puras de `lib/eventos/` da parte 4, e o diálogo "Confirmar" chama o wrapper
`confirmarEdicao`.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test`
com o emulador; React, wouter, react-query, vitest, axe-core no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "A
confirmação, o 'separar até' e o preço" (sem o preço), "Os status e quem move
cada um" (`confirmado`, `separado`, `no_evento`, `cancelado` pela
coordenação), "As telas › Armazenagem" (a agenda e o "Precisa de você"), "A
edição, campo a campo" (`pedido`, `separar_ate`, `itens[].foi`), "As
callables" (`confirmEventEdition`). Índice: `docs/superpowers/plans/2026-11-26-eventos.md`.
Prancha: `docs/mockups/EventosWmsLista.dc.html` (os textos da agenda) e
`EventosFluxo.dc.html`.

## Global Constraints

As do índice. Nesta parte, ainda: o preço não entra (`ConfirmarEdicaoSchema`
é `.strict()` e recusa `fechado_cents`; a parte 10 entra pelos `deps`); o
"separar até" nasce na confirmação e a coordenação o muda depois pelo
`patch` de `saveEventEdition` até `separado` (parte 2: `separar_ate` em
`ConteudoDaEdicaoSchema` e em `camposDoPatchPermitidos`): esta parte só o
consome (T2, caso 16) e não redefine o schema nem mexe em `edicao.ts`; a
ficha `/eventos/edicao` não existe e a agenda não liga para ela: o link
entra na parte 8, que dá a `LinhaDaAgenda` o `href: hrefDaFicha(id)`
(`/eventos/edicao?id=<id>`), troca a ação de cada linha fora de "Para
confirmar" pelo link com o rótulo do grupo e do papel
(`rotuloDaFichaNaAgenda`, a regra da prancha: "Abrir" em Próximos,
inclusive no rascunho do cliente, cuja ficha fica só com os dados e
"Anexar"; "Registrar" em Em andamento só para quem opera,
`WMS_OPERATOR_ROLES`; "Fechar edição" em Para fechar só para a
coordenação, owner, admin e interno; "Abrir" para os outros papéis e no
grupo "Fechados"), põe "Abrir" ao lado de "Confirmar", tira da agenda o
"Ver pedido" e o `orderId` da `LinhaDaAgenda` (o "Ver pedido" fica na
ficha) e muda `lib/eventos/agenda.ts`, `pages/eventos-view.tsx`,
`pages/eventos.tsx` e os testes deles; o "Evento" de Pedidos (a ação para
`/eventos/edicao?id=` na linha da solicitação, em Para aprovar, e na do
pedido, em Para separar e Para entregar, quando têm `event_edition_id`, em
`pages/customer-requests.tsx` e `pages/pedidos.tsx`) também é da parte 8; o
"Novo evento" da prancha fica para depois (decisão 9); o gancho nunca
grava fora da transação que o chama e nunca muda o pedido sem
`event_edition_id`: `customer-request`, `pick-progress`, `order-cancel`,
`order-delivery`, `envio.integration` (com os casos 2, 9 e 10 da parte 6
ajustados à leitura e aos ganchos, T2) e a régua `billing-callables`
continuam verdes.

## Review Focus

1. A aprovação em Pedidos › Para aprovar de uma solicitação com
   `event_edition_id` grava o `separar_ate` padrão (a véspera da entrega no
   local) e confirma a edição; repetida com a mesma chave, não grava de novo
   (T1, caso 6).
2. O packing concluído pela bancada (`completeOrderSeparation`, dois
   volumes) e pelo avanço genérico (volume único) escrevem a mesma edição:
   `volumes[]` sem caixa, posição nem valor, e `foi` por SKU somando os
   `package_items` (T2, casos 9 e 10).
3. A entrega com `entrega_no_local` já registrado à mão não mexe no `feito`:
   grava só `pedido.entregue_em`, `entregue_por` e `comprovante` (T2, caso 12).
4. O cancelamento da edição `separado` pela coordenação devolve o separado à
   EXPEDICAO (é `cancelWarehouseOrderTransaction` que roda) e a edição fica
   `cancelado` na mesma transação; sem motivo, "Informe o motivo" antes de
   qualquer escrita (T2, caso 14).
5. A agenda mostra todos os clientes (a linha diz o cliente) e o "Confirmar"
   só para owner, admin e interno; o `wms` vê a fila sem a ação (T4).

---

### Task 1: `confirmacao.ts`: confirmar com o "separar até", a aprovação na mesma transação

**Files:**
- Create: `functions/wms/src/domain/eventos/confirmacao.ts`
- Modify: `functions/wms/src/domain/operations.ts` (`decideCustomerRequestTransaction`, 5645–6760: a leitura da edição depois da solicitação, 5689–5693; o gancho depois do `Object.assign(created, …)`, 6209–6216; o resultado e o recibo, 6740–6758)
- Test: `functions/wms/src/domain/eventos/confirmacao.integration.test.ts` (`test:integration`, depois de `lib/domain/eventos/envio.integration.test.js`)
- Modify: `functions/wms/package.json`

**Interfaces:**
- Consumes: `podeTransitar`, `ROTULO_DO_STATUS` (`./dominio.js`, parte 1); `EDICOES_COLLECTION`, `OPERATIONS_COLLECTION`, `actorRef(actor: OperationalActor): ActorRef` e `type ActorRef = { uid: string; name: string | null; role: string }` (`./edicao-gravacao.js`), `viewDaEdicao`, `EdicaoView`, `entradaDe`, `createEventoEvent`, `saveEventEditionTransaction`, `sendEventEditionTransaction` (parte 2); `criarSolicitacaoDaEdicao(db, actor)` (`./envio.js`, parte 6) e `event_edition_id` em `customer_requests` e `orders`; `createEvent`, `OperationalActor`, `OperationalEventSummary`, `decideCustomerRequestTransaction` (`../operations.js`, 138, 391, 572, 5645).
- Produces:
  - `ConfirmarEdicaoSchema` (`.strict()`): `id` 1..120, `expected_edicao` int ≥ 1, `separar_ate` `^\d{4}-\d{2}-\d{2}$` nullish, `idempotency_key` 8..200; `type ConfirmarEdicao`.
  - `vesperaDe(data: string): string` (AAAA-MM-DD menos um dia, em UTC civil); `separarAtePadrao(view: EdicaoView): string | null` = a véspera da `data` prevista de `entrega_no_local`; sem ela, a de `evento`; sem as duas, null.
  - `type EdicaoDoPedido = { ref: DocumentReference; id: string; view: EdicaoView }`; `lerEdicaoDoPedido(transaction: Transaction, db: Firestore, editionId: unknown, customerCode: string): Promise<EdicaoDoPedido | null>` — null sem id; `not-found` "Edição não encontrada." com id que não existe; `failed-precondition` "O pedido não é desta edição." com outro `customer_code`. Chamado antes da primeira escrita da transação.
  - `type DepsDaConfirmacao = { aoConfirmar?: (transaction: Transaction, db: Firestore, edicao: EdicaoDoPedido, actor: OperationalActor, occurredAt: string) => OperationalEventSummary | null }` — a costura da parte 10 (o preço como escrita a mais na mesma transação), nas duas rotas: a callable `confirmEventEdition` roda `prepararProposta` com `bucketDosEventos()` antes da transação e passa em `deps` o `aoConfirmar` que grava o preço (`gravarPreco`); a assinatura de `confirmEventEditionTransaction` não muda (nada de `bucket` no quarto parâmetro) e `DecideCustomerRequestOptions` não ganha `preco`.
  - `confirmarEdicaoNaAprovacao(transaction, db, edicao: EdicaoDoPedido, pedido: { request_id: string; order_id: string; order_number: string }, opcoes: { separar_ate?: string | null; expected_edicao?: number } & DepsDaConfirmacao, actor, occurredAt: string): { eventos: OperationalEventSummary[]; separar_ate: string | null }` — exige `view.status === "enviado"` (`failed-precondition` "A edição não está enviada."), `view.pedido?.request_id === pedido.request_id` ("O pedido não é desta edição.") e, quando dado, `expected_edicao === view.edicao` ("A edição mudou em outra aba"); grava `status: "confirmado"`, `confirmada_em`, `pedido.order_id`, `pedido.order_number`, `separar_ate` (o dado ou `separarAtePadrao(view)`), `edicao + 1`, `updated_*`; `createEventoEvent(evento.edicao_confirmada { edition_id, order_id, separar_ate })`; depois, `aoConfirmar` quando veio.
  - `confirmEventEditionTransaction(db, input: ConfirmarEdicao, actor, deps: DepsDaConfirmacao = {}): Promise<{ id: string; status: "confirmado"; separar_ate: string | null; order_id: string | null; order_number: string | null; edition: EdicaoView }>` — lê a edição fora da transação só para rotear (`not-found` "Edição não encontrada."). Sem `pedido.request_id`: a transação própria, recibo `op_evento_confirm_<digest({ customer, nonce: idempotency_key })>` (kind `evento.confirm`; mesma chave e mesmo `input_hash` → o mesmo resultado; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."), as exigências do gancho, `separar_ate` sempre gravado (a agenda ordena por ele) e, depois das escritas, `deps.aoConfirmar` quando veio, como no gancho. Com `pedido.request_id`: `decideCustomerRequestTransaction(db, { request_id, action: "approve", expected_status: "open", idempotency_key: \`evento:confirm:${input.idempotency_key}\` }, actor, { eventEdition: { edition_id: input.id, expected_edicao: input.expected_edicao, separar_ate: input.separar_ate ?? null, aoConfirmar: deps.aoConfirmar } })`, devolvendo `event_edition` do resultado dela com o `order_id` e o `order_number` de `created`.
  - Em `operations.ts`: `export type DecideCustomerRequestOptions = { eventEdition?: { edition_id: string; expected_edicao?: number; separar_ate?: string | null } & DepsDaConfirmacao }`, quarto parâmetro de `decideCustomerRequestTransaction` (padrão `{}`). Depois da leitura da solicitação, `const edicaoDoEvento = await lerEdicaoDoPedido(transaction, db, request.event_edition_id, customerCode);` e, com `options.eventEdition` e `edicaoDoEvento?.id !== options.eventEdition.edition_id`, `failed-precondition` "O pedido não é desta edição.". Na aprovação de retirada com `edicaoDoEvento`, logo depois do `Object.assign(created, …)`: `confirmarEdicaoNaAprovacao(…, { request_id: requestId, order_id: orderId, order_number: orderNumber }, options.eventEdition ?? {}, actor, occurredAt)`, os eventos em `events`, e `event_edition: { id, status: "confirmado", separar_ate }` no resultado só quando houve.

- [ ] **Step 1: Write the failing tests**

`confirmacao.integration.test.ts` (node:test, emulador), com o `beforeEach`,
os atores (`coordenacao` interno, `guilherme` wms, `cliente` da BTG) e o
estoque (`warehouse_positions` A-01 e A-02, `stock_balances` de `BTG-POLO-G`
8 e `BTG-BONE` 4, `customers`) de `pick-progress.integration.test.ts`
(20–106), mais a edição: `saveEventEditionTransaction` com o nome "B2B
Conference Necton", `onde.local` "Hotel Unique", o cronograma
`entrega_no_local` 2027-01-28 08:00, `evento` 2027-01-28 10:00 (`ate` 18:00)
e `retorno_ao_estoque` 2027-01-30 09:00, os itens POLO 5 e BONE 4; o envio
por `sendEventEditionTransaction(db, …, cliente, { criarSolicitacao: criarSolicitacaoDaEdicao(db, cliente) })`.
Casos:

```ts
it("1. confirmar a enviada com pedido: confirmado, order_id, order_number e o separar até dado; a solicitação aprovada; o pedido com event_edition_id; um evento evento.edicao_confirmada", ...)
it("2. sem separar_ate, a véspera da entrega no local: entrega 2027-01-28 → 2027-01-27", ...)
it("3. a mesma chave devolve o mesmo resultado sem segundo pedido; expected_edicao velho recusa 'A edição mudou em outra aba' e a solicitação continua open", ...)
it("4. fora de enviado recusa 'A edição não está enviada.'; a solicitação de outra edição recusa 'O pedido não é desta edição.'", ...)
it("5. sem itens do estoque (só coleta): confirmada na transação própria, com o recibo op_evento_confirm_ e o separar_ate da véspera do evento", ...)
it("6. a aprovação feita em Pedidos (decideCustomerRequestTransaction sem opção) confirma a edição com o separar até padrão; repetida, não grava de novo", ...)
it("7. a solicitação sem event_edition_id aprova como sempre: sem edição, sem evento evento.*", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/confirmacao.integration.test.js"`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement `confirmacao.ts`, the option and the hook in `decideCustomerRequestTransaction`, and register the test**

A leitura da edição fica entre a leitura da solicitação e a primeira
escrita (o Firestore recusa ler depois de escrever); o `digest` e o recibo,
inline como `count-rounds.ts` (354, 435–446); `actorRef` e `ActorRef`
importados de `./edicao-gravacao.js` (parte 2), sem cópia local.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2 e, no mesmo `emulators:exec`,
`node --test lib/customer-request.integration.test.js lib/domain/pick-progress.integration.test.js`.
Expected: PASS nos casos 1 a 7; a decisão sem edição continua igual.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/confirmacao.ts functions/wms/src/domain/eventos/confirmacao.integration.test.ts functions/wms/src/domain/operations.ts functions/wms/package.json
git commit -m "feat(wms): a confirmação da edição do evento, com o separar até e a aprovação do pedido"
```

### Task 2: os ganchos do pedido: recusa, packing concluído, entrega e cancelamento

**Files:**
- Modify: `functions/wms/src/domain/eventos/confirmacao.ts`
- Modify: `functions/wms/src/domain/operations.ts` (`decideCustomerRequestTransaction`: a recusa e o cancelamento antes do `transaction.update(requestRef, …)` da decisão, 6696–6712; `advanceWarehouseTaskTransaction`, 7378–9754: a leitura depois do `orderRow`, 7522–7533, o packing concluído junto dos `packages` e `package_items`, 9168–9262, a entrega depois do `orders` `ENTREGUE`, 9529–9535; `cancelWarehouseOrderTransaction`, 6771–7310: a leitura depois do pedido, 6794–6798, o gancho antes do `status: "CANCELADO"`, 7151–7159)
- Modify: `functions/wms/src/domain/eventos/envio.ts` (`cancelarEdicaoComSolicitacao`, parte 6: a rota idempotente e a da coordenação) e `functions/wms/src/domain/eventos/edicao-gravacao.ts` (`cancelEventEditionTransaction`, parte 2: `confirmado` e `separado` sem pedido)
- Test: `functions/wms/src/domain/eventos/confirmacao.integration.test.ts` (casos 8 a 16); `functions/wms/src/domain/eventos/envio.integration.test.ts` (parte 6: os casos 2 e 10 mudam pela leitura e pelo gancho da aprovação de T1, e o 9, pelo gancho da decisão desta tarefa)

**Interfaces:**
- Consumes: T1; `cancelWarehouseOrderTransaction`, `advanceWarehouseTaskTransaction` (`../operations.js`); `completeOrderSeparation` (`../pick-progress.js`, 1152); `cancelarEdicaoComSolicitacao(db, input, actor)` (`./envio.js`, parte 6: hoje decide `cancel` ou `reject` numa transação e cancela a edição noutra); em `envio.integration.test.ts` (parte 6), a edição dos casos 3 a 10 (`saveEventEditionTransaction` e o envio por `sendEventEditionTransaction` com `criarSolicitacaoDaEdicao(db, cristiane)`), que o caso 2 passa a usar; `cancelEventEditionTransaction`, `CancelarEdicao` (parte 2); no caso 16, `saveEventEditionTransaction` com `patch: { separar_ate }` como a parte 2 o deixa (`separar_ate` em `ConteudoDaEdicaoSchema`; `camposDoPatchPermitidos` o dá a owner, admin e interno em `confirmado` e `separado`; `problemaDoPatch` o recusa em `rascunho` e `enviado` com "O separar até nasce na confirmação"), sem redefinir o schema; `LOCAL_DO_CANCELADO`.
- Produces:
  - `cancelarEdicaoPeloPedido(transaction, db, edicao: EdicaoDoPedido, motivo: string | null, actor, occurredAt): OperationalEventSummary | null` — já `cancelado` ou `fechado`: null, nada grava; `podeTransitar(status, "cancelado")` falso: `failed-precondition` "Os itens já saíram: registre o retorno e feche a edição."; senão `status: "cancelado"`, `cancelada_em`, `cancelada_por` (`actorRef`), `cancelamento_motivo`, `pedido.cancelado_em: occurredAt`, `edicao + 1`; evento `edicao_cancelada { edition_id, status_anterior }`.
  - `type VolumeDaEdicao = { numero: number; unidades: number; peso_kg: number | null; itens: Array<{ client_item_code: string | null; product_name: string; size: string | null; quantidade: number }> }`; `volumesDaEdicao(view: EdicaoView, packages: Array<{ id: string; volume_number: number; packed_units: number; weight_kg?: number | null }>, packageItems: Array<{ package_id: string; sku_code: string; client_item_code?: string | null; product_name: string; qty_packed: number }>): { volumes: VolumeDaEdicao[]; foiPorSku: Map<string, number> }` — puro; `size` vem do item da edição com o mesmo `sku_code`; os volumes na ordem do número.
  - `separarEdicaoNoPacking(transaction, db, edicao, dados: { order_id: string; lacre: string | null; volumes: VolumeDaEdicao[]; foiPorSku: Map<string, number> }, actor, occurredAt): OperationalEventSummary` — `podeTransitar(status, "separado")` ou `failed-precondition` "A edição do evento está <ROTULO_DO_STATUS> e não recebe o pedido."; grava `status: "separado"`, `pedido.separado_em`, `pedido.lacre`, `pedido.volumes_total`, `pedido.volumes`, `itens[].foi` (0 no SKU sem volume), `edicao + 1`; evento `edicao_separada { edition_id, order_id, volumes, pecas }`.
  - `entregarEdicaoNaExpedicao(transaction, db, edicao, dados: { order_id: string; comprovante: string | null }, actor, occurredAt): OperationalEventSummary` — `podeTransitar(status, "no_evento")` (de `separado` e de `confirmado`) ou a mesma recusa; grava `status: "no_evento"`, `pedido.entregue_em: occurredAt`, `pedido.entregue_por` (`actorRef`), `pedido.comprovante` e, só quando o momento `entrega_no_local` tem `feito` null, `feito: { inicio: occurredAt, fim: null, observacao: null, origem: "pedido", registrado_por, registrado_em, corrigido_em: null }`; evento `edicao_no_evento { edition_id, order_id, entregue_em }`.
  - Em `operations.ts`: na decisão, com `releasesRequest` (`reject` e `cancel`) e `edicaoDoEvento`, `cancelarEdicaoPeloPedido(…, input.reason ?? null, …)` antes do `transaction.update(requestRef, …)`; no avanço, `const edicaoDoEvento = await lerEdicaoDoPedido(transaction, db, orderRow?.data.event_edition_id, customerCode)` logo depois do `orderRow`, os dados de `volumesDaEdicao` recolhidos nos laços que criam `packages` (9168) e `package_items` (9245), `separarEdicaoNoPacking(…, { order_id: orderId, lacre: sealCode || null, …volumesDaEdicao(…) }, …)` em `packing` → `completed` e `entregarEdicaoNaExpedicao(…, { order_id: orderId, comprovante: proofReference || null }, …)` em `shipping` → `delivered`, depois do `ENTREGUE`; os eventos em `events`. No cancelamento, `lerEdicaoDoPedido(transaction, db, order.event_edition_id, customerCode)` depois do pedido lido e `cancelarEdicaoPeloPedido(…, input.reason, …)` antes do `status: "CANCELADO"`.
  - Em `envio.ts`, `cancelarEdicaoComSolicitacao` passa a rotear pela edição lida. Primeiro, a rota idempotente: a edição já em `cancelado` com `pedido.cancelado_em` gravado devolve `{ id, resultado: "cancelada" }` sem gravar nada (a repetição de um cancelamento com pedido e o cancelamento que o gancho já fez, pelo portal ou por Pedidos, caem aqui, porque o recibo deles é o da decisão ou o do pedido, não um `op_evento_cancel_`; sem pedido, a edição cancelada segue para `cancelEventEditionTransaction`, que devolve o próprio recibo). Depois, a coordenação (owner, admin, interno) precisa de `motivo` (`invalid-argument` "Informe o motivo", antes de qualquer escrita); em `enviado` com a solicitação `open`, a decisão (`cancel` do cliente, `reject` da coordenação) é o ato inteiro, porque o gancho de T2 cancela a edição dentro dela, e `cancelEventEditionTransaction` só roda quando a solicitação já estava `cancelled` ou `rejected`; em `confirmado` ou `separado` com `pedido.order_id`, só a coordenação (o cliente recebe `failed-precondition` "Só a coordenação cancela uma edição confirmada.", sem gravar), por `cancelWarehouseOrderTransaction(db, { order_id, reason: motivo, idempotency_key: \`evento:cancel:${idempotency_key}\` }, actor)` (o gancho grava a edição), devolvendo `{ id, resultado: "cancelada" }`; sem pedido, `cancelEventEditionTransaction`, que passa a aceitar `confirmado` e `separado` para a coordenação (o cliente continua recusado: "Só a coordenação cancela uma edição confirmada."). Em `envio.integration.test.ts`, os casos 7 e 8 continuam verdes (a edição acaba igual; se algum afirmar o recibo `op_evento_cancel_` no caminho da solicitação `open`, troque pelo recibo da decisão) e os casos 2, 9 e 10 mudam (passo 1).

- [ ] **Step 1: Write the failing tests**

```ts
it("8. a recusa em Pedidos cancela a edição enviada com o motivo; evento edicao_cancelada { status_anterior: 'enviado' }", ...)
it("9. o packing concluído pela bancada (completeOrderSeparation, dois volumes, L-0101) deixa a edição separada: separado_em, lacre, volumes_total 2, volumes[] com numero, unidades e itens (código, nome, tamanho, quantidade), foi por item (POLO 5, BONE 4); evento edicao_separada { volumes: 2, pecas: 9 }", ...)
it("10. o packing concluído pelo avanço genérico (volume único) escreve a mesma edição, com um volume", ...)
it("11. a entrega (dispatched e delivered) deixa a edição no evento: entregue_em, entregue_por, comprovante e o feito de entrega_no_local com origem pedido; evento edicao_no_evento", ...)
it("12. a entrega com entrega_no_local já registrado à mão não muda o feito; grava só o pedido", ...)
it("13. o cancelamento do pedido pela coordenação (cancelWarehouseOrderTransaction) cancela a edição separada com o motivo, e o separado volta à EXPEDICAO", ...)
it("14. cancelarEdicaoComSolicitacao pela coordenação em confirmado cancela o pedido e a edição numa transação; sem motivo recusa 'Informe o motivo' sem gravar; a mesma chave devolve o mesmo pela rota idempotente, sem gravar de novo", ...)
it("15. o cancelamento do pedido cuja edição já está cancelada não grava de novo; o pedido sem event_edition_id separa, entrega e cancela como sempre, sem evento evento.*", ...)
it("16. a coordenação muda o separar até em confirmado e em separado; o cliente não: o patch de saveEventEditionTransaction com separar_ate, depois da confirmação e depois do packing, grava a data na raiz da edição; o do cliente em confirmado recusa 'A edição não aceita mudança neste status' e a data fica", ...)
```

Para o caso 12 grave o `feito` do momento direto no documento, no `before`
do caso (o registro à mão é da parte 8). Separar e concluir como em
`pick-progress.integration.test.ts` (`separar`, `concluir`, `avancar`,
113–140); a entrega com `shipping:ship_<orderId>` de `ready_to_dispatch` a
`dispatched` e `delivered`, com `operation: { proof_reference: "Recebido por Ana" }`.

Em `envio.integration.test.ts` (parte 6), três casos passam a esperar o que
a leitura e os ganchos fazem (o 2 mantém o título):

```ts
it("2. a aprovação copia o id ao pedido e ao acompanhamento; o pedido comum fica sem o campo", ...)
// a edição nasce antes da aprovação, como nos casos 3 a 10: saveEventEditionTransaction e sendEventEditionTransaction com criarSolicitacaoDaEdicao(db, cristiane)
// (a solicitação com event_edition_id sem documento recusaria "Edição não encontrada."); approve pelo manoel da solicitação do envio e da comum:
// orders/{order_id}.event_edition_id e client_order_tracking/{order_id}.event_edition_id === o id da edição; no pedido comum, "event_edition_id" in data === false nos dois
it("9. o cancelamento em Portal › Pedidos já cancela a edição, e cancelarEdicaoComSolicitacao resolve 'cancelada' sem gravar", ...)
// depois do decideCustomerRequestTransaction de cancel (como cancelCustomerOrder): a edição "cancelado", com pedido.cancelado_em (o gancho);
// a chamada seguinte resolve "cancelada" pela rota idempotente: o contador edicao não muda e não nasce segundo evento.edicao_cancelada
it("10. a aprovação em Pedidos confirma a edição, e a cliente não a cancela", ...)
// approve pelo manoel: a edição "confirmado" (o gancho de T1); a cristiane recebe failed-precondition "Só a coordenação cancela uma edição confirmada."
// e a edição continua "confirmado"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: o `emulators:exec` do T1, com `lib/domain/eventos/envio.integration.test.js` no mesmo `node --test`. Expected: FAIL nos casos 8 a 16 (no 16, sem o gancho do packing a edição não chega a `separado`) e no 9 de `envio.integration` (sem o gancho da decisão, a edição continua `enviado` depois do cancelamento pelo portal); os casos 2 e 10 novos de `envio.integration` já passam, porque dependem só de T1.

- [ ] **Step 3: Implement the hooks, the three call sites, the idempotent route and the coordination route**

- [ ] **Step 4: Run the integration list once**

Run: `cd C:\DEV\Dute; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `order-cancel`, `order-delivery`, `pick-progress`,
`customer-request`, `billing-callables`, `envio.integration` (com os casos
2, 9 e 10 mudados no passo 1, pela leitura e pelos ganchos desta parte; os
outros, iguais) e `edicao.integration` (o caso 10 da parte 2 continua: o
cliente não cancela a confirmada).

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/confirmacao.ts functions/wms/src/domain/eventos/confirmacao.integration.test.ts functions/wms/src/domain/eventos/envio.ts functions/wms/src/domain/eventos/envio.integration.test.ts functions/wms/src/domain/eventos/edicao-gravacao.ts functions/wms/src/domain/operations.ts
git commit -m "feat(wms): a edição do evento anda com o pedido: separada, no evento e cancelada pelos ganchos"
```

### Task 3: a callable `confirmEventEdition`, a matriz e o wrapper

**Files:**
- Modify: `functions/wms/src/index.ts` (uma linha no bloco `// Eventos`, depois das sete callables das partes 2 e 3, logo após `attachEventPhoto`; o bloco começa depois de `archiveClientEventTemplate`, 7246–7253)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (uma linha na `MATRIZ`, 82–315)
- Modify: `artifacts/app/src/lib/wms/eventos.ts` (`CALLABLES_DOS_EVENTOS` e o wrapper), `artifacts/app/src/lib/eventos/tipos.ts` (os tipos)
- Test: `artifacts/app/src/lib/wms/eventos.test.ts` (um `it` novo)

**Interfaces:**
- Consumes: `getProfile` (1383), `requireOperationsCoordinator` (1488–1495), `PROJECT_ID`, `assertEventosLiberado` (parte 1), `entradaDe` (parte 2), T1; `COORDENACAO` e `SO_COORDENACAO` da matriz (46, 56); `functionsDoApp`, `firebaseApp`, `semCamposVazios`, `erroDaCallable` como em `lib/wms/mover-caixa.ts`.
- Produces: `export const confirmEventEdition = onCall(async (request) => { const profile = await getProfile(request); requireOperationsCoordinator(profile); assertEventosLiberado(PROJECT_ID); return confirmEventEditionTransaction(db, entradaDe(ConfirmarEdicaoSchema, request.data ?? {}), profile); });` e, na `MATRIZ`, `confirmEventEdition: { passam: COORDENACAO, recusa: SO_COORDENACAO }`.
- Produces (app): `CALLABLES_DOS_EVENTOS` ganha `"confirmEventEdition"`; `type ConfirmarEdicao = { id: string; expected_edicao: number; separar_ate?: string | null; idempotency_key: string }`; `type ResultadoDaConfirmacao = { id: string; status: "confirmado"; separar_ate: string | null; order_id: string | null; order_number: string | null; edition: EdicaoView }`; `confirmarEdicao(entrada: ConfirmarEdicao): Promise<ResultadoDaConfirmacao>`.

- [ ] **Step 1: Write the failing test**

Em `eventos.test.ts`: `confirmarEdicao({ id: "ced_1", expected_edicao: 3, separar_ate: null, idempotency_key: "k-1" })` chama `httpsCallable(…, "confirmEventEdition")` com `separar_ate: null` mantido (o null é de propósito: `separar_ate` está na lista dos `null` aceitos, nas Global Constraints do índice) e nenhuma chave `undefined`; o `HttpsError` vira `erroDaCallable`; `CALLABLES_DOS_EVENTOS` contém `confirmEventEdition`. A linha da matriz e o `it` de `platform-lists.test.ts` da parte 2 (toda callable da lista numa linha do `index.ts` com `assertEventosLiberado(PROJECT_ID)`) cobrem o servidor.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/platform-lists.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js"`
Expected: FAIL (a lista tem o nome e o `index.ts` não tem a callable; a matriz tem a linha sem callable).

- [ ] **Step 3: Implement the callable, the matrix line, the types and the wrapper**

- [ ] **Step 4: Run tests to verify they pass**

Run: os do passo 2, mais `node --test lib/callables-auth.integration.test.js` no mesmo `emulators:exec` (a callable entra sozinha na descoberta) e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/tipos.ts
git commit -m "feat(wms): a callable confirmEventEdition, da coordenação, e o wrapper do app"
```

### Task 4: a agenda `/eventos` (v3), de todos os clientes

**Files:**
- Create: `artifacts/app/src/lib/eventos/agenda.ts`, `artifacts/app/src/features/eventos/confirmar-edicao-dialogo.tsx`, `artifacts/app/src/pages/eventos.tsx`, `artifacts/app/src/pages/eventos-view.tsx`
- Test: `artifacts/app/src/lib/eventos/agenda.test.ts`, `artifacts/app/src/features/eventos/confirmar-edicao-dialogo.test.tsx`, `artifacts/app/src/pages/eventos-view.test.tsx`, `artifacts/app/src/pages/eventos.test.tsx`

**Interfaces:**
- Consumes: `useLeitura(chave, consulta, mapear)` (`lib/operacao/leitura.ts`, 408–418; precedente `pages/pedidos.tsx`, 292–298); `QueueGroup` (`title`, `hint`, `count`, `empty`, `carregando`), `QueueRow` (`icon`, `tone`, `title`, `badge`, `meta`, `detail`, `age`, `actions`), `LinhaDaFila` (`components/ui/queue-list.tsx`); `Segmented`, `PageHeader` (`title`, `description`), `BotaoDeAcao`/`EstadoDaAcao`, `Dialog*`, `Input`, `Label`, `Button`, `CarregandoNaRegiao`, `FalhaNaLeitura`; `useToast`, `useTentativaDaEscrita`, `avisoDoErroDaEscrita`, `desfechoDoErro`; `useActiveCustomer().options` (`{ code, name }`), `useAppUser`; `confirmarEdicao` (T3); `EdicaoView`, `StatusDaEdicao` (`lib/eventos/tipos.ts`, parte 2); da parte 4, `edicaoDaLeitura` (`lib/eventos/leitura.ts`), `periodoDaEdicao`, `formatarDia`, `formatarInstante` (`lib/eventos/cronograma.ts`) e `resumoDosItens` (`lib/eventos/itens.ts`); `ROTULO_DO_STATUS`, `ROTULO_DO_MOMENTO` (`@workspace/dominio`, parte 1); `textosDaTela`, `textosForaDaLista`, `violacoesDeAcessibilidade`, `botaoPeloRotulo` (`src/test/`); os índices da parte 1 (`status` asc + `separar_ate` asc; `status` asc + `updated_at` desc).
- Produces (`lib/eventos/agenda.ts`):
  - `GRUPOS_DA_AGENDA = ["para_confirmar", "proximos", "rascunhos", "em_andamento", "para_fechar", "fechados"] as const`, `type GrupoDaAgenda`; `type FiltroDaAgenda = "proximos" | "em_andamento" | "para_fechar" | "fechados"`.
  - `consultaDaAgenda(db: Firestore, grupo: GrupoDaAgenda): Query<DocumentData>` — `para_confirmar`: `where("status", "==", "enviado"), orderBy("updated_at", "desc")`; `proximos`: `where("status", "in", ["confirmado", "separado"]), orderBy("separar_ate", "asc")`; `rascunhos`, `em_andamento` e `para_fechar`: `status ==` `rascunho`, `no_evento` e `retornado`, `updated_at desc`; `fechados`: `where("status", "in", ["fechado", "cancelado"]), orderBy("updated_at", "desc"), limit(50)`.
  - `momentosDaLinha(view: EdicaoView): string` — "Montagem 28/01 10:00 · Desmontagem 29/01 20:00" (os previstos que houver, por `formatarDia`; sem os dois, "Evento 28/01 10:00"; o previsto com `MomentoView.previsto.hora` null mostra só o dia, "Montagem 28/01 · Desmontagem 29/01 20:00" e "Evento 28/01": a hora só é obrigatória na entrega no local, no envio e nas mudanças depois dele, decisão 12 da spec); em `no_evento`, "Evento começou 25/11 08:00" (`formatarInstante` do `feito.inicio` de `evento`, ou do de `entrega_no_local`); em `retornado`, "Retornou 19/11 10:20" (`retorno.chegou_em`).
  - `resumoDaLinha(view): string` — "PED-0007 · 100 itens · 2.000 peças · coleta no cliente 2.190" (o `pedido.order_number` quando há, `resumoDosItens(itens)`, a coleta só com `coleta.quantidade > 0`); em `rascunho`, "Edição 2027 a partir de 2026 · 18 itens · ainda sem envio" (sem `origem_edicao_id`, "Edição 2027 · 18 itens · ainda sem envio"); em `no_evento`, "9 itens · 22 peças · 4 fotos"; em `retornado`, "7 itens · voltaram 7" (a soma de `itens[].voltou`).
  - `diaCurto(data: string): string` → "Ter 26/01" (o dia da semana pt-BR abreviado, sem o ponto, inicial maiúscula); `vesperaDe(data: string): string` (a conta do servidor); `prazoDaLinha(view, hoje: Date): string | null` — `confirmado`/`separado`: "Separar até Ter 26/01"; `no_evento`: "Desmontagem hoje 18:00" quando a `data` prevista de `desmontagem` é `hoje`, senão "Desmontagem 29/01 20:00" (com o `previsto.hora` null, só o dia: "Desmontagem hoje" e "Desmontagem 29/01"); os outros, null (o que falta em `retornado` entra na parte 10, com o preço).
  - `legendaDoGrupo(grupo: GrupoDaAgenda, n: number): string` — "1 edição enviada pelo cliente" / "N edições enviadas pelo cliente"; "1 edição confirmada ou em rascunho" / "N edições confirmadas ou em rascunho"; "1 edição no evento" / "N edições no evento"; "1 edição retornada" / "N edições retornadas"; "1 edição fechada ou cancelada" / "N edições fechadas ou canceladas".
  - `CONFIRMA_EDICAO_ROLES = ["owner", "admin", "interno"] as const`; `podeConfirmar(role: string | null | undefined): boolean`.
  - `type LinhaDaAgenda = { id: string; evento: string; label: string; cliente: string; local: string; datas: string; momentos: string; status: StatusDaEdicao; selo: string; resumo: string; prazo: string | null; pedidoId: string | null; orderId: string | null; expectedEdicao: number; separarAtePadrao: string | null }`; `linhaDaAgenda(view: EdicaoView, nomeDoCliente: string, hoje: Date): LinhaDaAgenda` — `datas` é `periodoDaEdicao(cronograma) ?? ""`; `selo` é `ROTULO_DO_STATUS[status]`, menos em `rascunho`: "Rascunho do cliente"; `cliente` é o nome do cadastro, ou o `customer_code`; `label` é `view.label` (a linha da agenda não o mostra, como na prancha; o diálogo da adoção da parte 13 o lê); `pedidoId` é `view.pedido?.request_id ?? null` (a solicitação é a raiz do pedido: a parte 13 só adota na linha enviada sem ela) e `orderId` é `view.pedido?.order_id ?? null` (o pedido aprovado, o do "Ver pedido").
  - `type HomeEventEdition = { id: string; event_name: string; label: string; customer_code: string; status: StatusDaEdicao }`; `edicoesEnviadas(): Promise<HomeEventEdition[]>` — `getDocs(consultaDaAgenda(firestore, "para_confirmar"))`, cada documento por `edicaoDaLeitura(doc.id, doc.data())` (o que volta `null` sai) e a view em `{ id, event_name, label, customer_code, status }`, para o Início (T5); as partes 9 e 10 leem os status delas na mesma forma.
- Produces (`features/eventos/confirmar-edicao-dialogo.tsx`): `ConfirmarEdicaoDialogo({ linha, separarAte, onSepararAte, estado, erro, onConfirmar, onFechar }: { linha: LinhaDaAgenda; separarAte: string; onSepararAte: (valor: string) => void; estado: EstadoDaAcao; erro: string | null; onConfirmar: () => void; onFechar: () => void })` — "Confirmar a edição", "<evento> · <cliente>", "Separar até" (`<input type="date">`, começa em `separarAtePadrao`), "Confirmar" (`BotaoDeAcao`, andamento "Confirmando…") e "Voltar"; não fecha em `andamento`; a recusa do servidor fica nele (a parte 10 põe o preço e o rótulo "Confirmar e fechar preço" aqui).
- Produces (`pages/eventos-view.tsx`): `EventosView({ filtro, onFiltro, contagens, grupos, podeConfirmar, confirmacao, onConfirmar })`, com `grupos: Record<GrupoDaAgenda, { linhas: LinhaDaAgenda[]; carregando: boolean; erro: boolean; tentar: () => void }>` e `confirmacao: Parameters<typeof ConfirmarEdicaoDialogo>[0] | null`. Sempre "Para confirmar" e, pelo filtro, "Próximos" (as confirmadas e separadas, e os rascunhos como linha só de leitura), "Em andamento", "Para fechar" ou "Fechados". A linha: o evento, "<cliente> · <local>", as datas e os momentos, o selo, o resumo e o prazo; a ação de "Para confirmar" é "Confirmar" (só com `podeConfirmar`); as outras linhas com `orderId` têm "Ver pedido" (`/pedidos`); o rascunho não tem ação (o link de cada linha para a ficha entra na parte 8).
- Produces (`pages/eventos.tsx`): `export default function PaginaEventos()` — seis `useLeitura` (chave `eventos:<grupo>`, `consultaDaAgenda`, `edicaoDaLeitura`), as linhas por `linhaDaAgenda` com `useActiveCustomer().options`, o filtro em estado (padrão `proximos`), o diálogo com `useTentativaDaEscrita` (a chave repete depois de um resultado incerto, `desfechoDoErro`), `confirmarEdicao({ id, expected_edicao, separar_ate, idempotency_key })` sem campo vazio, o toast "Edição confirmada." no sucesso (a linha sai de "Para confirmar" pela leitura ao vivo) e `avisoDoErroDaEscrita` no resto.

- [ ] **Step 1: Write the failing tests**

`agenda.test.ts` (vitest, puro): `momentosDaLinha` e `resumoDaLinha` nos
cinco status da prancha; o previsto sem hora, `previsto.hora` null, mostra
só o dia (em cópias do dado, que continua com a hora em todos os
momentos): `momentosDaLinha` com a montagem sem hora →
"Montagem 28/01 · Desmontagem 29/01 20:00" e, só com o evento, sem hora →
"Evento 28/01"; `prazoDaLinha` em `no_evento` com a desmontagem de 29/01
sem hora → "Desmontagem hoje" com `hoje` em 29/01 e "Desmontagem 29/01" na
véspera;
`prazoDaLinha` com `separar_ate` "2027-01-26" →
"Separar até Ter 26/01" e "2027-03-08" → "Separar até Seg 08/03";
`vesperaDe("2027-01-28")` → "2027-01-27" e `vesperaDe("2027-03-01")` →
"2027-02-28"; `legendaDoGrupo` no singular e no plural; `podeConfirmar` para
os sete papéis do WMS; `linhaDaAgenda` na linha enviada com solicitação
(`pedidoId` é o `request_id`, `orderId` null, `label` "2027", o
`view.label`) e sem ela, só com coleta (os dois null), e na confirmada
(`orderId` é o `order_id`); e a trava dos
índices: lê `firestore.indexes.json` e
exige em `client_event_editions` os índices `status ASCENDING, separar_ate ASCENDING`
e `status ASCENDING, updated_at DESCENDING`, os que `consultaDaAgenda` pede
(a leitura é direta, fora de `cloud-api.ts`: `CONSULTAS_DAS_TELAS` não a vê).

`confirmar-edicao-dialogo.test.tsx` e `eventos-view.test.tsx`
(`renderToStaticMarkup` em `<Router ssrPath="/eventos">`, no molde de
`estoque-mapa-mover-view.test.tsx`, com as camadas do `BotaoDeAcao`
"Confirmando…" e "Conferir"), as cinco linhas da prancha como `LinhaDaAgenda`:

```ts
it("a agenda cheia: só rótulos, dados e ações, e passa no axe", async () => {
  expect(foraDaLista(html, [
    "Eventos", "As edições dos clientes, da mais próxima à mais distante, e o que a Armazenagem faz antes de cada uma.",
    "Próximos", "Em andamento", "Para fechar", "Fechados", /^\d+$/,
    "Para confirmar", "1 edição enviada pelo cliente",
    "B2B Conference Necton", "BTG Pactual · Hotel Unique", "28 e 29/01/2027", "Montagem 28/01 10:00 · Desmontagem 29/01 20:00", "Enviado",
    "PED-0007 · 100 itens · 2.000 peças · coleta no cliente 2.190", "Separar até Ter 26/01", "Confirmar",
    "2 edições confirmadas ou em rascunho",
    "Convenção regional", "Itaú · Centro de convenções Rebouças", "12/03/2027", "Montagem 11/03 14:00", "Confirmado", "PED-0009 · 14 itens · 38 peças", "Separar até Seg 08/03", "Ver pedido",
    "Feira de Investimentos", "BTG Pactual · Expo Center Norte", "14 a 16/05/2027", "Montagem 13/05 08:00", "Rascunho do cliente", "Edição 2027 a partir de 2026 · 18 itens · ainda sem envio",
  ])).toEqual([]);
  expect(await violacoesDeAcessibilidade(html)).toEqual([]);
});
it("Em andamento e Para fechar: as linhas da prancha", ...)
// "1 edição no evento", "Workshop de líderes", "BTG Pactual · Grand Hyatt", "24 e 25/11/2026", "Evento começou 25/11 08:00", "No evento", "9 itens · 22 peças · 4 fotos", "Desmontagem hoje 18:00";
// "1 edição retornada", "Encontro de parceiros", "BTG Pactual · Hotel Tivoli", "18/11/2026", "Retornou 19/11 10:20", "Retornado", "7 itens · voltaram 7"
it("sem podeConfirmar (o wms) a linha enviada não tem Confirmar; o rascunho não tem ação", ...)
it("o diálogo: Confirmar a edição, Separar até com a véspera, Confirmar e Voltar; a recusa do servidor fica nele; em andamento não fecha", ...)
it("vazios, carregando e falha: 'Nenhuma edição enviada pelo cliente.', 'Carregando as edições…', 'Não foi possível carregar as edições.' e 'Tentar de novo'", ...)
```

`eventos.test.tsx` (jsdom, no molde de `estoque-mapa-mover.test.tsx`):
`vi.mock("@/lib/operacao/leitura")` devolvendo as edições por chave,
`vi.mock("@/lib/wms/eventos")` com `confirmarEdicao`, `useActiveCustomer`
com `options: [{ code: "BTG Pactual", name: "BTG Pactual" }]`, `useAppUser`
com o papel em `chamadas.papel.atual`. Casos: o "Confirmar" da linha abre o
diálogo com "Separar até" em "2027-01-27"; "Confirmar" chama
`confirmarEdicao` com `{ id: "ced_1", expected_edicao: 3, separar_ate: "2027-01-27", idempotency_key: expect.any(String) }`
e nenhuma chave `undefined`; a recusa "A edição não está enviada." fica no
diálogo e o botão volta a "Confirmar"; depois de um resultado incerto a
segunda tentativa leva a mesma chave; o papel `wms` não vê "Confirmar".

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/agenda.test.ts src/features/eventos/confirmar-edicao-dialogo.test.tsx src/pages/eventos-view.test.tsx src/pages/eventos.test.tsx`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implement `agenda.ts`, the dialog, the view and the page**

A cor dos selos pela escala da v3 (`theme-colors.test.ts` trava cor fixa);
a tela não lê o cliente ativo: a agenda mostra todos, como Pedidos.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/theme-colors.test.ts src/lib/carregando/trava.test.ts src/lib/customer-literals.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/eventos/agenda.test.ts artifacts/app/src/features/eventos/confirmar-edicao-dialogo.tsx artifacts/app/src/features/eventos/confirmar-edicao-dialogo.test.tsx artifacts/app/src/pages/eventos.tsx artifacts/app/src/pages/eventos-view.tsx artifacts/app/src/pages/eventos-view.test.tsx artifacts/app/src/pages/eventos.test.tsx
git commit -m "feat(app): a agenda dos eventos da Armazenagem, de todos os clientes, com o Confirmar"
```

### Task 5: "Evento para confirmar" no Início da Armazenagem

**Files:**
- Modify: `artifacts/app/src/lib/home-inbox.ts` (o parâmetro de `buildHomeInbox`, 100–118; o item depois de `triage`, 158–168)
- Modify: `artifacts/app/src/lib/inicio-do-wms.ts` (`ICONE_DO_ITEM`, 11–20)
- Modify: `artifacts/app/src/lib/use-inicio-do-wms.ts` (a leitura ao lado das outras, 57–90; `falhas`, `reler`, `carregando`, `relendo`, `falhaSoNaReleitura`, 109–147)
- Test: `artifacts/app/src/lib/home-inbox.test.ts`, `artifacts/app/src/pages/home-view.test.tsx` (o ícone, 141–145), `artifacts/app/src/lib/eventos/agenda.inicio.test.ts` (novo: `edicoesEnviadas` com o `getDocs` simulado)

**Interfaces:**
- Consumes: `plural`, `listPreview`, `canAccessModule` (`home-inbox.ts`); `EVENTOS_LIBERADO` (parte 1); `HomeEventEdition` (com `status`), `edicoesEnviadas` (cada documento por `edicaoDaLeitura`, da parte 4), `CONFIRMA_EDICAO_ROLES` (T4); `useLeituraComFalha`, `relerDoZero`; o molde do `getDocs` simulado em `lib/comercial/inicio.sem-rede.test.ts` (`vi.mock("../firebase")` e `vi.mock("firebase/firestore")` com o original).
- Produces: `buildHomeInbox({ …, eventEditions?: HomeEventEdition[] })` acrescenta, depois de `triage`, só quando `role` está em `CONFIRMA_EDICAO_ROLES` e só com as edições de `status === "enviado"` (quando há alguma), `{ id: "event-editions", tone: "attention", title: "1 evento para confirmar" | "N eventos para confirmar", detail: listPreview(["<nome> · <cliente>", …], 2), href: "/eventos", actionLabel: "Confirmar" }`; `ICONE_DO_ITEM["event-editions"] = CalendarDays`; em `useInicioDoWms`, `seesEventos = ligado && EVENTOS_LIBERADO && canAccessModule(role, [...CONFIRMA_EDICAO_ROLES])` e `useQuery({ queryKey: ["eventos", "para-confirmar"], queryFn: edicoesEnviadas, enabled: seesEventos, refetchInterval: 60_000, refetchOnWindowFocus: false })`; a leitura entra em `carregando`, `relendo`, `falhaSoNaReleitura`, `reler` (a chave) e `falhas` ("eventos"), e fica fora de `leiturasDaApi` (lê o Firestore direto, como as anotações). As partes 9 e 10 só concatenam as leituras delas (`edicoesNoEvento`, `edicoesRetornadas`) à mesma `eventEditions`; o filtro por `status` deste item já as deixa de fora.

- [ ] **Step 1: Write the failing tests**

```ts
it("a edição enviada vira 'Evento para confirmar' para a coordenação, leva a /eventos e não aparece para o wms; a de outro status não conta", () => {
  const edicao = { id: "ced_1", event_name: "B2B Conference Necton", label: "2027", customer_code: "BTG Pactual", status: "enviado" as const };
  expect(buildHomeInbox({ role: "admin", eventEditions: [edicao] }).items).toContainEqual({ id: "event-editions", tone: "attention", title: "1 evento para confirmar", detail: "B2B Conference Necton · BTG Pactual", href: "/eventos", actionLabel: "Confirmar" });
  expect(buildHomeInbox({ role: "admin", eventEditions: [edicao, { ...edicao, id: "ced_2", event_name: "Convenção regional" }] }).items.find((item) => item.id === "event-editions")?.title).toBe("2 eventos para confirmar");
  expect(buildHomeInbox({ role: "wms", eventEditions: [edicao] }).items.map((item) => item.id)).not.toContain("event-editions");
  expect(buildHomeInbox({ role: "admin", eventEditions: [{ ...edicao, status: "no_evento" as const }] }).items.map((item) => item.id)).not.toContain("event-editions");
});
```

Em `home-view.test.tsx`: `itensDoInicioDoWms([{ ...ITENS[0], id: "event-editions" }])[0].icon.displayName` é `"CalendarDays"`.

Em `agenda.inicio.test.ts` (vitest), `vi.mock("../firebase", () => ({ firestore: {} }))`
e `vi.mock("firebase/firestore", …)` com o original, `collection`, `query`,
`where`, `orderBy` e `limit` neutros e `getDocs: lerDocs` (um `vi.fn()` de
`vi.hoisted`), como em `lib/comercial/inicio.sem-rede.test.ts`:

```ts
it("edicoesEnviadas lê cada documento pela edicaoDaLeitura: o Início recebe o status, e o documento sem status sai", async () => {
  lerDocs.mockResolvedValue({
    docs: [
      { id: "ced_1", data: () => ({ customer_code: "BTG Pactual", event_id: "cev_1", event_name: "B2B Conference Necton", label: "2027", status: "enviado", edicao: 3, updated_at: Timestamp.fromDate(new Date("2026-11-20T12:00:00Z")) }) },
      { id: "ced_x", data: () => ({ customer_code: "BTG Pactual", event_name: "Sem status", label: "2027" }) },
    ],
    metadata: { fromCache: false },
  });
  expect(await edicoesEnviadas()).toEqual([{ id: "ced_1", event_name: "B2B Conference Necton", label: "2027", customer_code: "BTG Pactual", status: "enviado" }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/home-inbox.test.ts src/pages/home-view.test.tsx src/lib/eventos/agenda.inicio.test.ts`
Expected: FAIL em `home-inbox.test.ts` e `home-view.test.tsx` (o item e o
ícone não existem); `agenda.inicio.test.ts` já passa com T4 e fica como a
trava de que o Início recebe o `status` (sem ele, o filtro do item tiraria
as enviadas do Início, e só os testes com dados simulados passariam).

- [ ] **Step 3: Implement the item, the icon and the reading**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/pages/home.test.tsx src/pages/home.carregando.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/home-inbox.ts artifacts/app/src/lib/home-inbox.test.ts artifacts/app/src/lib/inicio-do-wms.ts artifacts/app/src/lib/use-inicio-do-wms.ts artifacts/app/src/pages/home-view.test.tsx artifacts/app/src/lib/eventos/agenda.inicio.test.ts
git commit -m "feat(app): o evento para confirmar no Precisa de você da Armazenagem"
```

### Task 6: `TELAS_DO_WMS_NA_V3`, o menu, a rota e o título

**Files:**
- Modify: `artifacts/app/src/lib/wms-v3.ts` (a lista, 11–39) e `artifacts/app/src/lib/wms-v3.test.ts` (o array exato, 20–37)
- Modify: `artifacts/app/src/lib/modules.ts` (`AppModule.liberacao`, 216; o módulo `eventos` entre `inventory` e `billing`, ~380; `navigationForAmbiente`, 1113–1142; `getNavigationForProfileRole`, 1157–1172; a barra do celular: o `eventos` fica fora de `MOBILE_BAR_PRIORITY`, 1322–1331, e o laço de `getMobileNavigation` que completa a barra, 1348–1351, o pula (`FORA_DA_BARRA_DO_CELULAR`), com o comentário de `MobileNavigation`, 1310–1316: no celular, Eventos vai para "Mais" e a barra do operador não muda)
- Modify: `artifacts/app/src/App.tsx` (o `telaSobDemanda`, ~82; a rota depois de `/pedidos/romaneio`, 384)
- Test: `artifacts/app/src/lib/modules.test.ts` (`ROUTE_ACCESS`, 35–90; o `it.each` do menu, 279–311; um `it` novo do menu e outro no `describe("barra inferior do celular")`, 454–495), `artifacts/app/src/lib/document-title.test.ts`, `artifacts/app/src/lib/resumo-do-modulo.test.ts`

**Interfaces:**
- Consumes: `telaDoWmsNaV3`, `EVENTOS_LIBERADO` (parte 1), `appModule`, `navRoute`, `WMS_ROLES` (119), `CalendarDays` (já importado em `modules.ts`), `protectedRoute` (323–333) e o precedente `MEMORIA_LIBERADA ? [protectedRoute(…)] : []` (405); `contadoresDoMenu`; `MOBILE_BAR_PRIORITY` e `getMobileNavigation` (1322–1364; `modules.test.ts` já importa `getMobileNavigation`); a página de T4.
- Produces: `"/eventos"` ao fim de `TELAS_DO_WMS_NA_V3` ("Eventos, parte 7: a agenda da Armazenagem, tela nova já na v3"); `AppModule.liberacao` ganha `"eventos"`; `appModule({ id: "eventos", label: "Eventos", audience: "internal", icon: CalendarDays, roles: WMS_ROLES, liberacao: "eventos", routes: [navRoute({ id: "eventos-agenda", label: "Eventos", href: "/eventos", icon: CalendarDays, roles: WMS_ROLES })] })`; `navigationForAmbiente(…, eventos: boolean = EVENTOS_LIBERADO)` com `(module.liberacao !== "eventos" || eventos)`, e `getNavigationForProfileRole(role, operation, comercial, financeiro, eventos: boolean = EVENTOS_LIBERADO)`; `getRouteProfileRoles("/eventos")` é `WMS_ROLES` (vem de `APP_MODULES`, com ou sem liberação, 1033–1046); a rota `...(EVENTOS_LIBERADO ? [protectedRoute("/eventos", Eventos)] : [])`; o título "Dutelog | Eventos" sai de `rulesFromModules` sem regra extra; no celular, `FORA_DA_BARRA_DO_CELULAR = ["eventos"]`, que o laço de `getMobileNavigation` que completa a barra pula (o `eventos` não entra em `MOBILE_BAR_PRIORITY`): Eventos fica em "Mais" e a barra de quem tem menos de quatro destinos fixos continua completando com o próximo módulo do menu (a do `wms` segue "Pedidos", "Estoque", "Agent Dute", "Documentos").

- [ ] **Step 1: Write the failing tests**

Em `wms-v3.test.ts`, `"/eventos"` ao fim do array exato. Em `modules.test.ts`:
`["/eventos", ["owner", "admin", "interno", "wms", "suporte"]]` em
`ROUTE_ACCESS`; `["/eventos", "Eventos"]` no `it.each` do menu; e:

```ts
it("Eventos entra no menu do WMS entre Estoque e Faturamento só com a liberação (eventos, parte 7)", () => {
  const com = getNavigationForProfileRole("admin", null, false, false, true).map((module) => module.label);
  expect(com.slice(com.indexOf("Estoque"), com.indexOf("Estoque") + 3)).toEqual(["Estoque", "Eventos", "Faturamento"]);
  expect(getNavigationForProfileRole("admin", null, false, false, false).map((module) => module.label)).not.toContain("Eventos");
  expect(getNavigationForProfileRole("wms", null, false, false, true).map((module) => module.label)).toContain("Eventos");
});
// no describe("barra inferior do celular"):
it("com a liberação, Eventos fica em Mais no celular e a barra do operador não muda (eventos, parte 7)", () => {
  const wms = getMobileNavigation(getNavigationForProfileRole("wms", null, false, false, true));
  expect(wms.bar.map((module) => module.label)).toEqual(["Pedidos", "Estoque", "Agent Dute", "Documentos"]);
  expect(wms.more.flatMap(({ module, routes }) => routes.map((route) => `${module.label} · ${route.label}`))).toEqual(["Estoque · Receber", "Estoque · Contagem", "Estoque · Mapa", "Estoque · Posições", "Eventos · Eventos"]);
  expect(getMobileNavigation(getNavigationForProfileRole("owner", null, false, false, true)).bar.map((module) => module.label)).toEqual(["Início", "Pedidos", "Estoque", "Agent Dute"]);
});
```

Em `document-title.test.ts`: `documentTitleForPath("/eventos")` é
`"Dutelog | Eventos"`. Em `resumo-do-modulo.test.ts`:
`contadoresDoMenu([{ tone: "attention", title: "1 evento para confirmar", href: "/eventos" }], getNavigationForProfileRole("admin", null, false, false, true), "home")`
dá `home: { n: 1, alerta: false }` e `eventos: { n: 1, alerta: false }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms-v3.test.ts src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/resumo-do-modulo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the list, the module, the parameter and the route**

Os testes do menu e da barra do celular que não passam `eventos` continuam
iguais: o padrão é a liberação do build, desligada no vitest (sem
`VITE_FIREBASE_PROJECT_ID`). Com a liberação, o `it` novo da barra prova o
mesmo. Ficar fora de `MOBILE_BAR_PRIORITY` não basta: o laço que completa a
barra pegaria o primeiro módulo do menu fora dela (na barra de quatro
lugares do `wms`, o Eventos, antes de Documentos), e por isso o laço pula os
de `FORA_DA_BARRA_DO_CELULAR`; no shell v3 da Armazenagem, com três lugares,
a prioridade já enche a barra de todo papel do WMS. Assim a parte 12, que
tira a liberação, não mexe no teste da barra.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/components/layout src/pages/home.test.tsx` e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS; `telaDoWmsNaV3("/eventos")` é verdadeiro e o layout do WMS
abre a agenda no `.v3`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/wms-v3.ts artifacts/app/src/lib/wms-v3.test.ts artifacts/app/src/lib/modules.ts artifacts/app/src/lib/modules.test.ts artifacts/app/src/App.tsx artifacts/app/src/lib/document-title.test.ts artifacts/app/src/lib/resumo-do-modulo.test.ts
git commit -m "feat(app): Eventos no menu e na v3 da Armazenagem, com a liberação"
```

### Pronto quando

No emulador, pelos testes: a edição da Necton enviada é confirmada pela
agenda com o "separar até" (a solicitação aprovada na mesma transação), a
bancada separa com dois volumes e a edição fica `separado` com os volumes e
o `foi`, a entrega a deixa `no_evento` com o `feito` da entrega, e a recusa
e o cancelamento a deixam `cancelado` com o motivo; o Início da coordenação
mostra "1 evento para confirmar" e o menu "Eventos 1"; o `wms` vê a agenda
sem o "Confirmar"; `corepack pnpm run typecheck`,
`npm --prefix functions/wms run test:unit` e `test:integration` verdes; o PR
registra em `docs/superpowers/plans/2026-11-26-eventos.md` o que mudou de
nome, se mudou, e pede ao Leonardo, como escolha a conferir, o OK do
celular: Eventos em "Mais", com a barra do operador igual.
