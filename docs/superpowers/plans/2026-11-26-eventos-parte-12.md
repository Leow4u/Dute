# Eventos · parte 12: desligar o legado, documentação e produção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Eventos novo passa a ser o único Eventos: as três callables de
`client_event_templates`, o domínio delas e o `events-api.ts` do portal saem
do código; os manuais, o CLAUDE.md, o contrato de eventos e a cobertura da
API dizem o que entrou; o `dute-prod` entra na liberação com o OK do
Leonardo; e a publicação segue o roteiro, com as functions removidas
apagadas à mão antes de cada publicação.

**Architecture:** só remoção e documentação; nenhuma callable, coleção ou
tela nova. `assertClientEventEditor` muda de `domain/client-events.ts` para
`domain/eventos/edicao.ts` com as mesmas frases: as quatro linhas da matriz
da parte 2 (`saveEventEdition`, `sendEventEdition`, `cancelEventEdition`,
`archiveClientEvent`) recusam com `SO_EVENTOS_DO_CLIENTE`; as outras dez
usam `SO_ARMAZEM`, `SO_COORDENACAO` e `SO_FATURA` e não mudam. O app perde
a liberação dos Eventos inteira: as rotas do portal e da Armazenagem, o
módulo do menu, o Estoque, as leituras do Início e o "Evento" de Pedidos
deixam de olhar `EVENTOS_LIBERADO`, que sai de `liberacao.ts`;
`EVENTOS_AMBIENTES_LIBERADOS` e `eventosLiberado` ficam como espelho da
lista das Functions, travados por `platform-lists.test.ts`, cuja trava
passa a reprovar a volta do legado e qualquer `EVENTOS_LIBERADO` em
`App.tsx`, `lib/modules.ts`, `lib/liberacao.ts` e `pages/client`. A
liberação muda nas duas cópias (app e Functions). A publicação é a de
sempre (`publicar.yml`), com um passo a mais, inédito no
repositório: `firebase deploy --only functions --non-interactive` sem
`--force` aborta quando uma function do projeto não existe no código
(firebase-tools 15.22.4, `lib/deploy/functions/prompts.js`, "Aborting because
deletion cannot proceed in non-interactive mode"; precedente em
`docs/plataforma/comercial-producao.md`, o `comercialStatus` que ficou por
isso). As três são apagadas por `firebase functions:delete` no `dute-homolog`
antes do merge e no `dute-prod` antes do disparo.

