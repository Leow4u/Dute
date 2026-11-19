# O registro da rodada da contagem — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rodada da contagem vira registro (`count_rounds`): iniciar e concluir pelo servidor, com recibo e evento; a entrada da Contagem ganha "Iniciar contagem", "Concluir contagem" e as anteriores; a bancada grava com o id da rodada aberta e o servidor recusa outro id.

**Architecture:** No WMS, um módulo novo `domain/count-rounds.ts` (a regra pura dos números e do alcance, as duas transações) e um guarda em `box-recount.ts`; duas callables de uma linha no `index.ts`. No app, uma lib pura (`rodadas-da-contagem.ts`), o tipo da rodada ampliado em `recontagem-por-caixa.ts` (alcance e começo), um hook ao vivo (`use-rodadas.ts`), os clientes das callables (`lib/wms/rodadas.ts`), dois diálogos (`iniciar-contagem.tsx`, `concluir-contagem.tsx`) e as três telas lendo a rodada aberta. A recontagem geral de 17/11 vira documento ao concluir.

**Tech Stack:** Functions v2 (`onCall`), firebase-admin, zod (via genkit), node --test com o emulador; React 19, TanStack Query, wouter, Tailwind com tokens, vitest + jsdom, axe-core, `src/test/textos.ts`.

**Spec:** `docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md`

## Global Constraints

- Branch `claude/registro-da-rodada` a partir da `main` limpa; um problema por PR; teste que falha antes; sem merge automático; nada sobe sem o OK do Leonardo.
- Callable como `export const nome = onCall(`, numa linha, no `functions/wms/src/index.ts`; `getProfile` e `requireWarehouseWrite` antes da entrada; `requireCustomerScope(profile, input.customer_code)` dá o cliente.
- Teste novo das Functions entra na lista fixa do `test:unit` ou do `test:integration` em `functions/wms/package.json`. Java 21: `export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.11.10-hotspot/bin:$PATH"` antes do emulador; `npm --prefix functions/wms run build:test` antes de um teste avulso.
- Chamada de callable sem campo `undefined` (`semCamposVazios`, `lib/wms/separacao.ts`).
- Tela na v3, sem legenda (lista de textos), `axe` verde, só tokens; carregamento v2 (`LinhaDeEstado`, esqueleto, a falha nunca vira vazio, o diálogo que grava não fecha no meio); teste de espera sem tempo fixo de relógio real.
- Datas no fuso `America/Sao_Paulo`; "17/11 a 21/11"; o dia da tela decide se a hora sai com o dia.
- O id fixo `recontagem-geral-2026-11-17` e o título "Recontagem geral · 17/11/2026" não mudam.
- Testes do app: `cd artifacts/app && npx vitest run <arquivo>`; typecheck: `npx tsc --build` na raiz e depois `cd artifacts/app && npx tsc -p tsconfig.json --noEmit`.
- Commits em português (`feat(wms): …`, `feat(app): …`, `docs(plataforma): …`), terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A mesma caixa recontada duas vezes na rodada: os números contam a última recontagem dela, não as duas (a diferença líquida é a da última). Teste na Tarefa 1.
2. Concluir a recontagem geral sem nenhuma recontagem gravada (o id fixo sem documento e sem `cycle_counts`): `COUNT_ROUND_NOT_FOUND`, nunca um documento vazio. Teste na Tarefa 3.
3. A rodada da rua "A" e a prateleira "AB-01": fora do alcance (a rua é o que vem antes do hífen, não o prefixo). Teste na Tarefa 4.
4. A entrada enquanto lê as rodadas: nem "Iniciar contagem" nem "Anteriores" antes de ler; a leitura que falha mostra a falha. Teste na Tarefa 9.
5. A rodada aberta ainda sem recontagem: o cartão com "começou … · quem" do documento, zeros e "Continuar" na primeira prateleira do alcance. Teste na Tarefa 6.

---

### Task 1: A regra pura da rodada no WMS (título, alcance, números)

**Files:**
- Create: `functions/wms/src/domain/count-rounds.ts`
- Test: `functions/wms/src/domain/count-rounds.test.ts`
- Modify: `functions/wms/package.json` (`test:unit` ganha `lib/domain/count-rounds.test.js` depois de `lib/domain/box-recount.test.js`)
- Add ao commit: `docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md`, `docs/superpowers/plans/2026-11-18-registro-da-rodada.md`

