# Fase 18 - Putaway operacional

## Objetivo

Fechar o ciclo entre recebimento conferido e estoque enderecado no galpao.
Quando um recebimento e concluido em `RECEBIMENTO`, o sistema cria tarefas de
putaway. A conclusao da tarefa transfere o saldo da origem para o endereco final
com movimentos auditaveis.

## Fluxo operacional

1. Rafael conclui a conferencia do recebimento.
2. O sistema contabiliza o saldo em `RECEBIMENTO`.
3. Para cada linha recebida, uma tarefa de putaway e criada em `putaway_tasks`.
4. Rafael acessa `WMS > Putaway`, inicia a tarefa e informa:
   - origem;
   - endereco final;
   - quantidade guardada.
5. Ao concluir, a Cloud Function move o saldo:
   - saida da origem;
   - entrada no endereco final;
   - dois movimentos no ledger com o mesmo `operation_id`.

## Regras de controle

- A origem padrao e `RECEBIMENTO`.
- O destino e obrigatorio para concluir a guarda.
- Origem e destino nao podem ser iguais.
- A quantidade deve existir como saldo disponivel na origem.
- A tarefa nao altera o total do cliente; apenas move o endereco interno.
- Toda alteracao critica passa por `advanceWarehouseTask`.

## Evidencias esperadas

- `putaway_tasks` criado apos recebimento concluido.
- `stock_balances` reduzido na origem e aumentado no destino.
- `stock_movements` com `movement_kind`:
  - `putaway_transfer_out`;
  - `putaway_transfer_in`.
- Evento operacional `putaway.completed`.

## Validacao

- Build das Functions.
- Typecheck do frontend.
- Testes unitarios das Functions.
- Build do frontend.
- Smoke em `https://app.dutelog.com.br/wms/putaway`.