**Tech Stack:** TypeScript, vitest (app), `node --test` e o emulador
(Functions), Firebase CLI e gcloud na máquina do Leonardo, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-26-eventos-design.md`, seções
"Liberação por ambiente e o legado", "Documentação", "Fora do escopo (v1)"
(a migração dos modelos antigos), "As callables", "Os status e quem move cada
um", "A edição, campo a campo", "As telas". Índice:
`docs/superpowers/plans/2026-11-26-eventos.md` (restrições e interfaces
valem aqui).

## Global Constraints

As do índice. Nesta parte, ainda: nenhum documento de `client_event_templates`
é lido, migrado ou apagado por código (a contagem na produção é pelo console
e quem recria é a BTG); as três functions do legado saem dos projetos só à
mão, por `firebase functions:delete` antes de cada publicação (T4), e o
`publicar.yml` continua sem `--force`: o CI nunca apaga function, como nunca
apaga índice; depois da T1 nenhum código nem teste do app olha a liberação
dos Eventos; a `demo/` fica como está (o Eventos dela é protótipo
próprio, `artifacts/app/demo/portal/demo-api.ts`, fora do `tsconfig` do app);
as linhas citadas são da `main` de hoje (`aa0649a1`) e as partes 1 a 11 as
deslocam: confira cada uma antes de editar; a T3 só começa com o OK do
Leonardo registrado, com a data; a T4 só com o CI do PR verde.

## Review Focus

1. O deploy não apaga function em modo não interativo: sem o
   `functions:delete` antes, o job `functions` da homologação aborta no merge
   e o da produção no disparo, e nada do commit sobe, nem o frontend (T4).
2. `assertClientEventEditor` muda de arquivo com as duas frases iguais
   ("Cliente sem código operacional.", "Perfil sem acesso aos eventos do
   cliente."): na `MATRIZ`, as quatro linhas da parte 2 (`saveEventEdition`,
   `sendEventEdition`, `cancelEventEdition`, `archiveClientEvent`) recusam
   com a segunda (`SO_EVENTOS_DO_CLIENTE`); as outras dez usam
   `SO_ARMAZEM`, `SO_COORDENACAO` e `SO_FATURA` e não mudam; o
   `edicao.test.ts` cobre as duas frases (T1).
3. Os oito testes do Estoque montam `CartPanel` com `isSavingEvent` e
   `onSaveEvent`: as props saem com o "Salvar como evento", e nenhum teste
   pode continuar a passá-las (T1).
4. `eventosLiberado("dute-btg")` continua falso com o `dute-prod` na lista; o
   caso que lança em `liberacao.test.ts` passa de `dute-prod` a `dute-btg` (T3).
5. O modelo da Necton 2027 em `client_event_templates` não é recriado: a
   edição dela entra pela parte 13 (decisão 8); a BTG recria só os outros
   modelos ativos, se houver (T4).
6. O app sem a liberação dos Eventos: nenhum `EVENTOS_LIBERADO` sobra (a
   trava e o `typecheck`), o menu da Armazenagem mostra Eventos a
   `WMS_ROLES` em todo ambiente, a barra do celular não muda (Eventos fica
   em "Mais", parte 7), e os testes que contavam com a liberação desligada
   no vitest (o menu, o Mais do celular, o Início) mudam com o código, sem
   voltar a fixá-la por `vi.mock` (T1).

---

### Task 1: as três callables do legado, o domínio e o `events-api.ts` saem

**Files:**
- Delete: `functions/wms/src/domain/client-events.ts`, `functions/wms/src/domain/client-events.integration.test.ts`
- Modify: `functions/wms/src/index.ts` (o `import { … } from "./domain/client-events.js"`, hoje linhas 172-178; `requestedCustomer` e as três callables com os comentários, hoje 7221-7253, só elas o usam; o import de `assertClientEventEditor` que a parte 2 trouxe passa a `./domain/eventos/edicao.js`)
- Modify: `functions/wms/src/domain/eventos/edicao.ts` (recebe `assertClientEventEditor` e `INTERNAL_EDITORS`, hoje `client-events.ts` 24 e 81-89)
- Modify: `functions/wms/src/domain/eventos/edicao-gravacao.ts` (o import de `assertClientEventEditor` de `../client-events.js`, que a parte 2 trouxe na T3, passa a `./edicao.js`; sem isso, apagar `client-events.ts` quebra o `typecheck`, e a trava de `platform-lists.test.ts` reprova o import antigo)
- Modify: `functions/wms/src/callables-papeis.integration.test.ts` (as linhas `archiveClientEventTemplate`, hoje 94-98, `listClientEventTemplates`, 181, e `saveClientEventTemplate`, 250-254; `SO_EVENTOS_DO_CLIENTE`, linha 65, fica: as quatro linhas da parte 2, `saveEventEdition`, `sendEventEdition`, `cancelEventEdition` e `archiveClientEvent`, o usam; as outras dez dos Eventos usam `SO_ARMAZEM`, `SO_COORDENACAO` e `SO_FATURA` e não mudam)
- Modify: `functions/wms/src/firestore.rules.test.ts` (a semente `client_event_templates/cev-a`, hoje 191-197, e o caso "eventos do portal só passam pelas Cloud Functions…", 628-642: coleção sem regra e sem código)
- Modify: `functions/wms/package.json` (`lib/domain/client-events.integration.test.js` sai de `test:integration`)
- Delete: `artifacts/app/src/pages/client/events-api.ts`, `artifacts/app/src/lib/client-events.ts`, `artifacts/app/src/lib/client-events.test.ts`; a tela legada que a parte 4 moveu, `pages/client/eventos-modelos.tsx` (`ClienteEventosModelos`, `EventEditDialog`), com `eventos-modelos-carregando.test.tsx`, `eventos-modelos-editar.test.tsx` e `eventos-modelos-excluir.test.tsx`; e `pages/client/eventos-liberacao.test.tsx` (parte 4, T7: só compara o novo com o legado)
- Modify: `artifacts/app/src/pages/client/eventos.tsx` (`ClienteEventos = () => (EVENTOS_LIBERADO ? <ListaDeEventos /> : <ClienteEventosModelos />)`, parte 4, vira só a lista), `artifacts/app/src/pages/client/index.ts` (o export de `ClienteEventosModelos` sai), `artifacts/app/src/App.tsx` (todo spread sob `EVENTOS_LIBERADO` vira as `protectedRoute` diretas, como as outras: o do portal da parte 4, `...(EVENTOS_LIBERADO ? [protectedRoute("/portal/eventos/novo", …), protectedRoute("/portal/eventos/edicao", …)] : [])`, o spread próprio do romaneio da parte 11, `/portal/eventos/romaneio`, e o da Armazenagem das partes 7 e 8, `/eventos/edicao` e `/eventos`; o import de `EVENTOS_LIBERADO` sai)
- Modify: `artifacts/app/src/lib/liberacao.ts` (`EVENTOS_LIBERADO` e o comentário dele saem; no comentário do bloco da parte 1, a frase do portal que fora da liberação segue com o Eventos de hoje e o "Salvar como evento" passa a dizer que fora dela as telas abrem e as callables recusam; `EVENTOS_AMBIENTES_LIBERADOS` e `eventosLiberado` ficam, espelho da lista das Functions)
- Modify: `artifacts/app/src/lib/use-inicio-do-wms.ts` (o `EVENTOS_LIBERADO &&` de `seesEventos`, parte 7, que liga também a leitura da parte 10, e o de `seesRetornos`, parte 9, com o import), `artifacts/app/src/pages/pedidos.tsx` e `artifacts/app/src/pages/customer-requests.tsx` (o "Evento" da parte 8, na solicitação e no pedido com `event_edition_id`, deixa de olhar a liberação; `pages/pedidos.evento.test.tsx` e `pages/customer-requests-detalhe.test.tsx` perdem o `EVENTOS_LIBERADO` do mock de `@/lib/liberacao` que a parte 8 lhes deu, e o `OPERACAO_LIBERADO` fica; a lista permitida do `it` da parte 6 em `pedidos.evento.test.tsx` fica com o "Evento" que a parte 8 lhe deu, e a de `customer-requests-detalhe.test.tsx` também, se ele conferir lista de textos: o link passa a aparecer em todo ambiente)
- Modify: `artifacts/app/src/lib/functions-api.ts` (as três rotas `/api/client/events`, hoje 160-173)
- Modify: `artifacts/app/src/pages/client/estoque.tsx` (o ramo que a parte 5 deixou sob `const legado = !EVENTOS_LIBERADO`: o import de `@/lib/client-events`, hoje 70, e de `./events-api`, 88; `useClientEvents`, `useSaveClientEvent`, `applyEvent`, o `DraftLoader key="evento"` e o "Abrindo o evento…", hoje 259-330 e 425-438; `saveCartAsEvent`, 671; `idDaEdicao = EVENTOS_LIBERADO ? wantsEvent : null` vira `wantsEvent`; em `CartPanel`, as props opcionais `isSavingEvent` e `onSaveEvent` e o bloco "Salvar como evento", hoje 2018-2040, 2067-2068 e 2215-2282)
- Modify: `artifacts/app/src/pages/client/estoque-carregando.test.tsx` (os casos do legado "o evento no pedido", hoje 173-181, e "Salvar como evento", 183-227, e o `vi.mock("@/lib/liberacao", …)` da parte 5), `estoque-evento.test.tsx` e os outros `estoque*.test.tsx` (o mesmo `vi.mock`, que fica sem leitor; o caso "sem onSaveEvent, o painel do pedido não oferece Salvar como evento" de `estoque.test.tsx` fica, como trava do carrinho)
- Modify: `artifacts/app/src/lib/modules.ts` (o comentário do módulo `client-events`, hoje 774: a edição do evento, não "vira pedido no Estoque"; o módulo `eventos` da parte 7 perde `liberacao: "eventos"`, e o tipo `AppModule.liberacao` perde o `"eventos"`; `navigationForAmbiente` e `getNavigationForProfileRole` perdem o parâmetro `eventos` e o filtro `(module.liberacao !== "eventos" || eventos)`; o import de `EVENTOS_LIBERADO` sai; `FORA_DA_BARRA_DO_CELULAR`, da parte 7, fica: no celular, Eventos segue em "Mais" e a barra não muda)
- Modify: `artifacts/app/src/lib/modules.test.ts` (o `it` "Eventos entra no menu do WMS entre Estoque e Faturamento só com a liberação" da parte 7, T6, perde a metade sem a liberação e o quinto argumento, e o `it` da parte 7 na barra do celular ("com a liberação, Eventos fica em Mais no celular e a barra do operador não muda") perde o quinto argumento e o "com a liberação" do nome, com as mesmas expectativas; os casos de lista exata, o `menu` de owner e admin, hoje 229-243, e o do `wms`, 244-251, passam a ter o módulo Eventos depois de Estoque; nos da barra do celular de owner e do `wms`, hoje 462-478, a barra não muda (o `eventos` fica fora de `MOBILE_BAR_PRIORITY` e o laço que completa a barra o pula, `FORA_DA_BARRA_DO_CELULAR`, parte 7), e só o Mais ganha "Eventos · Eventos" depois de "Estoque · Posições": o caso "operador WMS completa a barra com Documentos" fica com o nome e a barra), `artifacts/app/src/lib/resumo-do-modulo.test.ts` (o caso da parte 7 perde o quinto argumento de `getNavigationForProfileRole`)
- Modify: os testes que montam o `useInicioDoWms` de verdade, sem simulá-lo (hoje `pages/home.carregando.test.tsx`, `components/layout/wms-layout.test.tsx` e `pages/entrada-leituras.test.tsx`): sem a liberação, as três leituras dos Eventos (`edicoesEnviadas`, `edicoesNoEvento` e `edicoesRetornadas`, de `lib/eventos/agenda.ts`, partes 7, 9 e 10) rodam no vitest; o que conta as leituras (`entrada-leituras`) passa a esperá-las para quem as vê, e os outros ganham o `vi.mock` delas devolvendo `[]`
- Test: `functions/wms/src/domain/eventos/edicao.test.ts`, `artifacts/app/src/lib/platform-lists.test.ts`

**Interfaces:**
- Consumes: `assertClientEventEditor` (hoje em `domain/client-events.ts`, importado pelas callables da parte 2 e por `domain/eventos/edicao-gravacao.ts`, parte 2, T3), `SO_EVENTOS_DO_CLIENTE` (as quatro linhas da parte 2), `CALLABLES_DOS_EVENTOS` (parte 2, `lib/wms/eventos.ts`), `EVENTOS_LIBERADO` (parte 1) e quem o lê: `ListaDeEventos`, `ClienteEventosModelos`, `ClienteEventoNovo`, `ClienteEventoEdicao` e o `it` "o portal só troca de Eventos com a liberação: a lista e as rotas do formulário" (parte 4); `legado` e `idDaEdicao` em `ClienteEstoque` (parte 5); o módulo `eventos` com `liberacao: "eventos"`, o parâmetro `eventos` de `navigationForAmbiente` e de `getNavigationForProfileRole`, a rota `/eventos`, `seesEventos` em `useInicioDoWms`, `FORA_DA_BARRA_DO_CELULAR` e os `it` "Eventos entra no menu do WMS entre Estoque e Faturamento só com a liberação" e "com a liberação, Eventos fica em Mais no celular e a barra do operador não muda" (parte 7); a rota `/eventos/edicao` e o "Evento" de Pedidos (parte 8); `seesRetornos` (parte 9); a leitura de "Edição para fechar" sob `seesEventos` (parte 10); o spread do romaneio (parte 11); `MOBILE_BAR_PRIORITY` e `getMobileNavigation` (`lib/modules.ts`); `read` e `root` de `platform-lists.test.ts`, com `existsSync` e `readdirSync` no import de `node:fs`.
- Produces: `assertClientEventEditor(actor: { role: string; customer_code?: string }): void` exportado de `functions/wms/src/domain/eventos/edicao.ts`, com os mesmos papéis (`cliente` com `customer_code`; `owner`, `admin`, `interno`) e as mesmas frases; a trava "o legado dos eventos (client_event_templates) saiu do código e o app não olha a liberação dos Eventos", no lugar do `it` da parte 4; `navigationForAmbiente` e `getNavigationForProfileRole(role, operation, comercial, financeiro)` sem o parâmetro `eventos`. Depois desta tarefa nada no app olha a liberação dos Eventos: as rotas do portal e da Armazenagem são `protectedRoute` diretas, o módulo "Eventos" aparece a `WMS_ROLES` em todo ambiente (no celular, em "Mais", com a barra de sempre), o Estoque abre o modo pelo `?evento=`, as leituras do Início e o "Evento" de Pedidos valem para quem o papel deixa, e `EVENTOS_LIBERADO` não existe mais; fora da liberação (só o `dute-btg`, congelado) a tela abre e a callable recusa com a frase da liberação. `EVENTOS_AMBIENTES_LIBERADOS` e `eventosLiberado` ficam em `liberacao.ts` como espelho da lista das Functions, travados por `platform-lists.test.ts` (a T3 muda a lista).

- [ ] **Step 1: Write the failing tests**

No `describe` dos Eventos de `platform-lists.test.ts`, no lugar do `it` da
parte 4 (que exigia os dois ternários e passa a ser o contrário), com
`existsSync` e `readdirSync` no import de `node:fs`:

```ts
it("o legado dos eventos (client_event_templates) saiu do código e o app não olha a liberação dos Eventos", () => {
  expect(read("functions/wms/src/index.ts")).not.toMatch(/ClientEventTemplate|client-events\.js|requestedCustomer/);
  expect(read("functions/wms/src/domain/eventos/edicao-gravacao.ts")).not.toContain("client-events.js");
  expect(existsSync(resolve(root, "functions/wms/src/domain/client-events.ts"))).toBe(false);
  expect(existsSync(resolve(root, "artifacts/app/src/pages/client/events-api.ts"))).toBe(false);
  expect(existsSync(resolve(root, "artifacts/app/src/pages/client/eventos-modelos.tsx"))).toBe(false);
  expect(existsSync(resolve(root, "artifacts/app/src/lib/client-events.ts"))).toBe(false);
  expect(read("artifacts/app/src/lib/functions-api.ts")).not.toContain("/api/client/events");
  expect(read("artifacts/app/src/pages/client/eventos.tsx")).not.toContain("ClienteEventosModelos");
  expect(read("artifacts/app/src/App.tsx")).toContain('protectedRoute("/portal/eventos/novo", ClienteEventoNovo)');
  expect(read("artifacts/app/src/App.tsx")).toContain('protectedRoute("/eventos", Eventos)');
  expect(read("artifacts/app/src/pages/client/estoque.tsx")).not.toMatch(/Salvar como evento|events-api/);
  expect(read("artifacts/app/src/lib/modules.ts")).not.toContain('liberacao: "eventos"');
  const doPortal = readdirSync(resolve(root, "artifacts/app/src/pages/client"))
    .filter((nome) => /\.tsx?$/.test(nome))
    .map((nome) => `artifacts/app/src/pages/client/${nome}`);
  for (const arquivo of ["artifacts/app/src/App.tsx", "artifacts/app/src/lib/modules.ts", "artifacts/app/src/lib/liberacao.ts", ...doPortal]) {
    expect(read(arquivo), arquivo).not.toContain("EVENTOS_LIBERADO");
  }
  expect(read("functions/wms/package.json")).not.toContain("client-events.integration");
});
```

Em `modules.test.ts`, o `it` da parte 7 passa a "Eventos entra no menu do
WMS entre Estoque e Faturamento, em todo ambiente": sem o quinto argumento,
`getNavigationForProfileRole("admin", null, false, false)` tem "Estoque",
"Eventos", "Faturamento" em seguida e o do `wms` tem "Eventos"; a metade
"sem a liberação, não tem" sai. Os casos de lista exata ganham o módulo:
`{ label: "Eventos", routes: ["Eventos"] }` depois de Estoque no `menu` de
owner e admin e no do `wms`; "Eventos · Eventos" depois de "Estoque ·
Posições" no Mais de owner e no do `wms`. A barra do celular não muda: o
caso "operador WMS completa a barra com Documentos" segue com "Pedidos",
"Estoque", "Agent Dute", "Documentos", e o `it` da barra da parte 7 só
perde o quinto argumento (e o "com a liberação" do nome).

Em `edicao.test.ts`: `assertClientEventEditor({ role: "cliente" })` lança
`permission-denied` "Cliente sem código operacional."; `{ role: "wms" }` lança
`permission-denied` "Perfil sem acesso aos eventos do cliente."; `{ role:
"interno" }` e `{ role: "cliente", customer_code: "BTG Pactual" }` não lançam.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/platform-lists.test.ts src/lib/modules.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/edicao.test.js`
Expected: FAIL (o legado existe, `edicao-gravacao.ts` ainda importa de
`../client-events.js` e o app ainda olha `EVENTOS_LIBERADO`; no vitest, sem
`VITE_FIREBASE_PROJECT_ID`, o menu não tem Eventos; `edicao.js` não exporta
`assertClientEventEditor`).

