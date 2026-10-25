# Dute — contrato de trabalho

Plataforma da Dutelog, um sistema só para a empresa: WMS (armazenagem), Operação
(ordens de serviço), Comercial, Financeiro e RH, com um login, um app
(`app.dutelog.com.br`) e o Agent Dute. Hoje o código tem o WMS, em produção desde
30/07/2026 com operação e faturamento reais (dados zerados por completo em
16/10/2026 para um novo go-live, ver abaixo). Os outros módulos entram pelas
fases de `docs/plataforma/plano.md`.

Este arquivo é a fonte de verdade sobre **como trabalhar neste repositório**. A
documentação de produto e operação está em `docs/`.

## Plataforma (plano aprovado em 19/10/2026)

- **Plano em `docs/plataforma/plano.md`** (Fases 0 a 8) e telas em
  `docs/mockups/` (identidade v3). Fase 0, projetos e repositório, feita em
  19/10/2026. Fase 1, migração do WMS para o `dute-prod`, feita em 20/10/2026,
  antes da contagem de abertura do inventário (roteiro e registro em
  `docs/plataforma/fase-1-corte.md`; ferramentas `tools/migracao_firestore.py` e
  `tools/congelar_projeto.ps1`). Fase 2, núcleo e app único, com as partes 1 a
  2.7 na `main` (desenho, registro e "quem cai onde" em
  `docs/plataforma/fase-2-nucleo.md`): papéis e módulos contratados, entrada
  com contadores, um shell v3 por módulo com o seletor no topo, Início do
  Comercial (`/comercial`, a fila em `/comercial/orcamentos`) e da Operação
  (`/operacao`, a fila em `/operacao/hoje`) e a barreira por módulo
  contratado do cliente. Produção só com o OK do Leonardo. **Comercial v1 adiantado para antes da Operação** em
  20/10/2026: desenho e ordem das partes em `docs/plataforma/fase-6-comercial.md`,
  telas aprovadas em `docs/mockups/Com*.dc.html`.
- **Comercial v1 está na `main`, ligado no `dute-homolog` e no `dute-prod`**
  (OK do Leonardo em 21/10/2026). Telas e callables atendem; a carga em massa
  continua sem gravar no `dute-prod` e no `dute-btg`. O `dute-btg` fica de fora
  das duas listas. Roteiro, ordem e como desfazer:
  `docs/plataforma/comercial-producao.md`.
