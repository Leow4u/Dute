# Eventos · parte 2: o rascunho no servidor (salvar, enviar, cancelar, arquivar)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a edição nasce, muda, é enviada, cancelada e excluída no servidor,
com o evento (a capa), o documento de preço, o CAS, os recibos e a
auditoria; ainda sem pedido (parte 6), sem arquivos (parte 3) e sem tela
(parte 4).

**Architecture:** o domínio em `functions/wms/src/domain/eventos/`
(`eventos-auditoria.ts`, `edicao.ts` puro, `edicao-gravacao.ts` com as
transações), quatro callables de uma linha no `index.ts` logo depois de
`archiveClientEventTemplate`, as linhas na matriz de papéis, e os wrappers
do app em `lib/wms/eventos.ts` com a lista `CALLABLES_DOS_EVENTOS` travada
contra o `index.ts`. O `patch` usa o CAS `expected_edicao`; a criação, o id
determinístico pela `idempotency_key`; enviar, cancelar e arquivar, recibo
inline como `count-rounds.ts`.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test`
com o emulador; vitest no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
evento e a edição", "A edição, campo a campo", "O cronograma", "Os status e
quem move cada um", "As callables", "Eventos de auditoria", "Limites e
mensagens". Índice: `docs/superpowers/plans/2026-11-26-eventos.md`.

## Global Constraints

As do índice. Nesta parte, ainda: `sendEventEdition` não cria solicitação
(a parte 6 liga `createCustomerRequestTransaction` por `deps`); o cliente
cancela só em `rascunho` (exclui) e `enviado`; a coordenação cancela só em
`enviado` nesta parte (os outros status entram na parte 7 com o pedido).

## Review Focus

1. A observação de 418 caracteres em `observacoes` é aceita e a de 301
   caracteres na observação de "Montagem" recusa com "A observação de
   Montagem passa de 300 caracteres" (T5).
2. O `patch` com `expected_edicao` velho recusa com "A edição mudou em
   outra aba" e não grava nada: `edicao` continua igual (T5).
3. O cliente de outro código recebe `not-found` "Edição não encontrada." ao
   ler, mudar, enviar ou cancelar (T5).
4. A edição com 100 itens de 1.000.000 de peças e 12 momentos grava e relê
   (o documento fica sob 1 MiB) (T5).
5. O rascunho excluído some com o documento de preço, e o evento criado só
   para ele some junto; o evento com outra edição fica (T5).

---

### Task 1: `eventos-auditoria.ts`, os tipos e os payloads `.strict()`

**Files:**
- Create: `functions/wms/src/domain/eventos/eventos-auditoria.ts`
- Test: `functions/wms/src/domain/eventos/eventos-auditoria.test.ts` (`test:unit`)

**Interfaces:**
- Consumes: `createEvent(transaction, db, id, input, actor)` e `OperationalActor` de `../operations.js`.
- Produces:
  - `EVENTO_EVENT_TYPES` (os 16 tipos do índice, `as const`), `type EventoEventType`.
  - `PAYLOAD_DO_EVENTO: Record<EventoEventType, z.ZodObject<…>>`, todos `.strict()`, só ids (`z.string().min(1).max(120)`), contagens (`z.number().int().min(0)`), instantes ISO (`z.string()`), enums e booleanos: `edicao_salva {edition_id, event_id, criada: boolean, itens, momentos}`; `edicao_enviada {edition_id, request_id: string|null, itens, pecas}`; `edicao_confirmada {edition_id, order_id: string|null, separar_ate: string|null}`; `edicao_separada {edition_id, order_id, volumes, pecas}`; `edicao_no_evento {edition_id, order_id: string|null, entregue_em}`; `momento_registrado {edition_id, momento_id, tipo, inicio, fim: string|null, origem}`; `momento_corrigido {edition_id, momento_id, de: {inicio, fim: string|null}, para: {inicio, fim: string|null}}`; `foto_anexada {edition_id, momento_id, fotos}`; `documento_anexado {edition_id, documento_id, origem}`; `documento_retirado {edition_id, documento_id}`; `retorno_recebido {edition_id, return_id: string|null, itens, voltaram, avariadas, nao_voltaram}`; `preco_fechado {edition_id}`; `edicao_fechada {edition_id}`; `edicao_cancelada {edition_id, status_anterior}`; `edicao_excluida {edition_id, event_id, evento_excluido: boolean}`; `arquivado {event_id, edicoes}`.
  - `TITULO_DO_EVENTO: Record<EventoEventType, string>` ("Edição do evento salva", "Edição enviada à Dutelog", "Edição confirmada", "Edição separada", "Edição no evento", "Momento registrado", "Momento corrigido", "Foto anexada", "Documento anexado", "Documento retirado", "Retorno recebido", "Preço fechado", "Edição fechada", "Edição cancelada", "Rascunho excluído", "Evento arquivado").
  - `createEventoEvent(transaction: Transaction, db: Firestore, evento: { type: EventoEventType; customer_code: string; edition_id: string | null; descricao: string; payload: unknown }, actor: OperationalActor): OperationalEventSummary` — valida `payload` com o schema do tipo (lança `HttpsError("internal", …)` se não bater: é erro de programação), id `evt_evento_<type sem "evento.">_<edition_id ou event_id>_<8 hex>`, e chama `createEvent` com `title` do mapa, `description: descricao` (`"<nome do evento> · <label>"`, sem contato nem valor), `severity: "info"`, `entity_type: "client_event_edition"` (ou `client_event` quando `edition_id` é null), `entity_id`, `customer_code`, `source: "functions_client_events"`, `inbox: false`.

- [ ] **Step 1: Write the failing test**

`eventos-auditoria.test.ts` (node:test, puro):

```ts
it("todo tipo tem payload e título, e o payload é estrito", () => {
  for (const type of EVENTO_EVENT_TYPES) {
    assert.ok(PAYLOAD_DO_EVENTO[type]); assert.ok(TITULO_DO_EVENTO[type]);
    assert.throws(() => PAYLOAD_DO_EVENTO[type].parse({ ...exemplo(type), extra: 1 }));
  }
});
it("nenhum payload leva dinheiro, nome de pessoa ou contato", () => {
  const proibidas = /(valor|preco|price|cents|total|email|telefone|phone|contato|nome|name)/i;
  for (const type of EVENTO_EVENT_TYPES) for (const chave of chaves(PAYLOAD_DO_EVENTO[type])) assert.doesNotMatch(chave, proibidas);
});
it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
  const fonte = read("../../../src/index.ts");
  const bloco = fonte.slice(fonte.indexOf("function notificationKindForEvent"), fonte.indexOf("function notificationDraftFromEvent"));
  const palavras = [...bloco.matchAll(/includes\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.ok(palavras.length >= 10);
  for (const type of EVENTO_EVENT_TYPES) for (const palavra of palavras) assert.ok(!type.includes(palavra), `${type} contém ${palavra}`);
});
```

`exemplo(type)` é um mapa de exemplos válidos no próprio teste; `chaves()`
percorre `schema.shape` recursivamente (objetos aninhados `de`/`para`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/eventos-auditoria.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement `eventos-auditoria.ts` and register the test in `test:unit`**

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/eventos-auditoria.ts functions/wms/src/domain/eventos/eventos-auditoria.test.ts functions/wms/package.json
git commit -m "feat(wms): os eventos de auditoria dos Eventos, com payload estrito"
```

