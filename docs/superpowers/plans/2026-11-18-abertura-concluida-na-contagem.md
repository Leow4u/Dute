# A Contagem como a entrada das contagens — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/wms/contagem` vira a entrada das contagens para o cliente com a abertura concluída (o cartão "Em andamento" da recontagem geral e "Anteriores" com a linha do inventário de abertura), e a tela de hoje, com as abas, passa para `/wms/contagem/abertura`.

**Architecture:** O registro da abertura é uma função pura em `lib/opening-inventory.ts`. O cartão de números da rodada sai da view da Contagem por caixa para um componente próprio (`CartaoDaRodada`) e serve às duas telas. A entrada é uma page (hooks, o mesmo resumo `rodadaDaContagem` da rodada, o redirecionamento pelo status da sessão) e uma view pura (props), no molde de `estoque-contagem-rodada{,-view}.tsx`. A tela de hoje só ganha a rota nova e o redirecionamento de volta quando a sessão conclui.

**Tech Stack:** React 19, TanStack Query, wouter, Tailwind com tokens, vitest + jsdom, axe-core (`src/test/acessibilidade.ts`), `src/test/textos.ts`.

**Spec:** `docs/superpowers/specs/2026-11-18-abertura-concluida-na-contagem-design.md`

## Global Constraints

- Branch `claude/abertura-concluida-na-contagem` a partir da `main` limpa e atualizada; um problema por PR; teste que falha antes.
- Nenhuma callable nova, nenhuma escrita; a entrada lê a sessão (`getOpeningInventorySession`, já devolve `completed_at`, `completed_by`) e as mesmas leituras da rodada.
- Tela nova na v3: `/wms/contagem` entra em `TELAS_DO_WMS_NA_V3`; `/wms/contagem/abertura` fica fora. Sem legenda (lista de textos com `textosDaTela`/`textosForaDaLista`), `axe` verde, só tokens (`theme-colors.test.ts`), nada de `animate-*`, "...", `outline-none` (`trava.test.ts`).
- Carregamento v2: `LinhaDeEstado` sob o título; esqueleto neutro na primeira leitura; a falha nunca vira vazio; o foco nunca cai no `body`; testes de espera sem tempo fixo de relógio real.
- Datas no fuso `America/Sao_Paulo`, "20/10/2026 às 18:40"; testes sem depender do fuso da máquina.
- Papéis por rota são por caminho exato (`ROUTE_APP_ROLES[normalizePath(path)]`): a rota nova entra na lista com os papéis da Contagem.
- `corepack pnpm --filter "@workspace/app" run test -- <arquivos>` roda arquivos do vitest; `corepack pnpm --filter "@workspace/app" run typecheck` checa o app.
- Commits em português (`feat(app): …`, `refactor(app): …`, `docs(plataforma): …`), terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Antes do commit final: apagar `artifacts/app/src/pages/zz-previa-contagem.test.tsx`, `artifacts/app/src/pages/zz-previa-rodada.test.tsx` e `tmp/previa-contagem/`, e reverter `.claude/launch.json`.

## Review Focus

1. Sessão concluída sem `completed_by` ou sem `completed_at` válido: a linha fica só com o que existe, sem " · " solto nem "Invalid Date". Teste na Tarefa 1.
2. Quem abre `/wms/contagem` com a abertura pendente ou em curso (ou "Continuar contagem" em Estoque › Itens) cai na tela de hoje, sem laço de redirecionamento com `/wms/contagem/abertura`. Testes nas Tarefas 4 e 5.
3. "Confirmar encerramento" na tela de hoje: a sessão conclui e a pessoa vai para a entrada, com a abertura em "Anteriores". Teste na Tarefa 5.
4. A sessão que falha na entrada: a falha com "Tentar de novo", nunca o redirecionamento nem a tela vazia. Teste na Tarefa 4.
5. A recontagem sem prateleira por contar (tudo contado): o cartão sem "Continuar", só "Ver prateleiras"; sem prateleira com caixa, sem "Em andamento". Teste na Tarefa 3.

---

### Task 1: O registro da abertura concluída (função pura)