- [ ] **Step 3: Remove the legacy from the Functions**

Mova `assertClientEventEditor` e `INTERNAL_EDITORS` para `edicao.ts` sem
mudar uma letra das frases; aponte o import do `index.ts` para
`./domain/eventos/edicao.js` e o de `edicao-gravacao.ts` (parte 2, T3) para
`./edicao.js`; apague `client-events.ts` e o teste de
integração; tire o import, `requestedCustomer` e as três callables do
`index.ts` (o comentário `// Eventos (…)` da parte 2 passa a seguir
`setClientItemArchived`); tire as três linhas da `MATRIZ`, a semente e o caso
de `firestore.rules.test.ts`, e o teste da lista de `test:integration`.
`callables-auth.integration.test.ts` descobre as callables pelo `index.ts`:
as três somem sozinhas.

- [ ] **Step 4: Remove the legacy from the app**

Apague `events-api.ts`, `lib/client-events.ts` com o teste,
`eventos-modelos.tsx` com os três testes e `eventos-liberacao.test.tsx`; tire
as três rotas de `functions-api.ts`; em `eventos.tsx`, `ClienteEventos` passa
a ser só `ListaDeEventos`, e `index.ts` deixa de exportar
`ClienteEventosModelos`; em `App.tsx`, cada spread sob `EVENTOS_LIBERADO`
(o do portal, o do romaneio e o da Armazenagem) vira as `protectedRoute`
diretas; em `estoque.tsx`, o `legado` inteiro, o `idDaEdicao` condicional e
as props `isSavingEvent` e `onSaveEvent` de `CartPanel` (e de quem o monta
nos testes, `grep -ln "isSavingEvent\|onSaveEvent" src/pages/client/*.test.tsx`);
nos testes do Estoque, os dois casos do legado e o `vi.mock("@/lib/liberacao", …)`
que ficou sem leitor; em `modules.ts`, o comentário, `liberacao: "eventos"`
e o parâmetro `eventos` com o filtro dele; em `resumo-do-modulo.test.ts`, o
quinto argumento; em `use-inicio-do-wms.ts`, o `EVENTOS_LIBERADO &&` de
`seesEventos` e de `seesRetornos`; em `pedidos.tsx` e
`customer-requests.tsx`, a condição do "Evento", e o `EVENTOS_LIBERADO` do
mock dos testes deles, com o "Evento" mantido nas listas dos textos (parte
8); nos testes que montam o
Início de verdade, as leituras dos Eventos simuladas (ou esperadas, no que
conta as leituras), nunca a liberação fixada de volta; por fim
`EVENTOS_LIBERADO` sai de `liberacao.ts`, com o comentário do bloco
corrigido. Então `grep -rn "EVENTOS_LIBERADO" artifacts/app/src` só acha a
trava de `platform-lists.test.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: os dois comandos do passo 2; `cd C:\DEV\Dute; corepack pnpm run typecheck`;
`cd C:\DEV\Dute\artifacts\app; npx vitest run src/pages/client src/lib/modules.test.ts src/lib/resumo-do-modulo.test.ts src/lib/cloud-api-indices.test.ts src/components/layout src/pages/home src/pages/entrada src/pages/pedidos src/pages/customer-requests`;
`cd C:\DEV\Dute\functions\wms; npm run build:test; firebase emulators:exec --project demo-dute-operations --only firestore,storage,auth "node --test lib/callables-papeis.integration.test.js lib/callables-auth.integration.test.js lib/firestore.rules.test.js lib/domain/eventos/edicao.integration.test.js"`
Expected: PASS; a matriz sem linha sem callable e sem callable sem linha; o
`typecheck` sem `EVENTOS_LIBERADO` nem o quinto argumento do menu em lugar
nenhum.

- [ ] **Step 6: Commit**

```bash
git add -A functions/wms/src functions/wms/package.json artifacts/app/src
git commit -m "feat: o legado dos eventos do portal sai (as três callables, o domínio e o events-api) e o app deixa de olhar a liberação dos Eventos"
```

### Task 2: os manuais, o CLAUDE.md, o contrato de eventos e a cobertura da API

**Files:**
- Modify: `docs/manual-portal.md` (a linha "Eventos" da tabela do menu, hoje 61; o bullet "Salvar como evento" do Estoque, 138-139, vira o modo "montando o evento"; a seção "## Eventos", 164-184, refeita)
- Modify: `docs/manual-armazenagem.md` (a tabela do menu, hoje 13-24, ganha "Eventos"; "O cliente ativo", 51-54: "Mostram todos" ganha a agenda dos Eventos; a tabela do Início, 63-71, ganha as três linhas; seção nova "## Eventos" entre "## A entrega do pedido" e "## Receber", hoje 234; "## Devoluções", 521-529, a devolução que nasce do retorno; "## Quem vê valor", 554-561, o bloco "Preço fechado")
- Modify: `CLAUDE.md` (bullet novo em "Verdades do projeto", antes de "**`pnpm` não está no PATH.**", hoje linha 593)
- Modify: `docs/contrato-eventos-ai-native.md` (as três linhas `client_event_template.*`, hoje 43-45, saem; grupo novo "Eventos do cliente (a edição):" com os dezessete tipos `evento.*` que as partes 2 a 11 gravam (com o `evento.foto_retirada`, da parte 8); o 18º de `EVENTO_EVENT_TYPES`, `evento.pedido_adotado`, entra no grupo na parte 13, que o grava)
- Modify: `docs/api-cobertura.md` (linha 10, a coluna "Explicitamente fora desta versão" da Armazenagem ganha "; Eventos do cliente (`client_events`, `client_event_editions`, `client_event_prices`): não cobertos")
- Modify: `docs/mockups/README.md` (hoje 834, "(nada no código ainda)" vira o registro: as partes 1 a 11 na `main`, com os PRs, e a parte 12; cada linha da tabela das oito pranchas ganha ao fim "No código desde DD/MM/2026 (PR N)", como a linha da Folha de contagem, 771)

**Interfaces:**
- Consumes: os nomes do índice: as três coleções, as catorze callables, `op_evento_<ação>_<digest>`, `functions_client_events`, `EVENTO_EVENT_TYPES` (parte 2), `EVENTOS_COLLECTIONS` (parte 1), `functions_event_return` (parte 9), as rotas `/portal/eventos*` e `/eventos*`, `EVENTOS_AMBIENTES_LIBERADOS`.
- Produces: a seção "## Eventos" dos dois manuais e o bullet "Eventos do cliente" do CLAUDE.md, que a T3 e a T4 completam com as datas.

- [ ] **Step 1: Write the six files**

Os textos das telas são os das pranchas e da spec ("As telas"), sem legenda
nem explicação de código nos manuais:

- `manual-portal.md`, menu: "Eventos | As edições de cada evento: o plano, o
  envio e a história. | Armazenagem, no modelo Uniformes". Estoque: o bullet
  do "Salvar como evento" vira "**Montando o evento**: aberto por "Escolher
  no Estoque", a faixa com o evento e o total, "Adicionar ao evento" e
  "Alterar no evento" nos cartões, o filtro "No evento" e o painel "Itens do
  evento" com "Ver os N itens" e "Voltar ao evento"; o carrinho de pedido
  avulso não se mistura com ele". A seção "## Eventos": a lista ("Novo
  evento", um cartão por evento com a edição mais recente e as anteriores,
  "Nova edição a partir de <label>", os filtros Próximas, Em andamento,
  Fechadas e Todas); o formulário (o evento, Onde, Cronograma com os sete
  momentos e "Outro momento", "O que vai · do estoque Dutelog" como resumo,
  "O que vai · coleta no cliente", Observações, anexos; no Cronograma vale a
  decisão 12 da spec: a hora é opcional, menos na entrega no local, que
  precisa dela para enviar, "Informe a data e a hora da entrega no local",
  e sem ela o rascunho grava do mesmo jeito; a edição nasce com o
  nome do evento e grava sozinha, "Salvo 14:32"; "Salvar rascunho"; "Enviar
  para a Dutelog" cria o pedido com os itens, "Saldo insuficiente para o SKU
  …"; "A edição mudou em outra aba"); os status na ordem da spec, com quem
  move cada um e o que o cliente pode fazer ("Cancelar" em enviado,
  "Excluir rascunho"); a edição registrada ("O que aconteceu", "O que foi e o
  que voltou" com "Com diferença", o preço, o valor declarado e a proposta,
  as fotos por momento, os documentos, "Romaneio", "PDF da edição"); os
  limites da spec ("Limites e mensagens"), e que a recusa diz o campo.
- `manual-armazenagem.md`, menu: "Eventos | A agenda das edições de todos os
  clientes: "Para confirmar", "Próximos", "Em andamento" e "Para fechar"; a
  ficha de cada edição." Início: "Evento para confirmar" (coordenação,
  "Confirmar"), "Retorno do evento para registrar" (quem opera, "Registrar
  retorno"), "Edição para fechar" (coordenação, "Fechar"). "Mostram todos":
  "… Alertas, Relatórios e a agenda dos Eventos". A seção "## Eventos": a
  agenda (os quatro grupos, "Rascunho do cliente · ainda sem envio",
  "Separar até"), "Confirmar" e "Confirmar e fechar preço" (quem vê valores),
  a ficha momento a momento ("Registrar", "Registrar fim", "Editar"; no
  "Editar" do previsto vale a mesma decisão 12: a hora é opcional, menos na
  entrega no local, que precisa dela para enviar e, depois do envio, não
  fica sem ela, "Informe a data e a hora da entrega no local"), a
  entrega pelo registro de "Entrega no local" (Quem levou, Placa, Quem
  recebeu), "Registrar o retorno ao estoque" (Foi, Voltou, Avariadas, "Os
  outros N voltaram iguais", "Confirmar retorno"; a ENTRADA na EXPEDICAO e a
  guarda de volta; as avariadas nascem em Devoluções), "Fechar a edição" com
  o que falta como dado, Fotos (a coordenação retira a foto anexada por
  engano, pelo botão no canto da foto, com a confirmação "Retirar foto"; o
  `wms` não retira), Documentos, "Equipe e veículo", Histórico.
  Devoluções: a linha "Retorno do evento" que nasce das avariadas. Quem vê
  valor: "Preço fechado" só para owner, admin e financeiro; o `wms` não vê o
  preço nem a proposta.
- `CLAUDE.md`, o bullet diz: o que o evento é (decisões 1 a 16, a spec e as
  pranchas); as três coleções, só o WMS escreve, o dinheiro só em
  `client_event_prices`, nunca lida pelo `wms`; as catorze callables de uma
  linha em `functions/wms/src/index.ts` com `assertEventosLiberado`, o
  domínio em `functions/wms/src/domain/eventos/`, os recibos `op_evento_*` e
  os eventos `evento.*` (`functions_client_events`, payload estrito sem
  valor); o envio cria a solicitação com `event_edition_id`, o packing e a
  entrega escrevem a edição, o retorno faz a ENTRADA `functions_event_return`
  fora da cobrança e manda as avariadas a Devoluções; as rotas do portal e da
  Armazenagem e a v3; a zeragem preserva as três coleções e os eventos de
  auditoria de origem `functions_client_events` cujo tipo começa por
  `evento.` (`EVENTOS_EVENT_TYPE_PREFIX`); os do modelo antigo vão embora;
  o legado `client_event_templates` (as três callables e o "Salvar como
  evento") saiu do código nesta parte, e a function removida pede
  `firebase functions:delete` à mão antes da
  publicação, nunca pelo CI (o `publicar.yml` continua sem `--force`;
  `docs/deploy-functions-manual.md`, "Function removida do código"). A frase
  da liberação e a da produção entram na T3 e na T4.

- [ ] **Step 2: Verify**

Run: `cd C:\DEV\Dute; git diff --stat` (só os seis arquivos),
`grep -rn "Salvar como evento\|client_event_template\|modelo de pedido\|Usar no pedido" docs/manual-portal.md docs/manual-armazenagem.md docs/contrato-eventos-ai-native.md`
e, no CLAUDE.md, só o que não pode sobrar (o bullet novo cita o legado e o
"Salvar como evento" para dizer que saíram):
`grep -n "modelo de pedido\|Usar no pedido" CLAUDE.md`
Expected: nenhuma linha nos dois `grep` (fora do bullet do CLAUDE.md, o
único "Salvar como evento" que fica no repositório é o da `demo/` e o das
notas históricas de `docs/mockups/README.md` e da spec).

- [ ] **Step 3: Commit**

```bash
git add docs/manual-portal.md docs/manual-armazenagem.md CLAUDE.md docs/contrato-eventos-ai-native.md docs/api-cobertura.md docs/mockups/README.md
git commit -m "docs(plataforma): os Eventos nos manuais, no CLAUDE.md, no contrato de eventos e na cobertura da API"
```

### Task 3: `dute-prod` na liberação (OK do Leonardo)

**Files:**
- Modify: `artifacts/app/src/lib/liberacao.ts` (o bloco dos Eventos da parte 1, já sem o `EVENTOS_LIBERADO`, que saiu na T1: a lista e o comentário, com a data do OK, no molde do bloco `RECEBIMENTO_POR_CAIXA`, hoje 156-172)
- Modify: `functions/wms/src/domain/eventos/liberacao.ts` (a lista e o comentário, no molde de `inbound-mode.ts` 29-34)
- Test: `artifacts/app/src/lib/platform-lists.test.ts` (o `it` da parte 1 no `describe` dos Eventos), `functions/wms/src/domain/eventos/liberacao.test.ts`
- Modify: `docs/manual-portal.md` (a tabela "Homologação e produção", hoje 362-368: a linha "Eventos (as edições) | Sim | Sim, desde DD/MM/2026"), `docs/manual-armazenagem.md` (a tabela "O que muda por ambiente", hoje 564-570: "A agenda e a ficha dos Eventos | Homologação e produção"), `CLAUDE.md` (no bullet da T2: "Liberação própria `EVENTOS_AMBIENTES_LIBERADOS`/`EVENTOS_PROJECTS`: homologação e, desde DD/MM/2026 com o OK do Leonardo, produção; o `dute-btg` de fora; é só das callables: no app, a lista é o espelho da das Functions e nenhuma tela a olha")

**Interfaces:**
- Consumes: `EVENTOS_AMBIENTES_LIBERADOS`, `eventosLiberado`, `EVENTOS_PROJECTS`, `assertEventosLiberado` (parte 1), `tsList` (`platform-lists.test.ts`).
- Produces: `EVENTOS_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"]` e `EVENTOS_PROJECTS = ["dute-homolog", "dute-prod"]`.

