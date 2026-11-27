# Eventos · parte 10: o preço, a proposta e o fechamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o dinheiro da edição e o fim dela: o preço fechado, a observação
e a proposta em `client_event_prices` (por `confirmEventEdition`, para quem
confirma e escreve valores, ou por `setEventEditionPrice`, o "Fechar preço"
e o "Alterar" da ficha de owner e admin; o `financeiro` passa no gate, mas
na v1 não tem tela), a paridade entre o caminho `valores/` do Storage
(regra e teste da parte 3) e o que a callable aceita,
`closeEventEdition` levando a edição retornada a `fechado`, o bloco "Preço
fechado" e o "Fechar edição" com o que falta como dado na ficha e na
agenda, e "Edição para fechar" no Início.

**Architecture:** `preco.ts` em `functions/wms/src/domain/eventos/` com as
regras puras, o escritor `gravarPreco` e as duas transações, no molde de
`count-rounds.ts` (recibo inline, evento na mesma transação). A confirmação
da parte 7 ganha o preço pelo `aoConfirmar` dos `deps` dela, sem mudar a
assinatura: a parte 7 leva o `aoConfirmar` às duas rotas (a transação
própria e o gancho da aprovação em `decideCustomerRequestTransaction`), e a
callable `confirmEventEdition` confere a proposta no bucket antes da
transação (`depsDoPreco`, com o `bucketDosEventos()` da parte 3) e passa o
`gravarPreco` como a escrita a mais da mesma transação: um recibo, dois
eventos. No app, o preço só existe na tela de quem lê valores
(`canSeeCatalogPrice`): o `wms` não assina `client_event_prices` nem abre
`valores/`. O que falta para fechar é uma conta só, a `oQueFalta` de
`ficha.ts` (parte 8), que ganha o preço e as fotos do retorno; a agenda a
consome de lá. Só o retorno trava o fechamento.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin (Firestore e
Storage), `node --test` com o emulador; React, react-query, vitest, axe no
app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
preço fechado e o valor declarado", "A confirmação, o 'separar até' e o
preço", "Fotos e documentos" (o caminho `valores/`), "Os status e quem move
cada um" (`retornado` → `fechado`), "A edição, campo a campo", "As
callables" e "As telas" (a ficha e a agenda; a decisão 7). Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`.

## Global Constraints

As do índice. Nesta parte, ainda:

- Dinheiro só em `client_event_prices`: nem na edição, nem no payload, nem
  no `title`/`description` do evento (a linha "Confirmado e preço fechado
  R$ 9.800,00" da prancha vira dois eventos sem valor).
- O `wms` nunca lê o preço: a tela só assina `client_event_prices` e só
  mostra o bloco com `canSeeCatalogPrice(role)` (`lib/permissions.ts:44`);
  o "Faltam …" do `wms` não cita o preço.
- Em `confirmEventEdition`, a checagem de quem escreve valores fica entre o
  gate da coordenação e `assertEventosLiberado(PROJECT_ID)`: no emulador a
  liberação responde `failed-precondition` antes, e o caso 2 de
  `preco.integration.test.ts`, pela callable de verdade (`.run`), precisa
  ver o `permission-denied` do `interno` com `preco`. A `MATRIZ` não tem
  linha para isso: a `recusa` de cada linha é uma frase só, e o `wms`, o
  `financeiro`, o `suporte` e o `cliente` param antes, no gate, com
  `SO_COORDENACAO`.
- A proposta é conferida no bucket antes da transação; arquivo de outro
  tipo ou acima de 10 MiB é apagado e recusado, ausente recusa. Os
  documentos de valor só se acrescentam (`arrayUnion`); "Alterar" é a
  mesma callable.
- A fatura fica fora (decisão 6): a linha "Faturar · ao fechar a edição" da
  prancha não entra.

## Review Focus

1. O `wms` e o dinheiro: a regra de `valores/` (parte 3, que testa a
   recusa ao `wms`) aceita exatamente o arquivo que a callable aceita (T2);
   a ficha do `wms` não tem o bloco, nem o "R$" no cabeçalho, nem "Pedido
   confirmado e preço fechado" (T4).
2. O `interno` que manda `preco` no "Confirmar" recebe `permission-denied`
   "Só quem vê valores fecha o preço." e a edição continua `enviado` (T3).
3. A proposta que não chegou ao bucket recusa "A proposta não chegou ao
   armazenamento. Envie de novo." e nem o preço nem a confirmação gravam (T3).
4. Fechar em `no_evento` recusa "Registre o retorno antes de fechar a
   edição."; em `retornado` com momentos sem registro e sem preço fecha, e
   antes a ficha do `wms`, com a foto do retorno, dizia "Faltam desmontagem
   e entrega de volta" (T3, T4).
5. O clique duplo em "Fechar edição": a mesma chave devolve o mesmo
   resultado e há um só `evento.edicao_fechada` (T3).

---

### Task 1: `preco.ts`, o preço, a proposta e o fechamento

**Files:**
- Create: `functions/wms/src/domain/eventos/preco.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`, parte 2: `fechado_cents` → "o preço fechado", `fechado_observacao` → "A observação do preço", `proposta.arquivo` → "O arquivo da proposta", `proposta.nome` → "o nome da proposta")
- Test: `functions/wms/src/domain/eventos/preco.test.ts` (`test:unit`, depois de `lib/domain/eventos/edicao.test.js`)
- Modify: `functions/wms/package.json`

