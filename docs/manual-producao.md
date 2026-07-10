# Manual de producao

Este manual orienta operacao, suporte e lideranca durante a execucao em
producao. Ele complementa os guias de portal, solicitacoes, WMS e contrato de
eventos.

## Escopo

- Proteger producao antes de liberar automacoes.
- Operar Cloud Functions e Genkit flows com rastreabilidade.
- Executar WMS fisico completo, do recebimento ate expedicao/devolucao.
- Definir papeis, rotina diaria, incidentes e rollout.

## Papeis

| Papel | Pode fazer | Nao deve fazer |
|---|---|---|
| `admin` | Gerir usuarios, claims, feature flags e parametros | Executar ajuste operacional sem evento |
| `interno` | Triar solicitacoes, acompanhar pedidos e resolver pendencias | Acessar dados de cliente fora do escopo permitido |
| `wms` | Executar tarefas fisicas e registrar excecoes | Aprovar billing ou mudar papeis |
| `financeiro` | Revisar competencia, servicos e faturas | Avancar WMS fisico |
| `cliente` | Ver seu portal, abrir solicitacoes e consultar historico | Ver operacao de outro cliente |
| `suporte` | Monitorar incidentes, logs, backups e deploys | Alterar saldo/fatura sem aprovacao do dono do processo |

Permissoes efetivas devem ser validadas por rules/backend, nao apenas por
componentes de interface.

## Rotina diaria de producao

1. Conferir alertas de erro, filas paradas e eventos criticos.
2. Validar se `events` esta recebendo solicitacoes, WMS, billing e acesso.
3. Revisar `ai_agent_inbox` para riscos de SLA, divergencia e acesso.
4. Operacao WMS prioriza tarefas bloqueadas, criticas ou com prazo proximo.
5. Financeiro revisa eventos de competencia antes de faturar.
6. Suporte confirma backup/export do dia anterior e ausencia de falhas de
   function.

## Blindagem de producao

Antes de ativar ou expandir producao:

- Confirmar ambiente correto no build, Firebase config e variaveis.
- Rodar smoke test de login, portal, solicitacao, aprovacao, WMS e billing.
- Validar App Check, Firestore Rules e claims de usuarios reais.
- Exportar Firestore antes de migracao, rollout ou carga relevante.
- Garantir feature flags para pausar aprovacao, WMS, billing e IA.
- Documentar responsavel de plantao e canal de incidente.
- Registrar decisao de go/no-go com horario, versao e responsaveis.

## Cloud Functions em producao

As transicoes criticas devem ser executadas por functions, com frontend apenas
solicitando a acao.

### Padroes obrigatorios

- Validar permissao por papel e `customer_code`.
- Validar status atual antes de alterar status novo.
- Usar transacao para pedido, reserva, WMS, saldo e evento.
- Usar idempotencia em aprovacao, avanco de tarefa e retry.
- Escrever evento no ledger no mesmo fluxo da alteracao operacional.
- Retornar erro claro para usuario e log detalhado para suporte.

### Operacao de incidente

1. Identificar function, `request_id`, entidade e cliente afetado.
2. Verificar se houve escrita parcial; se sim, bloquear a entidade por flag ou
   status operacional.
3. Comparar `events` com colecoes operacionais.
4. Reprocessar apenas quando a chave de idempotencia garantir que nao havera
   duplicidade.
5. Registrar `operator.note` com causa, impacto e acao tomada.

## Genkit flows em producao

Genkit deve atuar como camada de analise e assistencia operacional.

### Regras

- Flow nao executa baixa de estoque, faturamento, convite ou mudanca de papel.
- Saidas precisam ser estruturadas: severidade, motivo, entidades e acao
  sugerida.
- Toda recomendacao relevante deve apontar eventos/entidades usadas como base.
- Prompts e schemas devem ser versionados no deploy.
- Alucinacao ou baixa confianca vira recomendacao `attention`, nao acao.

### Monitoramento

- Volume de execucoes por flow.
- Taxa de erro e timeout.
- Recomendacoes aceitas/rejeitadas.
- Eventos sem analise por mais de uma janela operacional.
- Custos por cliente/periodo quando aplicavel.

## WMS fisico completo

### Receiving

- Conferir agenda, cliente, documento/NF e itens esperados.
- Registrar falta, sobra, avaria ou documento pendente como excecao.
- Concluir recebimento somente apos conferencia fisica.
- Itens recebidos sem endereco final devem ir para staging/putaway.

### Putaway

- Seguir endereco sugerido ou justificar troca.
- Confirmar endereco fisico antes de concluir.
- Nao disponibilizar saldo enquanto item estiver em staging sem confirmacao.

### Picking

- Separar por prioridade, SLA e sequencia operacional.
- Confirmar SKU, quantidade e endereco.
- Falta fisica deve gerar excecao, nunca ajuste silencioso.
- Picking concluido cria etapa de packing.

### Packing

- Conferir itens separados contra pedido/reserva.
- Registrar volume, etiqueta, lacre, fotos ou documentos quando exigido.
- Divergencia bloqueia expedicao ate resolucao.

### Expedicao

- Conferir romaneio, destino, coleta/transportadora e comprovante.
- Despacho baixa reserva apenas quando a saida fisica esta confirmada.
- Entrega ou comprovante encerra o ciclo operacional do pedido.

### Devolucao e inventario

- Devolucao deve ter triagem e disposicao: disponivel, avariado, quarentena ou
  descarte.
- Inventario ciclico deve registrar contagem, divergencia, aprovador e evento
  de ajuste.
- Ajuste de saldo sem aprovacao e evento bloqueia producao.

## Rollout operacional

### Antes do piloto

- Treinar admin, interno, WMS, financeiro, suporte e cliente piloto.
- Executar ensaio em staging com dados representativos.
- Definir janela de corte, plano de rollback e donos por frente.
- Congelar planilha paralela ou marcar claramente como leitura historica.

### Durante o piloto

- Comecar em shadow mode quando possivel: eventos e IA acompanham operacao
  manual.
- Liberar um cliente e um conjunto pequeno de SKUs/enderecos.
- Fazer reconciliacao diaria entre eventos, saldos, pedidos e tarefas.
- Manter reuniao curta de go/no-go ao fim de cada dia do piloto.

### Depois do piloto

- Fechar divergencias antes de expandir.
- Registrar decisoes no roadmap e atualizar este manual.
- Ampliar por cliente, armazem, fluxo ou modulo, nunca tudo ao mesmo tempo sem
  criterio de reversao.

## Checklist de release

- Build aponta para ambiente correto.
- Rules, claims e App Check foram validados.
- Smoke test passou.
- Backup/export recente existe.
- Functions criticas respondem e registram eventos.
- Genkit flows estao em modo esperado: desligado, shadow ou ativo.
- Feature flags de pausa foram testadas.
- Responsavel de suporte esta definido.

## Checklist de rollback

- Pausar automacao por feature flag.
- Bloquear novas aprovacoes se houver risco de duplicidade.
- Manter leitura do portal quando segura.
- Restaurar dados somente apos decisao formal e export do estado atual.
- Registrar evento/nota com janela afetada, entidades e acao corretiva.

