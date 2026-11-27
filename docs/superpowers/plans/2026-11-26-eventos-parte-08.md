# Eventos · parte 8: a ficha da Armazenagem (momentos, correção, equipe, fotos e documentos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Guilherme registra a edição pela Armazenagem: cada momento com
hora, fim e observação, a correção da hora digitada errada, a entrega do
pedido feita pela própria ficha (a remessa sai e chega), a equipe e o
veículo, as fotos por momento e os documentos; o cliente lê tudo depois
(parte 11).

**Architecture:** o domínio em `functions/wms/src/domain/eventos/momentos.ts`
(regras puras e a transação do registro; a entrega encadeia
`advanceWarehouseTaskTransaction` antes, como `completeOrderSeparation`) e
`equipe.ts` (CAS por `edicao`, sem recibo, como o `patch`); duas callables
de uma linha no `index.ts`; a ficha `/eventos/edicao?id=` no shell v3
(`pages/evento.tsx` lê a edição e os `events` dela ao vivo pelas regras,
`pages/evento-view.tsx` só desenha), com as regras da tela em
`lib/eventos/ficha.ts`. As fotos e os documentos usam as callables da parte
3 e sobem pelo SDK (`compactarFoto`, `enviarComProgresso`), com o nome e o
caminho de `lib/eventos/arquivos.ts` (parte 3). A agenda da parte 7 e
Pedidos ganham o link para a ficha.

