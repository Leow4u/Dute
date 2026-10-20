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
  19/10/2026; a próxima é a Fase 1, migração do WMS para o `dute-prod`.
- **Projetos Google Cloud**, todos em `southamerica-east1`:
  - `dute-btg`: produção atual (`app.dutelog.com.br`, Cloud Run `dute-btg-app`).
    Depois do corte da Fase 1 fica parado de 30 a 60 dias; quem apaga é o
    Leonardo.
  - `dute-homolog`: homologação. Recebe cada push em `main` (Cloud Run
    `dute-app`, endereço `run.app`).
  - `dute-prod`: produção da plataforma, vazio até o corte da Fase 1.
- **Pastas:**
  - `artifacts/app` (`@workspace/app`): o app único, hoje o WMS.
  - `artifacts/dutelog-site`: site institucional.
  - `functions/wms`: Functions do WMS, codebase `default` no `firebase.json`.
    O nome precisa continuar `default`: com outro, o deploy trataria as
    functions já publicadas como de outro codebase. Módulo novo nasce em
    `functions/<modulo>` com codebase próprio, nunca dentro de `functions/wms`.
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
  (`dute-btg-app`, região `southamerica-east1`, projeto Google Cloud `dute-btg`)
  até o corte da Fase 1. Firebase Hosting **não** é produção nem fallback.
- **Publicação pelo GitHub Actions, em dois ambientes.** Cada push em `main`
  publica frontend e functions na homologação (`dute-homolog`); a produção só
  recebe por disparo manual (Actions > CI > Run workflow com `publicar_producao`
  marcado), depois de conferir na homologação. O fluxo fica em
  `.github/workflows/publicar.yml`: monta a imagem no runner, envia ao Artifact
  Registry e termina conferindo se o Cloud Run (e `app.dutelog.com.br`, na
  produção) passou a servir o build (`tools/check_frontend_deployed.sh`) e se
  cada callable está pública (`tools/check_functions_invoker.ps1`). **Verde sem
  essa verificação não vale**: em 09/10/2026 o job ficou verde oito vezes
  seguidas sem mudar a produção. O build usa a configuração web pública do
  Firebase de cada projeto, definida no `ci.yml`; sem ela o login quebra com
  "Firebase não configurado" (aconteceu em 09/10/2026). Ver
  `docs/deploy-manual.md` (inclui o roteiro manual de reserva e o que checar
  quando a verificação falha) e `docs/deploy-functions-manual.md`.
  **Regras e índices do Firestore são manuais e não vão junto com
  `--only functions`**: `cd C:\DEV\Dute` e
  `firebase deploy --only firestore --project dute-btg` (ou `dute-homolog`). Em
  16/10/2026 a tela Estoque › Posições ficou em "Missing or insufficient
  permissions" depois do deploy de functions, até as regras subirem.
- **Depois de qualquer deploy de functions, rode
  `tools/check_functions_invoker.ps1 -ProjectId <projeto>`** (padrão `dute-btg`).
  Em 03/09/2026, 8 callables (incluindo `createCustomerRequest`) ficaram sem
  `roles/run.invoker` para `allUsers` e falhavam com um erro genérico antes mesmo
  do código rodar. Ver `docs/deploy-functions-manual.md`.
- **Zeragem total para novo go-live tem roteiro próprio:**
  `docs/novo-go-live-zeragem-total.md` e `tools/full_reset_btg.py`. Descobre as
  coleções no banco, preserva só acesso (e estrutura por padrão) e exige export
  gerenciado antes de apagar. Sempre dry-run antes; a execução é manual, da
  máquina do responsável.
- **Mapa do armazém: posições, caixas, etiquetas e mapa (fase 0, 16 e
  17/10/2026).** Cadastro em Estoque › Posições (coleção `warehouse_positions`,
  preservada na zeragem; o mapa inicial das ruas A, B e C, 43 prateleiras, está
  no código e só entra com o cadastro vazio). A caixa é a unidade de manuseio
  (`warehouse_boxes`, código `CX-000001`); a prateleira é escolhida pelo motor
  em `functions/wms/src/domain/warehouse-boxes.ts`, nunca digitada. Etiquetas em
  Estoque › Etiquetas (impressão do navegador, 101,6 × 50,8 mm) e o mapa em
  Estoque › Mapa (só leitura). Desenho completo e decisões em
  `docs/mapa-do-armazem-enderecamento-dirigido.md`.
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
  só da BTG) e catálogo com dono. Ver `docs/multicliente-modelos-de-operacao.md`
  (inclui a ordem dos próximos PRs: SKU por cliente, mobiliário, insumos).
- **`pnpm` não está no PATH.** Use `corepack pnpm`. O diretório `functions/wms/`
  usa **npm** (tem `package-lock.json` próprio), não pnpm.

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
```

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
  `functions-integration`).
- Não refatorar os arquivos grandes (`functions/wms/src/domain/operations.ts` e
  `functions/wms/src/index.ts`, ~6.700 linhas cada) antes de haver teste nas trilhas
  de dinheiro e estoque. A camada de autorização dos callables ainda tem cobertura
  fraca.
- Publicar só a partir de `main` limpa e atualizada. Pelo CI a tag da imagem é o
  commit; pelo roteiro manual é timestamp — aí a rastreabilidade depende dessa
  disciplina.
