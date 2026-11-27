# Eventos · parte 3: arquivos (Storage, documentos e fotos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o arquivo da edição no Storage e o registro dele na edição: os
quatro caminhos nas regras (fotos, documentos e valores da Dutelog; o anexo
do cliente), a conferência do objeto pelo Admin SDK, `attachEventDocument`,
`removeEventDocument` e `attachEventPhoto` com recibo e auditoria, e as
linhas da LGPD; ainda sem tela (os anexos do formulário na parte 4, as fotos
e os documentos da ficha na parte 8, a leitura no portal na parte 11).

**Architecture:** o navegador sobe pelo SDK sob o `storage.rules`, como a
foto da OS e o anexo da solicitação, e a callable confere o objeto no bucket
(`exists`, `contentType`, `size`) antes de gravar `documentos[]` ou `fotos[]`
na edição, numa transação com o recibo inline e o `createEventoEvent`. O
domínio em `functions/wms/src/domain/eventos/arquivos.ts` recebe o bucket
por dependência (`{ conferir, apagar }`, o molde de `attachPhotoFor` da
Operação); o `index.ts` o liga ao bucket de verdade. O arquivo errado é
apagado e recusado; o documento retirado sai do registro e o arquivo fica.

**Tech Stack:** regras do Firebase Storage, `@firebase/rules-unit-testing`
no emulador (Firestore, Storage e Auth), firebase-admin (`getStorage`), zod
(`genkit`), `node --test`; vitest no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções
"Fotos e documentos", "As callables" (`attachEventDocument`,
`removeEventDocument`, `attachEventPhoto`), "A edição, campo a campo"
(`documentos[]`, `fotos[]`), "Os status e quem move cada um" (o que ainda se
grava em `retornado`; nada em `fechado` e `cancelado`), "Eventos de
auditoria", "Documentação" (`lgpd.md`). Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`.

**O que mudou na execução (PR 651, 27/11/2026).** Vale sobre o texto
abaixo:

