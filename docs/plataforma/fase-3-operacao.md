# Fase 3: Operação

Desenho da Operação (docs/plataforma/plano-de-implantacao.md, seção 6), no
padrão da Fase 6: o pedido, as decisões, as coleções, as telas, as partes em
ordem e as perguntas. A base é a proposta "Demanda: do pedido ao faturamento"
(18 telas, `docs/mockups/Op*.dc.html`, `OS*.dc.html`, `Campo2*.dc.html` e
`TVSala.dc.html`) com as decisões de 23/10/2026 por cima: um shell por
módulo, Início por módulo e o Hoje com "Para planejar". Substitui a
especificação da Operação de 19/10 em `plano.md`. O registro de cada parte
fica no fim, como em `fase-2-nucleo.md`; as partes 1 a 3, anteriores a este
desenho, estão lá.

## O pedido

1. Do pedido à OS revisada: a demanda chega do Comercial, direta na Operação
   ou da Armazenagem, vira uma ou várias OS, é planejada com equipe, veículos
   e terceiros, executada no campo com etapas, itens, fotos e assinatura e
   revisada por dentro antes de faturar.
2. A vistoria é uma OS que termina num orçamento, sem redigitar.
3. A sala tem uma TV com o dia.
4. Tudo grava o tempo de cada etapa e de cada item: é o que a IA aprende
   (invariante "IA native" do `CLAUDE.md`).
5. Operação, campo e armazém nunca veem valores.

## Como é hoje

- Partes 1 a 3 na `main` e ligadas no `dute-homolog` e no `dute-prod`:
  `collaborators` e `vehicles` com callables; OS `10045-01` aberta a partir
  da demanda em Para planejar; agendar com equipe e veículo; cancelar com
  motivo; eventos `os.created`, `os.scheduled` e `os.cancelled`.
- Início da Operação em `/operacao` e a fila do dia em `/operacao/hoje`
  (partes 2.6 e 2.4 da Fase 2), no shell v3.
- Não existe ainda: executar, concluir, revisar, vistoria, demanda direta,
  várias OS com fatia do saldo, freelancer e terceiro, o app do campo, a TV.

## Decisões

| Tema | Decisão |
|---|---|
| Demanda e OS | A demanda agrupa pedido, orçamento, aditivos e OS. A OS é uma ida a campo: uma equipe, um dia. A vistoria é uma OS. Uma demanda tem uma ou várias OS, cada uma com uma fatia do saldo dos itens orçados; a soma nunca passa do saldo. |
| Entrada | Pelo Comercial (orçamento antes), direta na Operação (paraquedas e emergencial, orçamento depois da execução) ou pela Armazenagem (pedido de saída com entrega pela Dutelog, Fase 4). Retirada pelo cliente não gera OS. |
| Tipo da demanda | Calculado pela hora do pedido e pela hora pedida para a execução: paraquedas no mesmo dia, emergencial até 48 horas corridas, planejada depois disso. O coordenador corrige, e a correção fica registrada. |
| Status da OS | Para agendar → Agendada → Em execução → Em revisão → Revisada. Cancelada com motivo antes de Revisada. Revisada volta a Em execução só por owner ou admin. Atraso e falta de equipe são alertas, não status. |
| Aceite | Fotos e assinatura no local são o aceite da execução. Sem responsável, a OS conclui "sem aceite no local" e o aceite vem pela validação do cliente no Comercial. |
| Divergência | Item incluído em campo acima do saldo vira divergência; na revisão, vira pedido de aditivo ao Comercial, absorção sem cobrar (com motivo) ou correção de quantidade. A revisão interna não pede nova aprovação do cliente, salvo aditivo. |
| Pessoas | Freelancers e motoristas terceiros não têm login: `collaborators` com `vinculo` (`proprio`, `freelancer`, `terceiro`) e a empresa no terceiro. O líder registra a presença deles na OS, com entrada e saída. |
| Sem sinal | O celular guarda os registros sem sinal e envia quando volta. Cada registro leva a própria chave de idempotência e o instante em que foi feito, não o do envio. |
| Faturamento | Fatura-se a demanda, não a OS (Fase 4). |
| Valores | `service_orders` não tem campo de preço; o teste de schema trava. A diária de freelancer fica no RH e no Financeiro, nunca na OS. |

## Respostas às perguntas da proposta

Propostas no plano de implantação (pergunta 11 da seção 13) e assumidas aqui
até o Leonardo dizer o contrário. Mudar uma resposta é um PR pequeno na parte
que a usa.

1. **Faturamento** no fim da demanda; medição parcial só para contrato que a
   exige (o Safra já tem a medição mensal). O PO do Itaú entra pela
   autorização de faturamento, que já existe; o aditivo recebe o próprio
   aceite.
2. **A assinatura no local** aceita as quantidades executadas; o preço do que
   passou do orçado só se fatura com o aditivo aprovado pelo cliente.
3. **A revisão decide**: absorver (não cobra, com motivo), corrigir a
   quantidade ou pedir aditivo. Executado a menos reduz o faturado na RV de
   execução, no Comercial.
4. **Sem responsável para assinar**, o líder registra o nome de quem recebeu e
   fotos do local; a OS conclui "sem aceite no local".
5. **A vistoria** não pede assinatura nem passa pela revisão: vai direto ao
   Comercial com fotos, itens levantados e medidas.
6. **Paraquedas, noturno e sábado** não mudam a regra de preço: valem os itens
   e a variante da tabela, escolhidos pelo Comercial.
7. **Freelancer e terceiro** ficam no cadastro simples; a presença, com
   entrada e saída, registrada pelo líder, é o que paga a diária.
8. **Emergencial** é até 48 horas corridas; o coordenador corrige o tipo.
9. **Presença**: o líder marca a de toda a equipe; quem tem o app também se
   registra, e vale o primeiro registro.

## Coleções

| Coleção | Dono | O que a Operação faz |
|---|---|---|
| `demands` | Comercial | Lê; escreve só `os_numeros`, `vistoria` (o resumo da vistoria enviada ao Comercial: a OS, quando, os ambientes com os itens e os caminhos das fotos, os itens somados, as medidas, o acesso e as observações; parte 3.11a) e `operacao` (o resumo da execução e da revisão: OS revisadas e em aberto, o período, por linha o executado, o que se cobra, o absorvido e o aditivo, e o aditivo pedido; parte 3.10a). O desenho dizia `execucao` e `revisao`, mas `execucao` já é do Comercial (as datas pedidas para a execução) e `revisao` se confundiria com a RV: o resumo fica num campo só, `operacao`. Na demanda direta que ela abriu, quando a última OS é revisada, também `executado_de`, `executado_ate`, `registro_execucao`, `etapa` e `marcos`, os mesmos campos que o Comercial lê (parte 3.4c). Cria a demanda direta pela callable dela (parte 3.4d), no mesmo esquema, sem RV, com `itens_pedidos` (o escopo das OS, sem preço), `pedido_por`, `executar_ate`, `tipo_calculado`, `tipo_corrigido_por` e `aberta_pela: "operacao"`. O Comercial só lê esses campos. |
| `service_orders` | Operação | Tudo, pelas callables. Desde a parte 3.4b: `itens` com `planejado`, `servicos`, `locais` (endereço copiado e contato no local), `janela`, `equipe` com papel, vínculo e empresa por pessoa (nome copiado no agendamento; freelancer e terceiro entram aqui), `equipe_uids`, `veiculos`, `instrucoes`, `status` e `cancelamento`. Nas partes 3.7 a 3.10: `etapas`, `executado` e `incluido_em_campo` nos itens, `fotos`, `ocorrencias`, `presencas`, `conclusao` e `revisao`. Nenhum valor. |
| `service_order_counters` | Operação | O sufixo da OS por demanda. |
| `collaborators` | Operação | Ganha `vinculo`, `empresa` (terceiro) e `papeis` (líder, motorista, montador, ajudante). |
| `vehicles` | Operação | Ganha `dono` (próprio ou terceiro) e `revisao_em`. |
| Storage `os/{numero}/fotos/` e `os/{numero}/assinatura` | Operação | Com `storage.rules` por papel: campo escalado, coordenação e, na Fase 4, o cliente dono. O papel comercial lê as fotos da OS de vistoria, e só dela (parte 3.11a). |

A fila sem sinal do celular fica no IndexedDB; nenhuma coleção nova.

**Demanda sem RV.** A demanda direta nasce em Para planejar e vai a
Execução a orçar depois da revisão; o `etapaDaDemanda` do Comercial aprende
esses dois casos (parte 3.4).

## Papéis e regras

- Coordenação (owner, admin, interno) grava tudo pelas callables e lê tudo da
  Operação. Suporte lê a OS.
- Campo lê só as OS em que está escalado (`equipe_uids`) e grava só pelas
  callables de execução. Não lê `collaborators` (tem CPF): a OS leva o nome e
  o papel de cada pessoa, copiados no agendamento.
- Comercial lê `demands` e o resumo da execução, nunca `service_orders`.
- Cliente lê as próprias OS, com a Operação contratada (regra da parte 2.7 da
  Fase 2), e a tela dele é da Fase 4.
- Painel não lê nenhuma coleção pelo navegador: a TV recebe o quadro do
  dia pela callable `getRoomBoard`, com só o que ela mostra (parte 3.12a).

## Callables

Em `functions/operacao`, cada uma numa linha e começando por
`requireOperacaoCaller`: `saveServiceOrder` (create, schedule, cancel; ganha
`plan`), `openDirectDemand`, `registerStep`, `registerItem`, `attachPhoto`,
`registerPresence`, `registerOccurrence`, `completeServiceOrder`,
`reviewServiceOrder`, `reopenServiceOrder`, `sendSurveyToCommercial` e
`getRoomBoard` (a leitura da TV, a única que atende o painel; não grava).
A rotina diária `runDailyAlerts` (Cloud Scheduler, 06:00 de São Paulo) não é
callable: confere a liberação e grava os alertas do dia (parte 3.13a).

## Eventos

`source: functions_operacao`, sem nome, valor, CPF ou placa, e sem as
palavras do roteador de avisos do WMS: `os.created`, `os.scheduled`,
`os.planned`, `os.started`, `os.step_recorded`, `os.item_executed`,
`os.item_added_in_field`, `os.photo_attached`, `os.presence_recorded`,
`os.occurrence_recorded`, `os.completed`, `os.signed`,
`os.completed_without_acceptance`, `os.reviewed`, `os.addendum_requested`,
`os.reopened`, `os.cancelled`, `demand.direct_opened`,
`os.survey_opened`, `os.survey_sent`, `collaborator.cnh_expiring` e
`vehicle.maintenance_due`. O desenho dizia `survey.sent_to_commercial`; a
parte 3.11a usa `os.survey_opened` e `os.survey_sent`, para o evento ser da
OS (com o `customer_code` dela), como os outros.

**O que a IA captura desde a primeira parte**: o instante de cada etapa; a
quantidade e o instante de cada item executado; o tamanho e a composição da
equipe; os veículos; o planejado e o executado por item; as horas planejadas
e reais; as divergências e a decisão de cada uma. É a matéria-prima das
medidas da Fase 5.

## Telas

