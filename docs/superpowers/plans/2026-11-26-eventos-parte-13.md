# Eventos · parte 13: a história da Necton, adotar um pedido existente

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a edição da Necton 2027 (decisão 8) entra como história: a
coordenação liga o pedido de 24/11, que seguiu o caminho de sempre, a uma
edição enviada pelo cliente sem itens do estoque; a edição copia o que o
pedido já fez (o `foi`, os volumes, o lacre, a entrega) e assume o status que
o pedido tem; o retorno, já recebido em Devoluções, é registrado na edição
sem mexer no estoque; o resto (fotos, preço, fechamento, o portal) é o fluxo
das partes 8 a 11.

**Architecture:** `functions/wms/src/domain/eventos/adocao.ts` (regras puras e
a transação `adoptOrderIntoEditionTransaction`, no molde de `count-rounds.ts`:
recibo inline, eventos na mesma transação) grava `event_edition_id` nos quatro
documentos do pedido onde a parte 6 os grava e reusa o `volumesDaEdicao` da
parte 7 para os volumes e o `foi`; `retorno.ts` (parte 9) ganha
`sem_estoque`, que pula a ENTRADA, a guarda e a devolução e liga a edição à
devolução que Devoluções já recebeu; uma callable de uma linha
(`requireOperationsCoordinator`). No app: "Adotar pedido" na agenda (parte 7),
"Sem mexer no estoque" no bloco do retorno (parte 9) e "Pedido adotado" na
edição registrada do portal (parte 11).

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test` com
o emulador; React, react-query, vitest, jsdom e axe-core no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções
"Partes" (a linha 13), "Perguntas respondidas pelo Leonardo" (2), "Decisões
do Leonardo" (8), "O retorno ao estoque", "A edição, campo a campo", "Os
status e quem move cada um", "As callables", "O envio e o pedido" (o
`event_edition_id`). Índice: `docs/superpowers/plans/2026-11-26-eventos.md`.
A prancha não tem a adoção (ela é a parte "sem prazo"): os textos novos são
deste plano e viram pergunta ao Leonardo antes do PR de tela.

## Global Constraints

As do índice. Nesta parte, ainda:

- A adoção nunca reserva, separa, baixa nem entra estoque, e não muda o
  status da solicitação nem do pedido: escreve `event_edition_id` nos quatro
  documentos (`customer_requests`, `client_request_status`, `orders`,
  `client_order_tracking`) e copia fatos para a edição. Dali em diante a
  edição adotada anda pelos ganchos da parte 7 como qualquer outra.
- `sem_estoque` só numa edição com `pedido.adotado_em` e com a devolução de
  Devoluções informada; sem ele, `receiveEventReturn` é o da parte 9, intocado
  (os onze casos da parte 9 continuam verdes; esta parte acrescenta os casos
  12 a 14).
- O 18º tipo, `evento.pedido_adotado` (sem palavra do roteador de avisos),
  já está em `EVENTO_EVENT_TYPES` (parte 2), com o payload e o título, e na
  lista dos tipos do índice: esta parte é a única que o grava, e ele entra
  no grupo dos Eventos de `docs/contrato-eventos-ai-native.md` no mesmo PR.
  Os campos novos da edição (`pedido.adotado_em`, `pedido.adotado_por`,
  `retorno.sem_estoque`) já estão no índice, em "Documento da edição", como
  acréscimos da parte 13 à `EdicaoView` e à `viewDaEdicao` de `edicao.ts`
  (T1 e T2), ao tipo do app e à `edicaoDaLeitura` do app
  (`lib/eventos/leitura.ts`, parte 4), por onde a ficha e o portal leem a
  edição; o PR confere que o código bate com eles. No tipo do app os três
  são opcionais (`adotado_em?`, `adotado_por?`, `sem_estoque?`), para os
  fixtures tipados das partes 7 a 11 continuarem tipando; quem lê usa
  `!= null` e `=== true`, e a `edicaoDaLeitura` sempre os preenche (o
  ausente vira `null`, `null` e `false`).
- `separar_ate` é campo da raiz da edição, nunca de `pedido`: a adoção o
  grava ali, como a confirmação da parte 7.
- Nada de dinheiro em `adocao.ts`, no bloco do retorno nem nos payloads; a
  edição adotada tem preço pelo caminho da parte 10.

## Review Focus

1. O pedido já entregue adotado: a edição vai direto a `no_evento` com o
   `foi`, os volumes, `entregue_em` e o `feito` de Entrega no local com
   `origem: pedido`; nenhuma escrita em `stock_balances`, `movements`,
   `stock_reservations` nem em `orders.status` (T1, caso 3).
2. Clique duplo em "Adotar pedido": a mesma chave devolve o mesmo resultado;
   outra chave recusa "A edição já tem pedido." e há um só
   `evento.pedido_adotado` (T1, caso 5).
3. `sem_estoque` numa edição que não adotou o pedido recusa e nada grava; na
   adotada, nenhuma ENTRADA, guarda, agregado ou `returns` nasce, e a régua
   não vê movimento (T2, casos 12 e 13).
4. A solicitação ainda `open` adotada: a edição fica `enviado` com
   `pedido.request_id`, e a aprovação em Pedidos a confirma pelo gancho da
   parte 7, porque a solicitação já leva `event_edition_id` (T1, caso 2).
5. A edição adotada no portal: "Pedido adotado" em "O que aconteceu", o
   romaneio da cópia dos volumes, nada de caixa, valor nem "Devoluções" (T4).

---

### Task 1: `adocao.ts` e `adoptOrderIntoEdition`

**Files:**
- Create: `functions/wms/src/domain/eventos/adocao.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`: `request_id` → "a solicitação"; a `EdicaoView` e a `viewDaEdicao` ganham `pedido.adotado_em: string | null`, em ISO, e `pedido.adotado_por: ActorRef | null`, o `ActorRef` de `./edicao-gravacao.js` por `import type`, sem cópia; no pedido gravado sem eles, os dois vêm `null`)
- Modify: `functions/wms/src/index.ts` (uma linha no bloco "Eventos", depois de `closeEventEdition` da parte 10; o import de `./domain/eventos/adocao.js`)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (uma linha na `MATRIZ`, ao lado de `decideCustomerRequest`, hoje linha 146)
- Modify: `functions/wms/package.json` (`test:unit`: `lib/domain/eventos/adocao.test.js`; `test:integration`: `lib/domain/eventos/adocao.integration.test.js`, depois de `lib/domain/eventos/preco.integration.test.js`)
- Modify: `artifacts/app/src/lib/eventos/tipos.ts`, `artifacts/app/src/lib/wms/eventos.ts`, `artifacts/app/src/lib/wms/eventos.test.ts` (os tipos, o wrapper, um `it`)
- Modify: `artifacts/app/src/lib/eventos/leitura.ts` (parte 4: `edicaoDaLeitura` lê `pedido.adotado_em`, o `Timestamp` em ISO e o ausente em `null`, e `pedido.adotado_por`, o ausente em `null`)
- Modify: `docs/superpowers/plans/2026-11-26-eventos.md` (a sessão confere, sem duplicar: os três campos novos já estão em "Documento da edição", como acréscimos da parte 13, a entrada de `adocao.ts` no File Structure e o 18º tipo na lista dos tipos, desde a parte 2; muda só o que o código mudar), `docs/contrato-eventos-ai-native.md` (o 18º tipo no grupo dos Eventos da parte 12)
- Test: `functions/wms/src/domain/eventos/adocao.test.ts` (puro); `functions/wms/src/domain/eventos/adocao.integration.test.ts` (emulador; T4 acrescenta o caso 7); `artifacts/app/src/lib/eventos/leitura.test.ts` (parte 4, um `it`)

**Interfaces:**
- Consumes: `STATUS_DA_EDICAO`, `type StatusDaEdicao`, `problemaDoCronograma` de `./dominio.js` (parte 1); `entradaDe`, `viewDaEdicao`, `type EdicaoView`, `ROTULO_DO_CAMPO` e `previstoDoMomento(momento: MomentoView): MomentoPrevisto` (parte 2: o momento da view como `problemaDoCronograma` o confere, o que `problemaParaEnviar` usa) de `./edicao.js`; `EDICOES_COLLECTION`, `OPERATIONS_COLLECTION`, `actorRef(actor: OperationalActor): ActorRef`, `type ActorRef = { uid: string; name: string | null; role: string }` (sem cópia local) e `tamanhoETipoDosItens(transaction: Transaction, db: Firestore, customerCode: string, skuCodes: readonly string[]): Promise<Map<string, { size: string | null; category: string | null }>>` (a leitura de `client_inventory` que `saveEventEditionTransaction` faz) de `./edicao-gravacao.js`; `createEventoEvent`, `EVENTO_EVENT_TYPES` (com o 18º tipo, `evento.pedido_adotado`; a parte 8 acrescenta `evento.foto_retirada`), `PAYLOAD_DO_EVENTO` (o dele: `pedido_adotado { edition_id, request_id, order_id: string | null, status }`), `TITULO_DO_EVENTO` ("Pedido adotado pela edição"), `type EventoEventType` de `./eventos-auditoria.js` (parte 2, que os declara; esta parte só grava o tipo); `lerEdicao(transaction: Transaction, db: Firestore, editionId: string): Promise<{ ref: DocumentReference; data: Record<string, unknown> }>` de `./momentos.js` (parte 8, a leitura da equipe, de qualquer cliente; `not-found` "Edição não encontrada."); de `./confirmacao.js` (parte 7), `type VolumeDaEdicao`, `volumesDaEdicao(view: EdicaoView, packages, packageItems): { volumes: VolumeDaEdicao[]; foiPorSku: Map<string, number> }` (os volumes e o `foi` por SKU numa chamada só; o `size` de cada item do volume sai do item da `view` com o mesmo `sku_code`) e `separarAtePadrao(view: EdicaoView): string | null` (a véspera da entrega no local, senão do evento); `pedidoJaCancelado` de `../order-cancel.js:74`; `readRows`, `type OperationalActor`, `type OperationalEventSummary` de `../operations.js`; `digest` e `clean` locais como `count-rounds.ts:354-359`; os quatro `event_edition_id` que a parte 6 grava (`operations.ts`, a solicitação e a projeção na criação, o pedido e `updateClientTracking`, `:1325`, na aprovação); `shipments.proof_reference` (`:9557`), `orders.delivered_at` (`:9531`), `orders.customer_request_id` (`:6195`), `package_items.shipment_id` (`:9241`); no app, `edicaoDaLeitura(id, data): EdicaoView | null` de `lib/eventos/leitura.ts` (parte 4, o contrato da `viewDaEdicao`: Timestamp → ISO, ausente → null).
- Produces:
  - `AdotarPedidoSchema` (`.strict()`): `edition_id` 1..120, `request_id` 1..120 sem `/`, `idempotency_key` 8..200; `type AdotarPedido`.
  - `type FatosDoPedido = { solicitacao: { id; status; type; request_number; customer_code; event_edition_id: string | null; items: Array<{ sku_code; client_item_code: string | null; product_name; quantity }> }; pedido: { id; status; order_number; created_at: string | null; delivered_at: string | null } | null; remessa: { id; status; proof_reference: string | null } | null; volumes: VolumeDaEdicao[]; foi: Map<string, number>; lacre: string | null; separado_em: string | null }` e `fatosDoPedido(edicao: EdicaoView, solicitacao: Row, pedido: Row | null, remessa: Row | null, packages: Row[], packageItems: Row[]): FatosDoPedido` (os carimbos em ISO; `edicao` é a `view` cujos `itens` são os da solicitação, com o `size` de `tamanhoETipoDosItens`, que a transação monta, e é dela que `volumesDaEdicao` tira o `size` de cada item do volume; com a remessa, `volumes` e `foi` são o `volumes` e o `foiPorSku` de `volumesDaEdicao(edicao, packages, packageItems)`, sem refazer a soma do `qty_packed`; sem ela, `[]` e o mapa vazio; `lacre` e `separado_em` da remessa).
  - `problemaDaAdocao(edicao: EdicaoView, fatos: FatosDoPedido): string | null`, a primeira, nesta ordem: `status !== "enviado"` → "Só uma edição enviada adota um pedido."; `edicao.pedido` → "A edição já tem pedido."; `solicitacao.customer_code !== edicao.customer_code` → "A solicitação é de outro cliente."; `solicitacao.event_edition_id` → "A solicitação já pertence a uma edição."; `solicitacao.type !== "retirada"` → "Só uma solicitação de saída vira pedido do evento."; `status` `rejected`/`cancelled` → "A solicitação foi recusada ou cancelada."; `pedido` e `pedidoJaCancelado(pedido.status)` → "O pedido foi cancelado."; `problemaDoCronograma(edicao.cronograma.map(previstoDoMomento), { comItensDoEstoque: true, comColeta: edicao.coleta.quantidade > 0 })` (a frase dele: a coordenação completa o cronograma pelo `patch` da parte 2 antes).
  - `statusAdotado(fatos): StatusDaEdicao`: sem `pedido` (solicitação `open`) → `enviado`; `PENDENTE`, `SEPARACAO` → `confirmado`; `EM_EXPEDICAO`, `EXPEDIDO` → `separado`; `ENTREGUE` → `no_evento`.
  - `itensAdotados(fatos, tamanhoETipo: Map<string, { size: string | null; category: string | null }>): EdicaoView["itens"]` (o item lido, com `foi`; a parte 2 só exporta os tipos de entrada) — um por item da solicitação; `foi`, com a remessa (o packing concluído), é `fatos.foi.get(sku_code) ?? 0`, e o SKU sem volume fica com 0, como no packing da parte 7; sem a remessa, `null`; `voltou`, `avariadas`, `nao_voltaram`, `observacao` null.
  - `pedidoAdotado(fatos: FatosDoPedido, status: StatusDaEdicao, agora: string, por: ActorRef): EdicaoView["pedido"]` — sem a edição, que nada dá ao pedido: `request_id`, `request_number`, `order_id`, `order_number` (ou null), `separado_em`, `lacre`, `volumes_total`, `volumes`, `entregue_em: delivered_at`, `entregue_por: null`, `comprovante: remessa.proof_reference`, `cancelado_em: null`, `adotado_em: agora`, `adotado_por: por`; nada de `separar_ate`, que é campo da raiz da edição e a transação grava.
  - Em `edicao.ts`: `EdicaoView["pedido"]` ganha `adotado_em: string | null` e `adotado_por: ActorRef | null`, e a `viewDaEdicao` os lê (o `Timestamp` em ISO; o pedido gravado sem eles, o de toda edição que não adotou, dá `null` nos dois).
  - `eventosDaAdocao(status: StatusDaEdicao): EventoEventType[]` = `["evento.pedido_adotado"]` e, pelo status alcançado, `evento.edicao_confirmada` (de `confirmado` em diante), `evento.edicao_separada` (de `separado`), `evento.edicao_no_evento` (`no_evento`).
  - `type ResultadoDaAdocao = { ok: true; edition_id: string; request_id: string; order_id: string | null; status: StatusDaEdicao; itens: number; pecas: number; events: OperationalEventSummary[] }`.
  - `adoptOrderIntoEditionTransaction(db: Firestore, input: AdotarPedido, actor: OperationalActor): Promise<ResultadoDaAdocao>` — uma `db.runTransaction`, leituras antes das escritas: recibo `op_evento_adopt_<digest({ edition: edition_id, nonce: idempotency_key })>`, `kind: "evento.adopt"` (mesma chave e `input_hash` → o `result`; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."); `lerEdicao(transaction, db, edition_id)` (parte 8) e a `view` por `viewDaEdicao`; `customer_requests/{request_id}` (`not-found` "Solicitação não encontrada."); `orders where customer_request_id == request_id` (uma igualdade); com pedido, `shipments where order_id ==` fora de `cancelled`, `package_items where shipment_id == remessa.id` e os `packages` pelos `package_id` delas; `client_request_status/{request_id}` e `client_order_tracking/{order_id}`; `tamanhoETipoDosItens(transaction, db, view.customer_code, skus)` (parte 2), com os `sku_code` da solicitação; `problemaDaAdocao` → `failed-precondition`. `fatosDoPedido` recebe a `view` cujos `itens` são os da solicitação com o `size` dessa leitura (é deles que `volumesDaEdicao` tira o `size` de cada item do volume, como no packing da parte 7), e os `itens` gravados são `itensAdotados(fatos, tamanhoETipo)`. Escritas: `event_edition_id` e `updated_at` na solicitação e no pedido (`update`), e nas duas projeções (`set` com `merge`); a edição: `itens`, `itens_total`, `pecas_total`, `pedido`, `status: statusAdotado`, `separar_ate: separarAtePadrao(view)` na raiz quando o status adotado é `confirmado` ou `separado` (nunca em `pedido`), `confirmada_em: pedido.created_at` quando há pedido, o `feito` de `entrega_no_local` `{ inicio: entregue_em, fim: null, observacao: null, origem: "pedido", registrado_por: por, registrado_em: agora, corrigido_em: null }` quando entregue e o momento existe sem `feito`, `edicao + 1`, `updated_*`; os eventos de `eventosDaAdocao` com `createEventoEvent` (payloads: `pedido_adotado { edition_id, request_id, order_id, status }`, `edicao_confirmada { edition_id, order_id, separar_ate }` (o da raiz, ou null), `edicao_separada { edition_id, order_id, volumes, pecas }`, `edicao_no_evento { edition_id, order_id, entregue_em }`); o recibo por último.
  - Callable: `export const adoptOrderIntoEdition = onCall(async (request) => { const profile = await getProfile(request); requireOperationsCoordinator(profile); assertEventosLiberado(PROJECT_ID); return adoptOrderIntoEditionTransaction(db, entradaDe(AdotarPedidoSchema, request.data ?? {}), profile); });` e, na matriz, `adoptOrderIntoEdition: { passam: COORDENACAO, recusa: SO_COORDENACAO }`.
  - App: `AdotarPedido`, `ResultadoDaAdocao` em `lib/eventos/tipos.ts`; `EdicaoView["pedido"]` ganha `adotado_em?: string | null` e `adotado_por?: { uid: string; name: string | null; role: string } | null` (a forma de `ActorRef` por extenso, como o `registrado_por` da parte 3; opcionais, para os fixtures tipados das partes 7 a 11 continuarem tipando, e quem lê usa `!= null`); `edicaoDaLeitura` (`lib/eventos/leitura.ts`, parte 4) os lê como a `viewDaEdicao`: o `Timestamp` de `adotado_em` em ISO, e o ausente vira `null` nos dois; `adotarPedido(entrada: AdotarPedido): Promise<ResultadoDaAdocao>` em `lib/wms/eventos.ts`; `CALLABLES_DOS_EVENTOS` ganha `"adoptOrderIntoEdition"`.

- [ ] **Step 1: Write the failing unit test**

`adocao.test.ts` (node:test, puro), com a edição `ENVIADA` da Necton (`status: "enviado"`, `pedido: null`, `itens: []`, `coleta.quantidade: 2190`, os sete momentos) e três `FatosDoPedido`: `ABERTA` (solicitação `open`, sem pedido), `pedidoEm(status)` e `ENTREGUE` (`PED-0042`, remessa `delivered` com `proof_reference: "Recebido na doca do hotel"`, `lacre: "88412"`, um volume, `foi` 1000/700/300, `delivered_at: "2027-01-28T11:20:00.000Z"`); e `PEDIDO_GRAVADO`, o `pedido` como a parte 7 o grava, sem `adotado_em` nem `adotado_por`:

```ts
it("recusa pela edição, pelo pedido já ligado, pelo cliente, pela solicitação e pelo cronograma, nesta ordem", () => {
  assert.equal(problemaDaAdocao(view({ status: "confirmado" }), ABERTA), "Só uma edição enviada adota um pedido.");
  assert.equal(problemaDaAdocao(view({ pedido: PEDIDO_DA_EDICAO }), ABERTA), "A edição já tem pedido.");
  assert.equal(problemaDaAdocao(ENVIADA, solicitacao({ customer_code: "Itaú" })), "A solicitação é de outro cliente.");
  assert.equal(problemaDaAdocao(ENVIADA, solicitacao({ event_edition_id: "ced_outra" })), "A solicitação já pertence a uma edição.");
  assert.equal(problemaDaAdocao(ENVIADA, solicitacao({ type: "entrada" })), "Só uma solicitação de saída vira pedido do evento.");
  assert.equal(problemaDaAdocao(ENVIADA, solicitacao({ status: "cancelled" })), "A solicitação foi recusada ou cancelada.");
  assert.equal(problemaDaAdocao(ENVIADA, { ...ENTREGUE, pedido: { ...ENTREGUE.pedido!, status: "CANCELADO" } }), "O pedido foi cancelado.");
  assert.equal(problemaDaAdocao(view({ cronograma: [MOMENTO_EVENTO] }), ENTREGUE), "Informe a data e a hora da entrega no local");
  assert.equal(problemaDaAdocao(ENVIADA, ENTREGUE), null);
});
it("o status vem do pedido", () => {
  assert.deepEqual([ABERTA, pedidoEm("PENDENTE"), pedidoEm("SEPARACAO"), pedidoEm("EM_EXPEDICAO"), pedidoEm("EXPEDIDO"), ENTREGUE].map(statusAdotado), ["enviado", "confirmado", "confirmado", "separado", "separado", "no_evento"]);
});
it("os itens vêm da solicitação com tamanho e tipo, o foi só depois de separado (0 no SKU sem volume); o pedido sai dos fatos e marca a adoção, sem o separar até; os eventos seguem o status", () => {
  assert.deepEqual(itensAdotados(ENTREGUE, new Map([["BTG-000101", { size: "G", category: "Polo" }]]))[0], { sku_code: "BTG-000101", client_item_code: "A.01.0809.002.G", product_name: "Polo Masculino Piquet Arpoador", size: "G", category: "Polo", quantity: 1000, foi: 1000, voltou: null, avariadas: null, nao_voltaram: null, observacao: null });
  assert.equal(itensAdotados(ABERTA, new Map())[0].foi, null);
  assert.deepEqual(itensAdotados({ ...ENTREGUE, foi: new Map([["BTG-000101", 1000]]) }, new Map()).map((i) => i.foi), [1000, 0, 0]);
  const pedido = pedidoAdotado(ENTREGUE, "no_evento", AGORA, POR);
  assert.deepEqual([pedido.order_number, pedido.lacre, pedido.volumes_total, pedido.entregue_em, pedido.comprovante, pedido.adotado_em, pedido.adotado_por], ["PED-0042", "88412", 1, "2027-01-28T11:20:00.000Z", "Recebido na doca do hotel", AGORA, POR]);
  assert.equal("separar_ate" in pedidoAdotado(pedidoEm("PENDENTE"), "confirmado", AGORA, POR), false);
  assert.deepEqual(eventosDaAdocao("no_evento"), ["evento.pedido_adotado", "evento.edicao_confirmada", "evento.edicao_separada", "evento.edicao_no_evento"]);
  assert.deepEqual(eventosDaAdocao("enviado"), ["evento.pedido_adotado"]);
});
it("a view lê a adoção: adotado_em em ISO e adotado_por; o pedido gravado sem eles dá null", () => {
  const sem = viewDaEdicao(ENVIADA.id, { ...ENVIADA, pedido: PEDIDO_GRAVADO }).pedido;
  const com = viewDaEdicao(ENVIADA.id, { ...ENVIADA, pedido: { ...PEDIDO_GRAVADO, adotado_em: Timestamp.fromDate(new Date(AGORA)), adotado_por: POR } }).pedido;
  assert.deepEqual([sem?.adotado_em, sem?.adotado_por, com?.adotado_em, com?.adotado_por], [null, null, AGORA, POR]);
});
it("a entrada recusa dizendo o campo; o 18º tipo, da parte 2, tem payload estrito e título", () => {
  assert.throws(() => entradaDe(AdotarPedidoSchema, { edition_id: "ced_1", idempotency_key: "adota-necton-1" }), { code: "invalid-argument", message: "Informe a solicitação" });
  assert.throws(() => entradaDe(AdotarPedidoSchema, { ...ENTRADA, extra: 1 }), { code: "invalid-argument" });
  assert.ok(EVENTO_EVENT_TYPES.includes("evento.pedido_adotado"));
  assert.throws(() => PAYLOAD_DO_EVENTO["evento.pedido_adotado"].parse({ edition_id: "ced_1", request_id: "creq_1", order_id: null, status: "enviado", extra: 1 }));
  assert.equal(TITULO_DO_EVENTO["evento.pedido_adotado"], "Pedido adotado pela edição");
});
```

Em `artifacts/app/src/lib/eventos/leitura.test.ts` (parte 4, vitest), o mesmo contrato no app, com `DOCUMENTO` (o documento da Necton em `enviado` do teste da parte 4), o `PEDIDO_GRAVADO`, `AGORA`, `POR` e o `Timestamp` de `firebase/firestore`:

```ts
it("edicaoDaLeitura lê a adoção: adotado_em do Timestamp em ISO e adotado_por; o pedido gravado sem eles dá null", () => {
  const sem = edicaoDaLeitura("ced_necton2027", { ...DOCUMENTO, pedido: PEDIDO_GRAVADO })?.pedido;
  const com = edicaoDaLeitura("ced_necton2027", { ...DOCUMENTO, pedido: { ...PEDIDO_GRAVADO, adotado_em: Timestamp.fromDate(new Date(AGORA)), adotado_por: POR } })?.pedido;
  expect([sem?.adotado_em, sem?.adotado_por, com?.adotado_em, com?.adotado_por]).toEqual([null, null, AGORA, POR]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/adocao.test.js` e `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/leitura.test.ts`
Expected: FAIL (`./adocao.js` não existe e a view não lê `adotado_em` nem `adotado_por`, nem a `edicaoDaLeitura` do app; o 18º tipo já vem da parte 2).

- [ ] **Step 3: Implement the pure part of `adocao.ts`, the `ROTULO_DO_CAMPO` entry and the two adoption fields of `EdicaoView` and `viewDaEdicao` (and of the app's `EdicaoView` and `edicaoDaLeitura`), and register the unit test**

Nenhum acesso ao Firestore nas funções puras. Os `volumes` e o `foi` de `fatosDoPedido` são os de `volumesDaEdicao(edicao, packages, packageItems)` (parte 7): nada de somar o `qty_packed` por SKU aqui nem de mexer em `confirmacao.ts`. No app, os dois campos entram opcionais em `EdicaoView["pedido"]` (`lib/eventos/tipos.ts`), e `edicaoDaLeitura` os lê no contrato da `viewDaEdicao`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

`adocao.integration.test.ts`, com o `beforeEach`, as posições, os saldos dos três SKUs e os ajudantes de `retorno.integration.test.ts` (parte 9: `cliente`, `coordenacao`, `armazem`, `avancar`, `separarEEmbalar`, `entregar`), mais `edicaoEnviadaSoComColeta()`: um `saveEventEditionTransaction` só, a criação com o `patch` (`cliente`, "B2B Conference Necton", Hotel Unique, os seis momentos `coleta_no_cliente` 2027-01-28 05:00, `entrega_no_local` 2027-01-28 08:30, `montagem` 2027-01-28 10:00 até 19:00, `evento` 2027-01-29 08:00 até 20:00, `desmontagem` 2027-01-29 20:00 e `retorno_ao_estoque` 2027-01-30 09:00, `itens: []`, `coleta.quantidade: 2190`) e `sendEventEditionTransaction` (sem itens: `pedido` null, parte 6, caso 6); `pedidoDeHoje(ate: "open" | "separado" | "entregue")`: `createCustomerRequestTransaction` (`cliente`, os três itens, 2.000 peças, sem `event_edition_id`, chave `"necton-24-11"`) e, pelo que `ate` pede, `aprovar`, `separarEEmbalar` (lacre `"88412"`) e `entregar`; `adotar(chave, requestId)` chama `adoptOrderIntoEditionTransaction(db, { edition_id, request_id, idempotency_key: chave }, coordenacao)`; `eventosDaEdicao()` lê `events where entity_id == edition_id` por `occurred_at`. O cronograma do ajudante nasce inteiro na criação: cada gravação é um `evento.edicao_salva` (decisão 13 da spec), e o caso 7, de T4, espera um só. A montagem e o evento levam o `ate` do previsto, e a desmontagem existe, porque esse caso registra o início e o fim dos dois e o início dela: a parte 8 recusa o momento que não existe ("Momento não encontrado.") e o fim sem `previsto.ate` ("… não tem fim previsto.").

```ts
it("1. a solicitação aprovada e separada: event_edition_id nos quatro documentos, os itens com o foi, os volumes e o lacre na edição, status separado e três eventos; nada muda no estoque nem no pedido", ...)
// customer_requests, client_request_status, orders e client_order_tracking com event_edition_id === edition_id
// a edição: status "separado", separar_ate "2027-01-27" na raiz (e nenhum pedido.separar_ate), itens.length 3, pecas_total 2000, itens[0].foi 1000, pedido.lacre "88412", pedido.volumes_total 1, pedido.order_number, typeof pedido.adotado_em "string", confirmada_em string, edicao + 1
// eventosDaEdicao(): …, pedido_adotado, edicao_confirmada, edicao_separada; nenhum edicao_no_evento; stock_balances, stock_reservations e movements iguais aos de antes; orders.status "EM_EXPEDICAO"
it("2. a solicitação ainda aberta: a edição fica enviada com pedido.request_id e sem order_id; a aprovação em Pedidos confirma a edição pelo gancho da parte 7", ...)
// adotar; status "enviado", pedido.order_id null, um só evento novo (pedido_adotado); aprovar(requestId): status "confirmado", pedido.order_id, separar_ate na raiz
it("3. o pedido entregue: a edição vai a no_evento com entregue_em, comprovante e o feito de Entrega no local com origem pedido; os quatro eventos; nenhuma escrita de estoque", ...)
// pedido.entregue_em === orders.delivered_at em ISO; pedido.comprovante "Recebido na doca do hotel"; cronograma[entrega_no_local].feito.origem "pedido"; movements.size igual ao de antes; orders.status "ENTREGUE"
it("4. as recusas: a edição confirmada, a solicitação de outro cliente, a já ligada a outra edição, a cancelada e o cronograma sem a entrega no local; nenhuma grava nada", ...)
it("5. clique duplo: a mesma chave devolve o mesmo resultado; outra chave recusa 'A edição já tem pedido.' e há um só pedido_adotado", ...)
it("6. depois da adoção o resto é o de sempre: receiveEventReturn registra o retorno com a ENTRADA (parte 9) e closeEventEdition fecha (parte 10)", ...)
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/adocao.integration.test.js"`
Expected: FAIL (a transação não existe).

- [ ] **Step 7: Implement the transaction, the callable line, the matrix line, the wrapper and the types; register the integration test; check the index and update the contrato**

- [ ] **Step 8: Run tests to verify they pass**

Run: o comando do passo 6 com `lib/callables-papeis.integration.test.js lib/callables-auth.integration.test.js lib/domain/eventos/retorno.integration.test.js lib/domain/eventos/envio.integration.test.js` no mesmo `emulators:exec`; `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/platform-lists.test.ts` (o wrapper sem campo `undefined`; a trava acha a linha no `index.ts`); `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS (a consulta `orders` por `customer_request_id` e as de `shipments` e `package_items` são igualdades só: sem índice composto).

- [ ] **Step 9: Commit**

```bash
git add functions/wms/src/domain/eventos/adocao.ts functions/wms/src/domain/eventos/adocao.test.ts functions/wms/src/domain/eventos/adocao.integration.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts functions/wms/package.json artifacts/app/src/lib/eventos/tipos.ts artifacts/app/src/lib/eventos/leitura.ts artifacts/app/src/lib/eventos/leitura.test.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts docs/superpowers/plans/2026-11-26-eventos.md docs/contrato-eventos-ai-native.md
git commit -m "feat(wms): adotar um pedido existente numa edição enviada do evento"
```

### Task 2: `receiveEventReturn` com `sem_estoque`

**Files:**
- Modify: `functions/wms/src/domain/eventos/retorno.ts` (parte 9: `ReceberRetornoSchema`, `problemaDoRetorno`, `receiveEventReturnTransaction`)
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`: `sem_estoque.return_id` → "a devolução de Devoluções"; a `EdicaoView` e a `viewDaEdicao` ganham `retorno.sem_estoque: boolean`, e no retorno gravado sem ele vem `false`)
- Modify: `artifacts/app/src/lib/eventos/tipos.ts` (`ReceberRetorno.sem_estoque?: { return_id: string }`; `EdicaoView["retorno"]` ganha `sem_estoque?: boolean`, opcional como os dois campos de T1)
- Modify: `artifacts/app/src/lib/eventos/leitura.ts` (parte 4: `edicaoDaLeitura` lê `retorno.sem_estoque`, e o retorno gravado sem ele dá `false`)
- Modify: `artifacts/app/src/lib/eventos/retorno.ts`, `artifacts/app/src/features/eventos/retorno-da-edicao.tsx`, `artifacts/app/src/pages/evento.tsx` (parte 9: o bloco e a leitura)
- Test: `functions/wms/src/domain/eventos/retorno.test.ts` e `retorno.integration.test.ts` (parte 9, casos novos); `artifacts/app/src/lib/eventos/retorno.test.ts`, `artifacts/app/src/features/eventos/retorno-da-edicao.test.tsx`, `artifacts/app/src/lib/eventos/leitura.test.ts` (parte 4, um `it`)

**Interfaces:**
- Consumes: da parte 9, `ReceberRetornoSchema`, `ROTULOS_DO_RETORNO` (o mapa por chamada com que a callable `receiveEventReturn`, que esta parte não muda, lê a entrada; os testes do `sem_estoque` leem igual), `problemaDoRetorno(edicao, pedido, input)`, `linhasDoRetorno`, `totaisDoRetorno`, `receiveEventReturnTransaction`, `devolucaoDasAvariadas`, `type ResultadoDoRetorno` e, no app, `linhasIniciais`, `entradaDoRetorno`, `fraseDoRodape`, `podeConfirmarRetorno(linhas, coleta)`, `RetornoDaEdicao`; `returns` (`customer_code`, `reference`, `received_at`, `qty_total`, `created_at`; `order-return.integration.test.ts:64-70`); `useLeitura` (`lib/operacao/leitura.ts:408`); o índice `returns (customer_code ASC, created_at DESC)`, que existe; `entradaDe` e `viewDaEdicao` de `./edicao.js` (parte 2), com o `pedido.adotado_em` de T1; no app, `edicaoDaLeitura(id, data)` de `lib/eventos/leitura.ts` (parte 4, com os dois campos de T1), pela qual a ficha (parte 8) lê a edição.
- Produces:
  - `ReceberRetornoSchema` ganha `sem_estoque: z.object({ return_id: z.string().trim().min(1).max(120) }).strict().optional()`.
  - `problemaDoRetorno(edicao, pedido, input, devolucao?: { customer_code: string } | null)` ganha, depois de "O pedido ainda não foi entregue." e antes das linhas: com `sem_estoque` e sem `edicao.pedido?.adotado_em` → "Sem mexer no estoque só numa edição que adotou o pedido."; `devolucao === null` → "A devolução não foi encontrada em Devoluções."; `devolucao.customer_code !== edicao.customer_code` → "A devolução é de outro cliente.".
  - `receiveEventReturnTransaction`: com `sem_estoque`, lê `returns/{return_id}` antes das escritas e pula o saldo, a ENTRADA, a guarda, os agregados e `devolucaoDasAvariadas`; a edição recebe o que recebe no retorno comum, com `retorno.return_id = input.sem_estoque.return_id` e `retorno.sem_estoque: true` (`false` no comum); o `result` sai com `guardas: []` e o `return_id` dado; o evento `evento.retorno_registrado` e o payload não mudam.
  - Em `edicao.ts`: `EdicaoView["retorno"]` ganha `sem_estoque: boolean`, e a `viewDaEdicao` o lê (o retorno gravado sem ele, o de antes desta parte, dá `false`).
  - App (`lib/eventos/leitura.ts`, parte 4): `edicaoDaLeitura` lê `retorno.sem_estoque` como a `viewDaEdicao` (o retorno gravado sem ele dá `false`); no tipo do app, `sem_estoque?: boolean`, e quem lê usa `=== true`.
  - App (`lib/eventos/retorno.ts`): `type DevolucaoParaLigar = { id: string; texto: string }`; `devolucoesParaLigar(returns: ReadonlyArray<{ id: string; reference: string | null; received_at: string | null; qty_total: number }>): DevolucaoParaLigar[]` ("PED-0042 · 30/01/2027 · 1.994 peças"); `podeSemEstoque(edicao: EdicaoView): boolean` (`pedido?.adotado_em != null`); `entradaDoRetorno` ganha `semEstoque?: { return_id: string }` (a chave só vai marcada, sem `undefined`); `podeConfirmarRetorno(linhas, coleta, semEstoque?: { marcado: boolean; return_id: string | null })` (a da parte 9, com o terceiro parâmetro opcional) → "Escolha a devolução registrada em Devoluções" quando marcado sem escolha; `fraseDoRodape(totais, semEstoque = false)` termina em "nada entra no estoque: o retorno já foi recebido em Devoluções" quando marcado.
  - `RetornoDaEdicao` e `PropsDoRetorno` (parte 9, a prop `retorno` de `PropsDaFicha`) ganham `devolucoes: DevolucaoParaLigar[]`; com `retorno.sem_estoque`, o rodapé do bloco só de leitura troca "a devolução nasce com elas" por "a devolução foi registrada em Devoluções" (`fraseDoRodape(totais, semEstoque?: boolean)`, parte 9, com um caso em `retorno.test.ts`); e, só com `podeSemEstoque(edicao)`, a caixa `<input type="checkbox">` "Sem mexer no estoque: o retorno já foi recebido em Devoluções" e, marcada, o `<select aria-label="Devolução registrada em Devoluções">`. `pages/evento.tsx` lê `useLeitura(podeSemEstoque(edicao) ? "devolucoes:" + customer_code : null, (db) => query(collection(db, "returns"), where("customer_code", "==", customer_code), orderBy("created_at", "desc"), limit(30)), …)` (fora do roteador de `cloud-api.ts`, não entra em `CONSULTAS_DAS_TELAS`; o índice já existe).

- [ ] **Step 1: Write the failing tests (Functions)**

Em `retorno.test.ts`, com `ADOTADA` = a Necton com `pedido.adotado_em`:

```ts
it("sem mexer no estoque: só na edição que adotou o pedido, com a devolução do mesmo cliente", () => {
  const SEM = { ...ENTRADA, sem_estoque: { return_id: "ret_necton" } };
  assert.equal(problemaDoRetorno(NECTON, ENTREGUE, SEM, { customer_code: "BTG Pactual" }), "Sem mexer no estoque só numa edição que adotou o pedido.");
  assert.equal(problemaDoRetorno(ADOTADA, ENTREGUE, SEM, null), "A devolução não foi encontrada em Devoluções.");
  assert.equal(problemaDoRetorno(ADOTADA, ENTREGUE, SEM, { customer_code: "Itaú" }), "A devolução é de outro cliente.");
  assert.equal(problemaDoRetorno(ADOTADA, ENTREGUE, SEM, { customer_code: "BTG Pactual" }), null);
  assert.throws(() => entradaDe(ReceberRetornoSchema, { ...ENTRADA, sem_estoque: {} }, ROTULOS_DO_RETORNO), { code: "invalid-argument", message: "Informe a devolução de Devoluções" }); // como a callable lê
});
it("a view lê o sem_estoque do retorno; o retorno gravado sem ele dá false", () => {
  const retorno = { chegou_em: ENTRADA.chegou_em, registrado_por: { uid: "wms-1", name: null, role: "wms" }, registrado_em: ENTRADA.chegou_em, observacao: null, return_id: null };
  assert.equal(viewDaEdicao(NECTON.id, { ...NECTON, status: "retornado", retorno }).retorno?.sem_estoque, false);
  assert.equal(viewDaEdicao(NECTON.id, { ...NECTON, status: "retornado", retorno: { ...retorno, sem_estoque: true } }).retorno?.sem_estoque, true);
});
```

Em `retorno.integration.test.ts`, com `edicaoAdotadaEntregue()` (a de T1, caso 3) e a devolução de Devoluções por `createReturnReceiptTransaction(db, { customer_code: "BTG Pactual", reference: "PED-0042 · retorno do evento", received_at: CHEGOU, idempotency_key: "devolucao-necton", items: [as três linhas do que voltou] }, armazem)`, e o retorno pelo `retornar(chave, input)` da parte 9, que lê a entrada por `entradaDe(ReceberRetornoSchema, …, ROTULOS_DO_RETORNO)`, como a callable:

```ts
it("12. sem_estoque na edição adotada: retornado com voltou, avariadas e não voltaram, retorno.return_id é a devolução e retorno.sem_estoque; nenhum movimento, saldo, guarda nem returns novo", ...)
// result.guardas [], result.return_id === returnId; movements de functions_event_return: 0; returns.size continua 1; nenhum stock_balances na EXPEDICAO; evento retorno_registrado com payload.return_id === returnId, voltaram 1994, avariadas 3, nao_voltaram 3
it("13. sem_estoque na edição que não adotou o pedido recusa e nada grava; a devolução de outro cliente e a inexistente recusam", ...)
it("14. a edição adotada sem sem_estoque faz o retorno de sempre, com a ENTRADA e a guarda (o caminho da parte 9 não muda)", ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/retorno.test.js; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/retorno.integration.test.js"`
Expected: FAIL (o schema recusa `sem_estoque`; a view não tem `retorno.sem_estoque`; os casos 12 e 13 não existem).

- [ ] **Step 3: Implement the schema, the refusals, the branch in the transaction and `retorno.sem_estoque` in the view**

- [ ] **Step 4: Run tests to verify they pass**

Run: os do passo 2, mais `node --test lib/domain/order-return.integration.test.js lib/billing-callables.integration.test.js` no mesmo `emulators:exec`. Expected: PASS (os onze casos da parte 9 iguais; a régua sem movimento novo).

- [ ] **Step 5: Write the failing tests (app)**

`lib/eventos/retorno.test.ts`: `devolucoesParaLigar([{ id: "ret_1", reference: "PED-0042", received_at: "2027-01-30T12:30:00.000Z", qty_total: 1994 }])` é `[{ id: "ret_1", texto: "PED-0042 · 30/01/2027 · 1.994 peças" }]`; `podeSemEstoque(ADOTADA)` é `true` e `podeSemEstoque(NECTON)` é `false`; `entradaDoRetorno({ …, semEstoque: { return_id: "ret_1" } }).sem_estoque` é `{ return_id: "ret_1" }` e sem a marca a chave não existe; `podeConfirmarRetorno(linhas, coleta, { marcado: true, return_id: null })` é "Escolha a devolução registrada em Devoluções"; `fraseDoRodape(totais, true)` termina em "nada entra no estoque: o retorno já foi recebido em Devoluções". `retorno-da-edicao.test.tsx`: a edição adotada em `no_evento` mostra a caixa e, marcada, o `select` com a opção; a não adotada não mostra nenhum dos dois; `textosForaDaLista` com a lista da parte 9 mais os textos acima é `[]` e nada tem "R$"; `axe` igual a `[]`; a interação: marcar, escolher `ret_1` e "Confirmar retorno" chama `onConfirmar` com `sem_estoque: { return_id: "ret_1" }`. `leitura.test.ts` (parte 4): `edicaoDaLeitura` de um documento em `retornado` cujo `retorno` não tem `sem_estoque` dá `retorno?.sem_estoque === false`, e com `sem_estoque: true`, `true`.

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/retorno.test.ts src/features/eventos/retorno-da-edicao.test.tsx src/lib/eventos/leitura.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement the rules, the block, the read in the page, `edicaoDaLeitura` and the types**

- [ ] **Step 8: Run tests to verify they pass**

Run: o comando do passo 6, mais `npx vitest run src/pages/evento-view.test.tsx src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add functions/wms/src/domain/eventos/retorno.ts functions/wms/src/domain/eventos/retorno.test.ts functions/wms/src/domain/eventos/retorno.integration.test.ts functions/wms/src/domain/eventos/edicao.ts artifacts/app/src/lib/eventos/tipos.ts artifacts/app/src/lib/eventos/leitura.ts artifacts/app/src/lib/eventos/leitura.test.ts artifacts/app/src/lib/eventos/retorno.ts artifacts/app/src/lib/eventos/retorno.test.ts artifacts/app/src/features/eventos/retorno-da-edicao.tsx artifacts/app/src/features/eventos/retorno-da-edicao.test.tsx artifacts/app/src/pages/evento.tsx
git commit -m "feat(wms): o retorno da edição adotada sem mexer no estoque, ligado à devolução de Devoluções"
```

### Task 3: a ação na agenda, "Adotar pedido"

**Files:**
- Create: `artifacts/app/src/lib/eventos/adocao.ts`, `artifacts/app/src/lib/eventos/adocao.test.ts`
- Create: `artifacts/app/src/features/eventos/adotar-pedido-dialogo.tsx`, `artifacts/app/src/features/eventos/adotar-pedido-dialogo.test.tsx`
- Modify: `artifacts/app/src/lib/eventos/agenda.ts`, `artifacts/app/src/lib/eventos/agenda.test.ts` (parte 7: o `resumo` da linha sem pedido)
- Modify: `artifacts/app/src/pages/eventos.tsx`, `artifacts/app/src/pages/eventos.test.tsx`, `artifacts/app/src/pages/eventos-view.tsx`, `artifacts/app/src/pages/eventos-view.test.tsx` (parte 7: a agenda)
- Modify: `artifacts/app/src/lib/cloud-api-indices.test.ts` (`CONSULTAS_DAS_TELAS`, linha 113)

**Interfaces:**
- Consumes: da parte 7, `LinhaDaAgenda` (`status`, `pedidoId`, `resumo`, `evento`, `label`, `cliente`) e `linhaDaAgenda` de `lib/eventos/agenda.ts`, `EventosView({ filtro, onFiltro, contagens, grupos, podeConfirmar, confirmacao, onConfirmar, papel, escreveValores, precos })` (o `papel` da parte 8; `escreveValores` e `precos` da parte 10), `ConfirmarEdicaoDialogo` (a forma do diálogo por props) e `PaginaEventos`; `adotarPedido`, `AdotarPedido` (T1); `canDecideRequests` (`lib/permissions.ts:53`); `fetchJson` e a rota `/api/customer-requests?customer_code=<code>&limit=50` (`lib/cloud-api.ts:2852-2858`: filtro `customer_code`, ordem `created_at`; índice `(customer_code, created_at)` já existe); `CustomerRequest` (`pages/customer-requests.tsx:45-93`, com `event_edition_id` da parte 6); `BotaoDeAcao`, `Dialog`, `DialogCancelar`, `useAcaoNaLinha`, `desfechoDoErro`, `useTentativaDaEscrita` como `pages/pedidos.tsx:21-76`; `textosDaTela`, `textosForaDaLista`, `violacoesDeAcessibilidade`.
- Produces (`lib/eventos/adocao.ts`, puro): `podeAdotar(linha: LinhaDaAgenda, role: string): boolean` (`status === "enviado"`, `pedidoId === null`, `canDecideRequests(role)`); `type CandidatoAAdocao = { request_id: string; texto: string }`; `candidatosAAdocao(solicitacoes: readonly CustomerRequest[]): CandidatoAAdocao[]` (tipo `retirada`, sem `event_edition_id`, status fora de `rejected` e `cancelled`, da mais recente à mais antiga; `texto` "PED-0042 · 24/11/2026 · 100 itens · 2.000 peças · Aprovada", com `open` "Aberta", `approved` "Aprovada", `closed` "Encerrada"); `SEM_CANDIDATO = "Nenhuma solicitação de saída deste cliente para adotar."`; `entradaDaAdocao({ editionId, requestId, chave }): AdotarPedido`.
- Produces (`adotar-pedido-dialogo.tsx`): `AdotarPedidoDialogo({ linha, candidatos, escolhido, onEscolher, estado, erro, onAdotar, onFechar })`, por props como `ConfirmarEdicaoDialogo`: o título "Adotar um pedido existente", a linha "<evento> · <label> · <cliente>", o `<select aria-label="Pedido">` com os `candidatos` (ou `SEM_CANDIDATO`), o `BotaoDeAcao` "Adotar pedido" ("Adotando…"), "Voltar"; `erro` em `role="alert"` ("Escolha o pedido" ou a frase do servidor); não fecha em `andamento`. `EventosView` ganha `podeAdotar`, `adocao: Parameters<typeof AdotarPedidoDialogo>[0] | null` e `onAdotar(linha)`: na linha de "Para confirmar" com `podeAdotar(linha, papel)` (o `papel` da parte 8), a ação "Adotar pedido" ao lado de "Confirmar" (ou "Confirmar e fechar preço"). `PaginaEventos` guarda o estado do diálogo e a mutação (`useTentativaDaEscrita`: a nova tentativa repete a `idempotency_key`; sucesso → toast "Pedido adotado pela edição", fecha e o foco volta à linha). Em `linhaDaAgenda`, o `resumo` da edição sem pedido diz "sem pedido · coleta no cliente 2.190".

- [ ] **Step 1: Write the failing tests**

```ts
// adocao.test.ts
it("só a coordenação adota, e só a linha enviada sem pedido", () => {
  expect(podeAdotar(linha({ status: "enviado", pedidoId: null }), "admin")).toBe(true);
  expect(podeAdotar(linha({ status: "enviado", pedidoId: null }), "wms")).toBe(false);
  expect(podeAdotar(linha({ status: "enviado", pedidoId: "creq_1" }), "admin")).toBe(false);
  expect(podeAdotar(linha({ status: "confirmado", pedidoId: null }), "admin")).toBe(false);
});
it("os candidatos: só retirada, sem edição, nem recusada nem cancelada, da mais recente à mais antiga, com o texto da linha", () => {
  expect(candidatosAAdocao(SOLICITACOES)).toEqual([{ request_id: "creq_aberta", texto: "PED-0043 · 25/11/2026 · 3 itens · 12 peças · Aberta" }, { request_id: "creq_necton", texto: "PED-0042 · 24/11/2026 · 100 itens · 2.000 peças · Aprovada" }]);
  expect(entradaDaAdocao({ editionId: "ced_necton2027", requestId: "creq_necton", chave: "adota-1" })).toEqual({ edition_id: "ced_necton2027", request_id: "creq_necton", idempotency_key: "adota-1" });
});
```

`agenda.test.ts` (parte 7): `linhaDaAgenda(edicaoEm("enviado", { pedido: null, itens: [], coleta: { quantidade: 2190 } }), …).resumo` é "sem pedido · coleta no cliente 2.190". `adotar-pedido-dialogo.test.tsx` (`renderToStaticMarkup`, no molde de `confirmar-edicao-dialogo.test.tsx` da parte 7): com dois candidatos, `textosForaDaLista(html, ["Adotar um pedido existente", "B2B Conference Necton · 2027 · BTG Pactual", "Pedido", /^PED-\d{4} · \d\d\/\d\d\/\d{4} · \d+ itens · [\d.]+ peças · (Aberta|Aprovada|Encerrada)$/, "Adotar pedido", "Voltar"])` é `[]`; sem candidato, `SEM_CANDIDATO`; em `andamento`, "Adotando…"; com `erro`, a frase em `role="alert"`; `axe` igual a `[]`. `eventos.test.tsx` (parte 7, jsdom; `vi.mock` de `@/lib/wms/eventos` e de `@/lib/cloud-api`): "Adotar pedido" na linha abre o diálogo e lê os candidatos uma vez; sem escolha, "Escolha o pedido" e nenhuma chamada; escolhido, `adotarPedido` com `{ edition_id, request_id, idempotency_key }` e nenhum `undefined`; o Esc não fecha em andamento; a recusa "A solicitação já pertence a uma edição." fica no diálogo; a nova tentativa repete a chave. `eventos-view.test.tsx`: a linha enviada sem pedido mostra "Adotar pedido" ao admin e não ao wms; a com pedido não a mostra. `cloud-api-indices.test.ts`: `["Eventos › Adotar pedido: as solicitações do cliente", "/api/customer-requests?customer_code=Itau&limit=50"]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/adocao.test.ts src/lib/eventos/agenda.test.ts src/features/eventos/adotar-pedido-dialogo.test.tsx src/pages/eventos.test.tsx src/pages/eventos-view.test.tsx src/lib/cloud-api-indices.test.ts`
Expected: FAIL (módulos não existem; a agenda não tem a ação).

- [ ] **Step 3: Implement the rules, the dialog, the action in the agenda and the query entry**

`pages/eventos.tsx` lê os candidatos só com o diálogo aberto (`useQuery` com `fetchJson`, chave `["eventos-adocao", customer_code]`); o resultado da adoção chega pela escuta ao vivo das edições: a linha muda de grupo sozinha. Carregamento v2: `BotaoDeAcao`, nunca `disabled` a 50%.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/adocao.ts artifacts/app/src/lib/eventos/adocao.test.ts artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/eventos/agenda.test.ts artifacts/app/src/features/eventos/adotar-pedido-dialogo.tsx artifacts/app/src/features/eventos/adotar-pedido-dialogo.test.tsx artifacts/app/src/pages/eventos.tsx artifacts/app/src/pages/eventos.test.tsx artifacts/app/src/pages/eventos-view.tsx artifacts/app/src/pages/eventos-view.test.tsx artifacts/app/src/lib/cloud-api-indices.test.ts
git commit -m "feat(app): \"Adotar pedido\" na agenda dos Eventos"
```

### Task 4: a edição da Necton registrada

**Files:**
- Test: `functions/wms/src/domain/eventos/adocao.integration.test.ts` (o caso 7, a história inteira)
- Modify: `artifacts/app/src/lib/eventos/registrada.ts` (parte 11: `linhasDoQueAconteceu`), `artifacts/app/src/test/edicao-da-necton.ts` (`EDICAO_ADOTADA_DA_NECTON`)
- Test: `artifacts/app/src/lib/eventos/registrada.test.ts`, `artifacts/app/src/pages/client/evento-registrado-view.test.tsx` (um `it` cada)
- Create: `docs/plataforma/eventos-necton-2027.md` (o roteiro e o registro)
- Modify: `docs/manual-armazenagem.md` (a seção "## Eventos" da parte 12: a subseção "Adotar um pedido existente" e a linha "Sem mexer no estoque" em "Registrar o retorno ao estoque"), `CLAUDE.md` (o bullet dos Eventos da parte 12: a parte 13), `docs/mockups/README.md` (a nota do canvas, hoje linha 833: a parte 13), `docs/superpowers/plans/2026-11-26-eventos.md` (o que mudou de nome)

**Interfaces:**
- Consumes: T1 a T3; `saveEventEditionTransaction`, `sendEventEditionTransaction` (parte 2); `attachEventPhotoTransaction` com o `bucket` falso de `arquivos.integration.test.ts` (parte 3); `registerEventMomentTransaction` (parte 8); `receiveEventReturnTransaction`, `ReceberRetornoSchema` e `ROTULOS_DO_RETORNO` (parte 9), com `entradaDe` (parte 2); `setEventEditionPriceTransaction`, `closeEventEditionTransaction` (parte 10); `createReturnReceiptTransaction` (`operations.ts:3681`); `linhasDoQueAconteceu`, `diaEHora`, `EDICAO_DA_NECTON`, `edicaoEm` (parte 11); a edição do portal chega por `useEdicaoDoEvento` (parte 4, desde a parte 11), pela mesma `edicaoDaLeitura` de T1 e T2, e é dela que `linhasDoQueAconteceu` lê o `pedido.adotado_em`; o ator `financeiro` como `preco.integration.test.ts`.
- Produces: `linhasDoQueAconteceu` com a linha "Pedido adotado" (`por: "pela Dutelog"`, `feito: diaEHora(pedido.adotado_em)`, `dados: [order_number ?? request_number]`) logo depois de "Pedido enviado", só com `pedido?.adotado_em != null`; `EDICAO_ADOTADA_DA_NECTON: EdicaoView` (a Necton com `pedido.adotado_em: "2027-02-02T13:00:00.000Z"`, `pedido.order_number: "PED-0042"`, `retorno.sem_estoque: true`); o roteiro `docs/plataforma/eventos-necton-2027.md`.

- [ ] **Step 1: Write the failing tests**

Em `adocao.integration.test.ts`:

```ts
it("7. a história da Necton: enviada só com a coleta, o pedido de 24/11 adotado já entregue e recebido em Devoluções, os momentos e as fotos, o retorno sem estoque, o preço e o fechamento", ...)
// edicaoEnviadaSoComColeta() (T1, passo 5: os seis momentos numa gravação só, a montagem e o evento com o ate); pedidoDeHoje("entregue"); createReturnReceiptTransaction (a devolução de Devoluções, 1.994 peças); adotar → "no_evento"
// registerEventMomentTransaction (armazem), cinco chamadas, uma por registro, pelos ids que o save gerou: o início e o fim da montagem, o início e o fim do evento e o início da desmontagem (sem ate, não tem fim); attachEventPhotoTransaction: três fotos em três momentos
// receiveEventReturnTransaction com a entrada lida por entradaDe(ReceberRetornoSchema, …, ROTULOS_DO_RETORNO), como a callable: sem_estoque { return_id }, as linhas 996+2, 699+1, 299+0 e coleta { voltou: 1930 } → "retornado"; setEventEditionPriceTransaction (financeiro, 980000); closeEventEditionTransaction (coordenacao) → "fechado"
// a edição: itens[].foi [1000, 700, 300], voltou [996, 699, 299], avariadas [2, 1, 0], nao_voltaram [2, 0, 1], coleta.distribuidos 260, retorno.sem_estoque true, fotos.length 3
// movements de functions_event_return: 0; returns.size 1; client_event_prices.fechado_cents 980000 e JSON.stringify(edição) sem /cents|R\$|CX-/
// eventosDaEdicao() na ordem: edicao_salva (um só, o da criação), edicao_enviada, pedido_adotado, edicao_confirmada, edicao_separada, edicao_no_evento, momento_registrado ×5 (um por registro), foto_anexada ×3, retorno_registrado, preco_fechado, edicao_fechada
```

`registrada.test.ts`: `linhasDoQueAconteceu(EDICAO_ADOTADA_DA_NECTON).map((l) => l.titulo)` começa com `["Pedido enviado", "Pedido adotado", "Confirmado", "Separado"]`, a segunda linha `toMatchObject({ por: "pela Dutelog", dados: ["PED-0042"] })`, e `linhasDoQueAconteceu(EDICAO_DA_NECTON)` não tem "Pedido adotado". `evento-registrado-view.test.tsx`: a adotada renderiza com "Pedido adotado" na lista permitida e o HTML não casa `/CX-|R\$|Devoluções|sem_estoque/`; `axe` igual a `[]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/adocao.integration.test.js"` e `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/registrada.test.ts src/pages/client/evento-registrado-view.test.tsx`
Expected: FAIL (o caso 7 e a linha não existem).

- [ ] **Step 3: Implement the line and the fixture; adjust only what case 7 reveals, without changing what T1 to T3 defined**

- [ ] **Step 4: Run the whole lists once**

Run: `cd C:\DEV\Dute; corepack pnpm run typecheck; npm --prefix functions/wms run test:unit; npm --prefix functions/wms run test:integration` e `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos src/features/eventos src/pages/client src/pages/eventos-view.test.tsx src/pages/evento-view.test.tsx src/lib/platform-lists.test.ts src/lib/cloud-api-indices.test.ts`
Expected: PASS, inclusive `callables-papeis`, `callables-auth`, `order-return`, a régua e a conferência das consultas.

- [ ] **Step 5: Write the runbook and the doc lines**

`docs/plataforma/eventos-necton-2027.md`, no molde de `docs/plataforma/recebimento-com-caixas.md`: o porquê (decisão 8), o roteiro em ordem, com quem faz cada passo, e a tabela do registro, a preencher na execução (data, quem, o `PED-`, o id da edição, o commit publicado):

1. Cristiane (portal): "Novo evento" B2B Conference Necton, edição 2027, Hotel Unique, o endereço, o contato, os sete momentos (de 28/01 a 02/02/2027), "O que vai · coleta no cliente" 2.190, nenhum item do estoque, as observações e o layout; "Enviar para a Dutelog" (sem itens não nasce pedido: a edição fica enviada e sem pedido).
2. Guilherme (Eventos › "Para confirmar"): "Adotar pedido", o `PED-` de 24/11/2026; a edição assume o status do pedido (se ele ainda não saiu, "Confirmar" e os ganchos fazem o resto). Na ficha, "Registrar" cada momento com as fotos, "Equipe e veículo" e "Fechar preço".
3. Devoluções: o retorno das peças recebido como hoje ("Registrar devolução", referência "`PED-` · retorno do evento", a disposição de sempre). Na ficha, "Registrar o retorno ao estoque" com "Sem mexer no estoque" marcado e a devolução escolhida, as linhas e a coleta; "Confirmar retorno"; "Fechar edição".
4. Cristiane: `/portal/eventos/edicao?id=` e o romaneio; a Dutelog confere "Pedido adotado" em "O que aconteceu".

No manual, a subseção "Adotar um pedido existente" (a ação, quem a vê, as recusas pelas frases de T1) e a linha do "Sem mexer no estoque" (só na edição que adotou o pedido; escolhe a devolução de Devoluções; nada entra no estoque). No CLAUDE.md, no bullet dos Eventos: "A parte 13 (a adoção) liga um pedido existente a uma edição enviada (`adoptOrderIntoEdition`, coordenação; `evento.pedido_adotado`) e registra o retorno sem estoque (`sem_estoque`, só na edição adotada, ligado à devolução de Devoluções); a história da Necton 2027 em `docs/plataforma/eventos-necton-2027.md`". No README das pranchas, a parte 13 na nota do canvas. No índice, os nomes que mudaram.

- [ ] **Step 6: Commit**

```bash
git add functions/wms/src/domain/eventos/adocao.integration.test.ts artifacts/app/src/lib/eventos/registrada.ts artifacts/app/src/lib/eventos/registrada.test.ts artifacts/app/src/test/edicao-da-necton.ts artifacts/app/src/pages/client/evento-registrado-view.test.tsx docs/plataforma/eventos-necton-2027.md docs/manual-armazenagem.md CLAUDE.md docs/mockups/README.md docs/superpowers/plans/2026-11-26-eventos.md
git commit -m "feat(app): a edição adotada no portal, e o roteiro da história da Necton 2027"
```

### Pronto quando

No emulador, pelos testes: a edição da Necton enviada só com a coleta adota
o pedido de 24/11 já entregue e vai a `no_evento` com o `foi`, os volumes, o
lacre e a entrega, sem escrita de estoque; a solicitação aberta adotada é
confirmada pela aprovação em Pedidos; o retorno sem estoque registra 1.994,
3 e 3 ligado à devolução de Devoluções, sem ENTRADA, guarda nem `returns`
novo; o portal lê "Pedido adotado". `typecheck`, `test:unit`,
`test:integration` e os vitest tocados verdes; `git status` só com os
arquivos desta parte. Na produção, o registro segue
`docs/plataforma/eventos-necton-2027.md`, com a tabela preenchida num PR só
de documentação depois; sem prazo (decisão 8).
