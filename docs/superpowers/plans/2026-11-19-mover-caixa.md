# Mover caixa entre prateleiras — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mover uma caixa guardada de uma prateleira para outra, uma por vez, com a sugestão do sistema e a troca à mão, deixando o Mapa, o Caixas × saldo, a separação, o FIFO e a etiqueta certos.

**Architecture:** no WMS (`functions/wms`, codebase `default`), um módulo novo `domain/box-move.ts` com a prévia (só leitura) e o mover (uma transação: caixa, saldos, razão, linhas da abertura, evento, recibo), mais três ajustes pontuais: a ordem do mover em `warehouse-boxes.ts`, a leitura do FIFO em `datas-do-saldo.ts` e a etiqueta em `box-relabel.ts`. No app, a página v3 `/estoque/mapa/mover`, aberta pelo Mapa. Dois PRs: servidor (Tasks 1–7), tela (Tasks 8–11).

**Tech Stack:** TypeScript, Firebase Functions v2 (`onCall`), Firestore (transações, emulador nos testes), Zod (`genkit`), `node --test`; React 19, wouter, TanStack Query, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-mover-caixa-design.md` (aprovado em 19/11/2026); mockup aprovado em `docs/mockups/mover-caixa/`.

## Global Constraints

- Trabalhar no worktree `C:\DEV\Dute\.claude\worktrees\mover-caixa`; nunca trocar de branch, fazer stash ou reset na pasta `C:\DEV\Dute` (outras sessões usam a mesma pasta). PR 1 na branch `claude/mover-caixa-servidor`; PR 2 na `claude/mover-caixa-tela`, criada a partir da PR 1.
- Arquivos com LF (o repositório é `eol=lf`).
- Callable do WMS: `getProfile` primeiro, depois `requireWarehouseWrite` (owner, admin, interno, wms; frase "Ação permitida somente para administração ou operação de armazém."), a entrada pelo Zod com a frase para quem opera (o ZodError cru vira INTERNAL), o cliente por `requireCustomerScope`.
- Toda escrita numa transação, com recibo em `operational_operations` (repetição com a mesma chave devolve o mesmo resultado; outro conteúdo, `already-exists`) e evento em `events` no mesmo fluxo. Nenhum campo de preço ou custo.
- O cliente nunca vê caixa nem prateleira: o evento cita `CX-` no título (o rascunho vira interno por `citaCaixa`, `index.ts`) e vai com `inbox: false`.
- O mover fica fora da cobrança (`source: "functions_box_move"`, fora de `wms_receiving`/`wms_shipping`) e do relógio dos parados (fora de `ORIGENS_QUE_CONTAM`). `client_inventory` e os agregados do catálogo não mudam.
- O `stored_at` da caixa nunca muda no mover.
- Teste novo das Functions só roda se entrar na lista do `test:unit` ou do `test:integration` em `functions/wms/package.json`.
- No app: tela nova na v3, sem legenda (só rótulos, dados e ações), com o teste dos textos (`src/test/textos.ts`) e o `axe` (`src/test/acessibilidade.ts`); carregamento v2 (`BotaoDeAcao`, `CarregandoNaRegiao`, `FalhaNaLeitura`; nada de `animate-spin` fora do `Spinner`, de "..." nem de cor fixa); a chamada da callable não manda campo `undefined` (`semCamposVazios`).
- Comandos nesta máquina: Functions com `npm --prefix functions/wms ...` (no worktree, `npm ci` antes); o emulador exige o Java 21 no PATH (`export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.11.10-hotspot/bin:$PATH"`); teste avulso das Functions depois de `npm run build:test`. App com `cd artifacts/app && npx vitest run <arquivo>` (o `corepack pnpm --filter ... run test` trava aqui); typecheck do app com `npx tsc --build` na raiz e `npx tsc -p artifacts/app/tsconfig.json --noEmit`.
- Commits em português, no estilo `feat(wms): …`/`fix(app): …`/`docs(plataforma): …`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem merge automático; produção só com o OK do Leonardo.

## Review Focus

1. **Duas pessoas movem a mesma caixa ao mesmo tempo:** uma grava, a outra recusa com `BOX_MOVE_WRONG_SHELF` (a caixa já não está onde a tela viu). Teste na Task 5.
2. **A caixa aberta (com `taken_lines` e `count_adjustments`):** move o saldo dela (entrada − retirado + ajustes), nunca o `unit_count`. Teste na Task 5.
3. **Ida e volta (A-01 → B-09 → A-01):** os saldos e as datas do FIFO voltam ao que eram. Testes nas Tasks 2 e 5.
4. **O destino com caixa a caminho (`committing`):** ela ocupa a frente no encaixe; a caixa que não cabe por causa dela recusa com `BOX_MOVE_DOES_NOT_FIT`. Teste na Task 5.
5. **O código digitado à mão no celular ("121", "cx-121"):** abre a `CX-000121`; o texto que não é código de caixa não chama o servidor. Teste na Task 8.

---

### Task 1: A ordem do mover

**Files:**
- Modify: `functions/wms/src/domain/warehouse-boxes.ts` (ao lado de `suggestPosition`, sem mudá-la)
- Test: `functions/wms/src/domain/warehouse-boxes.test.ts`

**Interfaces:**
- Consumes: `placementFor`, `emptyOccupancy`, `SlottingPosition`, `PositionOccupancy`, `BoxDimensions`, `BoxPlacementOptions`, `Placement` (do mesmo arquivo).
- Produces:

```ts
export type DestinoDoMover = {
  code: string;
  /** 1: já tem algum item da caixa em saldo; 2: as outras, a mais vazia primeiro. */
  tier: 1 | 2;
  reason: string;
  /** A frente livre antes da caixa, em metros, três casas. */
  free_front_m: number;
  /** As caixas guardadas ou a caminho na prateleira (`box_count` da ocupação). */
  box_count: number;
  sequence: number;
  placement: Placement;
};
export type DestinosDoMover = { prateleiras: DestinoDoMover[]; nao_cabem: string[]; rejected: string | null };
export function destinosDoMover(
  caixa: BoxDimensions & Pick<BoxPlacementOptions, "allow_tilt" | "allow_stacking"> & { customer_code: string; sku_codes: readonly string[] },
  positions: readonly SlottingPosition[],
  occupancy: ReadonlyMap<string, PositionOccupancy>,
  options: { origem: string; fora?: ReadonlySet<string>; nomeDoItem?: (sku: string) => string },
): DestinosDoMover;
```