**Interfaces:**
- Produces:
  ```ts
  export const COUNT_ROUNDS_COLLECTION = "count_rounds";
  export const LEGACY_ROUND_ID = "recontagem-geral-2026-11-17";
  export const LEGACY_ROUND_TITLE = "Recontagem geral · 17/11/2026";
  export const ROUND_STARTED_EVENT_TYPE = "inventory.round_started";
  export const ROUND_CLOSED_EVENT_TYPE = "inventory.round_closed";
  export type EscopoDaRodada = "general" | "aisle" | "item";
  export type AlcanceDaRodada = { scope: "general" } | { scope: "aisle"; aisle: string } | { scope: "item"; sku_code: string };
  export type NomeDoItem = { client_item_code?: string; product_name?: string; size?: string };
  export const StartCountRoundSchema; export type EntradaDoInicio;      // { customer_code, scope, aisle?, sku_code?, idempotency_key }, .strict(); aisle (/^[A-Z]{1,4}$/, maiúsculas) obrigatório no scope aisle; sku_code (maiúsculas) no item
  export function entradaDoInicio(raw: unknown): EntradaDoInicio;      // fora do formato: HttpsError invalid-argument "Contagem inválida: confira o alcance e tente de novo."
  export const CompleteCountRoundSchema; export type EntradaDaConclusao; // { customer_code, round_id (1..200), idempotency_key }, .strict()
  export function entradaDaConclusao(raw: unknown): EntradaDaConclusao;
  export function tituloDaRodada(alcance: AlcanceDaRodada, item: NomeDoItem | undefined, iniciadaEm: string): string;
  export type LinhaDaRodada = { box_recount_id: string; box_code: string; location_id: string; occurred_at: string; adjustment_delta: number; actor?: { uid?: string; role?: string; email?: string; name?: string } };
  export type CaixaDaRodada = { code: string; status: string; location_id: string; sku_codes: string[]; last_recount_round_id: string | null };
  export function ruaDaPosicao(locationId: string): string;           // "A-03" → "A"; sem hífen, ""
  export function prateleiraNoAlcance(alcance: AlcanceDaRodada, locationId: string, caixas: readonly CaixaDaRodada[], roundId: string): boolean;
  export type NumerosDaRodada = { shelves_total: number; shelves_counted: number; boxes_total: number; boxes_counted: number; boxes_with_difference: number; difference_units: number; recount_count: number };
  export function numerosDaRodada(linhas: readonly LinhaDaRodada[], caixas: readonly CaixaDaRodada[], alcance: AlcanceDaRodada, roundId: string): NumerosDaRodada & { primeira: LinhaDaRodada | null };
  ```
  Regras: a prateleira do alcance é a com caixa `stored` (ou `emptied` com `last_recount_round_id === roundId`) e, por rua, `ruaDaPosicao(locationId) === aisle`; por item, alguma dessas caixas com `sku_codes` incluindo o SKU. As recontagens: agrupadas por `box_recount_id`; a última de cada caixa pela maior `occurred_at` (empate pelo id); `boxes_counted` as caixas do alcance com última recontagem na própria prateleira; `boxes_with_difference` as com alguma linha `adjustment_delta !== 0`; `difference_units` a soma dos `adjustment_delta` das últimas; `shelves_counted` as prateleiras com `confirmadas >= total > 0`; `recount_count` as recontagens distintas; `primeira` a linha de menor `occurred_at`.

- [ ] **Passo 1: Os testes que falham**, em `count-rounds.test.ts` (node --test, `assert/strict`):

```ts
describe("o título da rodada", () => {
  it("geral, por rua e por item, com o dia de São Paulo", () => {
    assert.equal(tituloDaRodada({ scope: "general" }, undefined, "2026-11-19T11:10:00.000Z"), "Contagem geral · 19/11/2026");
    assert.equal(tituloDaRodada({ scope: "aisle", aisle: "A" }, undefined, "2026-11-19T11:10:00.000Z"), "Contagem da rua A · 19/11/2026");
    assert.equal(tituloDaRodada({ scope: "item", sku_code: "BTG-000122" }, { product_name: "Polo Masculino Piquet Preto", client_item_code: "A.01.0806.005.P", size: "P" }, "2026-11-19T11:10:00.000Z"), "Contagem de Polo Masculino Piquet Preto · P · 19/11/2026");
    assert.equal(tituloDaRodada({ scope: "item", sku_code: "BTG-000122" }, undefined, "2026-11-20T02:30:00.000Z"), "Contagem de BTG-000122 · 19/11/2026"); // 23:30 em São Paulo
  });
});
describe("a entrada", () => {
  it("o alcance pede o alvo dele, em maiúsculas; o resto recusa com a frase", () => {
    assert.deepEqual(entradaDoInicio({ customer_code: "BTG Pactual", scope: "aisle", aisle: "a", idempotency_key: "k-00000001" }).aisle, "A");
    assert.equal(entradaDoInicio({ customer_code: "BTG Pactual", scope: "item", sku_code: "btg-000122", idempotency_key: "k-00000001" }).sku_code, "BTG-000122");
    for (const raw of [{ customer_code: "BTG Pactual", scope: "aisle", idempotency_key: "k-00000001" }, { customer_code: "BTG Pactual", scope: "item", idempotency_key: "k-00000001" }, { customer_code: "BTG Pactual", scope: "general", aisle: "A", idempotency_key: "k-00000001" }, { customer_code: "BTG Pactual", scope: "tudo", idempotency_key: "k-00000001" }]) {
      assert.throws(() => entradaDoInicio(raw), (erro: HttpsError) => erro.code === "invalid-argument" && erro.message === "Contagem inválida: confira o alcance e tente de novo.");
    }
    assert.throws(() => entradaDaConclusao({ customer_code: "BTG Pactual", idempotency_key: "k-00000001" }), (erro: HttpsError) => erro.code === "invalid-argument");
  });
});
describe("o alcance", () => {
  const caixas = [c("CX-1", "A-03", ["BTG-000122"]), c("CX-2", "A-03", ["BTG-000123"]), c("CX-3", "AB-01", ["BTG-000122"]), c("CX-4", "B-01", ["BTG-000122"], "emptied", "r1"), c("CX-5", "B-02", ["BTG-000122"], "emptied", "outra")];
  it("geral: toda prateleira com caixa; por rua: a rua inteira antes do hífen; por item: a caixa guardada (ou esvaziada nesta rodada) com o item", () => {
    assert.equal(prateleiraNoAlcance({ scope: "general" }, "A-03", caixas, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "aisle", aisle: "A" }, "A-03", caixas, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "aisle", aisle: "A" }, "AB-01", caixas, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: "BTG-000122" }, "A-03", caixas, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: "BTG-000123" }, "AB-01", caixas, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: "BTG-000122" }, "B-01", caixas, "r1"), true);
    assert.equal(prateleiraNoAlcance({ scope: "item", sku_code: "BTG-000122" }, "B-02", caixas, "r1"), false);
    assert.equal(prateleiraNoAlcance({ scope: "general" }, "C-01", caixas, "r1"), false);
  });
});
describe("os números do fechamento", () => {
  it("a última recontagem de cada caixa, a prateleira contada com todas as caixas, a caixa com diferença pelos itens, a diferença líquida e a primeira recontagem", () => {
    // CX-1 recontada duas vezes (−3 e depois +3 de volta: a última vale), CX-2 com M −2 e GG +2 (diferença zero, mas com diferença), CX-3 em AB-01 sem recontagem.
    const numeros = numerosDaRodada(linhas, caixas, { scope: "general" }, "r1");
    assert.deepEqual(numeros, { shelves_total: 3, shelves_counted: 1, boxes_total: 4, boxes_counted: 3, boxes_with_difference: 2, difference_units: 3, recount_count: 4, primeira: linhas[0] });
  });
  it("a recontagem de outra rodada, e a caixa recontada em outra prateleira, não contam", () => { /* round_id e location diferentes */ });
  it("sem recontagem: zeros e primeira null", () => { assert.equal(numerosDaRodada([], caixas, { scope: "general" }, "r1").primeira, null); });
});
```

