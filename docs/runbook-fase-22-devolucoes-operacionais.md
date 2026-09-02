# Fase 22 - Devolucoes operacionais

## Objetivo

Transformar devolucoes em um fluxo operacional auditavel: a entrada da devolucao nao altera estoque, e o saldo so volta para disponivel quando a operacao define a disposicao fisica do item.

## Fluxo

1. Rafael registra a devolucao em WMS > Devolucoes.
2. O sistema exige produto ja cadastrado por Cod. cliente/SKU para evitar duplicidade.
3. Cada linha entra como `return_items.status = pending_disposition`.
4. A bancada de disposicao lista pendencias persistidas, mesmo apos atualizar a pagina.
5. Ao definir a disposicao:
   - `available`: exige endereco e gera entrada auditada em `stock_balances`, `movements` e `client_inventory`.
   - `damaged`, `quarantine` ou `discard`: exige nota de triagem e nao altera saldo disponivel.
6. Quando todas as unidades da devolucao recebem disposicao, o cabecalho em `returns` vira `completed`.

## Controles

- Mutacoes criticas continuam em Cloud Functions.
- A tela local apenas consulta `returns` e `return_items` e aciona as funcoes.
- Avaria, quarentena e descarte exigem justificativa operacional.
- Eventos `return.received` e `return.disposition_set` alimentam a memoria operacional do Agent Dute.

## Validacao

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

## Observacao

O teste de integracao com emulador segue dependente de Java 21 ou superior no ambiente local.
