# Blueprint operacional AI-native

Este documento define a primeira malha de módulos do sistema Dutelog/BTG.
A planilha atual é a fonte inicial real de produtos, SKUs, custos,
endereçamento e faturamento. Os benchmarks de WMS/OMS entram como referência de
fluxo, não como backend copiado.

## Princípio

Cada módulo operacional precisa gerar eventos. A IA não deve depender de
raspagem de tela ou interpretação solta; ela deve acompanhar a operação pelo
ledger `events`, pela caixa `ai_agent_inbox` e pela memória `ai_agent_memory`.

## Módulos

| Módulo | Estado atual | Fonte inicial | Coleções principais | Eventos principais | Flow Genkit previsto | MVP |
|---|---|---|---|---|---|---|
| Fundação AI-native | Infra | Novo | `events`, `ai_agent_inbox`, `ai_agent_memory` | `operator.note`, `data.imported`, `event.analyzed` | `analyzeEventFlow`, `dailyBriefingFlow` | Ledger, radar, timeline e memória |
| Portal do cliente | Planejado | Benchmark | `customers`, `customer_accounts`, `customer_requests`, `documents`, `billing_periods` | `portal.request_created`, `document.uploaded`, `customer.message_sent` | `customerPortalAssistantFlow` | Cliente vê estoque, solicitações, docs e faturas |
| Catálogo e SKUs | Operando | Planilha | `products`, `skus` | `produto.updated`, `sku.updated` | `inventoryQuestionFlow` | Base BTG real importada |
| Kardex e movimentações | Parcial | Existente | `movements`, `stock_balances`, `events` | `inventory.received`, `inventory.shipped`, `inventory.adjusted` | `inventoryAnomalyFlow` | Movimento com saldo e evento |
| Receiving / entrada | Planejado | Benchmark | `inbound_receipts`, `inbound_items`, `quality_exceptions` | `inbound.created`, `inbound.checked`, `inbound.exception_found` | `receivingCheckFlow` | Conferência por NF/SKU/quantidade |
| Putaway / endereçamento | Planejado | Benchmark | `locations`, `putaway_tasks`, `stock_balances` | `putaway.created`, `putaway.completed`, `warehouse.location_updated` | `putawaySuggestionFlow` | Sugestão e confirmação de endereço |
| Mapa do armazém | Parcial | Existente | `skus`, `locations`, `stock_balances` | `warehouse.location_updated` | `warehouseSummaryFlow` | Rua, prateleira, caixa e concentração |
| Pedidos / solicitações | Parcial | Benchmark | `orders`, `order_items` | `order.created`, `order.status_changed`, `order.cancelled` | `orderRiskFlow` | Status operacional do pedido |
| Picking | Planejado | Benchmark | `pick_tasks`, `pick_lines`, `orders`, `stock_reservations` | `picking.created`, `picking.completed`, `picking.shortage_found` | `pickPathSuggestionFlow` | Fila de separação com divergência |
| Packing | Planejado | Benchmark | `pack_tasks`, `packages`, `package_items` | `packing.started`, `packing.completed`, `packing.exception_found` | `packingValidationFlow` | Conferência final e volumes |
| Expedição | Planejado | Benchmark | `shipments`, `shipment_items`, `delivery_proofs` | `shipment.created`, `shipment.dispatched`, `shipment.delivered` | `dispatchAdvisorFlow` | Romaneio, destino e comprovante |
| Devoluções | Planejado | Benchmark | `returns`, `return_items`, `quality_exceptions` | `return.created`, `return.received`, `return.disposition_set` | `returnTriageFlow` | Retorno com estado e decisão |
| Billing / faturamento | Operando | Existente | `billing_price_list`, `billing_periods`, `billing_manual`, `billing_config` | `billing.invoice_emitted`, `billing.invoice_paid` | `billingReviewFlow` | Competência, ad valorem e serviços |
| Documentos | Planejado | Benchmark | `documents`, `document_links` | `document.uploaded`, `document.linked`, `document.reviewed` | `documentSummaryFlow` | NF, fotos, comprovantes e anexos |
| Usuários e convites | Operando | Existente | `users`, `invites` | `access.invite_created`, `access.invite_accepted` | `accessAuditFlow` | Acesso fechado por convite |
| Relatórios e briefing | Parcial | Existente | `products`, `skus`, `movements`, `orders`, `billing_periods`, `events` | `report.exported`, `briefing.generated` | `dailyBriefingFlow` | Painel e resumo executivo |
| Reposição inteligente | Planejado | Novo | `store_inventory`, `store_sales`, `replenishment_suggestions` | `store.stock_low`, `store.sales_imported`, `replenishment.suggested` | `replenishmentSuggestionFlow` | Futuro: iniciar por CSV/Excel do PDV |