**Files:**
- Modify: `artifacts/app/src/lib/opening-inventory.ts` (o tipo `OpeningInventorySummary`; a função nova depois de `openingInventoryNotice`)
- Test: `artifacts/app/src/lib/opening-inventory.test.ts`
- Add ao commit: `docs/superpowers/specs/2026-11-18-abertura-concluida-na-contagem-design.md`, `docs/superpowers/plans/2026-11-18-abertura-concluida-na-contagem.md`

**Interfaces:**
- Produces:
  ```ts
  export type OpeningInventorySummary = { /* os campos de hoje */; completed_at?: string; completed_by?: { name?: string; email?: string } };
  export type RegistroDaAberturaConcluida = {
    titulo: string;   // "Inventário de abertura"
    quando: string;   // "20/10/2026 às 18:40 · Leonardo" | "20/10/2026 às 18:40" | "Leonardo" | ""
    numeros: string;  // "249 lançamentos · 7.314 unidades" (singular em 1)
  };
  export function registroDaAberturaConcluida(session: OpeningInventorySummary | undefined): RegistroDaAberturaConcluida | null; // null fora de status "completed"
  ```

- [ ] **Passo 0: A branch** — `git switch -c claude/abertura-concluida-na-contagem main`
- [ ] **Passo 1: Os testes que falham**, em `opening-inventory.test.ts`:

```ts
describe("o registro da abertura concluída", () => {
  const concluida = { status: "completed", line_count: 249, unit_count: 7314, completed_at: "2026-10-20T21:40:00Z", completed_by: { name: "Leonardo", email: "leonardo@exemplo.com" } };
  it("a sessão concluída: o título, quando e quem no fuso do armazém, e os números", () => {
    expect(registroDaAberturaConcluida(concluida)).toEqual({ titulo: "Inventário de abertura", quando: "20/10/2026 às 18:40 · Leonardo", numeros: "249 lançamentos · 7.314 unidades" });
  });
  it("sem quem concluiu, só a data; sem nome, o e-mail; sem data válida, só quem; sem os dois, vazio", () => {
    expect(registroDaAberturaConcluida({ ...concluida, completed_by: undefined })?.quando).toBe("20/10/2026 às 18:40");
    expect(registroDaAberturaConcluida({ ...concluida, completed_by: { email: "ana@exemplo.com" } })?.quando).toBe("20/10/2026 às 18:40 · ana@exemplo.com");
    expect(registroDaAberturaConcluida({ ...concluida, completed_at: "quando?" })?.quando).toBe("Leonardo");
    expect(registroDaAberturaConcluida({ ...concluida, completed_at: undefined, completed_by: undefined })?.quando).toBe("");
  });
  it("um lançamento e uma unidade no singular; sem contagem, zero", () => {
    expect(registroDaAberturaConcluida({ ...concluida, line_count: 1, unit_count: 1 })?.numeros).toBe("1 lançamento · 1 unidade");
    expect(registroDaAberturaConcluida({ status: "completed" })?.numeros).toBe("0 lançamentos · 0 unidades");
  });
  it("só a sessão concluída tem registro", () => {
    expect(registroDaAberturaConcluida(undefined)).toBeNull();
    expect(registroDaAberturaConcluida({ status: "open", line_count: 3 })).toBeNull();
    expect(registroDaAberturaConcluida({ status: "not_started" })).toBeNull();
  });
});
```

- [ ] **Passo 2: Ver falhar** — `corepack pnpm --filter "@workspace/app" run test -- src/lib/opening-inventory.test.ts` → FAIL (não exportada).
- [ ] **Passo 3: Implementar** — dois `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", … })` de módulo (dia/mês/ano e hora/minuto `hourCycle: "h23"`); a data só com `Number.isFinite(Date.parse(completed_at))`; `quem = name || email || ""`; `quando = [data, quem].filter(Boolean).join(" · ")`; `numeros` pelo `count` do arquivo.
- [ ] **Passo 4: Ver passar** — o mesmo comando → PASS.
- [ ] **Passo 5: Commit** — `feat(app): o registro da abertura concluída, lido da sessão` (com o desenho e o plano).

---

### Task 2: O cartão da rodada como componente

