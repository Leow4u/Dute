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
- **A armazenagem** continua na fatura do WMS (`billing_periods` e `client_invoices`) até a Fase 7.
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

A solicitação do portal (parte 4.4a) fica em `functions/operacao`:

- `requestService`: a única callable que atende o cliente (`{ portal: true }`). Pede o papel cliente, o código no perfil e a Operação no contrato (`client_access`). Confere os anexos no Storage e grava a solicitação recebida.
- `declineServiceRequest`: quem coordena recusa a solicitação recebida, com o motivo.
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

A solicitação do portal grava eventos da Operação (`source: functions_operacao`,
`entity_type: service_request`), com o `customer_code`:

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
`dute-prod` entra no lançamento (parte 4.9), com o OK do Leonardo.

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
| 4.4a | `requestService` e `declineServiceRequest`, `service_requests`, a solicitação em `openDirectDemand`, `portal.*`, regras do Firestore e do Storage e zeragem | O pedido do portal nunca cria OS sozinho; vira demanda uma vez, do mesmo cliente; o cliente sem a Operação não pede |
| 4.4b | Portal: Solicitar OS em Minhas OS (tipo de serviço, data e horário, origem, destino, o que será feito e anexo) e as solicitações com a situação | Textos listados; sem legenda; uma ação principal; `axe` |
| 4.4c | Operação: as solicitações em Para planejar do Hoje e no Início; abrir a demanda com o formulário preenchido ou recusar | A solicitação aparece em Para planejar; a demanda sai com a solicitação |
| 4.5 | Expedição do WMS com entrega pela Dutelog gera demanda e OS | Retirada pelo cliente não gera OS |
| 4.6 | Notificações por modelo (sino e e-mail) | E-mail só com o canal ligado no perfil |
| 4.7 | WMS na v3, tela a tela | `theme-colors.test.ts`; render e `axe` por tela |
| 4.8 | Relatórios | Sem valor para quem não vê valor |
| 4.9 | Lançamento em produção | Conferência de produção |

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