- [ ] **Passo 2: Rodar e ver falhar** — `cd functions/wms && npm run build:test && node --test lib/domain/count-rounds.test.js` → falha em "Cannot find module".
- [ ] **Passo 3: Escrever `count-rounds.ts`** com as exportações do bloco Interfaces (as transações ficam para as Tarefas 2 e 3); `tituloDaRodada` usa `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" })` e `nomeComTamanho` de `./nome-do-produto.js` para o item.
- [ ] **Passo 4: Rodar e ver passar**; acrescentar o arquivo ao `test:unit`.
- [ ] **Passo 5: Commit** — `feat(wms): a regra da rodada da contagem: título, alcance e os números do fechamento`

### Task 2: `startCountRound`

**Files:**
- Modify: `functions/wms/src/domain/count-rounds.ts`
- Modify: `functions/wms/src/index.ts` (o import depois do de `box-recount.js`; a callable logo depois de `recountWarehouseBox`)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (as linhas `startCountRound: { passam: ARMAZEM, recusa: SO_ARMAZEM }` e `completeCountRound: …`)
- Test: `functions/wms/src/domain/count-rounds.integration.test.ts` (entra no `test:integration` depois de `lib/domain/box-recount.integration.test.js`)

**Interfaces:**
- Produces:
  ```ts
  export async function startCountRoundTransaction(db: Firestore, input: EntradaDoInicio, actor: OperationalActor): Promise<ResultadoDoInicio>;
  // ResultadoDoInicio = { ok: true; round_id: string; title: string; scope; aisle?; sku_code?; status: "open"; started_at: string; events: OperationalEventSummary[] }
  ```
  O documento: `{ id, customer_code, title, scope, aisle?, sku_code?, item?: NomeDoItem, status: "open", started_at, started_by: actorFields, created_at, updated_at }` com id `cr_<digest({ customer, nonce: idempotency_key }, 24)>`. Recibo `operational_operations/op_count_round_start_<digest>` com `kind: "inventory.count_round.start"`, `input_hash`, `result`. Evento `inventory.round_started` (`title: "Contagem iniciada"`, `description: <título>`, `severity: "info"`, `inbox: false`, `entity_type: "count_round"`, `entity_id: round_id`, `payload: { round_id, title, scope, aisle?, sku_code? }`, `source: "functions_wms"`). Recusas (`failed-precondition`, `details.code`): `COUNT_ROUND_ALREADY_OPEN` ("A contagem «<título>» está em andamento: conclua-a antes de iniciar outra."), `COUNT_ROUND_LEGACY_OPEN` ("A Recontagem geral · 17/11/2026 está em andamento: conclua-a antes de iniciar outra.", quando não existe `count_rounds/<LEGACY_ROUND_ID>` e existe `cycle_counts` do cliente com esse `round_id`), `COUNT_ROUND_AISLE_NOT_FOUND` ("A rua X não está no cadastro de Posições."; `warehouse_positions where aisle == X limit 1`), `COUNT_ROUND_PRODUCT_NOT_FOUND` (como `BOX_RECOUNT_PRODUCT_NOT_FOUND`, por `resolveCatalogAggregateTargets`) e `CATALOG_OWNED_BY_OTHER_CUSTOMER` (`recordOwner`). A callable: `requireWarehouseWrite`, `entradaDoInicio(request.data)`, `requireCustomerScope`.

- [ ] **Passo 1: Os testes que falham**, no arquivo de integração (o `beforeEach` apaga o banco e grava `customers`, as posições A-03 e B-01, o cadastro de `POLO_P` e as caixas CX-000010 (A-03, abertura) e CX-000014 (B-01, recebimento), como `box-recount.integration.test.ts`):

```ts
describe("Iniciar a rodada", () => {
  it("cria a rodada aberta com o título, o recibo e o evento; a mesma chave devolve o mesmo resultado sem gravar de novo", async () => {
    const r = await iniciar({ scope: "general" });
    assert.match(r.round_id, /^cr_[0-9a-f]{24}$/);
    assert.equal(r.title, `Contagem geral · ${hoje}`);            // hoje em São Paulo, dd/mm/aaaa
    const doc = await rodada(r.round_id);
    assert.equal(doc.status, "open"); assert.equal(doc.customer_code, BTG); assert.equal(doc.started_by.name, "Guilherme Dantas");
    assert.equal((await eventos("inventory.round_started")).length, 1);
    assert.equal((await todos("operational_operations")).length, 1);
    assert.deepEqual(await iniciar({ scope: "general" }, { chave: "fixa" }), await iniciar({ scope: "general" }, { chave: "fixa" }));  // use a mesma chave nas duas
  });
  it("uma rodada aberta por cliente: a segunda recusa com o título da primeira; outro cliente pode", …);
  it("por rua, a rua precisa existir; por item, o item precisa ser do cliente", …); // COUNT_ROUND_AISLE_NOT_FOUND, COUNT_ROUND_PRODUCT_NOT_FOUND, CATALOG_OWNED_BY_OTHER_CUSTOMER; o título por item leva o nome · tamanho
  it("a recontagem geral de 17/11 sem documento, com recontagem gravada, impede iniciar outra", …); // grava um cycle_counts com round_id LEGACY_ROUND_ID → COUNT_ROUND_LEGACY_OPEN
});
```