- [ ] **Step 1: Record the OK**

O OK do Leonardo, com a data, no texto do PR. Sem ele o PR para na T2 e
espera: a parte 12 não mergeia sem a produção na lista, porque o legado que a
produção mostrava fora da liberação já saiu na T1.

- [ ] **Step 2: Write the failing tests**

Em `platform-lists.test.ts`, o `it` da parte 1 passa a "a liberação das
callables é a do app: homologação e produção", com
`expect([...EVENTOS_AMBIENTES_LIBERADOS]).toEqual(["dute-homolog", "dute-prod"])`
e `[true, true, false, false]` para `dute-homolog`, `dute-prod`, `dute-btg`,
`undefined`. Em `liberacao.test.ts`: `eventosLiberado("dute-prod") === true`,
`eventosLiberado("dute-btg") === false`, e `assertEventosLiberado("dute-btg")`
lança `failed-precondition` "Eventos ainda não liberados neste ambiente.".

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd C:\DEV\Dute\artifacts\app; npx vitest run src/lib/platform-lists.test.ts` e
`cd C:\DEV\Dute\functions\wms; npm run build:test; node --test lib/domain/eventos/liberacao.test.js`
Expected: FAIL (as listas ainda são `["dute-homolog"]`).

- [ ] **Step 4: Put `dute-prod` in the two lists and update the three docs**

- [ ] **Step 5: Run tests to verify they pass**

Run: os dois comandos do passo 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/app/src/lib/liberacao.ts artifacts/app/src/lib/platform-lists.test.ts functions/wms/src/domain/eventos/liberacao.ts functions/wms/src/domain/eventos/liberacao.test.ts docs/manual-portal.md docs/manual-armazenagem.md CLAUDE.md
git commit -m "feat: os Eventos liberados na produção (OK do Leonardo em DD/MM/2026)"
```

