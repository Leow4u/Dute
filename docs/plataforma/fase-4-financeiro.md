# Fase 4: financeiro da operação, portal e lançamento

Desenho e registro da Fase 4 do plano de implantação
(`plano-de-implantacao.md`, seção 7). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Faturar a demanda executada e registrar o recebimento.
- Mostrar as OS e as faturas ao cliente no portal.
- Avisar por sino e por e-mail.
- Lançar a Operação com a v3 em todo o app.

## Decisões

Seguem a recomendação do plano até a resposta do Leonardo:

| Pergunta | Recomendação seguida |
|---|---|
| 15 | A NF é emitida fora do sistema, que só a registra. |
| 16 | O pedido do portal cai em Para planejar e vira demanda pela coordenação, com o canal portal. O contato é o login de quem pediu. |
| 17 | Os e-mails seguem as preferências do perfil do cliente. |
| 18 | O WMS vai para a v3 começando por Início, Pedidos, Estoque e Receber. |

- **A unidade é a demanda.**
  - Uma NF fecha uma ou mais demandas do mesmo cliente, todas A faturar.
  - Quem fatura é owner, admin ou financeiro (`FINANCEIRO_ROLES`, a mesma lista do Faturamento do WMS).
- **O valor sai do servidor, nunca do pedido.** É o total da RV validada pelo cliente, a mesma que as autorizações citam.
  - O orçamento aprovado com os aditivos ou a RV de execução.
  - Na medição mensal, é a soma das linhas da demanda na medição aprovada. A autorização da medição só guarda o total do mês.
  - A autorização que cita outra RV da demanda recusa.
- **A autorização.**
  - A demanda cujo contrato pede autorização (pedido e aceite, portal ou medição aprovada) só fatura com a autorização registrada, do mesmo cliente.
  - A demanda sem essa exigência fatura sem autorização: a validação do cliente é o registro.
  - A NF marca a autorização como usada (`nf_ids`, reservado desde a parte 15 do Comercial). A partir daí o Comercial não a cancela.
- **As etapas "faturada" e "paga".**
  - Entram em `ETAPAS_DEMANDA`, e só o Financeiro leva a demanda a elas: a NF registrada faz a faturada, a NF quitada faz a paga.
  - Elas não se perdem (`ETAPAS_QUE_PERDEM`) nem recebem autorização ou complemento.
  - Saem da fila do Comercial. A Operação as mostra como "Faturada" e "Paga".
- **A cobrança.**
  - A NF registrada é enviada ao cliente e recebe pagamentos, parciais ou o total. O pagamento não passa do saldo.
  - Vencida não é status gravado: é a NF com saldo e vencimento antes de hoje.
  - O pagamento lançado errado se estorna. A NF paga volta a enviada (ou emitida) e as demandas, a faturadas.
  - O registro errado, sem pagamento, se cancela. As demandas voltam a A faturar, a autorização perde a NF e a mesma NF pode ser registrada de novo.
- **A solicitação do portal (parte 4.4).**
  - O cliente pede pelo portal e a solicitação fica em `service_requests`, recebida, em Para planejar da Operação. Ela nunca abre demanda nem OS sozinha.
  - Quem coordena abre a demanda direta a partir dela, no mesmo formulário do pedido por telefone, com o escopo do catálogo. Ou recusa com o motivo, que o cliente lê.
  - A demanda nasce `entrada: direta`, `canal: portal`, com `solicitacao_id`. O plano dizia "demanda `portal`". O ciclo é o da direta (executa e o Comercial orça depois), então o Comercial e a Operação não mudam, e o pedido errado ou repetido não vira demanda para cancelar no Comercial.
  - O instante em que a demanda foi recebida é o da solicitação. Quem pediu é o login do cliente, quando a coordenação não diz outro.
- **A entrega do pedido de saída pela Dutelog (parte 4.5).**
  - O WMS define a entrega no pedido. A Operação abre a demanda direta dela, com o canal `wms` e o pedido (`pedido_wms`), e as OS: a ida, agendada para a entrega, e, com o retorno ao armazém, a volta. A retirada pelo cliente não gera demanda nem OS.
  - O plano dizia `entrada: armazenagem`. Seguimos a direta com o canal `wms`, como na solicitação do portal: o ciclo é o mesmo (executa, a Operação revisa, o Comercial orça a execução).
  - **Pergunta ao Leonardo.** A entrega do WMS fatura pela demanda (orçada depois da execução, como a direta), ou na fatura mensal do WMS (o grupo "Abastecimento / Transporte")? Seguimos a demanda até a resposta. A BTG hoje fatura o transporte na fatura do WMS, então cuidado para não cobrar duas vezes.
- **A armazenagem** continua na fatura do WMS (`billing_periods` e `client_invoices`) até a Fase 7.
- **Os relatórios do Financeiro (parte 4.8b).** A receita é por cliente, pelos pagamentos. O mockup tinha também a receita por serviço, mas a NF registrada guarda só o total e as demandas, sem o valor de cada serviço.
  - **Pergunta ao Leonardo.** A receita por serviço vale o rateio da NF pelas linhas do orçamento de cada demanda? Seguimos sem ela, com as NFs emitidas por mês no lugar, até a resposta (pergunta 26 do plano).
- **Omie** continua fora.

## Dados

| Coleção | Dono | O que guarda |
|---|---|---|
| `faturas` | Financeiro | A NF registrada. Guarda as demandas, cada uma com a RV ou a medição, as autorizações citadas e o valor em centavos, e o total. Também a NF (número, série, emissão), `nf_chave` (série e número), o vencimento, a forma de pagamento, a observação, o status (emitida, enviada, paga ou cancelada) e quem registrou. A cobrança (parte 4.2a) acrescenta `recebido_cents`, `pagamento_ids`, `enviada` (dia e meio), `paga_em`, `cancelada` (quando, quem e o motivo) e `anteriores` (os registros cancelados da mesma NF). O id sai da série e do número da NF, então a mesma NF não fica registrada duas vezes. |
| `pagamentos` | Financeiro | Um pagamento da fatura: o valor em centavos, o dia, a forma, a observação, o status (registrado ou estornado, com o motivo) e quem registrou. |
| `client_faturas` | Financeiro | A NF como o cliente vê no portal (parte 4.3a): a NF, o vencimento, a forma, o valor, o recebido, o saldo, a situação, o envio e as demandas com o valor, o título e a referência. Não guarda quem registrou, a observação, as autorizações, os registros anteriores nem o motivo do cancelamento. Cada gravação do Financeiro a regrava na mesma transação, e o cancelamento a apaga. |
| `financeiro_operations` | Financeiro | O recibo de idempotência. Ninguém lê. |
| `demands` | Comercial | O Financeiro escreve `etapa: "faturada"`, `etapa_desde`, o marco em `marcos` e `faturamento`: a fatura, a NF e o vencimento, sem valor. |
| `client_authorizations` | Comercial | O Financeiro escreve só `nf_ids`. |
| `orders` | WMS | O pedido de saída ganha `entrega` (parte 4.5a). Pela Dutelog guarda o destino, a data e a hora, o contato, a montagem e o retorno ao armazém. Na retirada pelo cliente guarda a data e a hora, quem retira, o documento e a placa. Também guarda quem definiu e quando, e `demanda` e `os_numeros`, que a Operação grava ao abrir a demanda (parte 4.5b). E `retorno` (parte 4.5d): a OS de volta concluída grava a OS, a demanda, quando chegou e o status a receber. O WMS recebe e grava recebido, a devolução, quando e quem. |
| `service_requests` | Operação | A solicitação de OS pelo portal (parte 4.4a). Guarda o tipo de serviço (transporte, armazenagem, serviço em campo ou mudança), a data e o horário pedidos, a origem, o destino e o que será feito, os anexos (o caminho no Storage, o nome, o tipo e o tamanho) e o contato (o login de quem pediu). Também o status (recebida, aceita ou recusada), a demanda aberta com ela e a recusa com o motivo. Sem preço. |

Preço só em `faturas`, `pagamentos` e `client_faturas`, lidos por
`canReadPrices()`: owner, admin, financeiro e comercial. A operação, o campo,
o suporte e o painel não leem. O cliente dono lê só `client_faturas`, e só
com as faturas no contrato (`isOwnProjectionWith('financeiro')`). Nada se grava
pelo navegador. A zeragem do WMS nunca apaga `faturas`, `pagamentos`,
`client_faturas`, `financeiro_operations` nem os eventos do Financeiro.

`service_requests` é lida por quem coordena a Operação e pelo suporte
(`canReadServiceOrders()`) e pelo cliente dono, com a Operação no contrato
(`isOwnProjectionWith('operacao')`). O anexo sobe para
`portal/{customer_code}/solicitacoes/an_<16 hex>.<pdf|jpg|png|webp>` no
Storage: só o cliente dono com a Operação no contrato, até 10 MB, sem
sobrescrever. Quem coordena, o suporte e o cliente dono leem. A zeragem do
WMS nunca apaga `service_requests`, que fica com a Operação.

## Callables

Ficam em `functions/financeiro` (codebase `financeiro`), cada uma numa linha
e começando por `requireFinanceiroCaller`:

- `registerNf` (parte 4.1a).
- `advanceFatura` (parte 4.2a), com quatro ações:
  - `send`: o dia e o meio do envio (e-mail, portal do cliente, correio ou em mãos);
  - `pay`: o valor, o dia e a forma;
  - `reverse_payment`: o pagamento e o motivo;
  - `cancel`: o motivo.

A entrega do pedido de saída (parte 4.5a) fica no WMS (`functions/wms`):

- `receiveOrderReturn` (parte 4.5d): owner, admin, interno e wms recebem o retorno a receber do pedido, uma vez. O que voltou vira a devolução do pedido (`returns`, com a chave do pedido), que segue para a disposição física.
- `setOrderDelivery`: owner, admin, interno e wms definem a entrega pela Dutelog ou a retirada pelo cliente. Só antes da saída (o pedido expedido, entregue ou cancelado recusa) e enquanto a Operação não abriu a demanda. Repetir a mesma escolha não grava de novo.

A solicitação do portal (parte 4.4a) fica em `functions/operacao`:

- `requestService`: a única callable que atende o cliente (`{ portal: true }`). Pede o papel cliente, o código no perfil e a Operação no contrato (`client_access`). Confere os anexos no Storage e grava a solicitação recebida.
- `declineServiceRequest`: quem coordena recusa a solicitação recebida, com o motivo.
- `openStorageDemand` (parte 4.5b): quem coordena e a operação do armazém (`{ wms: true }`, a única callable da Operação que atende o wms) abrem a demanda e as OS da entrega pela Dutelog de um pedido de saída. A entrega é lida do pedido, nunca do navegador. A retirada pelo cliente recusa: "A retirada pelo cliente não gera OS."
- `openDirectDemand` ganha `solicitacao_id`. A mesma transação confere a solicitação recebida e do mesmo cliente e a marca como aceita com o número da demanda.

## Eventos

O `source` é `functions_financeiro`, a severidade é `info` e o evento é da
fatura (`entity_type: fatura`), com o `customer_code`.

- `nf.registered`: a fatura, as demandas, quantas autorizações, a emissão, o vencimento e a forma.
- `nf.sent`: a fatura, o dia e o meio do envio.
- `nf.cancelled`: a fatura e as demandas que voltaram a A faturar.
- `cobranca.payment_registered`: a fatura, o pagamento, o dia, a forma e se quitou.
- `cobranca.payment_reversed`: a fatura, o pagamento e se reabriu a NF paga.
- Nenhum evento leva o valor, o número da NF ou o motivo, que é texto livre.
- O financeiro lê os `nf.*` e os `cobranca.*`, como lê os `billing.*` do WMS.

O retorno recebido grava no WMS `expedicao.return_linked` (`source:
functions_order_return`): o pedido, a devolução, a OS e quantas linhas. Na
Operação, a conclusão da volta grava `os.warehouse_return_due`: a OS, a
demanda, quando chegou e o pedido.

A entrega do pedido grava no WMS `expedicao.delivery_set` (`source:
functions_order_delivery`, `entity_type: pedido`): o pedido, o modo, o dia, a
montagem e se tem retorno. O destino, o contato, quem retira, o documento e a
placa ficam só no pedido. O tipo não tem as palavras do roteador de avisos.

A solicitação do portal grava eventos da Operação (`source: functions_operacao`,
`entity_type: service_request`), com o `customer_code`:

- `demand.storage_opened` (parte 4.5b): a demanda da entrega do WMS, o tipo, quantas linhas e OS e se tem o retorno. Cada OS grava o seu `os.planned`.
- `portal.service_requested`: a solicitação, o tipo de serviço, o dia e quantos anexos. É o único evento da Operação gravado pelo cliente.
- `portal.service_accepted`: a solicitação e a demanda aberta com ela.
- `portal.service_declined`: a solicitação.
- Os locais, o que será feito, o nome dos anexos e o motivo da recusa são texto livre e ficam só na solicitação.

## Telas

O shell v3 do Financeiro fica em `/financeiro`, para owner, admin e
financeiro (`FINANCE_ROLES`, a mesma lista das callables). O menu tem:

- **Início** (`/financeiro`): o "Precisa de você" e a fila em números.
  - As prontas viram "N demandas a faturar", com os clientes e o total. Ficam críticas depois de 15 dias A faturar (`DIAS_PARA_FATURAR`).
  - As NFs vencidas são o item crítico, com os clientes e o saldo. As NFs a vencer ainda não enviadas pedem o envio.
  - As que esperam a autorização e as sem valor viram itens de informação.
  - Ao lado, a fila A faturar e o A receber em números: o total, a vencer, vencidas e para enviar.
  - O mesmo cálculo dá os contadores do menu e o card da entrada.
- **A faturar** (`/financeiro/a-faturar`): as prontas por cliente, as que esperam e o painel de registrar a NF.
- **A receber, Vencidos, Pagos e Faturas** (`/financeiro/a-receber`, `vencidos`, `pagos` e `faturas`): a mesma lista em quatro recortes e o painel da NF aberta (`?nf=`).
  - A receber e Vencidos vêm pelo vencimento e somam o saldo. Pagos vêm pelo pagamento mais recente. Faturas mostra todas, inclusive as canceladas, pela emissão.
  - O painel mostra o valor, o recebido e o saldo, as datas, as demandas, o envio e os pagamentos.
  - Dali a pessoa marca a NF como enviada, registra o pagamento (começa pelo saldo), estorna um pagamento e cancela o registro sem pagamento.
  - O estorno e o cancelamento pedem o motivo antes de confirmar.
  - Toda lista exporta para XLSX ("Exportar XLSX"), com a busca aplicada.
  - Em Pagos, sem NF aberta, o lado direito mostra a receita por cliente do mês escolhido.
- **Via comercial** (`/financeiro/nf?nf=`, aberta pelo painel da NF): o demonstrativo que acompanha a NF, para imprimir ou salvar em PDF.
- **Armazenagem**: leva ao Faturamento do WMS (`/faturamento`), que continua no shell do WMS até a Fase 7.

O financeiro tem um módulo só e por isso não tem seletor. No menu do WMS, logo
antes do Faturamento, o item "Financeiro" leva de volta. Owner e admin trocam
pelo seletor.

## Liberação

`FINANCEIRO_AMBIENTES_LIBERADOS = ["dute-homolog"]`, no app
(`lib/liberacao.ts`) e nas callables, travada por `platform-lists.test.ts`. O
`dute-prod` entra no lançamento (parte 4.9b), com o OK do Leonardo, pelo
roteiro em `lancamento-producao.md`.