No shell da Operação, v3, sem legenda: Início (feito); Hoje (`ModOpHoje`:
Para planejar, Para agendar, Agendadas hoje, Em execução, Em revisão; busca;
chips; "Nova demanda"); Agenda (`OpAgenda`); Demandas (`OpDemandas`); Demanda
(`OpDemanda`); Nova demanda direta (`OpDemandaNova`); Planejar OS
(`OpOSPlanejar`); OS (`OpOS`, com "Registrar andamento" pelo escritório);
Revisão (`OpRevisao`); Colaboradores e Veículos na v3; Clientes
(`ModOpClientes`); impressão da OS (`OSImpressao`); TV (`TVSala`). Campo
(`/campo`, PWA, papel `campo`): Minhas OS (`Campo2Hoje`), OS em execução
(`Campo2Execucao`), Incluir item (`Campo2IncluirItem`), Concluir com
assinatura (`Campo2Concluir`) e Vistoria (`Campo2Vistoria`). "Sem sinal · 4
registros guardados" é dado, não legenda.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 3.0 | Este runbook; `plano.md` aponta para ele | Documentação |
| 3.4a | Cadastro da equipe e da frota: `collaborators` com vínculo, empresa do terceiro, papéis e o login do app; `vehicles` com dono, empresa e próxima revisão; as duas fichas e as linhas da lista | Terceiro sem empresa recusado; e-mail sem usuário do app recusado; um login para um colaborador só |
| 3.4b | Modelo completo da OS no backend: campos novos, tipo calculado, `plan` com várias OS e fatia do saldo, equipe com papéis, freelancers e terceiros, regras e índices | Saldo nunca negativo; campo sem `collaborators`; schema sem preço |
| 3.4c | O Comercial reconhece a demanda direta da Operação: `etapaDaDemanda` sem orçamento, fila e resumo sem ela, recusa clara nas ações | Direta sem orçamento é Para planejar; executada, Execução a orçar; fora da fila do Comercial |
| 3.4d | Demanda direta na Operação: `openDirectDemand` (número do contador do Comercial, tipo calculado e corrigido, itens sem preço) e a OS que nasce dela sem RV | Demanda direta nasce em Para planejar; tipo pela hora; OS com a fatia dos itens pedidos |
| 3.5a | Hoje completo (`ModOpHoje`): cinco colunas, filtros por tipo, entrada, cliente e equipe, busca, prazo da direta e escalar no painel | Textos listados; `axe`; filtros por tipo, entrada, cliente e pessoa |
| 3.5b | Demandas (`OpDemandas`) e Demanda (`OpDemanda`): lista com filtros e a ficha com escopo, saldo e OS | Textos listados; `axe`; saldo igual ao da callable |
| 3.5c | Nova demanda direta (`OpDemandaNova`) e o botão Nova demanda no Hoje | Tipo pela hora na tela; o formulário manda o formato de `openDirectDemand` |
| 3.6a | Planejar OS (`OpOSPlanejar`): várias OS com a fatia do saldo, janela, equipe com papel (inclusive freelancer e terceiro), veículos, contatos e instruções | Duas OS da mesma demanda somam no máximo o saldo; sem equipe e sem veículo são alertas |
| 3.6b | Agenda da semana (`OpAgenda`) | Cada OS no dia dela; quem está em duas OS no mesmo dia aparece |
| 3.7a | Execução no backend: `registerStep` (etapas na ordem do serviço, com o instante, o canal, o meio e quem informou; a primeira põe a OS Em execução) e `registerOccurrence` | Etapa fora de ordem recusada; instante gravado; repetir não duplica |
| 3.7b | Itens executados: `registerItem` (feito por linha e incluído em campo, com quem pediu e o motivo) | Feito acima do planejado sem inclusão recusado; incluído vira divergência |
| 3.7c | Fotos: `attachPhoto` e `storage.rules` em `os/{numero}/fotos/` | Foto só de quem está na OS ou coordena |
| 3.7d | Ficha da OS (`OpOS`): os quatro passos, locais, etapas, itens com o feito, fotos, equipe, veículos e histórico | Textos listados; `axe`; etapas iguais às do backend |
| 3.7e | "Registrar andamento" na ficha da OS: etapa, itens (feito e incluído) e ocorrência com fotos | O formulário manda o formato das callables |
| 3.8a | Campo no backend: as callables da execução atendem o campo escalado (canal celular, informa o colaborador do login), `registerPresence`, o nome do cliente na OS e o catálogo sem preço para o campo | Campo grava só na OS escalada; quem não é líder marca só a própria presença; vale a primeira marca |
| 3.8b | Campo no celular (`/campo`): Minhas OS e a OS em execução, com etapas, itens, incluir item, presença, fotos e ocorrência | Campo lê só a OS escalada; textos listados; `axe` |
| 3.8c | Fila sem sinal: os registros guardados no aparelho (IndexedDB) e reenviados quando o sinal volta, "Sem sinal · N registros guardados" | Dois envios do mesmo registro gravam um; instante original guardado |
| 3.9a | Conclusão no backend: `completeServiceOrder` (assinatura ou "sem aceite no local", responsável, fotos do final, motivo por item a menos), assinatura no Storage com regra, status Em revisão | Concluir sem motivo para item a menos recusado; assinatura no Storage com regra |
| 3.9b | Concluir no celular (`Campo2Concluir`): itens com a diferença e o motivo, fotos do final, responsável, assinatura no dedo, "sem aceite no local", pela fila | Textos listados; `axe`; o formulário manda o formato de `completeServiceOrder` |
| 3.9c | Concluir pelo escritório e a conclusão na ficha da OS (aceite, responsável, assinatura e diferenças) | Textos listados; `axe`; o formulário manda o formato de `completeServiceOrder` |
| 3.9d | Impressão da OS (`OSImpressao`, via operacional) | Sem valor; textos listados |
| 3.10a | Revisão no backend: `reviewServiceOrder` (cada divergência com decisão: cobrar, aditivo, absorver, próxima OS, encerrar; correção do executado), o consumido no saldo, o resumo `operacao` na demanda, a direta em Execução a orçar; `reopenServiceOrder` (owner e admin) | Divergência sem decisão não conclui; o resumo só pela Operação |
| 3.10b | Tela Revisão (`OpRevisao`): para revisar, a OS com fotos, assinatura, horas e itens, as decisões; reabrir na ficha | Textos listados; `axe`; o formulário manda o formato de `reviewServiceOrder` |
| 3.10c | No Comercial: "Aditivo a fazer" no Início e a execução da Operação no orçamento, a partir do resumo dela | O aditivo pedido aparece até a RV de aditivo (ou a recusa) |
| 3.10d | Orçar a execução da direta aberta pela Operação: o orçamento nasce com o que ela executou e cobra | O orçamento da direta nasce com o executado a cobrar, pela tabela |
| 3.11a | Vistoria no backend: a OS de vistoria (`tipo`, sem itens) aberta pela coordenação antes do escopo fechado, só ir, chegar e terminar, e `sendSurveyToCommercial` (ambientes com fotos e itens do catálogo, medidas, acesso e observações; o resumo `vistoria` na demanda; as fotos para o Comercial) | Vistoria não passa pela revisão nem pede aceite; o resumo só pela Operação |
| 3.11b | Vistoria no celular (`Campo2Vistoria`): ambientes, fotos, itens do catálogo, medidas, acesso e o envio pela fila sem sinal | Textos listados; `axe`; o formulário manda o formato de `sendSurveyToCommercial` |
| 3.11c | Planejar a vistoria pelo escritório: a visita técnica pedida em Para planejar no Hoje, "Planejar vistoria" na ficha da demanda e a tela de Planejar numa OS só, sem itens | Textos listados; `axe`; o formulário manda o formato de `saveServiceOrder` survey |
| 3.11d | A vistoria na ficha da OS e no Registrar andamento: "Enviada ao Comercial", os passos dela, a vistoria enviada, sem itens, conclusão nem reabertura | Textos listados; `axe`; só as etapas da vistoria no andamento |
| 3.11e | No Comercial: "Vistoria concluída" no Início e na montagem, com os itens levantados carregados no orçamento | O orçamento nasce com os itens da vistoria, sem redigitar |
| 3.12a | Quadro da TV no backend: `getRoomBoard` (painel, owner, admin e interno) | `painel` só lê o que a TV mostra; sem valor; sem ação; as regras não abrem coleção ao painel |
| 3.12b | TV da sala (`/tv`): o painel entra direto, modo escuro, colunas, indicadores, próxima saída, relógio e atualização sozinha | Textos listados; sem valor; nenhum botão nem link; `axe` |
| 3.13a | Rotina diária no backend (CNH e revisão do veículo viram evento) e o veículo fora no dia da revisão preventiva | O evento sai uma vez por dia por item; o agendamento recusa o veículo no dia da revisão |
| 3.13b | Alertas no Início (revisão do veículo, OS sem equipe ou veículo perto do prazo) e a revisão preventiva na escala e na Agenda | Textos listados; o veículo no dia da revisão não se escolhe; `axe` |
| 3.14 | Produção e registro: o ciclo completo no emulador e o roteiro `operacao-producao.md` | O ciclo da direta e do Comercial passa no emulador sem valor na OS; a publicação espera o OK do Leonardo |

**Pronto quando.** Uma demanda do Comercial e uma direta percorrem pedido →
OS → planejamento com várias OS → execução → assinatura no celular, sem
sinal → revisão com divergência → aditivo ou orçamento da execução no
Comercial → a faturar. Cada OS revisada tem o tempo de cada etapa e de cada
item. A vistoria vira orçamento sem redigitar. A TV atualiza sozinha. Nenhum
valor em `service_orders`, nem para o owner.

## Liberação

`OPERACAO_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"]`, no app e nas
callables, travada por `platform-lists.test.ts`. A Operação fica ligada na
produção enquanto a fase anda (resposta do Leonardo em 23/10/2026: ninguém
usa o sistema ainda). O `dute-btg` recusa. Desligar é tirar `dute-prod` das
duas listas e publicar de novo; o que foi gravado continua no banco.

## Perguntas abertas

Do plano de implantação, seção 13, com a parte que espera a resposta:

- Os tipos de serviço da OS derivados dos itens bastam, ou a OS tem um tipo
  escolhido à mão? (pergunta 12; parte 3.4; até lá, derivados dos itens)
- Vistoria e demanda direta nascem pelo celular do líder, ou só pela
  coordenação? (pergunta 13; partes 3.8 e 3.11; até lá, só pela coordenação)
- A TV fica em `/tv` com o papel `painel` e sessão longa? (pergunta 14; parte
  3.12)
- A OS em execução se cancela? O desenho dizia "cancelada com motivo antes de
  Revisada"; a parte 3.10a decidiu que não: ela conclui com o que foi feito e
  a revisão devolve o resto ao saldo ou o encerra, para o executado não se
  perder. Mudar é um PR pequeno na `saveServiceOrder`.

## Registro

### Parte 1: colaboradores e veículos

#### O que grava

Codebase `functions/operacao` (a primeira da Operação; o WMS continua
`default`). Callables `saveCollaborator` e `saveVehicle`, cada uma numa linha
`export const nome = onCall(`, começando por `requireOperacaoCaller`.

| Coleção | Campos |
|---|---|
| `collaborators` | nome, CPF, função, telefone, CNH (categoria e validade), ativo, edição |
| `vehicles` | placa, tipo, modelo, capacidade kg e m³, ativo, edição |
| `operacao_operations` | recibo de idempotência; ninguém lê |

CPF com dígitos verificadores, único. Placa antiga (`ABC1234`) ou Mercosul
(`ABC1D23`), única. Criar, atualizar (com a edição vista), desativar e
reativar. Não apaga.

#### Quem

Grava e lê: owner, admin e interno. Campo não vê a lista (o documento tem
CPF; a OS dele vem na parte 3). Suporte, comercial, wms, financeiro, cliente,
rh e painel não leem. O navegador não grava: as regras recusam.

#### Evento

Na mesma transação, `source: functions_operacao`, severidade `info`. O
payload é o id e, na atualização, a edição. Sem nome, CPF, telefone, CNH nem
placa: wms e suporte leem `events`. Nenhum tipo usa as palavras do roteador
de avisos do WMS.

#### Liberação

`OPERACAO_AMBIENTES_LIBERADOS = ["dute-homolog", "dute-prod"]`, a mesma lista
no app e nas callables, travada por `platform-lists.test.ts`. O `dute-prod`
entrou com o OK do Leonardo em 22/10/2026, antes do lançamento previsto na
Fase 4; a produção só atende depois da publicação manual. O `dute-btg`
recusa.

Desligar é tirar `dute-prod` das duas listas e publicar de novo: as callables
voltam a recusar e as telas somem. Não se desfaz o que foi gravado enquanto
estava ligada: colaboradores, veículos, OS, o contador, `os_numeros` nas
demandas do Comercial e os eventos `functions_operacao`. Isso continua no
banco, legível pelas regras, e só sai restaurando o banco para um banco novo
(PITR ou backup), com o OK do Leonardo.

#### Telas

`/operacao/colaboradores` e `/operacao/veiculos`, no shell da Operação, fora
do menu do WMS. Com a liberação, o interno vê Armazenagem e Operação na
entrada. O cliente não vê este cadastro: a OS no portal é da Fase 4.

#### Zeragem

`collaborators`, `vehicles`, `operacao_operations`, `service_orders` e
`service_order_counters` nunca são apagadas, nem com `--include-setup`.
Eventos `functions_operacao` ficam, como os do Comercial.

### Parte 2: núcleo da OS

Sem tela. A callable `saveServiceOrder` abre a OS da demanda em Para planejar
e cancela a OS aberta.

- O número é o da demanda com sufixo: demanda 10045, primeira OS `10045-01`.
  A seguinte, na mesma demanda, é `10045-02`. O contador fica em
  `service_order_counters/{demanda}`.
- Os itens saem da revisão fechada (`quotes/{n}/revisoes/{escopo_rv}`). Preço,
  motivo e linha de ajuste não entram. Item avulso entra sem preço.
- A demanda ganha `os_numeros` e continua em Para planejar. O nome do cliente
  não vai para a OS nem para o evento.
- Eventos `os.created` e `os.cancelled`. O tipo não usa a palavra `order`: o
  roteador de avisos do WMS transformaria isso em aviso ao cliente. O motivo
  do cancelamento fica na OS, não no evento.
- Quem grava é o mesmo do cadastro (owner, admin, interno). Quem lê a OS:
  esses e o suporte. O interno passa a ler `demands`, `lpu_items` e
  `customer_locations`. `quotes` e `price_tables` continuam sem a operação.
- Agendar e a tela ficam na parte 3. Executar e concluir ficam para a
  próxima parte.

### Parte 3: fila do dia

A tela `/operacao/hoje` (até a parte 2.6 da Fase 2, `/operacao`), item Hoje do menu. Sem executar, concluir, foto ou
assinatura: as colunas Em execução e Concluídas não entram enquanto essas
transições não existem.

- Para abrir lista a demanda com `etapa` Para planejar. Abrir OS chama
  `saveServiceOrder` com `create`. A demanda continua em Para planejar e pode
  gerar `10045-02`.
- Para agendar é a OS `aberta`. Agendadas hoje é a OS `agendada` cuja
  `agenda.data` é o dia em America/Sao_Paulo. Outros dias é a OS `agendada`
  em outra data. A cancelada não aparece.
- Agendar chama `schedule`: data (não pode ser anterior a hoje), hora
  opcional, equipe e veículo. Os dois precisam estar ativos. A OS guarda os
  ids; o nome e a placa vêm do cadastro na leitura.
- A demanda perdida ou cancelada no Comercial (`perda` ou `cancelamento`
  preenchidos) não agenda nem reagenda: `schedule` lê a demanda na transação
  e recusa. A OS dela continua na coluna, marcada "Demanda perdida" ou
  "Demanda cancelada", e a ficha só oferece o cancelamento. O Comercial não
  cancela a OS sozinho. Reaberta a demanda, a OS volta a agendar. O aditivo
  em negociação não trava: o escopo fechado continua valendo.
- Cancelar, da OS aberta ou agendada, pede o motivo. O motivo fica na OS, não
  no evento (`os.cancelled`). Agendar grava `os.scheduled`.
- Quem usa a tela é o mesmo do cadastro: owner, admin e interno. Campo ainda
  não lê a OS. A Operação atende no `dute-homolog` e no `dute-prod`.

### Parte 3.0: este desenho

Reescrito em 23/10/2026 no padrão da Fase 6, a partir da seção 6 do plano de
implantação. As nove respostas da proposta ficam assumidas até o Leonardo
dizer o contrário. A especificação da Operação de 19/10 em `plano.md` ficou
marcada como substituída.

### Parte 3.4a: cadastro da equipe e da frota

Feita em 23/10/2026. A parte 3.4 ficou em três PRs (a, b e c): o cadastro
primeiro, porque a equipe da OS copia o nome e o papel de cada pessoa.

- **Colaborador.** Ganha `vinculo` (equipe própria, freelancer ou terceiro;
  sem o campo, um documento antigo é lido como equipe própria), `empresa`
  (obrigatória no terceiro e apagada nos outros dois) e `papeis` (líder,
  motorista, montador, ajudante; sem repetir, na ordem da lista). A função
  continua texto livre; na linha da lista, o papel com o mesmo nome da função
  não se repete.
- **Login do app.** A ficha leva o e-mail do app; a callable acha o usuário
  em `users` por esse e-mail e grava `usuario_uid`. Recusa quando não há
  usuário, quando há mais de um, quando o acesso foi removido, quando o papel
  não é `campo` nem `interno`, e quando o login já está em outro colaborador.
  Quem cadastra nunca digita nem vê o uid. Apagar o e-mail desliga o login.
  É esse vínculo que, na parte 3.8, deixa o campo ver só as OS dele.
  Desde 25/10/2026, ligar, trocar ou tirar o login chega na mesma transação
  às OS da pessoa que ainda vão a campo (para agendar, agendada e em
  execução): a pessoa na `equipe` passa a ter o login novo, `equipe_uids`
  troca o antigo pelo novo (o de outra pessoa da equipe fica) e a edição da
  OS sobe. Antes, a OS guardava o login de quando foi planejada ou agendada:
  quem era ligado depois não via a OS, e o login tirado seguia lendo e
  registrando nela. A OS concluída fica com quem estava ligado quando foi a
  campo (a leitura do histórico pelo campo é uma decisão da LGPD,
  `lgpd.md`). O `collaborator.updated` leva os números dessas OS
  (`os_com_acesso`).
- **Veículo.** Ganha `dono` (próprio ou terceiro; sem o campo, próprio),
  `empresa` (obrigatória no terceiro) e `revisao_em` (a próxima revisão, que
  alimenta o alerta da parte 3.13).
