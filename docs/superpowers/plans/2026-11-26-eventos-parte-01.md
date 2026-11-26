# Eventos · parte 1: domínio, coleções, liberação e zeragem

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a base que as outras partes usam: as regras puras do evento em
`lib/dominio` com a cópia no WMS, a liberação por ambiente nas duas cópias,
as três coleções nas regras do Firestore com os índices, e o lugar delas na
zeragem.

**Architecture:** nada muda no app nem nas callables; só entram arquivos
novos, três `match` nas regras, cinco índices e uma tupla na zeragem. Tudo
travado por teste: a cópia literal (padrão `areas-de-passagem`), a liberação
(padrão `RECEBIMENTO_POR_CAIXA`), as regras (padrão `firestore.rules.test.ts`)
e a zeragem (`tools/test_full_reset_btg.py`).

**Tech Stack:** TypeScript, vitest (app), `node --test` e
`@firebase/rules-unit-testing` no emulador (Functions), Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções "O
cronograma", "Os status e quem move cada um", "Regras do Firestore, índices
e zeragem", "Liberação por ambiente e o legado". Índice do plano:
`docs/superpowers/plans/2026-11-26-eventos.md` (restrições e interfaces
valem aqui).

## Global Constraints

As do índice. Nesta parte, ainda: nenhuma callable nova, nenhuma tela; o CI
inteiro continua verde sem o app saber dos Eventos.

## Review Focus

1. Um momento `outro` sem `rotulo` recusa com "Informe o rótulo do outro
   momento" (T1).
2. O cronograma com a entrega no local no dia 28 às 08:30 e a coleta no
   cliente no dia 28 às 05:00 **na ordem da lista** (coleta antes) é
   válido; invertido na lista, recusa dizendo qual momento está antes (T1).
3. A regra deixa o cliente ler só com `where customer_code == o seu`; a
   consulta sem o filtro falha (T4).
4. O `comercial` lê `client_event_prices` e não lê `client_event_editions`
   (T4).
5. A zeragem preserva os eventos de auditoria `functions_client_events` e
   continua apagando `client_event_templates` (T6).

---

### Task 1: `lib/dominio/src/eventos.ts`, os casos e o teste do app

**Files:**
- Create: `lib/dominio/src/eventos.ts`
- Create: `lib/dominio/src/eventos.casos.json`
- Modify: `lib/dominio/src/index.ts` (uma linha `export * from "./eventos";`, em ordem alfabética entre `dinheiro` e `nome-do-produto`)
- Test: `artifacts/app/src/lib/eventos.test.ts`

