# Fase 19 - Picking operacional com conferencia fisica

## Objetivo

Transformar a separacao do pedido em uma etapa operacional real, com
confirmacao fisica por linha antes de criar o Packing.

## Fluxo operacional

1. Cristiane cria um pedido no portal.
2. O sistema reserva o estoque e cria `pick_tasks` e `pick_lines`.
3. Rafael abre `WMS > Picking` e inicia a separacao.
4. Rafael confirma cada linha fisica como OK, falta ou avaria.
5. O sistema so permite concluir o Picking quando todas as linhas estiverem OK.
6. Ao concluir, a Cloud Function recebe `picking_lines` confirmadas, marca as
   linhas como separadas e cria a tarefa de Packing.

## Regras de controle

- Picking nao pode ser concluido sem conferencias fisicas enviadas.
- Cada `pick_line` precisa estar presente no payload `picking_lines`.
- A quantidade fisica confirmada deve bater com a quantidade esperada.
- Falta ou avaria deve virar excecao operacional antes do avanco.
- O Packing so nasce apos Picking confirmado.
- As reservas permanecem vinculadas ate a baixa final da entrega.

## Evidencias esperadas

- `pick_lines.qty_picked` preenchido.
- `pick_lines.physical_status = confirmed`.
- `pick_tasks.picking_confirmed_at` preenchido.
- `pack_tasks` criado com `source = picking_completed`.
- Evento operacional `packing.created`.

## Validacao

- Build das Functions.
- Typecheck do frontend.
- Testes unitarios das Functions.
- Build do frontend.
- Smoke em `https://app.dutelog.com.br/wms/picking`.

## Observacao de ambiente

O teste de integracao com Firestore Emulator depende de Java 21+. Se o ambiente
local estiver com Java antigo, o build compila, mas o emulador nao inicia.