- [ ] **Passo 2: Rodar e ver falhar** — `npm run test:integration` só com este arquivo: `npm run build:test && npx --no-install firebase emulators:exec --project demo-dute-operations --only firestore "node --test lib/domain/count-rounds.integration.test.js"` (com o PATH do Java 21).
- [ ] **Passo 3: Implementar `startCountRoundTransaction`**, a callable (uma linha, com o comentário de duas linhas acima, como `recountWarehouseBox`) e as duas linhas da matriz de papéis.
- [ ] **Passo 4: Rodar e ver passar**; rodar `callables-papeis` e `callables-auth` com o emulador e ver verde.
- [ ] **Passo 5: Commit** — `feat(wms): startCountRound inicia a rodada da contagem, uma aberta por cliente`

### Task 3: `completeCountRound`

**Files:**
- Modify: `functions/wms/src/domain/count-rounds.ts`, `functions/wms/src/index.ts`
- Test: `functions/wms/src/domain/count-rounds.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function completeCountRoundTransaction(db: Firestore, input: EntradaDaConclusao, actor: OperationalActor): Promise<ResultadoDaConclusao>;
  // ResultadoDaConclusao = { ok: true; round_id; title; scope; aisle?; sku_code?; status: "closed"; started_at; closed_at; ...NumerosDaRodada; events }
  ```
  Na transação: o recibo (`op_count_round_complete_<digest({ customer, round, nonce })>`, `kind: "inventory.count_round.complete"`); o documento da rodada: existe → do cliente (senão `permission-denied` "A contagem é de outro cliente.") e `open` (senão `COUNT_ROUND_NOT_OPEN`, "A contagem «<título>» já foi concluída."); não existe → só `LEGACY_ROUND_ID` com recontagens do cliente passa (senão `COUNT_ROUND_NOT_FOUND`, `not-found`, "A contagem não existe: abra a Contagem e inicie uma."); lê `cycle_counts where customer_code == X and round_id == R` e `warehouse_boxes where customer_code == X`; `numerosDaRodada`; grava (`update` ou, na recontagem geral, `create` com `title: LEGACY_ROUND_TITLE`, `scope: "general"`, `started_at`/`started_by` da `primeira`) com `status: "closed"`, `closed_at`, `closed_by` e os sete números; evento `inventory.round_closed` (`title: "Contagem concluída"`, `description: "5 prateleiras · 6 caixas · 1 com diferença · −3 un."`, `inbox: false`, `payload` com o round_id, o título e os números).

- [ ] **Passo 1: Os testes que falham**:

```ts
describe("Concluir a rodada", () => {
  it("fecha com os números das recontagens da rodada, o recibo e o evento; repetir a chave devolve o mesmo", async () => {
    const r = await iniciar({ scope: "general" });
    await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [{ sku_code: POLO_P, counted_qty: 57 }], round_id: r.round_id });
    const c = await concluir(r.round_id);
    assert.equal(c.status, "closed");
    assert.deepEqual([c.shelves_total, c.shelves_counted, c.boxes_total, c.boxes_counted, c.boxes_with_difference, c.difference_units, c.recount_count], [2, 1, 2, 1, 1, -3, 1]);
    assert.equal((await rodada(r.round_id)).closed_by.name, "Guilherme Dantas");
    assert.equal((await eventos("inventory.round_closed"))[0].description, "1 de 2 prateleiras · 1 de 2 caixas · 1 com diferença · −3 un.");
  });
  it("concluída, não conclui de novo nem aceita recontagem; de outro cliente, permission-denied; inexistente, not-found", …);
  it("a recontagem geral de 17/11, sem documento: concluir cria o documento concluído com o começo da primeira recontagem", async () => {
    await recontar({ box_code: "CX-000010", location_id: "A-03", lines: [{ sku_code: POLO_P, counted_qty: 60 }], round_id: LEGACY_ROUND_ID }, rafael);
    const c = await concluir(LEGACY_ROUND_ID);
    const doc = await rodada(LEGACY_ROUND_ID);
    assert.equal(doc.title, "Recontagem geral · 17/11/2026"); assert.equal(doc.started_by.name, "Rafael"); assert.equal(doc.started_at, (await todos("cycle_counts"))[0].occurred_at);
  });
  it("a recontagem geral sem recontagem nenhuma não é rodada: not-found", …);
});
```

- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar `completeCountRoundTransaction`** e a callable.
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit** — `feat(wms): completeCountRound conclui a rodada com os números; a recontagem geral de 17/11 vira documento ao concluir`

### Task 4: `recountWarehouseBox` só grava na rodada aberta do cliente

**Files:**
- Modify: `functions/wms/src/domain/count-rounds.ts` (`conferirRodadaDaRecontagem`)
- Modify: `functions/wms/src/domain/box-recount.ts` (a leitura do documento da rodada junto com a caixa e a posição; a conferência do alcance depois de `caixasDaPrateleira`)
- Test: `functions/wms/src/domain/box-recount.integration.test.ts` (describe novo "Recontar a caixa: a rodada")

**Interfaces:**
- Produces:
  ```ts
  export type RodadaLida = { id: string; customer_code: string; title: string; status: string; alcance: AlcanceDaRodada } | null;
  export async function lerRodada(transaction: Transaction, db: Firestore, roundId: string): Promise<RodadaLida>;  // null quando não existe
  export function conferirRodadaDaRecontagem(rodada: RodadaLida, roundId: string, customerCode: string, locationId: string, caixasDaPrateleira: readonly CaixaDaRodada[]): void;
  ```
  Recusas: `BOX_RECOUNT_ROUND_NOT_FOUND` (`failed-precondition`, "A contagem não existe mais: abra a Contagem e inicie uma.") para o id sem documento que não é o fixo; `permission-denied` "A contagem é de outro cliente."; `BOX_RECOUNT_ROUND_CLOSED` ("A contagem «<título>» já foi concluída: abra a Contagem e inicie outra."); `BOX_RECOUNT_OUT_OF_SCOPE` ("A prateleira B-01 está fora da contagem «<título>»."). O id fixo sem documento passa.

- [ ] **Passo 1: Os testes que falham**:

```ts
describe("Recontar a caixa: a rodada", () => {
  it("a rodada aberta do cliente grava; a concluída recusa; a que não existe recusa; o id fixo sem documento passa", …);
  it("fora do alcance: a prateleira de outra rua e a prateleira sem caixa com o item recusam; a rodada da rua A aceita A-03 e recusa AB-01", …);
  it("a rodada de outro cliente é permission-denied", …);
});
```

- [ ] **Passo 2: Rodar e ver falhar.** — `node --test lib/domain/box-recount.integration.test.js` no emulador.
- [ ] **Passo 3: Implementar** (a leitura do documento antes de qualquer escrita; a conferência do alcance usa `caixasDaPrateleira` já lidas, mapeadas para `CaixaDaRodada`).
- [ ] **Passo 4: Rodar e ver passar**, com `billing-callables.integration.test.js` também.
- [ ] **Passo 5: Commit** — `feat(wms): a recontagem só grava na rodada aberta do cliente e dentro do alcance dela`

### Task 5: Regras, zeragem e índices

**Files:**
- Modify: `firestore.rules` (o bloco `count_rounds` depois de `cycle_counts`, `allow read: if canReadOperations(); allow create, update, delete: if false;`)
- Modify: `functions/wms/src/firestore.rules.test.ts` (se o teste do ledger lista coleções, `count_rounds` entra; senão, um `it` novo: a operação lê, o cliente não, ninguém grava)
- Modify: `tools/test_full_reset_btg.py` (`APAGADAS_DE_PROPOSITO["count_rounds"] = "rodadas da contagem, que saem com o estoque"`; `test_count_rounds_go_with_the_stock`, como `test_stock_age_goes_with_the_stock`)

- [ ] **Passo 1: O teste que falha** — `python -m unittest discover -s tools -p "test_full_reset_btg.py" -v -k count_rounds` e o `it` das regras.
- [ ] **Passo 2: Implementar.**
- [ ] **Passo 3: Conferir os índices** — rodar o `test:integration` inteiro com `NODE_OPTIONS=--require <raiz>/tools/registrar_consultas.cjs` e `CONSULTAS_SAIDA=<scratchpad>/consultas.jsonl`, depois `python tools/indices_das_consultas.py <arquivo>` → saída sem índice faltando (as consultas novas são só por igualdade).
- [ ] **Passo 4: Commit** — `feat(wms): count_rounds nas regras e na zeragem`

### Task 6: A rodada com alcance e começo no app (lib pura)

**Files:**
- Modify: `artifacts/app/src/lib/warehouse-ops/recontagem-por-caixa.ts` (`RodadaDaRecontagem`, `RODADA_DA_RECONTAGEM_GERAL`, `rodadaDaContagem`, `RodadaDaContagem`)
- Create: `artifacts/app/src/lib/warehouse-ops/rodadas-da-contagem.ts`
- Test: `artifacts/app/src/lib/warehouse-ops/recontagem-por-caixa.test.ts`, `artifacts/app/src/lib/warehouse-ops/rodadas-da-contagem.test.ts`

**Interfaces:**
- Produces (em `recontagem-por-caixa.ts`):
  ```ts
  export type AlcanceDaRodada = { tipo: "geral" } | { tipo: "rua"; rua: string } | { tipo: "item"; sku: string; nome: string };
  export type Momento = { quando: string; quem: string };
  export type RodadaDaRecontagem = { id: string; titulo: string; alcance: AlcanceDaRodada; inicio: Momento | null; fim?: Momento | null };
  export const RODADA_DA_RECONTAGEM_GERAL: RodadaDaRecontagem; // { id, titulo, alcance: { tipo: "geral" }, inicio: null }
  export function prateleiraNoAlcance(alcance: AlcanceDaRodada, posicao: string, rua: string, caixas: readonly WarehouseBox[], rodada: string): boolean;
  export type RodadaDaContagem = { …os campos de hoje; alcance: AlcanceDaRodada; concluida: Momento | null };
  // rodadaDaContagem: filtra as prateleiras pelo alcance (as caixas da prateleira: as guardadas e as esvaziadas nesta rodada); comeco = rodada.inicio ?? a primeira recontagem; concluida = rodada.fim ?? null
  ```
- Produces (em `rodadas-da-contagem.ts`):
  ```ts
  export type NumerosDaRodada = { prateleiras: number; prateleirasContadas: number; caixas: number; caixasConfirmadas: number; caixasComDiferenca: number; diferenca: number };
  export type RodadaRegistrada = RodadaDaRecontagem & { cliente: string; status: "aberta" | "concluida"; fim: Momento | null; numeros: NumerosDaRodada | null };
  export function rodadaRegistrada(id: string, data: Record<string, unknown>): RodadaRegistrada | null;   // scope/aisle/sku_code/item.product_name+size → alcance (o nome por nomeComTamanho; sem nome, o SKU); started_at/started_by.name|email → inicio; closed_* → fim; shelves_* etc. → numeros (só concluída)
  export function rodadaAberta(registradas: readonly RodadaRegistrada[], cliente: string | null, legadaTemRecontagem: boolean): RodadaDaRecontagem | null; // a aberta do cliente de started_at mais recente; sem ela, RODADA_DA_RECONTAGEM_GERAL quando legadaTemRecontagem e nenhuma registrada tem o id fixo
  export function anterioresDaContagem(registradas: readonly RodadaRegistrada[], cliente: string | null): RodadaRegistrada[]; // as concluídas do cliente, fim mais recente primeiro
  export function periodoDaRodada(rodada: Pick<RodadaRegistrada, "inicio" | "fim">): string; // "17/11 a 21/11 · Guilherme Dantas"; mesmo dia "21/11 · Guilherme Dantas"; sem fim ""
  export function numerosDaRodadaConcluida(numeros: NumerosDaRodada): string; // "5 prateleiras · 6 caixas · 1 com diferença · −3 un."; "4 de 5 prateleiras · 5 de 6 caixas · sem diferença"; singular em 1 ("1 prateleira · 1 caixa")
  export function avisoDasPorContar(rodada: Pick<RodadaDaContagem, "prateleiras" | "prateleirasContadas">): string | null; // "3 prateleiras por contar ficam fora." | "1 prateleira por contar fica fora." | null
  export function hrefDaRodada(id: string): string;        // "/estoque/contagem/rodada?rodada=<id codificado>"
  export function rodadaDaBusca(busca: string): string | null;
  export type EscolhaDoAlcance = { tipo: "geral" } | { tipo: "rua"; rua: string } | { tipo: "item"; sku: string };
  export function entradaDoInicio(cliente: string, escolha: EscolhaDoAlcance): { customer_code: string; scope: "general" | "aisle" | "item"; aisle?: string; sku_code?: string }; // sem campo vazio
  ```