Fora da liberação, nada muda: o card do Financeiro e a casa do financeiro
continuam no Faturamento do WMS, e as rotas `/financeiro` não existem
(`soComFinanceiroLiberado`).

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 4.1a | Codebase `functions/financeiro`, `registerNf`, `faturas`, a demanda Faturada, `nf.registered`, regras e zeragem | Sem autorização não fatura; o valor é o da RV validada e autorizada (ou da medição); a operação não lê `faturas` |
| 4.1b | Shell do Financeiro (v3) em `/financeiro`: Início e A faturar, com o painel de registrar a NF | Textos listados; sem legenda; uma ação principal; `axe` |
| 4.2a | `advanceFatura` (enviar, pagar, estornar, cancelar), `pagamentos`, a demanda Paga, `cobranca.*`, regras e zeragem | Pagamento parcial; não passa do saldo; com pagamento não cancela |
| 4.2b | Telas A receber, Vencidos, Pagos e Faturas, com o painel da NF | Vencido pelo vencimento; sem legenda; `axe` |
| 4.2c | Receita por cliente no mês (Pagos) e a exportação XLSX de cada lista | O estorno fica fora da receita; a planilha abre com reais e datas de verdade |
| 4.2d | Via comercial da NF em PDF (impressão do navegador) | Só quem lê preço abre; os valores batem com a fatura |
| 4.3a | A NF do portal (`client_faturas`), gravada com cada mudança da fatura; regras e zeragem | O cliente só lê as próprias NFs, com as faturas no contrato; nada interno vai para o portal |
| 4.3b | Portal: as OS do cliente (andamento com etapas) e as NFs da demanda em Faturas | Cliente só vê as próprias OS e faturas; cliente sem `operacao` não vê OS |
| 4.3c | As fotos do final na conclusão da OS e a leitura do cliente no Storage: a assinatura e essas fotos, da própria OS concluída | O cliente não lê as outras fotos, a OS de outro cliente, a OS aberta nem a vistoria |
| 4.3d | Portal: o comprovante da OS concluída (itens feitos, quem recebeu, a assinatura e as fotos do final), com o PDF; o e-mail da conclusão leva a ele | Textos listados; sem valor; nada interno; `axe` |
| 4.4a | `requestService` e `declineServiceRequest`, `service_requests`, a solicitação em `openDirectDemand`, `portal.*`, regras do Firestore e do Storage e zeragem | O pedido do portal nunca cria OS sozinho; vira demanda uma vez, do mesmo cliente; o cliente sem a Operação não pede |
| 4.4b | Portal: Solicitar OS em Minhas OS (tipo de serviço, data e horário, origem, destino, o que será feito e anexo) e as solicitações com a situação | Textos listados; sem legenda; uma ação principal; `axe` |
| 4.4c | Operação: as solicitações em Para planejar do Hoje e no Início; abrir a demanda com o formulário preenchido ou recusar | A solicitação aparece em Para planejar; a demanda sai com a solicitação |
| 4.5a | WMS: a entrega do pedido de saída (`setOrderDelivery`, `orders.entrega`), pela Dutelog ou retirada pelo cliente, e `expedicao.delivery_set` | A entrega não muda depois da saída nem depois da demanda; o evento não leva texto livre |
| 4.5b | Operação: a entrega pela Dutelog vira demanda e OS (a ida e, com retorno, a volta), com o número de volta no pedido | Retirada pelo cliente não gera OS |
| 4.5c | WMS: a entrega na tela do pedido (`WmsExpedicao`), com a demanda e as OS na Operação e a retirada na saída | Textos listados; `axe` |
| 4.5d | O retorno ao armazém: a OS de volta revisada abre o recebimento do retorno no WMS | O retorno gera recebimento uma vez |
| 4.6a | A rotina dos avisos: os eventos viram o aviso no sino (`client_notifications`) e o e-mail na fila (`email_outbox`), enviado pelo Resend ou só auditado; regras, índice e zeragem | Rodar de novo não duplica; o e-mail só vai a quem ligou o modelo; a NF por e-mail só a quem lê valor; o cliente sem o módulo não recebe |
| 4.6b | Comercial: os avisos que cada contato recebe por e-mail, no cadastro do cliente | A NF não se liga para a gerenciadora; textos listados; `axe` |
| 4.6c | Portal: o sino com os avisos do cliente, marcados como vistos ao abrir | O cliente só vê os próprios; textos listados; `axe` |
| 4.7a | WMS: o shell v3 da Armazenagem (barra preta, seletor, cliente ativo, Estoque como grupo, contadores), com as telas ainda no visual do WMS | Render do shell com o grupo e `axe`; a tela fora da lista não entra no `.v3` |
| 4.7b | WMS na v3: Início | `theme-colors.test.ts`; render e `axe` |
| 4.7c | WMS na v3: Pedidos | `theme-colors.test.ts`; render e `axe` |
| 4.7d | WMS na v3: Estoque | `theme-colors.test.ts`; render e `axe` |
| 4.7e | WMS na v3: Receber | `theme-colors.test.ts`; render e `axe` |
| 4.8a | Operação › Relatórios: OS por período, cliente e tipo, produtividade da equipe, uso dos veículos e solicitações do portal, com Excel e PDF | Nenhum valor; no prazo pela janela; textos listados; `axe` |
| 4.8b | Financeiro › Relatórios: receita por cliente, NFs emitidas por mês e contas a receber, com Excel e PDF | Só quem lê preço abre; o estorno fica fora da receita; `axe` |
| 4.9a | O roteiro do lançamento (`lancamento-producao.md`) e o ciclo do cliente no emulador, do portal ao comprovante e à NF, com os avisos | O aviso de cada passo sai dos eventos gravados pelas callables de verdade |
| 4.9b | Com o OK do Leonardo: o `dute-prod` nas listas do Financeiro, depois da conferência de produção | `platform-lists.test.ts`; a recusa na produção vira o atendimento |

## Registro

### Parte 4.1a: o registro da NF no backend

Feita em 23/10/2026. Regras em `functions/financeiro/src/domain/fatura.ts`; a
gravação em `fatura-gravacao.ts`.

- **A codebase.** `functions/financeiro`, no molde da Operação:
  - liberação, papéis, perfil, idempotência e eventos;
  - entra no `firebase.json`, no CI (`financeiro-unit` e `financeiro-integration`) e na publicação.
- **`registerNf`.** Lê a NF (número, série, emissão, que não pode estar no futuro), o vencimento (depois da emissão), a forma de pagamento (boleto, pix, transferência, cartão ou dinheiro) e a observação. Numa transação:
  - confere cada demanda: A faturar, do mesmo cliente, sem medição pendente e ainda não faturada;
  - confere as autorizações que o contrato pede;
  - lê o valor no servidor;
  - grava a fatura emitida, leva as demandas a Faturada, marca as autorizações e grava o evento.
  - Repetir não duplica. A mesma NF com outra chave recusa.
- **Comercial.**
  - "faturada" entra em `ETAPAS_DEMANDA`, com o rótulo.
  - O teste trava que ela não se perde nem recebe autorização.
  - No app, a etapa ganha rótulo e cor no Comercial e na Operação.
- **Regras.** `faturas` só para quem lê preço, e nada se grava pelo navegador. O financeiro lê os eventos `nf.*`. O teste de regras é `functions/wms/src/financeiro-faturas.rules.test.ts`.
- **Zeragem.** `tools/full_reset_btg.py` preserva `faturas`, `financeiro_operations` e os eventos `functions_financeiro`.

### Parte 4.1b: o shell do Financeiro, o Início e A faturar

Feita em 23/10/2026. Regras da fila em `artifacts/app/src/lib/financeiro/a-faturar.ts`;
as leituras em `use-a-faturar.ts`; as telas em `artifacts/app/src/pages/financeiro/`.

- **A fila.** Lê ao vivo as demandas A faturar e Aguardando autorização. Lê pelo id cada autorização que elas citam e lê o valor de cada uma: a RV validada ou a medição aprovada.
- **Pronta para faturar.** A tela confere o mesmo que `registerNf`, na mesma ordem: etapa, medição pendente, autorização registrada do mesmo cliente, RV citada e valor.
  - A que não passa fica em "Esperando", com o motivo.
  - O servidor confere tudo de novo e calcula o valor.
- **O painel da NF.**
  - Uma NF é de um cliente só. Marcada a primeira demanda, só as prontas do mesmo cliente ganham caixa.
  - Os campos são número, série, emissão (até hoje), vencimento, forma de pagamento e observação.
  - O vencimento segue a regra de pagamento do contrato até a pessoa mexer nele.
  - O pedido leva as demandas e a NF, nunca o valor. Leva a chave de idempotência, nova a cada registro.
- **O Início e a entrada.** Os itens saem da mesma fila. O card do Financeiro na entrada conta só onde leva ao shell novo.
- **Navegação.** O card do Financeiro e a casa do financeiro (`getHomePathForProfile`) levam a `/financeiro` com a liberação.
- **Testes.** A regra da fila e do formulário está em `a-faturar.test.ts`, e a navegação em `navegacao.test.ts` e `ambientes.test.ts`. As telas estão em `inicio-view.test.tsx` e `a-faturar-view.test.tsx`: textos listados, sem legenda, uma ação principal e `axe`.

### Parte 4.2a: a cobrança no backend

Feita em 23/10/2026. As regras estão em `functions/financeiro/src/domain/cobranca.ts` e
a gravação em `cobranca-gravacao.ts`.

- **`advanceFatura`.** Cada ação é uma transação com recibo de idempotência e o evento sem valor.
  - `send`: só a NF emitida, uma vez, num dia entre a emissão e hoje.
  - `pay`: grava `pagamentos/{id}` e soma em `recebido_cents`. O pagamento não passa do saldo, não é zero e cai entre a emissão e hoje. Quitada, a NF fica paga com `paga_em` e as demandas ficam pagas, com o marco.
  - `reverse_payment`: o pagamento fica estornado, com o motivo, e sai do recebido. A NF paga volta a enviada (ou emitida) e as demandas, a faturadas.
  - `cancel`: só sem pagamento. A NF fica cancelada, as demandas voltam a A faturar sem o `faturamento` e as autorizações perdem a NF.
- **De novo a mesma NF.** `registerNf` aceita a NF cujo registro foi cancelado e guarda o registro anterior em `anteriores`.
- **Comercial e app.** "paga" entra em `ETAPAS_DEMANDA`, com rótulo e cor no Comercial e na Operação. O teste trava que ela não se perde nem recebe autorização.
- **Regras.** `pagamentos` só para quem lê preço, e nada se grava pelo navegador. O financeiro lê os `cobranca.*`.
- **Zeragem.** `tools/full_reset_btg.py` preserva `pagamentos`.

