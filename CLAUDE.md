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
  `tools/congelar_projeto.ps1`). Fase 2, núcleo e app único, em andamento
  (desenho e registro em `docs/plataforma/fase-2-nucleo.md`): parte 1, papéis
  da plataforma e módulos contratados, na homologação; parte 2, tela de entrada
  por módulo, em PR. **Comercial v1 adiantado para antes da Operação** em
  20/10/2026: desenho e ordem das partes em `docs/plataforma/fase-6-comercial.md`,
  telas aprovadas em `docs/mockups/Com*.dc.html`.
- **Comercial v1 está na `main`, ligado só no `dute-homolog`** (no `dute-prod`
  as callables recusam e as telas não existem). Roteiro para ligar em produção,
  com ordem, como desfazer e decisões: `docs/plataforma/comercial-producao.md`.
- **Papéis e módulos têm lista única em `lib/dominio`.** As Functions
  (`functions/wms/src/domain/platform-roles.ts`, `customer-profile.ts`) e o
  `firestore.rules` guardam cópias literais, travadas por
  `artifacts/app/src/lib/platform-lists.test.ts`. As callables de hoje são do
  WMS e negam por padrão papel novo e cliente sem armazenagem. Telas novas da
  plataforma ficam sob `lib/liberacao.ts`: ligadas no `dute-homolog`,
  desligadas no `dute-prod` até um PR com o OK do Leonardo.
- **Projetos Google Cloud**, todos em `southamerica-east1`:
  - `dute-prod`: produção (`app.dutelog.com.br` e o site `dutelog.com.br`, Cloud
    Run `dute-app` e `dutelog-site`, Load Balancer com IP `34.54.243.247`).
    Certificados do Certificate Manager; a renovação depende dos CNAMEs
    `_acme-challenge_drmxqhwlpiaruyad*` na Hostinger, que não podem sair.
    Firestore com PITR de 7 dias e backup diário de 14 dias desde 20/10/2026;
    restaurar é sempre para um banco novo, com o OK do Leonardo
    (`docs/plataforma/backup-e-recuperacao.md`).
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
    Comercial em `domain/liberacao.ts`, só `dute-homolog`, igual à
    `COMERCIAL_AMBIENTES_LIBERADOS` do app; papéis owner, admin e comercial) e
    grava por `runIdempotent` (recibo em `comercial_operations`) com
    `createComercialEvent` (evento sem valor nem contato de cliente, payload
    `.strict()` por tipo). Callable escrita como `export const nome = onCall(`,
    numa linha só, no `src/index.ts`; ali nenhuma outra linha usa `onCall(`,
    nem comentário, porque a conferência do invoker reprova (trava em
    `src/callables.test.ts`).
  - `lib/dominio`: tipos e regras que o app e as Functions precisam ter iguais.
- **IA native.** Todo módulo novo grava desde o primeiro dia o que a IA precisa
  (eventos em `events`, tempos e medidas) e respeita o isolamento por cliente. A
  IA recomenda e mostra de onde tirou; uma pessoa decide (invariante 3).
- **Telas novas seguem a v3** (`docs/mockups/README.md`); as do WMS seguem
  `docs/sistema-visual.md` até adotarem a v3 no lançamento da Operação. Nada de
  legenda nas telas: só rótulos, dados e ações.
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
  (`dute-homolog`); a produção só recebe por disparo manual (Actions > CI > Run
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
  definida no `ci.yml`; sem ela o login quebra com "Firebase não configurado"
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
npm --prefix functions/wms run test:integration   # emulador Firestore, exige Java
npm --prefix functions/wms run test:critical      # os dois acima

npm --prefix functions/comercial ci
npm --prefix functions/comercial run test:unit         # node --test
npm --prefix functions/comercial run test:integration  # emulador Firestore, exige Java 21
npm --prefix functions/comercial run test:critical     # os dois acima
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
  de dinheiro e estoque. A camada de autorização dos callables ainda tem cobertura
  fraca.
- Publicar só a partir de `main` limpa e atualizada. Pelo CI a tag da imagem é o
  commit; pelo roteiro manual é timestamp — aí a rastreabilidade depende dessa
  disciplina.
