# Modulos e permissoes

Este documento consolida a arquitetura modular Dutelog/Cliente, a matriz de
permissoes alvo e a forma como o Agente IA/Genkit fica por tras de cada modulo.
Ele complementa `docs/ai-native-operational-blueprint.md`,
`docs/manual-producao.md`, `docs/wms-operacao.md` e
`docs/contrato-eventos-ai-native.md`.

## Objetivo

- Separar claramente o que e espaco interno Dutelog e o que e espaco do
  cliente.
- Definir os papeis `owner`, `admin`, `interno`, `wms`, `financeiro`,
  `cliente` e `suporte`.
- Documentar os submodulos WMS e o que o cliente pode enxergar de cada etapa.
- Mostrar que Genkit atua como camada de analise/recomendacao por modulo, sem
  substituir validacao de permissao, evento auditavel ou aprovacao humana.

## Estado atual e alvo

O app atual ainda agrega a maior parte das telas internas no papel operacional
`interno` e separa o portal por `cliente`. A documentacao abaixo descreve o
modelo alvo de permissao granular. Enquanto a UI nao estiver totalmente
granular, `owner`, `admin`, `wms`, `financeiro` e `suporte` podem passar por uma
experiencia interna comum, mas Cloud Functions, Firestore Rules e claims devem
ser a fonte de verdade antes de liberar producao.

`customer_code` e o limite de isolamento multi-cliente. O campo historico
`cod_cliente` continua sendo codigo de item/produto do cliente e nao deve ser
usado como fronteira de acesso.

Desde 19/10/2026 cada cliente tem um modelo de operacao (codigo, em
`src/lib/operations`) apontado pelo cadastro em `customers`; o portal le a
projecao `client_profiles` e mostra so os modulos do modelo. Ver
`docs/multicliente-modelos-de-operacao.md`.

Desde 20/10/2026 (Fase 2 da plataforma) existem 11 papéis: os 7 acima mais
`campo`, `comercial`, `rh` e `painel`, numa lista única em `lib/dominio`. Os
papéis novos são aceitos no convite e nas regras, mas o WMS ainda não os
atende: as callables os recusam (`domain/platform-roles.ts`) e as regras não
os listam em nenhuma coleção. O cliente também tem módulos contratados
(`wms`, `operacao`, `financeiro`); sem armazenagem no contrato ele não lê o
portal do WMS nem chama as callables dele. Ver `docs/plataforma/fase-2-nucleo.md`.

## Mapa Dutelog/Cliente

### Dutelog interno

O espaco Dutelog concentra governanca, operacao fisica, faturamento, suporte e
IA operacional:

| Area | Modulos | Rotas principais | Dono operacional |
|---|---|---|---|
| Governanca | Usuarios, convites, parametros, feature flags, documentos, eventos | `/configuracoes/pessoas`, `/agente` | `owner` / `admin` |
| Operacao | Solicitacoes, pedidos, reservas, kardex, relatorios | `/solicitacoes`, `/orders`, `/movements`, `/reports` | `interno` |
| WMS fisico | Receiving, putaway, picking, packing, expedicao, devolucao, inventario | `/wms`, `/warehouse` | `wms` com supervisao `interno` |
| Financeiro | Tabela de precos, competencias, billing, faturas | `/faturamento`, `/tabela-precos` | `financeiro` |
| Agente IA | Radar, inbox, memoria, briefing, controle de flows | `/agente` | `owner` / `interno` / `suporte` |
| Suporte | Incidentes, logs, backups, smoke tests e monitoramento | Ferramentas cloud e `/agente` | `suporte` |

### Cliente

O espaco do cliente e uma visao filtrada por `customer_code`:

| Area | O cliente pode fazer | O cliente nao pode fazer |
|---|---|---|
| Portal | Ver estoque, pedidos, solicitacoes, documentos, faturas e alertas publicados | Ver dados de outro cliente ou filas internas completas |
| Solicitacoes | Criar retirada, recebimento, inventario, ajuste, financeiro ou suporte | Aprovar a propria solicitacao ou criar reserva diretamente |
| WMS visivel | Acompanhar status, volumes, expedicao, comprovantes e pendencias publicadas | Avancar tarefa fisica, alterar saldo ou resolver excecao |
| Financeiro | Ver suas competencias, faturas e documentos | Alterar tabela de preco, emitir fatura ou fechar competencia |
| IA | Ler recomendacoes curadas para seu escopo | Ver prompts internos, memoria de outros clientes ou riscos operacionais internos |

## Papeis

| Papel | Escopo | Pode fazer | Nao deve fazer |
|---|---|---|---|
| `owner` | Dutelog global | Definir donos, politicas, ambientes, feature flags criticas e acesso administrativo total | Executar ajuste operacional sem evento e sem dono de processo |
| `admin` | Dutelog operacional | Gerir usuarios, convites, claims, parametros, importacoes e configuracoes | Aprovar excecao financeira ou WMS fora da politica definida |
| `interno` | Operacao Dutelog | Triar solicitacoes, aprovar/rejeitar demandas, acompanhar pedidos, estoque e filas | Mudar papel de usuario, faturar sem revisao financeira ou burlar `customer_code` |
| `wms` | Armazem | Executar receiving, putaway, picking, packing, expedicao, devolucao e excecoes fisicas | Alterar billing, usuarios, claims ou dados de outro modulo sem evento |
| `financeiro` | Billing | Revisar competencias, tabela de precos, servicos, faturas e eventos financeiros | Avancar tarefa WMS ou alterar saldo fisico |
| `cliente` | Proprio `customer_code` | Ver portal, abrir solicitacoes, consultar documentos/faturas e acompanhar WMS publicado | Acessar operacao interna, outro cliente ou acoes de aprovacao |
| `suporte` | Operacao tecnica | Monitorar functions, logs, backups, incidentes, App Check, rules e smoke tests | Alterar estoque, faturamento ou acesso sem aprovacao do dono do processo |

## Principios de permissao

- Permissao real deve ser aplicada por claims/perfis, Firestore Rules e Cloud
  Functions; a interface apenas reflete a permissao.
- Toda escrita critica deve registrar evento em `events` com `actor`,
  `source`, `entity_type`, `entity_id` e `customer_code` quando existir.
- Cliente sempre le e escreve somente dentro do proprio `customer_code`.
- Suporte deve operar preferencialmente em modo leitura/diagnostico; qualquer
  correcao operacional precisa de aprovacao e evento.
- Genkit pode sugerir, resumir, classificar e alertar; a transicao final fica
  com humano autorizado ou Function transacional.
- Ajustes de estoque, faturamento, acesso e expurgo de dados exigem trilha de
  auditoria e, quando aplicavel, aprovacao humana.

## Matriz por modulo

Legenda: `G` governa/configura, `A` aprova/revisa, `E` executa/escreve, `L`
le/acompanha, `P` limitado ao proprio `customer_code`, `-` sem acesso direto.