- **Operação (Fase 3, partes 3.0 a 3.14) está na `main`, ligada no
  `dute-homolog` e no `dute-prod`** (OK do Leonardo em 22/10/2026 e "pode
  deixar ligada" em 23/10): demanda direta, planejar com várias OS, Agenda,
  execução pelo escritório e pelo app `/campo` (fila sem sinal, assinatura no
  dedo), revisão com divergência, aditivo e orçamento da execução no
  Comercial, vistoria como OS, TV da sala (`/tv`, papel `painel`, que só lê o
  quadro da callable `getRoomBoard`) e a rotina diária `runDailyAlerts`
  (Cloud Scheduler, 06:00, CNH e revisão do veículo viram evento uma vez por
  dia por item). A produção serve o que foi publicado até `fde9ba0` (23/10,
  02:16 UTC); publicar a Fase 3 completa é o marco 3 e espera o OK do
  Leonardo: roteiro em `docs/plataforma/operacao-producao.md`. O `dute-btg`
  fica de fora das duas listas `OPERACAO_AMBIENTES_LIBERADOS`. Desenho,
  registro de cada parte e como desligar: `docs/plataforma/fase-3-operacao.md`.
- **Fase 4 (lançamento) na `main`, à espera do OK do Leonardo para a
  produção.** O Financeiro fica ligado só no `dute-homolog`
  (`FINANCEIRO_AMBIENTES_LIBERADOS`, no app e nas callables): `registerNf`
  registra a NF da demanda A faturar, `advanceFatura` envia, recebe, estorna
  e cancela, e o shell `/financeiro` tem Início, A faturar, a cobrança, a via
  comercial e os Relatórios. O portal com as OS, o comprovante, o Solicitar
  OS, os avisos (`runNotifications`, a cada 5 minutos; o e-mail fica
  auditado sem `RESEND_API_KEY`), a entrega do WMS e as quatro telas do WMS
  na v3 dependem da liberação da Operação e entram no `dute-prod` só por
  publicar a `main`. O Faturamento do WMS continua no shell da Armazenagem
  até a Fase 7. Roteiro do lançamento (marcos 2, 3 e 4 juntos, e a parte
  4.9b, que liga o Financeiro): `docs/plataforma/lancamento-producao.md`.
  Desenho e registro: `docs/plataforma/fase-4-financeiro.md`.
- **Fase 5 (memória da Dute) na `main`, partes 5.1a a 5.6, só no
  `dute-homolog`**: `docs/plataforma/fase-5-memoria.md` (23/10/2026). A
  codebase é `functions/core`, com as liberações próprias
  `MEMORIA_AMBIENTES_LIBERADOS` e `AGENTE_AMBIENTES_LIBERADOS` (só o
  `dute-homolog`); as medidas saem das OS revisadas e a sugestão nunca grava
  sem a pessoa. A produção espera o OK do Leonardo ("Lançamento na produção",
  no runbook).
- **Fase 7 (financeiro unificado) na `main` até a 7.5c, só no
  `dute-homolog`**: `docs/plataforma/fase-7-financeiro-unificado.md`
  (23/10/2026). A 7.4 (a NFS-e pela Omie e a baixa, pergunta 21 decidida em
  24/10/2026) está no código, nas partes 7.4a a 7.4i, e as chaves de um
  aplicativo de teste da Omie estão no `dute-homolog` desde 24/10/2026; a
  primeira emissão de lá espera os serviços `DUTE-OS` e `DUTE-ARMAZENAGEM`
  cadastrados nesse aplicativo. O a
  receber é um só (`faturas`); o WMS continua calculando a armazenagem, e a
  competência emitida nele vira um "A faturar" do Financeiro. O item da
  cobrança ligado ao Comercial (`lpu_item_id`) tira o preço da tabela do
  cliente vigente no fim da competência. A régua das
  trilhas de dinheiro do WMS é `functions/wms/src/billing-callables.integration.test.ts`
  (as callables de verdade, pelo `.run`, no emulador): nenhuma parte mexe
  no faturamento do WMS sem ela verde. Onde o Financeiro está ligado
  (`FINANCEIRO_PROJECTS` no WMS, cópia travada da liberação dele), a
  armazenagem se fatura e se recebe no Financeiro, e o WMS não marca
  pagamento (parte 7.2c). A NFS-e sai pela Omie (pergunta 21, parte 7.4; desenho no
  runbook da fase): a demanda e a competência numa emissão levam
  `emissao_nf`, e enquanto ela existe nem o `registerNf` nem o Comercial as
  tiram de A faturar.
- **Alinhamento do Comercial e da Operação recuperado em 23/10/2026**:
  `docs/plataforma/alinhamento-comercial-operacao.md` compara o desenho
  aprovado (plano, Fase 2, Fase 6 e mockups) com o que entrou na `main` de 21
  a 23/10 e lista as divergências e as decisões que esperam o Leonardo.
  Decididos em 23/10/2026: um shell por módulo é pedido do Leonardo (um menu
  único inflava demais); a carga de clientes da Omie e o legado da planilha
  saem do plano; antes de qualquer PR de tela, novo alinhamento de UX e UI.
- **Plano de implantação das fases 2 a 8** em
  `docs/plataforma/plano-de-implantacao.md` (23/10/2026): desenho, partes em
  ordem, critério de pronto e produção de cada fase, as regras que valem em
  todas (um shell por módulo, sem legenda, acessibilidade, engenharia) e as
  perguntas que cada fase espera do Leonardo. O runbook de cada fase
  (`fase-N-*.md`) registra as partes; este plano as ordena.
- **Papéis e módulos têm lista única em `lib/dominio`.** As Functions
  (`functions/wms/src/domain/platform-roles.ts`, `customer-profile.ts`) e o
  `firestore.rules` guardam cópias literais, travadas por
  `artifacts/app/src/lib/platform-lists.test.ts`. As callables de hoje são do
  WMS e negam por padrão papel novo e cliente sem armazenagem. Telas novas da
  plataforma ficam sob `lib/liberacao.ts`: ligadas no `dute-homolog` e no
  `dute-prod` (OK do Leonardo em 21/10/2026), desligadas no `dute-btg`.
- **Projetos Google Cloud**, todos em `southamerica-east1`:
  - `dute-prod`: produção (`app.dutelog.com.br` e o site `dutelog.com.br`, Cloud
    Run `dute-app` e `dutelog-site`, Load Balancer com IP `34.54.243.247`).
    Certificados do Certificate Manager; a renovação depende dos CNAMEs
    `_acme-challenge_drmxqhwlpiaruyad*` na Hostinger, que não podem sair.
    Firestore com PITR de 7 dias e backup diário de 14 dias desde 20/10/2026
    (o `dute-rh`, desde 24/10/2026); restaurar é sempre para um banco novo,
    com o OK do Leonardo (`docs/plataforma/backup-e-recuperacao.md`). O teste
    de restauração é o workflow manual `Teste de restauração`
    (`tools/teste_restauracao.py`): só ele cria e apaga o banco
    `teste-restauracao-*`, e lê só os caminhos dos documentos.
  - `dute-homolog`: homologação. Recebe cada push em `main` (Cloud Run
    `dute-app`, endereço `run.app`).
  - `dute-btg`: produção anterior, congelada desde o corte da Fase 1
    (`tools/congelar_projeto.ps1`). Fica parada de 30 a 60 dias como volta pelo
    DNS (só até 02/12/2026, quando vence o certificado do Load Balancer antigo);
    quem apaga é o Leonardo.
- **Pastas:**
  - `artifacts/app` (`@workspace/app`): o app único, hoje o WMS.
  - `artifacts/dutelog-site`: site institucional.
  - `functions/wms`: Functions do WMS, codebase `default` no `firebase.json`.
    O nome precisa continuar `default`: com outro, o deploy trataria as
    functions já publicadas como de outro codebase. Módulo novo nasce em
    `functions/<modulo>` com codebase próprio, nunca dentro de `functions/wms`.
  - `functions/comercial`: Functions do Comercial, codebase `comercial`. Toda
    callable de negócio entra por `requireComercialCaller` (liberação própria do
    Comercial em `domain/liberacao.ts`, `dute-homolog` e `dute-prod`, igual à
    `COMERCIAL_AMBIENTES_LIBERADOS` do app; papéis owner, admin e comercial) e
    grava por `runIdempotent` (recibo em `comercial_operations`) com
    `createComercialEvent` (evento sem valor nem contato de cliente, payload
    `.strict()` por tipo). Callable escrita como `export const nome = onCall(`,
    numa linha só, no `src/index.ts`; ali nenhuma outra linha usa `onCall(`,
    nem comentário, porque a conferência do invoker reprova (trava em
    `src/callables.test.ts`).
  - `functions/financeiro`: Functions do Financeiro (Fase 4), codebase
    `financeiro`, no molde da Operação: toda callable entra por
    `requireFinanceiroCaller` (liberação em `domain/liberacao.ts`, só o
    `dute-homolog` até o lançamento da Fase 4; papéis owner, admin e
    financeiro) e grava por `runIdempotent` (recibo em
    `financeiro_operations`) com o evento `nf.*` sem valor. Desenho e registro:
    `docs/plataforma/fase-4-financeiro.md`. A NFS-e pela Omie (parte 7.4):
    `emitNfOmie` põe a emissão na fila (`nf_emissoes`) e reserva, e a
    rotina `runOmieSync` (5 minutos, uma instância) chama a Omie um passo
    por vez; a autorizada vira fatura pela mesma `lerParaFaturar` e
    `gravarFatura` do `registerNf`. O pagamento da fatura que saiu pela Omie
    põe a baixa na fila (`nf_baixas`, parte 7.4g), e a mesma rotina confere
    o título da OS antes de lançar o recebimento e, no estorno, de
    cancelá-lo. As chaves (`OMIE_APP_KEY`, `OMIE_APP_SECRET`) vêm do Secret
    Manager e a rotina as declara só onde a Omie está liberada
    (`segredosDaOmie`): o projeto que as declara não publica sem elas
    (`docs/deploy-functions-manual.md`, "Function com segredo"). Sem elas,
    nada é chamado, e a emissão e a baixa param com o motivo `sem_chaves`.
  - `functions/core`: Functions do núcleo (Fase 5), codebase `core`. Hoje a
    memória da Dute: a rotina `runMeasures` (a cada 15 minutos) recalcula
    `ai_measures` a partir das OS revisadas e refaz `ai_case_memory`, uma
    lembrança por demanda fechada (tem preço: não abre pelo navegador), e
    `suggestDuration` e
    `answerSuggestion` dão a duração sugerida da OS e guardam a decisão em
    `ai_suggestions`; `findSimilarQuotes` dá a quem orça os orçamentos
    parecidos do cliente da demanda. A mesma rotina guarda em `ai_stock_age` o
    relógio de cada item do estoque, lido do razão, para os dias parado (a
    regra mora em `lib/dominio/src/parados.ts`, com cópia literal no núcleo)
    e, uma vez por dia, propõe em `ai_stock_alerts` o alerta do item parado
    de cada cliente; `answerStockAlert` é a decisão da coordenação, com o
    evento `estoque_parado.*` (o primeiro evento do núcleo); o aprovado vira
    aviso ao cliente (modelo "Itens parados") pela `runNotifications` da
    Operação.
    Toda callable entra por `requireCoreCaller`, no
    formato de uma linha do `src/index.ts` (trava em `src/callables.test.ts`).
    Liberação própria
    `MEMORIA_AMBIENTES_LIBERADOS` (só o `dute-homolog`). O Agent Dute muda
    para cá na parte 5.5, com a liberação própria `AGENTE_AMBIENTES_LIBERADOS`
    e as ferramentas só de leitura, pelo leitor por cliente (desenho em
    `docs/plataforma/fase-5-memoria.md`). Onde o agente do núcleo está
    liberado, as rotinas rodam pela `runDuteRoutines` e a `runAgentRoutines`
    do WMS não roda (`CORE_AGENT_PROJECTS`, cópia travada da liberação). A
    leitura da nota anexada usa `invoice-reading.ts` e `agent-attachments.ts`
    do WMS em cópia literal, travada em `agente-nota.test.ts`: mudou um, muda
    o outro. No app, o agente do núcleo entra em cada shell (`lib/agente`,
    rota `/<modulo>/agente`) só com a liberação dele; fora dela, segue o do
    WMS. Usa **npm**, como as outras codebases.
  - `functions/rh`: Functions do RH (Fase 8), codebase `rh`, no
    `firebase.json` desde a parte 8.1b, com o banco Firestore `dute-rh`
    (criado nos dois ambientes pelo workflow manual `Banco rh`,
    `.github/workflows/banco-rh.yml`; sem o banco num dos dois, a
    publicação das regras falha e nada sobe). As telas do RH ligam com o
    `RH_PUBLICADO` do app, travado contra o `firebase.json`.
    Toda callable entra por `requireRhCaller` (liberação
    `RH_AMBIENTES_LIBERADOS`, só o `dute-homolog`; owner, admin e rh leem, só rh
    grava). O banco `dute-rh` é fechado ao navegador (`firestore-rh.rules`): as
    regras de um banco nomeado não leem o `users` do banco padrão. Hoje a ficha
    do colaborador (parte 8.2a): `saveRhRecord` e `archiveRhRecord` gravam o
    registro, o recibo (`rh_operations`) e o evento `rh.*` numa transação do
    banco `dute-rh`, nunca no padrão; `getRhPanel` e `getRhFicha` leem; a rotina
    `runRhAlerts` avisa o vencimento uma vez por marco. O arquivo do registro
    (parte 8.2b) sobe e abre só por URL assinada (`requestRhUpload`,
    `attachRhFile`, `openRhFile`), e cada abertura vira evento; `rh/**` fica
    fechado no `storage.rules`. A folha e o eSocial ficam com a contabilidade
    (pergunta 24, parte 8.3): `exportRhMonth` gera a exportação da competência
    (os exames com os códigos do S-2220 e os colaboradores próprios, com o CPF),
    por versão e idempotente; `listRhExports` e `downloadRhExport` listam e
    baixam, com o evento. Desenho: `docs/plataforma/fase-8-rh.md`. Usa **npm**.
  - `lib/dominio`: tipos e regras que o app e as Functions precisam ter iguais.
- **IA native.** Todo módulo novo grava desde o primeiro dia o que a IA precisa
  (eventos em `events`, tempos e medidas) e respeita o isolamento por cliente. A
  IA recomenda e mostra de onde tirou; uma pessoa decide (invariante 3).
- **Telas novas seguem a v3** (`docs/mockups/README.md`). O WMS está no shell
  v3 da Armazenagem desde a parte 4.7a; cada tela dele entra na v3 pela lista
  `TELAS_DO_WMS_NA_V3` (`artifacts/app/src/lib/wms-v3.ts`): Início, Pedidos,
  Estoque e Receber até aqui, e a tela nova Estoque › Alertas (parte 5.4e). As que não estão na lista seguem
  `docs/sistema-visual.md`. Nada de legenda nas telas: só rótulos, dados e ações. Toda tela nova tem teste com a
  lista dos textos (`src/test/textos.ts`, a trava contra legenda) e com o
  `axe` (`src/test/acessibilidade.ts`, WCAG 2.1 A e AA). O "Precisa de você"
  de cada Início é a única regra de contagem: a entrada e o menu contam por
  ela (`lib/resumo-do-modulo.ts`).
- **Operação e campo nunca veem valores.** Preço só para `owner`, `admin`,
  `financeiro` e `comercial`; o cliente vê os das próprias OS e faturas.

## Verdades do projeto

- **`main` é a branch de trabalho.** O PR #1 (`codex/ai-native-foundation`) foi
  mergeado em 02/09/2026. Não existe mais branch paralela com "o código de verdade".
- **Produção é `https://app.dutelog.com.br`**, servida por Cloud Run
  (`dute-app`, região `southamerica-east1`, projeto Google Cloud `dute-prod`)
  desde o corte da Fase 1 (20/10/2026); antes, `dute-btg-app` no `dute-btg`.
  Firebase Hosting **não** é produção nem fallback.
- **Publicação pelo GitHub Actions, em dois ambientes.** Cada push em `main`
  publica regras e índices, frontend e functions na homologação
  (`dute-homolog`) pelo `.github/workflows/homologacao.yml`, que espera o CI do
  commit ficar verde (`tools/esperar_ci.py`); a fila dele é do workflow inteiro,
  em ordem de push, então dá para mergear PRs seguidos sem esperar (em
  22/10/2026 a fila de job do `ci.yml` perdeu o commit mais novo). A produção
  só recebe por disparo manual (Actions > CI > Run
  workflow com `publicar_producao` marcado), depois de conferir na homologação.
  Nenhum passo da publicação depende da máquina de alguém. O fluxo fica em
  `.github/workflows/publicar.yml`: o job `regras` publica `firestore.rules`,
  `firestore.indexes.json` e `storage.rules`
  (`firebase deploy --only firestore,storage`) e confere as regras servidas
  (`tools/check_rules_deployed.sh`); só depois sobem as functions e, por último,
  o frontend (imagem montada no runner e enviada ao Artifact Registry), para a
  tela nova nunca chegar antes da callable que ela chama. Uma publicação por
  ambiente de cada vez, sem cancelar a que está rodando (`cancel-in-progress:
  false`), e só do commit que ainda é o HEAD da main; não cancele à mão uma
  publicação no meio. A publicação termina
  conferindo se o Cloud Run (e `app.dutelog.com.br`, na produção) passou a
  servir o build (`tools/check_frontend_deployed.sh`) e se cada callable está
  pública (`tools/check_functions_invoker.ps1`). **Verde sem essa verificação
  não vale**: em 09/10/2026 o job ficou verde oito vezes seguidas sem mudar a
  produção. O build usa a configuração web pública do Firebase de cada projeto,
  definida no `ci.yml` (produção) e no `homologacao.yml`; sem ela o login
  quebra com "Firebase não configurado"
  (aconteceu em 09/10/2026). Ver `docs/deploy-manual.md` (inclui o roteiro
  manual de reserva e o que checar quando a verificação falha) e
  `docs/deploy-functions-manual.md`.
- **Regras e índices sobem antes do frontend e das functions, nunca depois.**
  Em 16/10/2026, quando eram publicados à mão, a tela Estoque › Posições ficou
  em "Missing or insufficient permissions" depois do deploy de functions, até as
  regras subirem. Se o job `regras` falha, nada mais sobe. O CI não apaga
  índice: o que sair do `firestore.indexes.json` continua no projeto (o log
  avisa) até alguém apagar com `--force`.
- **Depois de qualquer deploy de functions, rode
  `tools/check_functions_invoker.ps1 -ProjectId <projeto>`** (padrão `dute-prod`).
  Ele confere as callables de todas as codebases do `firebase.json`.
  Em 03/09/2026, 8 callables (incluindo `createCustomerRequest`) ficaram sem
  `roles/run.invoker` para `allUsers` e falhavam com um erro genérico antes mesmo
  do código rodar. Ver `docs/deploy-functions-manual.md`.
- **Zeragem total para novo go-live tem roteiro próprio:**
  `docs/novo-go-live-zeragem-total.md` e `tools/full_reset_btg.py`. Descobre as
  coleções no banco, preserva só acesso, o Comercial (sempre, com os eventos
  dele) e a estrutura (por padrão) e exige export gerenciado antes de apagar.
  Sempre dry-run antes; a execução é manual, da máquina do responsável.
- **Mapa do armazém: posições, caixas, etiquetas e mapa (fase 0, 16 e
  17/10/2026).** Cadastro em Estoque › Posições (coleção `warehouse_positions`,
  preservada na zeragem; o mapa inicial das ruas A, B e C, 43 prateleiras, está
  no código e só entra com o cadastro vazio). A caixa é a unidade de manuseio
  (`warehouse_boxes`, código `CX-000001`); a prateleira é escolhida pelo motor
  em `functions/wms/src/domain/warehouse-boxes.ts`, nunca digitada. Etiquetas em
  Estoque › Etiquetas (impressão do navegador, 101,6 × 50,8 mm) e o mapa em
  Estoque › Mapa (só leitura). Desenho completo e decisões em
  `docs/mapa-do-armazem-enderecamento-dirigido.md`.
  Na abertura, caixas passam por conferência (`counting`), revisão
  (`reviewed`) e guarda retomável (`committing`) antes de `stored`.
  Rascunhos não são estoque; fechamento/reabertura são persistidos.
  Correção de caixa preserva cadastro e saldo global; não usar estorno para
  trocar só o vínculo. Ver `docs/wms-abertura-correcoes.md`.
- **Multicliente: modelo de operação e pacote são código; o cadastro só aponta
  (19/10/2026).** `artifacts/app/src/lib/operations` registra os
  modelos (`uniformes` pronto, `mobiliario` e `insumos` em construção) e os
  pacotes (`btg`). O cadastro em Configurações › Clientes (`customers`) guarda
  `operation_template` e `sku_prefix`, validados em
  `functions/wms/src/domain/customer-profile.ts`; a projeção `client_profiles` é o
  que o portal lê para montar menu e rotas por modelo. Personalização por
  cliente é PR no pacote dele, nunca configuração de tela. **A área interna
  opera o cliente ativo** (seletor no menu, `src/lib/active-customer*.ts`):
  tela interna grava para ele, nunca para a BTG fixa (`customer-literals.test.ts`
  trava o literal). Nas Functions, `domain/customer-scope.ts` isola os
  clientes: abertura de estoque por cliente (o `system_controls/inventory` é
  só da BTG) e catálogo com dono. **O SKU não se digita**: produto novo nasce
  com `<SIGLA>-000001` gerado em `domain/catalog-codes.ts`, na transação que
  cria o produto (Contagem, Receber, conferência e envio do portal); não existe
  mais cadastro avulso de produto, e o código de barras não se repete dentro do
  cliente. Ver `docs/multicliente-modelos-de-operacao.md` (inclui a ordem dos
  próximos PRs: mobiliário, com patrimônio, e insumos).
- **`pnpm` não está no PATH.** Use `corepack pnpm`. Os diretórios
  `functions/wms/` e `functions/comercial/` usam **npm** (cada um tem
  `package-lock.json` próprio), não pnpm. Como o `pnpm-workspace.yaml` inclui
  `functions/*`, dependência nova numa codebase também muda o `pnpm-lock.yaml`:
  rode `corepack pnpm install` na raiz e confira `--frozen-lockfile`.

## Comandos

```powershell
corepack pnpm install
corepack pnpm run typecheck                                   # workspace inteiro
corepack pnpm --filter "@workspace/app" run build
corepack pnpm --filter "@workspace/app" run test    # vitest
corepack pnpm --filter "@workspace/app" run dev

npm --prefix functions/wms run test:unit          # node --test
npm --prefix functions/wms run test:integration   # emuladores Firestore e Storage, exige Java
npm --prefix functions/wms run test:critical      # os dois acima

npm --prefix functions/comercial ci
npm --prefix functions/comercial run test:unit         # node --test
npm --prefix functions/comercial run test:integration  # emulador Firestore, exige Java 21
npm --prefix functions/comercial run test:critical     # os dois acima

npm --prefix functions/core ci
npm --prefix functions/core run test:unit              # node --test
npm --prefix functions/core run test:integration       # emulador Firestore, exige Java 21

npm --prefix functions/rh ci
npm --prefix functions/rh run test:unit                # node --test
npm --prefix functions/rh run test:integration         # emulador Firestore, exige Java 21
```

Teste novo das Functions só roda se entrar na lista fixa do `test:unit` ou do
`test:integration` no `package.json` da codebase.

O `typecheck` do root roda `tsc --build` primeiro, gerando os `.d.ts` de
`lib/api-client-react` e `lib/dominio`. Sem isso um checkout limpo falha com
TS6305.

## Invariantes — não quebrar

Definidas em `docs/roadmap-producao.md` e `docs/manual-producao.md`:

1. **Nenhuma escrita crítica depende do frontend.** Transições de estoque, pedido,
   WMS e faturamento passam por Cloud Functions, com validação de papel, checagem
   do status atual, transação e idempotência.
2. **Toda transição operacional grava evento auditável em `events`**, no mesmo
   fluxo da alteração. A timeline precisa permitir reconstruir decisão e ator.
3. **A IA recomenda, nunca executa.** Genkit/Agent Dute não dá baixa em estoque,
   não fatura, não cria convite e não muda papel. Impacto real exige aprovação
   humana.
4. **`customer_code` é a fronteira de isolamento multi-cliente.** O campo histórico
   `cod_cliente` é código de item/produto do cliente e **não** serve como fronteira
   de acesso.
5. **Permissão é validada por Firestore Rules e backend**, não por componente de
   interface.

## A planilha não é fonte de verdade

`attached_assets/*.xlsx` (`Inventário_BTG_Consolidado`,
`Armazenamento_BTG_Fechamento_mensal`) foi **referência inicial do projeto e não
deve ser usada**. Não derive lógica, preço, taxonomia ou dado dela.

O sistema foi zerado e recarregado no go-live de 30/07/2026 a partir do inventário
de abertura e **zerado por completo em 16/10/2026** para um novo go-live
(`tools/full_reset_btg.py`, roteiro e registro da execução em
`docs/novo-go-live-zeragem-total.md`): catálogo, estoque, fluxos, faturamento,
eventos e Agent Dute apagados; acesso, clientes, endereços e lista de preços
preservados. O estoque volta pelo inventário de abertura (Estoque › Contagem). A
fonte de verdade de estoque é o ledger e as coleções operacionais no Firestore.

Notas antigas que tratavam a planilha como origem do modelo de dados foram
removidas justamente por induzirem a erro.

## Dados sensíveis

- `tmp/` e `.secrets/` guardam saídas de trabalho com dado de produção (exports de
  usuários do Firebase Auth, relatórios de reconciliação, snapshot de DNS). Estão
  no `.gitignore` e devem continuar assim.
- Nunca commitar esses arquivos, nunca colar o conteúdo deles em serviço externo,
  nunca incluí-los em imagem de container.
- O deploy monta um diretório de staging com apenas `Dockerfile`, `nginx.conf` e
  `dist/public` — mantenha assim.
- Onde cada dado pessoal fica, quem lê e o que falta para a LGPD:
  `docs/plataforma/lgpd.md` (25/10/2026, com as decisões que esperam o
  Leonardo).

## A auditoria de código está parcialmente vencida

`docs/auditoria-codigo-2026-07-24.md` tem 70 achados e é um bom mapa, mas é de
24/07 e houve trabalho depois. Alguns achados já foram corrigidos (ex.: liberação
de reserva ao rejeitar solicitação) e outros estão descritos de forma imprecisa.
Os caminhos citados nela e nos `docs/runbook-fase-*.md` são de antes da
reorganização de 19/10/2026 (`artifacts/btg-inventory` hoje é `artifacts/app`;
`functions/` hoje é `functions/wms/`).

**Verifique cada achado contra o código atual antes de agir sobre ele.**

## Como trabalhamos

- Um problema por PR, com teste que falha antes e passa depois.
- Comando para rodar na máquina do Leonardo vai sempre com a pasta na frente:
  `cd C:\DEV\Dute` (PowerShell) antes de `firebase deploy`, dos scripts de
  `tools/` e de qualquer `git`. Comando sem a pasta já foi rodado no lugar errado.
- Sistema visual do WMS: ver `docs/sistema-visual.md`. O teste
  `src/lib/theme-colors.test.ts` trava cor fixa e valor fora da escala
  (raio, vidro, sombra e tamanho de texto arbitrários).
- CI verde antes de publicar (`frontend-typecheck`, `functions-unit`,
  `functions-integration`, `comercial-unit`, `comercial-integration`).
- Não refatorar os arquivos grandes (`functions/wms/src/domain/operations.ts` e
  `functions/wms/src/index.ts`, ~6.700 linhas cada) antes de haver teste nas trilhas
  de dinheiro e estoque. A porta das callables do WMS (login, perfil ativo,
  papel que o WMS atende e cliente com armazenagem) está travada para todas por
  `functions/wms/src/callables-auth.integration.test.ts`; a autorização por
  papel dentro do WMS ainda tem cobertura fraca.
- Publicar só a partir de `main` limpa e atualizada. Pelo CI a tag da imagem é o
  commit; pelo roteiro manual é timestamp — aí a rastreabilidade depende dessa
  disciplina.