### Task 4: a publicação pelo roteiro

**Files:**
- Modify: `docs/deploy-functions-manual.md` (subseção nova "### Function removida do código (DD/MM/2026)" depois de "### Function com segredo (Secret Manager)", hoje 445-500)
- Modify: `CLAUDE.md` (o registro da publicação no bullet da T2), `docs/mockups/README.md` (a data da produção na nota do canvas)

**Interfaces:**
- Consumes: `.github/workflows/publicar.yml` (jobs `regras`, `functions`, `frontend`; o deploy sem `--force`, linhas 131-134 e 242-245), `.github/workflows/homologacao.yml` (`workflow_run` do CI verde do push na `main`), `tools/check_functions_invoker.ps1`, `tools/check_rules_deployed.sh`, `tools/esperar_indices.py`, `tools/check_frontend_deployed.sh`, `docs/plataforma/lancamento-producao.md` (seções 4 e 5, o molde do roteiro).
- Produces: a receita "Function removida do código"; o registro da publicação.

- [ ] **Step 1: Write the recipe before running it**

Em `docs/deploy-functions-manual.md`: por que o deploy aborta (o trecho de
`prompts.js`, o precedente do `comercialStatus`), por que o workflow continua
sem `--force` (como com os índices: o CI nunca apaga sozinho), e os dois
comandos, sempre com a pasta na frente:

```powershell
cd C:\DEV\Dute
firebase functions:delete listClientEventTemplates saveClientEventTemplate archiveClientEventTemplate --region southamerica-east1 --project dute-homolog --force
firebase functions:list --project dute-homolog | Select-String ClientEventTemplate
```

O segundo não devolve nada. O mesmo par com `--project dute-prod` no passo 4.

- [ ] **Step 2: Homologação**

Antes do merge, apagar as três no `dute-homolog` (lá a liberação está ligada
desde a parte 1: a tela legada não aparece, e nada quebra). Mergear com o CI
verde; o `homologacao.yml` publica o commit; o job `functions` termina sem
"Aborting because deletion", com o invoker conferido. Se alguém mergeou
antes de apagar: apagar e, no run vermelho, "Re-run failed jobs" (não cancele
uma publicação em andamento).

- [ ] **Step 3: Conferir na homologação**

Com um login de cliente do modelo Uniformes: Eventos abre a lista nova, o
Estoque não tem "Salvar como evento" e `?evento=<id>` abre o modo "montando o
evento". Com o interno, `/eventos` abre a agenda. E:
`cd C:\DEV\Dute; pwsh tools/check_functions_invoker.ps1 -ProjectId dute-homolog`
verde.

- [ ] **Step 4: Produção**

