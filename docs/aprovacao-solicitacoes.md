# Aprovar solicitacao - triagem interna

Use este guia para transformar uma demanda do portal em operacao WMS.

## Acesso

- Rota: `/solicitacoes`.
- Perfil esperado: `interno`.
- A tela atualiza a fila periodicamente, mas o botao `Atualizar` pode ser usado
  antes de uma decisao critica.

## Rotina de triagem

1. Abra a fila e use a busca quando houver muitas solicitacoes.
2. Confira cliente, tipo, prioridade, descricao, itens e quantidade total.
3. Veja se a solicitacao ja tem vinculo com pedido, recebimento ou picking.
4. Decida apenas solicitacoes com status aberto: `open`, `submitted` ou
   `pending`.

## Antes de aprovar

- Confirme se o `customer_code` e o cliente esperado.
- Para retirada/ajuste, confira SKU, endereco/localizacao e saldo disponivel.
- Para recebimento, confira itens esperados, quantidade e informacao de NF ou
  chegada.
- Se faltar dado essencial, rejeite ou combine ajuste antes de aprovar.

## Acoes disponiveis

- `Aprovar`: muda status para `approved` e cria vinculos operacionais quando o
  tipo permite.
- `Rejeitar`: muda status para `rejected`; nao cria operacao WMS.
- `Encerrar`: fecha uma solicitacao aprovada quando o fluxo terminou para o
  cliente. A de saida so se encerra depois da entrega; para desistir do pedido
  antes dela, `Cancelar pedido` (solta a reserva, cancela as tarefas abertas e
  devolve o separado a posicao pela guarda).

## O que a aprovacao cria

Para `retirada` ou `ajuste`, o sistema valida saldo e materializa:

- `orders`
- `order_items`
- `stock_reservations`
- `pick_tasks`
- `pick_lines`

Eventos emitidos: `customer_request.approved`, `order.created`,
`stock.reserved` e `picking.created`.

Para `recebimento`, o sistema materializa:

- `inbound_receipts`
- `inbound_items`

Eventos emitidos: `customer_request.approved` e `inbound.created`.

Para `inventario`, `financeiro`, `suporte` ou outro tipo sem rotina WMS nativa,
a aprovacao registra a decisao e o evento `customer_request.approved`, mas pode
ficar sem vinculo operacional automatico.

## Quando der erro

- `Saldo nao encontrado`: confira SKU, codigo do item do cliente e localizacao.
- `Saldo insuficiente`: alinhe quantidade com cliente ou estoque fisico antes de
  aprovar.
- `Solicitacao ja foi decidida`: atualize a fila e nao duplique a decisao.
- `SKU e quantidade`: peca correcao no portal ou registre nova solicitacao com
  itens completos.
