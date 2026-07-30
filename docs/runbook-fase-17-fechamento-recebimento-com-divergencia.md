# Fase 17 - Fechamento de recebimento com divergencia

## Objetivo

Impedir que um recebimento com falta, sobra ou linha nao conferida seja concluido sem decisao operacional rastreavel.

## O que mudou

- A transacao `advanceWarehouseTaskTransaction` agora bloqueia o fechamento de recebimento quando:
  - existe linha sem conferencia fisica salva;
  - existe divergencia e a conclusao nao possui justificativa operacional.
- A leitura WMS passa a expor mais campos das linhas de recebimento:
  - `client_item_code`
  - `received_qty`
  - `difference_qty`
  - `conference_status`
  - `unit_cost`
- A checklist fisica do WMS passa a considerar `received_qty` e `difference_qty` em recebimentos.
- A tela de detalhe do recebimento mostra um campo obrigatorio de justificativa quando ha divergencia antes de permitir `Concluir recebimento`.
- A justificativa enviada no fechamento fica registrada como `operation_note` da tarefa avancada.

## Fluxo operacional

1. Rafael salva a conferencia fisica.
2. Se tudo estiver OK, ele conclui a entrada normalmente.
3. Se houver falta ou sobra, a tela exige uma justificativa de fechamento.
4. A Function valida a mesma regra no backend.
5. O estoque e atualizado apenas com a quantidade fisica conferida.

## Seguranca

- A regra critica nao depende do navegador.
- Recebimento sem conferencia nao avanca para estoque.
- Recebimento divergente nao fecha sem nota operacional.
- A trilha de auditoria guarda a nota em `operation_note`, evento e operacao idempotente.

## Validacao

Executado em 2026-07-11:

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

Observacao: o build frontend manteve avisos antigos de sourcemap e chunk grande, sem falha.