- [ ] **Step 1: Os testes que falham** (`describe("a ordem do mover")` em `warehouse-boxes.test.ts`; prateleiras 1,80 × 0,75 × 0,65 da zona "BTG Pactual", caixa 0,40 × 0,60 × 0,35 com `sku_codes: ["BTG-000112"]`, `nomeDoItem: () => "Polo Masculino Piquet Preto · M"`):
  - `o mesmo produto vem antes da mais vazia`: A-01 (origem), B-09 com o SKU e 1,42 m livres, C-02 vazia → `prateleiras.map((p) => p.code)` é `["B-09", "C-02"]`, `tier` `[1, 2]`, `reason` `["Já tem Polo Masculino Piquet Preto · M e ainda cabe.", "A mais vazia da zona: 1,80 m livres de frente."]`.
  - `no mesmo nível, a de mais frente livre primeiro e, no empate, a caminhada`: três sem o SKU com 0,98 (seq 5), 1,38 (seq 4) e 1,38 (seq 3) → `["seq 3", "seq 4", "0,98"]` pelos códigos; a segunda e a terceira com `reason` `"1,38 m livres de frente."` e `"0,98 m livres de frente."`.
  - `a origem, a inativa, a de outra zona e a de fora não entram`: com `status: "blocked"`, `status: "review"`, `customer_code: "Itaú"` e `fora: new Set(["B-10"])` → nenhuma delas em `prateleiras` nem em `nao_cabem`.
  - `a que não cabe vai para nao_cabem, na caminhada`: duas com 0,20 m livres (seq 7 e 6) → `nao_cabem` `["seq 6", "seq 7"]` pelos códigos.
  - `sem nenhuma, a frase`: só a origem na zona → `prateleiras` `[]`, `rejected` `"Nenhuma outra prateleira da zona de BTG Pactual recebe esta caixa agora."`; zona vazia → a frase de `suggestPosition` ("Nenhuma prateleira está na zona de BTG Pactual. …").
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix functions/wms run build:test && node --test functions/wms/lib/domain/warehouse-boxes.test.js` (de `functions/wms`: `node --test lib/domain/warehouse-boxes.test.js`). Esperado: FAIL, `destinosDoMover` não existe.
- [ ] **Step 3: Implementar `destinosDoMover`** — a zona é `customer_code === caixa.customer_code`; entram as `active`, fora da `origem` e de `fora`; o encaixe é `placementFor(position, caixa, occupancy.get(code) ?? emptyOccupancy(), { allow_tilt, allow_stacking })` (sem `support_box_code`); as ativas que não cabem vão para `nao_cabem` (sequência, depois código). Ordem: `tier`, `free_front_m` decrescente, `sequence`, `code`. O motivo do nível 1 usa o primeiro SKU de `caixa.sku_codes` presente em `sku_codes` da ocupação; o primeiro do nível 2 leva "A mais vazia da zona: …", os outros só a frente. Metros em pt-BR com duas casas.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando; esperado: PASS, inclusive os testes antigos de `suggestPosition`.
- [ ] **Step 5: Commit** — `feat(wms): a ordem do mover: o mesmo produto, depois a mais vazia`.

### Task 2: O FIFO do mover

**Files:**
- Modify: `functions/wms/src/domain/datas-do-saldo.ts` (`entradasDoRazao` e o cabeçalho)
- Modify: `docs/plataforma/fifo-por-data.md` (um parágrafo: a ENTRADA do mover tira o dia da origem)
- Test: `functions/wms/src/domain/datas-do-saldo.test.ts`

**Interfaces:**
- Produces: `entradasDoRazao` com a mesma assinatura. A ENTRADA com `fifo_from_location_id` (texto não vazio) entra no local dela, como hoje, e tira as mesmas peças, do mesmo dia, de `chaveDoLocal(fifo_from_location_id)`; as retiradas se aplicam depois de juntar todas as entradas, nunca abaixo de zero, e a entrada zerada sai da lista.

- [ ] **Step 1: Os testes que falham** (`describe("o mover de caixa")`):
  - `a caixa mais nova sai e a origem fica com o dia das que ficaram`: A-01 com ENTRADA 100 em 2026-10-20 e 30 em 2026-11-10; ENTRADA do mover em B-09, 30, `fifo_day: "2026-11-10"`, `fifo_from_location_id: "A-01"` → `entradasDoRazao(...).get("A-01")` é `[{ dia: "2026-10-20", quantidade: 100 }]`, `get("B-09")` é `[{ dia: "2026-11-10", quantidade: 30 }]`; e `datasDoSaldo({ qty_on_hand: 100 }, A-01).fisicas` é `[{ dia: "2026-10-20", quantidade: 100 }]`.
  - `o dia que a origem não tem não tira nada`: o mover com `fifo_day` que A-01 não tem → A-01 igual à de antes.
  - `nunca abaixo de zero`: retirada de 50 de um dia com 30 → o dia sai, os outros ficam.
  - `a caixa da abertura vale o dia da sessão nos dois lados`: ENTRADA da abertura em A-01 com `opening_inventory_session_id: "opening_BTG_Pactual"` e o mover com `fifo_opening_session_id: "opening_BTG_Pactual"` → com `{ id: "opening_BTG_Pactual", started_at: "2026-10-20T11:00:00.000Z" }`, A-01 perde as peças do dia 2026-10-20 e B-09 as ganha.
  - `ida e volta`: A-01 → B-09 e depois B-09 → A-01 com as mesmas peças → A-01 e B-09 iguais às de antes da ida (B-09 sem entrada).
- [ ] **Step 2: Rodar e ver falhar** — de `functions/wms`: `npm run build:test && node --test lib/domain/datas-do-saldo.test.js`. Esperado: FAIL nos casos novos.
- [ ] **Step 3: Implementar** a retirada em `entradasDoRazao` como na Interface; o cabeçalho do arquivo ganha a regra numa frase.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando, mais `node --test lib/domain/datas-do-estoque.test.js` se existir (os casos de `datas-do-saldo.casos.json` continuam).
- [ ] **Step 5: Commit** — `feat(wms): a ENTRADA do mover tira o dia da caixa da prateleira de origem no FIFO`.

### Task 3: A etiqueta da caixa movida

**Files:**
- Modify: `functions/wms/src/domain/box-relabel.ts`
- Create: `functions/wms/src/domain/box-relabel.test.ts`
- Modify: `functions/wms/src/domain/box-relabel.integration.test.ts`
- Modify: `functions/wms/package.json` (`lib/domain/box-relabel.test.js` no `test:unit`)

**Interfaces:**
- Produces:

```ts
/** A caixa movida cuja etiqueta ainda diz a prateleira antiga: guardada, com `moved_at` e sem a impressão dele. */
export function caixaMovidaSemEtiqueta(box: Row): boolean;
/** Agora também a caixa movida sem etiqueta nova. */
export function etiquetaParaTrocar(box: Row): boolean;
```
- `recordBoxBalanceLabelPrint` registra a caixa aberta ou a guardada com `moved_at`: na aberta grava `balance_label_printed_for = balance_at` (como hoje); na movida grava `location_label_printed_for = moved_at`; `balance_label_printed_at`, `_by` e `_count` em toda registrada. A que não é nenhuma das duas continua em `skipped`.

- [ ] **Step 1: Os testes que falham** — unitários: `a caixa movida intacta pede etiqueta nova` (stored, `moved_at: "2026-11-19T17:32:00.000Z"` → `etiquetaParaTrocar` true); `a impressão do mover tira a caixa da lista` (`location_label_printed_for` igual ao `moved_at` → false); `a caixa intacta que nunca se moveu não pede` (false); `a vazia não pede` (`status: "emptied"` com `moved_at` → false); `a aberta continua como antes` (taken_units 3, sem impressão → true). Integração: `a caixa intacta movida registra a impressão e sai da lista` (a callable de domínio com a caixa movida → `printed` tem o código, o documento ganha `location_label_printed_for` igual ao `moved_at`, `skipped` vazio).
- [ ] **Step 2: Rodar e ver falhar** — `npm run build:test && node --test lib/domain/box-relabel.test.js`; esperado: FAIL.
- [ ] **Step 3: Implementar** como na Interface; o cabeçalho de `box-relabel.ts` diz a caixa movida.
- [ ] **Step 4: Rodar e ver passar** — o unitário, e a integração do arquivo no emulador: `npx --no-install firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test --test-concurrency=1 lib/domain/box-relabel.integration.test.js"` (com o PATH do Java 21). Esperado: PASS.
- [ ] **Step 5: Commit** — `feat(wms): a caixa movida entra em "Etiquetas para trocar" até a impressão`.