### Task 2: `edicao.ts`, as entradas, as mensagens por campo e a leitura

**Files:**
- Create: `functions/wms/src/domain/eventos/edicao.ts`
- Test: `functions/wms/src/domain/eventos/edicao.test.ts` (`test:unit`)

**Interfaces:**
- Consumes: `LIMITES`, `TIPOS_DE_MOMENTO`, `STATUS_DA_EDICAO`, `ROTULO_DO_MOMENTO`, `problemaDoCronograma`, `labelPadrao`, `edicaoAberta` de `./dominio.js`.
- Produces:
  - Schemas zod, todos `.strict()`: `MomentoPrevistoSchema` (`tipo`, `rotulo` ≤60 nullish, `data` `^\d{4}-\d{2}-\d{2}$`, `hora` `^\d{2}:\d{2}$`, `ate` idem nullable, `local` ≤160 nullish, `observacao` ≤300 nullish); `ItemDaEdicaoSchema` (`sku_code` 1..120, `client_item_code` ≤120 nullish, `product_name` 1..200, `size` ≤80 nullish, `category` ≤120 nullish, `quantity` int 1..1_000_000); `ColetaSchema` (`onde` ≤300 nullish, `quantidade` int 0..1_000_000, `valor_declarado_cents` int 0..1_000_000_000_00 nullish, `observacao` ≤500 nullish); `OndeSchema` (`local` ≤160, `endereco` ≤300, `contato: { nome ≤120, telefone ≤40 }`, todos nullish); `ConteudoDaEdicaoSchema` (`label` ≤40, `onde`, `cronograma` array ≤12, `itens` array ≤100, `coleta`, `observacoes` ≤2000, todos opcionais); `CriarEdicaoSchema` (`idempotency_key` 8..200, `customer_code` opcional, `event_id` ≤120 nullish, `name` ≤120 nullish, `description` ≤300 nullish, `origem_edicao_id` ≤120 nullish, `patch` opcional) com `refine`: `event_id` ou `name`; `PatchDaEdicaoSchema` (`id` 1..120, `expected_edicao` int ≥1, `customer_code` opcional, `patch: ConteudoDaEdicaoSchema`); `EnviarEdicaoSchema` (`id`, `expected_edicao`, `idempotency_key`, `customer_code`?); `CancelarEdicaoSchema` (`id`, `idempotency_key`, `motivo` ≤500 nullish, `customer_code`?); `ArquivarEventoSchema` (`event_id`, `idempotency_key`, `customer_code`?).
  - `entradaDe<T>(schema: z.ZodType<T>, raw: unknown): T` — `safeParse`; na falha lança `HttpsError("invalid-argument", mensagemDoCampo(issue))`, a primeira issue. `mensagemDoCampo`: `too_big` em string → `"<Rótulo> passa de <max> caracteres"`; `too_small`/`invalid_type` em campo obrigatório → `"Informe <rótulo>"`; `too_big` em array → `"<Rótulo> leva até <max> <unidade>"`; o resto → `"<Rótulo> inválido"`. `ROTULO_DO_CAMPO` cobre todos os caminhos (`name` → "o nome do evento"; `patch.onde.local` → "o local"; `patch.cronograma.<n>.observacao` → "A observação de <ROTULO_DO_MOMENTO do tipo nessa posição>"; `patch.itens` → "Os itens" com unidade "itens"; `patch.coleta.quantidade` → "a quantidade da coleta"; …).
  - `type EdicaoView` (o documento da spec com `created_at`/`updated_at`/`enviada_em`… em ISO) e `viewDaEdicao(id: string, data: Record<string, unknown>): EdicaoView`.
  - `camposDoPatchPermitidos(status: StatusDaEdicao, papel: string): readonly (keyof Conteudo)[]` — `rascunho` + qualquer editor: todos; `enviado` ou `confirmado` + owner/admin/interno: `["label","onde","cronograma"]`; senão `[]`. E `problemaDoPatch(status, papel, patch): string | null` → `"A edição não aceita mudança neste status"` quando o patch traz campo fora da lista (`"Os itens não mudam depois do envio"` quando o campo é `itens`).
  - `problemaParaEnviar(edicao: EdicaoView): string | null` nesta ordem: `"Informe o local"`; `"Escolha ao menos um item ou informe a coleta no cliente"`; `problemaDoCronograma(cronograma, { comItensDoEstoque: itens.length > 0, comColeta: coleta.quantidade > 0 })`.