### Parte 4.2b: A receber, Vencidos, Pagos e Faturas

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/financeiro/faturas.ts`, as
leituras em `use-faturas.ts` e a tela em `artifacts/app/src/pages/financeiro/faturas-view.tsx`.

- **Vencida** é calculada: a NF com saldo e vencimento antes de hoje. No dia do vencimento ela ainda vence hoje.
- **O pagamento parcial** deixa o saldo na lista ("de R$ 14.845,00") e no painel. O formulário começa pelo saldo, hoje e a forma da NF.
- **Os pedidos** para `advanceFatura` levam a ação, a chave e o que a pessoa informou, nunca o saldo nem o status. A tela confere o mesmo que o servidor (saldo e datas) para avisar antes.
- **O Início** ganha as NFs vencidas (crítico) e as NFs para enviar, e o card A receber. O mais urgente vem primeiro (`lib/financeiro/inicio.ts`).
- **Testes.**
  - `faturas.test.ts`: vencida pelo vencimento, pagamento parcial, listas, totais, formulários e pedidos.
  - `faturas-view.test.tsx`: textos listados, sem legenda, uma ação principal (Registrar pagamento, só com saldo) e `axe`.
  - `inicio-view.test.tsx`: a ordem e o card A receber.

### Parte 4.2c: receita por cliente e XLSX

Feita em 23/10/2026.

- **A receita por cliente** soma os pagamentos registrados no mês por cliente (`usePagamentosDoMes`, pelo dia do pagamento). O estorno fica fora.
  - Mostra os maiores primeiro. Os demais viram "Outros N clientes" quando são dois ou mais.
  - Mostra o total recebido no mês e quantos pagamentos.
- **O XLSX** sai da lista na tela, com a busca: NF, série, cliente, emissão, vencimento, situação, valor, recebido, saldo, paga em, forma, enviada em e demandas.
  - A planilha é gerada no navegador, sem dependência (`artifacts/app/src/lib/planilha-xlsx.ts`). É um zip sem compressão com uma aba e o cabeçalho em negrito e congelado.
  - Os reais saem com duas casas e as datas como data de verdade (dd/mm/aaaa).
  - Conferida no openpyxl, que leu as datas como datas e o formato de moeda.
- **Testes.** `planilha-xlsx.test.ts` lê o zip pelo diretório central e confere o CRC com o zlib do Node, o escape e os formatos. `faturas.test.ts` cobre as linhas da planilha, o mês e a receita. `faturas-view.test.tsx` cobre o bloco da receita e o botão de exportar.

### Parte 4.2d: a via comercial da NF

Feita em 23/10/2026. O demonstrativo sai de `artifacts/app/src/lib/financeiro/nf-documento.ts`,
o papel de `components/financeiro/nf-documento.tsx` e a tela de `pages/financeiro/nf-view.tsx`.

- **O papel** mostra o cabeçalho da Dutelog, a NF e o cliente, e a cobrança (emissão, vencimento e forma).
  - Cada demanda vem com o título e a referência do cliente como a RV foi enviada, e com a autorização (pedido e aceite).
  - As linhas da RV congelada aparecem com unidade, quantidade, valor unitário e total. Na medição mensal, aparecem as linhas da demanda na medição aprovada.
  - O papel termina no total da demanda e no total da NF.
  - O valor de cada demanda e o total são os da fatura, calculados pelo servidor. As linhas só mostram de onde eles saíram.
- **A tela** tem uma ação principal, Imprimir, que usa a impressão do navegador (Salvar como PDF), como a OS e o orçamento. Só o papel sai na impressão. O nome sugerido para o PDF é "NF 1234 - Cliente".
- **Acesso.** A rota é só de owner, admin e financeiro, e acende Faturas no menu. As leituras (`faturas`, `quotes`, `medicoes`, `client_authorizations`, `demands`) seguem as regras de quem lê preço.
- **Testes.**
  - `nf-documento.test.ts`: os valores batem com a fatura, as linhas da RV e da medição, e o caso em que as linhas não chegaram.
  - `nf-view.test.tsx`: textos listados, uma ação principal e `axe`.

### Parte 4.3a: a NF do portal

Feita em 23/10/2026. A projeção está em `functions/financeiro/src/domain/projecao.ts`.

- **`client_faturas/{id}`** nasce no registro da NF, com o título e a referência de cada demanda lidos na mesma transação.
  - Cada ação da cobrança a regrava a partir da fatura como ela fica: envio, pagamento parcial, quitação e estorno.
  - O cancelamento a apaga. O registro cancelado era um erro e não aparece para o cliente. A NF registrada de novo volta ao portal.
- **Regras.** Leem quem lê preço e o cliente dono, este com as faturas no contrato. O cliente nunca lê `faturas` nem `pagamentos`.
- **Testes.** `projecao.test.ts` confere o que vai e o que fica de fora. `cobranca.integration.test.ts` segue a projeção no registro, no pagamento, na quitação, no envio, no cancelamento e no novo registro. `financeiro-faturas.rules.test.ts` cobre o cliente dono, o de outro cliente, o sem o módulo, a operação e a escrita.

### Parte 4.3b: as OS e as NFs dos serviços no portal

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/portal/servicos.ts`; as telas em
`pages/client/servicos-view.tsx` e `components/portal/nfs-dos-servicos.tsx`.

- **Minhas OS** (`/portal/servicos`) é uma tela nova do portal (`services`) que depende da Operação no contrato. A barreira por módulo do portal e as regras (`isOwnProjectionWith('operacao')`) já valiam desde a parte 2.7.
  - Os números: em execução, agendadas, concluídas e, com as faturas no contrato, o que falta pagar.
  - A lista vem em andamento primeiro e as concluídas da mais recente. Cada OS traz a situação e a NF da demanda dela ("NF 1234 · Vence em 7 dias").
  - O painel da OS aberta (`?os=`) mostra o andamento em quatro marcos: pedido recebido, agendada, em execução (com a última etapa e a hora) e concluída. Mostra também a data, os locais, o motorista e a placa, quem recebeu e o faturamento.
  - A revisão é interna: para o cliente, a OS em revisão ou revisada está concluída. Ficam de fora as ocorrências, a revisão, a equipe além do motorista, os itens previstos e as fotos.
- **Faturas** ganha as NFs dos serviços (`client_faturas`), antes da fatura mensal da armazenagem.
  - As abertas vêm pelo vencimento, depois as pagas. Cada NF traz as demandas com o título e o valor, o saldo do pagamento parcial e a situação.
  - A situação usa a mesma régua das telas internas: vence hoje, vencida há N dias, paga em.
- **Testes.** `portal/servicos.test.ts` cobre a situação, o andamento, o que fica de fora, a ordem e as NFs. `servicos-view.test.tsx` cobre os textos listados, nada interno, sem ação principal e o `axe`, nas duas telas. `operations.test.ts` e `modules.test.ts` cobrem a tela no contrato e no menu.

### Parte 4.3c: as fotos do final e a assinatura para o cliente

Feita em 23/10/2026, na preparação do lançamento (parte 4.9). O plano pede o
andamento "com comprovantes e PDF" no portal e o PDF ao cliente na conclusão.
A parte 4.3b deixou as fotos de fora. Esta parte abre ao cliente o que vai ao
comprovante; a tela entra na 4.3d.

- **A conclusão lista as fotos do final.** `completeServiceOrder` grava em `conclusao.arquivos_do_final` os arquivos das fotos da etapa Fim (`functions/operacao/src/domain/conclusao.ts`).
  - O evento continua só com a contagem (`fotos_do_final`).
  - A OS concluída antes desta parte fica sem a lista, e o comprovante dela sai sem as fotos.
- **O Storage abre ao cliente** a assinatura e essas fotos, da OS do próprio cliente, em revisão ou revisada (`storage.rules`).
  - As fotos das ocorrências e das outras etapas ficam internas, e a vistoria também.
  - A OS reaberta ou cancelada fecha de novo.
  - A fronteira é o `customer_code` da OS. O Storage lê no máximo dois documentos do Firestore por avaliação: o perfil e a OS. O módulo da Operação no contrato já vale na leitura da OS pelo `firestore.rules`, de onde o portal tira o nome dos arquivos.
- **Testes.**
  - `conclusao.test.ts` e `conclusao.integration.test.ts` cobrem a lista, só com as fotos do final.
  - `operacao-fotos.rules.test.ts` cobre o cliente da OS concluída, as outras fotos, o outro cliente, a OS aberta, reaberta ou cancelada, a conclusão sem aceite e a vistoria.

### Parte 4.3d: o comprovante da OS no portal

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/portal/comprovante.ts`; o papel em
`components/portal/comprovante-documento.tsx` e a tela em `pages/client/comprovante-view.tsx`. A rota é
`/portal/servicos/comprovante?os=`, do cliente, dentro de Minhas OS (o mesmo módulo no contrato).

- **O comprovante.** Para a OS de serviço concluída (em revisão ou revisada), no molde da OS impressa:
  - o número, o serviço e quando foi concluída;
  - o cliente e a demanda, a data e a janela, o motorista e a placa, a origem e o destino;
  - os itens com o feito;
  - quem recebeu, com o cargo, o documento e a assinatura, ou "Sem aceite no local";
  - as fotos do final.
- **Fica de fora** o que é interno, como na parte 4.3b: a revisão, as ocorrências, o previsto, a equipe além do motorista e as outras fotos. Sem valor, como toda OS.
- **O PDF.** "Baixar PDF" é a impressão do navegador, só do papel (`.print-area`). É a única ação principal da tela.
- **De onde se abre.** O painel da OS concluída em Minhas OS ganha "Comprovante". O aviso de OS concluída abre o comprovante, e o e-mail diz que ele está no link, com a assinatura e as fotos do final.
- **Testes.**
  - `portal/comprovante.test.ts` cobre o comprovante, sem nada interno nem valor, o sem aceite, a OS sem a lista de fotos e as OS sem comprovante.
  - `comprovante-view.test.tsx` cobre os textos na ordem, as imagens, o que vai ao PDF, a ação principal, os estados e `axe`.
  - `avisos.test.ts` cobre o link e o e-mail da OS concluída; `modules.test.ts`, a rota e o módulo; `theme-colors.test.ts`, o papel.

### Parte 4.4a: a solicitação de OS pelo portal no backend

Feita em 23/10/2026. As regras estão em `functions/operacao/src/domain/solicitacao.ts`, a gravação em
`solicitacao-gravacao.ts` e o atendimento em `demanda-direta-gravacao.ts`.

- **O pedido.** O tipo de serviço, a data e o horário (em São Paulo, nem no passado nem a mais de um ano), a origem, o destino (opcional), o que será feito e até três anexos.
  - O anexo é PDF, JPG, PNG ou WEBP, até 10 MB. Só vale depois de subir: `requestService` confere no Storage o tipo e o tamanho.
  - O caminho do anexo sai do código do perfil, então o cliente não cita arquivo de outro cliente.
- **Quem pede.** Só o papel cliente, com o código no perfil e a Operação no contrato. Sem `client_access` vale o padrão (armazenagem e faturas), que não inclui a Operação. Nenhuma outra callable da Operação atende o cliente.
- **Nunca abre OS sozinho.** A solicitação não usa o contador de demandas nem cria demanda ou OS. A demanda sai só de `openDirectDemand` com a solicitação, uma vez, e a OS só do planejamento.
- **A recusa** pede o motivo (5 a 300 caracteres) e encerra a solicitação. A recusada não vira demanda.
- **Testes.**
  - `solicitacao.test.ts` cobre o pedido, a data, o anexo, a solicitação que vira demanda uma vez, a demanda que chega pelo portal e o evento sem texto livre.
  - `solicitacao.integration.test.ts` cobre a solicitação sem demanda nem OS, o anexo conferido, a demanda com o instante e quem pediu, a OS pelo planejamento, outro cliente e a recusa.
  - `profile.integration.test.ts` cobre o cliente com e sem a Operação no contrato e a equipe recusada.
  - `operacao-solicitacoes.rules.test.ts` cobre a leitura no Firestore e o anexo no Storage.


### Parte 4.4b: Solicitar OS no portal

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/portal/solicitacao.ts`, o envio em
`enviar-solicitacao.ts` e a tela em `pages/client/servicos-view.tsx`.

