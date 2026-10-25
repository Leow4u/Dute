# Lançamento da Fase 4: roteiro para publicar no `dute-prod`

Escrito na parte 4.9a (23/10/2026), no fim da Fase 4. É o marco 4 do plano de
implantação ("Lançamento: WMS na v3, portal com OS, financeiro da
operação"). A publicação na produção espera o OK do Leonardo; nada aqui é
disparado sem ele. Sem dado real neste arquivo.

## 1. Estado de hoje

- **Na `main`.** As partes 4.1a a 4.8b, com o desenho e o registro de cada
  uma em `fase-4-financeiro.md`:
  - o Financeiro da operação: A faturar, o registro da NF, a cobrança, a via
    comercial e os relatórios;
  - o portal com as OS, o comprovante da OS concluída, as NFs dos serviços e
    o Solicitar OS;
  - a entrega do pedido de saída do WMS pela Operação e o retorno ao armazém;
  - os avisos no sino e por e-mail, com os modelos de cada contato;
  - o shell da Armazenagem e as quatro telas do WMS na v3: Início, Pedidos,
    Estoque e Receber;
  - os relatórios da Operação e do Financeiro.
- **Liberação.**
  - `FINANCEIRO_AMBIENTES_LIBERADOS` tem só o `dute-homolog`, no app e nas
    Functions. O Financeiro entra no `dute-prod` pela parte 4.9b, com o OK
    (seção 6).
  - A Operação e o Comercial já estão liberados no `dute-prod`. Por isso o
    portal com as OS, a solicitação, a entrega do WMS e os avisos entram na
    produção só por publicar a `main`.
  - O `dute-btg` recusa tudo.
- **Última publicação de produção.** Foi o commit `fde9ba0` (PR 177), em
  23/10 às 02:16 UTC. O roteiro da Operação (`operacao-producao.md`, marco
  3) não foi disparado. A próxima publicação leva juntos os marcos 2, 3 e 4:
  - a Fase 2 inteira, com o shell e o Início por módulo;
  - a Fase 3 da parte 3.4a à 3.14;
  - a Fase 4;
  - o que já entrou da Fase 5 (`fase-5-memoria.md`), desligado na produção
    pela liberação própria.
  - Até a parte 4.3d, foram 80 merges. Confirmar a base antes de disparar.
- **Ciclos conferidos no emulador.**
  - `functions/operacao/src/domain/ciclo-do-cliente.integration.test.ts`
    (parte 4.9a). O cliente pede a OS pelo portal, a coordenação abre a
    demanda e agenda a OS, e a líder executa e conclui com a assinatura. O
    Financeiro registra a NF. A rotina dos avisos lê os eventos de verdade e
    dá o sino e o e-mail de cada passo a quem ligou o modelo. O da conclusão
    leva ao comprovante, e o da NF só vai a quem lê valor.
  - `functions/financeiro/src/domain/cobranca.integration.test.ts`. A demanda
    vai de A faturar a paga, com o pagamento parcial e a NF do portal em
    cada passo, sem valor nos eventos.
  - `functions/operacao/src/domain/ciclo.integration.test.ts`, o ciclo da
    Fase 3.
  - Os testes de regras: a Operação não lê `faturas`, e o cliente lê só o
    que é dele (`functions/wms/src/financeiro-faturas.rules.test.ts`,
    `operacao-*.rules.test.ts`).

## 2. O que muda no `dute-prod` só por publicar a `main`

O que veio da Fase 3 está em `operacao-producao.md`, seção 2. Da Fase 4:

- **Regras do Firestore.**
  - `faturas` e `pagamentos` abrem só a quem lê preço. `client_faturas`
    abre também ao cliente com as faturas no contrato.
  - `service_requests` abre a quem coordena a Operação e ao cliente com a
    Operação no contrato.
  - `client_notifications` abre ao cliente dono e a owner e admin.
    `email_outbox` abre só a owner e admin. `notification_cursors` não abre
    pelo navegador. `client_notification_reads/{uid}` é só do próprio login.
  - O financeiro lê os eventos `nf.*` e `cobranca.*`, como os do faturamento
    do WMS. Nenhum leva valor.
  - Ninguém grava pelo navegador em nenhuma delas.
  - Da Fase 5: quem tem o Agent Dute do núcleo, o comercial incluído, lê a
    própria conversa com o agente (`canReadAgentChat`). Gravar pelo
    navegador segue como antes.
  - `documents` e `document_links` deixam de aceitar gravação pelo
    navegador (25/10/2026). Nenhuma tela gravava ali: o documento passa pela
    `mutateManagedEntity`. Antes, o wms e o financeiro podiam gravar um
    documento já publicado para qualquer cliente, e a callable seguinte o
    levava ao portal dele (teste em `functions/wms/src/documentos.rules.test.ts`).
  - O cliente lê só os avisos do Agent Dute do WMS para o cliente
    (`operational_notifications` com `audience: "client"`), aprovados ou
    enviados (25/10/2026). Antes, lia também o aviso interno do próprio
    contrato, com a nota interna e os e-mails da equipe. Nenhuma tela do
    portal lia essa coleção (teste em
    `functions/wms/src/agente-avisos.rules.test.ts`).
- **Regras do Storage.**
  - O anexo da solicitação do portal (`portal/{code}/solicitacoes/`).
  - O cliente da OS concluída lê a assinatura e as fotos do final (parte
    4.3c).
- **Índices.** Três novos: `events` por `type` e `created_at`,
  `client_notifications` por `customer_code` e `created_at`, e
  `ai_case_memory` por `customer_code` e `fechada_em` (a memória, parte
  5.3b).
  - O de `events` se constrói sobre a coleção que já existe. Até ficar
    pronto, a rotina dos avisos falha e tenta de novo a cada 5 minutos.
- **Functions.** São 145 callables: 82 do WMS, 12 do Comercial, 18 da
  Operação, 7 do Financeiro, 16 do núcleo e 10 do RH.
  - Do WMS, entram `setOrderDelivery` e `receiveOrderReturn`.
  - Da Operação, entram as da Fase 3 e `requestService`,
    `declineServiceRequest`, `openStorageDemand` e `markNotificationsRead`.
  - Do Financeiro, entram `registerNf` e `advanceFatura`, numa codebase nova
    (`financeiro`). Recusam no `dute-prod` até a parte 4.9b.
  - Também do Financeiro, as da NFS-e pela Omie e da baixa (Fase 7, parte
    7.4): `emitNfOmie`, `actOnNfEmission`, `listNfEmissions`,
    `actOnNfSettlement` e `listNfSettlements`. Recusam no `dute-prod` mesmo
    com o Financeiro ligado: a Omie tem a liberação própria
    (`OMIE_AMBIENTES_LIBERADOS`, só o `dute-homolog`).
  - Do núcleo, entram `suggestDuration`, `answerSuggestion`,
    `findSimilarQuotes` e `answerStockAlert`, na codebase nova `core`
    (Fase 5). Recusam no
    `dute-prod`: a memória só vale no `dute-homolog`
    (`MEMORIA_AMBIENTES_LIBERADOS`). Também entram as callables do Agent
    Dute do núcleo (`chatWithDute`, as anotações, os playbooks e as
    rotinas), que recusam fora de `AGENTE_AMBIENTES_LIBERADOS` (só o
    `dute-homolog`): na produção segue o agente do WMS.
  - Do RH, entram as dez da Fase 8 (a ficha, os arquivos e a exportação), na
    codebase nova `rh`, com o banco `dute-rh` e as regras dele
    (`firestore-rh.rules`). Recusam no `dute-prod`: o RH só vale no
    `dute-homolog` (`RH_AMBIENTES_LIBERADOS`).
  - Seis functions agendadas: `runDailyAlerts`, todo dia às 06:00,
    `runNotifications`, a cada 5 minutos, `runOmieSync`, a cada 5 minutos,
    que não faz nada fora da liberação da Omie, `runMeasures`, a cada 15
    minutos, que calcula as medidas, as lembranças e o relógio do estoque
    para os dias parado e, uma vez por dia, propõe o alerta do item parado,
    `runDuteRoutines`, a cada 15 minutos, que roda as rotinas do Agent
    Dute, e `runRhAlerts`, a rotina diária dos vencimentos do RH.
    `runMeasures` confere a liberação da memória, `runDuteRoutines` a do
    agente e `runRhAlerts` a do RH: as três não fazem nada no `dute-prod`,
    onde as rotinas do agente seguem pela `runAgentRoutines` do WMS.
- **Frontend.**
  - O shell v3 por módulo, inclusive o da Armazenagem, e as quatro telas do
    WMS na v3. A BTG passa a ver o Início, Pedidos, Estoque e Receber novos.
  - Pedidos ganha a entrega: pela Dutelog ou retirada pelo cliente.
  - O portal ganha Minhas OS, o comprovante, o Solicitar OS e o sino, para o
    cliente com a Operação no contrato.
  - A Operação ganha Relatórios.
  - O shell do Financeiro não aparece: fora da liberação, o card do
    Financeiro continua no Faturamento do WMS.
- **Os avisos ligam sozinhos.** A rotina confere a liberação da Operação, que
  já vale no `dute-prod`.
  - A primeira rodada só marca o cursor: os eventos de antes não viram aviso.
  - Sem `RESEND_API_KEY`, o e-mail fica auditado em `email_outbox` e não
    sai. Só o sino recebe.
  - O aviso da NF só existe com o Financeiro ligado.
- **A entrega do WMS.** A entrega pela Dutelog abre a demanda direta e as OS
  na Operação. A BTG hoje fatura o transporte na fatura do WMS, e a demanda
  da entrega vai ao Comercial para orçar. Até o Leonardo responder como a
  entrega fatura (seção 8), o Comercial não orça a demanda da entrega da
  BTG, para não cobrar duas vezes.
- **As correções da revisão dos manuais (25/10/2026).** Entram com a `main`,
  sem liberação própria. Muda o comportamento:
  - a movimentação manual (Estoque › Histórico e "Ajustar saldo") grava
    para o cliente ativo, e `createInventoryMovement` recusa o SKU fora do
    cadastro e o de outro cliente (PR 351);
  - o Receber pede a "Justificativa da divergência" para concluir a chegada
    com falta ou sobra, que o servidor já exigia (PR 352);
  - a solicitação que o cliente cancelou sai da triagem e do Início (PR
    353), a exceção resolvida deixa de marcar o pedido "com exceção" (PR
    354), e o contador de Pedidos conta a triagem (PR 355);
  - o suporte consulta o armazém sem as ações que o servidor recusa e sem
    a Contagem (PR 359);
  - os códigos do SKU ficam só para leitura ao editar (PR 358), Estoque ›
    Alertas só existe onde a memória está liberada, que não é o `dute-prod`
    (PR 360), e as telas internas trocam textos: "a conferir" (PR 356),
    "Estoque › Receber" (PR 357) e o cliente ativo onde dizia "BTG" (PR
    361);
  - no portal: "Esqueci minha senha" avisa quando falta o e-mail, o pedido
    acima de 100 itens e o prazo no passado são recusados com o motivo, as
    faturas seguem o contrato e a NF mostra a armazenagem que entrou nela
    (PRs 342 a 350).
- **O painel do sistema.** O e-mail dos avisos que desiste depois de 5
  tentativas vira erro da `runNotifications` no quadro de erros (PR 362), e o
  quadro Latência lê o Cloud Monitoring (PR 363). Se a conta de runtime do
  `dute-prod` não for Editor, ele pede o `roles/monitoring.viewer`
  (`docs/painel-sistema.md`, seção 2).
- **Os eventos e o Agent Dute do WMS (25/10/2026).** Entram com a `main`,
  sem liberação própria:
  - o registro manual de evento (`POST /api/ai/events`) aceita só a equipe
    e só os quatro tipos que as telas mandam (o convite aceito, o
    conhecimento anexado, a anotação operacional e o incidente do
    suporte), com a hora do servidor (PR 373);
  - os rascunhos de aviso do Agent Dute não citam a BTG nem cumprimentam
    um contato dela; o interno diz o cliente no assunto (PR 374);
  - o prompt da revisão de documento pela IA não diz que todo documento é
    da BTG (PR 375);
  - as movimentações do Agent Dute contam só a entrada e a saída de
    verdade, sem a guarda e as correções (`fase-5-memoria.md`, "Correção:
    as movimentações do agente contavam a guarda como entrada e saída");
  - as movimentações do Agent Dute do WMS leem só os movimentos do
    cliente da conversa. Antes, liam os de todos os clientes no período,
    com teto de 5.000, e o volume de outro cliente podia esconder os dele;
  - num período com mais de 5.000 movimentos do cliente, as movimentações
    do Agent Dute do WMS somam só os dias que couberam inteiros e dizem o
    começo que ficou para outra consulta (`fase-5-memoria.md`, "Correção:
    o resumo das movimentações cortava o período sem avisar"). Antes,
    somavam os 5.000 mais recentes como se fossem o período todo.
  A matriz de papéis do WMS (PR 372) é só teste: nenhuma callable muda
  quem passa.
- **O estoque, o aviso de envio e a tela Documentos do WMS (25/10/2026).**
  Entram com a `main`, sem liberação própria:
  - a contagem cíclica recusa o endereço com itens separados esperando a
    entrega, com o número do pedido (`manual-armazenagem.md`). O separado
    já saiu da prateleira e só sai do saldo na entrega. Antes, a contagem
    da prateleira nesse intervalo baixava o separado, e a entrega baixava
    de novo;
  - um código novo ganha um SKU só: o mesmo código em duas linhas do aviso
    de envio, em dois avisos aprovados antes do primeiro recebimento, ou em
    duas linhas da conferência do aviso sem código usa o SKU já gerado. O
    cadastro do produto novo só nasce na conclusão do recebimento, e cada
    linha gerava o seu: a conclusão cadastrava dois SKUs para o mesmo
    código, e o código passava a ser recusado ("ligado a mais de um SKU");
  - a aprovação do aviso de envio recusa a linha de produto existente com
    o SKU de outro cliente. Antes, o SKU vindo do portal ia direto para o
    recebimento: a conclusão criava saldo com o código do outro cliente e
    subia o estoque do cadastro dele. Recebimento avulso, conferência,
    devolução e produto novo do aviso já conferiam o dono;
  - a tela Documentos abre para o financeiro: a lista e o tempo real dele
    pedem só os documentos de faturamento (`entity_type` "fatura"), que é o
    que a regra deixa ele ler. Antes, iam sem o filtro, e o Firestore negava
    a lista inteira e o acompanhamento.
- **O faturamento do WMS no mês sem foto (25/10/2026).** Entra com a
  `main`, sem liberação própria. As entradas, as saídas e os movimentos
  passam a cobrar só o recebimento e a expedição, cada movimento uma vez
  (`fase-7-financeiro-unificado.md`, "Correção: o mês sem foto cobrava o
  que o armazém faz por dentro").
  - A produção de hoje cobraria em outubro a contagem de abertura inteira
    como entrada de peças, e cada guarda como uma entrada e uma saída.
  - O dinheiro só muda onde a Tabela de preços cobra por "Entradas
    (peças)", "Saídas (peças)" ou "Nº de movimentações".
  - O evento da fatura emitida (`billing.invoice_emitted`) deixa de levar
    o total, que interno e wms liam pelos eventos sem ler o faturamento
    (`fase-7-financeiro-unificado.md`, "Correção: o evento da fatura
    emitida do WMS levava o total").
  - O ad valorem passa a sair do saldo de cada SKU vezes o preço unitário
    dele. Na produção de hoje, o pedido zera o valor do SKU e a entrega não
    o baixa (`fase-7-financeiro-unificado.md`, "Correção: o valor da
    mercadoria zerava com o pedido e não baixava com a entrega"). O valor
    que o portal mostra ao cliente segue a mesma conta.
  - O uso de outubro congela na primeira prévia ou emissão a partir de
    01/11. A Armazenagem › Faturamento abre no mês anterior, então basta
    abrir a tela. Publicar antes de 01/11 evita o passo abaixo.
  - Se a prévia de outubro abrir na produção antes da publicação, o uso
    fica congelado com a conta antiga. Antes de emitir outubro, apagar o
    documento do cliente em `billing_operational_snapshots` (o da BTG é
    `BTG_Pactual__2026-10`), que guarda só o uso; a próxima prévia congela
    de novo, com a conta nova. Depois de emitida, a fatura não muda mais.
  - A emissão recusa quando uma quantidade salva nos serviços do mês é de
    um item que saiu da Tabela de preços: antes, a cobrança sumia sem aviso
    (`fase-7-financeiro-unificado.md`, "Correção: a quantidade salva de um
    item que saiu da tabela sumia da fatura").
  - O pedido de saída deixa de mudar o preço do SKU, base do ad valorem,
    pelo custo que vier nele. A tela não manda custo, mas a callable aceitava
    de qualquer um que pede, o cliente inclusive
    (`fase-7-financeiro-unificado.md`, "Correção: o custo mandado no pedido
    de saída mudava o preço do SKU").
  - A competência que ninguém salvou passa a emitir. Antes, "Emitir"
    recusava com "Competencia 2026-10 nao encontrada.", e o cliente sem
    linha manual não emitia nunca pela tela. Na produção de hoje, antes de
    emitir outubro, salve as quantidades do mês: edite uma, volte ao valor
    dela e salve (`fase-7-financeiro-unificado.md`, "Correção: a competência
    que ninguém salvou não emitia").
- **Dados.** Nada é migrado. A OS concluída antes da parte 4.3c tem o
  comprovante sem as fotos.
- **Papéis.** Nenhum novo.
- **Conferência do invoker.** Passa a conferir 145 callables, das seis
  codebases.

## 3. Antes de publicar (conferir na homologação)

Com o HEAD da `main` verde e publicado no `dute-homolog`, use um owner, um
interno, um financeiro, um login `campo` ligado a um colaborador e um login
de cliente. O cliente precisa ter a Operação e as faturas no contrato e um
contato com os avisos ligados (Comercial › Clientes).

1. **Portal.** Com o cliente, pedir a OS em Minhas OS › Solicitar OS, com um
   anexo. Ela aparece em Solicitações.
2. **Operação.** A solicitação aparece em Para planejar. Abrir a demanda por
   ela e agendar a OS com a equipe e o veículo.
3. **Campo.** Executar e concluir com a foto do final e a assinatura.
4. **Sino e fila.** Em até 6 minutos, o sino do portal mostra a solicitação
   recebida, a OS agendada, em execução e concluída. No console do
   Firestore, `email_outbox` tem os e-mails auditados.
5. **Comprovante.** O aviso de OS concluída abre o comprovante, com o feito,
   quem recebeu, a assinatura e a foto do final. "Baixar PDF" salva só o
   papel.
6. **Até a NF.** Revisar a OS, orçar a execução no Comercial e autorizar. A
   demanda chega a A faturar.
7. **Financeiro.** Registrar a NF, marcar como enviada, lançar um pagamento
   parcial e o que quita. A demanda fica Paga.
   - Em Faturas do portal, o cliente vê a NF com o saldo e depois paga.
   - O sino mostra "NF emitida".
8. **Relatórios.** Os da Operação e os do Financeiro abrem, com o Excel e o
   PDF.
9. **WMS na v3.** Com o interno, abrir o Início, Pedidos, Estoque e Receber.
   Em Pedidos, definir a entrega pela Dutelog num pedido e a retirada em
   outro. Só a pela Dutelog vira demanda na Operação.
10. **Valores.** O interno e o campo não veem valor em nenhuma tela da
    Operação, nem no comprovante.
11. **A BTG.** Com um login da BTG, o portal mostra o estoque, os pedidos e
    as faturas do WMS como antes. Sem a Operação no contrato, Minhas OS não
    aparece.
12. **As correções de 25/10.** Com o interno, conferir no Receber uma
    chegada com falta: a ficha pede a justificativa e conclui. Com outro
    cliente ativo, "Registrar movimentação" de um SKU da BTG é recusado e o
    de um SKU dele grava no cliente certo.
13. **Painel do sistema.** Com o owner, Configuração › Sistema mostra o
    quadro Latência com as functions. "Sem permissão" num quadro pede o papel
    da seção 2 de `docs/painel-sistema.md`, no projeto em que aparecer.
14. **Eventos manuais.** Com o suporte, Configuração › Sistema registra um
    incidente; com o interno, o Agent Dute › Painel grava a anotação
    operacional. Os dois aparecem na timeline com a hora do registro.

## 4. Publicar

1. **Base.** HEAD da `main` com CI verde e a homologação publicada nele.
2. **Backup.** PITR de 7 dias e backup diário ligados
   (`backup-e-recuperacao.md`). Anotar o instante de antes do deploy.
3. **O banco do RH.** O `dute-rh` existe no `dute-prod`, com a proteção
   contra exclusão, o PITR e o backup diário: a última execução do workflow
   `Banco rh` com `producao` está verde (`fase-8-rh.md`). Sem o banco, a
   publicação das regras falha e nada mais sobe.
4. **Janela.** Combinar com a contagem de abertura da BTG, que roda no
   `dute-prod`. O deploy de functions leva de 11 a 15 minutos, agora com
   seis codebases.
5. **Disparo.** Actions > CI > Run workflow, com `publicar_producao`
   marcado, do HEAD. O job só vale verde com as conferências do fim:
   - `check_rules_deployed.sh`;
   - o invoker das 145 callables;
   - `check_frontend_deployed.sh`;
   - o smoke.

## 5. Depois de publicar (a conferência de produção)

1. **As seis rotinas novas existem:**

   ```powershell
   cd C:\DEV\Dute
   gcloud scheduler jobs list --project dute-prod --location southamerica-east1
   ```

   Precisam aparecer `firebase-schedule-runDailyAlerts-southamerica-east1`,
   `firebase-schedule-runNotifications-southamerica-east1`,
   `firebase-schedule-runMeasures-southamerica-east1`,
   `firebase-schedule-runDuteRoutines-southamerica-east1`,
   `firebase-schedule-runOmieSync-southamerica-east1` e
   `firebase-schedule-runRhAlerts-southamerica-east1`. A `runDuteRoutines`,
   a `runOmieSync` e a `runRhAlerts` não fazem nada no `dute-prod`, fora das
   liberações delas.
2. **Os índices ficaram prontos.** Os três novos aparecem com `READY`:

   ```powershell
   cd C:\DEV\Dute
   gcloud firestore indexes composite list --project dute-prod
   ```

3. **A primeira rodada dos avisos.** A primeira linha diz `iniciou: true`. As
   seguintes não têm erro:

   ```powershell
   cd C:\DEV\Dute
   gcloud functions logs read runNotifications --gen2 --region southamerica-east1 --project dute-prod --limit 20
   ```

4. **O Financeiro continua desligado.** `/financeiro` não abre, e o card do
   Financeiro leva ao Faturamento do WMS.
5. **A BTG intacta.** Portal, faturas do WMS e contagem de abertura
   funcionando. Pedidos na v3 com o mesmo fluxo de aprovar, separar e
   entregar.
6. **Treinamento**, como o plano pede a cada marco: a coordenação nos
   Relatórios e na entrega do WMS, e o cliente com a Operação no Minhas OS e
   no comprovante.

## 6. Ligar o Financeiro no `dute-prod` (parte 4.9b, com o OK)

Um PR pequeno, depois da conferência da seção 5:

1. Pôr `dute-prod` nas duas listas `FINANCEIRO_AMBIENTES_LIBERADOS`, em
   `artifacts/app/src/lib/liberacao.ts` e em
   `functions/financeiro/src/domain/liberacao.ts`, e na cópia
   `FINANCEIRO_PROJECTS` de `functions/wms/src/domain/billing-scope.ts`.
   Com ela, o WMS deixa de marcar o pagamento da armazenagem: a competência
   emitida se fatura e se recebe no Financeiro (Fase 7, parte 7.2c).
   `platform-lists.test.ts` trava as três iguais.
2. Atualizar os testes que esperam a recusa na produção:
   - `functions/financeiro/src/domain/liberacao.test.ts`;
   - `functions/financeiro/src/domain/profile.integration.test.ts`;
   - os do app que leem a liberação.
3. Publicar e conferir:
   - `/financeiro` abre para owner, admin e financeiro, e o card leva a ele;
   - `registerNf` e `advanceFatura` respondem;
   - o primeiro registro de NF dá o aviso "NF emitida" a quem lê valor.
4. A NFS-e pela Omie fica de fora: `OMIE_AMBIENTES_LIBERADOS` continua só
   com o `dute-homolog`, e a NF de produção segue registrada à mão
   ("Emitida fora"). Ligá-la no `dute-prod` é outro PR, depois do teste na
   Omie de homologação, com as chaves de produção no Secret Manager, os
   serviços cadastrados pelo contador e o OK do Leonardo
   (`fase-7-financeiro-unificado.md`, "A NFS-e pela Omie").

## 7. Como desligar

- **O Financeiro.** Tirar `dute-prod` das três listas e publicar de novo.
  As telas somem, as callables recusam, e o que foi gravado continua no
  banco.
- **Só os avisos:**

  ```powershell
  cd C:\DEV\Dute
  gcloud scheduler jobs pause firebase-schedule-runNotifications-southamerica-east1 --project dute-prod --location southamerica-east1
  ```

  Ao religar (`resume`), a rotina continua do cursor, sem repetir aviso.
- **O envio de e-mail**, quando ligado: tirar o segredo da `runNotifications`
  num PR. Os e-mails voltam a ficar auditados.
- **A NFS-e pela Omie**, quando ligada: tirar o projeto das duas listas
  `OMIE_AMBIENTES_LIBERADOS` (app e `functions/financeiro`) e publicar. A
  tela Emissões some, as callables recusam, e a rotina para; as emissões e
  as baixas em andamento ficam como estão, e a NF volta a sair à mão.
- **Uma tela do WMS na v3.** Tirar o caminho de `TELAS_DO_WMS_NA_V3`
  (`artifacts/app/src/lib/wms-v3.ts`) e publicar. A tela volta ao visual de
  antes; o shell continua o v3.
- **Tudo da Operação**, como em `operacao-producao.md`, seção 6. Os avisos
  param junto.

## 8. O que espera o Leonardo

- O OK para a publicação, que leva os marcos 2, 3 e 4. De preferência
  antes de 01/11, por causa do uso de outubro no faturamento do WMS
  (seção 2, "O faturamento do WMS no mês sem foto").
- O OK para ligar o Financeiro no `dute-prod` (parte 4.9b).
- A conta no Resend, o domínio verificado na Hostinger e a chave, para o
  e-mail sair (`fase-4-financeiro.md`, parte 4.6a).
- Os serviços `DUTE-OS` e `DUTE-ARMAZENAGEM` no aplicativo de teste da Omie,
  para a NFS-e sair pela Omie na homologação: as chaves dele estão no
  `dute-homolog` desde 24/10/2026 (`fase-7-financeiro-unificado.md`, "Onde
  a Fase 7 está"). A conta corrente e a categoria das OS podem esperar o
  contador. As chaves da empresa real vão para o `dute-prod` só antes de a
  Omie ser liberada lá, com a conta do CI administrando cada segredo
  (`docs/deploy-functions-manual.md`, "Function com segredo").
- A entrega do WMS fatura pela demanda ou na fatura mensal do WMS?
  (`fase-4-financeiro.md`, decisões).
- A receita por serviço (pergunta 26 do plano).
- As perguntas 12 a 14 da Fase 3, em `operacao-producao.md`, seção 7.
- As perguntas 58 a 60 do plano (seção 13, "Revisão de defeitos"): a
  vistoria iniciada sem saída, o pedido aprovado que não se cancela nem se
  separa a menos, e a data de emissão da fatura da NFS-e da Omie.
- As perguntas 61 a 63 do plano, do RH, antes de ligá-lo na produção: o
  vigente no empate da emissão, o admissional que fica vigente depois do
  periódico e a planilha de colaboradores do mês exportado.
- A pergunta 64 do plano, antes do primeiro contrato com medição mensal: a
  medição aprovada não tem como entrar numa NF pelo que não é de demanda.