- [ ] **Passo 1: Os testes que falham** — em `recontagem-por-caixa.test.ts`, no describe "a rodada por prateleira": "por rua, só as prateleiras da rua; por item, só as com caixa guardada que tem o item", "o começo vem do documento da rodada quando ele existe; sem recontagem, zeros e Continuar na primeira prateleira do alcance" (Review Focus 5) e "a recontagem geral continua com o começo da primeira recontagem". Em `rodadas-da-contagem.test.ts`: o mapeamento do documento (os três alcances, aberta e concluída, campos faltando → null), `rodadaAberta` (a aberta; a legada sem documento com recontagem; nada), `anterioresDaContagem` (a ordem), `periodoDaRodada` (dois dias, o mesmo dia, sem quem), `numerosDaRodadaConcluida` (tudo contado, parcial, sem diferença, singular), `avisoDasPorContar`, `entradaDoInicio` (sem campo vazio), `hrefDaRodada`/`rodadaDaBusca`.
- [ ] **Passo 2: Rodar e ver falhar** — `cd artifacts/app && npx vitest run src/lib/warehouse-ops/recontagem-por-caixa.test.ts src/lib/warehouse-ops/rodadas-da-contagem.test.ts`.
- [ ] **Passo 3: Implementar**; os usos de `RODADA_DA_RECONTAGEM_GERAL` e `rodadaDaContagem` continuam compilando (`cartao-da-rodada.test.tsx`, as views) — acrescentar `alcance` e `concluida` aos objetos sintéticos dos testes existentes.
- [ ] **Passo 4: Rodar e ver passar**, com `cartao-da-rodada.test.tsx`, `estoque-contagem-rodada-view.test.tsx` e `contagem-view.test.tsx`.
- [ ] **Passo 5: Commit** — `feat(app): a rodada da contagem com alcance e começo; o registro lido de count_rounds`

### Task 7: O hook das rodadas e os clientes das callables

**Files:**
- Create: `artifacts/app/src/lib/warehouse-ops/use-rodadas.ts`
- Modify: `artifacts/app/src/lib/warehouse-ops/use-recontagem.ts` (`useLeiturasDaRodada(cliente, rodada: string | null, catalogo)` e `useBancadaDaPrateleira(cliente, posicao, rodada: string | null)`: sem rodada, as recontagens não são lidas; exportar `useCatalogoDoCliente(ligado)` (o `useCatalogo` de hoje))
- Create: `artifacts/app/src/lib/wms/erro-da-callable.ts` (o mapeamento do erro que hoje mora em `lib/wms/recontagem.ts`: `erroDaCallable(error): ErroDaCallable`), `artifacts/app/src/lib/wms/rodadas.ts`
- Modify: `artifacts/app/src/lib/wms/recontagem.ts` (usa `erroDaCallable`)
- Test: `artifacts/app/src/lib/wms/rodadas.test.ts` (o corpo sem campo vazio e o erro com código e detalhe, com `httpsCallable` mockado)

**Interfaces:**
- Produces:
  ```ts
  export type LeituraDasRodadas = { aberta: RodadaDaRecontagem | null; anteriores: RodadaRegistrada[]; registradas: RodadaRegistrada[]; carregando: boolean; falhou: boolean; leitura: NovaTentativa };
  export function useRodadasDaContagem(cliente: string | null): LeituraDasRodadas;
  // useLeitura `count_rounds:${cliente}` (where customer_code == cliente) + `cycle_counts:${cliente}:${LEGACY}:uma` (where customer_code == cliente, where round_id == RODADA_DA_RECONTAGEM_GERAL.id, limit(1)); aberta = rodadaAberta(registradas, cliente, legadas.length > 0)
  export type EntradaDoInicio = ReturnType<typeof entradaDoInicio>;
  export type RespostaDoInicio = { ok?: boolean; round_id: string; title: string; status?: string; started_at?: string };
  export async function iniciarContagem(entrada: EntradaDoInicio & { idempotency_key: string }): Promise<RespostaDoInicio>;      // callable "startCountRound"
  export type RespostaDaConclusao = { ok?: boolean; round_id: string; title: string; status?: string; closed_at?: string; shelves_total?: number; shelves_counted?: number; boxes_total?: number; boxes_counted?: number; boxes_with_difference?: number; difference_units?: number };
  export async function concluirContagem(entrada: { customer_code: string; round_id: string; idempotency_key: string }): Promise<RespostaDaConclusao>; // "completeCountRound"
  ```

- [ ] **Passo 1: Os testes que falham** (`rodadas.test.ts`, com `vi.mock("firebase/functions")`): "iniciar manda o alcance sem campo vazio e devolve a resposta", "concluir manda o cliente e a rodada", "a recusa vira erro com o código e o detalhe do servidor".
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar** (o hook segue `useLeiturasDaRodada`; `erro-da-callable.ts` extraído sem mudar o comportamento de `recontarCaixa`).
- [ ] **Passo 4: Rodar e ver passar**, com `estoque-contagem-prateleira.test.tsx` (que mocka `useLeitura`) ainda verde.
- [ ] **Passo 5: Commit** — `feat(app): as rodadas do cliente ao vivo e as chamadas de iniciar e concluir`

### Task 8: Os diálogos "Iniciar contagem" e "Concluir contagem"