### Task 4: As regras puras do mover

**Files:**
- Create: `functions/wms/src/domain/box-move.ts` (a entrada, as constantes, as frases e o alcance da contagem)
- Create: `functions/wms/src/domain/box-move.test.ts`
- Modify: `functions/wms/src/domain/box-recount.ts` (exportar `entradaDaCaixa`, `nomeDe`, `nomeDoItem` e o tipo `NomeDoItem`, sem mudar o corpo)
- Modify: `functions/wms/src/domain/count-rounds.ts` (`lerRodadaAberta`)
- Modify: `functions/wms/package.json` (`lib/domain/box-move.test.js` no `test:unit`)

**Interfaces:**
- Consumes: `prateleiraNoAlcance`, `CaixaDaRodada`, `RodadaLida`, `LEGACY_ROUND_ID`, `LEGACY_ROUND_TITLE`, `COUNT_ROUNDS_COLLECTION`, `alcanceDoDocumento` (`count-rounds.ts`); `LEGACY_CUSTOMER_CODE` (`customer-scope.ts`).
- Produces:

```ts
export const BOX_MOVE_SOURCE = "functions_box_move";
export const BOX_MOVED_EVENT_TYPE = "warehouse.box_moved";
export const MOTIVO_DO_MOVER = "Mudança de prateleira";
export const PreviewBoxMoveSchema: z.ZodType; // { customer_code: 1..160, box_code: /^CX-\d{6,}$/ em maiúsculas } .strict()
export const MoveWarehouseBoxSchema: z.ZodType; // + from_location_id e to_location_id (1..40), suggestion?: { position: 1..40, alternatives: string[] ≤ 5 } .strict(), idempotency_key 8..200; .strict()
export type EntradaDaPreviaDoMover = z.output<typeof PreviewBoxMoveSchema>;
export type EntradaDoMover = z.output<typeof MoveWarehouseBoxSchema>;
export function entradaDaPreviaDoMover(raw: unknown): EntradaDaPreviaDoMover; // fora do formato: invalid-argument "Caixa inválida: confira o código e tente de novo."
export function entradaDoMover(raw: unknown): EntradaDoMover;                 // a mesma frase
/** A origem como está (com a caixa) e o destino como ficaria (com a caixa) no alcance da rodada aberta. */
export function prateleirasNaContagem(
  rodada: Pick<RodadaLida, "id" | "alcance"> | null,
  caixas: readonly CaixaDaRodada[],
  mover: { box_code: string; origem: string; destino: string },
): { origem: boolean; destino: boolean };
// count-rounds.ts
/** A rodada aberta do cliente; na BTG, a recontagem geral de 17/11 sem documento e com recontagem gravada é a geral aberta. */
export async function lerRodadaAberta(transaction: Transaction, db: Firestore, customerCode: string): Promise<RodadaLida | null>;
```
- As frases das recusas (exportadas, usadas pela prévia e pelo mover; código → texto, com os nomes no lugar):
  - `BOX_MOVE_BOX_NOT_FOUND`: "A caixa {CX} não está cadastrada. Confira o código na etiqueta da caixa."
  - `BOX_MOVE_BOX_NOT_STORED`: "A caixa {CX} não está guardada numa prateleira: só a caixa guardada muda de prateleira."
  - `BOX_MOVE_WRONG_SHELF`: "A caixa {CX} está em {atual}, não em {vista}: atualize a tela."
  - `BOX_MOVE_SHELF_NOT_FOUND`: "A prateleira {P} não está cadastrada em Estoque › Posições."
  - `BOX_MOVE_NOT_A_SHELF`: "{AREA} é área de passagem, não prateleira: a caixa muda só entre prateleiras."
  - `BOX_MOVE_SAME_SHELF`: "A caixa {CX} já está em {P}."
  - `BOX_MOVE_SHELF_UNAVAILABLE`: "A prateleira {P} está {em verificação|bloqueada}: escolha outra."
  - `BOX_MOVE_OTHER_ZONE`: "A prateleira {P} não é da zona de {cliente}."
  - `BOX_MOVE_DOES_NOT_FIT`: "A caixa {CX} não cabe em {P}: escolha outra prateleira."
  - `BOX_MOVE_SUPPORTS_ANOTHER`: "A caixa {CY} está em cima da {CX}: mova a de cima primeiro."
  - `BOX_MOVE_RESERVED`: "{item} está reservado em {origem} para o pedido {PED}: mova a caixa depois da entrega." (sem o número do pedido: "… reservado em {origem}: …")
  - `BOX_MOVE_DESTINATION_RESERVED`: "{item} está reservado em {destino} para o pedido {PED}: escolha outra prateleira ou mova depois da entrega."
  - `BOX_MOVE_COUNT_ROUND_OPEN`: "{P} está na contagem «{título}»: conclua a contagem antes de mover."
  - `BOX_MOVE_OPENING_OPEN`: "A abertura de {cliente} está em andamento: na abertura, use Corrigir caixa."
  - `BOX_MOVE_SHELF_SHORT`: "A prateleira {origem} tem {n} un. de {item} e a caixa {CX} diz {m}: a prateleira precisa do acerto antes (Caixas × saldo, na Contagem)."
  - `BOX_MOVE_DUPLICATED_BALANCE`: "Mais de um saldo existe para {SKU} em {P}."

