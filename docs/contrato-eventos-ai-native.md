# Contrato de eventos AI-native

O ledger `events` e a fonte operacional da IA. Cada acao relevante deve gerar um
evento estruturado, com entidade, cliente e payload minimo para auditoria.

## Onde nasce

- Automatico: rotinas do portal, aprovacao de solicitacao, WMS, faturamento,
  acesso e importacao.
- Manual: `POST /api/ai/events`.
- Colecoes alimentadas: `events`, `ai_agent_inbox` e `ai_agent_memory`.

## Campos do evento

| Campo | Obrigatorio | Regra pratica |
|---|---:|---|
| `id` | sistema | `evt_*` ou chave deduplicada quando informada. |
| `type` | sim | Nome estavel em minusculo, formato `dominio.acao`. |
| `title` | sim | Titulo curto para timeline e caixa da IA. |
| `description` | nao | Contexto operacional em uma frase. |
| `severity` | nao | `info`, `attention` ou `critical`; padrao `info`. |
| `entity_type` | nao | Tipo de entidade: `pedido`, `tarefa_picking`, etc. |
| `entity_id` | nao | ID da entidade operacional. |
| `customer_code` | recomendado | Obrigatorio quando o evento pertence a um cliente. |
| `customer_name` | nao | Nome exibivel quando conhecido. |
| `payload` | recomendado | IDs, quantidades, status e links; sem arquivo bruto. |
| `source` | nao | Origem: `app`, `manual`, `warehouse_ops`, etc. |
| `actor` | sistema | Usuario/ator calculado pela aplicacao. |
| `occurred_at` | sistema | Data ISO do acontecimento. |
| `created_at` | sistema | Timestamp Firestore de gravacao. |

## Tipos principais

Portal e solicitacoes:

- `portal.request_created`
- `customer_request.approved`
- `customer_request.rejected`
- `customer_request.closed`
- `client_event_template.created`
- `client_event_template.updated`
- `client_event_template.archived`

Pedido e estoque:

- `order.created`
- `order.status_changed`
- `order.cancelled`
- `stock.reserved`
- `inventory.received`
- `inventory.shipped`
- `inventory.adjusted`

WMS:

- `inbound.created`
- `inbound.checked`
- `inbound.exception_found`
- `putaway.created`
- `putaway.completed`
- `putaway.exception_found`
- `picking.created`
- `picking.started`
- `picking.completed`
- `picking.shortage_found`
- `packing.created`
- `packing.started`
- `packing.completed`
- `packing.exception_found`
- `shipment.created`
- `shipment.dispatched`
- `shipment.delivered`
- `shipment.exception_found`

Outros dominios:

- `billing.manual_quantities_saved`
- `billing.invoice_emitted`
- `billing.invoice_paid`
- `document.uploaded`
- `document.linked`
- `document.reviewed`
- `access.invite_created`
- `access.invite_accepted`
- `data.imported`
- `report.exported`
- `briefing.generated`
- `operator.note`

## Exemplo manual

```json
{
  "type": "picking.shortage_found",
  "title": "Falta encontrada no picking",
  "description": "SKU BTG-001 com 2 unidades faltantes no endereco A-01-C01.",
  "severity": "critical",
  "entity_type": "warehouse_task",
  "entity_id": "pick_ord_creq_123",
  "customer_code": "BTG Pactual",
  "source": "warehouse_ops",
  "payload": {
    "queue": "picking",
    "task_id": "pick_ord_creq_123",
    "sku_code": "BTG-001",
    "expected_qty": 10,
    "available_qty": 8,
    "customer_request_id": "creq_123"
  }
}
```

## Checklist para novo modulo

- Definir o `type` antes de construir a tela.
- Emitir evento junto da transicao operacional.
- Informar `entity_type`, `entity_id` e `customer_code` sempre que existirem.
- Colocar no `payload` apenas dados pequenos e rastreaveis: IDs, status,
  quantidades e referencias.
- Usar `attention` para pendencia operacional e `critical` para bloqueio,
  divergencia grave ou risco de SLA.
- Atualizar este contrato quando surgir novo tipo de evento.
