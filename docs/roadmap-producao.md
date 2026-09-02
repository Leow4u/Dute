# Roadmap de producao - passos 1 e 2

Este roadmap transforma a base AI-native atual em operacao pronta para
producao. O foco dos passos 1 e 2 e proteger a operacao real antes de ampliar
automacoes: primeiro blindar producao, depois mover regras criticas para Cloud
Functions/Genkit e completar o WMS fisico.

## Principios de producao

- Nenhuma escrita critica deve depender apenas do frontend.
- Toda transicao operacional deve gerar evento auditavel em `events`.
- Toda automacao de IA deve produzir recomendacao rastreavel, com aprovacao
  humana quando houver impacto em estoque, faturamento, acesso ou cliente.
- O isolamento multi-cliente deve usar `customer_code`; codigos herdados da
  planilha continuam como referencia de item/produto.
- A matriz modular de papeis, permissoes, WMS e visibilidade do Agente IA fica
  centralizada em `docs/modulos-e-permissoes.md`.
- Rollout deve ser reversivel por fase, com dados exportados antes de cada
  corte.

## Passo 1 - Blindagem de Producao

Objetivo: deixar a operacao real segura, observavel e recuperavel antes de
ativar automacoes backend.

### Entregaveis

| Frente | Entrega | Criterio de pronto |
|---|---|---|
| Ambientes | Separar `dev`, `staging` e `prod` em projetos/variaveis distintos | Build de producao aponta somente para recursos de producao |
| Acesso | Papeis fechados por claims/perfis: `admin`, `interno`, `wms`, `financeiro`, `cliente`, `suporte` | Usuario sem papel nao acessa tela nem API restrita |
| Firestore Rules | Regras por papel e por `customer_code` | Cliente so le seus documentos, interno ve operacao autorizada |
| App Check | Habilitar protecao para frontend e APIs expostas | Chamadas sem app valido sao bloqueadas em producao |
| Auditoria | Eventos obrigatorios para login operacional, convite, solicitacao, WMS, billing e alteracao manual | Timeline permite reconstruir decisao e ator |
| Backups | Export diario do Firestore e ensaio de restore | Restore validado em ambiente nao produtivo |
| Observabilidade | Logs estruturados, alertas de erro e metricas de fila/SLA | Incidente gera alerta com entidade afetada |
| Release gate | Checklist antes de deploy e smoke test depois de deploy | Deploy sem checklist nao entra em producao |
| Feature flags | Chaves para pausar aprovacao, WMS, billing ou IA | Operacao pode voltar a modo manual sem rollback de codigo |

### Checklist de saida

- `events`, `ai_agent_inbox` e `ai_agent_memory` existem e recebem eventos
  minimos.
- Acesso de cliente esta isolado por `customer_code`.
- Fluxos de solicitacao, aprovacao, WMS e faturamento possuem caminho manual
  documentado.
- Backup, restore e rollback foram testados com dados anonimizados ou base de
  staging.
- Manual de producao foi revisado com operacao, financeiro e suporte.

## Passo 2 - Cloud Functions, Genkit e WMS fisico completo

Objetivo: mover invariantes operacionais para backend gerenciado, ativar flows
Genkit com seguranca e completar a execucao fisica do armazem.

### Cloud Functions obrigatorias

| Function | Gatilho | Responsabilidade |
|---|---|---|
| `recordEventFunction` | HTTP/API interna | Validar, normalizar e gravar eventos no ledger |
| `onCustomerRequestCreated` | Firestore `customer_requests` | Classificar prioridade, criar alerta e preparar triagem |
| `approveCustomerRequestFunction` | HTTP callable/API interna | Aprovar com transacao: pedido/recebimento, reservas e eventos |
| `rejectCustomerRequestFunction` | HTTP callable/API interna | Registrar decisao, motivo e evento de rejeicao |
| `advanceWarehouseTaskFunction` | HTTP callable/API interna | Avancar WMS com validacao de status, saldo e idempotencia |
| `registerWarehouseExceptionFunction` | HTTP callable/API interna | Criar excecao, bloquear tarefa quando necessario e alertar IA |
| `dailyOperationalBriefingFunction` | Scheduler | Gerar briefing diario por cliente e operacao |
| `billingEventSyncFunction` | Firestore/evento | Amarrar eventos operacionais a competencia/fatura |

Todas as functions devem:

- Usar transacoes ou batch writes quando alterarem mais de uma colecao.
- Aceitar chave de idempotencia para evitar duplicidade em retry.
- Registrar `actor`, `source`, `entity_type`, `entity_id` e `customer_code`.
- Falhar fechado quando faltar permissao, saldo, status esperado ou payload
  minimo.