**Files:**
- Create: `artifacts/app/src/features/warehouse-ops/cartao-da-rodada.tsx`
- Modify: `artifacts/app/src/pages/estoque-contagem-rodada-view.tsx` (a função local `Numeros` sai; a view usa o componente)
- Test: `artifacts/app/src/features/warehouse-ops/cartao-da-rodada.test.tsx`; `src/pages/estoque-contagem-rodada-view.test.tsx` segue verde sem mudar.

**Interfaces:**
- Produces:
  ```tsx
  export function CartaoDaRodada({ rodada, agora, id = "rodada-titulo", titulo = "h2", acoes }: {
    rodada: RodadaDaContagem; agora: Date;
    /** O id do título, para o aria-labelledby da seção. */ id?: string;
    /** O nível do título: h2 na rodada, h3 dentro de "Em andamento" na entrada. */ titulo?: "h2" | "h3";
    /** A fila de ações entre os números e a barra (a entrada: "Continuar", "Ver prateleiras"). */ acoes?: ReactNode;
  }): JSX.Element;
  ```
  O markup é o `Numeros` de hoje (section `aria-labelledby`, título, `textoDoComeco`, a `dl` com quatro números, a barra `h-1.5 bg-muted` com `bg-foreground` na largura do percentual); com `acoes`, um `<div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3">` antes da barra.

- [ ] **Passo 1: O teste que falha** (`cartao-da-rodada.test.tsx`, `renderToStaticMarkup`, a `RODADA_DO_DIA` montada como no teste da view da rodada): com `titulo="h3"` e `acoes={<a href="#">Continuar B-10</a>}`, o HTML tem `<h3 id="contagem-em-andamento"`, `aria-labelledby="contagem-em-andamento"`, "Continuar B-10", e `textosForaDaLista(html, [...os textos do cartão...])` é `[]`; sem `acoes`, não há a fila; o padrão é `h2` com `rodada-titulo`.
- [ ] **Passo 2: Ver falhar** — `… run test -- src/features/warehouse-ops/cartao-da-rodada.test.tsx` → FAIL.
- [ ] **Passo 3: Implementar e trocar na view da rodada** (`<CartaoDaRodada rodada={rodada} agora={agora} />` no lugar de `<Numeros …/>`).
- [ ] **Passo 4: Ver passar** — `… run test -- src/features/warehouse-ops/cartao-da-rodada.test.tsx src/pages/estoque-contagem-rodada-view.test.tsx` → PASS.
- [ ] **Passo 5: Commit** — `refactor(app): o cartão da rodada vira componente, para a entrada da Contagem`.

---

### Task 3: A view da entrada

**Files:**
- Create: `artifacts/app/src/pages/contagem-view.tsx`
- Test: `artifacts/app/src/pages/contagem-view.test.tsx`
- Modify: `artifacts/app/src/lib/wms-v3.ts` (`/wms/contagem` na lista, com o comentário da parte)