**Interfaces:**
- Consumes: `STATUS_DA_EDICAO`, `type StatusDaEdicao` (`./dominio.js`, parte 1); `entradaDe`, `viewDaEdicao`, `type EdicaoView` (`./edicao.js`), `PRECOS_COLLECTION`, `OPERATIONS_COLLECTION`, `type ActorRef = { uid: string; name: string | null; role: string }` e `actorRef(actor: OperationalActor): ActorRef` (`./edicao-gravacao.js`, sem cópia local), `createEventoEvent` (`./eventos-auditoria.js`) (parte 2); `type ArquivoNoBucket`, `type BucketDosEventos`, `codigoDaEdicao(db, editionId, actor)` (`./arquivos.js`, parte 3); `lerEdicao(transaction, db, editionId)` (`./momentos.js`, parte 8); `OperationalActor`, `OperationalEventSummary` (`../operations.js`); o `digest` local (sha256 hex, `count-rounds.ts`).
- Produces:
  - `LIMITE_DO_PRECO_CENTS = 1_000_000_000_00`, `ARQUIVO_DE_VALORES = /^dc_[a-f0-9]{16}\.(pdf|jpg|png|webp)$/`, `TIPOS_DE_VALORES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const`, `TAMANHO_DA_PROPOSTA = 10 * 1024 * 1024`.
  - Schemas `.strict()`: `PropostaSchema { arquivo: ARQUIVO_DE_VALORES, nome: 1..120 }`; `PrecoSchema { fechado_cents: int 0..LIMITE_DO_PRECO_CENTS, fechado_observacao: ≤500 nullish, proposta: PropostaSchema.nullish() }`; `FecharPrecoSchema = PrecoSchema.extend({ edition_id: 1..120, idempotency_key: 8..200 })`; `FecharEdicaoSchema { edition_id, idempotency_key }`; tipos `Proposta`, `Preco`, `FecharPreco`, `FecharEdicao`.
  - `ESCREVEM_VALORES = ["owner", "admin", "financeiro"] as const` (a lista de `requireBillingWrite`, `index.ts:1470-1477`, que não é exportada); `escreveValores(role: string): boolean`; `assertPrecoDeQuemEscreveValores(role: string, raw: unknown): void` — `HttpsError("permission-denied", "Só quem vê valores fecha o preço.")` quando `raw` traz `preco` não nulo e o papel não escreve valores.
  - `problemaParaFecharPreco(status: StatusDaEdicao): string | null` — `rascunho`, `enviado` → "O preço se fecha a partir da confirmação."; `fechado`, `cancelado` → "A edição já está fechada."; os outros, null. `problemaParaFechar(status): string | null` — `retornado` → null; `fechado`, `cancelado` → "A edição já está fechada."; os outros → "Registre o retorno antes de fechar a edição.".
  - `caminhoDeValores(customerCode, editionId, arquivo): string` = `eventos/${code}/${edition}/valores/${arquivo}`; `problemaDaProposta(arquivo: ArquivoNoBucket | null): { mensagem: string; apagar: boolean } | null` (a forma de `problemaDoDocumento` da parte 3): null → "A proposta não chegou ao armazenamento. Envie de novo." (`apagar: false`); tipo fora de `TIPOS_DE_VALORES` → "A proposta precisa ser PDF ou imagem." (`true`); `size > TAMANHO_DA_PROPOSTA` → "A proposta passa de 10 MB." (`true`).
  - `type DocumentoDoPreco = { id: string; caminho: string; nome: string; tipo: string; tamanho: number; registrado_por: ActorRef; registrado_em: string }` (`id` = o arquivo sem a extensão).
  - `prepararProposta(db, { edition_id, proposta }: { edition_id: string; proposta?: Proposta | null }, actor, bucket: BucketDosEventos): Promise<{ customerCode: string; proposta: DocumentoDoPreco | null }>` — `codigoDaEdicao`, `bucket.conferir(caminhoDeValores(...))`, `problemaDaProposta`: com `apagar`, `bucket.apagar` e `invalid-argument`; ausente, `failed-precondition`. Roda antes da transação, na confirmação (por `depsDoPreco`, T3) e no preço.
  - `gravarPreco(transaction, db, { editionId, customerCode, descricao, preco, proposta, actor }: { editionId: string; customerCode: string; descricao: string; preco: Preco; proposta: DocumentoDoPreco | null; actor: OperationalActor }): OperationalEventSummary` — `transaction.set(precoRef, { customer_code, fechado_cents, fechado_observacao, fechado_por: actorRef(actor), fechado_em: serverTimestamp, updated_at: serverTimestamp, documentos: arrayUnion(proposta) quando há }, { merge: true })` (sem leitura: cabe depois das escritas da confirmação, inclusive as da aprovação do pedido na parte 7) e devolve o `createEventoEvent(evento.preco_fechado, { edition_id })`: a forma do `aoConfirmar` da parte 7.
  - `setEventEditionPriceTransaction(db, input: FecharPreco, actor, bucket): Promise<{ id: string; fechado_cents: number; proposta: string | null }>` — `prepararProposta`; recibo `op_evento_price_<digest({ customer, nonce: idempotency_key })>`, `kind: "evento.price"` (mesma chave e `input_hash` → o mesmo resultado; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."); `lerEdicao`; `problemaParaFecharPreco` → `failed-precondition`; `gravarPreco`; `proposta` = o `id` do documento ou null.
  - `closeEventEditionTransaction(db, input: FecharEdicao, actor): Promise<{ id: string; status: "fechado"; edicao: number }>` — recibo `op_evento_close_<digest>`, `kind: "evento.close"`; `lerEdicao`; `problemaParaFechar` → `failed-precondition`; grava `status: "fechado"`, `fechada_em`, `edicao + 1`, `updated_*`; evento `evento.edicao_fechada { edition_id }`.

- [ ] **Step 1: Write the failing test**

`preco.test.ts` (node:test, puro; `base(extra)` = `{ edition_id: "ced_0123456789abcdef", idempotency_key: "preco-teste-1", fechado_cents: 980000, ...extra }`; `recusa(fn, code, message)` confere o `HttpsError`):

```ts
it("a entrada do preço recusa por campo", () => {
  recusa(() => entradaDe(FecharPrecoSchema, base({ fechado_cents: undefined })), "invalid-argument", "Informe o preço fechado");
  recusa(() => entradaDe(FecharPrecoSchema, base({ fechado_observacao: "x".repeat(501) })), "invalid-argument", "A observação do preço passa de 500 caracteres");
  recusa(() => entradaDe(FecharPrecoSchema, base({ proposta: { arquivo: "proposta.pdf", nome: "Proposta" } })), "invalid-argument", "O arquivo da proposta inválido");
  assert.equal(entradaDe(FecharPrecoSchema, base({})).fechado_cents, 980000);
});
it("só owner, admin e financeiro escrevem valores; o preco de quem não escreve é permission-denied", () => {
  assert.deepEqual(["owner", "admin", "financeiro", "interno", "wms", "suporte", "cliente"].map(escreveValores), [true, true, true, false, false, false, false]);
  recusa(() => assertPrecoDeQuemEscreveValores("interno", { preco: { fechado_cents: 980000 } }), "permission-denied", "Só quem vê valores fecha o preço.");
  assert.doesNotThrow(() => assertPrecoDeQuemEscreveValores("interno", { separar_ate: "2027-01-26" }));
  assert.doesNotThrow(() => assertPrecoDeQuemEscreveValores("admin", { preco: { fechado_cents: 980000 } }));
});
it("o preço se fecha de confirmado a retornado; a edição só se fecha retornada", () => {
  const CONFIRMA = "O preço se fecha a partir da confirmação.", FECHADA = "A edição já está fechada.", RETORNO = "Registre o retorno antes de fechar a edição.";
  assert.deepEqual(STATUS_DA_EDICAO.map(problemaParaFecharPreco), [CONFIRMA, CONFIRMA, null, null, null, null, FECHADA, FECHADA]);
  assert.deepEqual(STATUS_DA_EDICAO.map(problemaParaFechar), [RETORNO, RETORNO, RETORNO, RETORNO, RETORNO, null, FECHADA, FECHADA]);
});
it("a proposta no bucket: ausente recusa sem apagar; outro tipo ou acima de 10 MB apaga e recusa", () => {
  assert.deepEqual(problemaDaProposta(null), { mensagem: "A proposta não chegou ao armazenamento. Envie de novo.", apagar: false });
  assert.deepEqual(problemaDaProposta({ contentType: "application/zip", size: 10 }), { mensagem: "A proposta precisa ser PDF ou imagem.", apagar: true });
  assert.deepEqual(problemaDaProposta({ contentType: "application/pdf", size: TAMANHO_DA_PROPOSTA + 1 }), { mensagem: "A proposta passa de 10 MB.", apagar: true });
  assert.equal(problemaDaProposta({ contentType: "application/pdf", size: TAMANHO_DA_PROPOSTA }), null);
  assert.equal(caminhoDeValores("BTG", "ced_0123456789abcdef", "dc_0000000000000001.pdf"), "eventos/BTG/ced_0123456789abcdef/valores/dc_0000000000000001.pdf");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/preco.test.js`
Expected: FAIL (`./preco.js` não existe).

- [ ] **Step 3: Implement `preco.ts`, the four `ROTULO_DO_CAMPO` entries and register the test in `test:unit`**

Uma `db.runTransaction` por transação, as leituras antes das escritas,
`FieldValue.serverTimestamp()` nos carimbos.

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2, mais `node --test lib/domain/eventos/edicao.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/preco.ts functions/wms/src/domain/eventos/preco.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/package.json
git commit -m "feat(wms): o preço fechado, a proposta e o fechamento da edição do evento"
```

### Task 2: a paridade entre a regra de `valores/` e a callable do preço

**Files:**
- Test: `functions/wms/src/domain/eventos/preco.test.ts` (um `it` a mais)
- Modify: `functions/wms/src/domain/eventos/preco.ts` (só se uma constante de T1 divergir da regra)

A regra de `eventos/{code}/{edition}/valores/{arquivo}` e o teste dela no
emulador são da parte 3 (`storage.rules`, T1; `eventos-arquivos.rules.test.ts`,
casos 3 e 7: o `wms`, o interno, o suporte e o outro cliente não sobem nem
leem, e só PDF ou imagem entra): esta tarefa não muda nenhum dos dois e não
roda o emulador.

**Interfaces:**
- Consumes: o bloco `match /eventos/{code}/{edition}/valores/{arquivo}` de `storage.rules` (parte 3, T1: `arquivo.matches('^dc_[a-f0-9]{16}[.](pdf|jpg|png|webp)$')`, `request.resource.size <= 10 * 1024 * 1024`, `request.resource.contentType.matches('application/pdf|image/(jpeg|png|webp)')`); `ARQUIVO_DE_VALORES`, `TAMANHO_DA_PROPOSTA`, `TIPOS_DE_VALORES` (T1).
- Produces: a trava da paridade em `preco.test.ts`: a regra de `valores/` e a callable do preço aceitam o mesmo nome de arquivo, o mesmo tamanho e os mesmos tipos.

- [ ] **Step 1: Write the test**

Em `preco.test.ts`, a regra lida de `storage.rules` contra as constantes de T1:

```ts
it("a regra de valores/ aceita o mesmo arquivo que a callable", () => {
  const regras = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../storage.rules"), "utf8");
  const bloco = regras.slice(regras.indexOf("/valores/{arquivo}"), regras.indexOf("allow update, delete", regras.indexOf("/valores/{arquivo}")));
  assert.ok(bloco.includes(`arquivo.matches('${ARQUIVO_DE_VALORES.source.replace("\\.", "[.]")}')`));
  assert.ok(bloco.includes(`request.resource.size <= ${TAMANHO_DA_PROPOSTA / (1024 * 1024)} * 1024 * 1024`));
  const tipos = new RegExp(`^(?:${/contentType\.matches\('([^']+)'\)/.exec(bloco)?.[1]})$`);
  assert.ok(TIPOS_DE_VALORES.every((tipo) => tipos.test(tipo)));
  assert.equal(tipos.test("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), false);
});
```

- [ ] **Step 2: Run test to verify the parity**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/preco.test.js`
Expected: PASS se as constantes de T1 são as da regra da parte 3; FAIL onde divergirem.

- [ ] **Step 3: Align T1's constants with the rule, if they differ**

A regra segue a spec ("Fotos e documentos") e é da parte 3: a divergência
se corrige em `preco.ts`, nunca em `storage.rules` nem no teste. Se é a
regra que diverge da spec, o conserto é um PR da parte 3.

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/preco.ts functions/wms/src/domain/eventos/preco.test.ts
git commit -m "test(wms): a regra de valores/ aceita o mesmo arquivo que a callable do preço"
```

### Task 3: as callables, a matriz, o preço no "Confirmar" e os wrappers

**Files:**
- Modify: `functions/wms/src/index.ts` (o bloco `// Eventos`: a linha de `confirmEventEdition` da parte 7 ganha `assertPrecoDeQuemEscreveValores(profile.role, request.data)` entre `requireOperationsCoordinator(profile)` e `assertEventosLiberado(PROJECT_ID)`, passa a `entradaDe` o mapa `ROTULOS_DO_PRECO_NO_CONFIRMAR` e passa a `confirmEventEditionTransaction` os `deps` de `depsDoPreco(…, bucketDosEventos())`; duas linhas novas logo depois dela)
- Modify: `functions/wms/src/domain/eventos/confirmacao.ts` (parte 7: só `ConfirmarEdicaoSchema` ganha `preco`; a assinatura `confirmEventEditionTransaction(db, input, actor, deps: DepsDaConfirmacao = {})`, o `aoConfirmar` nas duas rotas e o `DecideCustomerRequestOptions` de `operations.ts` não mudam) e `functions/wms/src/domain/eventos/preco.ts` (T1: `depsDoPreco` e `ROTULOS_DO_PRECO_NO_CONFIRMAR`)
- Test: `functions/wms/src/domain/eventos/preco.test.ts` (um `it` a mais: a entrada do "Confirmar" com `ROTULOS_DO_PRECO_NO_CONFIRMAR`, como a callable lê)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (duas linhas na `MATRIZ`, `:80-294`: `setEventEditionPrice` e `closeEventEdition`; a de `confirmEventEdition` é da parte 7 e não muda, e a recusa do preço fica no caso 2 de `preco.integration.test.ts`)
- Create: `functions/wms/src/domain/eventos/preco.integration.test.ts` (`test:integration`, depois do teste de integração da parte 9)
- Modify: `functions/wms/package.json`
- Modify: `artifacts/app/src/lib/eventos/tipos.ts` (parte 2), `artifacts/app/src/lib/wms/eventos.ts`, `artifacts/app/src/lib/wms/eventos.test.ts`
- Create: `artifacts/app/src/lib/eventos/proposta.ts`, `artifacts/app/src/lib/eventos/proposta.test.ts`, `artifacts/app/src/features/eventos/campos-do-preco.tsx`
- Modify: `artifacts/app/src/features/eventos/confirmar-edicao-dialogo.tsx` e `artifacts/app/src/features/eventos/confirmar-edicao-dialogo.test.tsx` (o diálogo "Confirmar", parte 7: as props `preco`, `onPreco` e `progresso` e os campos do preço)
- Modify: `artifacts/app/src/pages/eventos.tsx`, `artifacts/app/src/pages/eventos-view.tsx`, `artifacts/app/src/pages/eventos-view.test.tsx`, `artifacts/app/src/pages/eventos.test.tsx` (a agenda, parte 7)

**Interfaces:**
- Consumes: T1; `getProfile` (`index.ts:1383`), `requireBillingWrite` (`:1470-1477`), `requireOperationsCoordinator` (`:1488-1495`), `PROJECT_ID`, `db`; `bucketDosEventos()` (`index.ts`, parte 3); de `./confirmacao.js` (parte 7), `ConfirmarEdicaoSchema`, `type ConfirmarEdicao`, `type EdicaoDoPedido = { ref: DocumentReference; id: string; view: EdicaoView }`, `type DepsDaConfirmacao = { aoConfirmar?: (transaction, db, edicao: EdicaoDoPedido, actor, occurredAt: string) => OperationalEventSummary | null }` e `confirmEventEditionTransaction(db, input, actor, deps: DepsDaConfirmacao = {})`, que chama o `aoConfirmar` nas duas rotas (na transação própria, depois das escritas; com pedido, por `DecideCustomerRequestOptions.eventEdition` até `confirmarEdicaoNaAprovacao`, dentro de `decideCustomerRequestTransaction`, com o recibo da decisão); `FATURA`, `SO_FATURA`, `COORDENACAO`, `SO_COORDENACAO` da matriz (`:43-66`); no teste, `sendEventEditionTransaction` (parte 2) e `criarSolicitacaoDaEdicao(db, actor)` (`./envio.js`, parte 6), para a edição com pedido do caso 9; no app, `semCamposVazios`, `erroDaCallable`, `functionsDoApp`, `firebaseApp`, `CALLABLES_DOS_EVENTOS`, `confirmarEdicao`, `type ConfirmarEdicao` (partes 2 e 7); `canSeeCatalogPrice` (`lib/permissions.ts:44`); `paraDecimal` (`lib/comercial/montar.ts:58-87`), `lerDecimal` (`@workspace/dominio`, `lib/dominio/src/dinheiro.ts:89`); `nomeDoArquivo("dc", tipo)` (`lib/eventos/arquivos.ts`, parte 3); `compactarFoto`, `enviarComProgresso` (`lib/envio-de-fotos.ts`), `firebaseStorage`; `ConfirmarEdicaoDialogo({ linha, separarAte, onSepararAte, estado, erro, onConfirmar, onFechar })` (`features/eventos/confirmar-edicao-dialogo.tsx`), `EventosView` e `PaginaEventos` (parte 7: `podeConfirmar`, `confirmacao: Parameters<typeof ConfirmarEdicaoDialogo>[0] | null`); `textosForaDaLista`, `violacoesDeAcessibilidade` (`src/test/`).
- Produces (Functions):
  - `export const confirmEventEdition = onCall(async (request) => { const profile = await getProfile(request); requireOperationsCoordinator(profile); assertPrecoDeQuemEscreveValores(profile.role, request.data); assertEventosLiberado(PROJECT_ID); const input = entradaDe(ConfirmarEdicaoSchema, request.data ?? {}, ROTULOS_DO_PRECO_NO_CONFIRMAR); return confirmEventEditionTransaction(db, input, profile, await depsDoPreco(db, input, profile, bucketDosEventos())); });` (a linha da parte 7, com a checagem do preço, o mapa dos rótulos e os `deps`, nesta ordem: o gate da coordenação, a checagem do preço e só então a liberação).
  - `export const setEventEditionPrice = onCall(async (request) => { const profile = await getProfile(request); requireBillingWrite(profile); assertEventosLiberado(PROJECT_ID); return setEventEditionPriceTransaction(db, entradaDe(FecharPrecoSchema, request.data ?? {}), profile, bucketDosEventos()); });`. O `financeiro` passa no gate, mas na v1 não tem tela para o preço (a spec, "A confirmação, o 'separar até' e o preço"): não lê a edição (`canReadOperations` não o inclui) nem abre `/eventos` e `/eventos/edicao` (`WMS_ROLES`); owner e admin fecham e alteram pela ficha (T4). As regras da parte 1 e o `ROUTE_ACCESS` das partes 7 e 8 não mudam.
  - `export const closeEventEdition = onCall(async (request) => { const profile = await getProfile(request); requireOperationsCoordinator(profile); assertEventosLiberado(PROJECT_ID); return closeEventEditionTransaction(db, entradaDe(FecharEdicaoSchema, request.data ?? {}), profile); });`
  - `ConfirmarEdicaoSchema` com `preco: PrecoSchema.nullish()`. Em `preco.ts`, `depsDoPreco(db, input: ConfirmarEdicao, actor: OperationalActor, bucket: BucketDosEventos): Promise<DepsDaConfirmacao>` — sem `input.preco`, `{}`, sem tocar o bucket; com ele, `prepararProposta(db, { edition_id: input.id, proposta: input.preco.proposta }, actor, bucket)` antes da transação e `{ aoConfirmar: (transaction, db, edicao, actor) => gravarPreco(transaction, db, { editionId: edicao.id, customerCode: edicao.view.customer_code, descricao, preco: input.preco, proposta, actor }) }`, com a `descricao` "<nome do evento> · <label>" da `edicao.view`; o `aoConfirmar` devolve o resumo do `evento.preco_fechado` (o `OperationalEventSummary` que `gravarPreco` devolve, nunca null), para o evento entrar na lista de eventos de cada rota, ao lado do `evento.edicao_confirmada` (com pedido, os `eventos` de `confirmarEdicaoNaAprovacao`, que vão aos `events` do resultado e do recibo da decisão); os tipos de `./confirmacao.js` entram por `import type` (o `confirmacao.ts` importa `PrecoSchema` daqui). Nada de `preco` em `DecideCustomerRequestOptions`, nada de `bucket` nos `deps`: um recibo (o da transação própria ou o da decisão do pedido), dois eventos (`evento.edicao_confirmada`, `evento.preco_fechado`). Também em `preco.ts`, `ROTULOS_DO_PRECO_NO_CONFIRMAR: Record<string, string> = { "preco.fechado_cents": "O preço fechado", "preco.fechado_observacao": "A observação do preço", "preco.proposta": "A proposta", "preco.proposta.nome": "O nome da proposta" }`, o mapa por chamada que a callable passa a `entradaDe`: os caminhos do `preco` de `ConfirmarEdicaoSchema` não estão em `ROTULO_DO_CAMPO`, que T1 deu aos de `FecharPrecoSchema`. As três chaves valem por prefixo: o `mensagemDoCampo` da parte 2 acha o rótulo pela chave mais longa que é prefixo do caminho da issue, primeiro neste mapa e depois em `ROTULO_DO_CAMPO`, então `preco.proposta` cobre `preco.proposta.arquivo`, e o arquivo fora de `ARQUIVO_DE_VALORES` recusa "A proposta inválida" (o adjetivo concorda com o artigo do rótulo); em "Informe <rótulo>", a inicial do rótulo vai em minúscula ("Informe o preço fechado").
  - Linhas da `MATRIZ`: `setEventEditionPrice: { passam: FATURA, recusa: SO_FATURA }` e `closeEventEdition: { passam: COORDENACAO, recusa: SO_COORDENACAO }`. Sem a linha `confirmEventEdition:preco` e sem `SO_FECHA_PRECO`: a `recusa` de uma linha é uma frase só, e com `preco` o `wms`, o `financeiro`, o `suporte` e o `cliente` recebem `SO_COORDENACAO` no gate, e só o `interno` chega a "Só quem vê valores fecha o preço."; essa recusa é o caso 2 de `preco.integration.test.ts`, pelo `.run`. A linha `confirmEventEdition` da parte 7 não muda: a entrada dela não tem `preco`, e o `interno` passa da checagem do preço.
- Produces (app):
  - `lib/eventos/tipos.ts`: `Proposta`, `Preco`, `FecharPreco`, `FecharEdicao` (espelhos de T1); `ConfirmarEdicao` ganha `preco?: Preco`; `DocumentoDoPreco`; `PrecoView = { valor_declarado_cents: number | null; fechado_cents: number | null; fechado_observacao: string | null; fechado_por: { uid: string; name: string | null; role: string } | null; fechado_em: string | null; documentos: DocumentoDoPreco[] }`.
  - `lib/wms/eventos.ts`: `fecharPreco(entrada: FecharPreco): Promise<{ id: string; fechado_cents: number; proposta: string | null }>`, `fecharEdicao(entrada: FecharEdicao): Promise<{ id: string; status: "fechado"; edicao: number }>`; `CALLABLES_DOS_EVENTOS` ganha `"setEventEditionPrice"` e `"closeEventEdition"`.
  - `lib/eventos/proposta.ts`: `centavosDoPreco(texto: string): number | null` (`paraDecimal` e `lerDecimal(…, 2)`; negativo, três casas ou texto → null); `nomeDaProposta(tipo: string): string | null` (`nomeDoArquivo("dc", tipo)` só para PDF e imagem; a planilha → null); `caminhoDeValores(code, edition, arquivo)`; `subirProposta(arquivo: File, alvo: { customer_code: string; edition_id: string }, aoProgredir?: (fracao: number) => void): Promise<Proposta>` (imagem por `compactarFoto`, PDF como está, `enviarComProgresso`; tipo fora → `Error("A proposta precisa ser PDF ou imagem.")`).
  - `features/eventos/campos-do-preco.tsx`: `type ValorDoPreco = { preco: string; cobre: string; proposta: File | null }`, `PRECO_VAZIO`; `CamposDoPreco({ valor, aoMudar, ocupado, erro, progresso })` com "Preço fechado" (`inputMode="decimal"`), "Cobre" (`maxLength` 500) e "Proposta" (`accept="application/pdf,image/*"`); `precoDosCampos(valor): { preco: Preco | null; erro: string | null }` ("Informe o preço fechado" quando digitado e não vira centavos; vazio → `preco: null`); `rotuloDoConfirmar(escreveValores: boolean)` = "Confirmar e fechar preço" | "Confirmar".
  - `features/eventos/confirmar-edicao-dialogo.tsx` (o da parte 7): `ConfirmarEdicaoDialogo` ganha as props `preco: ValorDoPreco | null` (null para quem não escreve valores), `onPreco: (valor: ValorDoPreco) => void` e `progresso: number | null`; com `preco`, os `CamposDoPreco` (`valor: preco`, `aoMudar: onPreco`, `ocupado` com o `estado` em `andamento`, `erro` de `precoDosCampos(preco)`, `progresso`) logo depois de "Separar até" e o `BotaoDeAcao` com `rotuloDoConfirmar(true)`, "Confirmar e fechar preço"; com `preco: null`, o diálogo da parte 7, só o "separar até" e "Confirmar". A `confirmacao` de `EventosView` (`Parameters<typeof ConfirmarEdicaoDialogo>[0]`) ganha as três com ele.
  - `EventosView` ganha `escreveValores: boolean`: a ação da linha em "Para confirmar" usa `rotuloDoConfirmar(escreveValores)`. `PaginaEventos` dá ao diálogo `preco: null` a quem não escreve valores (`canSeeCatalogPrice`), sobe a proposta (`subirProposta`) e manda `preco` só quando digitado (`semCamposVazios`).

- [ ] **Step 1: Write the failing tests (Functions)**

Em `preco.test.ts`, com `ConfirmarEdicaoSchema` de `./confirmacao.js` (parte 7):

```ts
it("a entrada do Confirmar com preço diz o campo, com o mapa da callable", () => {
  const confirmar = (preco: unknown) => entradaDe(ConfirmarEdicaoSchema, { id: "ced_0123456789abcdef", expected_edicao: 3, idempotency_key: "confirma-teste-1", preco }, ROTULOS_DO_PRECO_NO_CONFIRMAR); // como a callable lê
  recusa(() => confirmar({ fechado_observacao: "Frete, equipe e montagem" }), "invalid-argument", "Informe o preço fechado");
  recusa(() => confirmar({ fechado_cents: 980000, fechado_observacao: "x".repeat(501) }), "invalid-argument", "A observação do preço passa de 500 caracteres");
  recusa(() => confirmar({ fechado_cents: 980000, proposta: { arquivo: "proposta.pdf", nome: "Proposta" } }), "invalid-argument", "A proposta inválida"); // preco.proposta.arquivo, pela chave preco.proposta
  assert.equal(confirmar({ fechado_cents: 980000 }).preco?.fechado_cents, 980000);
});
```

`preco.integration.test.ts`, com os atores (`cristiane`, `outraCliente` e `manoel`, o interno) e o `beforeEach` de `edicao.integration.test.ts` (parte 2), mais os dois que este teste declara, `leonardo` (`admin`) e `financeiro` (`financeiro`), a edição nascida por `saveEventEditionTransaction` e levada ao status do caso direto no documento (como o caso 10 da parte 2), o bucket falso da parte 3 (`noBucket`, `apagados`) com `dc_0000000000000001.pdf` (`{ contentType: "application/pdf", size: 1234 }`) e `eventsFor(id)`:

```ts
it("1. o admin confirma a edição sem pedido com o preço e a proposta: um recibo, dois eventos, o preço em client_event_prices e nada de valor na edição nem nos payloads", ...)
it("2. a callable recusa o interno com preco: permission-denied 'Só quem vê valores fecha o preço.' e a edição continua enviada; sem preco a recusa não é permission-denied, e a transação confirma a edição do interno", ...)
it("3. a proposta que não está no bucket recusa 'A proposta não chegou ao armazenamento. Envie de novo.' e nem o preço nem a confirmação gravam; o .zip é apagado e recusado", ...)
it("4. setEventEditionPrice do financeiro em confirmado grava fechado_cents, fechado_por e fechado_em; 'Alterar' com outra chave regrava e documentos ganha a segunda proposta", ...)
it("5. o preço em enviado recusa 'O preço se fecha a partir da confirmação.'; em fechado, 'A edição já está fechada.'", ...)
it("6. closeEventEdition em no_evento recusa 'Registre o retorno antes de fechar a edição.'; em retornado grava fechado, fechada_em, edicao + 1 e o evento edicao_fechada", ...)
it("7. a mesma chave de fechar devolve o mesmo e deixa um só evento; outra chave recusa 'A edição já está fechada.'; a mesma chave com outro conteúdo, already-exists", ...)
it("8. a edição que não existe é not-found 'Edição não encontrada.' no preço e no fechamento", ...)
it("9. com pedido, o admin confirma com o preço na mesma transação da aprovação: a solicitação aprovada, o pedido, a edição confirmada e o preço em client_event_prices, um recibo só (o da decisão, sem op_evento_confirm_) com evento.edicao_confirmada e evento.preco_fechado nos events; o aoConfirmar que recusa desfaz a aprovação", ...)
```

Os casos 1, 3 e 9 confirmam como a callable confirma, com `leonardo`: `const entrada = entradaDe(ConfirmarEdicaoSchema, raw, ROTULOS_DO_PRECO_NO_CONFIRMAR)` e `confirmEventEditionTransaction(db, entrada, leonardo, await depsDoPreco(db, entrada, leonardo, bucket))`. O caso 2 chama a callable pelo `.run`, como `callables-papeis` faz, e é ele, não a `MATRIZ`, que prova a recusa do preço: com `preco`, o `permission-denied` com a frase e a edição ainda `enviado`; sem `preco`, só que a recusa não é `permission-denied` (no emulador é o `failed-precondition` da liberação, "Eventos ainda não liberados neste ambiente."), e a confirmação do interno sem preço sai pela transação, com `manoel`. O caso 4 roda com o `financeiro`. O caso 9 semeia o estoque e envia a edição com pedido como `confirmacao.integration.test.ts` (parte 7): `warehouse_positions`, `stock_balances` e `customers` de `pick-progress.integration.test.ts` e `sendEventEditionTransaction(db, …, cristiane, { criarSolicitacao: criarSolicitacaoDaEdicao(db, cristiane) })`. Primeiro com um `aoConfirmar` que chama o de `depsDoPreco` e depois lança `HttpsError("failed-precondition", …)`, porque o `gravarPreco` não lê e não recusa sozinho: a recusa chega e nada fica (a solicitação `open`, a edição `enviado`, nenhum pedido, nada em `client_event_prices`). Depois com o de `depsDoPreco`: a aprovação, a confirmação e o preço numa transação, e o recibo da decisão (`op_decision_…`) guarda nos `events` o `evento.edicao_confirmada` e o `evento.preco_fechado`. Os outros, as transações. Na matriz, as duas linhas acima.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/preco.test.js; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/preco.integration.test.js lib/callables-papeis.integration.test.js"`
Expected: FAIL (as callables, `depsDoPreco`, `ROTULOS_DO_PRECO_NO_CONFIRMAR` e o `preco` de `ConfirmarEdicaoSchema` não existem; a matriz tem linhas sem callable).

- [ ] **Step 3: Implement the two callables, `depsDoPreco`, `ROTULOS_DO_PRECO_NO_CONFIRMAR`, the `preco` of `ConfirmarEdicaoSchema` and the price check in `confirmEventEdition`, and register the test**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `node --test lib/callables-auth.integration.test.js lib/domain/eventos/confirmacao.integration.test.js` no mesmo `emulators:exec`. Expected: PASS, com os casos 1 a 16 de `confirmacao.integration.test.ts` (parte 7) sem mudança: a assinatura com `deps` é a dela.

- [ ] **Step 5: Commit (Functions)**

```bash
git add functions/wms/src/index.ts functions/wms/src/domain/eventos/confirmacao.ts functions/wms/src/domain/eventos/preco.ts functions/wms/src/domain/eventos/preco.test.ts functions/wms/src/domain/eventos/preco.integration.test.ts functions/wms/src/callables-papeis.integration.test.ts functions/wms/package.json
git commit -m "feat(wms): setEventEditionPrice, closeEventEdition e o preço no confirmar da edição"
```

- [ ] **Step 6: Write the failing tests (app)**

`lib/wms/eventos.test.ts`: `fecharPreco` chama `httpsCallable(…, "setEventEditionPrice")` sem a chave `proposta` quando ela é `undefined`; `fecharEdicao` chama `"closeEventEdition"`; `CALLABLES_DOS_EVENTOS` tem os dois nomes (a trava de `platform-lists.test.ts` da parte 2 confere as duas linhas do `index.ts` sozinha). `lib/eventos/proposta.test.ts`: `centavosDoPreco("9.800,00") === 980000`, `("R$ 9.800") === 980000`, `("9800.5") === 980050`, `("abc")`, `("-1")` e `("9.800,005")` → null; `nomeDaProposta("application/pdf")` casa `/^dc_[a-f0-9]{16}\.pdf$/`, a planilha → null. `confirmar-edicao-dialogo.test.tsx` (o da parte 7, no molde dele): com `preco` (`PRECO_VAZIO`), o botão diz "Confirmar e fechar preço" e os três campos, "Preço fechado", "Cobre" e "Proposta", estão na tela, com `textosForaDaLista` igual a `[]` contra a lista da parte 7 mais esses quatro textos; com `preco: null`, "Confirmar" e nenhum deles; `violacoesDeAcessibilidade` igual a `[]` nos dois. `eventos-view.test.tsx`: com `escreveValores`, a ação de "Para confirmar" diz "Confirmar e fechar preço"; sem, "Confirmar"; `violacoesDeAcessibilidade` igual a `[]`. `eventos.test.tsx` (jsdom, parte 7): o admin que digita "9.800,00" e "Frete, equipe e montagem" chama `confirmarEdicao` com `preco: { fechado_cents: 980000, fechado_observacao: "Frete, equipe e montagem" }` e sem a chave `proposta`.

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/eventos/proposta.test.ts src/features/eventos/confirmar-edicao-dialogo.test.tsx src/pages/eventos-view.test.tsx src/pages/eventos.test.tsx`
Expected: FAIL.

- [ ] **Step 8: Implement the wrappers, the types, `proposta.ts`, `CamposDoPreco`, the price in `ConfirmarEdicaoDialogo` and the label in the agenda**

- [ ] **Step 9: Run tests to verify they pass**

Run: o comando do passo 7, mais `npx vitest run src/lib/platform-lists.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 10: Commit (app)**

```bash
git add artifacts/app/src/lib/eventos/tipos.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/proposta.ts artifacts/app/src/lib/eventos/proposta.test.ts artifacts/app/src/features/eventos/campos-do-preco.tsx artifacts/app/src/features/eventos/confirmar-edicao-dialogo.tsx artifacts/app/src/features/eventos/confirmar-edicao-dialogo.test.tsx artifacts/app/src/pages/eventos.tsx artifacts/app/src/pages/eventos-view.tsx artifacts/app/src/pages/eventos-view.test.tsx artifacts/app/src/pages/eventos.test.tsx
git commit -m "feat(app): o preço e a proposta no Confirmar de quem escreve valores"
```

### Task 4: o bloco do preço na ficha e o fechamento com o que falta

**Files:**
- Modify: `artifacts/app/src/lib/eventos/ficha.ts`, `ficha.test.ts` (parte 8, dona de `oQueFalta`: `oQueFalta(edicao, preco?)` com o preço e as fotos do retorno, numa conta só; a ação da linha "Fechar a edição"; no teste da parte 8, o `tudoFeito` e o `soEntregaDeVolta` ganham uma foto em `retorno_ao_estoque` e as asserções de `oQueFalta` dela continuam) e `artifacts/app/src/lib/eventos/agenda.ts`, `agenda.test.ts` (parte 7: `prazoDaLinha` e `linhaDaAgenda` com o preço, pela `oQueFalta` de `ficha.ts`)
- Create: `artifacts/app/src/lib/eventos/use-precos.ts`
- Create: `artifacts/app/src/features/eventos/preco-dialogo.tsx`, `artifacts/app/src/features/eventos/fechar-edicao-dialogo.tsx`, `artifacts/app/src/features/eventos/dialogos-do-fechamento.test.tsx`
- Modify: `artifacts/app/src/pages/evento.tsx`, `evento-view.tsx`, `evento-view.test.tsx` (a ficha, parte 8) e `artifacts/app/src/pages/eventos.tsx`, `eventos-view.tsx`, `eventos-view.test.tsx` (a agenda, parte 7)

**Interfaces:**
- Consumes: T3; `prazoDaLinha(view, hoje)`, `linhaDaAgenda(view, nomeDoCliente, hoje)`, `LinhaDaAgenda` (`lib/eventos/agenda.ts`, parte 7); `oQueFalta(edicao)`, `linhasDaFicha(edicao, papel)`, `LinhaDaFicha`, `podeEditarPrevisto` (`lib/eventos/ficha.ts`, parte 8); `PropsDaFicha`/`EventoView` (parte 8); `formatarReais` (`@workspace/dominio`, `dinheiro.ts:166`); `useDocumento` (`lib/operacao/leitura.ts:422-430`); `canSeeCatalogPrice`, `canDecideRequests` (`lib/permissions.ts:44`, `:53`); `BotaoDeAcao` (`components/ui/botao-de-acao.tsx:16-60`), `useTentativaDaEscrita`, `avisoDoErroDaEscrita`, `desfechoDoErro` (`lib/carregando/`); `useUrlsDasFotosComEstado` (`lib/operacao/use-urls-das-fotos.ts`); `CamposDoPreco`, `precoDosCampos`, `subirProposta`, `fecharPreco`, `fecharEdicao`.
- Produces:
  - `ficha.ts` (a conta da parte 8, estendida no mesmo arquivo): `oQueFalta(edicao, preco?: PrecoView | null): string | null` — uma conta só: os momentos sem `feito` (os nomes e a ordem da parte 8), depois "o preço fechado" (só com `preco !== undefined`, quem lê valores, e `fechado_cents` nulo), depois "as fotos do retorno" (com o `retorno_ao_estoque` registrado e nenhuma foto no `momento_id` dele): "Faltam o preço fechado e as fotos do retorno", "Faltam as fotos do retorno", "Falta o preço fechado"; `linhasDaFicha(edicao, papel, preco?)` passa o `preco` ao `dado` da linha "Fechar a edição" e dá a ela `acao: "fechar"` (`LinhaDaFicha["acao"]` ganha `"fechar"`) em `retornado` para owner, admin e interno, os papéis de `podeEditarPrevisto` (`ficha.ts` não importa `agenda.ts`, que importa `hrefDaFicha` e `oQueFalta` daqui). `agenda.ts`: `prazoDaLinha(view, hoje, preco?)` devolve, em `retornado`, a `oQueFalta(view, preco)` de `./ficha`, sem cópia; `linhaDaAgenda(view, nomeDoCliente, hoje, preco?)` repassa.
  - `use-precos.ts`: `precoLido(id: string, data: DocumentData): PrecoView | null` (carimbos em ISO); `usePrecoView(editionId: string | null, leValores: boolean)` = `useDocumento(leValores && editionId ? \`evento-preco:${editionId}\` : null, (db) => doc(db, "client_event_prices", editionId), precoLido)` (o `wms` nunca assina; o nome diz o que devolve, `PrecoView`, e não se repete com o tipo `PrecoDaEdicao`, da parte 4, nem com `precoDoPortal`, da parte 11); `usePrecosDasEdicoes(ids: readonly string[], leValores: boolean): { precos: Record<string, PrecoView>; lendo: boolean }` — react-query, `getDocs` com `where(documentId(), "in", bloco)` em blocos de 30 (só igualdade: sem índice composto; leitura direta, fora de `CONSULTAS_DAS_TELAS`).
  - `PrecoDialogo({ edicao, preco, aberto, aoFechar })`: título "Preço fechado", `CamposDoPreco` pré-preenchidos, o `BotaoDeAcao` "Fechar preço" ("Fechando preço…"), "Voltar"; `subirProposta` e `fecharPreco` com a chave de `useTentativaDaEscrita` (a nova tentativa repete a chave); não fecha em andamento; toast "Preço fechado". `FecharEdicaoDialogo({ edicao, falta, aberto, aoFechar })`: título "Fechar a edição", a linha `falta` quando há, o `BotaoDeAcao` "Fechar edição" ("Fechando…"), "Voltar"; `fecharEdicao`; toast "Edição fechada".
  - `PropsDaFicha` ganha `preco?: PrecoView | null` (`undefined` = não lê valores; `null` = sem documento), `fecha: boolean`, `onFecharPreco()`, `onFecharEdicao()`. Na ficha: o cabeçalho com "· R$ 9.800,00" no fim quando há `fechado_cents`; o passo 1 "Pedido confirmado e preço fechado" com a linha "R$ 9.800,00 · proposta anexa" (só o valor sem proposta; sem preço, "Pedido confirmado"); a linha "Fechar a edição" com o `BotaoDeAcao` "Fechar edição" quando `acao === "fechar"` e `fecha`; o bloco "Preço fechado" (só com `preco !== undefined`), entre o retorno e as fotos: "Alterar" (ou "Fechar preço" sem preço, de `confirmado` a `retornado`), "R$ 9.800,00" (ou "Sem preço fechado"), "Cobre" com a observação, "Proposta" com o nome, que abre pelo `getDownloadURL`, "Fechado por" com "Guilherme · 05/12/2026". `EventosView` ganha `precos?: Record<string, PrecoView>`: as linhas de "Próximos" e "Para fechar" com "· R$ 6.200,00" para quem lê valores, e o `prazo` de "Para fechar" já chega na `LinhaDaAgenda`, de `linhaDaAgenda(view, nome, hoje, preco)`.

- [ ] **Step 1: Write the failing tests**

`ficha.test.ts` (o da parte 8: o `tudoFeito` e o `soEntregaDeVolta` ganham uma foto em `retorno_ao_estoque`, e `oQueFalta(necton)`, `oQueFalta(soEntregaDeVolta)` e `oQueFalta(tudoFeito)` continuam como a parte 8 os escreveu; a Necton, em `no_evento`, não tem o `retorno_ao_estoque` registrado, e as fotos do retorno só contam com ele):

```ts
it("o preço em branco só entra para quem lê valores, antes das fotos do retorno", () => {
  expect(oQueFalta(retornada(), { ...PRECO, fechado_cents: null })).toBe("Faltam o preço fechado e as fotos do retorno");
  expect(oQueFalta(retornada(), undefined)).toBe("Faltam as fotos do retorno");
  expect(oQueFalta(retornada({ fotoDoRetorno: true }), { ...PRECO, fechado_cents: null })).toBe("Falta o preço fechado");
  expect(oQueFalta(retornada({ fotoDoRetorno: true }), PRECO)).toBeNull();
});
it("a linha Fechar a edição tem a ação só em retornado e só para quem confirma", () => {
  expect(linhasDaFicha(retornada(), "admin", PRECO).at(-1)?.acao).toBe("fechar");
  expect(linhasDaFicha(retornada(), "wms", undefined).at(-1)?.acao).toBeNull();
  expect(linhasDaFicha(necton(), "admin", PRECO).at(-1)?.acao).toBeNull();
});
```

`agenda.test.ts`: `prazoDaLinha(retornada(), hoje, { ...PRECO, fechado_cents: null })` é "Faltam o preço fechado e as fotos do retorno" e `prazoDaLinha(retornada(), hoje)`, "Faltam as fotos do retorno" (a conta de `ficha.ts`, sem cópia).

`evento-view.test.tsx` (no molde do arquivo): para `admin` com `preco`, a lista ganha "BTG Pactual · edição 2027 · 28 e 29/01 · Hotel Unique · PED-0007 separado · lacre 88412 · R$ 9.800,00", "Pedido confirmado e preço fechado", "R$ 9.800,00 · proposta anexa", "Preço fechado", "Alterar", "R$ 9.800,00", "Cobre", "Frete, equipe e montagem", "Proposta", "proposta-necton-2027.pdf", "Fechado por", "Guilherme · 05/12/2026"; para `wms` (`preco` ausente), nenhum texto com "R$", "Preço fechado", "Proposta", "Fechado por" ou "Alterar", o cabeçalho acaba em "lacre 88412" e o passo 1 é "Pedido confirmado"; a Necton em `retornado` para `admin` tem "Fechar edição" e para `wms` não; `violacoesDeAcessibilidade` igual a `[]`. `eventos-view.test.tsx`: "Para fechar" diz "Faltam o preço fechado e as fotos do retorno" com `precos` e "Faltam as fotos do retorno" sem; a linha de "Próximos" leva "R$ 6.200,00" só com `precos`. `dialogos-do-fechamento.test.tsx` (jsdom, como `pedidos.dialogos.test.tsx`): o "Fechar preço" fica "Fechando preço…" e o Esc não fecha enquanto a callable não responde; a callable recebe `fechado_cents: 980000` e, na nova tentativa, a mesma `idempotency_key`; o "Fechar edição" idem com `closeEventEdition`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/agenda.test.ts src/lib/eventos/ficha.test.ts src/features/eventos/dialogos-do-fechamento.test.tsx src/pages/evento-view.test.tsx src/pages/eventos-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the price in `oQueFalta`, `use-precos.ts`, the two dialogs, and the price and the closing in the ficha and in the agenda**

`pages/evento.tsx` lê o preço por `usePrecoView(id, canSeeCatalogPrice(role))` e passa `preco` só quando lê valores, `fecha = canDecideRequests(role)`; `pages/eventos.tsx`, `usePrecosDasEdicoes` com os ids das linhas em tela, e a `linhaDaAgenda` de cada edição recebe `precos[id] ?? null` de quem lê valores e nada (`undefined`) para o `wms`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/carregando/trava.test.ts src/lib/theme-colors.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/eventos/agenda.test.ts artifacts/app/src/lib/eventos/ficha.ts artifacts/app/src/lib/eventos/ficha.test.ts artifacts/app/src/lib/eventos/use-precos.ts artifacts/app/src/features/eventos/preco-dialogo.tsx artifacts/app/src/features/eventos/fechar-edicao-dialogo.tsx artifacts/app/src/features/eventos/dialogos-do-fechamento.test.tsx artifacts/app/src/pages/evento.tsx artifacts/app/src/pages/evento-view.tsx artifacts/app/src/pages/evento-view.test.tsx artifacts/app/src/pages/eventos.tsx artifacts/app/src/pages/eventos-view.tsx artifacts/app/src/pages/eventos-view.test.tsx
git commit -m "feat(app): o preço fechado e o fechamento da edição na ficha e na agenda"
```

### Task 5: "Edição para fechar" no Início

**Files:**
- Modify: `artifacts/app/src/lib/eventos/agenda.ts` (`edicoesRetornadas`, ao lado de `edicoesEnviadas`)
- Modify: `artifacts/app/src/lib/home-inbox.ts` (`buildHomeInbox`, `:104-300`), `artifacts/app/src/lib/inicio-do-wms.ts` (`ICONE_DO_ITEM`, `:12-21`), `artifacts/app/src/lib/use-inicio-do-wms.ts` (a terceira leitura, ao lado das de `para-confirmar` e `em-andamento`, partes 7 e 9, concatenada a elas em `eventEditions`)
- Test: `artifacts/app/src/lib/home-inbox.test.ts`, `artifacts/app/src/pages/home-view.test.tsx` (o `it("cada item tem o ícone do que é")`)

**Interfaces:**
- Consumes: `buildHomeInbox({ eventEditions })`, `HomeEventEdition` com `status: StatusDaEdicao` (nasce com ele), o item `event-editions` só com `status === "enviado"` (o filtro que já deixa a retornada de fora), `edicoesEnviadas()` (cada documento por `edicaoDaLeitura`, com o `status`), `consultaDaAgenda(db, "para_fechar")`, `CONFIRMA_EDICAO_ROLES`, `useInicioDoWms` com `seesEventos` e a `useQuery(["eventos", "para-confirmar"])` (parte 7); o item `event-returns` (`status === "no_evento"`), `edicoesNoEvento()` e a `useQuery(["eventos", "em-andamento"])`, que a parte 9 só concatena às enviadas em `eventEditions`, sem mudar `HomeEventEdition` nem o item `event-editions` (parte 9); `edicaoDaLeitura(id, data)` (`lib/eventos/leitura.ts`, parte 4); `plural`, `listPreview`, `canAccessModule`; `CalendarCheck` (lucide-react).
- Produces: `edicoesRetornadas(): Promise<HomeEventEdition[]>` = `getDocs(consultaDaAgenda(firestore, "para_fechar"))`, cada documento por `edicaoDaLeitura` e na forma `{ id, event_name, label, customer_code, status }`, como `edicoesNoEvento` da parte 9; `buildHomeInbox({ …, eventEditions })`, sem parâmetro novo, acrescenta, logo depois de `event-returns`, só com `role` em `CONFIRMA_EDICAO_ROLES` e para as edições com `status === "retornado"`, `{ id: "event-closings", tone: "attention", title: "1 edição para fechar" | "N edições para fechar", detail: listPreview(["<cliente> · <evento> · <label>", …], 2), href: "/eventos", actionLabel: "Fechar" }`; `ICONE_DO_ITEM["event-closings"] = CalendarCheck`; em `useInicioDoWms`, `useQuery({ queryKey: ["eventos", "para-fechar"], queryFn: edicoesRetornadas, enabled: seesEventos, refetchInterval: 60_000, refetchOnWindowFocus: false })`, concatenada às enviadas e às no evento na mesma `eventEditions` (o Início lê as edições por uma lista só) e nas mesmas listas de `carregando`, `relendo`, `falhaSoNaReleitura`, `reler` e `falhas` ("eventos") da leitura de `para-confirmar`. O contador de Eventos no menu conta a linha pela `href` (`contadoresDoMenu`), sem mudança.

- [ ] **Step 1: Write the failing tests**

Em `home-inbox.test.ts`:

```ts
it("a edição retornada pede o fechamento a quem confirma, com o cliente, o evento e a edição; o wms e o suporte não a veem", () => {
  const retornada = { id: "ced_1", status: "retornado" as const, event_name: "Encontro de parceiros", label: "2026", customer_code: "BTG Pactual" };
  const eventEditions = [retornada, { ...retornada, id: "ced_3", status: "enviado" as const, event_name: "Feira" }];
  const { items } = buildHomeInbox({ role: "admin", eventEditions, agenteDoNucleo: false });
  expect(items.find((item) => item.id === "event-closings")).toEqual({ id: "event-closings", tone: "attention", title: "1 edição para fechar", detail: "BTG Pactual · Encontro de parceiros · 2026", href: "/eventos", actionLabel: "Fechar" });
  // a retornada não conta nos itens das partes 7 e 9
  expect(items.find((item) => item.id === "event-editions")?.title).toBe("1 evento para confirmar");
  expect(items.map((item) => item.id)).not.toContain("event-returns");
  for (const role of ["wms", "suporte"] as const) expect(buildHomeInbox({ role, eventEditions, agenteDoNucleo: false }).items.map((item) => item.id)).not.toContain("event-closings");
  expect(buildHomeInbox({ role: "interno", eventEditions: [retornada, { ...retornada, id: "ced_2", label: "2025" }], agenteDoNucleo: false }).items.find((item) => item.id === "event-closings")?.title).toBe("2 edições para fechar");
});
```

Em `home-view.test.tsx`: `itensDoInicioDoWms([{ ...ITENS[0], id: "event-closings" }])[0].icon.displayName` é `"CalendarCheck"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/home-inbox.test.ts src/pages/home-view.test.tsx`
Expected: FAIL (o item não existe).

- [ ] **Step 3: Implement the item, the icon and the read**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `npx vitest run src/lib/resumo-do-modulo.test.ts src/lib/eventos/agenda.test.ts` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/home-inbox.ts artifacts/app/src/lib/home-inbox.test.ts artifacts/app/src/lib/inicio-do-wms.ts artifacts/app/src/lib/use-inicio-do-wms.ts artifacts/app/src/pages/home-view.test.tsx
git commit -m "feat(app): \"Edição para fechar\" no Início da Armazenagem"
```

### Pronto quando

No emulador, pelos testes: o admin confirma a edição com o "separar até", o
preço de R$ 9.800,00 e a proposta (um recibo, dois eventos sem valor), sem
pedido e com ele (o preço na mesma transação da aprovação); o
financeiro altera o preço por `setEventEditionPrice` (sem tela na v1) e
acrescenta a segunda proposta; o `interno` com `preco` é recusado; o `wms`
não lê `client_event_prices`, não sobe nem abre `valores/` (as regras e os
testes das partes 1 e 3; aqui, a paridade de T2), e a ficha dele não tem o
bloco nem o "R$"; a edição em `retornado` fecha com "Faltam …" na ficha e
na agenda antes, e o Início de quem confirma dizia "1 edição para fechar".
`corepack pnpm run typecheck`, `test:unit` e `test:integration` do WMS e os
vitest tocados verdes; `git status` só com os arquivos desta parte. O PR
registra em `docs/superpowers/plans/2026-11-26-eventos.md` o que mudou de
nome, se mudou.
