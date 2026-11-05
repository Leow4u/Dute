# Recebimento manual e cancelamento

## Objetivo e aprovação

Leonardo aprovou os cinco mockups e autorizou implementar nesta conversa: fila com cancelamento, seleção de produto e quantidade, fechar caixa, destino e revisão da entrada. A rotina confirmada é selecionar o produto da NF e digitar a quantidade física contada. A autorização é para implementação; publicação e alteração de recebimentos reais não fazem parte desta execução.

O PR #577 corrige separadamente o envio de `note` vazio. Esta implementação parte desse commit para preservar a correção.

## Contrato compartilhado

- A fila operacional continua reunindo todos os clientes. Escritas e sugestões usam o cliente da tarefa; criação e avisos usam o cliente ativo. Rascunhos são isolados por sessão. Operação permitida a owner/admin/interno/wms; suporte continua somente consulta.
- Conferência usa toda a largura útil e permite voltar à fila. Cabeçalho mantém chegada, NF e caixa ativa.
- Seleção da linha da NF abre `Quantidade nesta caixa`, vazia quando produto ainda não incluído. `Adicionar à caixa` grava o total digitado. Produto já incluído abre seu total e `Salvar quantidade`; não soma uma unidade implicitamente. Enter aciona o botão visível.
- Dado digitado permanece rascunho até sucesso. Falha mantém conteúdo, contexto e chave de retry. Vazio não remove produto. Nova edição não usa quantidade/revisão antiga após confirmação.
- Fechamento pede medidas e peso; destino confirmado não significa guarda. Caixa fechada sem prateleira continua podendo concluir entrada. Falta/sobra mantêm tratamento e justificativa.
- Revisão final mostra esperado/conferido, caixas e destino. Sem divergência, justificativa opcional é omitida. Depois da entrada ainda há guarda física.
- Criação de chegada fecha e limpa apenas no sucesso, abre a chegada criada e preserva uma intenção estável no retry. Troca de cliente isola o rascunho. Alerta de possível duplicidade ajuda a comparar documento e produtos/quantidades, permitindo outra entrega conscientemente.
- Cancelamento retira avulsa pré-entrada da fila, preserva chegada/linhas/caixas/histórico e libera reserva de posição atomicamente. Não altera a original, catálogo, saldo, movimentos ou faturamento.

### Callable de cancelamento

`cancelInboundReceipt({receipt_id, customer_code, expected_status, reason, note?, duplicate_of_receipt_id?, idempotency_key})`.

- `expected_status`: created/checking.
- `reason`: duplicate/mistake/other. Duplicate exige original diferente, do mesmo cliente e não cancelada; other exige observação.
- Resultado: `{ok:true, receipt_id, status:"cancelled", already_cancelled?:boolean}`.
- Metadata: cancelled_at/by, cancellation_reason/note/previous_status/operation_id, duplicate_of_receipt_id/number. Evento auditável único `inbound.cancelled`.
- Bloquear se entrada já movimentada, guarda aberta, caixa armazenada, inconsistência ou aviso já aprovado com esta chegada. `received_at` e quantidades conferidas não são prova de entrada.
- Proteger corridas com concluir/iniciar caixa/editar/reservar/aprovar aviso e replay idempotente. Preservar histórico contra remoção genérica posterior.

## Review Focus

1. Resposta perdida e duplo clique: mesma intenção deve gerar um único efeito, inclusive após falha.
2. Troca de cliente/recebimento com operação pendente: nenhum dado, erro ou conclusão deve atingir a nova sessão.
3. Quantidade vazia, zero, decimal e conteúdo ainda não salvo: não remover nem avançar silenciosamente.
4. Cancelar concorrente a concluir entrada ou reservar posição: uma transição terminal, sem estoque duplicado, reserva órfã ou perda de histórico.
5. Mesmo documento com entrega parcial legítima e consulta de cancelados: permitir operação válida sem misturar clientes ou reexibir ações terminais.

## Tarefas

### 1. Cancelamento transacional

Arquivos: novo `functions/wms/src/domain/inbound-cancel.ts`, testes unitários/integrados; `index.ts`, `warehouse-boxes.ts`, listas de testes e testes de autenticação/papéis/cobertura.

- [x] Testes RED para contrato, elegibilidade, isolamento, motivo/original, retry e corridas.
- [x] Implementar callable e transação preservando histórico e liberando reserva.
- [x] Proteger leitores/ações genéricas de caixas canceladas e impedir aviso de disponibilidade.
- [x] Verificar suites de cancelamento, auth/papéis e regressões de recebimento/caixas/avisos/faturamento.

### 2. Conferência e etapas aprovadas

Arquivos: `features/warehouse-ops/chegada-por-caixa*.tsx`, `destino-da-caixa.tsx`, `lib/wms/caixas-do-recebimento.ts` e testes.

- [x] RED para seleção manual, quantidade explícita, edição, erro/retry, rascunho pendente e troca de contexto.
- [x] Implementar quatro etapas com múltiplas caixas, faltas/sobras e consulta terminal.
- [x] Verificar interações, foco, textos, acessibilidade e preservação das regras de conclusão/guarda.

### 3. Fila, criação e histórico

Arquivos: `pages/receber.tsx`, `features/warehouse-ops/receiving.tsx`, `task-actions.tsx`, modelo/leitores de receiving/cloud-api e testes.

- [x] RED para fila recolhida, voltar, sucesso/erro/retry de criação e isolamento por cliente.
- [x] Implementar Em aberto/Recebidos/Cancelados, modal de cancelamento, detalhe histórico e abertura da chegada criada.
- [x] Alerta de possível duplicidade sem proibir entregas parciais legítimas.
- [x] Verificar leituras e campos de auditoria, permissões e fluxos de guarda/avisos existentes.

### 4. Modal e adaptador de cancelamento

Arquivos: novos `features/warehouse-ops/cancelar-recebimento.tsx`, `lib/wms/cancelar-recebimento.ts` e testes.

- [x] RED para motivo/original, validação, payload sem null indevido, erro, duplo clique e replay.
- [x] Implementar diálogo fiel ao mockup com contexto/motivo/original/observação e sessão isolada.
- [x] Verificar acessibilidade e integração com a fila.

### 5. Verificação e entrega

- [x] Typecheck do workspace, suíte do app e build.
- [x] Suites WMS pertinentes no emulador, incluindo billing-callables, auth/papéis e índices.
- [x] Revisão independente funcional e de concorrência.
- [x] Comparação visual das quatro etapas e cancelamento com os mockups em notebook e viewport estreito; registrar bloqueio se o navegador não estiver disponível.
- [x] Documentar comportamento e evidências visuais.
- [x] Abrir PR com dependência explícita do #577 e acompanhar CI. Não publicar nem executar recebimentos reais.

Comandos de frontend usam `PATH=/tmp/dute-review-bin:$PATH pnpm` (pnpm 9.15.9). Functions usam npm e emulador isolado. A implementação segue nesta sessão com frentes paralelas por arquivo, revisão e integração pelo agente principal.

## Evidência de execução

[Verificação visual e funcional](../../mockups/recebimento-manual/design-qa.md): 3.221 testes do app, typecheck/build, 327 testes WMS no emulador e revisão independente sem bloqueios.

Entrega: [PR #578](https://github.com/Leow4u/Dute/pull/578), baseado no [hotfix #577](https://github.com/Leow4u/Dute/pull/577). Os checks atuais ficam na aba Checks do PR.