- [ ] **Step 1: Os testes que falham** (`box-move.test.ts`): `a entrada recusa o código que não é de caixa e o campo a mais` (frase acima, `issues` no detalhe); `a contagem geral trava a origem` (`{ origem: true, destino: true }` com a caixa guardada em A-01 e destino C-02); `a contagem por rua trava só a rua` (rua A: A-01→C-02 `{true,false}`, C-01→A-02 `{false,true}`, C-01→C-02 `{false,false}`); `a contagem por item vê a caixa chegando` (a caixa com o item vai para C-02 sem caixas → `destino: true`; a origem sem outra caixa com o item → `origem: true`); `sem rodada, nada trava` (`{false,false}`).
- [ ] **Step 2: Rodar e ver falhar** — `npm run build:test && node --test lib/domain/box-move.test.js`; esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** as entradas, as constantes, as frases e `prateleirasNaContagem` (a origem pela lista das caixas como está; o destino pela lista com a caixa movida no destino, ambas por `prateleiraNoAlcance(rodada.alcance, local, caixas, rodada.id)`); exportar de `box-recount.ts` as três funções e o tipo; `lerRodadaAberta` lê `count_rounds` aberto do cliente e, só para `LEGACY_CUSTOMER_CODE` sem o documento `LEGACY_ROUND_ID`, a primeira linha de `cycle_counts` com esse `round_id` (as mesmas consultas de `startCountRoundTransaction`).
- [ ] **Step 4: Rodar e ver passar** — `node --test lib/domain/box-move.test.js lib/domain/box-recount.test.js lib/domain/count-rounds.test.js`; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(wms): as regras do mover: a entrada, as recusas e a contagem aberta`.

### Task 5: O mover

**Files:**
- Modify: `functions/wms/src/domain/box-move.ts` (`moveWarehouseBoxTransaction`)
- Create: `functions/wms/src/domain/box-move.integration.test.ts`
- Modify: `functions/wms/package.json` (`lib/domain/box-move.integration.test.js` no `test:integration`)

**Interfaces:**
- Consumes: Tasks 1–4; `requireDimensions`, `buildOccupancy`, `placementFor`, `asPosition`, `openingSessionDocId`, `WAREHOUSE_BOXES_COLLECTION` (`warehouse-boxes.ts`); `retiradoDaCaixa`, `ajustesDaCaixa`, `BOX_STATUS_STORED` (`box-balance.ts`); `saldoDaCaixa` (`saldo-da-caixa.ts`); `areaDePassagem`; `diaDeSaoPaulo`; `assertInventoryOperationsEnabled`, `createEvent`, `createMovement`, `movementId`, `readRows`, `skuBalancesQuery` (`operations.ts`); `publishedMoneyDeletes`; `WAREHOUSE_POSITIONS_COLLECTION`.
- Produces:

```ts
export type ItemMovido = { sku_code: string; qty: number; client_item_code?: string; product_name?: string; size?: string };
export type ResultadoDoMover = {
  ok: true;
  box_move_id: string;
  box_code: string;
  from_location_id: string;
  to_location_id: string;
  units: number;
  items: ItemMovido[];
  moved_at: string;
  moved_by_name?: string;
  /** null sem a sugestão na entrada. */
  suggestion_followed: boolean | null;
  movement_ids: string[];
  events: OperationalEventSummary[];
};
export async function moveWarehouseBoxTransaction(db: Firestore, input: EntradaDoMover, actor: OperationalActor): Promise<ResultadoDoMover>;
```
- O recibo é `operational_operations/op_box_move_${digest({ customer, box, nonce })}`, `kind: "warehouse.box.move"`; o `box_move_id` é `bmv_${digest({ operationId })}`. As leituras e as escritas seguem a seção "A transação do mover" do desenho; o saldo de cada item é `saldoDaCaixa(entradaDaCaixa(box, linhasDaAbertura), retiradoDaCaixa(...), ajustesDaCaixa(box))` com os SKUs em maiúsculas, como a recontagem. O movimento: `movementId(operationId, "box_move_out_<SKU>")`/`"box_move_in_<SKU>"`, `entity` com `reason: MOTIVO_DO_MOVER`, `box_code`, `from_location_id`, `to_location_id`, `movement_kind` `box_move_out`/`box_move_in`, `box_move_id`, `operational_operation_id`, e só na ENTRADA `fifo_day` ou `fifo_opening_session_id` (como `box-recount.ts`) e `fifo_from_location_id`. A caixa vazia (saldo zero) muda de prateleira sem movimento. A caixa guardada na abertura sem o encaixe calculado perde o `opening_model_fit` (no destino, o encaixe é o do motor). O evento: `title: "Caixa {CX} movida de {A} para {B}"`, `description: "{n} un. · sugestão do sistema"` ou `"{n} un. · escolhida à mão"`, `severity: "info"`, `inbox: false`, `entity_type: WAREHOUSE_BOXES_COLLECTION`.

- [ ] **Step 1: Os testes do caminho que falham** (o cenário: BTG com A-01, B-09, C-02, Z-01 de outra zona; CX-000121 da abertura em A-01 com 12 × BTG-000112 e 8 × BTG-000113, `stored_at` 2026-10-22; CX-000130 em B-09 com BTG-000112; saldos que fecham com as caixas; `client_inventory` dos dois SKUs; a sessão `opening_BTG_Pactual` concluída com `started_at`):
  - `pela sugestão: a caixa, os saldos, o razão, as linhas da abertura, o evento e o recibo` — a caixa em B-09 com `moved_from_location_id: "A-01"`, `move_count: 1`, `stored_at` igual; A-01 com 0 de cada item, B-09 com +12 e +8; quatro movimentos com `source: "functions_box_move"` (SAIDA em A-01, ENTRADA em B-09 com `fifo_opening_session_id` e `fifo_from_location_id: "A-01"`); as duas linhas da abertura com `location_id: "B-09"` e `opening_location_id: "A-01"`; um evento `warehouse.box_moved` e nenhum `ai_agent_inbox`; `suggestion_followed: true`; a repetição devolve o mesmo resultado e a chave com outro destino recusa `already-exists`.
  - `à mão, para a prateleira vazia` — C-02 com a sugestão B-09 → `suggestion_followed: false`, a descrição "20 un. · escolhida à mão".
  - `a caixa do recebimento leva o dia da guarda` — CX com `lines[]` e `origin.kind: "receipt"`, `stored_at` 2026-11-06T18:02Z → a ENTRADA com `fifo_day: "2026-11-06"`, nenhuma linha da abertura tocada.
  - `a caixa aberta leva o saldo dela` — `taken_lines` 4 de BTG-000112 e `count_adjustments` +1 de BTG-000113 → movem 8 e 9 (Review Focus 2).
  - `as datas do FIFO das duas prateleiras` — `lerDatasDoEstoque` antes e depois: a soma por dia do cliente igual; A-01 sem o dia da caixa movida quando ela era a mais nova (Review Focus 3, com a volta B-09 → A-01 deixando as datas como antes).
  - `a separação acha a caixa no destino` — `lerCaixasDaPrateleira` de B-09 para BTG-000112 traz CX-000121 com 12 na entrada.
  - `o portal não muda` — os dois `client_inventory` iguais aos de antes.
  - `duas pessoas, a mesma caixa` — dois movers em paralelo com chaves diferentes (B-09 e C-02): um grava, o outro recusa `BOX_MOVE_WRONG_SHELF` (Review Focus 1).
- [ ] **Step 2: Rodar e ver falhar** — `npm run build:test && npx --no-install firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test --test-concurrency=1 lib/domain/box-move.integration.test.js"` (PATH do Java 21); esperado: FAIL (`moveWarehouseBoxTransaction` inexistente).
- [ ] **Step 3: Implementar `moveWarehouseBoxTransaction`** como na Interface e no desenho.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando; esperado: PASS.
- [ ] **Step 5: Os testes das recusas** (`describe("as recusas")`, um `it` por linha da tabela do desenho, cada um confere o código em `details.code` e que nada mudou: caixa, saldos e nenhum movimento): a caixa que não existe; a de outro cliente (`permission-denied`); a `committing`; a que saiu de onde a tela viu; o destino fora de Posições; o `RECEBIMENTO`; a mesma prateleira; o destino `blocked`; o de outra zona; o que não cabe, inclusive pela caixa `committing` que ocupa a frente (Review Focus 4); a caixa com outra em cima; o item reservado na origem (com o `order_number` na frase); o item reservado no destino; a contagem por rua na origem e a recontagem geral de 17/11 da BTG sem documento; a abertura aberta; a prateleira com menos que a caixa; dois saldos do item no destino; o estoque congelado.
- [ ] **Step 6: Rodar, implementar o que faltar e ver passar** — o mesmo comando; esperado: PASS.
- [ ] **Step 7: Commit** — `feat(wms): mover a caixa entre prateleiras numa transação, com o razão, o FIFO e as linhas da abertura`.