**Tech Stack:** TypeScript, zod (`genkit`), firebase-admin, `node --test`
com o emulador; React, wouter, react-query, Firebase Storage, vitest, jsdom
e axe-core no app.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
cronograma", "Os status e quem move cada um", "As callables", "O registro
dos momentos", "Fotos e documentos", "As telas › Armazenagem" (a ficha, o
link da agenda e o "Evento" de Pedidos), "Limites e mensagens". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md`.
Prancha: `docs/mockups/EventosWmsFicha.dc.html` (os textos dela são os da
lista do teste) e `EventosWmsLista.dc.html` (os rótulos dos links da agenda).

## Global Constraints

As do índice. Nesta parte, ainda: `retorno_ao_estoque` não se registra por
`registerEventMoment` (é a parte 9) e a ficha não tem o bloco do retorno,
"Preço fechado" nem o botão "Fechar edição" (partes 9 e 10): a linha "Fechar
a edição" mostra só o que falta, como dado. O `feito` da entrega com pedido
é escrito pelo gancho `shipping:delivered` da parte 7 (`confirmacao.ts`),
nunca por esta parte: `registerEventMoment` roda as transições e depois só
acrescenta a observação. A hora que veio do pedido ou do retorno não se
corrige. O `suporte` abre a ficha e não vê ação nenhuma. Em `rascunho`, a
ficha só mostra os dados e "Anexar"; em `enviado`, "Anexar" e os "Editar"
do previsto e de "Onde"; "Registrar", "Registrar fim" e "Adicionar fotos"
só de `confirmado` a `retornado`, a janela do servidor. A agenda e Pedidos
ligam para a ficha nesta parte; o "Fechar edição" da agenda abre a ficha,
que ganha o botão na parte 10. O "Evento" do pedido em Pedidos não depende
da Operação: o `event_edition_id` vem da solicitação da linha, nunca de
`orders:em_aberto`, que só existe com `OPERACAO_LIBERADO` (falso na
produção). A hora do previsto só é obrigatória na entrega no local, e só no
envio e nas mudanças depois dele (decisão 12 da spec): `previsto.hora` pode
vir `null` em qualquer momento (na entrega no local, só no rascunho), e
todo texto da ficha que mostra o previsto mostra então só o dia. No
"Editar" do previsto a Hora é opcional na tela em todo momento: a entrega
no local sem hora é recusada pelo servidor (`failed-precondition`, "Informe
a data e a hora da entrega no local"), e o diálogo mostra a frase e fica
aberto. O `feito` não muda: `inicio` e `fim` continuam instantes inteiros.

## Review Focus

1. A remessa já em `dispatched` (saiu, não chegou): a ficha roda só o passo
   `delivered`; a repetição com outra chave não cria segundo `op_advance_`
   nem segunda SAÍDA (T5, caso 7).
2. `corrigir` em `entrega_no_local` com `origem: pedido`: `inicio` recusa
   com a frase; só `observacao` aceita, grava `corrigido_em` e não mexe no
   `inicio` (T5, caso 4).
3. Duas pessoas registram o mesmo momento: a segunda chamada com `inicio`
   recusa "Montagem já foi registrado." e nada grava (T5, caso 1).
4. O `fim` anterior ao `inicio` recusa, no registro e na correção (T1).
5. A foto que subiu e a callable que falhou: o arquivo fica no bucket sem
   registro, a tela avisa pelo toast e "Tentar de novo" chama só a callable
   com o mesmo `arquivo` e a mesma chave (T5, caso 4 da página).
6. O previsto sem hora (decisão 12 da spec): a linha da ficha diz só o dia;
   o "Editar" do previsto manda `hora: null` e leva os outros momentos como
   foram lidos; em Entrega no local a Hora vazia vai do mesmo jeito, e a
   recusa é a do servidor (`failed-precondition`, "Informe a data e a hora
   da entrega no local"), mostrada no diálogo, que fica aberto (T4,
   `ficha.test.ts`; T5, o caso do previsto sem hora da página).

---

### Task 1: `momentos.ts`, as regras do registro e a transação

**Files:**
- Create: `functions/wms/src/domain/eventos/momentos.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO` ganha `momento_id` → "o momento", `inicio` → "o início", `fim` → "o fim", `entrega.quem_levou` → "quem levou", `entrega.placa` → "a placa", `entrega.quem_recebeu` → "Quem recebeu"; a `observacao` fica fora do mapa global: a callable passa `{ observacao: "A observação do momento" }` no terceiro argumento de `entradaDe`, porque a parte 9 dá à mesma chave o rótulo do retorno)
- Test: `functions/wms/src/domain/eventos/momentos.test.ts` (`test:unit`, ao fim da lista)
- Test: `functions/wms/src/domain/eventos/momentos.integration.test.ts` (T5; escreva os casos 1 a 7 já aqui, para dirigir a transação)

**Interfaces:**
- Consumes: `ROTULO_DO_MOMENTO`, `podeTransitar`, `StatusDaEdicao`, `TipoDeMomento` de `./dominio.js` (parte 1); `entradaDe<T>(schema: z.ZodType<T>, raw: unknown, rotulos?: Record<string, string>): T` (o mapa da chamada prevalece sobre `ROTULO_DO_CAMPO`), `viewDaEdicao`, `EdicaoView` de `./edicao.js` e `createEventoEvent` de `./eventos-auditoria.js` (parte 2); `EDICOES_COLLECTION`, `OPERATIONS_COLLECTION`, `actorRef(actor: OperationalActor): ActorRef` e `type ActorRef = { uid: string; name: string | null; role: string }` de `./edicao-gravacao.js` (parte 2; o `ActorRef` é o tipo de `registrado_por`, importado de lá, sem reexportar nem copiar); `advanceWarehouseTaskTransaction`, `readRows`, `OperationalActor` de `../operations.js`; o gancho da parte 7 dentro de `advanceWarehouseTaskTransaction` (`shipping:delivered` grava `pedido.entregue_em`, `entregue_por`, `comprovante`, o `feito` de `entrega_no_local` com `origem: "pedido"` e `status: "no_evento"`).
- Produces:
  - `RegistrarMomentoSchema` (`.strict()`): `edition_id` 1..120, `momento_id` `^mo_[0-9a-f]{8}$`, `inicio` e `fim` ISO (`z.string().datetime({ offset: true })`) nullish, `observacao` ≤300 nullish, `entrega: { quem_levou 1..120, placa 1..20, quem_recebeu ≤120 nullish }` opcional, `corrigir` boolean opcional, `expected_edicao` int ≥1 opcional, `idempotency_key` 8..200; `refine`: ao menos um entre `inicio`, `fim`, `observacao` e `entrega` ("Informe o início, o fim ou a observação"); `corrigir` exige `expected_edicao` ("Informe expected_edicao para corrigir"). `type RegistrarMomento`.
  - `type FeitoDoMomento = { inicio: string; fim: string | null; observacao: string | null; origem: "registro" | "pedido" | "retorno"; registrado_por: ActorRef; registrado_em: string; corrigido_em: string | null }`.
  - `type StatusDaRemessa = "nao_separado" | "ready_to_dispatch" | "dispatched" | "delivered"`; `statusDaRemessa(remessa: Record<string, unknown> | null): StatusDaRemessa` (null → `nao_separado`).
  - `problemaDoRegistro(edicao: EdicaoView, momento: Momento, input: RegistrarMomento, remessa: StatusDaRemessa | null): string | null`, a primeira recusa, nesta ordem: `fechado`/`cancelado` → "A edição já está fechada."; `rascunho`/`enviado` → "A edição ainda não foi confirmada."; tipo `retorno_ao_estoque` → "O retorno ao estoque é registrado em Registrar o retorno."; com `corrigir`: sem `feito` → "<Rótulo> ainda não foi registrado."; `feito.origem !== "registro"` e `inicio` ou `fim` → "A hora de <Rótulo> veio do pedido: só a observação muda." (ou "…veio do retorno…"); sem `corrigir`: `inicio` com `feito` já gravado → "<Rótulo> já foi registrado."; `fim` sem `feito` e sem `inicio` → "Registre o início de <Rótulo> antes do fim."; `fim` com `previsto.ate` nulo e tipo fora de `outro` → "<Rótulo> não tem fim previsto."; `fim` com `feito.fim` → "O fim de <Rótulo> já foi registrado."; `entrega_no_local` com pedido: `remessa === "nao_separado"` → "O pedido ainda não foi separado."; `ready_to_dispatch`/`dispatched` sem `entrega` → "Informe quem levou e a placa."; por fim, `fim` menor que o `inicio` que vale → "O fim de <Rótulo> está antes do início.". O rótulo do `outro` é o `rotulo` dele.
  - `feitoDepoisDoRegistro(feito: FeitoDoMomento | null, input: RegistrarMomento, por: ActorRef, agora: string): FeitoDoMomento` (puro): `inicio` cria o `feito` com `origem: "registro"`; `fim` é a segunda escrita; `corrigir` reescreve `inicio`, `fim` e `observacao` (os que vieram), mantém `origem` e grava `corrigido_em: agora`; só `observacao` troca só ela.
  - `statusDepoisDoRegistro(status: StatusDaEdicao, tipo: TipoDeMomento, comPedido: boolean): StatusDaEdicao`: `confirmado`, sem pedido, tipo `entrega_no_local` ou `evento` → `no_evento`; o resto fica.
  - `lerEdicao(transaction: Transaction, db: Firestore, editionId: string): Promise<{ ref: DocumentReference; data: Record<string, unknown> }>` — a leitura da equipe, de qualquer cliente; `not-found` "Edição não encontrada." (as partes 9, 10 e 13 a consomem daqui).
  - `registerEventMomentTransaction(db: Firestore, input: RegistrarMomento, actor: OperationalActor): Promise<{ id: string; momento_id: string; status: StatusDaEdicao; feito: FeitoDoMomento; entrega: { dispatched: boolean; delivered: boolean } | null; edition: EdicaoView }>`:
    - recibo `op_evento_momento_<digest({ edition: edition_id, momento: momento_id, nonce: idempotency_key })>`, `kind` `evento.moment.register` (`evento.moment.correct` com `corrigir`), lido antes de tudo: mesma chave e mesmo `input_hash` → o mesmo resultado; outro hash → `already-exists` "A chave de idempotência já foi usada com outro conteúdo.";
    - a entrega, antes da transação da edição: tipo `entrega_no_local`, `pedido.order_id`, sem `corrigir` e a remessa (`shipments` `where order_id ==`, fora de `cancelled`) em `ready_to_dispatch` ou `dispatched` → `advanceWarehouseTaskTransaction(db, { task_uid: "shipping:<id>", expected_status: "ready_to_dispatch", idempotency_key: "evento:<edition_id>:shipping:<id>:ready_to_dispatch", operation: { carrier: "Dutelog", driver_name: quem_levou, vehicle_plate: placa } }, actor)` e depois `expected_status: "dispatched"` com `{ proof_reference: quem_recebeu || "Entrega própria Dutelog", delivery_notes: "Recebido pelo cliente." }` (a chave derivada da tarefa: a repetição acha o mesmo `op_advance_`); só o segundo passo quando já está `dispatched`;
    - a transação: `lerEdicao`; `expected_edicao` dado e diferente → `failed-precondition` "A edição mudou em outra aba"; o momento pelo id (`not-found` "Momento não encontrado."); `problemaDoRegistro` → `failed-precondition`; grava `cronograma` com o momento trocado, `status` por `statusDepoisDoRegistro`, `edicao + 1`, `updated_*`; eventos: `evento.momento_registrado { edition_id, momento_id, tipo, inicio, fim, origem }` ou `evento.momento_corrigido { edition_id, momento_id, de: { inicio, fim }, para: { inicio, fim } }`, e `evento.edicao_no_evento { edition_id, order_id: null, entregue_em: inicio }` quando o status mudou aqui; o recibo por último.

- [ ] **Step 1: Write the failing unit test**

`momentos.test.ts` (node:test, puro), com a Necton como edição (sete
momentos, `montagem` com `ate: "19:00"`, `desmontagem` sem `ate`):

```ts
it("a entrada: sem início, fim, observação nem entrega recusa; corrigir sem expected_edicao recusa; chave extra recusa; a observação de 301 caracteres, com { observacao: 'A observação do momento' } na chamada, recusa 'A observação do momento passa de 300 caracteres'", ...)
it("as recusas dizem o momento", () => {
  assert.equal(problemaDoRegistro(fechada, montagem, { ...base, inicio: T1 }, null), "A edição já está fechada.");
  assert.equal(problemaDoRegistro(confirmada, retorno, { ...base, inicio: T1 }, null), "O retorno ao estoque é registrado em Registrar o retorno.");
  assert.equal(problemaDoRegistro(confirmada, montagem, { ...base, fim: T2 }, null), "Registre o início de Montagem antes do fim.");
  assert.equal(problemaDoRegistro(confirmada, desmontagemIniciada, { ...base, fim: T2 }, null), "Desmontagem e coleta não tem fim previsto.");
  assert.equal(problemaDoRegistro(confirmada, montagemIniciada, { ...base, inicio: T1 }, null), "Montagem já foi registrado.");
  assert.equal(problemaDoRegistro(confirmada, montagemIniciada, { ...base, fim: ANTES_DE_T1 }, null), "O fim de Montagem está antes do início.");
  assert.equal(problemaDoRegistro(separada, entrega, { ...base, inicio: T1 }, "nao_separado"), "O pedido ainda não foi separado.");
  assert.equal(problemaDoRegistro(separada, entrega, { ...base, inicio: T1 }, "ready_to_dispatch"), "Informe quem levou e a placa.");
  assert.equal(problemaDoRegistro(noEvento, entregaDoPedido, { ...base, corrigir: true, expected_edicao: 3, inicio: T1 }, "delivered"), "A hora de Entrega no local veio do pedido: só a observação muda.");
  assert.equal(problemaDoRegistro(noEvento, entregaDoPedido, { ...base, corrigir: true, expected_edicao: 3, observacao: "Doca B" }, "delivered"), null);
});
it("o feito: início uma vez, fim como segunda escrita, a correção com corrigido_em e a origem de sempre", ...)
it("o status: confirmado sem pedido vira no_evento no primeiro entre entrega no local e evento; com pedido e nos outros fica", () => {
  assert.equal(statusDepoisDoRegistro("confirmado", "evento", false), "no_evento");
  assert.equal(statusDepoisDoRegistro("confirmado", "montagem", false), "confirmado");
  assert.equal(statusDepoisDoRegistro("confirmado", "evento", true), "confirmado");
  assert.equal(statusDepoisDoRegistro("retornado", "entrega_de_volta", true), "retornado");
});
it("statusDaRemessa: sem remessa é nao_separado; o status da remessa em minúsculas nos outros", ...)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/momentos.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement `momentos.ts`, the `ROTULO_DO_CAMPO` entries and register the test in `test:unit`**