## Ordem de construção recomendada

1. Consolidar fundação AI-native e módulo de eventos.
2. Criar modelo de cliente/conta e portal do cliente.
3. Separar estoque físico em saldo, localização e movimentos.
4. Criar receiving e putaway.
5. Criar pedidos com reserva de estoque.
6. Criar picking, packing e expedição.
7. Amarrar billing a eventos operacionais e documentos.
8. Evoluir para reposição inteligente via integração ou importação de PDV.

## Roadmap de producao

O detalhamento dos passos imediatos esta em `docs/roadmap-producao.md`.
Resumo executivo:

1. Passo 1 - Blindagem de Producao: separar ambientes, fechar papeis e rules,
   validar App Check, backups, observabilidade, feature flags e checklist de
   release/rollback.
2. Passo 2 - Cloud Functions, Genkit e WMS fisico completo: mover transicoes
   criticas para backend transacional, ativar flows Genkit com aprovacao humana,
   completar receiving, putaway, picking, packing, expedicao, devolucao e
   inventario ciclico, e conduzir rollout por piloto controlado.

## Fundação Firestore

A fundação operacional já tem duas rotas internas:

- `GET /api/operational/foundation`: lê as coleções operacionais, calcula o que
  ainda pode ser derivado da base atual e devolve métricas para a tela do
  Agente IA.
- `POST /api/operational/sync-real-foundation`: cria/atualiza, em lotes, os documentos
  iniciais de `customers`, `customer_accounts`, `locations`, `stock_balances`,
  `inbound_receipts`, `order_items`, `pick_tasks` e `pack_tasks`.

O primeiro cliente real está normalizado como `BTG Pactual`. O campo antigo
`cod_cliente` da planilha permanece como código de item/produto do cliente; ele
não deve ser usado como isolamento de acesso. O isolamento multi-cliente deve
usar `customer_code`.

## Fatia construída: portal, solicitações e WMS

A primeira fatia operacional saiu do modo "planilha em tela" e passou a ter
fluxos de produto:

- `/portal`: visão do cliente com estoque, valor, pedidos recentes, faturas,
  alertas do agente e criação de solicitações.
- `/solicitacoes`: triagem interna das solicitações do cliente. A aprovação de
  uma retirada/ajuste cria pedido, linhas de pedido, reservas de estoque,
  tarefa de picking e linhas de picking; a aprovação de um recebimento cria
  entrada operacional e itens esperados para conferência.
- `/wms`: bancada interna com filas de receiving, putaway, picking, packing e
  expedição. As filas exibem itens, localização, bloqueios, exceções e timeline
  quando os dados nativos existem; enquanto alguma coleção ainda não tiver dados
  próprios, a fila deriva tarefas da base BTG atual.

Rotas de API desta fatia:

- `GET /api/client/overview`
- `POST /api/client/requests`
- `GET /api/customer-requests`
- `POST /api/customer-requests/:id/approve`
- `POST /api/customer-requests/:id/reject`
- `POST /api/customer-requests/:id/close`
- `GET /api/warehouse/ops`
- `POST /api/warehouse/tasks/:taskUid/advance`

Toda solicitação e transição operacional emite eventos para `events` e alimenta
a caixa `ai_agent_inbox`/memória operacional quando aplicável. Isso mantém a
arquitetura AI-native: a IA observa a operação por eventos estruturados, não por
texto solto na interface.

## Contrato operacional da solicitação

`POST /api/client/requests` aceita solicitações itemizadas:

```json
{
  "type": "retirada",
  "priority": "normal",
  "description": "Separar para retirada amanhã cedo.",
  "items": [
    {
      "sku_code": "SKU_REAL_DA_PLANILHA",
      "product_name": "Produto conforme Inventário_BTG_Consolidado.xlsx",
      "quantity": 12,
      "location_id": "ENDERECO_REAL_DA_PLANILHA"
    }
  ]
}
```

Na aprovação interna, o sistema valida saldo disponível e materializa:

- `orders`
- `order_items`
- `stock_reservations`
- `pick_tasks`
- `pick_lines`

Para recebimento, materializa:

- `inbound_receipts`
- `inbound_items`

Eventos emitidos na retirada: `customer_request.approved`, `order.created`,
`stock.reserved` e `picking.created`.

## Regra de ouro

Nenhum módulo novo deve nascer sem:

- Coleção Firestore definida.
- Eventos emitidos.
- Permissão por papel/cliente.
- Tela mínima de operação.
- Flow de IA previsto, mesmo que só entre na fase seguinte.