### Task 6: A prévia

**Files:**
- Modify: `functions/wms/src/domain/box-move.ts` (`previewBoxMoveTransaction`)
- Modify: `functions/wms/src/domain/box-move.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4 e 5 (as mesmas leituras e frases); `readSlottingContext`.
- Produces:

```ts
export type CaixaDaPrevia = {
  code: string; status: string; location_id: string; units: number; items: ItemMovido[];
  origin_kind: "opening_inventory" | "receipt" | "manual"; invoice_number?: string; stored_at?: string;
  length_m: number; width_m: number; height_m: number; gross_weight_kg: number | null;
};
export type PreviaDoMover = {
  ok: true;
  box: CaixaDaPrevia;
  /** A recusa que já se sabe, com o código e a frase do mover; null quando a caixa pode sair. */
  bloqueio: { code: string; message: string } | null;
  /** Na ordem do mover: a primeira é a sugestão; a segunda e a terceira, as alternativas. Vazia com o bloqueio. */
  prateleiras: DestinoDoMover[];
  nao_cabem: string[];
  com_reserva: string[];
  em_contagem: string[];
  rejected: string | null;
};
export async function previewBoxMoveTransaction(db: Firestore, input: EntradaDaPreviaDoMover): Promise<PreviaDoMover>;
```
- O bloqueio, na ordem: caixa que não existe ou é de outro cliente (lança, como o mover), não guardada, abertura aberta, caixa com outra em cima, item reservado na origem, origem na contagem. `com_reserva`: as prateleiras da zona com algum item da caixa com `qty_reserved > 0`; `em_contagem`: as da zona com `prateleirasNaContagem(...).destino`; as duas viram o `fora` de `destinosDoMover`.

- [ ] **Step 1: Os testes que falham** (`describe("a prévia")`): `a caixa, a sugestão e a lista` (o cenário da Task 5 mais B-10 com BTG-000112 reservado → `prateleiras[0].code` "B-09", `com_reserva` `["B-10"]`, `box.items` com os nomes e tamanhos, `bloqueio` null); `a reserva na origem bloqueia com a frase do mover` (`bloqueio.code` `BOX_MOVE_RESERVED` e a mesma `message` que o mover recusaria); `a contagem por rua tira a rua da lista` (rodada da rua C aberta → `em_contagem` com as da rua C, fora de `prateleiras`); `a prévia não grava` (nenhum documento novo em `operational_operations`, `events` e `movements`).
- [ ] **Step 2: Rodar e ver falhar** — o comando da Task 5; esperado: FAIL.
- [ ] **Step 3: Implementar `previewBoxMoveTransaction`** como na Interface (leitura só, numa transação de leitura ou com `get`s).
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(wms): a prévia do mover: a caixa, a sugestão, a lista e o que impede`.

### Task 7: As callables, a régua e o PR do servidor