**Files:**
- Create: `artifacts/app/src/features/warehouse-ops/iniciar-contagem.tsx`, `artifacts/app/src/features/warehouse-ops/concluir-contagem.tsx`
- Test: `artifacts/app/src/features/warehouse-ops/iniciar-contagem.test.tsx`, `artifacts/app/src/features/warehouse-ops/concluir-contagem.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function IniciarContagemConteudo({ ruas, produtos, catalogoFalhou, estado, onCancelar, onIniciar }: { ruas: readonly string[]; produtos: readonly ProdutoDoCatalogo[]; catalogoFalhou: boolean; estado: EstadoDaAcao; onCancelar: () => void; onIniciar: (escolha: EscolhaDoAlcance) => void });
  export function IniciarContagemDialog({ aberto, onFechar, ...props }: { aberto: boolean; onFechar: () => void } & Omit<Parameters<typeof IniciarContagemConteudo>[0], "onCancelar">);
  export function ConcluirContagemConteudo({ rodada, estado, onCancelar, onConcluir }: { rodada: RodadaDaContagem; estado: EstadoDaAcao; onCancelar: () => void; onConcluir: () => void });
  export function ConcluirContagemDialog({ aberto, rodada, estado, onFechar, onConcluir, focoAoFechar }: …);
  ```
  Iniciar: `DialogTitle` "Iniciar contagem"; "Alcance" com `Segmented` ("Geral", "Por rua", "Por item"); por rua, `Label` "Rua" e `Select` com "Rua A"…; por item, `Label` "Item", `Input` da busca (`buscarProdutos`, até 8) e a lista de botões com nome e código; o escolhido fica com "Trocar"; `DialogCancelar` e `BotaoDeAcao` (`rotulo` "Iniciar contagem", `andamento` "Iniciando…", `sucesso` "Iniciada", `erro` "Não iniciada", `bloqueado` sem rua ou sem item). Concluir: `DialogTitle` "Concluir contagem"; o título da rodada; `dl` com "Prateleiras contadas" "2 de 5", "Caixas confirmadas" "3 de 6", "Caixas com diferença" "1", "Diferença líquida" "−3 un."; `avisoDasPorContar`; `DialogCancelar` e `BotaoDeAcao` ("Concluir contagem", "Concluindo…", "Concluída", "Não concluída"). Os dois: `Dialog ocupado` com o estado em andamento ou sucesso.

- [ ] **Passo 1: Os testes que falham** (`renderToStaticMarkup` do conteúdo; `textosDaTela` exato por alcance; `violacoesDeAcessibilidade` vazio; com `createRoot` + `act`: escolher "Por rua", a rua A e iniciar chama `onIniciar({ tipo: "rua", rua: "A" })`; "Por item" com a busca "polo" lista e escolhe; sem rua, o botão fica `aria-disabled`; concluir chama `onConcluir` e o aviso das por contar aparece só com prateleira por contar).
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit** — `feat(app): os diálogos de iniciar e concluir a contagem`

### Task 9: A entrada da Contagem com iniciar, concluir e as anteriores

**Files:**
- Modify: `artifacts/app/src/pages/contagem-view.tsx`, `artifacts/app/src/pages/contagem.tsx`
- Test: `artifacts/app/src/pages/contagem-view.test.tsx`, `artifacts/app/src/pages/contagem.test.tsx`

**Interfaces:**
- A view ganha: `anteriores: RodadaRegistrada[]`; `iniciar: { aberto: boolean; estado: EstadoDaAcao; ruas: readonly string[]; produtos: readonly ProdutoDoCatalogo[]; catalogoFalhou: boolean; onAbrir: () => void; onFechar: () => void; onIniciar: (escolha: EscolhaDoAlcance) => void } | null` (null enquanto há rodada aberta ou antes de ler); `concluir: { aberto: boolean; estado: EstadoDaAcao; onAbrir: () => void; onFechar: () => void; onConcluir: () => void } | null`; `rodada` continua o cartão (null sem rodada aberta).
  Cabeçalho: com `iniciar`, o primário "Iniciar contagem" (ícone `ChevronRight`) antes de "Folha de contagem". Cartão: as ações "Continuar X", "Ver prateleiras" e "Concluir contagem" (`variant="outline"`). "Anteriores": uma `li` por rodada concluída (`CheckCircle2`, o título, `periodoDaRodada`, `numerosDaRodadaConcluida`, `Button asChild variant="outline"` "Ver" → `hrefDaRodada`, com `aria-label` "Ver <título>") e a abertura por último; a seção aparece com qualquer linha. Os diálogos renderizados pela view.
  A page: `useRodadasDaContagem(cliente)`; `useLeiturasDaRodada(cliente, rodada?.id ?? null, …)`; `useCatalogoDoCliente` e `produtosDoCliente` para o item; `ruasDaContagem(leitura.prateleiras)`; duas `useMutation` com `useTentativaDaEscrita` (`enviar(escolha, () => entradaDoInicio(cliente, escolha), iniciarContagem)`; `enviar({ rodada: id }, () => ({ customer_code: cliente, round_id: id }), concluirContagem)`); sucesso: toast "Contagem iniciada" / "Contagem concluída" (description: o título / `numerosDaRodadaConcluida`), o diálogo fecha; erro: `avisoDoErroDaEscrita` com `description: erro.message`, o diálogo fica. O estado `carregando` inclui `rodadas.carregando`; `erro`, `rodadas.falhou`.

- [ ] **Passo 1: Os testes que falham** — view: "sem rodada aberta: Iniciar contagem no cabeçalho, e Anteriores com a recontagem geral concluída e a abertura" (a lista exata: `[...CABECALHO com "Iniciar contagem", "Anteriores", "Recontagem geral · 17/11/2026", "17/11 a 21/11 · Guilherme Dantas", "5 prateleiras · 6 caixas · 1 com diferença · −3 un.", "Ver", ...ABERTURA]`), "com rodada aberta: Concluir contagem no cartão e sem Iniciar", os links ("Ver" → `/estoque/contagem/rodada?rodada=…`), carregando (nem Iniciar nem Anteriores; Review Focus 4), a falha, o axe. Page: "sem rodada aberta e com recontagens legadas sem documento, a recontagem geral é a rodada em andamento", "iniciar manda o alcance pela callable e o cartão aparece quando a leitura traz a rodada", "concluir manda a rodada aberta", "a leitura das rodadas que falha mostra a falha".
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit** — `feat(app): a Contagem inicia e conclui a rodada e lista as anteriores`