**Interfaces:**
- Consumes: `CartaoDaRodada` (Tarefa 2), `RegistroDaAberturaConcluida` (Tarefa 1), `LinhaDeEstado`, `FalhaNaLeitura`, `BlocoSemConexao`, `FalhaDoClienteAtivo`, `Esqueleto`, `PageHeader`, `hrefDaPrateleira`, `ROTA_DA_RODADA`, `ROTA_DO_RELATORIO_CAIXAS_SALDO`.
- Produces:
  ```tsx
  export type EstadoDaEntrada = "carregando" | "erro" | "pronto";
  export const ROTA_DA_ABERTURA = "/wms/contagem/abertura";
  export function ContagemView(props: {
    estado: EstadoDaEntrada;
    cliente: string;                                   // o nome do cliente ativo: "Contagem · BTG"
    abertura: RegistroDaAberturaConcluida | null;      // a linha de "Anteriores"
    rodada: RodadaDaContagem | null;                   // "Em andamento"; a seção some com rodada.prateleiras === 0
    agora: Date;
    leitura?: readonly LeituraDaLista[]; aoVivo?: LeituraAoVivoNaTela; falha?: FalhaDasLeituras | null; clienteFalhou?: boolean;
    hrefDaFolha: string;
  }): JSX.Element;
  ```
  Estrutura: `PageHeader` (título, `estado={<LinhaDeEstado id="contagem-linha-de-estado" objeto="contagens" …/>}`, ações "Folha de contagem" e "Caixas × saldo", outline, com os ícones da rodada); depois, como na rodada: `clienteFalhou` → `FalhaDoClienteAtivo`; `carregando` → o esqueleto (um bloco do cartão e três linhas); `falha` → `FalhaNaLeitura`; `erro` com `aoVivo` → `FalhaNaLeitura` das leituras ao vivo; `pronto` → `BlocoSemConexao` se for o caso, a seção "Em andamento" (`h2` em caixa alta pequena como "Rua A" na rodada; `CartaoDaRodada` com `titulo="h3"`, `id="contagem-em-andamento"` e `acoes`: `Continuar <prateleira>` primário para `hrefDaPrateleira(continuar)` quando há, e "Ver prateleiras" outline para `ROTA_DA_RODADA`), e a seção "Anteriores" (`ul` com `rounded-xl border border-border bg-card`; a `li` da abertura com o `CheckCircle2` no token `text-success-soft-foreground`, o título em `font-medium text-foreground`, `quando` e `numeros` em `text-muted-foreground`; a seção some sem `abertura`).

- [ ] **Passo 1: Os testes que falham** (`contagem-view.test.tsx`, no molde do teste da view da rodada: `Router ssrPath="/wms/contagem"`, a mesma `RODADA_DO_DIA` sintética, `ABERTURA = { titulo: "Inventário de abertura", quando: "20/10/2026 às 18:40 · Leonardo", numeros: "249 lançamentos · 7.314 unidades" }`):
  - "a tela nova já entra na v3": `telaDoWmsNaV3("/wms/contagem")` é `true`.
  - "só rótulos, dados e ações": `textosDaTela(render())` igual à lista exata (o título "Contagem · BTG", as duas ações, "Em andamento", os textos do cartão, "Continuar A-02", "Ver prateleiras", "Anteriores", os três textos da abertura).
  - "os links": "Continuar A-02" → `/estoque/contagem/prateleira?posicao=A-02`; "Ver prateleiras" → `/estoque/contagem/rodada`; "Folha de contagem" → o `hrefDaFolha`; "Caixas × saldo" → `/estoque/contagem/caixas`.
  - "tudo contado: sem Continuar" (`rodada` com `continuar: null`): sem "Continuar", com "Ver prateleiras".
  - "sem prateleira com caixa: sem Em andamento" (`rodada.prateleiras === 0`): sem "Em andamento", com "Anteriores".
  - "sem abertura registrada: sem Anteriores" (`abertura: null`).
  - "carregando: a linha de estado, o esqueleto, nada de número" e "a falha: Tentar de novo, nunca o vazio".
  - `violacoesDeAcessibilidade(render())` é `[]` no pronto e no carregando.
- [ ] **Passo 2: Ver falhar** — `… run test -- src/pages/contagem-view.test.tsx` → FAIL.
- [ ] **Passo 3: Implementar** a view e a entrada na lista da v3.
- [ ] **Passo 4: Ver passar** — `… run test -- src/pages/contagem-view.test.tsx src/lib/theme-colors.test.ts src/lib/carregando/trava.test.ts` → PASS.
- [ ] **Passo 5: Commit** — `feat(app): a view da entrada da Contagem (em andamento e anteriores)`.

---

### Task 4: A page da entrada, a rota e o menu

**Files:**
- Create: `artifacts/app/src/pages/contagem.tsx`
- Test: `artifacts/app/src/pages/contagem.test.tsx`
- Modify: `artifacts/app/src/App.tsx` (o `telaSobDemanda` da entrada; `protectedRoute("/wms/contagem", Contagem)`; `protectedRoute("/wms/contagem/abertura", WmsInventoryPage)`), `artifacts/app/src/lib/modules.ts` (`tambem` do item Contagem ganha `/wms/contagem/abertura`; a lista de rotas com papéis ganha `{ path: "/wms/contagem/abertura", roles: WMS_OPERATOR_ROLES }` ao lado das rotas da contagem por caixa), `artifacts/app/src/lib/document-title.ts` (`{ path: "/wms/contagem/abertura", label: "Inventário de abertura" }`).