**Files:**
- Modify: `functions/wms/src/index.ts` (duas callables, perto de `recountWarehouseBox`)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (duas linhas)
- Modify: `functions/wms/src/billing-callables.integration.test.ts` (o mover na régua da chegada por caixa)
- Modify: `docs/plataforma/diagnostico-contagem-ciclica.md` (seção 6, item 5: o que entrou no servidor)
- Modify: `CLAUDE.md` (o "Mover caixa" no item do mapa do armazém)
- Add: `docs/superpowers/specs/2026-11-19-mover-caixa-design.md`, `docs/superpowers/plans/2026-11-19-mover-caixa.md`, `docs/mockups/mover-caixa/*.png`, `docs/mockups/README.md`

**Interfaces:**
- Produces (as callables que a Task 8 chama):

```ts
export const previewWarehouseBoxMove = onCall(async (request) => { /* getProfile → requireWarehouseWrite → entradaDaPreviaDoMover → requireCustomerScope → previewBoxMoveTransaction */ });
export const moveWarehouseBox = onCall(async (request) => { /* getProfile → requireWarehouseWrite → entradaDoMover → requireCustomerScope → moveWarehouseBoxTransaction(db, { ...input, customer_code }, profile) */ });
```

- [ ] **Step 1: Os testes que falham** — em `callables-papeis.integration.test.ts`: `previewWarehouseBoxMove: { passam: ARMAZEM, recusa: SO_ARMAZEM }` e `moveWarehouseBox: { passam: ARMAZEM, recusa: SO_ARMAZEM }`; em `billing-callables.integration.test.ts`, na régua "a chegada por caixa de verdade": a posição Z-02 junto da Z-01 no `upsertWarehousePositions` e, depois da recontagem, `chamar(wms.moveWarehouseBox, "arm", { customer_code: CAIXAS, box_code: caixa, from_location_id: "Z-01", to_location_id: "Z-02", idempotency_key: "regua-mover" })` → a prévia da cobrança continua `[10, 0, 1]` e `1050`.
- [ ] **Step 2: Rodar e ver falhar** — `npx --no-install firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test --test-concurrency=1 lib/callables-papeis.integration.test.js lib/callables-auth.integration.test.js lib/billing-callables.integration.test.js"`; esperado: FAIL (as callables não existem).
- [ ] **Step 3: Implementar as duas callables** como na Interface, com um comentário de uma frase cada.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando; depois `npm --prefix functions/wms run build` (o typecheck) e `npm --prefix functions/wms run test:unit`. Esperado: PASS; a consulta nova sem índice reprova no job de integração do CI (`tools/indices_das_consultas.py`), então conferir o resultado dele.
- [ ] **Step 5: O registro** — no diagnóstico (seção 6, item 5): o servidor do mover (as callables, as recusas, o FIFO, a etiqueta, as decisões de 19/11/2026) e o que falta (a tela); no `CLAUDE.md`, no item "Mapa do armazém", uma frase: "Mover caixa (19/11/2026): `moveWarehouseBox` e `previewWarehouseBoxMove` (`domain/box-move.ts`) mudam a caixa de prateleira com saldo, razão e linhas da abertura numa transação, recusam reserva na origem ou no destino e prateleira em contagem aberta, e a ENTRADA leva o dia FIFO da caixa e a origem; desenho em `docs/superpowers/specs/2026-11-19-mover-caixa-design.md`."
- [ ] **Step 6: Commit e PR** — commit `feat(wms): as callables do mover caixa; docs: o desenho, o plano e o mockup aprovados`; `git push -u origin claude/mover-caixa-servidor`; `gh pr create --repo Leow4u/Dute --base main` com o título "Mover caixa entre prateleiras: o servidor" e o corpo (o que entra, as decisões de 19/11, os testes, o que falta, "Produção só com o OK do Leonardo") terminando com a linha do Claude Code; nunca `--auto`.

### Task 8: O app lê o mover

**Files:**
- Modify: `artifacts/app/src/lib/warehouse-boxes.ts` (os campos e a regra da etiqueta)
- Modify: `artifacts/app/src/lib/warehouse-labels.ts` (`saldosParaRegistrar`)
- Create: `artifacts/app/src/lib/wms/mover-caixa.ts` (as chamadas)
- Create: `artifacts/app/src/lib/warehouse-ops/mover-caixa.ts` (os tipos e os textos)
- Test: `artifacts/app/src/lib/warehouse-ops/mover-caixa.test.ts`, `artifacts/app/src/lib/warehouse-boxes.test.ts`, `artifacts/app/src/lib/warehouse-labels.test.ts`

**Interfaces:**
- Consumes: as callables da Task 7 e os tipos `PreviaDoMover`, `DestinoDoMover`, `ResultadoDoMover`, `EntradaDoMover` (espelhados no app, sem importar das Functions).
- Produces:

```ts
// lib/warehouse-boxes.ts: WarehouseBox ganha moved_at, moved_from_location_id e location_label_printed_for (texto ou null)
export function boxMovedWithoutLabel(box: Pick<WarehouseBox, "status" | "moved_at" | "location_label_printed_for">): boolean;
// boxNeedsRelabel passa a ser boxIsOpen-sem-etiqueta || boxMovedWithoutLabel; saldosParaRegistrar inclui a movida sem etiqueta
// lib/wms/mover-caixa.ts (o molde de lib/wms/recontagem.ts: httpsCallable, semCamposVazios, erroDaCallable)
export async function previaDoMover(entrada: { customer_code: string; box_code: string }): Promise<PreviaDoMover>;
export async function moverCaixa(entrada: EntradaDoMover & { idempotency_key: string }): Promise<ResultadoDoMover>;
// lib/warehouse-ops/mover-caixa.ts
export const ROTA_DO_MOVER = "/estoque/mapa/mover";
export const PRATELEIRAS_A_VISTA = 8;
export function moverUrl(code?: string): string;                                    // "/estoque/mapa/mover?caixa=CX-000121" | "/estoque/mapa/mover"
export function codigoDaCaixa(digitado: string): string | null;                     // "CX-000121", "cx-121", "121" → "CX-000121"; outro texto → null
export function textoDaPrateleira(livre_m: number, caixas: number): string;         // "1,42 m livres · 2 caixas" | "· 1 caixa" | "· sem caixas"
export function textoDasForas(rotulo: "Não cabe" | "Com reserva" | "Em contagem", codigos: readonly string[]): string | null; // "Não cabe: A-02 · B-11"; vazio → null
export function textoDaOrigem(box: CaixaDaPrevia): string;                         // "Abertura · 22/10/2026 · 40 × 60 × 35 cm · 10 kg" | "Recebimento · NF 48.377 · …"
export function textoDaMovida(resultado: ResultadoDoMover): string;                // "saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo" (hora de São Paulo)
export function caixasMovidasSemEtiqueta(caixas: readonly WarehouseBox[], cliente: string): string[];
```