As regras puras acima da transação, sem Firestore; `digest` e `clean`
locais como em `count-rounds.ts`, e `actorRef` de `./edicao-gravacao.js`
(sem cópia local); a leitura da remessa e as transições fora da
`db.runTransaction` da edição (uma `runTransaction` por passo, como
`concluirDeOndeEsta` em `pick-progress.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, e os casos 1 a 7 de T5 pelo `emulators:exec` de T5.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/momentos.ts functions/wms/src/domain/eventos/momentos.test.ts functions/wms/src/domain/eventos/momentos.integration.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/package.json
git commit -m "feat(wms): o registro, o fim e a correção de cada momento da edição, com a entrega do pedido"
```

### Task 2: `equipe.ts`, a equipe e as observações da Dutelog

**Files:**
- Create: `functions/wms/src/domain/eventos/equipe.ts`
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (`ROTULO_DO_CAMPO`: `equipe.estoquistas` → "Os estoquistas", `equipe.do_cliente` → "A equipe do cliente", `equipe.veiculo` → "O veículo", `equipe.contato_no_local` → "O contato no local", `observacoes_dutelog` → "As observações da Dutelog")
- Test: `functions/wms/src/domain/eventos/equipe.test.ts` (`test:unit`)

**Interfaces:**
- Consumes: `entradaDe`, `viewDaEdicao` (parte 2); `createEventoEvent` (parte 2); `actorRef` de `./edicao-gravacao.js` (parte 2, para os `updated_*`); `lerEdicao` (T1); `edicaoAberta` (parte 1).
- Produces:
  - `SalvarEquipeSchema` (`.strict()`): `edition_id` 1..120, `expected_edicao` int ≥1, `equipe: { estoquistas ≤120, do_cliente ≤120, veiculo ≤60, contato_no_local ≤120 }` (todos nullable) opcional, `observacoes_dutelog` ≤2000 nullish opcional; `refine`: um dos dois ("Informe a equipe ou as observações"). `type SalvarEquipe`.
  - `saveEventEditionTeamTransaction(db: Firestore, input: SalvarEquipe, actor: OperationalActor): Promise<{ id: string; edicao: number; edition: EdicaoView }>` — `lerEdicao`; `!edicaoAberta(status)` → `failed-precondition` "A edição já está fechada."; `expected_edicao !== edicao` → "A edição mudou em outra aba"; grava `equipe` inteira (o campo vazio vira `null`) e/ou `observacoes_dutelog`, `edicao + 1`, `updated_*`; evento `evento.edicao_salva { edition_id, event_id, criada: false, itens, momentos }`. Sem recibo: o CAS é a proteção, como o `patch`.

- [ ] **Step 1: Write the failing test**

`equipe.test.ts` (puro): `entradaDe(SalvarEquipeSchema, …)` com `veiculo` de
61 caracteres lança `invalid-argument` "O veículo passa de 60 caracteres";
`observacoes_dutelog` de 2001 → "As observações da Dutelog passa de 2000
caracteres"; sem `equipe` nem `observacoes_dutelog` → "Informe a equipe ou
as observações"; `expected_edicao: 0` → "Informe expected_edicao"; chave extra → `invalid-argument`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/equipe.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `equipe.ts` and register the test**

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/equipe.ts functions/wms/src/domain/eventos/equipe.test.ts functions/wms/src/domain/eventos/edicao.ts functions/wms/package.json
git commit -m "feat(wms): a equipe, o veículo e as observações da Dutelog na edição"
```

### Task 3: as duas callables, a matriz e os wrappers

**Files:**
- Modify: `functions/wms/src/index.ts` (duas linhas no bloco "Eventos", depois de `confirmEventEdition` da parte 7)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (duas linhas na `MATRIZ`, ao lado de `receiveOrderReturn`)
- Modify: `artifacts/app/src/lib/wms/eventos.ts` (dois wrappers; `CALLABLES_DOS_EVENTOS` ganha os dois nomes)
- Modify: `artifacts/app/src/lib/eventos/tipos.ts` (os tipos espelhados: `RegistrarMomento`, `FeitoDoMomento`, `Equipe`, `SalvarEquipe`, `ResultadoDoRegistro`)
- Test: `artifacts/app/src/lib/wms/eventos.test.ts` (dois `it` novos)

**Interfaces:**
- Consumes: `getProfile`, `requireWarehouseWrite`, `PROJECT_ID`, `db` do `index.ts`; `assertEventosLiberado` (parte 1); `entradaDe` (parte 2); `ARMAZEM`, `SO_ARMAZEM` da matriz; `functionsDoApp`, `firebaseApp`, `semCamposVazios`, `erroDaCallable` (parte 2).
- Produces: `export const registerEventMoment = onCall(async (request) => { const profile = await getProfile(request); requireWarehouseWrite(profile); assertEventosLiberado(PROJECT_ID); return registerEventMomentTransaction(db, entradaDe(RegistrarMomentoSchema, request.data ?? {}, { observacao: "A observação do momento" }), profile); });` e `saveEventEditionTeam`, igual, com `saveEventEditionTeamTransaction` e `SalvarEquipeSchema` (sem o terceiro argumento: as chaves da equipe estão em `ROTULO_DO_CAMPO`); na matriz, `registerEventMoment: { passam: ARMAZEM, recusa: SO_ARMAZEM }` e `saveEventEditionTeam: { passam: ARMAZEM, recusa: SO_ARMAZEM }`; no app, `registrarMomento(entrada: RegistrarMomento): Promise<ResultadoDoRegistro>` e `salvarEquipe(entrada: SalvarEquipe): Promise<{ id: string; edicao: number; edition: EdicaoView }>`.

- [ ] **Step 1: Write the failing tests**

Em `eventos.test.ts` do app: `registrarMomento({ …, entrega: { quem_levou: "Rafael", placa: "DUTE-001", quem_recebeu: undefined } })` chama `httpsCallable(…, "registerEventMoment")` e a entrada não tem a chave `quem_recebeu`; `salvarEquipe` chama `"saveEventEditionTeam"` e mantém `veiculo: null` (o null vai de propósito: os quatro campos de `equipe` estão na lista dos `null` aceitos do índice); `CALLABLES_DOS_EVENTOS` contém os dois nomes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/wms/eventos.test.ts src/lib/platform-lists.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js"`
Expected: FAIL (os wrappers não existem; a matriz tem linhas sem callable; `platform-lists` não acha as duas no `index.ts`).

- [ ] **Step 3: Implement the two callables, the matrix lines, the wrappers and the types**

- [ ] **Step 4: Run tests to verify they pass**

Run: os do passo 2, mais `node --test lib/callables-auth.integration.test.js` no mesmo `emulators:exec` e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS (quem passa do papel recebe `failed-precondition` da liberação no emulador, não `permission-denied`).

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/index.ts functions/wms/src/callables-papeis.integration.test.ts artifacts/app/src/lib/wms/eventos.ts artifacts/app/src/lib/wms/eventos.test.ts artifacts/app/src/lib/eventos/tipos.ts
git commit -m "feat(wms): as callables do registro dos momentos e da equipe da edição"
```

### Task 4: a ficha `/eventos/edicao` na v3, com os momentos, as fotos e os documentos, e os links da agenda e de Pedidos

**Files:**
- Create: `artifacts/app/src/lib/eventos/ficha.ts`
- Test: `artifacts/app/src/lib/eventos/ficha.test.ts`
- Create: `artifacts/app/src/pages/evento.tsx` (a página: leituras, diálogos, envios), `artifacts/app/src/pages/evento-view.tsx` (a tela por props, sem leitura)
- Test: `artifacts/app/src/pages/evento-view.test.tsx` (textos e `axe`)
- Modify: `artifacts/app/src/App.tsx` (o `telaSobDemanda("pages/evento", …)` ao lado dos de Pedidos, ~linha 82; `protectedRoute("/eventos/edicao", Evento)` antes de `protectedRoute("/eventos", Eventos)` da parte 7, os dois sob `EVENTOS_LIBERADO`)
- Modify: `artifacts/app/src/lib/modules.ts` (`ROUTE_ACCESS`, ~linha 940: `{ path: "/eventos/edicao", roles: WMS_ROLES }`, com o comentário "a ficha da edição, aberta pela agenda; o suporte só lê"), `artifacts/app/src/lib/modules.test.ts` (`ROUTE_ACCESS` ~linha 74: `["/eventos/edicao", ["owner", "admin", "interno", "wms", "suporte"]]`; o menu acende em "Eventos", ~linha 301)
- Modify: `artifacts/app/src/lib/document-title.ts` (`EXTRA_RULES`, ~linha 31: `{ path: "/eventos/edicao", label: "Edição do evento" }`) e `document-title.test.ts` (`["/eventos/edicao", "Dutelog | Edição do evento"]`)
- Modify: `artifacts/app/src/lib/wms-v3.ts` (`"/eventos/edicao"` logo depois de `"/eventos"`, com o comentário "Eventos, parte 8: a ficha da edição") e `wms-v3.test.ts` (o array exato termina em `"/eventos", "/eventos/edicao"`)
- Modify: `artifacts/app/src/lib/eventos/agenda.ts` e `agenda.test.ts` (parte 7: `LinhaDaAgenda` ganha `href` e perde `orderId`, que só servia ao "Ver pedido" da agenda; o rótulo do link por grupo e papel, `rotuloDaFichaNaAgenda`)
- Modify: `artifacts/app/src/pages/eventos-view.tsx` e `eventos-view.test.tsx` (parte 7: a ação de cada linha fora de "Para confirmar" vira o link à ficha, com o rótulo do grupo e do papel; "Para confirmar" ganha "Abrir" ao lado de "Confirmar"; "Ver pedido" sai da linha e fica na ficha), `artifacts/app/src/pages/eventos.tsx` e `eventos.test.tsx` (parte 7: o clique no link abre a ficha; a página repassa a linha e o papel)
- Modify: `artifacts/app/src/pages/pedidos.tsx` ("Evento" na linha de "Para aprovar" da solicitação com `event_edition_id` e nas de "Para separar" e "Para entregar" do pedido com ele; o `event_edition_id` do pedido vem da solicitação da linha, pelo `customer_request_id` da tarefa (`order.requestId`), como o "Para quando": da lista das solicitações (`requests`) para quem a lê e, para quem não a lê, da leitura por id de `customer_requests/{requestId}` em `useParaQuandoDoPedido`, cujo mapeamento passa a devolver também o `event_edition_id`; a leitura `orders:em_aberto` (`entregas`) não muda: só existe com `OPERACAO_LIBERADO`, falso na produção) e `artifacts/app/src/pages/customer-requests.tsx` ("Evento" no detalhe da solicitação com `event_edition_id`, ao lado de "Ver em Pedidos"), os dois só com `EVENTOS_LIBERADO`
- Test: `artifacts/app/src/pages/pedidos.evento.test.tsx` (parte 6: um `it` com o `href`; o `it` da parte 6 ganha "Evento" na lista permitida, porque o `vi.mock` de `@/lib/liberacao` vale para o arquivo inteiro) e `artifacts/app/src/pages/customer-requests-detalhe.test.tsx` (o link no detalhe; o arquivo não confere lista de textos hoje: se conferir na hora de executar, a lista ganha "Evento")

**Interfaces:**
- Consumes: `ROTULO_DO_STATUS`, `ROTULO_DO_MOMENTO`, `TIPOS_DE_MOMENTO`, `edicaoAberta` de `@workspace/dominio` (parte 1); `EdicaoView`, `StatusDaEdicao`, `MomentoView` (o momento lido: `previsto.hora: string | null`, `null` quando a pessoa não deu a hora) e `MomentoPrevisto` (a linha do `patch.cronograma`: `hora?: string | null`) de `lib/eventos/tipos.ts` (parte 2); `salvarEdicao({ id, expected_edicao, patch })` (parte 2, o `patch` da coordenação: `onde` e `cronograma` em `enviado` e `confirmado`, `separar_ate` em `confirmado` e `separado`), `anexarFoto(entrada: { edition_id: string; arquivo: string; momento_id: string; legenda?: string; instante?: string; idempotency_key: string })`, `anexarDocumento(entrada: { edition_id: string; customer_code?: string; arquivo: string; nome: string; momento_id?: string; idempotency_key: string })` (parte 3), `registrarMomento`, `salvarEquipe` (T3) de `lib/wms/eventos.ts`; de `lib/eventos/arquivos.ts` (parte 3), `nomeDoArquivo(prefixo: "ft" | "dc" | "an", tipo: string, aleatorio?: () => Uint8Array): string | null`, `caminhoDoArquivoDaEdicao(uso: "foto" | "documento" | "anexo", customerCode: string, editionId: string, arquivo: string): string` e `problemaDoArquivoDaEdicao(arquivo: { type: string; size: number }, uso: "foto" | "documento"): string | null`; `FotoDaEdicao`, `DocumentoDaEdicao` de `lib/eventos/tipos.ts` (parte 3); da parte 7, `LinhaDaAgenda`, `linhaDaAgenda`, `GrupoDaAgenda`, `podeConfirmar(role)` (`lib/eventos/agenda.ts`) e `EventosView` (`pages/eventos-view.tsx`); `WMS_OPERATOR_ROLES` de `lib/modules.ts`; `EVENTOS_LIBERADO` de `lib/liberacao.ts` (parte 1); `CustomerRequest.event_edition_id` (`pages/customer-requests.tsx`, parte 6), `OrderGroup.requestId` (o `customer_request_id` da tarefa, `lib/warehouse-ops/orders.ts`) e `useParaQuandoDoPedido` (`pages/pedidos.tsx`: a solicitação do pedido lida por id, para quem não lê a lista); `useDocumento`, `useLeitura` de `lib/operacao/leitura.ts`; `compactarFoto`, `enviarComProgresso` de `lib/envio-de-fotos.ts` e `useEnvioDeFotos` de `lib/carregando/use-envio-de-fotos.ts`; `useTentativaDaEscrita`, `avisoDoErroDaEscrita`, `desfechoDoErro` de `lib/carregando/`; `BotaoDeAcao`, `CarregandoTela`, `CarregandoNaRegiao`, `LinhaDeEstado`, `FalhaNaLeitura`; `canOperateWarehouse` de `lib/permissions.ts`; `pedidoDaBusca` só como nome do parâmetro (`/pedidos/separar?pedido=<order_id>`, `/pedidos/romaneio?pedido=<order_id>`).
- Produces (`lib/eventos/ficha.ts`, puro, datas em `America/Sao_Paulo`):
  - `type LinhaDaFicha = { id: string; titulo: string; previsto: string | null; feito: string | null; quem: string | null; dado: string | null; fotos: number; acao: "registrar" | "registrar_fim" | "editar" | "editar_separar_ate" | "ver_pedido" | null; momento_id: string | null }`.
  - `linhasDaFicha(edicao: EdicaoView, papel: string): LinhaDaFicha[]` — a primeira linha, com `pedido`, pelo status: "Pedido enviado" em `enviado` (a solicitação já está em `pedido`, o pedido aprovado ainda não: `dado` o número da solicitação, `pedido.request_number`, "PED-0007"; `feito` null e sem ação, porque a confirmação fica na agenda) e "Pedido confirmado" de `confirmado` em diante (`dado` "PED-0007 · 100 itens · 2.000 peças", `feito` a `confirmada_em`, `acao` `editar_separar_ate` só em `confirmado` e `separado`, a janela do `patch` do `separar_ate`, e só para owner, admin e interno); depois "Separado" (com `pedido.separado_em`: "no armazém", "38 volumes · lacre 88412", `acao` `ver_pedido`), um por momento do `cronograma` na ordem dele (o rótulo de `ROTULO_DO_MOMENTO` ou o `rotulo` do `outro`), e "Fechar a edição" (`previsto` "vira história", `dado` = `oQueFalta`, sem ação nesta parte).
  - `textoDoPrevisto(momento): string` = "previsto 28/01 05:00 · Faria Lima" (`local` quando há) ou "previsto 28/01 10:00 às 19:00" (`ate` quando há); com a `hora` `null`, só o dia: "previsto 28/01", "previsto 28/01 · Faria Lima" e, com `ate`, "previsto 28/01 até 19:00" (decisão 12 da spec, só a entrega no local exige a hora); `textoDoFeito(feito): string | null` = "28/01 10:05 às 18:40", "começou 29/01 08:00" (sem fim, com `ate` previsto ou `outro`) ou "28/01 05:10"; `textoDasFotos(n): string | null` = null, "1 foto", "6 fotos".
  - `acaoDoMomento(momento, status: StatusDaEdicao, opera: boolean): LinhaDaFicha["acao"]` — fora de `confirmado`..`retornado` ou sem `opera`: null; `retorno_ao_estoque`: null; sem `feito`: `registrar`; `feito` sem `fim` e (`ate` ou `outro`): `registrar_fim`; senão `editar`.
  - `oQueFalta(edicao): string | null` = "Faltam desmontagem, retorno e entrega de volta" / "Falta a entrega de volta" / null (os momentos sem `feito`, nesta ordem e com estes nomes: "coleta", "entrega no local", "montagem", "evento", "desmontagem", "retorno", "entrega de volta", o `rotulo` do `outro`). A função é desta parte e mora aqui: a parte 10 a estende neste arquivo para `oQueFalta(edicao, preco?)` (os momentos sem `feito`, as fotos do retorno e o preço, numa conta só), e a agenda dela a consome daqui.
  - `fotosPorMomento(fotos): Map<string, number>`; `historicoDaEdicao(events: readonly EventoLido[]): Array<{ id: string; titulo: string; linha: string }>` ordenado por `occurred_at` desc, `linha` = "Guilherme · 29/01 08:02"; uma linha por evento lido, sem agrupar: os `evento.edicao_salva` aparecem um a um (decisão 13 da spec: um a cada gravação, também no salvamento automático do formulário do cliente; agrupar na tela fica para depois).
  - `hrefDaFicha(id: string): string` = `/eventos/edicao?id=<id>` (o link da agenda e de Pedidos). O nome, o caminho e a recusa do arquivo não moram aqui: são `nomeDoArquivo`, `caminhoDoArquivoDaEdicao` e `problemaDoArquivoDaEdicao` de `lib/eventos/arquivos.ts` (parte 3).
  - `podeEditarPrevisto(papel, status): boolean` = owner, admin ou interno em `enviado` ou `confirmado`. O mesmo critério acende o "Editar" de "Onde".
- Produces (`pages/evento-view.tsx`): `EventoView(props: PropsDaFicha)` com `estado: { fase: "carregando" } | { fase: "falha"; erro } | { fase: "pronta"; edicao: EdicaoView; linhas; historico; fotos }`, `opera: boolean`, `editaPrevisto: boolean` (`podeEditarPrevisto(papel, status)`, que acende o "Editar" do previsto de cada momento e o de "Onde"), os `on*` dos seis diálogos ("Registrar", "Registrar fim", "Editar" do feito, "Editar" do previsto e do "Separar até", "Editar" de "Onde", "Editar" da equipe), `onAdicionarFotos(momento_id, files)`, `onAnexar(file, momento_id | null)`, o envio em curso (`EnvioDeFotos`) e as recusas por diálogo. Com `opera`, as ações seguem o status, como no servidor: "Anexar" em toda edição aberta (`edicaoAberta`, de `rascunho` a `retornado`), e é a única em `rascunho`, onde a ficha só mostra os dados; em `enviado`, também os "Editar" de `editaPrevisto` (o previsto e "Onde"); de `confirmado` a `retornado`, também "Registrar momento" e "Adicionar fotos" no cabeçalho, o "Adicionar" das Fotos, as ações de `acaoDoMomento` ("Registrar", "Registrar fim" e o "Editar" do feito) e o "Editar" da equipe; em `fechado` e `cancelado`, nenhuma. O bloco "Onde" (o local, o endereço, o contato e o telefone) tem "Editar" com `editaPrevisto`; o diálogo pede Local, Endereço, Contato e Telefone (o "Contato no local" fica no bloco "Equipe e veículo", como na prancha). O `input` das fotos: `accept="image/*" multiple capture="environment"`.
- Produces (`lib/eventos/agenda.ts`, parte 7, modificado): `LinhaDaAgenda` ganha `href: string`, que `linhaDaAgenda` preenche com `hrefDaFicha(view.id)` (importado de `./ficha`), e perde `orderId`: o "Ver pedido" sai da agenda e fica na ficha, que lê o pedido da própria edição; `rotuloDaFichaNaAgenda(grupo: GrupoDaAgenda, papel: string | null | undefined): string` = "Registrar" em `em_andamento` só para quem opera (`WMS_OPERATOR_ROLES`), "Fechar edição" em `para_fechar` só para a coordenação (`podeConfirmar(papel)`: owner, admin e interno) e "Abrir" no resto: em `para_confirmar`, `proximos`, `rascunhos` e `fechados` para todos e, para os outros papéis, também em `em_andamento` e `para_fechar` (os rótulos da prancha `EventosWmsLista.dc.html`; quem não pode registrar ou fechar vê "Abrir", como a spec diz).
- Produces (`pages/eventos-view.tsx`, parte 7, modificado): `EventosView` ganha `papel: string | null` (o de quem lê, que `pages/eventos.tsx` repassa de `useAppUser`); a ação de cada linha fora de "Para confirmar" é o link `linha.href` com `rotuloDaFichaNaAgenda(grupo, papel)`, inclusive na linha do rascunho ("Abrir": a ficha do rascunho só com "Anexar"); a linha de "Para confirmar" tem "Abrir" ao lado de "Confirmar" (sem `podeConfirmar`, só "Abrir"); "Ver pedido" sai da linha da agenda e fica na ficha, na linha "Separado".
- Produces (`pages/pedidos.tsx`, `pages/customer-requests.tsx`): com `EVENTOS_LIBERADO`, a solicitação e o pedido com `event_edition_id` têm o link "Evento" → `hrefDaFicha(event_edition_id)`: em Pedidos, na linha de "Para aprovar" (`LinhaParaAprovar`) e nas de "Para separar" e "Para entregar" (`OrderRow`, com o `event_edition_id` da solicitação do pedido, pelo `order.requestId`: o da lista das solicitações para a coordenação e o da leitura por id de `useParaQuandoDoPedido` para quem não lê a lista; as duas leituras existem com e sem `OPERACAO_LIBERADO`, e `orders:em_aberto` não muda); em Solicitações, no detalhe da solicitação (`RequestDetail`), ao lado de "Ver em Pedidos". Sem o campo, nada muda na linha.

- [ ] **Step 1: Write the failing tests**

`ficha.test.ts` (vitest) com a Necton no estado da prancha (`no_evento`,
coleta, entrega e montagem feitas, o evento começado):

```ts
it("as linhas na ordem da prancha: pedido, separado, os sete momentos e fechar", () => {
  expect(linhasDaFicha(necton, "admin").map((l) => l.titulo)).toEqual(["Pedido confirmado", "Separado", "Coleta no cliente", "Entrega no local", "Montagem", "Evento", "Desmontagem e coleta", "Retorno ao estoque Dutelog", "Entrega de volta no cliente", "Fechar a edição"]);
  expect(linhasDaFicha(necton, "admin").map((l) => l.acao)).toEqual([null, "ver_pedido", "editar", "editar", "editar", "registrar_fim", "registrar", null, "registrar", null]);
  expect(linhasDaFicha(necton, "suporte").map((l) => l.acao)).toEqual([null, "ver_pedido", null, null, null, null, null, null, null, null]);
});
it("o previsto e o feito como a prancha escreve", () => {
  expect(textoDoPrevisto(coleta)).toBe("previsto 28/01 05:00 · Faria Lima");
  expect(textoDoPrevisto(montagem)).toBe("previsto 28/01 10:00 às 19:00");
  expect(textoDoFeito(montagem.feito)).toBe("28/01 10:05 às 18:40");
  expect(textoDoFeito(evento.feito)).toBe("começou 29/01 08:00");
  expect([textoDasFotos(0), textoDasFotos(1), textoDasFotos(6)]).toEqual([null, "1 foto", "6 fotos"]);
});
it("o previsto sem hora diz só o dia: a hora só é obrigatória na entrega no local", () => {
  const montagemSemHora = { ...montagem, previsto: { ...montagem.previsto, hora: null } };
  expect(textoDoPrevisto({ ...coleta, previsto: { ...coleta.previsto, hora: null } })).toBe("previsto 28/01 · Faria Lima");
  expect(textoDoPrevisto(montagemSemHora)).toBe("previsto 28/01 até 19:00");
  expect(textoDoPrevisto({ ...montagemSemHora, previsto: { ...montagemSemHora.previsto, ate: null } })).toBe("previsto 28/01");
});
it("o que falta: os momentos sem feito, e nada quando tudo foi registrado", () => {
  expect(oQueFalta(necton)).toBe("Faltam desmontagem, retorno e entrega de volta");
  expect(oQueFalta(soEntregaDeVolta)).toBe("Falta a entrega de volta");
  expect(oQueFalta(tudoFeito)).toBeNull();
});
it("o link da ficha", () => {
  expect(hrefDaFicha("ced_0123456789abcdef")).toBe("/eventos/edicao?id=ced_0123456789abcdef");
});
it("em rascunho e enviado nenhuma linha tem ação: o registro é de confirmado a retornado, e o Separar até, de confirmado e separado", () => {
  expect(linhasDaFicha(rascunho, "admin").map((l) => l.acao).filter(Boolean)).toEqual([]);
  expect(linhasDaFicha(enviadaComSolicitacao, "admin").map((l) => l.acao).filter(Boolean)).toEqual([]);
});
it("a primeira linha: em enviado, 'Pedido enviado' com o número da solicitação, sem feito e sem ação; de confirmado em diante, 'Pedido confirmado'", () => {
  expect(linhasDaFicha(enviadaComSolicitacao, "admin")[0]).toMatchObject({ titulo: "Pedido enviado", dado: "PED-0007", feito: null, acao: null });
  expect(linhasDaFicha({ ...enviadaComSolicitacao, status: "confirmado", separar_ate: "2027-01-26" }, "admin")[0]).toMatchObject({ titulo: "Pedido confirmado", acao: "editar_separar_ate" });
});
```

A `enviadaComSolicitacao` é a Necton em `enviado`: o `pedido` só com a
solicitação (`request_id` e `request_number: "PED-0007"`, o resto nulo), e
`confirmada_em` e `separar_ate` nulos. A parte 10 dá ao `tudoFeito` uma
foto em `retorno_ao_estoque` quando as fotos do retorno entram na conta de
`oQueFalta`. O nome e o caminho dos arquivos são testados na parte 3
(`arquivos.test.ts`). O previsto sem hora é testado em cópias dos momentos:
a Necton continua com a hora em todos.

`evento-view.test.tsx`, no molde de `estoque-mapa-mover-view.test.tsx`
(`renderToStaticMarkup` dentro de `Router ssrPath="/eventos/edicao"`; as
camadas do `BotaoDeAcao` fora da lista derrubam o teste): cinco estados, a
Necton em `no_evento` (a prancha), uma edição `confirmado` sem pedido, uma
`fechado`, uma `rascunho` e uma `enviado` (com a solicitação em `pedido`);
`foraDaLista(html, PERMITIDOS)` é `[]`, com a lista literal da
prancha: "Voltar a Eventos", "B2B Conference Necton", "No evento", "BTG
Pactual · edição 2027 · 28 e 29/01 · Hotel Unique · PED-0007 separado ·
lacre 88412", "Romaneio", "Adicionar fotos", "Registrar momento", "A edição,
momento a momento", "o previsto pelo cliente e o feito pela Dutelog",
"Pedido confirmado", "PED-0007 · 100 itens · 2.000 peças", "Separar até
26/01", "Editar", "Separado", "no armazém", "38 volumes · lacre 88412", "Ver
pedido", os oito rótulos de `ROTULO_DO_MOMENTO`, os textos de
`textoDoPrevisto`/`textoDoFeito`, "Guilherme", "1 foto", "6 fotos", "4
fotos", "Comprovante de entrega", "—", "Registrar", "Registrar fim", "Fechar
a edição", "vira história", "Faltam desmontagem, retorno e entrega de
volta", "Fotos", "11 até agora", "Adicionar", "Ver as 11 fotos",
"Documentos", "Anexar", "Layout do evento", "· cliente", "Abrir", "Equipe e
veículo", "Estoquistas", "Do cliente", "Veículo", "Contato no local",
"Histórico", os títulos dos `events` e as linhas "Guilherme · 29/01 08:02";
e, do bloco "Onde" (a spec o pede; a prancha não o desenha), "Onde",
"Local", "Endereço", "Contato", "Telefone" e o local, o endereço e o
contato do fixture, e, da primeira linha da `enviado` (a prancha só desenha
a `no_evento`), "Pedido enviado" e o número da solicitação, "PED-0007";
`violacoesDeAcessibilidade(html)` é `[]` nos cinco; o `input` das fotos tem
`capture="environment"`; o "Editar" de "Onde" aparece na `confirmado` e na
`enviado`, para quem edita o previsto; na `rascunho`, a única ação é
"Anexar"; na `enviado`, "Anexar" e os "Editar" do previsto e de "Onde", sem
"Registrar", "Registrar fim", "Registrar momento", "Adicionar fotos",
"Adicionar" nem o "Editar" da equipe, e a primeira linha diz
"Pedido enviado" e "PED-0007", sem "Pedido confirmado" e sem ação; em
`fechado` e para quem não opera não há botão de ação
(`acoesPrincipais(html)` é `[]` além de "Romaneio" e "Ver pedido").

O previsto sem hora entra na `confirmado` sem pedido, não na Necton: a
Montagem dela vem com `previsto.hora: null` (o dia 28/01 e o `ate` 19:00),
e a linha diz "previsto 28/01 até 19:00", só com o dia.

Na agenda (os testes da parte 7): `agenda.test.ts` confere que
`linhaDaAgenda(view, …).href` é `"/eventos/edicao?id=<id>"`, perde as
asserções de `orderId` (o campo sai) e confere `rotuloDaFichaNaAgenda` nos
seis grupos e nos cinco papéis de `WMS_ROLES`: "Registrar" em `em_andamento`
para owner, admin, interno e wms, e "Abrir" para o suporte; "Fechar edição"
em `para_fechar` para owner, admin e interno, e "Abrir" para o wms e o
suporte; "Abrir" nos outros quatro grupos para todos. Em
`eventos-view.test.tsx` (com `papel: "admin"`), "Ver pedido" sai da lista
da agenda e entram "Abrir", "Registrar" e "Fechar edição", o link de cada
grupo tem o `href` da ficha ("Abrir" ao lado de "Confirmar" em Para
confirmar, "Abrir" em Próximos e no rascunho, "Registrar" em Em andamento,
"Fechar edição" em Para fechar), e sem `podeConfirmar` a linha enviada tem
só "Abrir"; com `papel: "wms"`, Para fechar tem "Abrir"; com
`papel: "suporte"`, Em andamento e Para fechar têm "Abrir";
`eventos.test.tsx` clica em "Abrir" e chega a `/eventos/edicao?id=ced_1`.
Em Pedidos, um `it` em `pedidos.evento.test.tsx`, com `EVENTOS_LIBERADO`
verdadeiro e `OPERACAO_LIBERADO` falso no mock de `@/lib/liberacao` (como
na produção: o link não depende da Operação): a solicitação do evento em
"Para aprovar" e o pedido dela em "Para separar" (a tarefa com o
`customer_request_id` dela) têm "Evento" com
`href="/eventos/edicao?id=ced_0123456789abcdef"`, e a solicitação comum não
tem; com o papel `wms`, que não lê a lista das solicitações, o pedido tem o
mesmo link pela leitura por id (o `useDocumento` simulado devolve a
solicitação com o `event_edition_id`). O `it` da parte 6 no mesmo arquivo
("a solicitação do evento diz 'Evento · nome · label' em Para aprovar; …")
ganha "Evento" na lista de `textosForaDaLista`, ao lado de `...PERMITIDOS`
e "Evento · B2B Conference Necton · 2027", porque o `vi.mock` de
`@/lib/liberacao` vale para o arquivo inteiro. Em
`customer-requests-detalhe.test.tsx`, com o mesmo mock de `@/lib/liberacao`,
o detalhe da solicitação do evento tem o mesmo link.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos/ficha.test.ts src/pages/evento-view.test.tsx src/lib/wms-v3.test.ts src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/eventos/agenda.test.ts src/pages/eventos-view.test.tsx src/pages/eventos.test.tsx src/pages/pedidos.evento.test.tsx src/pages/customer-requests-detalhe.test.tsx`
Expected: FAIL (módulos não existem; as listas não têm `/eventos/edicao`; a linha da agenda não tem `href` nem `rotuloDaFichaNaAgenda`, e Pedidos não tem "Evento").

- [ ] **Step 3: Implement `ficha.ts`, the view, the page, the registries and the links from the agenda and Pedidos**

A página lê a edição por `useDocumento("evento:" + id, (db) => doc(db, "client_event_editions", id), …)` e o histórico por `useLeitura("evento-historico:" + id, (db) => query(collection(db, "events"), where("entity_id", "==", id)), …)` (uma igualdade: sem índice composto; a ordem é da `historicoDaEdicao`); as fotos abrem por `getDownloadURL`. Cada diálogo grava por `useTentativaDaEscrita` (a chave da tentativa é a `idempotency_key`; a repetição depois de "sem resposta" leva a mesma), não fecha em `andamento` e mostra a recusa do servidor no próprio diálogo (`desfechoDoErro === "recusado"`); o sucesso sai pelo toast e o foco volta à linha. "Registrar" em Entrega no local com `pedido` e sem `pedido.entregue_em` troca a hora por Quem levou, Placa e Quem recebeu e manda `entrega` sem `inicio`. "Adicionar fotos" pede o momento, roda `compactarFoto`, dá a cada foto o `arquivo` = `nomeDoArquivo("ft", foto.type)`, sobe por `enviarComProgresso` em `caminhoDoArquivoDaEdicao("foto", edicao.customer_code, id, arquivo)` e chama `anexarFoto({ edition_id, arquivo, momento_id, legenda?, idempotency_key })` por foto (`useEnvioDeFotos`, até `FOTOS_POR_VEZ`); a nova tentativa repete o `arquivo` e a chave. "Anexar" recusa por `problemaDoArquivoDaEdicao(file, "documento")` antes de subir ("Use PDF, imagem ou planilha (.xlsx).", "O documento passa de 10 MB."), sobe em `caminhoDoArquivoDaEdicao("documento", edicao.customer_code, id, arquivo)` com `arquivo` = `nomeDoArquivo("dc", file.type)` e chama `anexarDocumento({ edition_id, arquivo, nome: file.name.trim().slice(0, 120), momento_id?, idempotency_key })`, sem `tipo` nem `tamanho` (o servidor os lê no bucket). O "Editar" de "Onde" chama `salvarEdicao({ id, expected_edicao, patch: { onde } })` com Local, Endereço, Contato e Telefone (o campo vazio não vai); o do "Separar até", `salvarEdicao({ id, expected_edicao, patch: { separar_ate } })`; o do previsto (Data, Hora, Até, Local e Observação), `salvarEdicao({ id, expected_edicao, patch: { cronograma } })` com o cronograma inteiro, cada momento com o `id` dele e só o `previsto` da linha mudado (o servidor funde por `id` e mantém o `feito`). No diálogo do previsto a Hora é opcional na tela em todo momento (decisão 12 da spec): abre vazia quando `previsto.hora` é `null` e, vazia, vai `hora: null`, de propósito (a `hora` do momento é nullish no `MomentoPrevistoSchema` da parte 2, em qualquer tipo, e está na lista dos `null` aceitos do índice); os outros momentos lidos sem hora vão no cronograma do mesmo jeito, nunca com `""`. Em Entrega no local a tela também não barra: vazia, a chamada vai assim mesmo, com `hora: null`, e a recusa é a do servidor, `failed-precondition` "Informe a data e a hora da entrega no local" (fora do rascunho, o `patch` de `cronograma` passa por `problemaParaEnviar`, parte 2; o schema não recusa a entrega sem hora), mostrada no próprio diálogo, que fica aberto; a tela não tem frase própria. Nenhuma chamada manda `undefined`.

Na agenda, `linhaDaAgenda` põe o `href` (sem o `orderId`) e `EventosView` desenha o link (o `Link` do wouter) com `rotuloDaFichaNaAgenda(grupo, papel)`. Em Pedidos, o `event_edition_id` do pedido sai da solicitação da linha (`order.requestId`): da lista das solicitações (`requests`), para a coordenação, e da leitura por id de `useParaQuandoDoPedido`, para quem não lê a lista, com o mapeamento devolvendo também o `event_edition_id` (sem leitura nova); `orders:em_aberto` não muda, porque só existe com `OPERACAO_LIBERADO`, falso na produção. O link "Evento" entra nas ações da linha só com `EVENTOS_LIBERADO`; em Solicitações, o detalhe lê `request.event_edition_id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2, `npx vitest run src/pages/pedidos.aprovar.test.tsx src/pages/pedidos.entrega-lida.test.tsx src/pages/pedidos.lista.test.tsx src/pages/pedidos.prazo-que-falhou.test.tsx src/pages/customer-requests.carregamento.test.tsx` (Pedidos e Solicitações sem evento continuam iguais, e o "Para quando" lido por id também) e `cd C:\DEV\Dute; corepack pnpm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/eventos/ficha.ts artifacts/app/src/lib/eventos/ficha.test.ts artifacts/app/src/pages/evento.tsx artifacts/app/src/pages/evento-view.tsx artifacts/app/src/pages/evento-view.test.tsx artifacts/app/src/App.tsx artifacts/app/src/lib/modules.ts artifacts/app/src/lib/modules.test.ts artifacts/app/src/lib/document-title.ts artifacts/app/src/lib/document-title.test.ts artifacts/app/src/lib/wms-v3.ts artifacts/app/src/lib/wms-v3.test.ts artifacts/app/src/lib/eventos/agenda.ts artifacts/app/src/lib/eventos/agenda.test.ts artifacts/app/src/pages/eventos-view.tsx artifacts/app/src/pages/eventos-view.test.tsx artifacts/app/src/pages/eventos.tsx artifacts/app/src/pages/eventos.test.tsx artifacts/app/src/pages/pedidos.tsx artifacts/app/src/pages/pedidos.evento.test.tsx artifacts/app/src/pages/customer-requests.tsx artifacts/app/src/pages/customer-requests-detalhe.test.tsx
git commit -m "feat(app): a ficha da edição do evento na Armazenagem, com os momentos, as fotos e os documentos, e o link da agenda e de Pedidos"
```

### Task 5: a integração no emulador e a página pelo caminho de verdade

**Files:**
- Test: `functions/wms/src/domain/eventos/momentos.integration.test.ts` (`test:integration`, depois do arquivo de integração da parte 7)
- Test: `artifacts/app/src/pages/evento.test.tsx`

**Interfaces:**
- Consumes: `saveEventEditionTransaction`, `sendEventEditionTransaction` (parte 2, com `deps.criarSolicitacao` como a parte 6 liga no `index.ts`), `confirmEventEditionTransaction(db, { id, expected_edicao, separar_ate, idempotency_key }, coordenacao)` (parte 7; o `expected_edicao` é obrigatório: o da edição enviada); `createCustomerRequestTransaction`, `decideCustomerRequestTransaction`, `advanceWarehouseTaskTransaction` de `../operations.js` e os ajudantes `pedir`, `aprovar`, `separar`, `embalar` de `areas-de-passagem.integration.test.ts` (copiados); os atores `cliente`, `coordenacao` (`interno`) e `armazem` (`wms`) daquele teste; o `beforeEach` que limpa o emulador e `eventsFor(id)` de `client-events.integration.test.ts`.

- [ ] **Step 1: Write the failing tests** (os casos 1 a 7 vêm de T1; acrescente 8 a 10 e a página)

```ts
it("1. o início de Montagem numa edição confirmada sem pedido: feito com origem registro, edicao + 1, evento momento_registrado; o segundo início recusa 'Montagem já foi registrado.' e nada muda", ...)
it("2. o primeiro registro de Evento sem pedido leva a no_evento, com edicao_no_evento; Montagem antes não leva", ...)
it("3. o fim: sem início recusa; Desmontagem sem ate recusa 'Desmontagem e coleta não tem fim previsto.'; Montagem grava o fim e o segundo fim recusa", ...)
it("4. corrigir: início e fim novos com expected_edicao, corrigido_em e o evento momento_corrigido com de e para; expected_edicao velho recusa 'A edição mudou em outra aba'; a hora da entrega com origem pedido recusa e a observação dela grava", ...)
it("5. retorno_ao_estoque recusa; a fechada recusa 'A edição já está fechada.'; a enviada recusa 'A edição ainda não foi confirmada.'", ...)
it("6. a mesma chave devolve o mesmo resultado sem segunda escrita; outra chave com outro conteúdo recusa already-exists", ...)
it("7. a entrega pela ficha: o pedido separado e embalado, registrar Entrega no local com quem levou e placa deixa a remessa delivered com carrier Dutelog, 'Entrega própria Dutelog' e 'Recebido pelo cliente.', o pedido ENTREGUE, a edição no_evento com pedido.entregue_em e o feito com origem pedido, e o evento momento_registrado com origem pedido; sem entrega recusa 'Informe quem levou e a placa.'; antes de embalar recusa 'O pedido ainda não foi separado.'; repetir não entrega duas vezes (um op_advance_ por passo)", ...)
it("8. a remessa já em dispatched: só o passo delivered roda", ...)
it("9. a equipe: grava equipe e observacoes_dutelog com edicao + 1 e o evento edicao_salva com criada false; expected_edicao velho recusa; a fechada recusa", ...)
it("10. a edição de outro cliente não existe para o cliente, e existe para quem opera", ...)
```

`evento.test.tsx` (jsdom, no molde de `estoque-mapa-mover.test.tsx`; `vi.mock`
de `@/lib/wms/eventos`, `@/lib/operacao/leitura` (`useDocumento`/`useLeitura`
devolvendo a Necton e os `events`), `firebase/storage`, `@/lib/envio-de-fotos`,
`@/lib/auth`, `@/hooks/use-toast`):

```ts
it("abre a edição da busca (?id=) e 'Registrar' em Montagem manda registrarMomento com edition_id, momento_id, inicio, observacao e a chave, sem campo undefined; o diálogo não fecha em andamento e fecha no sucesso", ...)
it("Entrega no local com o pedido separado e sem entregue_em: Quem levou, Placa e Quem recebeu; sem a placa não manda; manda entrega e não manda inicio", ...)
it("'Registrar fim' manda fim; 'Editar' do feito manda corrigir e expected_edicao; a recusa 'A edição mudou em outra aba' aparece no diálogo", ...)
it("'Adicionar fotos' pede o momento, compacta, sobe em eventos/<code>/<edition>/fotos/ft_<16 hex>.jpg e chama anexarFoto com edition_id, arquivo (o ft_<16 hex>.jpg), momento_id e a chave; a callable que falha deixa 'Tentar de novo' com o mesmo arquivo e a mesma chave", ...)
it("'Anexar' sobe o .xlsx em eventos/<code>/<edition>/docs/dc_<16 hex>.xlsx e chama anexarDocumento com edition_id, arquivo, nome e momento_id, sem tipo nem tamanho; o .exe recusa antes de subir com 'Use PDF, imagem ou planilha (.xlsx).'", ...)
it("'Editar' de 'Onde' manda salvarEdicao com id, expected_edicao e patch.onde (local, endereço, contato e telefone), sem campo undefined", ...)
it("'Editar' do 'Separar até' manda salvarEdicao com expected_edicao e patch.separar_ate; o do previsto manda patch.cronograma com o id de cada momento e só o previsto da linha mudado", ...)
it("o previsto sem hora, na edição confirmada com a Desmontagem lida com previsto.hora null: o 'Editar' dela abre com a Hora vazia; a Hora apagada em Montagem manda patch.cronograma com hora null nela e na Desmontagem, sem '' nem undefined; em Entrega no local a Hora apagada também manda hora null, e a recusa do servidor (failed-precondition, 'Informe a data e a hora da entrega no local') aparece no diálogo, que não fecha", ...)
it("'Editar' da equipe manda salvarEquipe com expected_edicao e os quatro campos, null no vazio", ...)
it("o suporte não vê Registrar, Adicionar fotos, Anexar nem Editar; a fechada não tem ação", ...)
```

No caso do previsto sem hora, o `useDocumento` simulado devolve uma cópia
da Necton confirmada com a Desmontagem sem hora (`previsto.hora: null`): o
fixture continua com a hora em todos os momentos. A recusa da Entrega no
local é o `salvarEdicao` simulado rejeitando com o código
`failed-precondition` e a frase "Informe a data e a hora da entrega no
local", como o servidor faz fora do rascunho.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/domain/eventos/momentos.integration.test.js"` e
`cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/evento.test.tsx`
Expected: FAIL nos casos 8 a 10 e na página.

- [ ] **Step 3: Adjust the transactions and the page until every case passes** (sem mudar o que T1, T2 e T4 definiram, só o que os casos revelarem)

- [ ] **Step 4: Run the whole lists once**

Run: `cd C:\DEV\Dute; corepack pnpm run typecheck; npm --prefix functions/wms run test:unit; npm --prefix functions/wms run test:integration`
Expected: PASS, inclusive `callables-papeis`, `callables-auth`, `pick-progress`, `order-delivery` e o CI que registra as consultas (a de `shipments` por `order_id` já tem índice; a da ficha, uma igualdade em `events`, não precisa de composto).

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/momentos.integration.test.ts functions/wms/src/domain/eventos/momentos.ts functions/wms/src/domain/eventos/equipe.ts functions/wms/package.json artifacts/app/src/pages/evento.test.tsx artifacts/app/src/pages/evento.tsx
git commit -m "test(wms): a ficha registra, corrige e fotografa os momentos da edição no emulador"
```

### Pronto quando

No emulador, pela ficha, com a edição da Necton confirmada e separada: a
entrega (o pedido vai a entregue pela própria ficha), a montagem com o fim,
o evento começado, uma hora digitada errada corrigida, as fotos por momento,
o layout anexado e a equipe gravada; a ficha aberta pela agenda ("Abrir",
"Registrar", "Fechar edição", e "Abrir" para quem não registra nem fecha) e
pelo "Evento" de Pedidos, também sem a Operação, como na produção; o
rascunho abre só com "Anexar"; no celular, "Adicionar fotos" abre a câmera;
o `suporte` lê sem ação; o CI inteiro verde. O retorno, o preço e o botão
"Fechar edição" da ficha ficam para as partes 9 e 10. O PR registra em
`docs/superpowers/plans/2026-11-26-eventos.md` o que mudou de nome, se mudou.