- Escrever logs estruturados com `request_id` e IDs de entidade.

### Genkit flows previstos

| Flow | Entrada | Saida esperada | Regra de seguranca |
|---|---|---|---|
| `analyzeEventFlow` | Evento novo | Severidade, tags e proxima acao sugerida | Nao altera entidade operacional |
| `dailyBriefingFlow` | Eventos e filas do dia | Resumo executivo e riscos | Publica em inbox/memoria, nao executa acao |
| `inventoryAnomalyFlow` | Saldos, movimentos e excecoes | Divergencias provaveis | Exige aprovacao para ajuste |
| `receivingCheckFlow` | Entrada, NF, itens esperados | Alertas de quantidade/documento | Nao marca recebimento sozinho |
| `putawaySuggestionFlow` | Estoque, enderecos e regras fisicas | Endereco recomendado | Operador confirma por leitura/conferencia |
| `orderRiskFlow` | Pedido, reserva e SLA | Risco de atraso/falta | Sugere prioridade, nao muda SLA sozinho |
| `pickPathSuggestionFlow` | Pick lines e localizacoes | Sequencia de separacao | Operador pode ignorar com justificativa |
| `packingValidationFlow` | Itens separados e volumes | Inconsistencias de embalagem | Bloqueio exige acao humana |
| `dispatchAdvisorFlow` | Remessa, destino e comprovantes | Pendencias antes da saida | Nao despacha sem confirmacao |
| `billingReviewFlow` | Eventos, servicos e competencia | Itens para revisar | Financeiro aprova emissao |
| `accessAuditFlow` | Usuarios, convites e papeis | Riscos de acesso | Admin decide remediacao |

### WMS fisico completo

O WMS precisa cobrir a operacao fisica de ponta a ponta:

1. Receiving: agenda, doca, NF/documento, descarga, conferencia cega quando
   aplicavel, qualidade, divergencia e aceite.
2. Putaway: area de staging, sugestao de endereco, leitura/conferencia do
   endereco, conclusao e saldo disponivel.
3. Picking: reserva, onda/fila, leitura de endereco, separacao, falta, troca de
   endereco e conclusao.
4. Packing: conferencia final, volume, etiqueta, lacre, fotos/documentos e
   pacote pronto.
5. Expedicao: romaneio, transportadora/coleta, comprovante, baixa de reserva e
   entrega.
6. Devolucao: recebimento de retorno, triagem, disposicao, reincorporacao,
   avaria ou descarte.
7. Inventario ciclico: contagem por endereco/SKU, divergencia, aprovacao e
   ajuste auditado.

### Papeis e responsabilidades

| Papel | Responsabilidade principal |
|---|---|
| Produto/operacao | Priorizar fases, aceitar criterios e decidir excecoes de processo |
| Admin | Gerir usuarios, claims, parametros e feature flags |
| Interno | Aprovar solicitacoes e acompanhar fila operacional |
| WMS supervisor | Priorizar filas, resolver bloqueios e liberar excecoes |
| WMS operador | Executar receiving, putaway, picking, packing e expedicao |
| Financeiro | Revisar billing, competencias, servicos e faturas |
| Cliente | Criar solicitacoes, acompanhar estoque/documentos/faturas |
| Suporte/Cloud | Monitorar functions, incidentes, backups e deploys |
| IA operacional | Sugerir prioridade, riscos, briefing e analises sem decisao autonoma |

## Rollout recomendado

| Fase | Escopo | Criterio de avanco |
|---|---|---|
| 0. Preparacao | Ambientes, backup, papeis, checklist e treinamento | Smoke test completo em staging |
| 1. Shadow mode | Producao observa eventos e IA recomenda sem acionar automacoes | Eventos batem com operacao manual por 5 dias uteis |
| 2. Piloto BTG | Portal, solicitacoes e WMS em um cliente/operacao controlada | Sem divergencia critica aberta ao fim do ciclo |
| 3. Functions criticas | Aprovar solicitacao e avancar WMS via backend transacional | Retry/idempotencia validados em incidentes simulados |
| 4. WMS fisico completo | Receiving -> expedicao com leitura/conferencia fisica | Operacao conclui ciclo sem planilha paralela |
| 5. Expansao | Novos clientes, billing ampliado e devolucao/inventario ciclico | Suporte consegue operar por runbook |

## Riscos que bloqueiam producao

- Cliente conseguir acessar documento de outro `customer_code`.
- Avanco de WMS baixar saldo sem reserva ou sem evento.
- Aprovacao duplicada criar pedido/reserva duplicados.
- IA alterar estoque, faturamento ou acesso sem aprovacao humana.
- Backup sem restore testado.
- Operacao fisica depender de dado que existe apenas em planilha local.