| Modulo | `owner` | `admin` | `interno` | `wms` | `financeiro` | `cliente` | `suporte` |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fundacao AI-native/eventos | G | G | L/E nota | L/E nota WMS | L financeiro | L(P) publicado | L diagnostico |
| Agente IA interno | G | G | L/A recomendacao | L WMS | L financeiro | - | L diagnostico |
| Portal do cliente | G | G | L | L operacional | L financeiro | E(P) | L(P) suporte |
| Solicitacoes do cliente | G | G | A/E | E apos aprovacao | A tipo financeiro | E(P) criar/acompanhar | L/E nota suporte |
| Eventos do portal (modelos de pedido) | E a pedido do cliente | E a pedido do cliente | E a pedido do cliente | - | - | E(P) criar/editar/excluir | - |
| Catalogo e SKUs | G | G/E | E | L/E localizacao | L custo | L(P) filtrado | L |
| Kardex e saldos | G | G | A/E | E fisico | L | L(P) | L |
| Receiving | G | G | A/L | E | L documentos | L(P) status | L incidente |
| Putaway | G | G | A/L | E | - | L(P) disponibilidade | L incidente |
| Picking | G | G | A/L | E | - | L(P) pedido | L incidente |
| Packing | G | G | A/L | E | L quando impacta fatura | L(P) volumes | L incidente |
| Expedicao | G | G | A/L | E | L | L(P) entrega/comprovante | L incidente |
| Devolucoes | G | G | A/E | E triagem fisica | L quando impacta fatura | L(P) retorno | L incidente |
| Inventario ciclico | G | G | A/E ajuste | E contagem | L impacto financeiro | L(P) publicado | L incidente |
| Billing/faturamento | G | G | L | - | A/E | L(P) | L diagnostico |
| Documentos | G | G | E | E evidencia WMS | E financeiro | E(P) upload/consulta | L |
| Usuarios e convites | G | E | - | - | - | L propria conta | L diagnostico |
| Relatorios e briefing | G | G | L | L WMS | L financeiro | L(P) curado | L diagnostico |
| Reposicao inteligente | G | G | A/L | L | L | L(P) quando publicado | L |

## Submodulos WMS

O WMS e o modulo fisico que mais exige separacao entre execucao interna e
visibilidade do cliente. Cada submodulo deve ter status proprio, evento proprio
e uma saida filtrada para portal.

| Submodulo | Colecoes principais | Eventos principais | Quem executa | Visao do cliente | Flow Genkit |
|---|---|---|---|---|---|
| Receiving | `inbound_receipts`, `inbound_items`, `quality_exceptions` | `inbound.created`, `inbound.checked`, `inbound.exception_found` | `wms`, com aprovacao/triagem `interno` | Recebimento solicitado, em conferencia, recebido ou com divergencia publicada | `receivingCheckFlow`, `inboundExceptionFlow` |
| Putaway | `putaway_tasks`, `locations`, `stock_balances` | `putaway.created`, `putaway.completed`, `putaway.exception_found` | `wms` | Disponibilidade prevista/confirmada, sem expor regra interna de slotting quando sensivel | `putawaySuggestionFlow`, `warehouseOptimizationFlow` |
| Picking | `pick_tasks`, `pick_lines`, `stock_reservations` | `picking.created`, `picking.started`, `picking.completed`, `picking.shortage_found` | `wms` | Pedido em separacao, falta publicada, quantidade atendida e proximo marco | `pickPathSuggestionFlow`, `pickingExceptionFlow` |
| Packing | `pack_tasks`, `packages`, `package_items` | `packing.created`, `packing.started`, `packing.completed`, `packing.exception_found` | `wms` | Volumes, conferencia, etiqueta quando aplicavel e pendencias publicadas | `packingValidationFlow`, `packageDocumentFlow` |
| Expedicao | `shipments`, `shipment_items`, `delivery_proofs` | `shipment.created`, `shipment.dispatched`, `shipment.delivered`, `shipment.exception_found` | `wms` | Despacho, entrega, comprovante e status final | `dispatchAdvisorFlow`, `deliveryFollowUpFlow` |
| Devolucao | `returns`, `return_items`, `quality_exceptions` | `return.created`, `return.received`, `return.disposition_set` | `wms` e `interno` | Retorno recebido, triagem e disposicao quando publicada | `returnTriageFlow`, `damageSummaryFlow` |
| Inventario ciclico | `cycle_counts`, `cycle_count_lines`, `stock_adjustments`, `events` | `inventory.count_started`, `inventory.count_completed`, `inventory.adjusted` | `wms` conta, `interno` aprova ajuste | Resultado publicado somente apos revisao, quando afetar saldo do cliente | `inventoryAnomalyFlow`, `cycleCountReviewFlow` |