- **Telas.** As duas fichas ganharam os campos; a empresa só aparece para o
  terceiro. As linhas da lista dizem vínculo, papéis, "no app" e a revisão.
  Sem legenda; `axe` sem violação nas duas fichas.
- **Eventos.** Os mesmos de antes (`collaborator.*`, `vehicle.*`), sem nome,
  CPF, placa nem e-mail.

### Parte 3.4b: modelo da OS para o planejamento

Feita em 23/10/2026, no backend e na leitura da fila. As telas novas
(Planejar OS, Demanda, Agenda) são das partes 3.5 e 3.6.

- **Fatia do saldo.** O escopo é a revisão fechada (`escopo_rv`); cada linha
  é contada pelo id, que é o mesmo em todas as RV. Saldo = escopo menos a
  fatia das OS que não foram canceladas, em milésimos (quantidade com até 3
  casas, como no orçamento). Abrir pela fila (`create`) põe todo o saldo
  numa OS; `plan` cria até 10 OS de uma vez, cada uma com a fatia pedida;
  `set_items` muda a fatia de uma OS aberta ou agendada. Acima do saldo,
  nada é gravado. Cancelar devolve a fatia.
- **Concorrência.** Quem muda o saldo grava no contador da demanda
  (`service_order_counters`), que a transação também lê: dois planejamentos
  ao mesmo tempo conflitam ali e o segundo relê o saldo. O teste dispara três
  ao mesmo tempo e só um grava. A sequência da OS parte do maior entre o
  contador e as OS que existem, para nunca repetir um número.
- **Aditivo em negociação não trava.** A demanda com escopo fechado recebe OS
  enquanto a RV seguinte está em curso; executada, validada, perdida ou
  cancelada, não recebe.
- **Documento.** `itens` com `planejado`, `servicos` (vistoria, desmontagem,
  embalagem, transporte, montagem e armazenagem, pelo serviço, item e
  descrição), `locais` (origem e destino com nome e endereço do cadastro de
  locais do mesmo cliente, complemento da demanda e o contato no local),
  `janela` (data, início e fim), `equipe` (nome, papel, vínculo, empresa e se
  tem o app), `equipe_uids`, `veiculos` (placa, tipo, modelo, dono e empresa)
  e `instrucoes`. Aberta sem janela, agendada com ela. O teste de schema
  percorre todas as chaves e recusa qualquer uma de preço, valor, total,
  custo ou diária.
- **Decisões no caminho.**
  - Freelancer e terceiro entram na `equipe` como qualquer pessoa, com o
    vínculo e a empresa copiados (como na tela aprovada `OpOSPlanejar`), em
    vez de listas separadas `freelancers` e `terceiros`.
  - A OS passa a levar nome e placa (a parte 3 não levava), porque o campo
    lê a OS e não o cadastro. CPF nunca; o evento continua sem nome e placa.
  - Sem papel pedido, vale o primeiro papel do cadastro da pessoa; quem tem
    papéis marcados só entra num deles.
  - Sem equipe e sem veículo, a OS agenda: a falta é alerta (parte 3.13), não
    bloqueio. A tela de agendamento da fila ainda pede os dois até a parte 3.6.
  - `observacoes_internas` ficou de fora: o campo e o cliente leem o
    documento da OS e a regra não esconde campo. Entra numa subcoleção só da
    coordenação quando uma tela pedir.
  - O nome do cliente continua fora da OS (como na parte 2); a tela do campo
    (parte 3.8) decide como mostrar.
  - O índice da lista do campo (`equipe_uids` com status) entra com a
    consulta, na parte 3.8.
- **Regras.** O campo lê a OS em que está escalado (`equipe_uids`) e lista só
  com esse filtro; acesso removido não lê; continua sem ler o cadastro.
- **Eventos.** `os.planned` (um por OS, com a composição da equipe por id,
  papel e vínculo, e os veículos por id), `os.scheduled` com janela,
  composição e veículos, e `os.items_changed`. Nenhum leva nome, placa,
  contato ou instrução.
- **OS de antes.** A leitura aceita a `agenda` antiga, a `quantidade` e os
  ids dos locais; agendar de novo grava o modelo novo e apaga a `agenda`.

### Parte 3.4c: o Comercial reconhece a demanda direta

Feita em 23/10/2026, na codebase e nas telas do Comercial, antes da callable
que abre a demanda direta (parte 3.4d), para nenhuma tela do Comercial ver
uma demanda sem orçamento sem saber o que fazer com ela.

- `etapaDaDemanda` sem orçamento: a demanda com `entrada: "direta"` está em
  Para planejar e, executada (`executado_de`), em Execução a orçar. A
  comercial continua em montagem. Com o orçamento da execução aberto, a etapa
  segue o orçamento, como na direta do "Orçar execução".
- A fila de orçamentos e o resumo do Início do Comercial deixam de fora a
  direta em Para planejar (`demandaDiretaNaOperacao`): ela é da Operação até
  a execução. A direta do "Orçar execução" já nasce executada e não muda.
- As ações do Comercial numa direta sem orçamento recusam com "está com a
  Operação até a execução", em vez de "demanda não encontrada".
- Quem marca a execução da direta (o `executado_de` ou um resumo próprio da
  Operação) se decide na parte 3.10, com a revisão.

### Parte 3.4d: demanda direta na Operação

Feita em 23/10/2026. A tela (Nova demanda direta, `OpDemandaNova`) é da
parte 3.5; a fila já mostra a direta em Para planejar e abre a OS dela.

- **`openDirectDemand`** (owner, admin e interno). Numa transação: o número
  sai do contador do Comercial (`demand_counters/geral`, a mesma regra de
  `proximoNumero`), confere que a demanda e o orçamento com esse número não
  existem, acha o cadastro pelo código (arquivado recusa), confere que os
  locais são do cliente e lê os itens do catálogo (`lpu_items`). Grava o
  contador, a demanda e o evento `demand.direct_opened` (número, tipo, tipo
  calculado e quantas linhas; sem nome, telefone, item nem local).
- **A demanda direta** nasce no esquema do Comercial (`entrada: "direta"`,
  Para planejar, sem orçamento, `escopo_rv` vazio), com o que é dela: quem
  pediu (nome e telefone digitados: a Operação não lê os contatos do
  cadastro comercial), recebida em, executar até, o tipo e os itens pedidos
  sem preço, com o id de linha no formato do Comercial. O teste lê a
  `demandaNova` do Comercial e confere que a direta tem todos os campos dela.
- **Tipo pela hora**: paraquedas no mesmo dia em São Paulo, emergencial até
  48 horas corridas, planejada depois. O coordenador corrige; o calculado e
  quem corrigiu ficam na demanda.
- **Itens**: do catálogo, com nome, serviço e unidade dele (inativo ou de
  armazenagem recusa), ou avulso, com nome e unidade digitados.
- **A OS da direta** sai dos itens pedidos, com a mesma fatia do saldo da
  parte 3.4b e `escopo_rv` vazio. Executada, perdida, cancelada ou já com o
  orçamento da execução, a direta não recebe OS nova.
- **Cópias do Comercial** (contador, faixa, versão do esquema, tipos e
  canais) ficam em `functions/operacao/src/domain/demanda-direta.ts`,
  travadas por `demanda-direta.test.ts`, que lê a fonte do Comercial.

### Parte 3.5a: o Hoje completo

Feita em 23/10/2026, no desenho aprovado `ModOpHoje`. Substitui a fila do
dia da parte 3 (`pages/operacao/fila.tsx` virou `hoje.tsx`).

- **Colunas.** Para planejar (as demandas com saldo), Para agendar (abertas),
  Agendadas hoje (pela hora, com os próximos dias recolhidos embaixo), Em
  execução e Em revisão. As duas últimas ficam vazias até as partes 3.7 e
  3.9 gravarem esses estados.
- **Saldo sem preço.** A coluna Para planejar conta as linhas com saldo pelo
  escopo que a demanda grava sem preço (`escopo`, no fechamento, ou
  `itens_pedidos`, na direta) menos a fatia das OS não canceladas: a mesma
  conta da callable. A demanda sem saldo sai da coluna.
- **Cartões.** O tipo (paraquedas, emergencial, planejada), o número, o
  cliente, o título e a rota (dos locais copiados na OS), o prazo da direta
  ("Hoje até 19:00 · faltam 4h40", ou "atrasada"), os serviços, a equipe e a
  placa copiadas na OS, e "Sem equipe" e "Sem veículo" como dado. O mais
  urgente primeiro em Para agendar.
- **Filtros e busca.** Tipo, entrada, cliente e pessoa da equipe; a busca
  acha OS, demanda, cliente e título, sem acento. "Limpar filtros" só com
  filtro.
- **Escalar.** O número da OS abre o painel lateral (o mesmo de antes, com
  data, hora, equipe, veículo e cancelar com motivo). Sem equipe ou sem
  veículo, agenda: a falta é alerta. O papel de cada pessoa e vários
  veículos entram na tela de Planejar OS (parte 3.6).
- **Ainda não.** O botão Nova demanda chega com a tela dela (parte 3.5c); a
  TV, na parte 3.12.

### Parte 3.5b: Demandas e a ficha da Demanda

Feita em 23/10/2026, nos desenhos aprovados `OpDemandas` e `OpDemanda`.
Demandas entrou no menu da Operação, depois do Hoje.

- **Etapa na Operação.** Fora de Para planejar vale a do Comercial,
  agrupada (no comercial, aguardando cliente, execução a orçar, a faturar,
  perdida, cancelada). Em Para planejar, a OS que mais avançou diz onde a
  demanda está: em execução, em revisão, agendada ou para agendar; sem OS,
  ou com todas revisadas, é Para planejar.
- **Lista** (`/operacao/demandas`). Número e título, cliente, tipo, entrada,
  etapa, o resumo das OS ("3 · 1 em execução") e o próximo passo (Planejar
  OS, a próxima OS agendada ou o prazo da direta), mais recentes primeiro.
  Filtros por tipo, entrada, cliente e etapa; a busca acha também pelo
  número da OS. Tabela no desktop, cartões no celular.
- **Ficha** (`/operacao/demanda?numero=`). O escopo linha a linha com o que
  está nas OS (e em quais) e o saldo, a mesma conta da callable; as OS da
  demanda com data, equipe, placas, serviços e o status; na direta, quem
  pediu, a chegada e o prazo; e os locais com o endereço do cadastro do
  cliente. Com saldo, "Abrir OS com o saldo" até a tela de Planejar OS
  (parte 3.6).
- **Ainda não.** A linha do tempo (pedido, vistoria, orçamento, execução,
  revisão e faturamento), as pessoas e o histórico da ficha aprovada entram
  com a revisão (parte 3.10), quando os marcos da execução existirem. A
  coluna Executado do escopo entra na parte 3.7.

### Parte 3.5c: Nova demanda direta

Feita em 23/10/2026, no desenho aprovado `OpDemandaNova`, em
`/operacao/nova-demanda`. O botão Nova demanda entrou no Hoje e em Demandas.

- **Pedido.** Cliente, título, quem pediu (nome e telefone), canal
  (telefone, WhatsApp, e-mail, portal), recebida em e executar até (data e
  hora, no fuso de São Paulo). O tipo sai da hora na hora, com a mesma regra
  da callable (o teste trava as 48 horas e os canais contra
  `functions/operacao`); "Corrigir" escolhe outro, e só a correção vai à
  callable.
- **Locais.** Origem e destino entre os locais do cliente, com andar ou sala.
- **Itens.** A busca no catálogo (só item ativo e orçável, sem preço) inclui
  a linha; "Item avulso" abre nome, unidade e quantidade. A vírgula da
  quantidade vira ponto.
- **Resumo.** O tipo, o cliente, quem pediu, o canal, a recebida, o prazo
  ("Hoje até 19:00 · faltam 5h54") e quantos itens. "Abrir demanda" confere
  antes e diz o que falta; aberta, a tela vai para a ficha da demanda nova.
- **Ainda não.** "Escalar agora", da tela aprovada, fica para a tela de
  Planejar OS (parte 3.6): por enquanto a ficha abre a OS com o saldo e o
  Hoje escala. A entrada "Pelo comercial" não é da Operação: o Comercial abre
  a demanda dele.

### Parte 3.6a: Planejar OS

Feita em 23/10/2026, no desenho aprovado `OpOSPlanejar`, em
`/operacao/planejar?demanda=`. O Hoje (Para planejar) e a ficha da demanda
levam a ela; "Abrir OS com o saldo" saiu.

- **Plano.** Nasce com uma OS hoje e todo o saldo. "Mais uma OS" abre a
  seguinte no dia seguinte, sem itens, com quem já está no plano; cada OS
  tem data, início e fim e pode sair. Cada linha do saldo tem a quantidade
  de cada OS e o restante, em vermelho quando passa; "Igualar ao saldo"
  completa a OS com o que sobra.
- **Equipe e veículos.** A pessoa entra pelo cadastro, agrupada por vínculo
  (equipe própria, freelancer, terceiro), com o papel entre os marcados no
  cadastro (ou qualquer um, sem nenhum marcado) e, com mais de uma OS, as
  OS de que participa. O mesmo para os veículos, com o dono terceiro.
- **Locais e instruções.** O contato no local (nome e telefone) de origem e
  destino e as instruções para a equipe vão em todas as OS do plano.
- **O que impede** (a callable confere de novo): as OS somarem mais que o
  saldo de uma linha (aparece enquanto se digita), OS sem item, quantidade
  fora do formato, data passada, janela invertida e, ao agendar, OS sem
  data. **O que só avisa:** OS sem equipe, sem líder ou sem veículo, e
  pessoa ou veículo já em outra OS no mesmo dia.
- **Gravar.** "Agendar" manda o plano com a janela de cada OS (agendadas);
  "Salvar rascunho" manda sem janela (ficam Para agendar). Gravado, volta à
  ficha da demanda.
- **Ainda não.** A sugestão do Agent Dute da tela aprovada é da Fase 5. Mudar
  a fatia de uma OS já criada (`set_items`) entra com a tela da OS (parte
  3.7).

### Parte 3.6b: Agenda da semana

Feita em 23/10/2026, no desenho aprovado `OpAgenda`, em
`/operacao/agenda?semana=` (sem a semana, a de hoje). Entra no menu da
Operação depois do Hoje.

- **Semana.** Segunda a sábado; o domingo aparece só quando tem OS. As
  setas mudam a semana pela URL, e "Hoje" volta para a atual. Cada dia diz
  quantas OS tem e, em destaque, quantas estão sem equipe e quantas pessoas
  estão em duas OS no dia.
- **Linhas.** Equipe própria, freelancers, terceiros e veículos, cada grupo
  recolhível. A pessoa mostra o papel da semana (o da OS) e, no terceiro, a
  empresa. Entram os ativos e os desativados com OS na semana. Cada OS
  (agendada, em execução, em revisão ou revisada) fica no dia dela, pela
  hora, na cor do status do Hoje; quem está em duas OS no mesmo dia aparece
  com as duas na mesma célula.