1. No console do Firestore do `dute-prod`, coleção `client_event_templates`,
   filtro `status == "active"`: contar e anotar nome, local, data e itens de
   cada um. O da Necton 2027 fica como está (parte 13). Os outros, se houver,
   a BTG recria em Eventos › "Novo evento" com os dados que a Dutelog manda;
   passando de dez, param aqui e viram script em `tools/`, em PR próprio
   (spec, "Fora do escopo").
2. Base: HEAD da `main` com CI verde e a homologação publicada nele; PITR e
   backup diários ligados; o instante de antes anotado. Se as partes 1 a 11
   nunca foram ao `dute-prod`, é a primeira vez que as regras, os quatro
   caminhos do Storage e os cinco índices sobem lá: o job `regras` espera os
   índices prontos (`esperar_indices.py`), de alguns minutos.
3. Combinar a janela com a BTG: da exclusão até o frontend novo (uns 25
   minutos) a tela Eventos legada da produção não carrega.
4. Apagar as três no `dute-prod` (o par de comandos do passo 1).
5. Actions > CI > Run workflow, `publicar_producao` marcado, do HEAD. O job só
   vale verde com as conferências do fim (`check_rules_deployed.sh`,
   `esperar_indices.py`, `check_functions_invoker.ps1`,
   `check_api_deployed.mjs`, `check_frontend_deployed.sh` e o smoke).