**Interfaces:**
- Consumes: `ContagemView` e `ROTA_DA_ABERTURA` (Tarefa 3), `registroDaAberturaConcluida` (Tarefa 1), `useOpeningInventorySession`, `useActiveCustomer` (`active.name`, `code`, `isLoading`, `falhou`), `useContagemPorCaixa`, `useCaixasDoCliente`, `useLeiturasDaRodada`, `rodadaDaContagem`, `RODADA_DA_RECONTAGEM_GERAL`, `relatorioCaixasSaldo` não (a entrada não mostra o relatório), `ruasDaContagem` + `hrefDaFolha`, `falhaDasLeituras`, `useLeituraComFalha`.
- Produces: `export default function PaginaDaContagem()`.
  - Lê a sessão; `precisaDaAbertura = sessao.data !== undefined && sessao.data.status !== "completed"`; `useEffect` → `navigate(ROTA_DA_ABERTURA, { replace: true })` (o `navigate` de `useLocation()` do wouter).
  - `estado`: "carregando" enquanto o cliente, a sessão, a folha ou as leituras ao vivo não voltaram; "erro" com a sessão falhada sem dado (`falha` = `falhaDasLeituras([[sessao, sessaoNaTela]])`), a folha falhada ou as leituras ao vivo falhadas; senão "pronto".
  - `leitura` da linha de estado: as da folha mais a cópia da sessão.
- [ ] **Passo 1: Os testes que falham** (`contagem.test.tsx`, jsdom; `vi.mock` de `@/features/warehouse-ops/opening-inventory-status` (`useOpeningInventorySession` devolvendo o que o teste mandar), de `@/lib/active-customer-context`, de `@/lib/warehouse-ops/use-contagem-por-caixa`, `@/lib/warehouse-ops/use-lista-de-separacao` (`useCaixasDoCliente`) e `@/lib/warehouse-ops/use-recontagem` (`useLeiturasDaRodada`), todos prontos e vazios, e de `wouter` com `useLocation: () => ["/wms/contagem", navegar]`, `navegar = vi.fn()`):
  - "a sessão concluída: a entrada com a abertura em Anteriores, sem redirecionar": o texto tem "Inventário de abertura" e "20/10/2026 às 18:40 · Leonardo"; `navegar` não foi chamado.
  - "a sessão aberta ou pendente: vai para a tela da abertura": `navegar` chamado com `("/wms/contagem/abertura", { replace: true })`, uma vez.
  - "a sessão ainda lendo: nem redireciona nem afirma": `navegar` não chamado; sem "Anteriores".
  - "a sessão que falha: Tentar de novo, sem redirecionar".
- [ ] **Passo 2: Ver falhar** — `… run test -- src/pages/contagem.test.tsx` → FAIL.
- [ ] **Passo 3: Implementar** a page, as rotas, o menu e o título.
- [ ] **Passo 4: Ver passar, com os vizinhos** — `… run test -- src/pages/contagem.test.tsx src/lib/modules.test.ts src/lib/document-title.test.ts src/lib/wms-v3.test.ts` (os que existirem) → PASS; `corepack pnpm --filter "@workspace/app" run typecheck` sem erro.
- [ ] **Passo 5: Commit** — `feat(app): /wms/contagem vira a entrada das contagens; a tela de hoje em /wms/contagem/abertura`.

---

### Task 5: A tela de hoje manda para a entrada quando a sessão conclui

**Files:**
- Modify: `artifacts/app/src/pages/wms-inventory.tsx` (lê a sessão; `useEffect` → `navigate("/wms/contagem", { replace: true })` com `status === "completed"`; o JSDoc diz que a tela é a abertura e a cíclica, em `/wms/contagem/abertura`), `artifacts/app/src/pages/estoque.tsx:339` ("Continuar contagem"/"Iniciar" do aviso da abertura apontam para `/wms/contagem/abertura`).
- Test: `artifacts/app/src/pages/wms-inventory.test.tsx` (novo; o `fetchJson` mockado como em `inventory-falhas.test.tsx`, o `wouter` com `navegar = vi.fn()`).

