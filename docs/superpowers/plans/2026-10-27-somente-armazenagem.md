# Armazenagem exclusiva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disponibilizar só a Armazenagem em produção, com faturamento próprio e reativação possível.
**Architecture:** Modo por projeto combinado às liberações do frontend, filtro final das rotas e entrada por papel. O WMS permite baixa local quando esse modo está ativo; NFs já vinculadas mantêm sua integridade.
**Tech Stack:** React, TypeScript, Vite, Vitest, Firebase Functions.
**Spec:** `docs/superpowers/specs/2026-10-27-somente-armazenagem-design.md`

## Global Constraints

- Preservar código, dados, permissões e operação da Armazenagem.
- Aplicar a produção; manter homologação disponível para retomada.
- Financeiro continua limitado ao faturamento; papéis pausados não ganham estoque.

## Review Focus

- Financeiro não vira card residual nem perde acesso ao faturamento WMS.
- Link direto a Serviços, Campo ou TV não contorna a pausa da Operação.
- Cliente sem contrato WMS não recebe acesso por causa do modo.
- NF já vinculada não recebe baixa divergente pelo WMS.
- Homologação e reativação conservam o comportamento anterior.

### Task 1: Navegação e faturamento no modo exclusivo

**Files:** `artifacts/app/src/lib/liberacao.ts`, novo `somente-armazenagem.ts` e teste,
`platform-modules.ts`, `ambientes.ts`, `operations/index.ts`, `App.tsx`,
`financeiro/armazenagem.ts`, `pages/billing.tsx`, `functions/wms/src/domain/billing-scope.ts` e teste.

**Interfaces:** Consome liberações por projeto e perfis existentes. Produz
`SOMENTE_ARMAZENAGEM`, `rotaDisponivelNaArmazenagem(path, exclusivo)` e baixa
WMS liberada em produção, mantendo a regra de NF vinculada.

- [x] Testar entrada, seletor, rotas, portal, permissões e pagamento com produção/homologação.
- [x] Executar os testes novos e observar falhas de comportamento.
- [x] Implementar modo, navegação, filtro de rotas e ajuste de faturamento.
- [x] Rodar testes direcionados, tipagem, build do frontend e testes do domínio WMS.
- [x] Revisar o diff, documentar validação/publicação e registrar o resultado.

Pre-flight: uma tarefa, sem interfaces compartilhadas entre tarefas.

## Revisão e decisões

Revisão independente identificou a manutenção de preços vinculados ao Comercial
como dependência importante. Corrigida reutilizando a tela de contratos em
`/faturamento/contratos`, exclusiva de owner/admin, filtrada pelo cliente ativo.
Os testes reproduziram a navegação que escapava para o módulo oculto e a falta
de filtro por cliente antes da correção, e verificaram a criação da tabela pela
mesma callable. A cobrança continua usando a fonte e o histórico existentes.

Ruling: backend dos módulos pausados permanece disponível, pois as tabelas da
Armazenagem dependem dele e o escopo é ocultar as áreas do app. Não revoga APIs
para usuários que já têm autorização. Faturas históricas de serviços continuam
visíveis no portal; ocultá-las perderia acesso ao histórico de cobrança.

Ruling: o modo vale apenas para produção, mantendo homologação para retomada.
Se a intenção futura for ocultar também homologação, acrescentar esse projeto
nas duas listas e validar novamente os pagamentos.

## Validação e publicação

- Frontend: 2.886 testes em 252 arquivos passaram; tipagem e build com
  `VITE_FIREBASE_PROJECT_ID=dute-prod` também passaram.
- Domínio WMS: 14 testes de escopo do faturamento e tabelas de preço passaram.
- Suíte unitária WMS: 287 passaram; falhou o teste preexistente de
  `domain/vertex-location.test.ts`, “o Genkit do WMS (...) pede na multirregião us”.
  Espera `aiplatform.us.rep.googleapis.com`; a dependência instalada usa
  `us-aiplatform.googleapis.com`. Reproduzido isoladamente com fonte e teste
  idênticos ao HEAD; não foi alterado neste trabalho.
- Nenhuma publicação, migração ou gravação em dados reais realizada.
- Publicar primeiro o ajuste de `payBillingInvoice`, depois o frontend;
  seguir `docs/deploy-manual.md`.
- Para reativar, retirar `dute-prod` das listas `ARMAZENAGEM_EXCLUSIVA_AMBIENTES`
  do app e do WMS e republicar backend/frontend juntos.
