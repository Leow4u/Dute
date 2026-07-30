# Fase 15 - Documentos viram acoes operacionais

## Objetivo

Conectar documentos aprovados a acoes reais da operacao, sem permitir que OCR, anexo ou texto extraido alterem o WMS automaticamente sem validacao humana.

## O que mudou

- Nova Function `applyDocumentOperationalAction`.
- A tela de Documentos ganhou:
  - badge de acao operacional pendente/aplicada;
  - botao `Gerar acao`;
  - botao `Criar recebimento` para NF de entrada.
- Documentos passam a gravar vinculos operacionais:
  - `operational_action_status`
  - `operational_action_type`
  - `operational_action_id`
  - `operational_target_type`
  - `operational_target_id`
  - `operational_target_number`

## Fluxos

### Gerar acao

Cria uma pendencia em `ai_agent_inbox`, um evento operacional e marca o documento como `pending`.

Uso esperado:

- documento sem linhas estruturadas;
- comprovante que precisa ser vinculado a pedido;
- fatura que precisa ser conferida;
- anexo que precisa de decisao humana.

### Criar recebimento

Para `document_type = nf_entrada`, tenta criar um recebimento real usando `createInboundReceiptTransaction`.

Regras:

- exige permissao operacional/WMS;
- bloqueia se a knowledge estiver `pending_approval`;
- exige linhas estruturadas com codigo/produto e quantidade positiva;
- usa a transacao real de recebimento, com validacao contra SKU duplicado e produto existente;
- vincula o documento ao recebimento criado.

## Seguranca

- Nao existe execucao automatica por OCR.
- Se nao houver itens confiaveis, a Function recusa criar recebimento e orienta gerar acao operacional.
- A criacao real continua passando pela transacao do WMS.
- Eventos e operacoes idempotentes sao registrados para auditoria.

## Validacao

Executado em 2026-07-11:

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

Observacao: o build frontend manteve avisos antigos de sourcemap e chunk grande, sem falha.