- [ ] **Step 1: Os testes que falham** — `mover-caixa.test.ts`: `codigoDaCaixa` com `"CX-000121"`, `" cx-121 "`, `"121"` → `"CX-000121"` e `"A-01"`, `""`, `"CX-"` → `null` (Review Focus 5); `textoDaPrateleira(1.42, 2)` `"1,42 m livres · 2 caixas"`, `(1.78, 0)` `"1,78 m livres · sem caixas"`, `(1.38, 1)` `"1,38 m livres · 1 caixa"`; `textoDasForas("Não cabe", ["A-02","B-11"])` `"Não cabe: A-02 · B-11"` e `[]` → `null`; `textoDaMovida` com `moved_at: "2026-11-19T17:32:00.000Z"`, 20 un., de A-01, Leonardo → `"saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo"`; `moverUrl("CX-000121")`. `warehouse-boxes.test.ts`: a caixa movida intacta pede etiqueta; com `location_label_printed_for` igual ao `moved_at`, não. `warehouse-labels.test.ts`: `saldosParaRegistrar` traz a movida intacta e deixa de fora a intacta que nunca se moveu.
- [ ] **Step 2: Rodar e ver falhar** — `cd artifacts/app && npx vitest run src/lib/warehouse-ops/mover-caixa.test.ts src/lib/warehouse-boxes.test.ts src/lib/warehouse-labels.test.ts`; esperado: FAIL.
- [ ] **Step 3: Implementar** como na Interface (`warehouseBoxFromRecord` lê os três campos).
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(app): o mover no app: as chamadas, os textos e a etiqueta da caixa movida`.

### Task 9: A página Mover caixa

**Files:**
- Create: `artifacts/app/src/pages/estoque-mapa-mover-view.tsx`, `artifacts/app/src/pages/estoque-mapa-mover-view.test.tsx`
- Create: `artifacts/app/src/pages/estoque-mapa-mover.tsx`, `artifacts/app/src/pages/estoque-mapa-mover.test.tsx`
- Modify: `artifacts/app/src/App.tsx` (`protectedRoute("/estoque/mapa/mover", EstoqueMapaMover)`), `artifacts/app/src/lib/modules.ts` (no navRoute do Mapa, `tambem: ["/estoque/mapa/mover"]`; no acesso das rotas, `{ path: "/estoque/mapa/mover", roles: [...WMS_OPERATOR_ROLES] }`), `artifacts/app/src/lib/document-title.ts` (`{ path: "/estoque/mapa/mover", label: "Mover caixa" }`), `artifacts/app/src/lib/wms-v3.ts` (`"/estoque/mapa/mover"` em `TELAS_DO_WMS_NA_V3`) e os testes deles (`modules.test.ts`, `document-title.test.ts`, `wms-v3.test.ts`, `shell-do-modulo.test.tsx`: o Mapa marcado em `/estoque/mapa/mover`).

**Interfaces:**
- Consumes: Task 8.
- Produces:

```ts
export type EstadoDoMover =
  | { fase: "vazia" }
  | { fase: "carregando"; caixa: string }
  | { fase: "falha"; caixa: string; erro: unknown }
  | { fase: "pronta"; previa: PreviaDoMover }
  | { fase: "movida"; previa: PreviaDoMover; resultado: ResultadoDoMover };
export function EstoqueMapaMoverView(props: {
  estado: EstadoDoMover;
  digitado: string; onDigitar: (valor: string) => void; onAbrir: () => void;
  modo: "sugestao" | "escolha"; onModo: (modo: "sugestao" | "escolha") => void;
  escolhida: string | null; onEscolher: (codigo: string) => void;
  verTodas: boolean; onVerTodas: () => void;
  mover: { estado: EstadoDaAcao }; onMover: (destino: string) => void;
  /** A frase do servidor depois do mover recusado. */
  recusa: string | null;
  /** As caixas movidas sem etiqueta nova: "Etiquetas para trocar · N" com duas ou mais. */
  etiquetas: readonly string[];
  hrefDasEtiquetas: (codigos: readonly string[]) => string;
  onOutraCaixa: () => void;
  onTentar: () => unknown;
}): JSX.Element;
```
- Os textos são os do mockup (`docs/mockups/mover-caixa/`): "Mapa", "Mover caixa", "Caixa", "Abrir", o placeholder "CX-000000", a situação ("guardada"), "em A-01", "20 un.", "Mover para", "Sugestão do sistema", "Escolher prateleira", "mesmo produto", "alternativas B-10 · C-02", "Mover para B-09", "Ver as 31 prateleiras", "Não cabe: …", "Com reserva: …", "Em contagem: …", "CX-000121 em B-09", a linha de `textoDaMovida`, "Imprimir etiqueta", "Mover outra caixa", "Etiquetas para trocar · 3", "Carregando a caixa…", "Não consegui carregar a caixa.", e a frase de `rejected` ou do `bloqueio`. O container lê `?caixa=` (normalizado por `codigoDaCaixa`), o cliente ativo e o papel (`canOperateWarehouse`; sem ele, a página diz o bloqueio do papel e não chama nada), a prévia pelo TanStack Query (chave `["mover-caixa", cliente, caixa]`), o mover por `useMutation` com a chave da tentativa guardada até o resultado (como a bancada da recontagem), e no sucesso invalida `["warehouse-boxes"]` e a prévia; as caixas para "Etiquetas para trocar" vêm de `fetchWarehouseRows("/api/warehouse/boxes?limit=5000")` com a chave do Mapa.

- [ ] **Step 1: Os testes que falham** — na view, um `it` por estado, cada um com `textosForaDaLista(html, [...])` igual a `[]` e `violacoesDeAcessibilidade(html)` igual a `[]`: vazia; sugestão (o cartão da caixa e B-09); escolha (oito linhas, "Ver as 31 prateleiras", "Não cabe: A-02 · B-11", "Com reserva: B-10"); movida (com "Etiquetas para trocar · 3"); o bloqueio (a frase da reserva no lugar do "Mover para"); sem prateleira (a frase de `rejected`); a falha da leitura ("Não consegui carregar a caixa." com "Tentar de novo"). No container, com `@/lib/wms/mover-caixa` simulado: `abre a caixa da busca e move pela sugestão` (chama `moverCaixa` com `customer_code`, `box_code: "CX-000121"`, `from_location_id: "A-01"`, `to_location_id: "B-09"`, `suggestion: { position: "B-09", alternatives: ["B-10", "C-02"] }` e uma `idempotency_key`, e mostra "CX-000121 em B-09"); `a recusa do servidor aparece no lugar do painel` (o erro com `BOX_MOVE_DESTINATION_RESERVED` mostra a frase); `a mesma tentativa repete a mesma chave` (o "Tentar de novo" depois do erro de rede manda a chave da primeira chamada). Nos testes das listas: a rota, o título "Dutelog | Mover caixa", a v3 e o Mapa marcado no shell.
- [ ] **Step 2: Rodar e ver falhar** — `cd artifacts/app && npx vitest run src/pages/estoque-mapa-mover-view.test.tsx src/pages/estoque-mapa-mover.test.tsx src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/wms-v3.test.ts src/components/layout/shell-do-modulo.test.tsx`; esperado: FAIL.
- [ ] **Step 3: Implementar a view e o container** — o visual é o do mockup aprovado, com os componentes que ele usa (o cartão como o da bancada, o painel "Mover para" como o "Guardar em" do Receber, o `Segmented`, o `BotaoDeAcao`), e as rotas, o título, a v3 e o acesso.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando, mais as travas `src/lib/theme-colors.test.ts`, `src/lib/carregando/trava.test.ts` e `src/lib/platform-lists.test.ts`; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(app): a página Mover caixa (/estoque/mapa/mover), na v3`.