- [ ] **Step 1: Write the failing test**

`edicao.test.ts` (puro): `entradaDe(PatchDaEdicaoSchema, …)` com a
observação de 301 caracteres no segundo momento (tipo `montagem`) lança
`invalid-argument` com a mensagem exata "A observação de Montagem passa de
300 caracteres"; sem `name` nem `event_id` em `CriarEdicaoSchema` → "Informe
o nome do evento"; 101 itens → "Os itens leva até 100 itens"; campo extra
→ invalid-argument (strict); `camposDoPatchPermitidos("enviado","cliente")`
é `[]`; `problemaDoPatch("enviado","interno",{ itens: [] })` é "Os itens não
mudam depois do envio"; `problemaParaEnviar` nas três situações; `viewDaEdicao`
converte `Timestamp` em ISO e ausentes em `null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/edicao.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `edicao.ts` and register the test**

`optionalText(max)` como em `client-events.ts`. Nenhum acesso ao Firestore
neste arquivo.

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/edicao.ts functions/wms/src/domain/eventos/edicao.test.ts functions/wms/package.json
git commit -m "feat(wms): as entradas da edição do evento, com a recusa por campo"
```

### Task 3: `edicao-gravacao.ts`, as transações

**Files:**
- Create: `functions/wms/src/domain/eventos/edicao-gravacao.ts`
- Test: `functions/wms/src/domain/eventos/edicao.integration.test.ts` (T5; escreva os casos de criação e `patch` já aqui para dirigir esta tarefa)