**Interfaces:**
- Produces (tudo exportado de `@workspace/dominio`):
  - `STATUS_DA_EDICAO = ["rascunho","enviado","confirmado","separado","no_evento","retornado","fechado","cancelado"] as const`, `type StatusDaEdicao`.
  - `ROTULO_DO_STATUS: Record<StatusDaEdicao, string>` = Rascunho, Enviado, Confirmado, Separado, No evento, Retornado, Fechado, Cancelado.
  - `TIPOS_DE_MOMENTO = ["coleta_no_cliente","entrega_no_local","montagem","evento","desmontagem","retorno_ao_estoque","entrega_de_volta","outro"] as const`, `type TipoDeMomento`.
  - `ROTULO_DO_MOMENTO: Record<TipoDeMomento, string>` = "Coleta no cliente", "Entrega no local", "Montagem", "Evento", "Desmontagem e coleta", "Retorno ao estoque Dutelog", "Entrega de volta no cliente", "Outro momento".
  - `ORIGENS_DO_FEITO = ["registro","pedido","retorno"] as const`.
  - `LIMITES` (objeto `as const`): `nome: 120, descricao: 300, local: 160, endereco: 300, contatoNome: 120, contatoTelefone: 40, observacaoDoMomento: 300, observacoes: 2000, coletaOnde: 300, coletaObservacao: 500, itens: 100, quantidade: 1_000_000, momentos: 12, outros: 5, fotos: 200, documentos: 20, legenda: 60, equipeTexto: 120, veiculo: 60, retornoObservacaoDoItem: 120, retornoObservacao: 500, motivo: 500, label: 40, rotulo: 60`.
  - `TRANSICOES: Record<StatusDaEdicao, readonly StatusDaEdicao[]>` = rascunho→[enviado]; enviado→[confirmado, cancelado]; confirmado→[separado, no_evento, cancelado]; separado→[no_evento, cancelado]; no_evento→[retornado]; retornado→[fechado]; fechado→[]; cancelado→[].
  - `podeTransitar(de: StatusDaEdicao, para: StatusDaEdicao): boolean`.
  - `edicaoAberta(status: unknown): boolean` (true para rascunho, enviado, confirmado, separado, no_evento, retornado).
  - `type MomentoPrevisto = { tipo: TipoDeMomento; rotulo?: string | null; data: string; hora: string; ate?: string | null; local?: string | null; observacao?: string | null }`.
  - `problemaDoCronograma(momentos: readonly MomentoPrevisto[], contexto: { comItensDoEstoque: boolean; comColeta: boolean }): string | null`, a primeira recusa, nesta ordem: "O cronograma leva até 12 momentos"; "O cronograma leva até cinco momentos do tipo outro"; "O momento <Rótulo> se repete" (tipo fora de `outro` duas vezes); "Informe o rótulo do outro momento"; "Informe a data do evento"; com `comItensDoEstoque`, "Informe a data e a hora da entrega no local" e "Informe a data do retorno ao estoque"; com `comColeta`, "Informe a data da coleta no cliente"; "<Rótulo> está antes de <Rótulo anterior>" quando `data`+`hora` de um momento de tipo fixo é menor que a do tipo fixo anterior na lista (igual vale). O `outro` fica fora da ordem (ajuste da revisão final, 26/11/2026: o formulário põe os `outro` depois dos sete, e a regra literal recusaria todo `outro` antes da entrega de volta; registro no índice, "Ordem do cronograma").
  - `naoVoltaram(foi: number, voltou: number, avariadas: number): number` = `foi − voltou − avariadas`, nunca negativo.
  - `labelPadrao(momentos: readonly MomentoPrevisto[]): string | null` = os quatro dígitos do ano da `data` do momento `evento`, ou null.

- [ ] **Step 1: Write the failing test**

`artifacts/app/src/lib/eventos.test.ts`, no molde de `areas-de-passagem.test.ts` (vitest, lê `../../../../lib/dominio/src/eventos.casos.json`):

```ts
describe("eventos: casos de referência", () => {
  it("os status e os tipos de momento são os da spec, e o JSON foi lido", () => {
    expect([...STATUS_DA_EDICAO]).toEqual(["rascunho","enviado","confirmado","separado","no_evento","retornado","fechado","cancelado"]);
    expect([...TIPOS_DE_MOMENTO]).toEqual(["coleta_no_cliente","entrega_no_local","montagem","evento","desmontagem","retorno_ao_estoque","entrega_de_volta","outro"]);
    expect(casos.transicoes.length).toBeGreaterThanOrEqual(12);
    expect(casos.cronogramas.length).toBeGreaterThanOrEqual(12);
  });
  for (const caso of casos.transicoes) it(`transição: ${caso.de} → ${caso.para}`, () => expect(podeTransitar(caso.de, caso.para)).toBe(caso.pode));
  for (const caso of casos.cronogramas) it(`cronograma: ${caso.caso}`, () => expect(problemaDoCronograma(caso.momentos, caso.contexto)).toBe(caso.problema));
  for (const caso of casos.retornos) it(`não voltaram: ${caso.caso}`, () => expect(naoVoltaram(caso.foi, caso.voltou, caso.avariadas)).toBe(caso.naoVoltaram));
  for (const caso of casos.labels) it(`label: ${caso.caso}`, () => expect(labelPadrao(caso.momentos)).toBe(caso.label));
  it("edicaoAberta é verdadeiro de rascunho a retornado", () => expect(STATUS_DA_EDICAO.map(edicaoAberta)).toEqual([true,true,true,true,true,true,false,false]));
});
```

