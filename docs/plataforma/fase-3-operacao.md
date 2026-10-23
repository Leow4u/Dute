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
| `demands` | Comercial | Lê; escreve só `os_numeros`, `execucao` (período, OS revisadas) e `revisao` (divergências com decisão). Cria a demanda direta pela callable dela (parte 3.4d), no mesmo esquema, sem RV, com `itens_pedidos` (o escopo das OS, sem preço), `pedido_por`, `executar_ate`, `tipo_calculado`, `tipo_corrigido_por` e `aberta_pela: "operacao"`. O Comercial só lê esses campos. |
| `service_orders` | Operação | Tudo, pelas callables. Desde a parte 3.4b: `itens` com `planejado`, `servicos`, `locais` (endereço copiado e contato no local), `janela`, `equipe` com papel, vínculo e empresa por pessoa (nome copiado no agendamento; freelancer e terceiro entram aqui), `equipe_uids`, `veiculos`, `instrucoes`, `status` e `cancelamento`. Nas partes 3.7 a 3.10: `etapas`, `executado` e `incluido_em_campo` nos itens, `fotos`, `ocorrencias`, `presencas`, `conclusao` e `revisao`. Nenhum valor. |
| `service_order_counters` | Operação | O sufixo da OS por demanda. |
| `collaborators` | Operação | Ganha `vinculo`, `empresa` (terceiro) e `papeis` (líder, motorista, montador, ajudante). |
| `vehicles` | Operação | Ganha `dono` (próprio ou terceiro) e `revisao_em`. |
| Storage `os/{numero}/fotos/` e `os/{numero}/assinatura` | Operação | Com `storage.rules` por papel: campo escalado, coordenação e, na Fase 4, o cliente dono. |

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
- Painel lê só o que a TV mostra.

## Callables

Em `functions/operacao`, cada uma numa linha e começando por
`requireOperacaoCaller`: `saveServiceOrder` (create, schedule, cancel; ganha
`plan`), `openDirectDemand`, `registerStep`, `registerItem`, `attachPhoto`,
`registerPresence`, `registerOccurrence`, `completeServiceOrder`,
`reviewServiceOrder`, `reopenServiceOrder` e `sendSurveyToCommercial`.

## Eventos

`source: functions_operacao`, sem nome, valor, CPF ou placa, e sem as
palavras do roteador de avisos do WMS: `os.created`, `os.scheduled`,
`os.planned`, `os.started`, `os.step_recorded`, `os.item_executed`,
`os.item_added_in_field`, `os.photo_attached`, `os.presence_recorded`,
`os.occurrence_recorded`, `os.completed`, `os.signed`,
`os.completed_without_acceptance`, `os.reviewed`, `os.addendum_requested`,
`os.reopened`, `os.cancelled`, `demand.direct_opened`,
`survey.sent_to_commercial`, `collaborator.cnh_expiring` e
`vehicle.maintenance_due`.

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
| 3.7 | Execução pelo escritório: `registerStep`, `registerItem`, `registerOccurrence`, fotos no Storage, Em execução, tela da OS | Etapa fora de ordem recusada; instante gravado; foto só de quem está na OS ou coordena |
| 3.8 | Campo (PWA): Minhas OS, execução, incluir item, presença, fila sem sinal | Campo lê só a OS escalada; dois envios do mesmo registro gravam um; instante original guardado |
| 3.9 | Concluir com assinatura ou "sem aceite no local", Em revisão; impressão da OS | Concluir sem motivo para item a menos recusado; assinatura no Storage com regra |
| 3.10 | Revisão interna, Revisada, reabrir; aditivo na fila do Comercial; demanda direta em Execução a orçar | Divergência sem decisão não conclui; `demands.revisao` só pela Operação |
| 3.11 | Vistoria como OS e "Enviar vistoria ao comercial" | Vistoria não passa pela revisão; orçamento nasce com os itens dela |
| 3.12 | TV da sala (`/tv`, papel `painel`) | `painel` só lê o que a TV mostra; sem valor; sem ação |
| 3.13 | Alertas no Início e rotina diária (CNH, revisão do veículo, OS sem equipe ou veículo perto do prazo) | O evento sai uma vez por dia por item |
| 3.14 | Produção e registro | Conferência de produção |

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