### Task 10: A Contagem por caixa lê a rodada aberta e mostra a concluída

**Files:**
- Modify: `artifacts/app/src/pages/estoque-contagem-rodada.tsx`, `artifacts/app/src/pages/estoque-contagem-rodada-view.tsx`, `artifacts/app/src/features/warehouse-ops/cartao-da-rodada.tsx`
- Test: `artifacts/app/src/pages/estoque-contagem-rodada-view.test.tsx`, `artifacts/app/src/pages/estoque-contagem-rodada.test.tsx` (novo, com os mocks de `contagem.test.tsx`)

**Interfaces:**
- `EstadoDaRodada` ganha `"sem_rodada"`; a view com ele mostra `SEM_RODADA_ABERTA = "Nenhuma contagem em andamento."` e `Button asChild` "Iniciar contagem" → `/wms/contagem`. A view ganha `somenteLeitura?: boolean`: sem "Continuar" no cabeçalho e sem a ação das prateleiras. `CartaoDaRodada`: com `rodada.concluida`, a linha sob o título é `periodoDaRodada` em vez de "começou …". A page: `rodadaDaBusca(useSearch())` → a registrada com esse id (`rodadas.registradas`), concluída ou não; sem ela, `rodadas.aberta`; sem as duas, `sem_rodada` (depois de ler).

- [ ] **Passo 1: Os testes que falham** — view: "sem rodada aberta: a frase e Iniciar contagem, nada de prateleiras", "a rodada concluída: o período no cartão, sem Continuar e sem ação nas prateleiras" (lista de textos), o axe dos dois; page: "sem ?rodada e sem rodada aberta, diz que não há contagem", "?rodada=<id> mostra aquela rodada só leitura".
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit** — `feat(app): a Contagem por caixa usa a rodada aberta; a concluída abre só leitura`

### Task 11: A bancada grava com a rodada aberta

**Files:**
- Modify: `artifacts/app/src/pages/estoque-contagem-prateleira.tsx`, `artifacts/app/src/pages/estoque-contagem-prateleira-view.tsx`
- Test: `artifacts/app/src/pages/estoque-contagem-prateleira.test.tsx`, `artifacts/app/src/pages/estoque-contagem-prateleira-view.test.tsx`

**Interfaces:**
- `EstadoDaPrateleira` ganha `"sem_rodada"` (`MENSAGENS.sem_rodada = "Nenhuma contagem em andamento."`, com o `Button asChild` "Iniciar contagem" → `/wms/contagem` sob a frase). A page: `useRodadasDaContagem(cliente)`; `rodada = rodadas.aberta?.id ?? null`; `useBancadaDaPrateleira(cliente, posicao, rodada)`; `carregando` inclui `rodadas.carregando`; sem rodada depois de ler → `sem_rodada`; `entradaDaRecontagem({ cliente, posicao, rodada })` com a aberta.

- [ ] **Passo 1: Os testes que falham** — page: "a chamada leva o id da rodada aberta lida de count_rounds" (substitui o uso de `RODADA_DA_RECONTAGEM_GERAL` no teste "a recontagem geral atravessa o dia": a rodada vem do documento aberto), "sem rodada aberta e sem recontagem legada, a bancada diz que não há contagem e não grava", "a recontagem geral sem documento continua a rodada"; view: o estado novo com a frase e o link, o axe.
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: Rodar e ver passar**; typecheck do app verde.
- [ ] **Passo 5: Commit** — `feat(app): a bancada grava na rodada aberta; sem rodada, não conta`

### Task 12: O registro

**Files:**
- Modify: `docs/plataforma/diagnostico-contagem-ciclica.md` (seção 6, item 4: o parágrafo "*O registro da rodada no código desde 18/11/2026 (PR N):*" e a lista "Ficam" sem a coleção; seção 7: as duas decisões de 18/11/2026 e as escolhas aprovadas), `docs/mockups/README.md` (a linha de `02-iniciar-contagem.png`: "No código desde 18/11/2026 (PR N)"), `CLAUDE.md` (a descrição da Contagem em "Telas novas seguem a v3": o registro da rodada, `count_rounds`, iniciar e concluir)

- [ ] **Passo 1: Escrever**, no tom dos registros anteriores (o que mudou, as recusas, as travas, o que fica).
- [ ] **Passo 2: Commit** — `docs(plataforma): o registro da rodada no diagnóstico, nas pranchas e no contrato`

### Task 13: Verificação e PR

- [ ] **Passo 1: As Functions** — `npm --prefix functions/wms run test:critical` (com o Java 21); os dois de concorrência que oscilam nesta máquina se confirmam sozinhos.
- [ ] **Passo 2: O app** — os testes da mudança e as travas (`theme-colors`, `carregando/trava`, `platform-lists`, `wms-v3`, `cloud-api-indices`); `npx tsc --build` na raiz e o typecheck do app; `python -m unittest discover -s tools -p "test_*.py"`.
- [ ] **Passo 3: O emulador com a tela** — `firebase emulators:start` (auth, firestore, functions do WMS) nas portas de `lib/emuladores.ts`, o seed no scratchpad (usuário wms, BTG com a abertura concluída, posições, cadastro, caixas, saldos), `.env.local` do exemplo, `preview_start` "app": iniciar uma rodada geral, recontar A-03 pela bancada (a chamada com o id dela), concluir e ver a rodada em "Anteriores" com os números; a foto da entrada depois de concluir. Apagar o `.env.local` e parar os emuladores (pelas portas) ao fim.
- [ ] **Passo 4: Push e PR** (`gh pr create`, sem `--auto`), com o roteiro (o pedido, o que muda, as recusas, os testes, o emulador) e a foto; avisar a sessão que abriu este trabalho.