- **Solicitar OS** é a ação principal de Minhas OS, só com a Operação liberada no ambiente e no contrato.
  - O formulário abre no lugar do painel da OS (no celular, antes da lista), com os campos do desenho: tipo de serviço, data e horário, origem, destino, o que será feito e até três anexos.
  - Começa em transporte, amanhã às 08:00. O que falta aparece no campo depois da primeira tentativa, pela mesma régua da callable.
  - Os anexos sobem ao Storage com nome aleatório antes da chamada. A mesma chave vale até a solicitação sair, então repetir a tentativa não cria outra.
- **Solicitações** aparecem antes das OS. A situação é aguardando a Dutelog, em planejamento (com a demanda) ou não atendida (com o motivo).
  - A atendida sai da lista quando a demanda ganha a primeira OS. A não atendida fica 30 dias.
  - Depois do envio, "Solicitação enviada" avisa em `role="status"`.
- **Testes.**
  - `portal/solicitacao.test.ts` cobre as listas e os limites iguais aos de functions/operacao, o que falta, os anexos, o pedido e as solicitações em aberto.
  - `servicos-view.test.tsx` cobre a única ação principal em cada estado, os textos listados do formulário e das solicitações, o problema no campo, o erro da callable e o `axe`.

### Parte 4.4c: a solicitação do portal na Operação

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/operacao/solicitacoes.ts`, o Hoje em
`lib/operacao/hoje.ts` e `pages/operacao/hoje-view.tsx` e o atendimento em `pages/operacao/demanda-nova(-view).tsx`.

- **Hoje.** As solicitações recebidas abrem Para planejar, antes das demandas, e contam na coluna e no resumo do dia ("1 solicitação do portal").
  - O cartão mostra o tipo que a demanda terá (pela hora do pedido e pela hora pedida) e o selo Portal. Também o cliente, o tipo de serviço com o dia e o horário, os endereços e o texto do cliente, e "Atender".
  - O tipo, o cliente e a busca filtram. Filtrar por entrada ou por pessoa as tira: a solicitação ainda não tem entrada nem equipe.
- **Atender** abre a nova demanda direta (`/operacao/nova-demanda?solicitacao=`) preenchida pela solicitação, uma vez, quando ela chega.
  - Vêm o cliente, o título pelo tipo de serviço, quem pediu e o canal portal. Também quando chegou, executar até a data e o horário pedidos e os endereços em "andar ou sala".
  - O cliente, o canal e o "recebida em" não mudam, porque a callable usa os da solicitação. Os itens, quem coordena inclui do catálogo.
  - Ao lado fica a solicitação do cliente com o contato, o pedido, os endereços, o que será feito e os anexos (links do Storage).
  - "Recusar" pede o motivo (5 a 300 caracteres), que o cliente lê, e volta ao Hoje. A solicitação já atendida leva à demanda e não se recusa.
- **Início.** "N solicitações do portal" entra no "Precisa de você", com "Atender". É crítico quando a data pedida chega em até 24 horas. Uma só leva direto ao formulário.
- **Testes.**
  - `operacao/solicitacoes.test.ts` cobre a leitura, o tipo, o formulário preenchido, o pedido com a solicitação, a resolvida, o motivo, o Hoje com os filtros e o resumo, e o Início.
  - `hoje-view.test.tsx` e `demanda-nova-view.test.tsx` cobrem os textos listados, o contato fora do cartão, os campos travados, a única ação principal, a recusa e o `axe`.
  - `entrada-leituras.test.tsx` cobre a leitura nova do Início.

### Parte 4.5a: a entrega do pedido de saída no WMS

Feita em 23/10/2026. As regras e a gravação estão em `functions/wms/src/domain/order-delivery.ts`.

- **A escolha.** É feita em cada pedido de saída.
  - Pela Dutelog: o destino, a data e a hora, o contato (opcional), a montagem e o retorno ao armazém (a desmontagem e a volta, com a data e a hora).
  - Retirada pelo cliente: a data e a hora, quem retira, o documento e a placa.
- **Quando muda.** Só antes da saída: o pedido expedido, entregue ou cancelado recusa.
  - A data é de hoje em diante, e o retorno vem depois da entrega.
  - Depois que a Operação abre a demanda, a entrega muda na Operação, não no WMS.
  - A mesma escolha repetida não grava nem gera evento.
- **Sem mudar o fluxo de hoje.** O pedido sem `entrega` segue como antes. A saída continua pedindo quem coleta, o motorista e a placa, e a entrega o comprovante.
- **Testes.** `order-delivery.test.ts` cobre os dois modos, o que recusa, quando muda e a mesma escolha lida de volta. `order-delivery.integration.test.ts` cobre a gravação, a troca, a recusa depois da demanda e o pedido que saiu.

### Parte 4.5b: a entrega pela Dutelog vira demanda e OS

Feita em 23/10/2026. As regras estão em `functions/operacao/src/domain/demanda-do-armazem.ts` e a gravação em
`demanda-do-armazem-gravacao.ts`.

- **A demanda.** É uma direta com o canal `wms` e `pedido_wms`, o pedido de saída que ela entrega.
  - O título é "Entrega do pedido PED-0118". Quem pediu é o contato da entrega, e recebida em é quando o WMS definiu a entrega.
  - Executar até é a data e a hora da entrega. O tipo sai da hora, como na direta.
  - Os itens são avulsos e sem preço: a viagem de ida, a montagem quando pedida e, com o retorno, a viagem de volta.
- **As OS.** A ida leva o transporte e a montagem, sai do Armazém Dutelog para o destino, com o contato no destino, e é agendada para a entrega.
  - Com o retorno, a volta faz o caminho contrário, agendada para o retorno, com `retorno_ao_armazem` (o pedido) para a parte 4.5d.
  - Todo o saldo da demanda fica nas OS. A equipe e os veículos, quem coordena escala no Hoje.
- **O pedido** recebe `entrega.demanda` e `entrega.os_numeros`. A partir daí a entrega muda na Operação.
- **Testes.**
  - `demanda-do-armazem.test.ts` cobre a leitura da entrega, a retirada que não gera OS, os itens e a entrada só pelo pedido.
  - `demanda-do-armazem.integration.test.ts` cobre a demanda, as duas OS, o número no pedido, os eventos sem texto livre, o saldo, outra chave, a OS única sem retorno e a retirada sem demanda, OS nem contador.
  - `profile.integration.test.ts` cobre o wms só nesta callable.


### Parte 4.5c: a entrega na tela de Pedidos do WMS

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/warehouse-ops/entrega.ts`, o formulário em
`features/warehouse-ops/order-delivery.tsx` e a tela em `pages/pedidos.tsx`. A tela segue o
`docs/sistema-visual.md` do WMS até a v3 (parte 4.7).

- **Com a Operação liberada**, cada pedido em "Para separar" e "Para entregar" (antes da saída) mostra a entrega em uma linha.
  - Por exemplo: "Entrega pela Dutelog · Qua 28/10 13:00 · montagem · retorno Sex 30/10 18:00 · Demanda 10050 · OS 10050-01 e 10050-02".
  - A ação é "Entrega", "Alterar entrega" ou, com a entrega pela Dutelog salva sem a demanda, "Abrir na Operação".
- **O diálogo** tem a escolha entre a entrega pela Dutelog e a retirada pelo cliente e os campos do desenho de cada uma. O que falta aparece no campo, pela régua de `setOrderDelivery`.
  - A entrega pela Dutelog salva (`/api/orders/{id}/delivery`) e abre a demanda na Operação (`openStorageDemand`), com a mesma chave até sair.
  - A retirada só salva.