Regras especificas do WMS:

- Tarefa WMS so avanca se status atual, permissao, saldo/reserva e entidade
  esperada forem validos.
- Excecao fisica nunca deve ser resolvida fora do sistema; ela vira evento e
  pode bloquear a tarefa ate decisao.
- Cliente acompanha o ciclo por marcos publicados, nao por todos os detalhes
  internos de produtividade, operador, endereco sensivel ou regra de roteamento.
- Expedicao entregue e o ponto em que reserva/saldo podem ser consumidos, desde
  que a Function valide idempotencia e evento.

## Visibilidade do Agente IA

### Interno Dutelog

O Agente IA interno e uma central de operacao, auditoria e recomendacao. Ele
pode mostrar:

- Timeline de `events` por cliente, modulo, severidade e entidade.
- `ai_agent_inbox` com riscos, recomendacoes, bloqueios e proximas acoes.
- `ai_agent_memory` por cliente, pedido, WMS, fatura ou incidente.
- Controle de flows Genkit: modo desligado, shadow, ativo assistivo e erro.
- Evidencias usadas pela recomendacao: IDs, eventos citados e payload resumido.

Por papel:

- `owner` e `admin`: enxergam configuracao, auditoria ampla e riscos de acesso.
- `interno`: enxerga riscos e recomendacoes operacionais para solicitacoes,
  pedidos, estoque e clientes autorizados.
- `wms`: enxerga sinais ligados as filas WMS, excecoes fisicas e SLA de tarefas.
- `financeiro`: enxerga sinais de competencia, fatura, servico, divergencia de
  preco e eventos operacionais que impactam cobranca.
- `suporte`: enxerga saude de functions, erros, falhas de App Check/rules,
  atrasos de flow e incidentes, com menor acesso a dados comerciais sensiveis
  quando possivel.

### Cliente

No portal, a IA deve aparecer como leitura curada e filtrada:

- Alertas publicados do proprio `customer_code`.
- Explicacoes de status da solicitacao, WMS, entrega, documento ou fatura.
- Pendencias objetivas que o cliente pode resolver: NF, destino, janela de
  coleta, aprovacao de informacao ou documento ausente.
- Nenhum prompt interno, memoria de outro cliente, score tecnico, log de erro,
  regra de roteamento ou recomendacao ainda nao revisada quando houver impacto
  operacional.

Cliente nunca deve executar acao de IA que altere estoque, faturamento, acesso
ou status WMS diretamente. Ele abre ou complementa solicitacoes; Dutelog decide
e executa.

## Genkit por tras de cada modulo

Genkit fica atras dos modulos como motor de interpretacao. O fluxo padrao e:

1. Uma tela, Function ou trigger grava uma entidade operacional e um evento em
   `events`.
2. `analyzeEventFlow` ou um flow especifico do modulo le os dados permitidos.
3. O flow devolve saida estruturada: severidade, resumo, entidades citadas,
   confianca, proximas acoes e riscos.
4. A aplicacao grava recomendacao em `ai_agent_inbox`, resumo em
   `ai_agent_memory` ou novo evento `event.analyzed`/`briefing.generated`.
5. Um humano autorizado aceita/rejeita a recomendacao ou aciona uma Function
   transacional, que valida permissao novamente antes de escrever.