**Interfaces:**
- Consumes: T1, T2; `createEvent`/`OperationalActor` de `../operations.js`; `assertClientEventEditor` de `../client-events.js` (exportado hoje); o `digest` local (sha256 hex, como `count-rounds.ts`).
- Produces:
  - `EVENTOS_COLLECTION = "client_events"`, `EDICOES_COLLECTION = "client_event_editions"`, `PRECOS_COLLECTION = "client_event_prices"` (o legado continua `CLIENT_EVENTS_COLLECTION = "client_event_templates"` em `client-events.ts`), `OPERATIONS_COLLECTION = "operational_operations"`; os `kind` dos recibos: `evento.send`, `evento.cancel`, `evento.archive`.
  - `saveEventEditionTransaction(db: Firestore, input: CriarEdicao | PatchDaEdicao, actor: OperationalActor & { customer_code: string }): Promise<{ id: string; edicao: number; created: boolean; edition: EdicaoView }>`.
    - Criação (`"idempotency_key" in input`): `editionId = "ced_" + digest({ customer, nonce: idempotency_key }, 16)`; se existe, devolve `created: false` sem gravar. `event_id` dado: o evento tem de existir, ser do cliente e `active` (senão `not-found` "Evento não encontrado."); sem `event_id`: cria `client_events/{"cve_" + digest({ customer, nonce: "evento:" + idempotency_key }, 16)}` com `name`, `description`, `status: "active"`, `editions_count: 1`. Grava a edição com `status: "rascunho"`, `edicao: 1`, `label` = `patch.label` ou `labelPadrao(cronograma)`, os campos do `patch` validados por T2, `itens_total`/`pecas_total`, `origem_edicao_id`, `created_*`/`updated_*`; `client_event_prices/{editionId}` com `valor_declarado_cents` (ou null) e `customer_code`; atualiza `last_edition_id`/`last_edition_label`/`editions_count` do evento; `createEventoEvent(edicao_salva, { criada: true })`.
    - `patch`: `lerEdicaoDoCliente`; `expected_edicao !== edicao` → `failed-precondition` "A edição mudou em outra aba"; `problemaDoPatch(status, actor.role, patch)` → `failed-precondition` com a frase; aplica o `patch` campo a campo (substitui o campo inteiro: `itens` vem completo), recalcula `itens_total`, `pecas_total`, `label` quando vazia, `edicao + 1`, `updated_*`; `valor_declarado_cents` no documento de preço quando `patch.coleta` veio; evento `edicao_salva { criada: false }`.
  - `sendEventEditionTransaction(db, input: EnviarEdicao, actor, deps: { criarSolicitacao?: (transaction: Transaction, edicao: EdicaoView) => Promise<{ request_id: string; request_number: string }> }): Promise<{ id: string; status: "enviado"; request_id: string | null; edition: EdicaoView }>` — recibo `op_evento_send_<digest({ customer, nonce: idempotency_key })>` (mesma chave, mesmo `input_hash` → mesmo resultado; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."); exige `status === "rascunho"` (senão `failed-precondition` "A edição já foi enviada."), `expected_edicao`, `problemaParaEnviar` (→ `failed-precondition` com a frase); com `deps.criarSolicitacao` e itens, chama e grava `pedido.request_id`/`request_number` (parte 6; nesta parte `deps` vazio e `pedido` fica null); grava `status: "enviado"`, `enviada_em`, `edicao + 1`; evento `edicao_enviada`.
  - `cancelEventEditionTransaction(db, input: CancelarEdicao, actor): Promise<{ id: string; resultado: "excluida" | "cancelada" }>` — recibo `op_evento_cancel_<digest>`; `rascunho`: apaga a edição e o preço, `editions_count − 1` no evento e, chegando a 0, apaga o evento; evento `edicao_excluida { evento_excluido }`; `enviado`: `status: "cancelado"`, `cancelada_em`, `cancelada_por`, `cancelamento_motivo` (o cliente pode deixar vazio; a coordenação precisa de motivo: `invalid-argument` "Informe o motivo"); evento `edicao_cancelada { status_anterior }`; outros status: `failed-precondition` "Só a coordenação cancela uma edição confirmada." (`confirmado`/`separado`, até a parte 7) ou "Os itens já saíram: registre o retorno e feche a edição." (`no_evento` em diante), e "A edição já está fechada." (`fechado`/`cancelado`).
  - `archiveClientEventTransaction(db, input: ArquivarEvento, actor): Promise<{ event_id: string; changed: boolean }>` — recibo `op_evento_archive_<digest>`; evento do cliente e `active`; consulta `client_event_editions` `where event_id == … and customer_code == …` e, se alguma tem `edicaoAberta(status)`, `failed-precondition` "O evento tem uma edição aberta: termine ou exclua antes de arquivar."; `status: "archived"`, `archived_*`; evento `arquivado { edicoes }`.
  - `lerEdicaoDoCliente(transaction: Transaction, db: Firestore, editionId: string, customerCode: string): Promise<{ ref: DocumentReference; data: Record<string, unknown> }>` — `not-found` "Edição não encontrada." quando não existe ou é de outro cliente.

- [ ] **Step 1: Write the failing tests (criação e patch, em T5's file)**

Os casos 1 a 5 da T5 abaixo.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/edicao.integration.test.js"`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement the four transactions and `lerEdicaoDoCliente`**

Uma `db.runTransaction` por função; as leituras antes de qualquer escrita;
`FieldValue.serverTimestamp()` nos carimbos; `actorRef` como em
`client-events.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2. Expected: PASS nos casos 1 a 5.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/edicao-gravacao.ts functions/wms/src/domain/eventos/edicao.integration.test.ts functions/wms/package.json
git commit -m "feat(wms): a edição do evento nasce, muda, é enviada, cancelada e excluída"
```

### Task 4: as quatro callables, a matriz e a trava da lista

**Files:**
- Modify: `functions/wms/src/index.ts` (quatro `export const … = onCall(` numa linha cada, logo depois de `archiveClientEventTemplate`, com o comentário `// Eventos (docs/superpowers/specs/2026-11-26-eventos-design.md)`)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (quatro linhas na `MATRIZ`)
- Create: `artifacts/app/src/lib/wms/eventos.ts` (T6 traz os wrappers; aqui só a lista `CALLABLES_DOS_EVENTOS`)
- Modify: `artifacts/app/src/lib/platform-lists.test.ts` (dois `it` no `describe` dos Eventos)

**Interfaces:**
- Produces: as callables `saveEventEdition`, `sendEventEdition`, `cancelEventEdition`, `archiveClientEvent`, todas com o corpo: `const profile = await getProfile(request); assertClientEventEditor(profile); assertEventosLiberado(PROJECT_ID); const input = entradaDe(<Schema>, request.data ?? {}); const customer_code = requireCustomerScope(profile, input.customer_code); return <transação>(db, { ...input, customer_code }, { ...profile, customer_code });`.
- Produces (app): `export const CALLABLES_DOS_EVENTOS = ["saveEventEdition", "sendEventEdition", "cancelEventEdition", "archiveClientEvent"] as const;`.

- [ ] **Step 1: Write the failing tests**

Na `MATRIZ`: `saveEventEdition: { passam: [...COORDENACAO, "cliente"], recusa: SO_EVENTOS_DO_CLIENTE }` e o mesmo para as outras três.

Em `platform-lists.test.ts`, no `describe` dos Eventos:

```ts
it("cada callable dos Eventos existe numa linha do index.ts e confere a liberação", () => {
  const fonte = read("functions/wms/src/index.ts");
  for (const nome of CALLABLES_DOS_EVENTOS) {
    const inicio = fonte.indexOf(`export const ${nome} = onCall(`);
    expect(inicio, nome).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio, fonte.indexOf("\nexport const ", inicio + 1));
    expect(corpo, nome).toContain("assertEventosLiberado(PROJECT_ID)");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/platform-lists.test.ts` e a
matriz: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js"`
Expected: FAIL (a matriz tem linhas sem callable; o index não tem as callables).

- [ ] **Step 3: Implement the four callables and the list**

Importe de `./domain/eventos/…js`; `PROJECT_ID` já existe no `index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: os do passo 2, mais `node --test lib/callables-auth.integration.test.js`
no mesmo `emulators:exec` (as quatro entram sozinhas na descoberta) e
`pwsh tools/check_functions_invoker.ps1 -ProjectId dute-homolog` só depois de
publicar. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/platform-lists.test.ts
git commit -m "feat(wms): as callables do rascunho da edição do evento"
```

### Task 5: o teste de integração completo

**Files:**
- Test: `functions/wms/src/domain/eventos/edicao.integration.test.ts` (na lista de `test:integration`, depois de `lib/domain/client-events.integration.test.js`)

**Interfaces:**
- Consumes: T3. Atores como em `client-events.integration.test.ts` (`cristiane` cliente da BTG, `outraCliente`, `manoel` interno), o `beforeEach` que limpa o emulador, `eventsFor(id)`.

- [ ] **Step 1: Write the failing tests** (os casos 1 a 5 já existem de T3; acrescente 6 a 11)

```ts
it("1. nasce com o nome só: rascunho, edicao 1, a capa com editions_count 1, o preço vazio e o evento de auditoria", ...)
it("2. a mesma chave de criação devolve a mesma edição sem segundo documento", ...)
it("3. o patch com 100 itens de 1.000.000 e 12 momentos grava, relê e soma itens_total e pecas_total", ...)
it("4. o patch com expected_edicao velho recusa com 'A edição mudou em outra aba' e não grava", ...)
it("5. a observação de 418 caracteres é aceita; a de 301 em Montagem recusa dizendo o campo", ...)
it("6. enviar sem o momento evento recusa 'Informe a data do evento'; sem itens nem coleta, 'Escolha ao menos um item ou informe a coleta no cliente'", ...)
it("7. enviar grava enviado e enviada_em, com o evento edicao_enviada; a mesma chave devolve o mesmo; outra chave com outro conteúdo recusa", ...)
it("8. depois do envio o cliente não muda nada e a coordenação muda só onde, cronograma e label", ...)
it("9. cancelar o rascunho apaga a edição, o preço e o evento criado só para ele; o evento com outra edição fica", ...)
it("10. o cliente cancela a enviada; a confirmada recusa 'Só a coordenação cancela uma edição confirmada.'", ...)
it("11. arquivar com edição aberta recusa; depois de cancelar, arquiva com o evento 'arquivado'", ...)
it("12. o cliente de outro código recebe not-found ao ler, mudar, enviar e cancelar", ...)
```

Para o caso 10 grave `status: "confirmado"` direto no documento no `before`
do caso (a transição real é da parte 7).

- [ ] **Step 2: Run tests to verify they fail**

Run: o `emulators:exec` do T3. Expected: FAIL nos casos 6 a 12.

- [ ] **Step 3: Adjust the transactions until every case passes** (sem mudar o que T3 definiu, só o que os casos revelarem)

- [ ] **Step 4: Run the whole integration list once**

Run: `cd C:\DEV\Dute; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `callables-papeis`, `callables-auth` e o CI que
registra as consultas (a consulta de `archiveClientEventTransaction`, duas
igualdades, não precisa de índice composto).

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/edicao.integration.test.ts functions/wms/src/domain/eventos/edicao-gravacao.ts functions/wms/package.json
git commit -m "test(wms): a edição do evento de ponta a ponta no emulador"
```

### Task 6: os wrappers do app

**Files:**
- Modify: `artifacts/app/src/lib/wms/eventos.ts`
- Test: `artifacts/app/src/lib/wms/eventos.test.ts`

**Interfaces:**
- Consumes: `functionsDoApp`, `firebaseApp`, `semCamposVazios`, `erroDaCallable` como em `lib/wms/mover-caixa.ts`; os tipos de entrada espelhados de T2 em `lib/eventos/tipos.ts` (criar aqui: `MomentoPrevisto`, `ItemDaEdicao`, `Coleta`, `Onde`, `ConteudoDaEdicao`, `EdicaoView`, `StatusDaEdicao` reexportado de `@workspace/dominio`).
- Produces: `salvarEdicao(entrada: CriarEdicao | PatchDaEdicao): Promise<{ id: string; edicao: number; created: boolean; edition: EdicaoView }>`, `enviarEdicao(entrada: EnviarEdicao)`, `cancelarEdicao(entrada: CancelarEdicao)`, `arquivarEvento(entrada: ArquivarEvento)`; `CALLABLES_DOS_EVENTOS` (T4).

- [ ] **Step 1: Write the failing test**

`eventos.test.ts` (vitest, `vi.mock("firebase/functions")`): `salvarEdicao`
chama `httpsCallable(…, "saveEventEdition")` com a entrada sem campos
`undefined` (um `patch` com `onde.endereco: undefined` chega sem a chave);
um erro `HttpsError` vira `erroDaCallable` (código e `detalhe`); os quatro
nomes de `CALLABLES_DOS_EVENTOS` são os quatro wrappers.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the wrappers and `lib/eventos/tipos.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2, e `cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/tipos.ts
git commit -m "feat(app): os wrappers das callables da edição do evento"
```

### Pronto quando

No emulador, pelos testes: a edição da Necton (100 itens, 7 momentos, a
coleta de 2.190 e a observação longa) nasce, muda em dois patches, é enviada
e, numa segunda edição, cancelada e excluída; o CI inteiro verde; nenhuma
tela ainda. O PR registra em `docs/superpowers/plans/2026-11-26-eventos.md`
o que mudou de nome, se mudou.