- **Na saída** da retirada pelo cliente, quem leva e a placa vêm da entrega.
- **Testes.**
  - `warehouse-ops/entrega.test.ts` cobre os modos iguais aos do WMS, o resumo, a Operação, o formulário, o que falta, o pedido e a saída.
  - `order-delivery.test.tsx` cobre os textos dos dois modos, o problema no campo e o `axe`.
  - `functions-api.test.ts` cobre a rota.

### Parte 4.5d: o retorno ao armazém

Feita em 23/10/2026. A Operação grava o retorno em `functions/operacao/src/domain/conclusao-gravacao.ts`
(com `demanda-do-armazem.ts`). O WMS recebe em `functions/wms/src/domain/order-return.ts`. A tela fica
em `features/warehouse-ops/order-returns.tsx`, em Devoluções.

- **A chegada.** A conclusão da OS de volta (`retorno_ao_armazem`) grava no pedido, na mesma transação, o retorno a receber com a OS, a demanda e quando chegou.
  - O caminhão chegou ao armazém. Não espera a revisão da OS, que é do escritório.
  - O retorno já recebido não volta a ser esperado, nem com a OS reaberta e concluída de novo.
- **O recebimento.** Em Devoluções, os Retornos da Operação do cliente ativo mostram o pedido, a OS e quando chegou, com "Receber retorno".
  - O diálogo traz as linhas do pedido com o que saiu. O armazém diz quantos voltaram de cada (inteiro, até o que saiu, ao menos um).
  - `receiveOrderReturn` cria a devolução do pedido (a mesma `createReturnReceipt`, com a chave do pedido e a referência "PED-0118 · OS 10050-02") e marca o retorno recebido.
  - Segue para a disposição física como as outras devoluções. O retorno se recebe uma vez.
- **Testes.**
  - `conclusao.integration.test.ts` cobre o retorno a receber e o já recebido.
  - `demanda-do-armazem.test.ts` cobre a leitura da volta e a marca.
  - `order-return.test.ts` e `order-return.integration.test.ts` cobrem a devolução do pedido, uma vez, e o pedido sem retorno.
  - `retorno.test.ts` e `order-returns.test.tsx` cobrem a tela.
  - `functions-api.test.ts` cobre a rota.

### Parte 4.6a: a rotina dos avisos

Feita em 23/10/2026. Os modelos estão em `functions/operacao/src/domain/avisos.ts` e a rotina em
`avisos-gravacao.ts`. A function agendada é `runNotifications`, que roda a cada 5 minutos, uma instância de cada vez.

- **Os modelos.** O texto sai de um modelo fixo, nunca da IA. A fonte é o evento que a Operação e o Financeiro já gravam.

  | Modelo | Evento | Texto |
  |---|---|---|
  | OS agendada | `os.scheduled`, ou `os.planned` com a data | os serviços e a janela |
  | OS em execução | `os.started` | os serviços e desde quando |
  | OS concluída | `os.completed` | os serviços e quando terminou; o link abre o comprovante (parte 4.3d) |
  | NF emitida | `nf.registered` | o número, o valor e o vencimento |
  | Solicitação recebida | `portal.service_requested` | o tipo de serviço e o dia pedido |

  - O tipo vale só da codebase que o grava. A vistoria não dá aviso.
  - A OS não leva valor. A NF leva o valor, que o cliente já vê nas próprias faturas.
- **A rotina.** Lê os eventos depois do cursor (`notification_cursors/avisos`, com o instante gravado e o id), em lotes de 200.
  - Só entra o evento gravado há mais de um minuto, para nenhum ficar antes do cursor.
  - Na primeira vez o cursor começa agora: os eventos de antes não viram aviso.
  - O cliente recebe o modelo só com o módulo no contrato: as OS e a solicitação com a Operação, a NF com o Financeiro.
  - Cada evento grava, numa transação, o aviso do sino (`client_notifications/ntf_<evento>`) e o e-mail na fila (`email_outbox/mail_<evento>`). Rodar de novo não duplica.
- **Quem recebe o e-mail.** Os contatos do cliente (`customer_contacts`) ativos, com e-mail e com o modelo em `avisos`, que a parte 4.6b liga no cadastro.
  - A NF vai só ao gestor e ao financeiro do cliente, nunca à gerenciadora.
  - Sem contato com o modelo ligado, só o sino recebe.
- **O envio.** A fila envia 20 por rodada e tenta de novo até 5 vezes, com o erro guardado.
  - Sem `RESEND_API_KEY` no ambiente, o e-mail fica auditado na fila (`audit`) e não sai. É o estado de hoje nos dois ambientes.
  - Com a chave, sai pelo Resend com o id do e-mail como chave de idempotência, de `Dutelog <avisos@dutelog.com.br>`. O link aponta para o app do ambiente.
- **Para ligar o envio** (precisa do Leonardo):
  1. Criar a conta no Resend e verificar o domínio `dutelog.com.br`, com os registros de DNS que ele pede na Hostinger. Os CNAMEs `_acme-challenge_*` não podem sair.
  2. Guardar a chave no Secret Manager de cada projeto: `cd C:\DEV\Dute` e depois `firebase functions:secrets:set RESEND_API_KEY --project dute-homolog`.
  3. Declarar o segredo na `runNotifications` (`secrets: ["RESEND_API_KEY"]`), num PR, e conferir na homologação antes da produção.
- **Regras.** O cliente lê só os próprios avisos. A equipe interna não lê, porque o aviso da NF leva o valor; owner e admin leem. A fila de e-mail é só de owner e admin. O cursor não abre pelo navegador. Ninguém grava pelo navegador.
- **Índice.** `events` por `type` e `created_at`.
- **Zeragem.** `tools/full_reset_btg.py` preserva `client_notifications`, `email_outbox` e `notification_cursors`, como os eventos de que eles saem.
- **Testes.**
  - `avisos.test.ts` cobre o evento que vira aviso, o texto de cada modelo (nenhum da OS com valor), quem recebe e o envio pelo Resend.
  - `avisos.integration.test.ts` cobre a primeira rodada, a repetição sem duplicar, o evento do último minuto, o cliente sem o módulo e a fila.
  - `operacao-avisos.rules.test.ts` cobre as regras.
  - `callables.test.ts` trava a function agendada.

### Parte 4.6b: os avisos de cada contato no cadastro

Feita em 23/10/2026. A régua está em `functions/comercial/src/domain/cadastro.ts` (`saveCustomerContact`). A lista
dos modelos fica em `lib/dominio/src/avisos.ts`, e o diálogo em `artifacts/app/src/pages/comercial/clientes-dialogos.tsx`.

- **No cadastro.** O contato ganha `avisos`: os modelos que ele recebe por e-mail, na ordem da lista e sem repetir.
  - O aviso pede o e-mail. Tirar o e-mail com aviso ligado recusa.
  - A NF emitida leva o valor: só o gestor e o financeiro do cliente a recebem. Virar gerenciadora com a NF ligada recusa.
  - O que não veio continua: mudar só o telefone mantém os avisos.
  - O evento `customer_contact.saved` não leva os avisos nem o e-mail.
- **No diálogo do contato.** "Avisos por e-mail" aparece com o e-mail preenchido, com uma caixa por modelo.
  - A NF só aparece para o gestor e o financeiro do cliente.
  - O que deixou de valer (o e-mail apagado, o papel trocado) sai ao salvar.
  - Na alteração, os avisos vão só quando mudam.
- **Uma lista só.** `MODELOS_DE_AVISO`, o que leva valor e quem lê valor estão em `lib/dominio`. As cópias do Comercial e da Operação são travadas por `platform-lists.test.ts`, junto com os papéis do contato.
- **Testes.**
  - `cadastro.test.ts` e `cadastro.integration.test.ts` (Comercial) cobrem a lista, o e-mail, a NF para quem lê valor e o que continua.
  - `clientes.test.ts` cobre o formulário e o pedido.
  - `clientes-dialogos.test.tsx` cobre o grupo: os rótulos, a NF só para quem lê valor e `axe`.

