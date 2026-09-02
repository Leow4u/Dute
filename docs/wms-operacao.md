# Bancada WMS - operacao rapida

Use este guia para operar as filas de armazem depois que a solicitacao virou
tarefa.

## Acesso

- Rota: `/wms`.
- Perfil esperado: `interno`.
- Filas exibidas: Receiving, Putaway, Picking, Packing e Expedicao.

## Leitura inicial

1. Confira os indicadores: pendencias totais, prazo proximo, criticos,
   avancadas hoje e alertas IA.
2. Priorize tarefas bloqueadas, criticas ou com SLA proximo.
3. Use os cards de Receiving, Picking e Packing como foco diario.
4. Abra a tarefa ativa para ver itens, timeline, bloqueios e proxima acao.

## Avancar etapa

Clique em `Avancar etapa` somente quando a etapa fisica foi executada ou
conferida.

Fluxos atuais:

- Receiving: `created` -> `checking` -> `received`.
- Putaway: `planned` -> `in_progress` -> `completed`.
- Picking: `planned` -> `in_progress` -> `completed`.
- Packing: `ready` -> `in_progress` -> `completed`.
- Expedicao: `ready_to_dispatch` -> `dispatched` -> `delivered`.

Efeitos importantes:

- Receiving concluido marca itens recebidos.
- Picking concluido atualiza linhas, reservas e pedido, e cria tarefa de
  packing.
- Packing concluido cria pacote e remessa.
- Expedicao entregue consome reserva, baixa saldo e marca pedido entregue.

## Registrar excecao

Use `Registrar excecao` quando houver falta, avaria, divergencia, documento
pendente, bloqueio fisico ou qualquer impedimento de execucao.

Informe uma nota curta com o motivo e a acao esperada. O sistema registra um
evento em `/api/ai/events` com a fila, tarefa, status, cliente, vinculo de
solicitacao e contadores de excecao.

Eventos de excecao por fila:

- Receiving: `inbound.exception_found`
- Putaway: `putaway.exception_found`
- Picking: `picking.shortage_found`
- Packing: `packing.exception_found`
- Expedicao: `shipment.exception_found`

## Boas praticas

- Nao avance uma tarefa bloqueada sem resolver a causa.
- Use a timeline para confirmar se alguem ja atuou na mesma tarefa.
- Sempre prefira registrar excecao a resolver divergencia fora do sistema.
- Depois de avancar ou registrar excecao, confira se alertas e fila foram
  atualizados.