| Modulo | Flows atras do modulo | Saida esperada | Limite de seguranca |
|---|---|---|---|
| Fundacao AI-native | `analyzeEventFlow`, `dailyBriefingFlow`, `operatorNoteFlow` | Severidade, briefing, memoria e proximas acoes | Nao altera entidade operacional sozinho |
| Portal do cliente | `customerPortalAssistantFlow`, `customerAccessSummaryFlow` | Resumo amigavel do status e pendencias do cliente | Sempre filtrado por `customer_code` |
| Solicitacoes | `customerRequestSummaryFlow`, `orderRiskFlow` | Prioridade, risco de SLA, dados faltantes e sugestao de decisao | Aprovacao/rejeicao continua com `interno`/Function |
| Catalogo e SKUs | `inventoryQuestionFlow`, `missingCostDetectionFlow` | Respostas sobre estoque e alerta de cadastro/custo | Nao altera produto/SKU sem usuario autorizado |
| Kardex e saldos | `inventoryAnomalyFlow` | Divergencias provaveis e entidades afetadas | Ajuste exige aprovacao e evento |
| Receiving | `receivingCheckFlow`, `inboundExceptionFlow` | Alerta de NF, quantidade, avaria ou documento pendente | Nao marca recebido sem conferencia fisica |
| Putaway | `putawaySuggestionFlow`, `warehouseOptimizationFlow` | Sugestao de endereco e risco de slotting | Operador confirma localizacao |
| Picking | `pickPathSuggestionFlow`, `pickingExceptionFlow` | Sequencia de separacao e risco de falta | Operador registra falta/conclusao |
| Packing | `packingValidationFlow`, `packageDocumentFlow` | Inconsistencia de volume, etiqueta ou documento | Bloqueio exige acao humana |
| Expedicao | `dispatchAdvisorFlow`, `deliveryFollowUpFlow` | Pendencias antes da saida e acompanhamento de entrega | Nao despacha sem confirmacao |
| Devolucao | `returnTriageFlow`, `damageSummaryFlow` | Disposicao sugerida e resumo de avaria | Disposicao final exige responsavel |
| Billing | `billingReviewFlow`, `invoiceExplanationFlow` | Itens para revisar, explicacao de fatura e divergencias | Financeiro aprova emissao/ajuste |
| Documentos | `documentSummaryFlow`, `documentExtractionFlow` | Resumo, classificacao e entidades vinculadas | Documento bruto fica protegido por permissao |
| Usuarios e convites | `accessAuditFlow`, `permissionRiskFlow` | Risco de acesso, convite suspeito e recomendacao de remediacao | `owner`/`admin` decide mudanca de papel |
| Relatorios | `dailyBriefingFlow`, `kpiNarrativeFlow` | Narrativa executiva e riscos por periodo | Numeros oficiais continuam vindo das colecoes |
| Reposicao inteligente | `replenishmentSuggestionFlow`, `slowMoverDetectionFlow` | Sugestao de reposicao/giro a partir de dados importados | Futuro; exige revisao antes de pedido/compra |

## Regras para novas telas/modulos

Nenhum modulo novo deve entrar no produto sem:

- `module_id`, rota e dono operacional definidos.
- Colecoes e campos chave documentados.
- Eventos principais no formato `dominio.acao`.
- Matriz de permissao por papel e por `customer_code`.
- Caminho cliente separado do caminho Dutelog quando houver dados publicados.
- Flow Genkit previsto, mesmo que comece desligado ou em shadow mode.
- Regra explicita sobre o que a IA pode apenas sugerir e o que depende de
  aprovacao humana.
- Checklist de auditoria, rollback e feature flag quando houver escrita critica.

## Pontos de implementacao para producao

- Claims/perfis devem representar o papel granular alvo:
  `owner`, `admin`, `interno`, `wms`, `financeiro`, `cliente`, `suporte`.
- Perfis podem ter escopos adicionais: `customer_codes`, `warehouse_codes`,
  `module_scopes` e `support_mode`.
- Firestore Rules devem bloquear leitura/escrita fora do papel e do
  `customer_code`.
- Cloud Functions devem repetir a validacao das rules antes de transicoes
  criticas, porque chamadas backend nao podem confiar apenas no frontend.
- Functions de aprovacao, WMS e billing devem aceitar idempotencia e registrar
  evento no mesmo fluxo da alteracao.
- Genkit deve receber somente dados necessarios para o escopo do modulo e nunca
  segredos, credenciais ou dados de outro cliente.