### Task 10: O Mapa e o histórico do item

**Files:**
- Modify: `artifacts/app/src/pages/warehouse-map.tsx` (o cabeçalho e o cartão da caixa)
- Modify: `artifacts/app/src/pages/estoque.tsx` (o rótulo do movimento do mover)
- Test: `artifacts/app/src/pages/warehouse-map.test.tsx`, `artifacts/app/src/pages/estoque.test.tsx`

**Interfaces:**
- Consumes: `moverUrl` (Task 8).
- Produces: `BoxCard` e `ShelfPanel` ganham `onMover?: (code: string) => void`; com ele, o cartão da caixa guardada leva "Etiqueta" e "Mover" no rodapé (sem ele, como hoje). O cabeçalho do Mapa ganha "Mover caixa" (o `Link` para `ROTA_DO_MOVER`) para quem opera (`canOperateWarehouse`). No histórico do item, o movimento com `movement_kind` `box_move_out` ou `box_move_in` diz "Mudança de prateleira" no lugar de "saida"/"entrada".

- [ ] **Step 1: Os testes que falham** — `o cartão da caixa guardada leva Etiqueta e Mover no rodapé` (com `onMover`: os textos `["CX-000225 · guardada", "19 un.", "Etiqueta", "Mover", …]` e o `axe`); `sem quem mova, o cartão fica como hoje` (sem "Mover"); a reservada (`committing`) nunca leva "Mover"; no histórico, `o mover diz Mudança de prateleira` (as duas linhas, −20 e +20).
- [ ] **Step 2: Rodar e ver falhar** — `cd artifacts/app && npx vitest run src/pages/warehouse-map.test.tsx src/pages/estoque.test.tsx`; esperado: FAIL.
- [ ] **Step 3: Implementar** como na Interface; o Mapa continua fora da v3.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando e `src/pages/warehouse-map.carregamento.test.tsx src/pages/warehouse-map.falhas.test.tsx`; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(app): o Mover no Mapa e a mudança de prateleira no histórico do item`.

### Task 11: O emulador, as fotos, o registro e o PR da tela

**Files:**
- Add: `docs/mockups/mover-caixa/07-mapa-depois.png`, `08-movida-emulador.png` (fotos da tela real)
- Modify: `docs/mockups/README.md`, `docs/plataforma/diagnostico-contagem-ciclica.md` (seção 6, item 5: a tela e o ensaio), `CLAUDE.md` (a página e o Mapa)

- [ ] **Step 1: Subir o emulador e o app** como no PR 631 (memória `emulador-functions-nesta-maquina`): `firebase.emulador.json` na raiz do worktree só com `functions/wms` (apagado antes do commit), o seed no scratchpad (owner, BTG com A-01, B-09, B-10, C-02; CX-000121 da abertura em A-01, CX-000130 em B-09 com o mesmo produto, um pedido aprovado com BTG-000112 reservado em B-10; saldos, linhas da abertura, sessão concluída, `client_inventory`), `.env.emulador` e a entrada temporária no `.claude/launch.json` (`vite --mode emulador`), `preview_start`.
- [ ] **Step 2: O ensaio** — pelo Mapa, "Mover" na CX-000121 → a sugestão B-09 (B-10 em "Com reserva") → "Mover para B-09" → "Imprimir etiqueta" (a etiqueta diz B-09 e a caixa sai de "Etiquetas para trocar"); outra caixa pela troca à mão para C-02. Conferir: o Mapa (as caixas em B-09 e C-02), o Caixas × saldo (`/estoque/contagem/caixas`, sem diferença nas três prateleiras), a lista de separação (`/pedidos/lista` do pedido) e as datas do item (Estoque › Itens, `getStockDates`).
- [ ] **Step 3: As fotos e o registro** — as duas fotos pelo Chrome sem janela (1440 × 900, escala 2, perfil novo no scratchpad), a tabela do README, o diagnóstico (item 5 entregue, com o ensaio) e o `CLAUDE.md`; apagar `firebase.emulador.json`, `.env.emulador`, a entrada do `launch.json` e `tmp/previa-mover`.
- [ ] **Step 4: A suíte dirigida e o typecheck** — `npx tsc --build` na raiz, `npx tsc -p artifacts/app/tsconfig.json --noEmit`, e os testes das Tasks 8 a 10 mais as travas; esperado: PASS.
- [ ] **Step 5: Commit e PR** — `docs(plataforma): o mover caixa conferido no emulador`; `git push -u origin claude/mover-caixa-tela`; `gh pr create --repo Leow4u/Dute --base claude/mover-caixa-servidor` (rebase na `main` depois do merge da PR 1) com o título "Mover caixa entre prateleiras: a tela", o corpo com as fotos e "Produção só com o OK do Leonardo", e a linha do Claude Code; nunca `--auto`.