- [ ] **Step 5: Depois de publicar**

`cd C:\DEV\Dute; pwsh tools/check_functions_invoker.ps1 -ProjectId dute-prod`
verde; `firebase functions:list --project dute-prod` com as catorze callables
dos Eventos e nenhuma `ClientEventTemplate`;
`gcloud firestore indexes composite list --project dute-prod` com os cinco
índices das edições `READY`; com um login da BTG, Eventos abre a lista nova
vazia com "Novo evento" e o Estoque sem "Salvar como evento"; com o admin, a
agenda `/eventos` abre e o "Precisa de você" não tem linha dos Eventos (sem
edição ainda); Pedidos, Estoque e o Faturamento da BTG como antes.

- [ ] **Step 6: Register and commit**

No bullet do CLAUDE.md: "na produção desde DD/MM/2026 (commit `…`, HH:MM
UTC, conferências verdes); o legado tinha N modelos ativos: <o que a BTG
recriou, e o da Necton à espera da parte 13>". Em `docs/mockups/README.md`,
a data da produção. Em `docs/deploy-functions-manual.md`, o que aconteceu
nos dois projetos. Num PR só de documentação, depois da publicação:

```bash
git add docs/deploy-functions-manual.md CLAUDE.md docs/mockups/README.md
git commit -m "docs(plataforma): a publicação dos Eventos na produção e a function removida do código"
```

### Pronto quando

`corepack pnpm run typecheck`, `npm --prefix functions/wms run test:unit` e
`npm --prefix functions/wms run test:integration` verdes sem nenhuma menção a
`ClientEventTemplate`, e o app sem `EVENTOS_LIBERADO` (só a trava o cita);
a homologação e a produção publicadas com as conferências verdes e sem as
três functions; a BTG com o Eventos novo e os modelos que tinha recriados
(fora o da Necton); a parte 13 pode começar.
