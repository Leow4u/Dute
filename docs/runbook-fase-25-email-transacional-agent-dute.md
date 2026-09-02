# Fase 25 - Email transacional controlado do Agent Dute

## Objetivo

Fechar o ciclo das notificacoes operacionais preparadas pelo Agent Dute com revisao humana antes de qualquer comunicacao ao cliente.

## Fluxo operacional

1. O Agent Dute sincroniza eventos reais do ledger e cria rascunhos em `operational_notifications`.
2. A Dutelog revisa o rascunho no painel interno do Agent Dute.
3. Um usuario interno aprova a comunicacao.
4. Antes de enviar, o sistema exige destinatarios, assunto e corpo final revisado.
5. A acao `Enviar / registrar` grava a trilha completa no documento e emite evento operacional.

## Modos de entrega

| Modo | Variavel | Comportamento |
| --- | --- | --- |
| Auditoria | `AGENT_DUTE_EMAIL_MODE=audit_only` | Nao envia e-mail externo. Registra destinatarios, assunto, corpo, usuario e timestamp. |
| Webhook | `AGENT_DUTE_EMAIL_MODE=webhook` | Envia POST JSON para `AGENT_DUTE_EMAIL_WEBHOOK_URL` com chave de idempotencia e metadados operacionais. |

## Variaveis

- `AGENT_DUTE_EMAIL_FROM`
- `AGENT_DUTE_EMAIL_REPLY_TO`
- `AGENT_DUTE_EMAIL_CLIENT_TO`
- `AGENT_DUTE_EMAIL_INTERNAL_TO`
- `AGENT_DUTE_EMAIL_WEBHOOK_URL`
- `AGENT_DUTE_EMAIL_WEBHOOK_TOKEN`

## Guardrails

- Rascunho so pode ser enviado depois de aprovado.
- Envio exige pelo menos um destinatario valido.
- Assunto e corpo final sao obrigatorios.
- O modo padrao e `audit_only`, para impedir disparo externo acidental.
- O documento recebe `recipients`, `subject_sent`, `body_sent`, `email_delivery`, `sent_by`, `sent_by_email` e `sent_at`.
- Um evento `agent.notification.sent`, `agent.notification.approved` ou `agent.notification.archived` e publicado para a memoria operacional.

## Proximo passo recomendado

Plugar o provedor real de e-mail transacional, preferencialmente por Cloud Run/Cloud Functions webhook com segredo em Secret Manager, mantendo `audit_only` em homologacao.
