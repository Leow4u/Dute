# Dute — contrato de trabalho

Sistema de inventário, armazenagem, movimentações e cobrança para a operação
BTG/Dutelog. Em produção desde 30/07/2026, com operação real e faturamento real.

Este arquivo é a fonte de verdade sobre **como trabalhar neste repositório**. A
documentação de produto e operação está em `docs/`.

## Verdades do projeto

- **`main` é a branch de trabalho.** O PR #1 (`codex/ai-native-foundation`) foi
  mergeado em 02/09/2026. Não existe mais branch paralela com "o código de verdade".
- **Produção é `https://app.dutelog.com.br`**, servida por Cloud Run
  (`dute-btg-app`, região `southamerica-east1`, projeto Google Cloud `dute-btg`).
  Firebase Hosting **não** é produção nem fallback.
- **Frontend publica pelo GitHub Actions; functions são manuais.** O job
  `deploy-frontend` roda a cada push em `main` e por disparo manual (Actions >
  CI > Run workflow), montando a imagem no runner e enviando ao Artifact
  Registry. Ver `docs/deploy-manual.md` (inclui o roteiro manual de reserva) e
  `docs/deploy-functions-manual.md` (Cloud Functions, sempre manual).
- **Depois de qualquer deploy de functions, rode
  `tools/check_functions_invoker.ps1`.** Em 03/09/2026, 8 callables (incluindo
  `createCustomerRequest`) ficaram sem `roles/run.invoker` para `allUsers` e
  falhavam com um erro genérico antes mesmo do código rodar. Ver
  `docs/deploy-functions-manual.md`.
- **`pnpm` não está no PATH.** Use `corepack pnpm`. O diretório `functions/` usa
  **npm** (tem `package-lock.json` próprio), não pnpm.

## Comandos

```powershell
corepack pnpm install
corepack pnpm run typecheck                                   # workspace inteiro
corepack pnpm --filter "@workspace/btg-inventory" run build
corepack pnpm --filter "@workspace/btg-inventory" run test    # vitest
corepack pnpm --filter "@workspace/btg-inventory" run dev

npm --prefix functions run test:unit          # node --test
npm --prefix functions run test:integration   # emulador Firestore, exige Java
npm --prefix functions run test:critical      # os dois acima
```

O `typecheck` do root roda `tsc --build` primeiro, gerando os `.d.ts` de
`lib/api-client-react` que o app referencia. Sem isso um checkout limpo falha com
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
de abertura. A fonte de verdade de estoque é o ledger e as coleções operacionais
no Firestore.

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

**Verifique cada achado contra o código atual antes de agir sobre ele.**

## Como trabalhamos

- Um problema por PR, com teste que falha antes e passa depois.
- CI verde antes de publicar (`frontend-typecheck`, `functions-unit`,
  `functions-integration`).
- Não refatorar os arquivos grandes (`functions/src/domain/operations.ts` e
  `functions/src/index.ts`, ~6.700 linhas cada) antes de haver teste nas trilhas
  de dinheiro e estoque. A camada de autorização dos callables ainda tem cobertura
  fraca.
- Publicar só a partir de `main` limpa e atualizada. A tag da imagem é timestamp,
  não commit — a rastreabilidade de produção depende dessa disciplina.