### Parte 4.6c: o sino do portal

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/portal/avisos.ts`, o sino em
`components/portal/sino.tsx` e a callable em `functions/operacao/src/domain/avisos-gravacao.ts`.

- **O sino.** Para o cliente, onde a Operação está liberada: no pé do menu, ao lado da conta, e no topo do celular.
  - O botão diz quantos avisos são novos ("Avisos: 2 novos") e mostra um ponto.
  - A lista traz os últimos 20 avisos do cliente, ao vivo, com o título, o texto e quando. Cada um leva à tela dele, nunca para fora do portal.
  - O novo é o que chegou depois da última vez que o login abriu o sino. Enquanto o sino fica aberto, os novos continuam marcados.
- **Visto.** Abrir o sino com aviso novo chama `markNotificationsRead`, que grava até quando o login viu (`client_notification_reads/{uid}`).
  - Atende o cliente com o código no perfil, com qualquer módulo, porque o aviso da NF vai a quem tem só as faturas.
  - Não grava evento: não é transição operacional.
  - Se falhar, o ponto volta na próxima abertura.
- **Outra coisa.** Os `operational_notifications` do WMS são os rascunhos do Agent Dute, internos e com aprovação. O sino do cliente é `client_notifications`.
- **O aviso não guarda mais `lida_por`.** O visto é por login, num documento só.
- **Regras.** Cada login lê só o próprio `client_notification_reads`, e ninguém grava pelo navegador.
- **Índice.** `client_notifications` por `customer_code` e `created_at` (decrescente).
- **Zeragem.** `tools/full_reset_btg.py` preserva `client_notification_reads`.
- **Testes.**
  - `avisos.test.ts` (app) cobre o aviso lido, o link só do portal, o novo, o rótulo e o quando.
  - `sino.test.tsx` cobre o botão, a lista, os vazios e `axe`.
  - `profile.integration.test.ts` e `avisos.integration.test.ts` cobrem quem marca e o visto.
  - `operacao-avisos.rules.test.ts` cobre as regras, e `callables.test.ts` trava a callable do sino.

### Parte 4.7a: o shell v3 da Armazenagem

Feita em 23/10/2026. O layout está em `artifacts/app/src/components/layout/wms-layout.tsx`, sobre o
`ShellDoModulo` dos outros módulos. A lista das telas na v3 fica em `artifacts/app/src/lib/wms-v3.ts`.

- **Para a equipe.** Toda rota do WMS abre no shell v3, como o Comercial, a Operação e o Financeiro.
  - Na barra preta ficam o logo, o seletor de módulo, o cliente ativo logo abaixo e as telas do WMS, com a conta no rodapé.
  - O Estoque é um grupo. O nome abre e fecha as telas de dentro (Itens, Receber, Contagem, Mapa, Posições), e o grupo da tela aberta abre sozinho.
  - Cada item tem o contador, tirado do "Precisa de você" do Início do WMS (`useInicioDoWms`). O grupo soma as telas dele.
  - No celular, o cabeçalho preto traz o seletor e a conta, com o cliente ativo numa linha abaixo. A barra de baixo tem três telas e "Mais", como nos outros módulos.
- **Tela a tela.** A barra, o cabeçalho e a barra do celular já são v3. O conteúdo de cada tela só entra no `.v3` quando ela está em `TELAS_DO_WMS_NA_V3`, uma por PR (4.7b a 4.7e e depois as demais). Até lá, cada tela segue o `docs/sistema-visual.md`.
- **O portal** do cliente continua no layout de antes (`app-layout.tsx`), com o sino, até passar para a v3.
- **O que saiu.**
  - O seletor de cliente ativo não explica mais para onde cada tela grava: é só o nome e a troca.
  - O menu da conta não lista mais os módulos no celular, porque o seletor está no cabeçalho.
  - O menu deixou de recolher sozinho no Agent Dute: a barra v3 é mais estreita (248 px) e fica sempre aberta.
  - As variantes claras do seletor de módulo e do cliente ativo saíram.
- **O atalho "/"** para o Agent Dute continua nos dois layouts (`use-atalho-do-agente.ts`).
- **Testes.**
  - `shell-do-modulo.test.tsx` cobre a Armazenagem: o conteúdo fora do `.v3`, o grupo fechado e aberto, a tela marcada, o cliente ativo, o contador do grupo e `axe`.
  - `active-customer-switcher.test.tsx` cobre as variantes v3, a falta de legenda e `axe`.
  - `wms-v3.test.ts` cobre a lista e o caminho.
  - `account-menu.test.tsx` cobre onde a troca de módulo mora.

### Parte 4.7b: o Início da Armazenagem na v3

Feita em 23/10/2026. A tela está em `artifacts/app/src/pages/home-view.tsx`, sobre o `InicioDoModulo` dos
outros módulos. Os itens e o ícone de cada um vêm de `lib/inicio-do-wms.ts`.

- **O mesmo Início dos outros módulos.**
  - A tela traz a data e a saudação, e uma frase diz quantas coisas precisam de você na Armazenagem.
  - O "Precisa de você" sai da mesma lista de antes (`lib/home-inbox.ts`), agora com o ícone de cada item. Só a primeira ação é a principal.
  - Ao lado fica "Hoje no armazém": pedidos para separar, prontos para envio, em rota de entrega, recebimentos em aberto e SKUs em estoque. O financeiro, que não vê o armazém, fica sem a coluna.
  - Nada parado: a frase diz "Nada parado na Armazenagem." e o "Precisa de você" some.
  - A falha diz o que não carregou.
- **Na v3.** `/dashboard` entra em `TELAS_DO_WMS_NA_V3`.
- **Testes.** `home-view.test.tsx` cobre os textos na ordem, só rótulos, a ação principal, o vazio, o carregando, a falha, o financeiro sem a coluna, o ícone e `axe`.

### Parte 4.7c: os Pedidos na v3

Feita em 23/10/2026. A tela é `artifacts/app/src/pages/pedidos.tsx`. As peças comuns estão em
`components/ui/page-header.tsx` e `queue-list.tsx`, e o `.v3` dos portais em `lib/na-v3.ts`.

- **As peças comuns na v3.** Dentro do `.v3` (`in-[.v3]:`), o título da página, o título do grupo da fila e a linha seguem a v3. A tela que ainda não passou fica como era. O Receber (4.7e) ganha o mesmo de graça.
- **Os portais.** O diálogo, o alerta, o painel lateral, o menu, o popover e a lista de opções abrem fora do `.v3` da tela no DOM.
  - O shell diz à tela se ela está na v3 (`NaV3`, pelo contexto do React, que atravessa o portal).
  - Cada um desses componentes leva o `.v3` junto. Os diálogos de exceção e o painel de tratar o pedido também.
- **Sem legenda.**
  - O grupo mostra só o título e a contagem, sem a dica ("coordenação", "armazém", "hoje").
  - O vazio diz o dado ("Nenhum pedido para separar.").
  - Os diálogos de recusar, separar e entregar e o painel de tratar não explicam o que vai acontecer.
  - O motivo da recusa ganhou o rótulo "Motivo", e os campos perderam os exemplos.
- **Uma ação principal.** Só a primeira linha da fila (aprovar para quem decide, senão separar, senão entregar) tem a ação em vermelho. As outras são secundárias.
- **Na v3.** `/pedidos` entra em `TELAS_DO_WMS_NA_V3`.
- **Testes.**
  - `queue-list.test.tsx` cobre a fila e o cabeçalho na v3 e `axe`.
  - `na-v3.test.tsx` cobre o shell e os portais.
  - `pedidos.test.ts` cobre a falta de legenda, o rótulo do motivo e a ação principal.
  - `order-queue.test.ts` cobre o vazio e a linha principal.

### Parte 4.7d: o Estoque na v3

Feita em 23/10/2026. A tela é `artifacts/app/src/pages/estoque.tsx`: os itens com a ficha e a aba Histórico (`movements.tsx`).

- **Só a tela do Estoque.** A lista da v3 passou a conferir o caminho exato. O Mapa, as Posições e as Etiquetas, que ficam dentro do Estoque, entram cada um na sua vez.
- **Na v3.**
  - O código do item fica no texto, sem o vermelho, que na v3 é só da ação principal e do alerta.
  - O painel da ficha perdeu a borda colorida: o item aberto fica marcado na lista.
  - A lista e o vazio usam o raio da v3.
  - O diálogo de movimentação e o painel da ficha no celular levam o `.v3` pelo portal (4.7c).
- **Acessível.** A busca do Estoque e a do Histórico (`StockToolbar`) ganharam rótulo.
- **Sem legenda.** O motivo da movimentação perdeu o exemplo, e o tipo começa em "—".
- **Na v3.** `/estoque` entra em `TELAS_DO_WMS_NA_V3`.
- **Testes.** `estoque.test.tsx` cobre:
  - a lista (código, nome, endereço, saldos e selos), o código sem o vermelho e `axe`;
  - a busca com rótulo e o motivo sem exemplo;
  - só o Estoque na lista, sem o Mapa, as Posições e as Etiquetas.

### Parte 4.7e: o Receber na v3

Feita em 23/10/2026. A tela é `artifacts/app/src/pages/receber.tsx`, e a chegada avulsa fica em
`features/warehouse-ops/receiving.tsx`.

- **Na v3.** A fila e o cabeçalho recebem o visual pelas peças comuns (4.7c), e a ficha, os diálogos e o painel do celular pelo portal.
- **Sem legenda.**
  - Os grupos mostram só o título e a contagem.
  - O vazio diz o dado ("Nenhuma chegada para conferir.", "Nada para guardar.", "Nenhuma chegada recebida.").
  - O rótulo "Aviso de envio" deixou de ser vermelho.
  - O diálogo da chegada avulsa não explica mais quando usar.
- **Uma ação principal.** Só a primeira tarefa da fila (a primeira a conferir, senão a primeira a guardar) tem a ação em vermelho. "Chegada avulsa" passou a secundária.
- **Acessível.** O fornecedor e a NF da chegada avulsa têm o rótulo ligado ao campo e perderam o exemplo.
- **Na v3.** `/wms/receber` entra em `TELAS_DO_WMS_NA_V3`. Com isso, as quatro telas da pergunta 18 estão na v3. As demais do WMS entram depois, uma por PR, pela mesma lista.
- **Testes.**
  - `receber.test.tsx` cobre a falta de legenda, a ação principal, a chegada avulsa e o aviso de envio renderizado com `axe`.
  - `receiving.test.ts` cobre a tarefa principal.

### Parte 4.8a: os relatórios da Operação

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/operacao/relatorios.ts`, e a tela em
`pages/operacao/relatorios-view.tsx`. O mockup é `docs/mockups/Relatorios.dc.html`. A rota é `/operacao/relatorios` (`?relatorio=`), no menu da Operação.

