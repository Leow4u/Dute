# Gate de reconciliacao BTG

Este registro foi gerado em modo somente leitura a partir da planilha real e
do snapshot local auditado. Nenhuma escrita foi feita no Firestore.

## Resultado

- Catalogo: `13.849` pecas.
- SKUs: `13.819` pecas.
- Movimentacoes: `13.900` pecas. Fonte canonica aprovada para a
  projecao operacional.
- Snapshot Firestore auditado: `13.818` pecas.
- Anomalias sem Firestore apos a politica canonica: `0` criticas e `11`
  avisos de cadastro.
- Anomalias com o snapshot Firestore antigo ainda devem ser reavaliadas antes
  do apply, porque o snapshot estava com saldo `13.818`.

## Decisoes operacionais

- `BTG-1043` aponta para os produtos `A.01.0533.004.G` e
  `A.01.0533.004.M`; o sistema deve manter os dois registros separados por
  `client_item_code`.
- Movimentacoes de `BTG-1043` sao alocadas pelo endereco/caixa de origem.
- Divergencias entre Catalogo, SKUs e Movimentacoes deixam de bloquear a
  reconciliacao quando a projecao usa `balance_source=movements`.
- Ajustes manuais devem ser feitos no sistema, gerando movimento, evento e
  recibo idempotente de operacao.

## Procedimento de liberacao

1. Congelar importacoes e movimentos com um `reconciliation_id` novo.
2. Rodar o reconciliador contra o Firestore de producao e confirmar zero
   anomalias criticas com `balance_source=movements`.
3. Aplicar somente com backup novo e confirmacao explicita.
4. Concluir o controle de reconcilacao com os quatro saldos registrados.

Enquanto o controle estiver em `running`, as Cloud Functions recusam novas
movimentacoes, aprovacoes WMS e alteracoes de catalogo/SKUs. O ledger
historico permanece somente leitura.
