# Fase 23 - Excecoes operacionais

## Objetivo

Transformar falta, avaria, divergencia e bloqueio WMS em uma fila de tratativa real, com status, severidade, responsavel, resolucao e memoria operacional para o Agent Dute.

## Fluxo

1. A operacao identifica uma divergencia em Recebimento, Putaway, Picking, Packing ou Expedicao.
2. Rafael registra a excecao pela tarefa WMS.
3. O sistema cria `quality_exceptions.status = open` e bloqueia a tarefa com `blocked_reason`.
4. A tela WMS > Excecoes mostra a fila persistida de excecoes abertas.
5. O coordenador ou operador registra a tratativa:
   - `resolve`: excecao resolvida e tarefa liberada.
   - `cancel`: excecao cancelada quando foi aberta indevidamente.
6. A resolucao decrementa o contador da tarefa e emite evento operacional para o Agent Dute.

## Controles

- Criacao e resolucao de excecoes passam por Cloud Functions.
- O navegador apenas consulta a fila e dispara a funcao autorizada.
- Toda resolucao exige texto minimo explicando a decisao.
- Eventos gerados:
  - `*.exception_found`
  - `warehouse.exception_resolved`

## Telas

- `https://app.dutelog.com.br/wms/excecoes`
- Lista de excecoes abertas.
- Painel de tratativa com resolver/cancelar.
- Historico recente de excecoes tratadas.

## Validacao

- `pnpm --filter @workspace/functions run build`
- `pnpm --filter @workspace/btg-inventory run typecheck`
- `pnpm --filter @workspace/functions run test:unit`
- `pnpm --filter @workspace/btg-inventory run build`

## Observacao

O teste de integracao com emulador segue dependente de Java 21 ou superior no ambiente local.