- **Os relatórios.**
  - **OS por período**, por semana ou por mês, com o total.
  - **OS por cliente**, do maior para o menor.
  - **OS por tipo**: a OS com mais de um serviço conta em cada um, e a vistoria é o serviço dela.
  - **Produtividade da equipe**: as OS, as concluídas e as no prazo de cada pessoa escalada.
  - **Uso dos veículos**: as OS, os dias em uso e as concluídas de cada veículo.
  - **Solicitações do portal**: as recebidas no período, as que viraram demanda, as recusadas e as em aberto, por cliente.
- **As regras.**
  - A OS entra pelo dia agendado (`janela.data`).
  - Concluída é a em revisão ou revisada. A reaberta deixa de contar até concluir de novo.
  - No prazo é a concluída até o dia agendado e, quando o fim da janela foi marcado, até ele.
- **A tela.**
  - Abaixo da lista ficam o período (as últimas quatro semanas no começo, de até um ano), o cliente e, nas OS por período, o agrupamento. A lista era uma coluna ao lado e passou a uma linha no alto na parte 4.8b, para a tabela larga caber.
  - Abaixo vêm os números do período e a tabela.
  - "Excel" baixa a tabela (`planilha-xlsx.ts`), com os números como número.
  - "PDF" imprime só o relatório (`.print-area`), sem a lista, os filtros e os botões.
- **Sem valor.** A OS não tem preço, e o relatório não lê nenhum campo de valor. A receita fica no Financeiro (4.8b).
- **Leitura.** As OS e as solicitações vêm do Firestore pelas regras de hoje (quem coordena a Operação). As consultas são por intervalo num campo só, sem índice novo.
- **Testes.**
  - `relatorios.test.ts` cobre a leitura (nenhum valor), o no prazo, o resumo, cada tabela, o filtro e a planilha.
  - `relatorios-view.test.tsx` cobre os textos na ordem, nenhum valor, o relatório marcado, o que vai para o PDF, o filtro errado, os estados e `axe`.
  - `navegacao.test.ts`, `modules.test.ts` e `shell-do-modulo.test.tsx` cobrem o menu, a rota e o papel.

### Parte 4.8b: os relatórios do Financeiro

Feita em 23/10/2026. As regras estão em `artifacts/app/src/lib/financeiro/relatorios.ts`, e a tela em
`pages/financeiro/relatorios-view.tsx`. A rota é `/financeiro/relatorios` (`?relatorio=`), no menu do Financeiro, depois de Faturas.

- **Os relatórios.**
  - **Receita por cliente**: os pagamentos recebidos no período, pelo dia do recebimento, sem os estornados. Os números são o recebido, os pagamentos, os clientes e os estornos.
  - **NFs emitidas por mês**: as NFs do período pela emissão, sem as canceladas, com o emitido, o recebido e o saldo de cada mês.
  - **Contas a receber**: a posição de hoje, sem período. As NFs com saldo entram por cliente e pela idade: a vencer até o dia do vencimento, depois de 1 a 30, de 31 a 60, de 61 a 90 e mais de 90 dias.
  - A receita por serviço do mockup ficou de fora: a NF não guarda o valor de cada serviço (pergunta 26 do plano).
- **A tela comum.** A Operação e o Financeiro usam a mesma tela (`components/relatorios/tela-de-relatorios.tsx`).
  - No alto vêm a lista dos relatórios numa linha, os filtros e os números do período. A tabela vem abaixo, com a largura toda.
  - A célula é texto, número ou reais; o PDF e o Excel saem da mesma tabela. Na planilha, o valor sai em reais com duas casas, como número.
  - Os números do período ocupam as colunas pela largura do relatório, não da janela. Valor em reais fica numa coluna no telefone, duas na tela média e quatro na larga, sem quebrar no meio.
- **Valor só para quem lê preço.** A rota é de owner, admin e financeiro, a mesma lista das callables. As regras de `faturas` e `pagamentos` já fecham a leitura nos mesmos papéis (`canReadPrices`).
- **Leitura.** As NFs vêm ao vivo, como nas outras telas do Financeiro. Os pagamentos da receita vêm por intervalo em `recebido_em`, num campo só, sem índice novo.
- **Testes.**
  - `relatorios.test.ts` cobre o período, o estorno fora da receita, as canceladas fora, a idade de cada NF, cada tabela, o resumo e a planilha.
  - `relatorios-view.test.tsx` cobre os textos na ordem, o período só onde vale, o relatório marcado, as colunas dos números e `axe`.
  - `navegacao.test.ts`, `modules.test.ts` e `ambientes.test.ts` cobrem o menu, a rota e o papel.

### Parte 4.9a: o roteiro do lançamento e o ciclo do cliente

Feita em 23/10/2026. O roteiro está em `docs/plataforma/lancamento-producao.md`:
o estado de hoje, o que muda no `dute-prod` só por publicar a `main`, o que
conferir na homologação, a publicação, a conferência de produção, a parte
4.9b, como desligar e o que espera o Leonardo.

- **A próxima publicação leva três marcos.** A produção serve o commit `fde9ba0` (PR 177). O roteiro da Operação (marco 3) não foi disparado, então os marcos 2, 3 e 4 vão juntos.
- **O que entra sem o Financeiro.** O portal com as OS, o Solicitar OS, os avisos, a entrega do WMS e as telas do WMS na v3 dependem da liberação da Operação, que já vale no `dute-prod`.
  - Os avisos ligam com a publicação. A primeira rodada só marca o cursor, e o e-mail fica auditado até a chave do Resend.
  - A entrega do WMS pela Dutelog abre demanda. Até a resposta sobre o faturamento da entrega, o Comercial não orça a da BTG.
- **O ciclo do cliente no emulador** (`functions/operacao/src/domain/ciclo-do-cliente.integration.test.ts`).
  - O cliente pede pelo portal, a coordenação abre a demanda direta e agenda a OS, e a líder executa no celular e conclui com a assinatura.
  - A NF entra como o Financeiro a grava: a NF do portal e o evento, no formato travado em `fatura.integration.test.ts`.
  - A rotina dos avisos lê os eventos gravados pelas callables de verdade. Ela dá um aviso por passo: a solicitação, a OS agendada, em execução e concluída, e a NF.
  - O e-mail vai a quem ligou o modelo. O da NF, que tem valor, só vai a quem lê valor, e o contato inativo fica de fora.
  - O da conclusão leva ao comprovante, e a conclusão guarda a assinatura e a foto do final.
  - Nenhum aviso ou e-mail de OS leva valor, endereço ou o que o cliente escreveu. Rodar de novo não repete nada.
- **Ficou registrado no teste.** A OS que nasce de item livre do portal não tem serviço da tabela, e o aviso diz só o dia e o horário (pergunta 12 do plano, o tipo da OS).

### Correção: o cliente só com a Operação entra no portal

Feita em 24/10/2026. O desenho da Fase 2 deixava o cliente só com a Operação
em "Nenhum módulo liberado" até a Fase 4 ("quem cai onde", em
`fase-2-nucleo.md`). A parte 4.3b deu a ele Minhas OS, mas a entrada
continuava sem casa para o cliente na Operação, e o Início do portal, que é o
do armazém, ficaria vazio para ele.

- **A entrada** (`lib/platform-modules.ts`): a Operação tem casa para o
  cliente, Minhas OS (`ROTA_MINHAS_OS`, em `lib/portal/navegacao.ts`), onde a
  Operação está liberada. O cliente nunca vê os cards: entra pela primeira
  casa, o Início com a armazenagem e Minhas OS sem ela.
- **O menu do portal** (`portalModulesFor`): sem a armazenagem, o Início sai
  do menu quando o contrato abre outra tela. O modelo sem portal continua
  com o Início, para a conta de cliente criada por engano não abrir uma tela
  em branco.
- **A guarda das rotas do portal** (`App.tsx`) devolve a tela de fora do
  contrato para o começo do portal (`inicioDoPortal`, em `lib/modules.ts`),
  que está sempre no menu: o `/portal` do cliente sem armazenagem vai a
  Minhas OS, sem laço.
- **Nada muda no servidor.** Minhas OS lê `service_orders`, `client_faturas`
  e `service_requests` com a régua do contrato, e o Solicitar OS chama a
  `requestService` da Operação; nenhuma callable do WMS entra no caminho.
- **Testes:** `platform-modules.test.ts` (a entrada do cliente só com a
  Operação, com e sem a liberação, e o cliente nunca nos cards),
  `operations.test.ts` (o Início fora do menu sem a armazenagem) e
  `modules.test.ts` (o menu e o começo do portal de cada contrato, sempre
  uma tela do menu). Os três falham com o código antigo.
- **Fica como está** o cliente só com `financeiro`: "Nenhum módulo
  liberado", porque sem armazenagem nem Operação não há serviço que gere
  fatura.