- **Sem equipe.** A OS agendada na semana sem ninguém fica acima da agenda,
  com o tipo, o cliente, o título e quando, e "Escalar" abre o mesmo painel
  do Hoje.
- **Seleção.** Escolher uma OS acende ela em todas as linhas e mostra o
  status, o cliente, quando, a equipe e as placas, com "Reagendar" (se
  agendada) e o atalho para a demanda.
- **Busca.** Pessoa, placa, OS ou cliente, sem acento.
- **Celular.** Um dia embaixo do outro, com o status, a janela, a equipe, as
  placas e as mesmas ações de cada OS.
- **Código.** O painel de escalar saiu da tela do Hoje para
  `components/operacao/escala.tsx` e a gravação para
  `pages/operacao/use-escala.tsx`, usados pelas duas telas. O rótulo e a cor
  do status da OS ficaram em `components/operacao/partes.tsx`.
- **Ainda não.** O bloqueio do veículo em revisão preventiva, da tela
  aprovada, entra com os alertas da rotina (parte 3.13). "Abrir OS" e
  "Abrir revisão" entram com a tela da OS (parte 3.7) e a revisão (parte
  3.10).

### Parte 3.7a: execução no backend

Feita em 23/10/2026. Duas callables novas em `functions/operacao`, com
`requireOperacaoCaller` e o papel de quem grava a Operação (owner, admin e
interno; o campo entra na parte 3.8). Regras em `domain/execucao.ts`,
gravação em `domain/execucao-gravacao.ts`.

- **`registerStep`.** Etapas na ordem do serviço: saída do pátio, chegada
  na origem, carregamento, saída da origem, chegada no destino, montagem e
  fim. Pular vale; voltar não: a etapa que vem antes de uma já registrada,
  a repetida e a hora antes da última são recusadas. O instante é o de
  quando aconteceu (com fuso, gravado em UTC), nunca no futuro (5 minutos de
  folga para o relógio) nem antes do dia da OS. Cada etapa guarda o canal
  (escritório ou celular), como a informação chegou ao escritório
  (telefone, WhatsApp ou presencial), quem da equipe informou e quem
  registrou. A primeira etapa pede a equipe escalada e põe a OS Em
  execução; depois disso a OS não se reagenda nem muda os itens pelo
  planejamento.
- **`registerOccurrence`.** Descrição de 3 a 1000 caracteres, o instante e
  quem informou, numerada na OS (`oc_01`), na OS agendada ou em execução,
  até 50 por OS. Não muda o status.
- **Eventos.** `os.started` (uma vez), `os.step_recorded` (etapa, instante,
  canal e o id de quem informou) e `os.occurrence_recorded` (só o número da
  ocorrência: a descrição é texto livre e fica na OS). O `occurred_at` é o
  instante do registro, não o do envio. Cada registro tem a própria chave
  de idempotência: repetir devolve o mesmo resultado sem duplicar.
- **Ainda não.** Cancelar a OS em execução (o plano permite até Revisada)
  fica para a revisão (parte 3.10), que decide o que volta ao saldo.

### Parte 3.7b: itens executados

Feita em 23/10/2026. `registerItem` em `functions/operacao` (owner, admin e
interno; o campo entra na parte 3.8), regras em `domain/itens-executados.ts`.

- **Feito.** Quanto da linha já foi executado, em número absoluto, com o
  instante e quem da equipe informou. O escritório corrige para mais ou
  para menos, até o previsto da linha: o planejado mais o que foi incluído
  em campo. Passar do previsto é recusado com o pedido de incluir. Só com a
  OS em execução (a primeira etapa registrada).
- **Incluído em campo.** O executado além do planejado, com a quantidade,
  quem pediu no local, o motivo e o instante. Entra na linha da OS, na linha
  do mesmo item do catálogo ou numa linha nova (do catálogo ou avulsa, com o
  planejado zero e o id `cp_` da operação, que repetir não duplica). Soma ao
  feito. É a divergência que a revisão decide (parte 3.10). Não mexe no
  saldo da demanda: só o planejado conta nele.
- **Eventos.** `os.item_executed` (linha, feito, o feito de antes, instante,
  canal e quem informou) e `os.item_added_in_field` (linha, quantidade, se a
  linha é nova e o item do catálogo). Quem pediu e o motivo são texto livre e
  ficam só na OS.
- **Planejamento.** Mudar os itens pelo planejamento (`set_items`) continua
  só para a OS aberta ou agendada, então o feito e as inclusões nunca se
  perdem numa troca de fatia.

### Parte 3.7c: fotos da OS

Feita em 23/10/2026. A foto sobe do navegador direto para o Storage e
`attachPhoto` (owner, admin e interno; o campo entra na parte 3.8) a grava na
OS. Regras em `domain/fotos.ts`, gravação em `domain/fotos-gravacao.ts`.

- **Storage.** `os/{numero}/fotos/ft_<16 hex>.jpg` (ou `.png`, `.webp`), até
  8 MB, só imagem. Sobe quem coordena a Operação (owner, admin, interno) ou
  quem está escalado na OS (`equipe_uids`, o mesmo critério do
  `firestore.rules`), com a OS agendada ou em execução. Lê também o suporte.
  Nada se sobrescreve nem apaga pelo navegador; a retenção (LGPD, decisão 2)
  apaga as fotos das etapas, das ocorrências e da vistoria 12 meses depois de
  a OS ficar revisada (`docs/plataforma/lgpd.md`, seção 6, parte 2). As
  regras têm teste no emulador
  (`functions/wms/src/operacao-fotos.rules.test.ts`); a integração do WMS
  sobe agora o Firestore e o Storage.
- **`attachPhoto`.** Confere no Storage que o arquivo chegou e é imagem e
  grava a foto na OS com o instante em que foi tirada, a etapa, a ocorrência
  ou o item a que se refere (os dois precisam existir na OS) e a legenda, até
  200 por OS. Repetir não duplica. Sem o arquivo, nada entra na OS.
- **Evento.** `os.photo_attached` com o id da foto, a etapa, a ocorrência, o
  item, o instante e o canal; a legenda é texto livre e fica só na OS.
- **Rodar local.** O emulador do Storage lê o Firestore por HTTP e usa o
  proxy do ambiente quando há um: numa máquina com proxy, rode a integração
  com `HTTPS_PROXY` vazio.

### Parte 3.7d: ficha da OS

Feita em 23/10/2026, no desenho aprovado `OpOS`, em `/operacao/os?numero=`.
A Agenda ("Abrir OS"), a ficha da demanda e o Hoje (a OS em execução e em
revisão) levam a ela; no menu, acende o Hoje.

- **Cabeçalho.** O número, o status, o tipo, a demanda, o cliente, o título,
  os serviços e a janela.
- **Passos.** Agendar, Executar, Concluir e Revisar, com o feito, o atual e
  o pendente pelo status; Executar mostra o líder e a etapa em curso. A OS
  cancelada mostra o motivo no lugar.
- **Locais.** Origem e destino com a hora da saída e da chegada (das
  etapas), o contato do cliente, as instruções e "Abrir no Maps".
- **Etapas.** As sete, com a hora, quem informou e por onde; a última em
  curso é "desde", a pulada fica com traço e o fim mostra "até" a janela.
- **Itens.** O previsto (o planejado mais o incluído, "150 + 10"), a barra e
  o feito, a hora do último feito e cada inclusão em campo com quem, quando,
  quem pediu, o motivo e as fotos.
- **Fotos, equipe e histórico.** As fotos mais novas com a legenda; a equipe
  com o papel e o vínculo e os veículos; "Alterar" leva ao escalar do Hoje
  enquanto a OS não começou. O histórico junta etapas, inclusões e
  ocorrências, do mais novo para o mais antigo.
- **Código.** A leitura e o que a tela mostra ficam em
  `lib/operacao/ficha-da-os.ts`; a lista das etapas é a do backend (o teste
  lê `functions/operacao/src/domain/execucao.ts`).

### Parte 3.7e: Registrar andamento

Feita em 23/10/2026, no desenho aprovado `OpOS`. Na ficha da OS agendada ou
em execução, "Registrar andamento" abre o painel do escritório com três
abas; a tela confere antes e a callable confere de novo. Regras em
`lib/operacao/andamento.ts`.

- **Etapa.** Só as que vêm depois da última registrada, com a data, a hora
  (fuso de São Paulo), quem da equipe informou e o meio. Vai para
  `registerStep`; a primeira põe a OS Em execução.
- **Itens.** O feito de cada linha, com o previsto ao lado. Só as linhas que
  mudaram vão para `registerItem`, uma chamada por linha. "Incluir além do
  planejado" escolhe a linha da OS ou um item avulso, com a quantidade, quem
  pediu no local e o motivo. Antes da primeira etapa, os itens não se
  registram.
- **Ocorrência.** A descrição, quem informou e as fotos, que sobem depois da
  ocorrência e são anexadas a ela.
- **Fotos.** O cartão das fotos ganha "Anexar": JPG, PNG ou WebP até 8 MB,
  com o nome `ft_` e o instante do arquivo (se for do dia da OS). A foto sobe
  ao Storage e `attachPhoto` a grava.
- **Repetir.** Cada tentativa tem a própria chave, derivada por linha e por
  foto: repetir depois de uma falha no meio não duplica nada.
- **Trava.** Toda callable que o app chama existe em `functions/operacao`
  (o teste lê o `index.ts`).

### Parte 3.8a: campo no backend

Feita em 23/10/2026.

- **Quem grava.** `registerStep`, `registerItem`, `registerOccurrence`,
  `attachPhoto` e a nova `registerPresence` atendem também o papel `campo`
  (`requireOperacaoCaller(..., { campo: true })`; o teste das callables
  trava quais). O campo só grava na OS em que está escalado
  (`equipe_uids`, o mesmo critério das regras); o canal é celular, sem meio,
  e quem informa é o colaborador ligado ao login (o pedido não escolhe
  outro). O cadastro e o planejamento continuam só de owner, admin e
  interno.
- **`registerPresence`.** A entrada ou a saída de alguém da equipe, com o
  instante. O líder marca todos; quem não é líder marca só a própria; o
  escritório marca qualquer um. Vale a primeira marca: a segunda não muda
  nada nem gera evento. A saída pede a entrada antes e não vem antes dela.
  Evento `os.presence_recorded` com o id do cadastro, o tipo, o instante e o
  canal. É o que paga a diária do freelancer e do terceiro, cujo valor fica
  no RH e no Financeiro.
- **Nome do cliente na OS.** `cliente_nome`, copiado da demanda ao abrir,
  planejar e agendar: o campo lê a OS e não o cadastro do cliente (decisão
  que a parte 3.4b deixou para esta). O evento continua sem nome.
- **Catálogo.** O campo lê `lpu_items` (sem preço) para incluir o item
  executado além do planejado; tabela de preço e autorização continuam fora.
- **Quem é quem no celular.** Cada pessoa da `equipe` da OS leva o
  `usuario_uid` do login ligado no cadastro (o mesmo que vai para
  `equipe_uids`): é como o app do campo sabe qual pessoa da equipe é quem
  está nele (o líder, por exemplo). CPF continua fora.

### Parte 3.8b: campo no celular

Feita em 23/10/2026, nos desenhos aprovados `Campo2Hoje`, `Campo2Execucao` e
`Campo2IncluirItem`, em `/campo` e `/campo/os?numero=`, com shell próprio de
celular (sem barra lateral). O papel `campo` entra direto nele; owner e admin
abrem para conferir. Só existe onde a Operação está liberada.