Os casos de `eventos.casos.json` (`transicoes`, `cronogramas`, `retornos`,
`labels`): todas as transições válidas e três inválidas (fechado→rascunho,
no_evento→cancelado, rascunho→confirmado); os cronogramas da Necton (os sete
momentos válidos, com itens e coleta), sem `evento`, sem entrega com itens,
sem retorno com itens, sem coleta com coleta, o `outro` sem rótulo, dois
`montagem`, seis `outro`, 13 momentos, a entrega antes da coleta na lista
("Entrega no local está antes de Coleta no cliente"), e o cronograma só com
`evento` sem itens nem coleta (válido); retornos (2000/1994/3 → 3;
100/100/0 → 0; 10/9/3 → 0); labels ("2027-01-29" → "2027"; sem evento →
null).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos.test.ts`
Expected: FAIL (o módulo `eventos` não existe em `@workspace/dominio`).

- [ ] **Step 3: Implement `lib/dominio/src/eventos.ts` with the exports above and `eventos.casos.json`, and export it from `lib/dominio/src/index.ts`**

Funções puras, sem Firestore nem Date (a comparação de ordem é por texto
`${data}T${hora}`). O cabeçalho do arquivo diz que `functions/wms` guarda a
cópia literal em `domain/eventos/dominio.ts` (como o de `areas-de-passagem.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\DEV\Dute; corepack pnpm run typecheck` e depois
`cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/eventos.test.ts`
Expected: PASS em todos os casos.

- [ ] **Step 5: Commit**

```bash
git add lib/dominio/src/eventos.ts lib/dominio/src/eventos.casos.json lib/dominio/src/index.ts artifacts/app/src/lib/eventos.test.ts
git commit -m "feat(dominio): status, momentos e limites da edição do evento"
```

### Task 2: a cópia literal no WMS e a trava

**Files:**
- Create: `functions/wms/src/domain/eventos/dominio.ts` (cópia literal de `lib/dominio/src/eventos.ts`, com a primeira linha `// Cópia literal de lib/dominio/src/eventos.ts (não edite aqui).`)
- Test: `functions/wms/src/domain/eventos/dominio.test.ts`
- Modify: `functions/wms/package.json` (`test:unit`: acrescentar `lib/domain/eventos/dominio.test.js` ao fim da lista)

**Interfaces:**
- Produces: os mesmos nomes de T1, importáveis de `./dominio.js` dentro de `functions/wms/src/domain/eventos/`.

- [ ] **Step 1: Write the failing test**

