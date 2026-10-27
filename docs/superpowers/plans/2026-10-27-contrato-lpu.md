# Cadastro de LPU no contrato — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cadastrar tabelas no contrato e usar seus códigos e preços nos orçamentos.

**Architecture:** Adaptar o modelo imutável `price_tables` e o catálogo `lpu_items`. A callable e o adaptador REST compartilham o domínio transacional; a UI usa a callable e a leitura existente.

**Tech Stack:** TypeScript, React/Vite, Firebase Functions e Firestore, Zod, node:test e Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-contrato-lpu-design.md`.

## Global Constraints

- Preservar isolamento por `customer_code`, auth e papéis atuais do Comercial.
- Preços em texto decimal exato com até quatro casas, no máximo 480 itens por tabela.
- Usar vigência e imutabilidade existentes; não alterar orçamento histórico.
- Eventos sem preço e recibos idempotentes na mesma transação da gravação.
- Edição manual nesta entrega; importação XLSX e DELETE fora do escopo.

## Review Focus

- Códigos D/T/M distintos com mesma descrição/unidade não colidem.
- Contrato trocado de cliente entre preflight e transação é recusado.
- Vigência omitida permite orçamento na data-base existente do contrato.
- Rascunho anterior ao cadastro pode receber a nova tabela explicitamente.
- Preço inválido, negativo, com mais de quatro casas ou documento grande é recusado integralmente.

### Task 1: Domínio e REST

**Files:** `functions/comercial/src/domain/contract-price-tables*`, `src/index.ts`, `src/api/module*`, `src/api/routes.json`, `package.json`.

**Interfaces:** `saveContractPriceTable({contrato_id,nome,codigo?,variante?,vigente_de?,vigente_ate?,itens:[{codigo,descricao,unidade,preco,categoria?,item?,servico?}],idempotency_key}) -> {ok:true,tabela_id,...}`; POST e GET `/api/v1/comercial/contratos/{id}/tabelas`.

- [x] Criar testes de schema, D/T/M, preços exatos, isolamento, conflito de vigência e replay; observar falha antes da implementação.
- [x] Implementar domínio, callable e rotas com modelo e eventos existentes; manter manifesto sincronizado.
- [x] Testar via REST cadastro seguido de orçamento com código/preço herdados e `motivo=null`.
- [x] Rodar `npm --prefix functions/comercial run test:unit` e `test:integration`.

### Task 2: Card e formulário

**Files:** `artifacts/app/src/pages/comercial/contratos*`, diálogo de tabela e helper em `lib/comercial`, `lib/comercial/api.ts` e testes correspondentes.

**Interfaces:** Consome a callable da Task 1 e o onSnapshot de tabelas do contrato.

- [x] Criar teste do botão e formulário, validações e acessibilidade; observar falha.
- [x] Adicionar nome/código/variante/datas e edição de itens, com preço pt-BR convertido sem ponto flutuante.
- [x] Exibir resultado na lista e estados de envio/erro; impedir duplicação de envio.
- [x] Rodar testes afetados e typecheck do app.

### Task 3: Rascunho e vínculo LPU

**Files:** `functions/comercial/src/domain/quotes*`, `artifacts/app/src/pages/comercial/orcamento*`, `lib/comercial/orcamentos*`.

**Interfaces:** Mantém linhas `origem:tabela`, `lpu_item_id`, quantidade e preço obtido no backend.

- [x] Testar rascunho sem tabela criado antes do cadastro e snapshot de proposta existente.
- [x] Expor atualização explícita da tabela e preservar código/preço no salvamento.
- [x] Rodar testes de orçamento backend e frontend.

### Task 4: Integração e revisão

**Files:** `docs/api.md`, `docs/api-cobertura.md`, demais testes se revelarem lacunas reais.

- [x] Documentar payload, defaults, autenticação, idempotência e limites.
- [x] Executar typecheck workspace, suíte frontend, Comercial unit/integration e build frontend.
- [x] Solicitar revisão independente e corrigir problemas materiais antes de concluir.

## Resultado da verificação local

- Frontend: 250 arquivos/2.856 testes na suíte geral; o arquivo restante (`diario.test.ts`, 12 testes) passou após estabilizar as dependências locais. Total: 251 arquivos/2.868 testes.
- Comercial: 556 testes unitários e 215 integrações em Firestore Emulator, sem falhas.
- Typecheck do workspace e build de produção do frontend passaram.
- Índices: 52 consultas registradas nos testes LPU, 11 formas, nenhuma exige índice composto novo.
- Chromium: formulário exercitado em 1440×1100 e 390×844, inclusão de itens, preço decimal, salvamento e retorno ao card; dados sintéticos e sem erro de console.
- Revisão independente concluída sem pendências materiais; nenhuma publicação ou gravação de dados reais.