- [ ] **Passo 1: Os testes que falham**: com a sessão concluída, `navegar` chamado com `("/wms/contagem", { replace: true })`; com a sessão aberta, não chamado e a tela mostra as abas; com a sessão que falha, não chamado.
- [ ] **Passo 2: Ver falhar.**
- [ ] **Passo 3: Implementar.**
- [ ] **Passo 4: Ver passar** — `… run test -- src/pages/wms-inventory.test.tsx src/features/warehouse-ops/inventory-falhas.test.tsx src/features/warehouse-ops/inventory-carregamento.test.tsx src/pages/estoque.test.tsx` (o que existir) → PASS.
- [ ] **Passo 5: Commit** — `feat(app): a tela da abertura volta à entrada da Contagem quando a sessão conclui`.

---

### Task 6: Prévia da tela real, registro, limpeza e PR

- [ ] **Passo 1: A prévia da entrada real** — em `zz-previa-contagem.test.tsx`, renderizar `PaginaDaContagem` com a sessão concluída e as leituras mockadas (ou a `ContagemView` com os dados sintéticos) em `tmp/previa-contagem/real.html`, com a moldura `.v3`; abrir em `http://localhost:4181/real.html` (viewport 1440×900), conferir contra `entrada-1.png`; screenshot para o PR.
- [ ] **Passo 2: O registro** — `docs/mockups/contagem-entrada/01-em-andamento.png` e `02-iniciar-contagem.png` (copiados de `tmp/previa-contagem/entrada-1.png` e `entrada-2.png`), com as linhas na tabela da seção "Contagem por caixa" do `docs/mockups/README.md` (aprovadas em 18/11/2026; a segunda espera a coleção da rodada); `docs/plataforma/diagnostico-contagem-ciclica.md`: a ressalva 1 da seção 2 e o "Ficam" do item 4 da seção 6 ganham o parágrafo *No código desde 18/11/2026 (PR N)* com a entrada, a rota da abertura e o que espera a coleção; `CLAUDE.md`: a lista das telas do WMS na v3 ganha a Contagem (a entrada) com a abertura e a cíclica em `/wms/contagem/abertura`.
- [ ] **Passo 3: Limpar** — apagar os dois `zz-previa-*.test.tsx`, `tmp/previa-contagem`, `git checkout -- .claude/launch.json`; `git status --short` só com o que entra.
- [ ] **Passo 4: Commit e PR** — `docs(plataforma): a entrada da Contagem no diagnóstico, nas pranchas e no contrato`; `git push -u origin claude/abertura-concluida-na-contagem`; `gh pr create` com o título "A Contagem vira a entrada das contagens; a abertura concluída em Anteriores" e o corpo em português (o pedido de 18/11, as duas fotos, o que muda, o que espera a coleção da rodada, os testes), terminando com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Depois: `mcp__ccd_pr__get_status`/`bind_pr`; o número do PR volta ao diagnóstico num commit `docs(...)`; merge só com o CI verde e o OK do Leonardo, à mão, nunca `--auto`.

---

## Auto-revisão

- **Cobertura do desenho:** a entrada (Tarefas 3 e 4); a linha da abertura (1 e 3); a tela de hoje na rota nova e os dois redirecionamentos (4 e 5); a Contagem por caixa intacta com o cartão compartilhado (2); v3, textos, axe, carregamento (3 e 4); menu, papéis e título (4); o registro e as fotos (6).
- **Nomes:** `registroDaAberturaConcluida` (1) → `contagem.tsx` (4); `CartaoDaRodada` (2) → `contagem-view.tsx` (3); `ContagemView`, `ROTA_DA_ABERTURA` (3) → (4) e (5).
- **Review Focus:** 1 → Tarefa 1; 2 → Tarefas 4 e 5; 3 → Tarefa 5; 4 → Tarefa 4; 5 → Tarefa 3.
- **Proporção:** os testes trazem os textos e os links exatos; os corpos ficam com quem constrói.