`dominio.test.ts`, cópia de `functions/wms/src/domain/areas-de-passagem.test.ts`
com os caminhos trocados (`ORIGINAL = "../../../../../lib/dominio/src/eventos.ts"`,
`COPIA = "../../../src/domain/eventos/dominio.ts"`,
`CASOS = "../../../../../lib/dominio/src/eventos.casos.json"`: um nível a
mais, porque o teste compila em `lib/domain/eventos/`), a regex da linha de
origem com `eventos\.ts`, e os mesmos `for` dos casos de T1 em `node:test`
(`assert.equal` e `assert.deepEqual`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/dominio.test.js`
Expected: FAIL (`./dominio.js` não existe).

- [ ] **Step 3: Copy the file and register the test**

Copie `lib/dominio/src/eventos.ts` para `functions/wms/src/domain/eventos/dominio.ts`
sem editar nada além da primeira linha; acrescente o teste à lista de
`test:unit` em `functions/wms/package.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/dominio.test.js`
Expected: PASS, inclusive "é idêntico a lib/dominio/src/eventos.ts".

- [ ] **Step 5: Commit**

```bash
git add functions/wms/src/domain/eventos/dominio.ts functions/wms/src/domain/eventos/dominio.test.ts functions/wms/package.json
git commit -m "feat(wms): cópia literal do domínio dos eventos, travada"
```

### Task 3: a liberação por ambiente nas duas cópias

**Files:**
- Modify: `artifacts/app/src/lib/liberacao.ts` (ao fim, no molde do bloco `RECEBIMENTO_POR_CAIXA`)
- Create: `functions/wms/src/domain/eventos/liberacao.ts`
- Test: `functions/wms/src/domain/eventos/liberacao.test.ts` (`test:unit`)
- Test: `artifacts/app/src/lib/platform-lists.test.ts` (um `describe` novo)

**Interfaces:**
- Produces (app): `EVENTOS_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"]`, `eventosLiberado(projectId: string | null | undefined): boolean`, `EVENTOS_LIBERADO = eventosLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID)`.
- Produces (Functions): `EVENTOS_PROJECTS = ["dute-homolog"]`, `eventosLiberado(projectId: string | undefined): boolean`, `assertEventosLiberado(projectId: string | undefined): void` (lança `HttpsError("failed-precondition", "Eventos ainda não liberados neste ambiente.")`).

- [ ] **Step 1: Write the failing tests**

Em `platform-lists.test.ts`:

```ts
describe("os Eventos iguais em todo lugar (eventos, parte 1)", () => {
  const liberacao = read("functions/wms/src/domain/eventos/liberacao.ts");
  it("a liberação das callables é a do app: só a homologação até a parte 12", () => {
    expect(tsList(liberacao, "EVENTOS_PROJECTS")).toEqual([...EVENTOS_AMBIENTES_LIBERADOS]);
    expect([...EVENTOS_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog"]);
    expect([eventosLiberado("dute-homolog"), eventosLiberado("dute-prod"), eventosLiberado("dute-btg"), eventosLiberado(undefined)]).toEqual([true, false, false, false]);
  });
});
```

Em `liberacao.test.ts` (node:test): `eventosLiberado("dute-homolog") === true`,
`eventosLiberado("dute-prod") === false`, e `assertEventosLiberado("dute-prod")`
lança com `code === "failed-precondition"` e a frase exata.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/platform-lists.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/liberacao.test.js`
Expected: FAIL (arquivo e exports não existem).

- [ ] **Step 3: Implement the two files**

O bloco do app segue o comentário e a forma do `RECEBIMENTO_POR_CAIXA`;
o das Functions, a forma de `inbound-mode.ts` (`RECEBIMENTO_POR_CAIXA_PROJECTS`),
com o comentário dizendo que a lista é a cópia de `EVENTOS_AMBIENTES_LIBERADOS`
travada por `platform-lists.test.ts`. Registre `lib/domain/eventos/liberacao.test.js`
em `test:unit`.

- [ ] **Step 4: Run tests to verify they pass**

Run: os dois comandos do passo 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/app/src/lib/liberacao.ts artifacts/app/src/lib/platform-lists.test.ts functions/wms/src/domain/eventos/liberacao.ts functions/wms/src/domain/eventos/liberacao.test.ts functions/wms/package.json
git commit -m "feat: liberação por ambiente dos Eventos, homologação primeiro"
```

### Task 4: as regras do Firestore das três coleções e o teste

**Files:**
- Modify: `firestore.rules` (três `match` novos logo depois de `match /client_order_tracking/{orderId}`)
- Test: `functions/wms/src/eventos.rules.test.ts` (`test:integration`, depois de `lib/firestore.rules.test.js`)

**Interfaces:**
- Produces: as regras
  ```
  match /client_events/{eventId} {
    allow read: if canReadOperations() || isOwnProjectionWith('wms');
    allow create, update, delete: if false;
  }
  match /client_event_editions/{editionId} {
    allow read: if canReadOperations() || isOwnProjectionWith('wms');
    allow create, update, delete: if false;
  }
  // O dinheiro da edição: quem lê valores e o próprio cliente. O wms não lê.
  match /client_event_prices/{editionId} {
    allow read: if canReadPrices() || isOwnProjectionWith('wms');
    allow create, update, delete: if false;
  }
  ```

- [ ] **Step 1: Write the failing test**

`eventos.rules.test.ts`, no molde de `firestore.rules.test.ts` (o `seed` com
os onze papéis, `CUSTOMER_A`/`CUSTOMER_B`, e um documento semeado em cada
coleção para A e para B: `client_events/cve-a`, `client_event_editions/ced-a`,
`client_event_prices/ced-a` e os `-b`). Casos:

```ts
it("o evento e a edição: a equipe do WMS e o próprio cliente leem; o outro cliente, o comercial e o campo não", ...)
// owner-a, admin-a, ops-a, wms-a, support-a, client-a: assertSucceeds(getDoc(ced-a)) e getDoc(cve-a)
// client-b, comercial-a, campo-a, rh-a, finance-a: assertFails nos dois
it("o cliente lista só com o filtro do próprio código", ...)
// client-a: assertSucceeds(getDocs(query(collection("client_event_editions"), where("customer_code","==",CUSTOMER_A))))
// client-a: assertFails(getDocs(collection("client_event_editions")))
it("o preço: owner, admin, financeiro, comercial e o próprio cliente leem; wms, interno, suporte e o outro cliente não", ...)
// assertSucceeds: owner-a, admin-a, finance-a, comercial-a, client-a; assertFails: wms-a, ops-a, support-a, client-b
it("ninguém escreve pelo navegador", ...)
// para owner-a e client-a: assertFails em setDoc, updateDoc e deleteDoc nas três coleções
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/eventos.rules.test.js"`
Expected: FAIL (sem `match`, tudo cai no deny: as leituras permitidas falham).

- [ ] **Step 3: Add the three `match` blocks and register the test**

Em `firestore.rules`, depois do bloco de `client_order_tracking`; o teste
na lista de `test:integration`.

- [ ] **Step 4: Run test to verify it passes**

Run: o comando do passo 2.
Expected: PASS. Rode também `node --test lib/firestore.rules.test.js` no
mesmo `emulators:exec`: o caso "eventos do portal só passam pelas Cloud
Functions" continua verde (`client_event_templates` segue fechada).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules functions/wms/src/eventos.rules.test.ts functions/wms/package.json
git commit -m "feat(regras): as três coleções dos Eventos, lidas pela equipe e pelo próprio cliente"
```

### Task 5: os índices

**Files:**
- Modify: `firestore.indexes.json` (cinco entradas, no formato das existentes: `collectionGroup`, `queryScope: "COLLECTION"`, `fields` com `fieldPath` e `order`)

**Interfaces:**
- Produces: `client_event_editions` (customer_code ASC, updated_at DESC); (customer_code ASC, status ASC, updated_at DESC); (status ASC, separar_ate ASC); (status ASC, updated_at DESC); `client_events` (customer_code ASC, status ASC, name ASC).

- [ ] **Step 1: Add the five entries**

Mantenha a ordem alfabética por `collectionGroup` se o arquivo a segue; o
JSON continua válido (`node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`).

- [ ] **Step 2: Verify**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/cloud-api-indices.test.ts`
Expected: PASS (nenhuma consulta nova ainda; o teste só confere o arquivo).
Na publicação, `tools/esperar_indices.py` espera os cinco ficarem prontos.

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat(regras): índices das edições e dos eventos do cliente"
```

### Task 6: a zeragem preserva as coleções e os eventos de auditoria

**Files:**
- Modify: `tools/full_reset_btg.py` (tupla `EVENTOS_COLLECTIONS`, constante `EVENTOS_EVENT_SOURCE`, o que `ZAP_COLLECTIONS` e `FINANCEIRO_EVENT_SOURCE` têm: `preserved_collections`, `removable`, a função `eventos_event`, o relato do dry-run `preserve_eventos_events`)
- Modify: `tools/test_full_reset_btg.py` (tupla `EVENTOS`, os dois testes de `preserved_collections` que listam as tuplas, um teste novo)
- Modify: `docs/novo-go-live-zeragem-total.md` (uma linha na tabela das coleções e o parágrafo dos eventos preservados)

**Interfaces:**
- Produces: `EVENTOS_COLLECTIONS = ("client_events", "client_event_editions", "client_event_prices")`, `EVENTOS_EVENT_SOURCE = "functions_client_events"`.

- [ ] **Step 1: Write the failing tests**

Em `tools/test_full_reset_btg.py`: a tupla `EVENTOS` por extenso; acrescente
`| set(EVENTOS)` em `test_default_preserves_access_setup_and_comercial` e no
teste de `include_setup=True`; e:

```python
def test_eventos_ficam_na_zeragem(self) -> None:
    # A edição é a história do ano seguinte: fica com e sem --include-setup; o legado client_event_templates vai embora.
    for nome in EVENTOS:
        for include_setup in (False, True):
            self.assertIn(nome, full_reset_btg.preserved_collections(include_setup=include_setup))
    self.assertNotIn("client_event_templates", full_reset_btg.preserved_collections(include_setup=False))

def test_eventos_de_auditoria_dos_eventos_ficam(self) -> None:
    documento = {"name": PREFIX + "events/evt-1", "fields": {"source": {"stringValue": "functions_client_events"}}}
    self.assertFalse(full_reset_btg.removable("events", documento, control_name="x"))
    outro = {"name": PREFIX + "events/evt-2", "fields": {"source": {"stringValue": "functions"}}}
    self.assertTrue(full_reset_btg.removable("events", outro, control_name="x"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute; py -3 -m unittest discover -s tools -p "test_*.py" -v`
Expected: FAIL nos três testes tocados.

- [ ] **Step 3: Implement in `tools/full_reset_btg.py`**

A tupla e a constante ao lado de `ZAP_COLLECTIONS` e `FINANCEIRO_EVENT_SOURCE`,
com o comentário dizendo que a edição é a história do ano seguinte; a
entrada em `preserved_collections`; `eventos_event(collection, document)`
como `financeiro_event`; `removable` com `and not eventos_event(...)`; o
dry-run relata `preserve_eventos_events` como relata os outros. Grave com
`newline="\n"` se usar script.

- [ ] **Step 4: Run tests to verify they pass**

Run: o comando do passo 2.
Expected: PASS em toda a suíte da pasta `tools`.

- [ ] **Step 5: Update the doc and commit**

Em `docs/novo-go-live-zeragem-total.md`: a linha `| Eventos | client_events,
client_event_editions, client_event_prices | **Nunca apagadas**, nem com
--include-setup. A história de cada edição (o que foi, o que voltou, fotos
e preço) é do cliente para o ano seguinte; os pedidos e movimentos ligados
a ela vão embora, e a edição guarda as próprias cópias. |` e, no parágrafo
dos eventos preservados, `functions_client_events` ao lado dos três.

```bash
git add tools/full_reset_btg.py tools/test_full_reset_btg.py docs/novo-go-live-zeragem-total.md
git commit -m "feat(zeragem): as coleções e os eventos de auditoria dos Eventos ficam"
```

### Pronto quando

`corepack pnpm run typecheck`, `npm --prefix functions/wms run test:unit`,
`npm --prefix functions/wms run test:integration` e a suíte da pasta `tools`
verdes; `git status` só com os arquivos desta parte; o app continua igual
para quem usa (nenhuma rota, menu ou tela nova).