- Decisões 14 a 16 da spec (Leonardo, 27/11/2026: "aceito as duas
  decisões; sem retirada de foto por enquanto"): o anexo, a retirada e a
  foto não sobem a `edicao` (onde abaixo está `edicao + 1`, a resposta leva
  a `edicao` viva); do lado do cliente, quem tira o documento é a empresa
  (qualquer pessoa do cliente, em `rascunho` e `enviado`; a conferência do
  `registrado_por.uid` fica só para quem opera fora da coordenação); e não
  há retirada de foto.
- `ArquivoNoBucket` leva `generation?` e `apagar(caminho, generation)`
  apaga só a geração conferida (a spec: "apagado por geração"), pela
  `conferirNoBucket(bucket, caminho, problemaDe)`; `codigoDaEdicao` lê a
  edição também para o cliente (o de outro código recebe `not-found` antes
  do bucket); o `result` dos recibos dos anexos guarda só ids e contagens,
  e a repetição relê a edição.
- A matriz de papéis é alfabética: as três linhas entram na ordem da
  tabela. Os nove casos da integração (e o 10, o da decisão 14) foram
  escritos juntos, antes do código.

## Global Constraints

As do índice. Nesta parte, ainda:

- O `valores/` entra nas regras e no teste aqui (o índice põe os quatro
  caminhos na parte 3); a parte 10 só o usa (a proposta e
  `client_event_prices.documentos`). Nenhuma callable desta parte grava em
  `valores/` nem em `client_event_prices`.
- Os status: o cliente e a Dutelog anexam documento em qualquer status
  aberto (`edicaoAberta`, de `rascunho` a `retornado`; no rascunho, a
  Dutelog anexa o layout ou o comprovante que recebe por telefone), e o
  cliente tira só em `rascunho` e `enviado`; a foto entra só de
  `confirmado` a `retornado`, porque é foto da execução (a spec, em "As
  callables", e o índice dizem o mesmo); em `fechado` e `cancelado`, nada
  se grava.
- A conferência no bucket vem antes da transação e a transação relê a
  edição. A callable nunca recebe bytes: só o nome do arquivo.
- O `momento_id` do documento e a `legenda` e o `instante` da foto são
  `.optional()`, sem `.nullish()` (o `momento_id` da foto é obrigatório):
  o wrapper nunca manda `null` neles. A regra dos `null` é a do índice, em
  Global Constraints (a da spec, "Limites e mensagens"): só em campo que
  o schema do servidor declara nullish; a `legenda` é texto livre, mas
  não usa o `optionalText`.

## Review Focus

1. O `wms` lê `fotos/` e `docs/` e não lê nem cria em `valores/`; o cliente
   lê os quatro caminhos do próprio código e nenhum de outro (T2).
2. O `.pdf` cujo `contentType` no bucket é `text/html` é apagado antes da
   recusa; o documento retirado não é apagado do bucket (T5).
3. O clique duplo em "Anexar": a mesma chave devolve o mesmo registro, sem
   segunda entrada em `documentos[]`; o mesmo arquivo com outra chave recusa
   com `already-exists` (T5).
4. O cliente de outro código recebe `not-found` "Edição não encontrada." ao
   anexar e ao tirar (T5).
5. A conferência de verdade (`getStorage().bucket(documentBucketName())`)
   não roda em teste: depois de publicar no `dute-homolog`, um anexo pelo
   formulário (parte 4) prova que o bucket é o mesmo em que o SDK escreve (T4).

---

### Task 1: `storage.rules` com os quatro caminhos e os helpers

**Files:**
- Modify: `storage.rules` (os helpers `clienteComArmazenagem(code)` e `leValores()` depois de `clienteComOperacao`, linhas 164-170; os quatro `match` depois de `/portal/{code}/solicitacoes/{arquivo}`, linhas 172-182, antes do `/{allPaths=**}` da linha 188)
- Test: `functions/wms/src/eventos-arquivos.rules.test.ts` (os casos 1 a 4; T2 completa e registra)

**Interfaces:**
- Produces (regras; `isInternal()` e `canWritePhotos()` já existem, linhas 24-39):
  ```
  // Os arquivos da edição do evento (docs/superpowers/specs/2026-11-26-eventos-design.md,
  // "Fotos e documentos"): o espelho de clienteComOperacao com a armazenagem.
  function clienteComArmazenagem(code) {
    return hasProfile()
      && profileRole() == 'cliente'
      && firestore.get(userDoc()).data.get('customer_code', '') == code
      && 'wms' in modulosDoCliente(code)
      && portalDoClienteAtivo(code);
  }
  // Quem lê valores: a mesma lista de canReadPrices do firestore.rules.
  function leValores() {
    return hasProfile() && profileRole() in ['owner', 'admin', 'comercial', 'financeiro'];
  }
  match /eventos/{code}/{edition}/fotos/{arquivo} {
    allow read: if isInternal() || clienteComArmazenagem(code);
    allow create: if resource == null && canWritePhotos()
      && edition.matches('^ced_[a-f0-9]{16}$') && arquivo.matches('^ft_[a-f0-9]{16}[.](jpg|png|webp)$')
      && request.resource.size < 8 * 1024 * 1024 && request.resource.contentType.matches('image/(jpeg|png|webp)');
    allow update, delete: if false;
  }
  ```
  Os outros três `match` seguem o molde do de `fotos` (o `edition` sempre `^ced_[a-f0-9]{16}$`, `update` e `delete` sempre `false`), mudando só:

  | Caminho | `read` | `create` | `arquivo` | tamanho e `contentType` |
  |---|---|---|---|---|
  | `/eventos/{code}/{edition}/docs/{arquivo}` | `isInternal() \|\| clienteComArmazenagem(code)` | `canWritePhotos()` | `^dc_[a-f0-9]{16}[.](pdf\|jpg\|png\|webp\|xlsx)$` | `<= 10 * 1024 * 1024`; `application/pdf\|image/(jpeg\|png\|webp)\|application/vnd[.]openxmlformats-officedocument[.]spreadsheetml[.]sheet` |
  | `/eventos/{code}/{edition}/valores/{arquivo}` | `leValores() \|\| clienteComArmazenagem(code)` | `leValores()` | `^dc_[a-f0-9]{16}[.](pdf\|jpg\|png\|webp)$` | `<= 10 * 1024 * 1024`; `application/pdf\|image/(jpeg\|png\|webp)` |
  | `/portal/{code}/eventos/{edition}/{arquivo}` | `isInternal() \|\| clienteComArmazenagem(code)` | `clienteComArmazenagem(code)` | `^an_[a-f0-9]{16}[.](pdf\|jpg\|png\|webp\|xlsx)$` | os de `docs` |

- [ ] **Step 1: Write the failing test**

`eventos-arquivos.rules.test.ts`, a estrutura de `operacao-solicitacoes.rules.test.ts`
(`endereco`, `regras`, `PAPEIS` com os onze papéis; `client-itau` com
`client_access` `modules: ["wms", "financeiro"]`, `client-safra` com
`modules: ["operacao"]` (sem armazenagem) e `client-btg` sem `client_access`
(o padrão, com armazenagem); `EDICAO = "ced_0123456789abcdef"`;
`subir(uid, caminho, conteudo, contentType)`; nomes únicos por caso, porque o
emulador não limpa o bucket). Os quatro primeiros casos:

```ts
it("1. fotos e documentos da Dutelog: quem opera (owner, admin, interno, wms) sobe; financeiro, suporte, comercial, campo, o cliente e quem não logou não", ...)
// SOBEM em `eventos/ITAU/${EDICAO}/fotos/ft_<único>.jpg` (JPEG) e `.../docs/dc_<único>.pdf` (PDF); NAO_SOBEM e unauthenticatedContext: assertFails nos dois
it("2. fotos e documentos: a equipe interna (owner, admin, interno, wms, financeiro, suporte) e o próprio cliente leem; o outro cliente, o comercial e o campo não", ...)
it("3. valores: owner, admin, comercial e financeiro sobem e leem; o próprio cliente lê; wms, interno, suporte e o outro cliente não sobem nem leem", ...)
it("4. o anexo do portal: o cliente com armazenagem sobe no próprio código (o sem client_access também); o sem armazenagem, o outro código e a equipe não; a equipe interna e o próprio cliente leem", ...)
// client-itau sobe `portal/ITAU/eventos/${EDICAO}/an_<único>.pdf`; client-btg em BTG; client-safra não sobe em SAFRA; client-itau não sobe em SAFRA; owner-a, ops-a e wms-a não sobem; client-safra e client-btg não leem o do ITAU
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/eventos-arquivos.rules.test.js"`
Expected: FAIL (sem os `match`, tudo cai no `/{allPaths=**}`: as subidas e as leituras permitidas falham).

- [ ] **Step 3: Add the two helpers and the four `match` blocks**

O texto de Produces, nos lugares de Files; o comentário de cada bloco diz
quem sobe, quem lê e que "regravar é create" (`resource == null`).

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2 e, no mesmo `emulators:exec`,
`node --test lib/operacao-solicitacoes.rules.test.js lib/produto-fotos.rules.test.js lib/operacao-fotos.rules.test.js`.
Expected: PASS nos quatro casos; os três testes antigos continuam verdes.

- [ ] **Step 5: Commit**

```bash
git add storage.rules functions/wms/src/eventos-arquivos.rules.test.ts
git commit -m "feat(regras): os arquivos da edição do evento no Storage, por quem sobe e quem lê"
```

### Task 2: o teste das regras do Storage completo

**Files:**
- Test: `functions/wms/src/eventos-arquivos.rules.test.ts` (os casos 5 a 9)
- Modify: `functions/wms/package.json` (`test:integration`: `lib/eventos-arquivos.rules.test.js` depois de `lib/operacao-solicitacoes.rules.test.js`)

**Interfaces:**
- Consumes: as regras de T1.

- [ ] **Step 1: Write the remaining cases**

```ts
it("5. fotos: só ft_ com 16 hex e jpg, png ou webp, imagem, menos de 8 MiB; a edição fora de ced_<16 hex> recusa; regravar e apagar recusam", ...)
// assertFails: "foto.jpg"; "ft_<16>.gif" com image/gif; "ft_<16>.jpg" com application/pdf; new Uint8Array(8 * 1024 * 1024) (a regra é <); edição "ced_x"; o mesmo nome duas vezes (a segunda); ref(...).delete()
it("6. documentos: PDF, imagem ou .xlsx com o tipo da planilha, até 10 MiB; .xlsx com application/octet-stream, .exe e 10 MiB + 1 recusam; 10 MiB exatos sobem", ...)
it("7. valores: só PDF ou imagem; a planilha recusa, mesmo para quem lê valores", ...)
it("8. o anexo do portal: an_ com 16 hex, PDF, imagem ou planilha, até 10 MiB; nome fora do padrão, .exe, 10 MiB + 1, regravar e apagar recusam", ...)
it("9. com o portal desligado (arquivado ou \"Sem portal\"), o cliente não sobe nem lê o anexo nem a foto; a equipe continua lendo (pergunta 69)", ...)
// setDoc client_access/ITAU com portal_ativo: false depois de uma subida; assertFails para client-itau em put e getMetadata; assertSucceeds para ops-a
```

- [ ] **Step 2: Run the file**

Run: o `emulators:exec` do T1.
Expected: PASS quando as regras de T1 estão exatas; um FAIL aponta a regra a
corrigir (o `<` da foto, o `<=` do documento, o tipo da planilha, o padrão
da edição).

- [ ] **Step 3: Register the test and run the whole integration list once**

Run: `cd C:\DEV\Dute; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `firestore.rules.test.js` e `rh-arquivos.rules.test.js`
(o `/{allPaths=**}` continua fechando `rh/**`).

- [ ] **Step 4: Commit**

```bash
git add functions/wms/src/eventos-arquivos.rules.test.ts functions/wms/package.json
git commit -m "test(regras): os quatro caminhos dos Eventos no Storage, por nome, tipo, tamanho e portal"
```

### Task 3: `arquivos.ts`: a conferência, anexar e tirar o documento, anexar a foto

**Files:**
- Create: `functions/wms/src/domain/eventos/arquivos.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`: `edition_id` → "a edição", `arquivo` → "o arquivo", `nome` → "O nome do arquivo", `legenda` → "A legenda", `momento_id` → "o momento", `instante` → "o instante da foto", `documento_id` → "o documento")
- Test: `functions/wms/src/domain/eventos/arquivos.test.ts` (`test:unit`, depois de `lib/domain/eventos/edicao.test.js`)
- Test: `functions/wms/src/domain/eventos/arquivos.integration.test.ts` (os casos 1 a 3 de T5, para dirigir as transações)

**Interfaces:**
- Consumes: `LIMITES`, `edicaoAberta` de `./dominio.js`; `entradaDe` de `./edicao.js`; `lerEdicaoDoCliente(transaction, db, editionId, customerCode)`, `EDICOES_COLLECTION` (`"client_event_editions"`), `OPERATIONS_COLLECTION`, `actorRef(actor: OperationalActor): ActorRef` e `type ActorRef = { uid: string; name: string | null; role: string }` de `./edicao-gravacao.js` (parte 2); `createEventoEvent` de `./eventos-auditoria.js`; `OperationalActor` de `../operations.js`; o `digest` local (sha256 hex, como `count-rounds.ts`, linha 354).
- Produces:
  - `TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const`; `TIPOS_DE_DOCUMENTO = [...TIPOS_DE_FOTO, "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] as const`; `TAMANHO_DA_FOTO = 8 * 1024 * 1024` (a regra é `<`); `TAMANHO_DO_DOCUMENTO = 10 * 1024 * 1024` (`<=`); `ARQUIVO_DA_FOTO = /^ft_[a-f0-9]{16}\.(jpg|png|webp)$/`; `ARQUIVO_DO_DOCUMENTO = /^dc_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/`; `ARQUIVO_DO_ANEXO = /^an_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/`; `MOMENTO_ID = /^mo_[a-f0-9]{8}$/`.
  - `type OrigemDoDocumento = "cliente" | "dutelog"`; `type DocumentoDaEdicao = { id: string; caminho: string; nome: string; tipo: string; tamanho: number; origem: OrigemDoDocumento; momento_id: string | null; registrado_por: ActorRef; registrado_em: string }` (o `id` é o nome do arquivo sem a extensão; `tipo` e `tamanho` vêm do bucket); `type FotoDaEdicao = { id: string; caminho: string; momento_id: string; legenda: string | null; instante: string; registrado_por: ActorRef; registrado_em: string }`.
  - `type ArquivoNoBucket = { contentType: string; size: number }`; `type BucketDosEventos = { conferir: (caminho: string) => Promise<ArquivoNoBucket | null>; apagar: (caminho: string) => Promise<void> }`.
  - `caminhoDaFoto(customerCode: string, editionId: string, arquivo: string): string` = `eventos/${code}/${edition}/fotos/${arquivo}`; `caminhoDoDocumento(origem: OrigemDoDocumento, customerCode, editionId, arquivo): string` = `portal/${code}/eventos/${edition}/${arquivo}` para `cliente`, `eventos/${code}/${edition}/docs/${arquivo}` para `dutelog`.
  - `problemaDaFoto(arquivo: ArquivoNoBucket | null): { mensagem: string; apagar: boolean } | null`: `null` → "A foto não chegou ao armazenamento. Envie de novo." (`apagar: false`); tipo fora de `TIPOS_DE_FOTO` → "O arquivo enviado não é uma foto." (`apagar: true`); `size >= TAMANHO_DA_FOTO` → "A foto passa de 8 MB." (`true`). `problemaDoDocumento(arquivo)` igual, com "O arquivo não chegou ao armazenamento. Envie de novo.", "O arquivo enviado não é PDF, imagem nem planilha." e, acima de `TAMANHO_DO_DOCUMENTO`, "O documento passa de 10 MB.".
  - `problemaParaAnexarDocumento(status: string): string | null`: fora de `edicaoAberta` → "A edição já está fechada." (a mesma janela para o cliente e para a Dutelog, de `rascunho` a `retornado`). `problemaParaAnexarFoto(status): string | null`: fora de `edicaoAberta` → "A edição já está fechada."; `rascunho` ou `enviado` → "A edição ainda não foi confirmada.". `problemaParaTirarDocumento(status, actor: { uid: string; role: string }, documento: DocumentoDaEdicao): { code: "failed-precondition" | "permission-denied"; mensagem: string } | null`: fechada → `failed-precondition` "A edição já está fechada."; cliente fora de `rascunho`/`enviado` → `failed-precondition` "Depois da confirmação, só a Dutelog retira documentos."; cliente e `documento.origem === "dutelog"` → `permission-denied` "Só a Dutelog retira os documentos dela."; papel fora de owner, admin, interno com `documento.registrado_por.uid !== actor.uid` → `permission-denied` "Só quem anexou o documento, ou a coordenação, o retira.".
  - Schemas `.strict()`: `AnexarDocumentoSchema` (`edition_id` 1..120, `customer_code` opcional, `arquivo` regex `/^(an|dc)_[a-f0-9]{16}\.(pdf|jpg|png|webp|xlsx)$/`, `nome` 1..120, `momento_id` regex `MOMENTO_ID` opcional, `idempotency_key` 8..200); `TirarDocumentoSchema` (`edition_id`, `customer_code`?, `documento_id` regex `/^(an|dc)_[a-f0-9]{16}$/`, `idempotency_key`); `AnexarFotoSchema` (`edition_id`, `arquivo` regex `ARQUIVO_DA_FOTO`, `momento_id` obrigatório, `legenda` ≤60 opcional, `instante` `z.string().datetime({ offset: true })` opcional, `idempotency_key`); tipos `AnexarDocumento`, `TirarDocumento`, `AnexarFoto`.
  - `documentosLidos(data: Record<string, unknown>): DocumentoDaEdicao[]` e `fotosLidas(data): FotoDaEdicao[]` (o que não se lê fica de fora, como `fotosLidas` da Operação).
  - `codigoDaEdicao(db: Firestore, editionId: string, actor: OperationalActor): Promise<string>`: o cliente é o próprio `actor.customer_code`; a equipe lê `db.collection(EDICOES_COLLECTION).doc(editionId)` fora da transação só para o `customer_code` do caminho e do recibo (`not-found` "Edição não encontrada." sem o documento). `lerEdicaoParaArquivos(transaction, db, editionId, actor): Promise<{ ref: DocumentReference; data: Record<string, unknown> }>`: o cliente por `lerEdicaoDoCliente(transaction, db, editionId, actor.customer_code)`; a equipe por `db.collection(EDICOES_COLLECTION).doc(editionId)` na transação, `not-found` "Edição não encontrada.".
  - `attachEventDocumentTransaction(db, input: AnexarDocumento, actor: OperationalActor, bucket: BucketDosEventos): Promise<{ id: string; edicao: number; documento: DocumentoDaEdicao; documentos: number }>`: `origem` = `cliente` para o papel `cliente`, senão `dutelog`; o `arquivo` tem de casar com `ARQUIVO_DO_ANEXO` (cliente) ou `ARQUIVO_DO_DOCUMENTO` (Dutelog), senão `invalid-argument` "O arquivo não é do caminho de quem anexa."; `codigoDaEdicao`; `bucket.conferir(caminho)` e `problemaDoDocumento`: com `apagar`, `bucket.apagar(caminho)` antes de lançar `invalid-argument`; sem o arquivo, `failed-precondition`. Depois a transação: recibo `op_evento_attach_document_<digest({ customer, nonce: idempotency_key })>` (`kind: "evento.documento.attach"`, `input_hash`, `result`; a mesma chave devolve `result`; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo."); `lerEdicaoParaArquivos`; `problemaParaAnexarDocumento` → `failed-precondition`; `momento_id` fora de `cronograma[].id` → `invalid-argument` "O momento não está no cronograma."; `id` já em `documentos[]` → `already-exists` "O arquivo já está na edição."; `documentos.length >= LIMITES.documentos` → `failed-precondition` "A edição já tem 20 documentos."; grava `documentos: [...atuais, novo]`, `edicao + 1`, `updated_by`, `updated_at`; `createEventoEvent(evento.documento_anexado, { edition_id, documento_id, origem })` com `descricao` `"<event_name> · <label>"`.
  - `removeEventDocumentTransaction(db, input: TirarDocumento, actor): Promise<{ id: string; edicao: number; documentos: number }>`: recibo `op_evento_remove_document_<digest>` (`kind: "evento.documento.remove"`); o documento pelo `documento_id`, senão `not-found` "Documento não encontrado."; `problemaParaTirarDocumento` com o `code` que ele diz; grava `documentos` sem ele, `edicao + 1`, `updated_*`; evento `evento.documento_retirado { edition_id, documento_id }`. O bucket não entra: o arquivo fica.
  - `attachEventPhotoTransaction(db, input: AnexarFoto, actor, bucket): Promise<{ id: string; edicao: number; foto: FotoDaEdicao; fotos: number }>`: `codigoDaEdicao`, `bucket.conferir(caminhoDaFoto(...))`, `problemaDaFoto` (com `apagar` como no documento); recibo `op_evento_attach_photo_<digest>` (`kind: "evento.foto.attach"`); `problemaParaAnexarFoto`; o momento no cronograma; `id` repetido → `already-exists` "O arquivo já está na edição."; `fotos.length >= LIMITES.fotos` → `failed-precondition` "A edição já tem 200 fotos."; `instante` = o da entrada ou `registrado_em`; grava `fotos`, `edicao + 1`, `updated_*`; evento `evento.foto_anexada { edition_id, momento_id, fotos: <total depois> }`.

- [ ] **Step 1: Write the failing tests**

`arquivos.test.ts` (node:test, puro), com as frases de Produces:

```ts
it("os três caminhos", ...) // "eventos/BTG Pactual/ced_0123456789abcdef/fotos/ft_0123456789abcdef.jpg", "portal/BTG Pactual/eventos/ced_…/an_….pdf", "eventos/BTG Pactual/ced_…/docs/dc_….xlsx"
it("a foto: null não chegou (apagar false); image/gif não é foto (apagar true); 8 MiB passa; image/webp de 100 bytes vale", ...)
it("o documento: a planilha de 10 MiB vale; 10 MiB + 1 passa; text/html não é PDF, imagem nem planilha", ...)
it("os status: o documento vale em rascunho e em retornado e recusa em fechado e em cancelado; a foto em enviado recusa e em retornado vale", ...)
it("tirar: as quatro recusas com o code de cada uma; o interno tira qualquer um", ...)
it("as entradas dizem o campo: legenda de 61, nome de 121, sem arquivo ('Informe o arquivo'), arquivo 'foto.jpg' (invalid-argument com /arquivo/), campo extra", ...)
```

`arquivos.integration.test.ts`: os casos 1 a 3 de T5.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/arquivos.test.js` e
`firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/arquivos.integration.test.js"`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement `arquivos.ts`, the `ROTULO_DO_CAMPO` entries and register the unit test**

Nenhum acesso ao Storage neste arquivo além do `bucket` recebido; uma
`db.runTransaction` por função, as leituras antes das escritas;
`FieldValue.serverTimestamp()` só em `updated_at`, os instantes do registro
em ISO (`new Date().toISOString()`), como a Operação.

- [ ] **Step 4: Run tests to verify they pass**

Run: os dois comandos do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/arquivos.ts functions/wms/src/domain/eventos/arquivos.test.ts functions/wms/src/domain/eventos/arquivos.integration.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/package.json
git commit -m "feat(wms): o documento e a foto da edição do evento, conferidos no bucket"
```

### Task 4: as três callables e a matriz

**Files:**
- Modify: `functions/wms/src/index.ts` (três `export const … = onCall(` numa linha cada, no bloco "Eventos", logo depois de `archiveClientEvent` da parte 2; o helper `bucketDosEventos()` ao lado de `documentBucketName()`, linhas 1002-1008)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (três linhas na `MATRIZ`, depois das quatro da parte 2)

**Interfaces:**
- Consumes: `getProfile`, `requireWarehouseWrite`, `requireCustomerScope` (index.ts, linhas 1383, 1451, 1506); `PROJECT_ID` de `./project.js`; `assertEventosLiberado` de `./domain/eventos/liberacao.js`; `entradaDe` de `./domain/eventos/edicao.js`; T3.
- Produces:
  - `bucketDosEventos(): BucketDosEventos` sobre `getStorage().bucket(documentBucketName())`, com `conferir` (`exists()`, depois `getMetadata()`: `contentType` e `size`) e `apagar` (`delete({ ignoreNotFound: true })`), como `conferirArquivo` e `apagarDoBucket` de `functions/operacao/src/index.ts`, linhas 80-92.
  - `attachEventDocument`: `const profile = await getProfile(request); if (profile.role !== "cliente") requireWarehouseWrite(profile); assertEventosLiberado(PROJECT_ID); const input = entradaDe(AnexarDocumentoSchema, request.data ?? {}); const customer_code = profile.role === "cliente" ? requireCustomerScope(profile, input.customer_code) : undefined; return attachEventDocumentTransaction(db, input, { ...profile, customer_code }, bucketDosEventos());`.
  - `removeEventDocument`: o mesmo gate, `TirarDocumentoSchema`, `removeEventDocumentTransaction(db, input, { ...profile, customer_code })`.
  - `attachEventPhoto`: `requireWarehouseWrite(profile)`, `assertEventosLiberado`, `AnexarFotoSchema`, `attachEventPhotoTransaction(db, input, profile, bucketDosEventos())`.

- [ ] **Step 1: Write the failing matrix lines**

```ts
  // Eventos, parte 3: o cliente anexa e tira os próprios documentos; quem opera anexa documentos e fotos.
  attachEventDocument: { passam: [...ARMAZEM, "cliente"], recusa: SO_ARMAZEM },
  removeEventDocument: { passam: [...ARMAZEM, "cliente"], recusa: SO_ARMAZEM },
  attachEventPhoto: { passam: ARMAZEM, recusa: SO_ARMAZEM },
```

Sem `entrada`: a checagem de papel vem antes da entrada; quem passa para na
liberação (`failed-precondition`, o emulador não está em `EVENTOS_PROJECTS`),
nunca em `permission-denied`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js"`
Expected: FAIL ("toda linha é de uma callable": as três não existem).

- [ ] **Step 3: Implement the three callables and `bucketDosEventos`**

Importe de `./domain/eventos/arquivos.js`; nenhuma outra linha do arquivo muda.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, mais `node --test lib/callables-auth.integration.test.js`
no mesmo `emulators:exec` (as três entram sozinhas na descoberta).
Expected: PASS. `pwsh tools/check_functions_invoker.ps1 -ProjectId dute-homolog`
só depois de publicar.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts
git commit -m "feat(wms): as callables do documento e da foto da edição do evento"
```

### Task 5: o teste de integração completo

**Files:**
- Test: `functions/wms/src/domain/eventos/arquivos.integration.test.ts` (na lista de `test:integration`, depois de `lib/domain/eventos/edicao.integration.test.js`)

**Interfaces:**
- Consumes: T3; `saveEventEditionTransaction` de `./edicao-gravacao.js` (parte 2) para a edição nascer; os atores de `client-events.integration.test.ts` (`cristiane`, `outraCliente`, `manoel`) e `rafael = { uid: "rafael", role: "wms", name: "Rafael" }`; o `beforeEach` que limpa o emulador; `eventsFor(id)`. O bucket falso: `noBucket = new Map<string, ArquivoNoBucket>()`, `apagados: string[]`, `bucket = { conferir: async (c) => noBucket.get(c) ?? null, apagar: async (c) => { apagados.push(c); noBucket.delete(c); } }`. A edição nasce com o cronograma da Necton (coleta, entrega, evento, retorno) e muda de status por `update({ status })` direto no documento (as transições são das partes 6 a 9).

- [ ] **Step 1: Write the failing tests** (1 a 3 existem de T3; acrescente 4 a 9)

```ts
it("1. o cliente anexa o layout no rascunho: id, caminho portal/…, tipo e tamanho do bucket, origem cliente, edicao + 1 e o evento documento_anexado sem o nome do arquivo; a mesma chave devolve o mesmo; o mesmo arquivo com outra chave recusa 'O arquivo já está na edição.'", ...)
it("2. o arquivo que não chegou recusa 'O arquivo não chegou ao armazenamento. Envie de novo.'; o .pdf com text/html e a planilha de 10 MiB + 1 são apagados e recusados, e a edição não muda", ...)
it("3. a Dutelog anexa no rascunho o layout recebido por telefone e, em enviado, a planilha com o momento da coleta (origem dutelog, caminho eventos/…/docs/…); o momento fora do cronograma, 'O momento não está no cronograma.'; o an_ pela Dutelog, 'O arquivo não é do caminho de quem anexa.'", ...)
it("4. o 21º documento recusa 'A edição já tem 20 documentos.'", ...)
it("5. tirar: o cliente tira o próprio em enviado (sai de documentos, edicao + 1, evento documento_retirado, nada apagado); em confirmado, 'Depois da confirmação, só a Dutelog retira documentos.'; o da Dutelog, permission-denied; o wms tira só o que anexou; o interno tira qualquer um; o id que não existe, not-found 'Documento não encontrado.'", ...)
it("6. a foto: o wms anexa em confirmado com momento, legenda e instante (fotos[0], evento foto_anexada { fotos: 1 } sem a legenda); sem instante, instante === registrado_em; em enviado, 'A edição ainda não foi confirmada.'; em fechado, 'A edição já está fechada.'; a mesma foto de novo, already-exists", ...)
it("7. a foto errada: image/gif sob .jpg é apagada e recusada ('O arquivo enviado não é uma foto.'); 8 MiB, 'A foto passa de 8 MB.'; a 201ª, 'A edição já tem 200 fotos.'", ...)
it("8. o cliente de outro código recebe not-found 'Edição não encontrada.' ao anexar e ao tirar; em cancelado, cliente e Dutelog recebem 'A edição já está fechada.'", ...)
it("9. nenhum evento desta parte leva dinheiro, nome de arquivo ou legenda", ...)
// assert.doesNotMatch(JSON.stringify(await eventsFor(id)), /cents|valor|layout-necton|Carga na doca/)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: o `emulators:exec` do T3. Expected: FAIL nos casos 4 a 9.

- [ ] **Step 3: Adjust `arquivos.ts` until every case passes** (sem mudar o que T3 definiu, só o que os casos revelarem)

- [ ] **Step 4: Register the test and run the whole integration list once**

Run: `cd C:\DEV\Dute; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `callables-papeis`, `callables-auth` e o CI que
registra as consultas (esta parte não consulta nada novo: a edição e o
recibo são lidos pelo id).

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/arquivos.integration.test.ts functions/wms/src/domain/eventos/arquivos.ts functions/wms/package.json
git commit -m "test(wms): o documento e a foto da edição do evento de ponta a ponta no emulador"
```

### Task 6: as linhas da LGPD

**Files:**
- Modify: `docs/plataforma/lgpd.md` (duas linhas na tabela 1.2 depois de "Anexo da solicitação", linha 60; duas na tabela 1.8 depois de "Fotos de produto", linha 126; o item 5 de 4.1 depois da linha 324)

**Interfaces:**
- Consumes: os caminhos de T1 e os nomes de T3 e T4. A coluna Fonte leva `caminho:linha` do commit desta parte (confira as linhas depois de T1 a T4).

- [ ] **Step 1: Write the rows and the item**

As seis colunas da tabela (`Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte`):

- 1.2, "Contato no local da edição do evento: nome e telefone; o local e o endereço": `client_event_editions/{ced_…}.onde`; leem `canReadOperations` e o cliente dono com a armazenagem; grava `saveEventEdition`; sem exclusão, a zeragem preserva (`EVENTOS_COLLECTIONS`).
- 1.2, "Equipe da edição do evento: estoquistas e pessoas do cliente em texto livre, veículo, contato no local": `.equipe`; os mesmos leitores; grava `saveEventEditionTeam` (parte 8).
- 1.8, "Fotos da edição do evento (os momentos e o retorno), com legenda livre (até 60), instante e quem registrou; podem mostrar pessoas da equipe e do cliente": Storage `eventos/{customer_code}/{ced_…}/fotos/ft_<16 hex>.<ext>` e `client_event_editions.fotos[]`; leem owner, admin, interno, wms, financeiro, suporte e o cliente dono nos do próprio código; sobem owner, admin, interno, wms pelo SDK (imagem até 8 MB) e `attachEventPhoto` confere; sem exclusão, sem prazo (4.1, item 5).
- 1.8, "Documentos da edição do evento (layout, planilha dos produtos, comprovante; podem trazer nomes de pessoas do cliente): o arquivo, o nome, o tipo, o tamanho e quem anexou": `portal/{customer_code}/eventos/{ced_…}/an_…` (o cliente) e `eventos/{customer_code}/{ced_…}/docs/dc_…` (a Dutelog), `client_event_editions.documentos[]`; a proposta em `valores/` e `client_event_prices.documentos` (parte 10), lida por owner, admin, comercial, financeiro e o cliente dono; `attachEventDocument` confere, `removeEventDocument` tira o registro e deixa o arquivo; sem exclusão.
- 4.1, item 5: "**Fotos e documentos da edição do evento ficam sem prazo**, como as fotos da OS ('Fora do escopo' da spec dos Eventos): as regras proíbem apagar e nenhuma rotina os expira; o documento retirado some do registro e o arquivo fica no bucket. Mudariam: uma rotina em `functions/wms/src/index.ts` com o domínio em `functions/wms/src/domain/eventos/`, pelo Admin SDK (o `storage.rules` não muda), e a leitura da foto que não existe mais na ficha e no portal (partes 8 e 11)."

- [ ] **Step 2: Check and commit**

Cada linha nova tem as seis colunas e termina com `|`.

```bash
git add docs/plataforma/lgpd.md
git commit -m "docs(plataforma): fotos, documentos, contato e equipe da edição do evento na LGPD"
```

### Task 7: os wrappers do app

**Files:**
- Modify: `artifacts/app/src/lib/wms/eventos.ts` (três wrappers; `CALLABLES_DOS_EVENTOS` ganha `"attachEventDocument", "removeEventDocument", "attachEventPhoto"`)
- Modify: `artifacts/app/src/lib/wms/eventos.test.ts` (os três casos novos; a asserção dos nomes passa a sete)
- Modify: `artifacts/app/src/lib/eventos/tipos.ts` (`OrigemDoDocumento`, `DocumentoDaEdicao`, `FotoDaEdicao`, espelhos de T3; o `registrado_por` com a forma de `ActorRef` por extenso, `{ uid: string; name: string | null; role: string }`)
- Create: `artifacts/app/src/lib/eventos/arquivos.ts`
- Test: `artifacts/app/src/lib/eventos/arquivos.test.ts`

**Interfaces:**
- Consumes: `functionsDoApp`, `firebaseApp`, `semCamposVazios`, `erroDaCallable` e a forma de `lib/wms/mover-caixa.ts`; `CALLABLES_DOS_EVENTOS` e os wrappers da parte 2; `nomeDaFoto` de `lib/operacao/andamento.ts` (linha 269) como molde.
- Produces (`lib/wms/eventos.ts`): `anexarDocumento(entrada: { edition_id: string; customer_code?: string; arquivo: string; nome: string; momento_id?: string; idempotency_key: string }): Promise<{ id: string; edicao: number; documento: DocumentoDaEdicao; documentos: number }>`; `tirarDocumento(entrada: { edition_id: string; customer_code?: string; documento_id: string; idempotency_key: string }): Promise<{ id: string; edicao: number; documentos: number }>`; `anexarFoto(entrada: { edition_id: string; arquivo: string; momento_id: string; legenda?: string; instante?: string; idempotency_key: string }): Promise<{ id: string; edicao: number; foto: FotoDaEdicao; fotos: number }>`.
- Produces (`lib/eventos/arquivos.ts`, puro, para as partes 4, 8 e 11 subirem pelo SDK): `TIPOS_DE_FOTO`, `TIPOS_DE_DOCUMENTO`, `TAMANHO_DA_FOTO`, `TAMANHO_DO_DOCUMENTO` (os valores de T3); `nomeDoArquivo(prefixo: "ft" | "dc" | "an", tipo: string, aleatorio: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(8))): string | null` = `${prefixo}_${16 hex}.${ext}` com `jpeg → jpg`, `png`, `webp`, `pdf`, a planilha → `xlsx`; `null` para outro tipo e para `ft` fora de imagem; `caminhoDoArquivoDaEdicao(uso: "foto" | "documento" | "anexo", customerCode: string, editionId: string, arquivo: string): string` (os três caminhos de T3); `problemaDoArquivoDaEdicao(arquivo: { type: string; size: number }, uso: "foto" | "documento"): string | null` = "Use foto JPG, PNG ou WebP." / "Use PDF, imagem ou planilha (.xlsx)." / "A foto passa de 8 MB." / "O documento passa de 10 MB.".

- [ ] **Step 1: Write the failing tests**

Em `eventos.test.ts` (vitest, `vi.mock("firebase/functions")`): `anexarFoto`
chama `httpsCallable(…, "attachEventPhoto")` sem a chave `legenda` quando ela
veio `undefined`; `anexarDocumento` chama `"attachEventDocument"` e
`tirarDocumento`, `"removeEventDocument"`; os sete nomes de
`CALLABLES_DOS_EVENTOS` são os sete wrappers. Em `arquivos.test.ts`:
`nomeDoArquivo("ft", "image/jpeg", () => new Uint8Array(8))` é
`"ft_0000000000000000.jpg"`; `("an", <o tipo da planilha>)` termina em
`.xlsx`; `("ft", "application/pdf")` e `("dc", "image/gif")` são `null`; os
três caminhos iguais aos de T3; `problemaDoArquivoDaEdicao({ type: "image/jpeg", size: 8 * 1024 * 1024 }, "foto")`
→ "A foto passa de 8 MB."; a planilha de 10 MiB como documento → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/eventos/arquivos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the wrappers, the types and `lib/eventos/arquivos.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, `npx vitest run src/lib/platform-lists.test.ts`
(as três callables entram na conferência da liberação pelo `index.ts`) e
`cd C:\DEV\Dute; corepack pnpm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/tipos.ts artifacts/app/src/lib/eventos/arquivos.ts artifacts/app/src/lib/eventos/arquivos.test.ts
git commit -m "feat(app): os wrappers do documento e da foto da edição do evento, e o nome do arquivo"
```

### Pronto quando

No emulador, pelos testes: o layout do cliente e a planilha da Dutelog
anexados e um deles retirado; a foto da coleta anexada ao momento; o arquivo
errado apagado e recusado; o `wms` sem leitura em `valores/`; o CI inteiro
verde; nenhuma tela ainda. O PR registra em
`docs/superpowers/plans/2026-11-26-eventos.md` o que mudou de nome, se mudou.
