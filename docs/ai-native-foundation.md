# AI-native foundation

O sistema deve tratar cada operação como um evento auditável antes de tratar IA
como uma tela ou chat isolado.

## Coleções

- `events`: ledger imutável de acontecimentos relevantes do sistema.
- `ai_agent_inbox`: alertas e acompanhamentos abertos pelo agente.
- `ai_agent_memory`: memória resumida por entidade, cliente ou contexto.

## Eventos iniciais

- `inventory.received`
- `inventory.shipped`
- `inventory.adjusted`
- `order.status_changed`
- `billing.manual_quantities_saved`
- `billing.invoice_emitted`
- `billing.invoice_paid`
- `access.invite_created`
- `access.invite_accepted`
- `data.imported`
- `operator.note`

## Estado atual

O frontend Firebase já emite eventos para ações feitas pela aplicação e expõe a
central interna `/agente`. A central mostra timeline, radar de atenção e memória
operacional calculada a partir dos dados reais de produtos, SKUs, movimentações,
pedidos, faturamento e eventos.

A malha de módulos está definida em `docs/ai-native-operational-blueprint.md` e
no catálogo tipado `artifacts/app/src/lib/operational-modules.ts`.
Essa malha conecta a planilha atual, os módulos já existentes e os benchmarks de
WMS/OMS para guiar portal do cliente, receiving, putaway, picking, packing,
expedição, devoluções, billing e documentos.

## Próximo passo cloud-native

Quando migrarmos a inteligência para backend gerenciado, o `emitEvent` deve virar
uma Cloud Function/Cloud Run Function. Firestore triggers/Eventarc podem alimentar
Gemini/Vertex AI para gerar resumos, detectar divergências e preparar ações com
aprovação humana.