- **Minhas OS.** O dia e a saudação; Agora (em execução e agendada até hoje,
  com a etapa em curso, o local, o destino, a equipe e a frota, e "Continuar
  OS"), Depois (os próximos dias) e Feito (concluídas nos últimos 7 dias). A
  consulta é só por `equipe_uids`, o filtro que as regras pedem.
- **OS no celular.** A duração desde a saída do pátio e a janela; as sete
  etapas com a próxima num botão grande ("Registrar saída da origem") e
  "Outra etapa" para pular; os itens com + e − até o previsto e "Além do
  planejado · Incluir"; "Incluir item executado" com a busca na OS e no
  catálogo sem preço, o item avulso, a quantidade, quem pediu no local (os
  contatos da OS ou outra pessoa) e o motivo; a equipe com entrada e saída
  (o líder marca todos, os outros só a própria, pela pessoa da equipe ligada
  ao login); "Tirar foto" com a câmera; e "Registrar ocorrência" com fotos.
- **Fila.** Cada toque vira um registro com a própria chave e o instante do
  toque, enviado um de cada vez, na ordem. O feito de uma linha é absoluto:
  toques seguidos viram um registro só. Sem sinal ou com o servidor fora, o
  registro espera e tenta de novo (2 s, 4 s, 8 s... até 1 minuto, e já
  quando o sinal volta); recusado pela callable, sai da fila e aparece no
  topo como falha. O que espera aparece como guardado na tela e no aviso
  "Sem sinal · N registros guardados". Por enquanto a fila vive na memória
  do app; guardá-la no aparelho é a parte 3.8c.
- **Fotos.** O nome `ft_` e o instante saem na hora da foto; a foto sobe ao
  Storage antes do `attachPhoto`. A da ocorrência e a da inclusão vão com a
  legenda, porque o número da ocorrência e o da linha nova só existem depois
  que o registro chega.

### Parte 3.8c: fila sem sinal

Feita em 23/10/2026. A fila do campo (parte 3.8b) passa a viver no
aparelho: `lib/campo/fila-guardada.ts` guarda cada registro que ainda não
chegou no IndexedDB do navegador, com a foto dentro, a chave de
idempotência e o instante do toque.

- **Fechar o app sem sinal não perde nada.** Ao abrir, a fila guardada da
  pessoa volta antes do que já foi tocado, e nada sai antes de ela carregar
  (a ordem continua a dos toques). O que chega sai do aparelho.
- **Dois envios, um registro.** O registro reenviado depois de fechar o app
  vai com a mesma chave: a callable devolve o mesmo resultado sem gravar de
  novo (partes 3.7 e 3.8a). O instante é sempre o do toque, nunca o do envio.
- **Por pessoa.** O celular pode ser de mais de um: cada login vê só os
  registros dele.
- **Sem IndexedDB** (aba privada, navegador antigo), a fila fica só na
  memória, como na 3.8b.
- **Testes.** O IndexedDB dos testes é o `fake-indexeddb` (dependência de
  desenvolvimento do app). O teste da fila no navegador simulado registra sem
  sinal, fecha e abre o app, devolve o sinal e confere a chamada única com a
  chave e o instante originais.

### Parte 3.9a: conclusão no backend

Feita em 23/10/2026. `completeServiceOrder` em `functions/operacao` (owner,
admin, interno e o campo escalado), regras em `domain/conclusao.ts` e
gravação em `domain/conclusao-gravacao.ts`.

- **Aceite.** Com assinatura, o responsável do cliente (nome; cargo e
  documento quando houver) assina e a imagem sobe antes ao Storage, em
  `os/{numero}/assinatura/as_<16 hex>.png` (ou `.jpg`, `.webp`, até 8 MB):
  sobe quem coordena ou está escalado, só com a OS em execução, sem
  sobrescrever nem apagar; lê também o suporte (teste no emulador em
  `functions/wms/src/operacao-fotos.rules.test.ts`). A callable confere que o
  arquivo chegou e é imagem. Sem responsável, a OS conclui "sem aceite no
  local" com o nome de quem recebeu, e o aceite vem pela validação do
  cliente no Comercial (resposta 4).
- **O que a conclusão pede.** A OS em execução; a hora não vem antes da
  última etapa; ao menos uma foto do final (as da etapa Fim, anexadas antes
  por `attachPhoto`); e o motivo de cada item feito a menos que o previsto (o
  item sem feito conta zero). O motivo de um item que já não tem diferença
  (o feito chegou antes por outro aparelho) fica de fora, sem recusar: o
  responsável não precisa assinar de novo. No
  celular, quando a OS tem líder, só ele conclui; o escritório conclui com
  quem informou e o meio.
- **O que grava.** `conclusao` na OS (o instante, o canal, quem informou, o
  aceite, o responsável, o caminho da assinatura e as diferenças com o
  previsto, o feito e o motivo), a etapa Fim quando ainda não estava
  registrada e o status Em revisão. Depois disso a OS não recebe mais
  andamento; a revisão (parte 3.10) decide as diferenças.
- **Eventos.** `os.completed` (o instante, o canal, quem informou, o aceite,
  quantos itens ficaram a menos e quantas fotos do final), `os.signed` ou
  `os.completed_without_acceptance`, e `os.step_recorded` do Fim quando a
  conclusão o registra. O nome, o cargo e o documento do responsável e os
  motivos ficam só na OS.

### Parte 3.9b: concluir no celular

Feita em 23/10/2026, no desenho aprovado `Campo2Concluir`, em
`/campo/concluir?numero=`. Na OS em execução, "Concluir OS" aparece para o
líder (ou para qualquer um da equipe quando a OS não tem líder). Regras em
`lib/campo/concluir.ts`; a callable confere de novo (parte 3.9a).

- **Itens.** O feito contra o previsto, com o que ainda está na fila por
  cima; o item a menos mostra a diferença ("−2") e pede o motivo; a inclusão
  em campo aparece na linha. "Corrigir" volta à OS.
- **Fotos do final.** As da etapa Fim, gravadas e guardadas; "Tirar foto"
  anexa com a etapa Fim, pela fila.
- **Responsável.** O nome vem do contato do destino (ou da origem); cargo e
  CPF ou RG. A assinatura é no dedo, num quadro que não rola a página: na
  tela, o traço tem a cor do tema; a imagem que sobe ao Storage é tinta
  escura no branco, como no papel. Um toque sem traço não conta; "Limpar"
  apaga.
- **Sem responsável no local.** Pede só quem recebeu e conclui "sem aceite
  no local".
- **Pela fila.** A conclusão vai depois das fotos e dos feitos tocados
  antes, com a assinatura subindo ao Storage antes da callable. A tela
  confirma ali mesmo, sem trocar de rota no mesmo toque, para a fila
  guardar o registro no aparelho antes de a pessoa sair. Guardada a
  conclusão, a OS para de receber registros no celular ("OS concluída ·
  guardada").

### Parte 3.9c: concluir pelo escritório e a conclusão na ficha

Feita em 23/10/2026, no desenho aprovado `OpOS`.

- **Pelo escritório.** "Registrar andamento" ganha a aba Conclusão, na OS em
  execução: a data e a hora do fim, quem informou e o meio, o motivo de cada
  item a menos, as fotos do final e o aceite. "Via assinada no papel" pede o
  responsável (nome; cargo e CPF ou RG) e a foto da via assinada, que vira a
  assinatura no Storage; "Sem aceite no local" pede quem recebeu. Sobem
  antes as fotos do final (etapa Fim) e a via assinada; `completeServiceOrder`
  vem por último, com a chave da tentativa (repetir não duplica). A tela
  confere antes (`lib/operacao/andamento.ts`); a callable confere de novo.
- **Na ficha.** Concluída, a OS mostra o cartão Conclusão: o aceite
  ("Assinada 17:52 por Renata Campos" ou "Sem aceite no local · recebido
  por"), o cargo e o documento, por onde veio, a imagem da assinatura e o
  motivo de cada item a menos. O passo Concluir mostra o aceite, e o
  histórico ganha a conclusão.

### Parte 3.9d: OS impressa

Feita em 23/10/2026, no desenho `OSImpressao`, em
`/operacao/os/impressao?numero=` (owner, admin e interno; "Imprimir" na
ficha da OS). É a via operacional: o papel que a equipe leva ao local e o
cliente assina quando não há o celular.

- **O que tem.** O emissor (o mesmo do orçamento do Comercial, com o CNPJ
  quando o Leonardo informar), o número, os serviços, a emissão e o status;
  o cliente, a demanda e o pedido; a data e a janela, o líder, a equipe com o
  papel e o vínculo e os veículos; a origem e o destino com o contato; os
  itens com o previsto e o feito em branco; as instruções; e as linhas de
  assinatura do líder, do motorista e do cliente.
- **Concluída**, o feito entra na coluna e o aceite (com a imagem da
  assinatura) no lugar da linha do cliente.
- **Sem valor.** O mockup de 19/10 tinha o valor da mercadoria; fica de fora,
  porque a Operação nunca vê valores. O teste trava "R$", valor, preço e
  total.
- **Impressão.** É a do navegador (Imprimir → Salvar como PDF), como o
  orçamento: só a área `.print-area` sai, em A4. O papel fica branco nos dois
  temas (`PAPER_FILES` no teste do tema).

### Parte 3.10a: revisão no backend

Feita em 23/10/2026. `reviewServiceOrder` e `reopenServiceOrder` em
`functions/operacao` (owner, admin e interno; reabrir, só owner e admin).
Regras em `domain/revisao.ts`, gravação em `domain/revisao-gravacao.ts`.

- **Decisões.** Cada linha em que o executado difere do planejado leva uma
  decisão; a que não difere não leva. Feito a mais: cobrar na execução (na
  demanda direta, ou quando o saldo livre do escopo cobre o que passou),
  pedir aditivo ao Comercial (só a demanda com escopo fechado) ou absorver
  sem cobrar, com motivo. Feito a menos: passar para a próxima OS (o que
  falta volta ao saldo) ou encerrar sem executar. Antes de decidir, o
  executado pode ser corrigido, com motivo, até o previsto; decide-se o que
  resta. Divergência sem decisão não revisa nada.
- **Consumido e a cobrar.** Cada linha guarda o `consumido` (o executado
  quando se cobra o a mais ou o a menos volta ao saldo; o planejado nos
  outros casos), que é o que o saldo passa a contar, no backend e no app; o
  planejado fica, para a IA medir o erro do planejamento. E o `a_cobrar`, o
  que a execução fatura (o aditivo se fatura com o aceite dele).
- **Horas.** A janela planejada e o real (da primeira etapa à conclusão), em
  minutos, e o tamanho da equipe, na revisão e no evento.
- **Na demanda.** O resumo `operacao` é recontado a cada revisão a partir de
  todas as OS da demanda: as revisadas e as em aberto, o período, por linha o
  executado, o que se cobra, o absorvido e o aditivo, e os aditivos pedidos.
  O Comercial só lê (o teste lê o código do Comercial e trava). A demanda
  direta aberta pela Operação vai à Execução a orçar quando a última OS dela
  é revisada: `executado_de` e `executado_ate` (o período), o registro da
  execução com `origem: "operacao"`, a etapa e o marco.
- **Reabrir.** A OS revisada volta a Em execução; a revisão e a conclusão
  ficam em `revisoes_anteriores`, com quem reabriu e o motivo. A demanda
  direta volta a Para planejar. Não reabre com a execução já validada pelo
  cliente, nem com o orçamento da execução da direta já aberto no Comercial.
- **Eventos.** `os.reviewed` (linhas, divergências, corrigidas, a contagem de
  cada decisão, minutos planejados e reais, pessoas), `os.addendum_requested`,
  `os.reopened` e `demand.execution_reviewed`. Sem motivo nem nota.
- **Cancelar em execução.** A OS em execução não se cancela: conclui com o
  que foi feito, e a revisão devolve o resto ao saldo (Passar para a próxima
  OS) ou o encerra. Cancelar perderia o executado, que é cobrança e medida.

### Parte 3.10b: tela Revisão

Feita em 23/10/2026, no desenho aprovado `OpRevisao`, em
`/operacao/revisao` (owner, admin e interno; item Revisão no menu da
Operação; "Revisar" na ficha da OS em revisão). Regras em
`lib/operacao/revisao.ts`; a callable confere de novo (parte 3.10a).

- **Para revisar.** As OS em revisão, quem espera há mais tempo primeiro, com
  as divergências e o aceite.
- **A OS da vez.** A conclusão em texto ("Concluída em campo 17:20 · assinada
  17:52 por"), "Ver OS" e "Imprimir"; as conferências (as fotos, a
  assinatura, as horas reais contra as planejadas e a equipe, e os itens com
  divergência); e os itens com o planejado, o executado, a diferença, o
  orçado (ou o pedido, na direta) e o saldo da demanda, que segue a decisão.
- **Divergências.** Cada uma com o que aconteceu (a inclusão em campo, o
  motivo dito na conclusão) e só as decisões que valem para ela: acima do
  orçado, aditivo ou absorver; dentro do saldo livre, cobrar também; na
  direta, cobrar ou absorver; a menos, próxima OS ou encerrar; e "Corrigir
  quantidade", que pede a quantidade e o motivo e decide o que resta. O botão
  diz "Concluir revisão e pedir aditivo" quando há aditivo. A sugestão do
  Agent Dute do desenho entra na Fase 5.
- **Na ficha.** A OS revisada mostra o cartão Revisão (a decisão de cada
  divergência e a nota), o passo Revisar e o histórico. Owner e admin veem
  "Reabrir", com o motivo.

### Parte 3.10c: o aditivo e a execução no Comercial

Feita em 23/10/2026, no app do Comercial, só lendo o resumo `operacao` da
demanda (parte 3.10a). Regras em `lib/comercial/aditivos-da-operacao.ts`.

- **Aditivo a fazer.** O Início do Comercial ganha um item por demanda com o
  aditivo pedido pela revisão da Operação ("Aditivo a fazer · 10045", o
  cliente, os itens a mais e o dia do pedido), que abre o orçamento. Fica até
  o Comercial abrir a RV de aditivo depois do pedido (pelo caminho que já
  existe: Aditivo, motivo aditivo) ou registrar uma recusa de aditivo
  depois dele, e só enquanto a demanda está em Para planejar ou Execução a
  orçar. Owner, admin e comercial.
- **No orçamento.** Com uma OS revisada, o orçamento mostra "Execução na
  Operação": as OS revisadas e o período e, por linha, o executado, o que se
  cobra, o absorvido e o que foi para aditivo, e o aditivo pedido em
  destaque enquanto espera. É o que o Comercial usa na RV de execução
  (executado a menos reduz o faturado) e na de aditivo. Sem valor.

### Parte 3.10d: orçar a execução da direta aberta pela Operação

Feita em 23/10/2026. A direta que a Operação abriu (parte 3.4c) chega ao
Comercial em Execução a orçar, sem orçamento, quando a última OS dela é
revisada (parte 3.10a).

- **No backend.** O `saveQuote` ganha a ação `price_execution` (número,
  contrato e tabela Comercial ou Noturna). Ela cria a RV 0 de execução, em
  rascunho, com as linhas que a revisão manda cobrar (`a_cobrar` do resumo
  `operacao`, sem o absorvido), pelo preço da tabela do contrato escolhido.
  - O que a tabela não precifica volta na resposta (`fora_da_tabela`) para o
    Comercial lançar à mão: item avulso, fora da tabela, inativo ou que não
    se orça (armazenagem).
  - O cliente com tabela própria não cai na Padrão Dutelog: sem contrato,
    tudo volta para lançar.
  - O contrato escolhido passa a valer para a demanda, com o regime de
    cobrança dele. A etapa, a execução e o resumo da Operação não mudam.
  - Só a direta aberta pela Operação, em Execução a orçar, sem orçamento,
    não perdida nem cancelada. Recibo em `comercial_operations` e o evento
    `quote.created`, sem valor.
  - Daí em diante é o caminho de toda RV de execução: o "Para" na montagem,
    a aprovação (sem RV fechada para comparar), o envio e a validação.
  - Regras puras em `functions/comercial/src/domain/execucao-da-operacao.ts`.
- **No app.** Na fila, a demanda aparece como "Sem orçamento", sem linhas,
  total nem PDF, com uma só ação: Orçar execução. O diálogo pede o contrato,
  com o vigente do cliente já escolhido, e a tabela. Ao criar, abre a
  montagem e o aviso lista o que fica para lançar. As outras ações pedem o
  orçamento e não aparecem antes dele.

### Parte 3.11a: vistoria no backend

Feita em 23/10/2026, em `functions/operacao`. A vistoria é uma OS
(`tipo: "vistoria"`, sem itens, serviço vistoria) que vai ao local antes do
escopo fechado. Regras em `domain/vistoria.ts`.

- **Abrir.** `saveServiceOrder` ganha a ação `survey`, só para quem coordena.
  - Vale para a demanda do Comercial ainda não fechada pelo cliente, nem
    executada, perdida ou cancelada. A demanda direta não tem vistoria.
  - Uma por vez: a que está em aberto termina ou se cancela antes de outra.
  - O número vem do mesmo contador das OS da demanda. O local é a origem da
    demanda, com o contato no local, se pedido.
  - Com a janela, nasce agendada com a equipe e os veículos. Agendar e
    cancelar são os de toda OS. A vistoria não muda itens.
  - Evento `os.survey_opened`.
- **Executar.** Só ir, chegar e terminar (saída do pátio, chegada e Fim).
  Fotos, ocorrências e presença são as de toda OS; a legenda da foto diz o
  ambiente. A vistoria não tem itens da OS nem conclusão com aceite.
- **Enviar ao Comercial.** A callable `sendSurveyToCommercial` (campo
  escalado ou coordenação) recebe os ambientes, as medidas, o acesso
  (horário e vaga de carga) e as observações.
  - Cada ambiente tem nome único, as fotos já anexadas à OS e os itens do
    catálogo (ativos e orçáveis, uma vez por ambiente, quantidade maior que
    zero). Ao menos uma foto e um item.
  - Pelo celular, quando a OS tem líder, só ele envia. A hora não vem antes
    da última etapa.
  - A OS vai de Em execução a Revisada, com a vistoria e, quando faltava, o
    Fim. Não pede assinatura nem passa pela revisão, e não se reabre: outra
    vistoria se abre.
  - A demanda recebe o resumo `vistoria`, o único campo dela que o envio
    escreve: os ambientes com os itens e os caminhos das fotos, os itens
    somados de todos os ambientes, as medidas, o acesso e as observações. A
    etapa e o orçamento são do Comercial e não mudam.
  - Eventos `os.step_recorded` (o Fim) e `os.survey_sent`, só com as
    contagens. Nomes, medidas e observações ficam na OS e na demanda.
- **Fotos para o Comercial.** O `storage.rules` deixa o papel comercial ler
  as fotos da OS de vistoria, e só dela.
- **Fora do resumo da Operação.** A vistoria não executa o escopo: o resumo
  `operacao` (parte 3.10a) não a conta entre as OS revisadas nem em aberto.
- **Trava.** O teste que impede o Comercial de escrever `operacao` na
  demanda passa a impedir `vistoria` também.

### Parte 3.11b: vistoria no celular

Feita em 23/10/2026, no app do campo (`/campo/os` abre a tela da vistoria
quando a OS é de vistoria; `docs/mockups/Campo2Vistoria.dc.html`). Regras
em `lib/campo/vistoria.ts`.

- **Quem faz.** O líder, ou qualquer um da equipe quando ela não tem líder:
  é quem o servidor deixa enviar pelo celular. Os outros veem com quem está
  a vistoria.
- **Chegada.** "Registrar chegada" vai pela fila; o envio pede a chegada,
  gravada ou guardada.
- **Ambientes.** O líder cria o ambiente pelo nome (único, sem olhar acento
  nem caixa), e o novo passa a ser o atual. No atual, as fotos (pela fila,
  com o nome do ambiente na legenda), os itens levantados do catálogo sem
  preço, com + e −, e "Concluir ambiente", que leva ao próximo a fazer.
- **Medidas, acesso e observações.** Elevador de serviço, carga do elevador
  e porta já vêm na lista; "Nova medida" pede o nome e o valor. A medida sem
  valor não vai.
- **Rascunho no aparelho.** O que se levanta fica guardado no navegador por
  OS e volta ao recarregar; sai quando a OS chega a Revisada. Armazenamento
  bloqueado não quebra a tela.
- **Enviar.** "Enviar vistoria ao comercial" mostra o que falta (chegada, um
  ambiente, uma foto, um item, o nome de cada medida) e vai pela fila,
  depois das fotos. Guardada, a vistoria fica só para ler.
- **Enviada.** A OS mostra a vistoria como foi ao Comercial
  (`components/operacao/vistoria-lida.tsx`, que o escritório também usa).
- A tela de conclusão recusa a OS de vistoria.

### Parte 3.11c: planejar a vistoria pelo escritório

Feita em 23/10/2026. Regras em `lib/operacao/vistoria.ts`, as mesmas do
servidor (o teste confere as mensagens).

- **No Hoje.** A visita técnica que o Comercial pediu (`execucao.visita_tecnica`)
  entra em Para planejar enquanto a demanda recebe vistoria e nenhuma foi
  aberta (a cancelada não conta). O cartão diz "Vistoria" e o dia e leva a
  "Planejar vistoria".
- **Na ficha da demanda.** Antes do escopo fechado, as OS da demanda
  oferecem "Planejar vistoria", com o dia da visita técnica quando há.
- **Planejar vistoria.** A tela de Planejar OS com `&vistoria=1`: uma OS só,
  sem itens, no dia da visita técnica (ou hoje), com a equipe, os veículos,
  o contato no local de origem e as instruções. Agendar ou salvar o rascunho
  (Para agendar) chama `saveServiceOrder` (survey). Os alertas falam da
  vistoria (sem equipe, sem líder, sem veículo, alguém já escalado no dia).
  Quando a demanda não recebe vistoria, a tela diz por quê.
- **Ainda não.** Enviar a vistoria pelo escritório (a equipe sem ninguém com
  o app): por ora a vistoria vai pelo celular do líder, ou de qualquer um da
  equipe sem líder.

### Parte 3.11d: a vistoria na ficha da OS e no andamento

Feita em 23/10/2026, no app da Operação e do campo.

- **O status.** A vistoria revisada aparece como "Enviada ao Comercial" na
  ficha da OS, na demanda, na Agenda, na impressão e no celular
  (`rotuloDoStatusDaOs`). A OS de serviço continua "Revisada".
- **Os passos.** A vistoria tem três: Agendar, Executar (a última etapa) e
  Enviar ao Comercial (a hora do envio).
- **A ficha.** Enviada, a ficha mostra a vistoria como foi ao Comercial
  (ambientes, itens, fotos, medidas, acesso e observações), sem o cartão de
  itens. "Reabrir" não aparece na vistoria (o servidor recusa).
- **Registrar andamento.** Na vistoria, só a etapa (saída do pátio e
  chegada) e a ocorrência; os itens, a conclusão e o Fim não, porque a
  vistoria vai ao Comercial pelo celular.

### Parte 3.11e: a vistoria no Comercial

Feita em 23/10/2026. Regras em `lib/comercial/vistoria-da-operacao.ts`.

- **Na montagem.** O orçamento mostra "Vistoria da Operação": a OS e a hora
  do envio, os itens levantados (somados), o que a tabela não precifica
  ("Fora da tabela", para lançar à mão), os ambientes com as fotos (o
  comercial lê as da OS de vistoria), as medidas, o acesso e as
  observações. Sem valor.
- **Carregar itens no orçamento.** No rascunho, o botão põe os itens nas
  linhas pela tabela: o item que já está numa linha da tabela fica com a
  quantidade levantada; o outro entra numa linha nova. Ao salvar, o
  orçamento guarda a vistoria que carregou (`vistoria_os`); o servidor
  confere que é a enviada para a demanda e o evento `quote.updated` leva a
  OS. Carregada, o cartão diz "Itens carregados no orçamento".
- **No Início.** "Vistoria concluída" (cliente, itens levantados e o dia do
  envio) espera, na montagem, até o orçamento carregar os itens dela. Uma
  vistoria nova, enviada depois, espera de novo. Owner, admin e comercial.

### Parte 3.12a: o quadro da TV no backend

Feita em 23/10/2026. Regras em `functions/operacao/src/domain/tv.ts`; a
leitura em `tv-leitura.ts`.

- **`getRoomBoard`.** Atende o papel `painel` e quem coordena (owner, admin e
  interno, para conferir). É a única callable que atende o painel: as
  outras o recusam ("Seu perfil não grava o cadastro da Operação"), inclusive
  as do campo. Só lê: nenhum recibo, evento ou gravação.
- **O quadro do dia.** Três colunas: a agendada para hoje (ou para um dia
  que já passou, sem ter começado), a em execução e a concluída hoje (a
  etapa Fim no dia de São Paulo). A aberta sem data, a cancelada, a agendada
  para outro dia e a concluída antes de hoje ficam fora.
- **Campo a campo.** Por OS: número, tipo, coluna, cliente, serviços, a rota
  pelo nome dos locais, o dia e a hora marcados, o prazo (o da demanda direta ou o
  fim da janela), a última etapa, as etapas feitas e previstas, a hora do
  Fim e o aceite, os nomes da equipe e as placas. Nada de valor, contato,
  telefone, endereço, instruções, ocorrência, foto, motivo de cancelamento,
  CPF ou documento de quem assinou.
- **Sem índice novo.** Duas consultas de um campo só: o status (agendada e
  em execução) e `updated_at` desde o começo do dia (a conclusão grava).
- **Regras.** O painel continua sem ler coleção nenhuma pelo navegador: OS,
  demanda, cliente, evento, colaborador e veículo recusam (teste no
  emulador).

### Parte 3.12b: a TV da sala

Feita em 23/10/2026. Regras em `lib/tv/quadro.ts`; a tela em
`pages/tv/tv-view.tsx` (`docs/mockups/TVSala.dc.html`).

- **Entrada.** O papel `painel` passa a ter a Operação
  (`MODULOS_POR_PAPEL`) e a casa dele é `/tv`: entra direto na TV onde a
  Operação está liberada. Owner, admin e interno abrem `/tv` para conferir;
  o resto do app continua fechado ao painel.
- **Tela cheia, escura e sem ação.** Sem menu, sem botão, sem link e sem
  campo. O escuro vale só dentro da TV: o tema de quem abre para conferir
  não muda. A tela pede ao navegador para não apagar (Screen Wake Lock),
  onde ele deixa. Para sair, o painel abre `/configuracoes/conta`.
- **O que mostra.** A data, o relógio, os indicadores (OS hoje, agendadas,
  em execução, concluídas, atrasadas e a próxima saída) e três colunas. Cada
  cartão traz a hora, o número, o cliente, o serviço com a rota e o prazo,
  a equipe e a placa. A em execução mostra as etapas e a última, com a
  hora. A concluída mostra a hora do Fim e "Assinada", "Concluída" ou
  "Enviada ao Comercial". Sem valor.
- **Atraso pelo relógio da TV.** A agendada que passou da hora (ou de um
  dia que já foi) sem começar e a em execução que passou do prazo ficam
  "Atrasada 32 min" e sobem para o topo da coluna. "Sem equipe" e "Sem
  veículo" (só no transporte) alertam a agendada.
- **Atualiza sozinha.** Relê o quadro a cada 30 segundos e anda o relógio a
  cada 15. Sem conexão, segue com o último quadro e o rodapé diz "Sem
  conexão · atualizado às 14:31". Coluna cheia mostra "+ 2 OS"; quantos
  cartões cabem sai da altura da tela (três a 1080 px).
- **Sessão longa.** O login do Firebase fica guardado no navegador e se
  renova sozinho: a TV continua entrando até alguém sair ou desligar o
  acesso em Pessoas.

### Parte 3.13a: a rotina diária no backend

Feita em 23/10/2026. Regras em `functions/operacao/src/domain/rotina.ts`; a
gravação em `rotina-gravacao.ts`.

- **`runDailyAlerts`.** Todo dia às 06:00 de São Paulo (Cloud Scheduler,
  como a rotina do Agent Dute no WMS). Fora da liberação da Operação, não
  faz nada.
- **Os alertas.** A CNH de quem está ativo que vence em até 30 dias, ou já
  venceu, vira `collaborator.cnh_expiring`. A revisão preventiva do veículo
  ativo em até 15 dias, ou com a data já passada, vira
  `vehicle.maintenance_due`. As janelas são as do Início. Cadastro ilegível
  fica de fora.
- **Uma vez por dia por item.** O id do evento sai do dia e do item: rodar
  de novo no mesmo dia não duplica; no dia seguinte, sai de novo enquanto o
  alerta valer. O payload é o id, o dia e quantos dias faltam (negativo: já
  passou), sem nome, CPF, categoria, validade nem placa. O ator é
  `rotina-diaria`.
- **O veículo no dia da revisão.** `revisao_em` é o dia da revisão
  preventiva: o planejamento, o agendamento e a vistoria recusam o veículo
  nesse dia ("O veículo DEF-4G56 está em revisão preventiva em 01/01/2099.").
  No dia seguinte, ele volta. Para tirar o bloqueio, muda-se a data no
  cadastro do veículo.

### Parte 3.13b: os alertas no Início e a revisão na escala e na Agenda

Feita em 23/10/2026. Regras em `lib/operacao/pendencias.ts`,
`lib/operacao/planejar.ts` e `lib/operacao/agenda.ts`.

- **OS perto do prazo, desfalcada.** A agendada para hoje ou amanhã sem
  equipe, ou com transporte e sem veículo, vira "OS 10045-01 sem equipe",
  "sem veículo" ou "sem equipe e sem veículo", com "Escalar"; hoje é
  crítica. A vistoria e a montagem no local não pedem veículo.
- **A aberta da demanda direta perto do prazo.** Com o prazo em até 24
  horas, ou passado, vira "OS 10053-01 sem agenda" com o prazo e quanto
  falta ("Hoje até 19:00 · faltam 4h40"), crítica, e sai da conta de "OS
  para agendar". A OS passa a ler o prazo da demanda (`executar_ate`).
- **Revisão do veículo.** O veículo ativo com a revisão preventiva em até 15
  dias, hoje ou com a data passada vira "Revisão do DEF-4G56 em 5 dias", "é
  hoje" ou "passou em 20/10/2026", com "Ver cadastro" (a ficha abre direto,
  `/operacao/veiculos?id=`). A OS agendada com o veículo no dia da revisão
  deixa o item crítico, com "Reagendar". As janelas de 30 dias da CNH e 15
  da revisão são as da rotina diária (o teste lê as duas).
- **Escala e planejamento.** No dia da revisão, o veículo aparece como
  "Revisão preventiva" e não se escolhe; escolhido antes de mudar a data, a
  escala diz "DEF-4G56 em revisão preventiva no dia" e não salva. Agendando
  pelo planejamento, o mesmo impede ("A OS: DEF-4G56 está em revisão
  preventiva no dia."). O servidor recusa do mesmo jeito (parte 3.13a).
- **Agenda.** A linha do veículo mostra "Revisão preventiva" no dia, como no
  mockup `OpAgenda`.

### Parte 3.14: produção e registro

Feita em 23/10/2026, até onde não depende do Leonardo.

- **O ciclo no emulador.** O "pronto quando" da Fase 3 virou teste em
  `functions/operacao/src/domain/ciclo.integration.test.ts`:
  - a demanda direta vai do pedido a duas OS, à execução no celular com item incluído em campo, à assinatura, à revisão e a Execução a orçar;
  - a demanda do Comercial vai do escopo fechado à OS, ao item a mais e ao aditivo pedido;
  - a TV mostra a agendada de manhã e a assinada no fim do dia;
  - cada etapa fica com o instante;
  - nenhuma OS guarda preço, total ou valor.
  - O ciclo roda no dia de hoje: a TV acha as concluídas pelo `updated_at` que o servidor grava.
- **O roteiro.** Em `docs/plataforma/operacao-producao.md`:
  - o que muda no `dute-prod` desde a última publicação (`fde9ba0`);
  - o que conferir na homologação antes;
  - como publicar e o que conferir depois (o job da rotina, o login da TV e o do campo);
  - como desligar a Operação ou só a rotina.
- **Falta.** O OK do Leonardo para publicar (marco 3 do plano de implantação) e a conferência na homologação, que é de uma pessoa.


### Correção: a OS cancelada depois da revisão deixava a demanda direta parada

Achada em 25/10/2026, numa revisão do código da Operação.

- **O defeito.** Só a revisão recontava o resumo da demanda
  (`demands/{numero}.operacao`) e levava a demanda direta à Execução a
  orçar. O cancelamento gravava só a OS.
  - Um exemplo: a demanda direta tinha duas OS, a primeira foi revisada com
    a segunda ainda agendada, e depois a segunda foi cancelada.
  - A demanda ficava em Para planejar para sempre, com a cancelada em
    `os_em_aberto`.
  - O Comercial não orçava a execução, e o que foi feito não chegava à
    cobrança. A mesma situação com a ordem trocada (cancelar e depois
    revisar) já dava certo.
- **A correção.** Quando a demanda já tem OS revisada, cancelar reconta o
  resumo sem a cancelada.
  - Se a direta fica sem OS em aberto, ela vai à Execução a orçar com o
    mesmo `executado_de`, `executado_ate`, `registro_execucao` e marco da
    revisão, e grava o evento `demand.execution_reviewed`.
  - O fechamento e a lista das OS para o resumo saíram de
    `revisao-gravacao.ts` para `revisao.ts` (`fechamentoDaDireta` e
    `paraResumo`), e a revisão e o cancelamento usam os mesmos.
  - Sem OS revisada, cancelar continua sem gravar o resumo.
- **Testes** (`revisao.integration.test.ts`):
  - com a primeira OS revisada e a segunda cancelada depois, a demanda vai à
    Execução a orçar, com o evento. Antes, ficava em Para planejar com a
    cancelada em aberto;
  - cancelar antes de qualquer revisão não grava o resumo nem muda a etapa.

### Correção: a rotina diária parava inteira por uma data antiga

Achada em 25/10/2026, numa revisão do código da Operação.

- **O defeito.** O evento do alerta (`collaborator.cnh_expiring` e
  `vehicle.maintenance_due`) aceitava `dias` só entre -3.650 e 3.650, mas o
  cadastro aceita a validade da CNH e a revisão desde 1980.
  - Uma CNH vencida há mais de 10 anos (ou um ano digitado errado) fazia o
    evento falhar.
  - O mais vencido vem primeiro, e cada alerta é uma transação sem
    tratamento de erro: a rotina parava ali, e nenhum alerta do dia era
    gravado, todos os dias, até alguém corrigir a data.
- **A correção.**
  - O evento aceita ±50 mil dias, o intervalo inteiro do cadastro (1980 a
    2100).
  - Um alerta que não grava não segura os outros: a rotina grava os demais
    e falha no fim, com a lista dos que não gravaram, para o erro aparecer
    no painel do sistema.
- **Testes** (`rotina.integration.test.ts`):
  - a CNH vencida em 2015 vira alerta (-4.162 dias), junto com os outros.
    Antes, a rotina falhava sem gravar nenhum;
  - o cadastro gravado fora da callable, com o id fora do formato, não
    segura a CNH da Ana nem a revisão da van, e a rotina falha no fim
    citando o que não gravou.

### Correção: a OS se reabria depois do orçamento da execução enviado

Achada em 25/10/2026, numa revisão do código da Operação.

- **O defeito.** A reabertura conferia o orçamento da execução só com a
  demanda direta em Execução a orçar, mas o Comercial muda a etapa da
  demanda a cada passo do orçamento (para aprovar, para enviar, aguardando
  o cliente).
  - Depois do envio, a OS se reabria: a revisão saía, e o orçamento que o
    cliente via (e podia validar) seguia com os números da revisão que não
    existia mais.
- **A correção.** Com a demanda executada pela Operação, o orçamento da
  execução recusa a reabertura em qualquer etapa. A volta a Para planejar
  continua só na Execução a orçar, quando ainda não há orçamento.
- **Teste** (`revisao.integration.test.ts`): com o orçamento enviado e a
  demanda aguardando o cliente, a OS não se reabre. Antes, reabria.

### Correção: a revisão travava com a OS de meses

Achada em 25/10/2026, numa revisão do código da Operação.

- **O defeito.** A revisão conta o tempo real da primeira etapa à conclusão,
  e o evento `os.reviewed` aceita até 100 mil minutos (cerca de 69 dias).
  - A OS reaberta meses depois guarda as etapas da primeira ida, e a OS
    esquecida aberta acumula o mesmo tempo.
  - Nos dois casos a conta passava do limite, o evento recusava o payload e a
    revisão parava com erro, sem gravar nada. A demanda direta não chegava à
    Execução a orçar.
- **A correção.** Acima de `MINUTOS_REAIS_PLAUSIVEIS` (100 mil minutos, em
  `revisao.ts`), a revisão grava `minutos_reais` vazio e segue.
  - O limite do evento é a mesma constante, então os dois não se desencontram.
  - A memória da Dute já ignora a OS sem tempo real, então o erro do
    planejamento não conta a ida de meses como uma só.
  - Alargar o limite do evento, em vez disso, levaria esse tempo para a
    medida do núcleo.
- **Teste** (`revisao.integration.test.ts`): com as etapas de julho e a
  conclusão de outubro, a OS se revisa sem o tempo real, o evento leva
  `minutos_reais: null` e a demanda vai à Execução a orçar. Antes, a revisão
  falhava com "payload inválido".

### Correção: o feito atrasado do celular sobrescrevia um mais novo

Achada em 25/10/2026, numa revisão do código da Operação.

- **O defeito.** O feito da linha é absoluto e guarda a hora em que
  aconteceu (`executado_em`). O registro não olhava essa hora.
  - Um exemplo: o celular da Ana, sem sinal, guardou 96 cadeiras às 11:20, e
    às 11:30 o escritório registrou 120.
  - Quando o sinal voltou, a fila enviou o 96 e a OS voltou para 96, com a
    hora das 11:20. A revisão e a cobrança partiam do número velho.
  - As etapas já recusavam a hora de antes da última.
- **A correção.** O feito com a hora de antes do último registrado na linha
  é recusado: "Cadeira: o feito das 11:20 é de antes do último registrado
  (120, às 11:30)."
  - A fila do celular desiste da recusa e mostra a mensagem na lista do que
    não foi enviado.
  - A mesma hora continua corrigindo. O escritório registra com a hora de
    agora, então só o registro atrasado é recusado.
  - A inclusão em campo continua somando, mas a que chega atrasada não volta
    a hora do último feito.
- **Testes:**
  - `itens-executados.test.ts`: o feito de antes do último é recusado, o da
    mesma hora corrige, e a inclusão atrasada soma sem voltar a hora;
  - `execucao.integration.test.ts`: o feito guardado no celular chega
    depois do registrado pelo escritório e é recusado, e a OS fica com 120 e
    um evento só. Antes, a OS voltava para 96.

### Correção: o app não abria sem sinal

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8c.

- **O defeito.** Ao abrir, o app lê o perfil da pessoa (`users/{uid}`) antes
  de mostrar qualquer rota. O cache do Firestore é só o da memória.
  - Depois de fechar o app, ou de o Android fechá-lo enquanto a câmera do
    "Tirar foto" estava na frente, a leitura sem sinal recusava
    ("client is offline").
  - A tela ficava em branco. A fila guardada (parte 3.8c) só volta com o
    app aberto, então não aparecia nem ia, e nada se registrava.
  - Com o sinal de volta, nada tentava de novo: era preciso abrir o app
    outra vez, com rede.
- **A correção** (`lib/auth.tsx` e `lib/perfil-guardado.ts`):
  - O último perfil lido de cada pessoa fica no aparelho: o papel, o
    cliente e o nome, no `localStorage`.
  - Sem sinal ("unavailable"), o app abre com esse perfil. Sem perfil
    guardado, espera a rede (o evento "online" ou 30 segundos) e lê de novo.
  - Só o servidor muda o acesso. O acompanhamento do perfil ignora o que vem
    do cache, que, sem sinal, diz que o perfil não existe e tiraria a pessoa
    do app no meio do trabalho. Com a rede de volta, o perfil removido ou
    mudado vale na hora, como antes.
  - O logout esquece os perfis guardados no aparelho.
  - Outro erro na leitura (sem permissão) continua como antes, sem usar o
    perfil guardado.
- **Testes:**
  - `auth.test.tsx`: sem sinal, o app entra com o perfil guardado, e o cache
    vazio não tira o acesso; sem perfil guardado, espera a rede e lê de
    novo; com rede, guarda o perfil; o logout esquece. Antes, a tela ficava
    em "carregando".
  - `perfil-guardado.test.ts`: o que não é perfil ativo não vale, e sem
    storage nada quebra.

### Correção: a recusa da conclusão sumia na troca de tela

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8b.

- **O defeito.** O registro que a callable recusa sai da fila e vira uma
  falha no topo, com o botão Dispensar. A falha ficava só no estado da
  tela, e cada tela do `/campo` monta a fila de novo.
  - Um exemplo: às 17:20, sem sinal, o líder colhe a assinatura do cliente
    e a tela diz "concluída". O escritório, avisado por telefone, registra
    a montagem às 17:40.
  - Às 18:00 o sinal volta. A assinatura sobe, e o `completeServiceOrder`
    recusa ("A hora vem antes de Montagem").
  - A faixa vermelha sumia no primeiro toque em "Minhas OS", sem ninguém
    ver. A OS ficava sem a conclusão, e o cliente já tinha ido embora.
- **A correção.** As falhas ficam guardadas no aparelho, por pessoa
  (`localStorage`, `dute.campo.falhas.<uid>`), até a pessoa dispensar.
  Trocar de tela ou fechar o app não as apaga mais.
- **Testes:**
  - `fila-do-campo.test.tsx`: a recusa continua na lista depois de trocar de
    tela e de fechar o app, e sai só quando dispensada. Antes, sumia.
  - `fila-guardada.test.ts`: as falhas ficam por pessoa e sobrevivem a
    fechar o app, e o que não é falha não volta.

### Correção: o registro sem o token saía da fila

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8b.

- **O defeito.** A fila desistia do registro recusado com `unauthenticated`,
  como se fosse uma recusa da regra.
  - A fila só anda com a pessoa logada. Esse erro vem do token vencido
    depois de mais de uma hora sem sinal, quando a renovação falha numa
    oscilação do sinal: a chamada sai sem o token.
  - A etapa, a foto ou a conclusão assinada saíam da fila.
  - A Operação só responde `unauthenticated` quando a chamada chega sem o
    token (`domain/profile.ts`), nunca por regra.
- **A correção.** O `unauthenticated` sai das recusas definitivas
  (`lib/campo/fila.ts`): o registro espera e tenta de novo, como sem sinal.
- **Teste:** `os-no-campo.test.ts`: `unauthenticated` tenta de novo, com e
  sem o prefixo `functions/`. Antes, desistia.

### Correção: o toque depois da inclusão guardada apagava a inclusão

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8b.

- **O defeito.** O feito da linha é absoluto, e a inclusão soma ao feito. Com
  um feito guardado, a tela mostrava só ele e ignorava a inclusão guardada
  depois.
  - Um exemplo: a cadeira tem 150 previstas e 96 gravadas, sem sinal. O "+"
    guarda 97, e a inclusão de 10 vem depois. A tela mostrava 97 de 160, e
    com sinal mostraria 107.
  - O "+" seguinte mandava 98, que substituía o 97 e ia depois da inclusão.
    O servidor gravava 106 com a inclusão e depois 98: a inclusão se
    perdia.
  - Os mesmos toques com sinal davam 108.
- **A correção.** A tela soma ao feito guardado as inclusões guardadas
  depois dele, na ordem da fila (`itensNoCampo`). O toque seguinte já leva a
  inclusão no número: 108.
- **Teste:** `os-no-campo.test.ts`: a inclusão depois do feito guardado
  entra no número (107), o toque seguinte manda 108 e vai depois da
  inclusão, e a inclusão antes do feito não conta duas vezes. Antes, a tela
  mostrava 97.

### Correção: a foto recusada travava o envio da vistoria

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.11b.

- **O defeito.** O rascunho da vistoria guarda o id de cada foto quando ela
  entra na fila e nunca conferia se a foto chegou à OS.
  - Um exemplo: numa vistoria de 25 ambientes, a 201ª foto da OS é recusada
    ("A OS já tem 200 fotos."). A tela deixa 50 por ambiente, sem conferir o
    total.
  - A foto saía da fila, e o id dela ficava no ambiente.
  - O "Enviar vistoria ao comercial" era recusado ("uma foto não está na OS")
    a cada envio, e a tela não tem como tirar a foto. Restava cancelar a
    vistoria e voltar ao cliente.
- **A correção.** A foto que o servidor recusa sai da vistoria.
  - A fila tira o id dela do rascunho guardado da OS na hora da recusa, com
    a tela da vistoria aberta ou não (`tirarFotosRecusadas`).
  - A falha leva o id da foto, e a tela aberta o tira do rascunho dela
    (`semFotosRecusadas`), que senão gravaria a foto de volta.
  - A faixa da falha diz por quê. A foto some do ambiente e não volta ao
    dispensar a falha.
- **Testes:**
  - `fila-do-campo.test.tsx`: a foto recusada leva o id na falha e sai do
    rascunho guardado. Antes, ficava.
  - `vistoria.test.tsx` (página): com a tela aberta, o rascunho grava sem a
    foto recusada. Antes, gravava com ela.
  - `vistoria.test.ts`: a foto sai de todos os ambientes, e sem ela no
    rascunho nada se regrava.

### Correção: o toque duplo registrava a ação seguinte

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8b.

- **O defeito.** Registrado o toque, o botão vira na hora a próxima ação:
  "Entrada" vira "Saída", e a etapa vira a seguinte.
  - O toque duplo em "Entrada" às 07:30 marcava também a saída às 07:30. A
    primeira saída vale, e a presença é o que paga a diária do freelancer
    (parte 3.8a).
  - O toque duplo numa etapa registrava a seguinte no mesmo segundo. A de
    verdade, depois, era recusada como já registrada.
- **A correção.** O segundo toque do mesmo botão dentro de um segundo é
  ignorado (`lib/campo/toque-unico.ts`): nas etapas, pela OS, e na
  presença, por pessoa. O "+" e o "−" dos itens continuam livres, porque o
  toque rápido ali é contar.
- **Teste:** `os-view.test.tsx`: o segundo toque logo depois não registra a
  etapa seguinte nem a saída, e um segundo depois a etapa seguinte vai.
  Antes, as duas iam.

### Correção: a fila guardada se apagava ao gravar

Achada em 25/10/2026, numa revisão da fila do campo. Está na produção desde
a parte 3.8c.

- **O defeito.** Cada mudança da fila apagava a fila guardada inteira da
  pessoa e regravava a da tela.
  - Se a leitura do aparelho falhasse ao abrir, a fila da tela começava
    vazia, e a primeira gravação apagava o que estava guardado: etapas,
    fotos e a conclusão assinada.
  - Com o app aberto em duas cópias, o instalado e um link do WhatsApp no
    navegador, cada gravação apagava os registros da outra. Quando o
    Android fechava a que ficou atrás, o que ela não tinha enviado se
    perdia.
- **A correção.** Cada registro é gravado por si, e só sai do aparelho o
  que essa tela viu sair da fila (`lib/campo/fila-guardada.ts` e
  `fila-do-campo.tsx`): o que chegou, foi recusado ou foi substituído. O
  que a tela não conhece fica. A fila guardada volta na ordem dos toques,
  pelo instante de cada registro.
- **Testes:**
  - `fila-do-campo.test.tsx`: com a leitura falhando ao abrir, o registro
    novo se junta ao guardado e não o apaga.
  - `fila-guardada.test.ts`: duas cópias gravando não se apagam, e a fila
    volta na ordem dos toques.
  - Antes, o guardado sumia.

### Correção: o Reagendar gravava o formulário velho por cima da mudança

Achada em 25/10/2026, numa revisão do que as telas do escritório mandam ao
servidor. Está na produção desde a parte 3.5a.

- **O defeito.** O painel Escalar/Reagendar, no Hoje e na Agenda, copiava a
  OS quando abria, mas mandava à callable a edição da lista ao vivo.
  - Se outra pessoa, ou outra aba, reagendasse a OS com o painel aberto, a
    conferência de edição do servidor passava, e o formulário velho (data,
    hora, equipe e veículos de antes) apagava a mudança.
  - A equipe errada recebia a OS no app do campo.
- **A correção.** A edição que vai para a callable é a de quando o painel
  abriu (`pages/operacao/use-escala.tsx`), como no Comercial e no cadastro
  da Operação. Se a OS mudou, o servidor recusa ("A OS foi atualizada.
  Recarregue e tente de novo."), e a pessoa abre o painel de novo.
- **Teste:** `use-escala.test.tsx`. Com a OS reagendada por outra tela,
  reagendar e cancelar levam a edição da abertura. Antes, levavam a da lista
  ao vivo.

### Correção: tentar de novo o andamento do escritório era recusado

Achada em 25/10/2026, na mesma revisão. Está na produção desde a parte 3.7e.

- **O defeito.** O painel Registrar andamento da ficha da OS cria a chave
  de idempotência quando abre, mas a ocorrência e a inclusão de item
  levavam o instante de cada clique.
  - Depois de um sucesso pela metade (a ocorrência gravou e a foto 2 não
    subiu, ou a resposta se perdeu), a nova tentativa ia com a mesma chave
    e outro instante, e voltava recusada: "A chave de idempotência já foi
    usada com outro conteúdo". As fotos nunca se ligavam à ocorrência.
  - A saída era fechar e abrir o painel, que gravava uma segunda
    ocorrência.
- **A correção.** O instante é o da primeira tentativa do painel
  (`pages/operacao/os.tsx`): a nova tentativa repete a chamada igual, e a
  callable devolve o resultado gravado. A etapa e a conclusão já iam com a
  data e a hora do formulário.
- **Teste:** `os.test.tsx`, com a página e a callable de mentira que recusa
  a mesma chave com outro conteúdo, como o servidor. A ocorrência com a
  resposta perdida se repete igual, e o painel fecha. Antes, a segunda
  levava o instante do novo clique.

### Correção: a Revisão trocava sozinha de OS

Achada em 25/10/2026, na mesma revisão. Está na produção desde a parte
3.10b.

- **O defeito.** Sem `?os=`, a OS da vez era só o primeiro cartão da lista
  ao vivo, ordenada pela conclusão. Depois de cada revisão, a tela volta
  sem `?os=`, então o caminho de todo dia nunca fixava a OS.
  - A OS que chegava depois com a conclusão de antes (registrada no
    escritório com a hora passada, ou a fila do campo que sincronizou
    tarde) tomava a tela, e a revisão começada recomeçava.
  - Se ela não tinha divergência (a irmã da mesma demanda, muitas vezes),
    "Concluir revisão" a fechava sem ninguém ter olhado.
- **A correção.** A OS que está na tela fica enquanto espera a revisão
  (`osDaVezNaRevisao`, em `lib/operacao/revisao.ts`). A que chega entra na
  lista; revisada a da vez, a próxima é a que espera há mais tempo.
- **Teste:** `revisao.test.tsx`, com a página e as leituras de mentira. A
  OS que chega depois não toma a tela, e "Concluir revisão" revisa a que
  estava nela. Antes, a tela trocava para a que chegou.

### Correção: o Planejar tirava do plano a linha que outro plano zerou

Achada em 25/10/2026, na mesma revisão. Está na produção desde a parte 3.6a.

- **O defeito.** A grade do Planejar mostrava só as linhas com saldo, lido
  ao vivo, e o pedido e a conferência só percorriam essas linhas.
  - Se outro plano gastava o saldo de uma linha com o formulário aberto, a
    linha sumia da grade, e a quantidade digitada para ela sumia junto.
  - O plano gravava sem ela (as cadeiras sem as mesas), quando o servidor
    teria recusado o plano inteiro se a linha tivesse ido.
- **A correção.** A linha em que o plano tem quantidade fica, com o saldo
  dela (`linhasDoPlano`, em `lib/operacao/planejar.ts`), e a conferência
  diz que as OS passam do saldo ("Mesa: as OS somam 20 e o saldo é 0.").
- **Teste:** `planejar.test.tsx`, com a página e as leituras de mentira. A
  linha zerada por outro plano fica, e o plano não grava. Antes, gravava
  sem ela.

### Correção: a capacidade "6.000" kg virava 6 kg

Achada em 25/10/2026, na mesma revisão. Está na produção desde a parte
3.4a.

- **O defeito.** O cadastro do veículo lia a capacidade em quilos com
  `Number()`: "6.000", como se escreve no Brasil, virava 6, um inteiro
  maior que zero, e a callable aceitava. "6.500" era recusado com uma
  mensagem que não ajudava, e o que não era número ia como NaN, que nem
  chegava à callable.
- **A correção.** `capacidadeDigitada` (`lib/operacao/cadastro.ts`) lê os
  quilos com ou sem o ponto do milhar e os metros cúbicos com a vírgula; o
  que não é número vai vazio, e a callable recusa com a mensagem dela.
- **Teste:** `pagina.test.tsx`, com a página de veículos e a callable de
  mentira: "6.000" kg vão como 6000 e "12,5" m³ como 12,5. Antes, 6 kg.

### Pergunta 58: cancelar a vistoria em execução

Feita em 26/10/2026, com a decisão do Leonardo e a tela do canvas "Telas das
decisões de 26/10" (item 1).

- **O problema.** A vistoria iniciada que não deu certo (o cliente não
  recebeu a equipe, o local fechado) não tinha saída: só a OS aberta ou
  agendada se cancelava, e o envio ao Comercial pede foto e itens. Enquanto
  ela existia, a demanda recusava outra vistoria.
- **O servidor** (`saveServiceOrder`, ação `cancel`): a vistoria também se
  cancela em execução (`exigirCancelavel`, em `domain/os.ts`), com a edição
  vista e o motivo de 3 a 200 caracteres, como as outras. A OS de serviço
  iniciada continua sem cancelar ("Só uma OS aberta ou agendada pode ser
  cancelada.").
  - O cancelamento grava, além do motivo, o instante e quem cancelou
    (`cancelamento.instante` e `cancelamento.por`, com o uid e o nome), em
    toda OS cancelada daqui em diante. A cancelada antes tem só o motivo.
  - O evento `os.cancelled` grava quem cancelou (o ator), sem o motivo, que
    é texto livre e fica na OS.
  - As etapas e as fotos da vistoria ficam na OS. Cancelada, a demanda pode
    ter outra vistoria, e o celular a mostra como "OS cancelada", como a
    cancelada agendada.
- **A tela** (`pages/operacao/os.tsx`): "Cancelar vistoria" no alto da OS da
  vistoria aberta, agendada ou em execução, para owner, admin e interno.
  Abre o painel com o "Motivo" (obrigatório), "Voltar" e "Cancelar
  vistoria" (`cancelar-vistoria-view.tsx`). O histórico da OS ganha a linha
  "Cancelada", com quem cancelou, o motivo e a hora.
- **Testes:**
  - `os.test.ts`: a vistoria em execução se cancela, com a edição vista; a
    OS de serviço iniciada e a vistoria em revisão ou revisada, não; a
    leitura do cancelamento de antes e o de agora;
  - `vistoria.integration.test.ts`, no emulador: a coordenação cancela a
    vistoria em execução com o motivo, a OS guarda quem e quando, o evento
    grava o ator sem o motivo, o campo não registra mais nela e a demanda
    recebe outra vistoria; a OS de serviço iniciada continua sem cancelar;
  - no app, `os.test.tsx` (o pedido com a edição e o motivo, o motivo que
    falta, Voltar, quem não vê o botão), `cancelar-vistoria-view.test.tsx`
    (os textos e o `axe`) e `os-view.test.tsx` (a linha do histórico).

### Pergunta 66: a conclusão recusada do campo, no servidor

Feita em 26/10/2026, com a decisão do Leonardo e o canvas "Telas das decisões
de 26/10" (item 2). A tela da ficha da OS vem no PR seguinte.

- **O problema.** A conclusão do celular recusada depois de a assinatura
  subir deixava a assinatura no Storage sem a OS apontar para ela: quando o
  escritório já tinha concluído a OS, ou quando a hora vinha antes da última
  etapa. A recusa ficava no topo do celular, mas a assinatura do cliente se
  perdia para a OS.
- **O que o servidor guarda** (`domain/conclusao-recusada.ts`): quando
  `completeServiceOrder` recusa (`failed-precondition`) a conclusão do
  celular com a assinatura conferida no Storage, a OS ganha
  `conclusao_recusada`: a hora da conclusão no celular, quem concluiu (o id
  do cadastro e o login), quem recebeu (nome e cargo, sem o documento, pela
  decisão 3 da LGPD), o caminho da assinatura, o motivo da recusa e quando
  foi recusada, com o evento `os.completion_refused` (sem o nome).
  - Guardar roda depois da recusa, fora da transação dela; se falhar, o log
    registra e a recusa chega ao celular do mesmo jeito.
  - O mesmo pedido repetido pela fila do celular recusa de novo, sem gravar
    outra vez (a chave do pedido fica na recusa).
  - Sem assinatura (sem aceite no local), ou de quem não está na equipe,
    nada é guardado.
- **A coordenação resolve** (callable `resolveFieldCompletion`, owner, admin
  e interno, com o recibo em `operacao_operations`):
  - "anexar": na OS concluída (em revisão ou revisada) com a conclusão sem
    aceite, a conclusão passa a ter a assinatura e quem assinou (nome e
    cargo); a hora, quem informou, os itens e as fotos não mudam. Evento
    `os.signature_attached`. A conclusão já assinada recusa ("A conclusão
    já tem a assinatura."), e a OS ainda em execução também ("Só a OS
    concluída recebe a assinatura do campo: conclua a OS com estes dados.");
  - "dispensar", em qualquer OS. Evento `os.refused_completion_dismissed`;
  - a recusa fica na OS nos dois casos, com quem resolveu e quando
    (`anexada` ou `dispensada`), como histórico. O pedido leva a hora da
    recusa que a tela mostrou: outra, mais nova, recusa ("A conclusão
    recusada mudou. Recarregue e tente de novo.").
- **O cliente** passa a ver a assinatura anexada no comprovante: a regra do
  Storage abre a ele a assinatura que a conclusão aponta.
- **Testes:**
  - `conclusao-recusada.test.ts`: o que se guarda e de quem, anexar (também
    na revisada) e dispensar, as recusas e a leitura;
  - `conclusao-recusada.integration.test.ts`, no emulador: o celular conclui
    a OS que o escritório concluiu, a recusa chega e a OS guarda o que
    chegou, uma vez só; a coordenação anexa (o campo não), repetir não
    duplica; a hora antes da última etapa guarda e só se dispensa; a recusa
    sem assinatura não guarda nada;
  - `events.test.ts` e `callables.test.ts`: os três eventos e a callable
    nova.

### Pergunta 66: a tela da conclusão recusada

Feita em 26/10/2026, com o canvas "Telas das decisões de 26/10" (item 2),
sobre o servidor da seção anterior.

- **O cartão** (`pages/operacao/os-view.tsx`): "Conclusão recusada do campo",
  no alto da coluna da ficha, com "Recusada" e a hora, "Concluída no
  celular" (a hora e quem concluiu), o "Motivo da recusa", "Recebido por" e a
  assinatura. Só para owner, admin e interno: a página entrega as ações só a
  eles, e sem as ações o cartão não aparece.
- **As ações** (`pages/operacao/os.tsx`, `acoesDaRecusa` em
  `lib/operacao/ficha-da-os.ts`):
  - "Anexar à conclusão", na OS concluída (em revisão ou revisada) sem
    aceite;
  - "Concluir com estes dados", na OS de serviço em execução: abre a
    conclusão do Registrar andamento com a hora e quem concluiu no celular
    (quem concluiu, se ainda está na equipe), quem recebeu, o cargo e a
    assinatura, que não sobe de novo. A conclusão que usa a assinatura da
    recusa a marca como anexada, no servidor;
  - "Dispensar", sempre;
  - a chave do pedido é da recusa (`recusa:<ação>:<hora>`): repetir depois
    de perder a resposta devolve o mesmo resultado.
- **A conclusão** mostra "Assinatura anexada", com a hora e quem anexou. O
  histórico ganha "Conclusão do campo recusada", "Assinatura anexada à
  conclusão" e "Conclusão do campo dispensada", com quem e quando.
- **Testes:**
  - `conclusao-recusada.integration.test.ts`: concluir com estes dados leva
    a assinatura do celular na conclusão do escritório e marca a recusa
    como anexada;
  - no app, `ficha-da-os.test.ts` (o cartão, as ações por status, o
    histórico e a conclusão com a assinatura anexada), `os-view.test.tsx`
    (os textos e o `axe`) e `os.test.tsx` (anexar e dispensar com a chave
    da recusa, concluir com estes dados com a hora e quem concluiu no
    celular, sem subir a assinatura de novo, quem não coordena não vê o
    cartão).

### Pergunta 65: a inclusão guardada no celular

Feita em 26/10/2026, com o canvas "Telas das decisões de 26/10" (item 3).
Antes, a inclusão guardada de um item que a OS não tem (do catálogo ou
avulso) só aparecia no celular depois de chegar, e a equipe podia incluí-la
de novo.

- **A linha guardada** (`inclusoesGuardadas` em `lib/campo/os-no-campo.ts`,
  `pages/campo/os-view.tsx`): o cartão Itens mostra a inclusão guardada como
  linha nova, depois das linhas da OS, com o serviço do item do catálogo (ou
  "Item avulso"), o nome, o relógio, a quantidade com a unidade e "guardada"
  com a hora. Sem + e −: a linha ainda não existe no servidor. O título conta
  as linhas guardadas.
- **Como o servidor grava:** as do mesmo item do catálogo somam numa linha,
  com a hora da última; cada avulso é uma linha. A do item do catálogo que a
  OS já tem soma na linha dela (`itensNoCampo`, pelo `lpu_item_id` que a
  leitura da linha passou a trazer, `lpuItemId` em
  `lib/operacao/ficha-da-os.ts`).
- **Testes:** `os-no-campo.test.ts` (a linha nova, a soma do mesmo item, o
  avulso, o item que a OS já tem, a outra OS e o catálogo sem o item) e
  `campo-view.test.tsx` (os textos, sem + e −, a trava contra legenda e o
  `axe`).
