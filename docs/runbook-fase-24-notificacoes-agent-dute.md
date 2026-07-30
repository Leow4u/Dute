# Fase 24 - Notificacoes operacionais do Agent Dute

## Objetivo

Conectar o Agent Dute ao ledger operacional para preparar notificacoes rastreaveis a partir de eventos reais do WMS, sem envio automatico sem aprovacao humana.

## O que foi implementado

- Colecao `operational_notifications` para rascunhos, aprovacoes, envio marcado e arquivamento.
- Cloud Function `syncOperationalNotifications` para varrer eventos recentes e criar rascunhos idempotentes.
- Cloud Function `decideOperationalNotification` para aprovar, arquivar ou marcar uma notificacao como enviada.
- API `/api/agent-dute/notifications` para consulta e rotas de acao via Functions.
- Regras Firestore para leitura interna e leitura do cliente apenas quando a notificacao estiver `approved` ou `sent`.
- Painel interno em Agent Dute com sincronizacao, revisao da mensagem e botoes de decisao.

## Regras operacionais

- O Agent Dute prepara mensagens, mas nao envia e-mail automaticamente.
- A Dutelog precisa aprovar antes de qualquer comunicacao ao cliente.
- A origem da mensagem sempre fica vinculada ao `trigger_event_id` e ao `trigger_event_type`.
- Eventos de excecao ou severidade critica viram notificacoes internas por padrao.
- Eventos de recebimento, estoque, pedido, expedicao e faturamento viram rascunhos voltados ao cliente.

## Validacao executada

- `pnpm --filter @workspace/functions run typecheck`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/btg-inventory run build`
- `pnpm --filter @workspace/functions run test:unit`

## Proximo passo recomendado

Integrar provedor de e-mail transacional com aprovacao humana explicita, registrando `sent_at`, destinatarios e corpo final enviado.
