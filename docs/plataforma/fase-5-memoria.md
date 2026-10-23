# Fase 5: memória da Dute

Desenho e registro da Fase 5 do plano de implantação
(`plano-de-implantacao.md`, seção 8). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Sugerir com base no que foi feito, mostrando de onde tirou.
- Uma pessoa decide. A IA não grava nada sem ela (invariante 3).
- Aprender com o resultado: cada sugestão guarda o que a pessoa fez e,
  depois, o valor real.

## Decisões

Seguem a recomendação do plano até a resposta do Leonardo:

| Pergunta | Recomendação seguida |
|---|---|
| 19 | A sugestão pede 5 execuções do mesmo item no mesmo cliente. Sem elas, vale a média interna, com 15 execuções do item em qualquer cliente. Abaixo disso, a sugestão diz que ainda não tem base. |
| 20 | A codebase nova `functions/core`, como no repositório do plano (`plano.md`). Ela recebe a memória agora e o Agent Dute na parte 5.5. |
| 29 | A semelhança dos orçamentos compara os itens da LPU e as quantidades. O resumo em texto fica guardado para o Agent Dute. |
| 30 | Os dias parado têm os mesmos limites nos três modelos: "Parado 90+ dias" sem entrada nem saída e "Sem giro" aos 180 dias sem saída. |
| 31 | A equipe fala com o Agent Dute do cliente ativo, não mais só da BTG. |
| 32 | Têm o Agent Dute owner, admin, interno, wms, comercial, financeiro, suporte e o cliente. O campo e o painel não; o RH entra na Fase 8. |
| 33 | A prévia do faturamento sai do agente até a Fase 7. O agente lê as faturas emitidas. |
| 34 | A anotação sugerida pelo agente só entra pelo cartão, quando a pessoa a envia. Quem revisa decide depois, como hoje. |
| 35 | O briefing do dia vira a rotina pronta "Resumo do dia", que cada pessoa liga. O radar mostra as linhas do "Precisa de você", sem regra própria. |

- **Três camadas**, como no plano:
  - os fatos são os eventos e os documentos que as callables gravam;
  - as medidas ficam em `ai_measures`, calculadas a partir deles;
  - as lembranças ficam em `ai_case_memory`, uma por demanda fechada.
- **A medida se recalcula inteira.** A rotina `runMeasures` lê os eventos
  depois do cursor, como a dos avisos.
  - Quando chega uma OS revisada ou reaberta, ou uma demanda fechada pelo
    cliente, ela recalcula as medidas a partir das OS revisadas e das
    demandas, do zero.
  - O resultado não depende da ordem nem de rodar duas vezes.
  - Com milhares de OS, a conta passa a ser por cliente e item e as séries
    longas vão ao BigQuery, como o plano prevê.
- **O isolamento.**
  - A medida de um cliente tem o `customer_code` dele.
  - A medida geral junta os clientes e serve só à equipe interna.
  - Nenhuma medida, sugestão ou lembrança abre ao cliente.
- **A origem sempre aparece.** Toda medida guarda quantas execuções a
  formam e as OS mais recentes. Toda sugestão mostra a base: do cliente ou
  geral, quantas execuções e quais OS.
- **A sugestão não grava.** Aceitar a duração preenche o formulário; quem
  salva é a pessoa, pela callable de sempre. A sugestão guarda a decisão
  (aceitou, mudou ou recusou) e, quando a OS é revisada, o valor real.

## As medidas (parte 5.1)

Todas vêm das OS revisadas (`status: revisada`) de serviço. A vistoria fica
de fora.

- **O tempo de trabalho da OS.** É o tempo no local, sem o deslocamento:
  - da chegada na origem ao fim;
  - menos o trecho da saída da origem à chegada no destino, quando a OS tem
    destino.
  - A OS sem essas etapas não entra.
  - Multiplicado pelas pessoas da equipe, vira homem-minuto. As presenças
    registradas (parte 3.8) refinam depois quem estava no local.
- **O homem-minuto por unidade de cada item da LPU.**
  - O tempo de cada OS se reparte pelos itens dela, na proporção do tempo
    típico de cada um.
  - O tempo típico sai dessa repartição. As duas se ajustam juntas até
    estabilizar.
  - A OS de um item só dá o tempo dela inteiro a ele.
  - A medida guarda o homem-minuto por unidade, as execuções (as OS com o
    item), as unidades feitas e as OS mais recentes.
  - Com a equipe do plano, a sugestão divide pelo número de pessoas: "25
    min por unidade com 2 pessoas, em 31 execuções".
- **O erro do planejamento.**
  - Por OS: os minutos reais, da primeira etapa à conclusão, contra a janela
    planejada. Os dois já estão na revisão (`os.reviewed`).
  - Por cliente e geral: o erro médio, a parte das OS que passaram da janela
    e as execuções.
  - É o que dá o aviso de plano otimista na parte 5.2.
- **Os itens que passam do planejado.**
  - Por item e cliente: em quantas OS o executado passou do planejado e o
    excesso médio.
  - O planejado da OS sai do escopo orçado, então é o estouro do orçado
    quando a demanda tem uma OS.
- **O prazo de aprovação do orçamento.**
  - Por cliente e geral: os dias entre o envio da RV que fechou e o
    fechamento pelo cliente (`demand.won`), com a mediana e as demandas.

## Dados

| Coleção | Dono | O que guarda |
|---|---|---|
| `ai_measures/{id}` | `functions/core` | Uma medida: o tipo, o escopo (cliente ou geral), a chave (o item da LPU), os números, as execuções e as OS mais recentes |
| `ai_suggestions/{id}` | `functions/core` | A sugestão mostrada: o tipo, o contexto (a demanda, a OS, quem pediu), o valor sugerido, a base, a decisão e o valor real |
| `ai_case_memory/{demanda}` | `functions/core` | A demanda fechada: os itens e as quantidades, os serviços, o prazo, o orçado e o realizado, o resumo em texto e o vetor de semelhança |
| `ai_stock_age/{item}` | `functions/core` | O item do estoque, um por cliente e SKU: o relógio (a primeira e a última entrada e a última saída que contam), a última saída em cada posição e o saldo das posições |
| `ai_stock_alerts/{alerta}` | `functions/core` | O alerta do item parado de um cliente: a proposta do dia com os itens, a regra, e a decisão (quem, quando e os itens enviados) |
| `ai_cursors/{rotina}` | `functions/core` | Até onde cada rotina leu os eventos ou o razão do estoque, e o dia da última proposta do alerta |
| `core_operations/{id}` | `functions/core` | O recibo de idempotência das callables |

- **Regras.** As medidas abrem à equipe interna que planeja e orça: owner,
  admin, interno e comercial. As sugestões abrem a quem as pediu e a owner e
  admin. As lembranças não abrem pelo navegador. Os dias parado abrem a quem
  lê o estoque (owner, admin, interno, wms e suporte), como `stock_balances`;
  o alerta do item parado, à coordenação (owner, admin e interno).
  O cliente, o campo e o painel não leem nada delas. Ninguém grava pelo
  navegador.
- **Preço.** A medida de duração e a do planejamento não têm valor. A
  lembrança tem o orçado e o realizado, então só a callable da parte 5.3b a
  lê, pelo cliente e pelo papel de quem lê preço.
- **Zeragem.** As medidas, as sugestões e as lembranças saem das OS e das
  demandas. `tools/full_reset_btg.py` preserva as quatro coleções, como
  preserva a Operação e o Comercial de onde elas saem. Os dias parado saem do
  estoque e vão embora com ele; o cursor fica, e a rotina segue dos
  movimentos novos.

## Os dias parado (parte 5.4)

Por item, caixa e peça, como o plano pede. A peça não existe ainda: o
patrimônio entra com o modelo Mobiliário (`docs/multicliente-modelos-de-operacao.md`),
e os dias parado da peça entram com ele.

- **A fonte é o razão.** Nenhum documento do estoque guarda a última
  movimentação: o `updated_at` do saldo, do SKU e da projeção do portal muda
  também com foto, reserva e mínimo de estoque. Só `movements` diz quando o
  item entrou e saiu.
- **O que conta.**
  - Contam a entrada e a saída de verdade: o recebimento, a expedição, o
    lançamento manual e a devolução que volta ao estoque.
  - A contagem de abertura conta como a entrada: o estoque que já estava no
    armazém entra no dia em que foi contado.
  - A guarda e a troca de caixa da abertura só mudam o lugar. A contagem
    cíclica e o estorno da abertura corrigem o saldo. Nenhuma delas é giro.
- **O relógio do item.** A rotina guarda, por cliente e SKU, a primeira e a
  última entrada, a última saída e o saldo das posições.
  - Guarda só o menor e o maior instante: o resultado não depende da ordem
    dos movimentos nem de ler um deles duas vezes.
  - Não guarda a idade nem a etiqueta. A regra vale na hora, com o dia de
    hoje (`lib/dominio/src/parados.ts`), e a etiqueta nunca fica velha.
- **As etiquetas.**
  - "Parado 90+ dias": sem entrada nem saída há 90 dias. A entrada nova
    tira o Parado.
  - "Sem giro": sem saída há 180 dias, ou desde a primeira entrada quando
    nunca saiu. A entrada nova não tira o Sem giro.
  - O dia é o de São Paulo. Sem saldo, não há o que estar parado.
- **A regra é a do modelo de operação.** Cada modelo tem os limites dele, e
  a ficha do modelo em Configurações › Clientes mostra a regra.
  - A regra mora em `lib/dominio`, e `functions/core` guarda uma cópia
    literal. Os dois rodam os mesmos casos de `parados.casos.json`.
  - Os três modelos têm os mesmos limites até a resposta da pergunta 30.
  - Regra própria de um cliente é PR, com teste, nunca configuração de tela.
- **A caixa.** As caixas guardam o que foi contado na abertura. O
  recebimento e a expedição não mexem nelas, então o conteúdo só vale até a
  primeira saída.
  - A caixa conta desde a guarda dela ou desde a última saída de um SKU dela
    pela posição dela. A entrada na mesma posição não conta: o recebimento
    não põe nada na caixa.
  - Duas caixas na mesma posição com o mesmo SKU contam a mesma saída: o
    razão não diz de qual caixa saiu.
  - O item guarda a última saída em cada posição, e a idade da caixa sai na
    hora, como a do item. A caixa só tem o "Parado"; o giro é do item.
- **O cliente.** Os dias parado não abrem ao cliente. O cliente fica sabendo
  pelo alerta, e o alerta só sai depois que uma pessoa aprova.
- **O alerta.**
  - Uma vez por dia, a rotina propõe a cada cliente ativo, com portal e que
    não é prospect, um alerta com os itens que passaram do "Parado" da regra
    do modelo dele, os mais parados primeiro (até 200).
  - Uma proposta aberta por cliente. A rotina a refaz todo dia, e a tira
    quando não sobra item.
  - A coordenação (owner, admin e interno) aprova escolhendo os itens, ou
    descarta. A decisão grava o evento `estoque_parado.aprovado` ou
    `estoque_parado.descartado`, sem valor nem nome de item, na mesma
    transação. A mesma decisão de novo não muda nada; outra recusa.
  - O item decidido, enviado ou não, não volta enquanto não se mexer: a
    chave dele é o SKU com o último movimento.
  - Só o aprovado vira aviso ao cliente, no sino do portal e por e-mail,
    pela rotina dos avisos da Operação (parte 5.4f).

## O Agent Dute no núcleo (parte 5.5)

Desenho da parte 5.5, escrito em 23/10/2026 antes de qualquer código, como o
plano pede.

### O que existe hoje

O Agent Dute inteiro mora na codebase do WMS (`functions/wms/src/index.ts` e
`domain/agent-*.ts`):

- o chat `chatWithAgentDute`, com resposta em partes;
- 18 ferramentas;
- as anotações, os playbooks e as rotinas;
- os rascunhos de pedido, envio e rotina;
- o conhecimento dos documentos, com o OCR;
- o uso em `agent_usage`, com o painel de custo.

Seis problemas a resolver na mudança:

1. **A equipe só fala da BTG.** O escopo interno é fixo em "BTG Pactual".
   O seletor de cliente do app não chega ao agente.
2. **Duas ferramentas gravam.**
   - `sugerir_anotacao` cria a anotação pendente e o evento.
   - `consultar_playbook` soma o uso no playbook.
3. **Uma consulta não leva o cliente.** `movimentacoes` busca o razão do
   período sem o cliente na consulta e só o filtra na memória.
4. **A prévia do faturamento lê o período antigo da BTG.**
   `previa_faturamento` lê `billing_periods/{competência}` para qualquer
   cliente.
5. **O agente só conhece a Armazenagem.** Não lê a Operação, o Comercial, o
   Financeiro nem a memória, e só aparece no shell da Armazenagem.
6. **Radar e briefing estão de fora.**
   - O radar é calculado no navegador.
   - O briefing e o `analyzeEvent` não chamam o modelo, e nenhuma tela os
     chama.
   - Também não há teste do prompt, da troca de modelo, da gravação da
     conversa nem da rotina.

### O desenho

- **Onde.**
  - Na `functions/core`, com callables de nomes novos. O nome de uma
    function é único no projeto, mesmo entre codebases.
  - Os nomes:
    - a conversa: `chatWithDute`;
    - as anotações: `listDuteNotes`, `decideDuteNote` e `suggestDuteNote`;
    - os playbooks: `listDutePlaybooks`, `saveDutePlaybook`,
      `decideDutePlaybook` e `seedDutePlaybooks`;
    - as rotinas: `listDuteRoutines`, `saveDuteRoutine`,
      `deleteDuteRoutine` e `runDuteRoutineNow`, com a rotina agendada
      `runDuteRoutines`.
  - Cada callable entra por `requireCoreCaller`, como as da memória.
- **As mesmas coleções.** `agent_conversations`, `agent_messages`,
  `agent_usage`, `ai_agent_notes`, `ai_agent_playbooks`, `agent_routines`
  e o conhecimento (`ai_agent_knowledge` e os pedaços).
  - A conversa, o histórico e as rotinas de cada pessoa continuam.
  - O painel de custo do WMS segue lendo `agent_usage`.
  - O rascunho de pedido e de envio segue saindo pela `createCustomerRequest`
    do WMS, que confere a mensagem do agente na mesma coleção.
- **O escopo vem do servidor, nunca do modelo.**
  - **O cliente** usa o `customer_code` do perfil e os módulos que
    contratou.
  - **A equipe** usa o cliente ativo do app (o `customer_code` do pedido).
    - O núcleo confere o cadastro em `customers`: precisa ser cliente, não
      prospect, e não estar arquivado.
    - Os módulos são os do papel (`MODULOS_POR_PAPEL`). Armazenagem,
      Operação e Financeiro só valem quando o cliente os contratou. O
      Comercial vale para todo cliente.
  - **O módulo do shell** (`modulo`: `wms`, `operacao`, `comercial`,
    `financeiro`) precisa ser um dos módulos da pessoa.
    - Muda a abertura, as sugestões e o que o prompt põe primeiro.
    - As ferramentas são as de todos os módulos da pessoa: o agente enxerga
      a empresa toda, como o plano pede.
  - **A conversa** é da pessoa, do cliente e do módulo, e fica gravada com
    os três. A de outro cliente ou de outra pessoa recusa.
- **As ferramentas só leem, por construção.**
  - Cada ferramenta recebe o leitor do agente (`domain/agente-leitor.ts`),
    não o banco:
    - `doCliente(coleção)` sempre consulta com `customer_code` igual ao do
      escopo;
    - `documento(coleção, id)` devolve vazio quando o documento é de outro
      cliente;
    - `geral(coleção)` vale só para a lista fechada do que não tem cliente,
      como o catálogo da LPU.
  - O leitor não tem gravação, lote nem transação.
  - O que hoje grava vira cartão:
    - A anotação sugerida volta como rascunho (`tipo: "anotacao"`). A pessoa
      a envia pelo cartão (`suggestDuteNote`), como a rotina, e quem revisa
      decide depois, como hoje.
    - O uso do playbook vai para o registro de uso da resposta
      (`agent_usage.playbooks`), gravado pelo fluxo da conversa.
  - Nenhuma ferramenta tem parâmetro de cliente.
  - A trava é um teste que roda todas as ferramentas num banco que recusa
    qualquer gravação, com dados de dois clientes. Nenhuma grava e nenhuma
    devolve dado do outro.
- **O valor só para quem lê valor.**
  - O valor (preço, total, fatura) só aparece para owner, admin, comercial
    e financeiro (`canReadPrices` das regras). O cliente vê o das próprias
    faturas.
  - A ferramenta com valor só entra para esses papéis.
  - Hoje o suporte vê a prévia do faturamento. No núcleo, não.
- **Quem tem o Agent Dute.** owner, admin, interno, wms, comercial,
  financeiro e suporte, e o cliente.
  - O campo não tem: usa o app de campo, que funciona sem sinal.
  - O painel não tem: só lê o quadro da TV.
  - O RH entra na Fase 8.
### As ferramentas

| Módulo | Ferramentas | Quem |
|---|---|---|
| Armazenagem | `resumo_estoque`, `buscar_itens`, `listar_pedidos`, `ver_pedido`, `movimentacoes`, `documentos`, `itens_parados` (parte 5.4) | o cliente com armazenagem e a equipe da Armazenagem |
| Armazenagem | `fila_solicitacoes`, `recebimentos`, `tarefas_armazem`, `enderecos`, `eventos` | a equipe da Armazenagem |
| Operação | `demandas`, `ver_demanda`, `agenda` (as OS por dia, com a equipe e o veículo, sem valor), `ver_os` | o cliente com Operação (só as dele) e a equipe da Operação |
| Operação | `duracao_sugerida` (parte 5.2) | quem planeja (`PLANEJAMENTO_ROLES`) |
| Comercial | `orcamentos`, `ver_orcamento`, `orcamentos_parecidos` (parte 5.3), `lpu` | quem orça (`ORCAMENTO_ROLES`), com o preço |
| Financeiro | `faturas` (as da Armazenagem e as da Operação), `a_receber` | o cliente com o Financeiro (as dele) e a equipe do Financeiro |
| Todos | `conversas_anteriores`, `consultar_playbook`, `sugerir_anotacao` e `sugerir_rotina` (cartões) | quem tem o agente |
| Todos | `rascunho_pedido` e `rascunho_envio` (cartões) | o cliente com armazenagem |

- A prévia do faturamento sai do agente até a Fase 7, que unifica o
  faturamento. O agente lê as faturas emitidas.
- A memória diz quando ainda não tem base, como a sugestão da duração.

### A conversa, as rotinas e a troca

- **O modelo.**
  - Genkit com o Vertex AI, os mesmos modelos (`AGENT_DUTE_MODEL` e o
    reserva) e as mesmas regras do prompt: só consulta, nunca inventa, usa
    as ferramentas.
  - O prompt ganha o módulo e o cliente ativo.
  - A resposta em partes mantém os tipos de hoje (`tool`, `text`, `reset`),
    para a tela seguir igual.
- **As rotinas.**
  - A rotina agendada do núcleo (`runDuteRoutines`, a cada 15 minutos)
    roda as rotinas de todos. Antes de rodar, confere o perfil atual de quem
    criou.
  - Na troca, uma rotina roda por um só: a `runAgentRoutines` do WMS para
    nos projetos em que o agente do núcleo está liberado. É uma guarda de
    duas linhas, não um refatoramento.
- **Radar e briefing.**
  - O radar do painel do agente passa a mostrar as linhas do "Precisa de
    você" dos módulos da pessoa, sem regra própria: a contagem continua uma
    só (`lib/resumo-do-modulo.ts`).
  - O briefing do dia vira uma rotina pronta por módulo ("Resumo do dia",
    nos dias úteis às 7h), que cada pessoa liga pelo cartão.
  - `generateDailyBriefing` e `analyzeEvent` não vêm para o núcleo.
- **Ficam no WMS.**
  - O conhecimento dos documentos e o OCR, que são do fluxo dos documentos.
    O agente do núcleo só lê o conhecimento ativo, como hoje.
  - Os avisos do Agent Dute (`operational_notifications`).
  - O painel de custo.
- **A liberação.**
  - `AGENTE_AMBIENTES_LIBERADOS = ["dute-homolog"]`, no app e no núcleo,
    travada por `platform-lists.test.ts`. É separada da memória para o
    Leonardo ligar uma sem a outra.
  - Com ela, o app fala com o agente do núcleo; sem ela, com o do WMS.
  - O agente do WMS sai no lançamento da Fase 5 na produção, com o OK do
    Leonardo, não antes.
- **No app.**
  - O Agent Dute entra em cada shell (Armazenagem, Operação, Comercial e
    Financeiro), com o atalho "/" e o módulo do shell na conversa.
  - A tela do agente passa para a v3, com o violeta do Agent Dute, a lista
    dos textos e o `axe`.
  - A equipe fala do cliente ativo.

## Liberação

`MEMORIA_AMBIENTES_LIBERADOS = ["dute-homolog"]`, no app (`lib/liberacao.ts`)
e na `functions/core`, travada por `platform-lists.test.ts`. A rotina e as
callables recusam fora dela. O `dute-prod` entra no fim da fase, com o OK do
Leonardo.

O Agent Dute do núcleo tem a liberação dele, `AGENTE_AMBIENTES_LIBERADOS =
["dute-homolog"]` (parte 5.5b), no mesmo molde. Fora dela, o app segue com o
agente do WMS.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 5.1a | A codebase `functions/core` com a liberação, no `firebase.json`, no CI e na publicação; a rotina `runMeasures` com o cursor e a medida do tempo por item. O perfil e a idempotência entram com a primeira callable (5.2a) | A medida bate com as OS revisadas de um caso conhecido; o cliente A não entra na medida do cliente B |
| 5.1b | As medidas do erro do planejamento, dos itens que passam do planejado e do prazo de aprovação; as regras de `ai_measures` | Cada medida bate com o caso conhecido; o cliente não lê nenhuma |
| 5.2a | `suggestDuration` e `answerSuggestion`, com `ai_suggestions`; a rotina grava o valor real quando a OS é revisada | Sugestão só com o mínimo de execuções; a base gravada; nada grava na OS |
| 5.2b | A duração sugerida e a divisão em OS no Planejar OS, com a base e o aviso de plano otimista | Textos listados; aceitar só preenche; `axe` |
| 5.3a | `ai_case_memory`: a lembrança de cada demanda fechada, com o resumo e o vetor | A lembrança bate com a demanda; nada de outro cliente |
| 5.3b | `findSimilarQuotes`: os orçamentos parecidos do cliente da demanda, com os itens, as quantidades, o prazo e o preço, e o orçado e o realizado de cada caso | Caso de outro cliente nunca aparece; só quem orça pede; nada grava |
| 5.3c | Os orçamentos parecidos na montagem do orçamento, com "Usar as quantidades" | Textos listados; usar só preenche o formulário; `axe` |
| 5.4a | A regra dos dias parado por modelo de operação, em `lib/dominio`, com a cópia no núcleo; o relógio de cada item em `ai_stock_age`, pela rotina `runMeasures`, a partir do razão; as regras | A etiqueta sai da regra do modelo; o mesmo SKU em dois clientes são dois itens; o cliente não lê |
| 5.4b | Os dias parado da caixa: o item guarda a última saída em cada posição, e a idade da caixa sai da guarda dela e das saídas dos SKUs dela pela posição dela | A caixa conta da guarda; só a saída de um SKU dela pela posição dela zera |
| 5.4c | Os dias parado e as etiquetas em Estoque, por item e por caixa | Textos listados; a etiqueta sai da regra do modelo do cliente; `axe` |
| 5.4d | A proposta do dia do alerta do item parado e a decisão (`answerStockAlert`), com o evento; `ai_stock_alerts` e as regras | O alerta não sai sem aprovação; o item decidido não volta sem se mexer; só a coordenação decide |
| 5.4e | Estoque › Alertas, com o alerta de cada cliente e os itens para escolher, e a linha no "Precisa de você" da Armazenagem | Textos listados; uma ação principal; aprovar pede os itens; só a coordenação vê; `axe` |
| 5.4f | O aviso do alerta aprovado ao cliente, no sino do portal e por e-mail, pela rotina dos avisos | Só o aprovado vira aviso; só ao cliente dele, com a armazenagem no contrato |
| 5.5a | O desenho do Agent Dute no núcleo (esta seção) | — |
| 5.5b | O escopo e o leitor do agente no núcleo: o cliente do perfil, o cliente ativo da equipe e o módulo do shell; o leitor só de leitura e por cliente; a liberação `AGENTE_AMBIENTES_LIBERADOS` | O leitor não grava; o documento de outro cliente volta vazio; o cliente ativo inexistente, arquivado ou prospect recusa; o módulo fora do papel recusa |
| 5.5c | As ferramentas da Armazenagem pelo leitor, sem a prévia do faturamento, e a dos itens parados | Nenhuma grava; nenhuma devolve dado de outro cliente; nenhuma tem parâmetro de cliente; o razão já consultado pelo cliente |
| 5.5d | As ferramentas da Operação, do Comercial, do Financeiro e da memória | O valor só para quem lê valor; a Operação sem valor; a memória diz quando não tem base; isolamento por cliente |
| 5.5e | A conversa no núcleo (`chatWithDute`), com o Genkit na codebase: o prompt por papel e módulo, o histórico, o resumo, as anotações e os playbooks no prompt, a troca de modelo, o uso e os rascunhos | O prompt de cada papel e módulo; a conversa de outro cliente recusa; o modelo que falha passa ao reserva; só o fluxo grava a conversa, o uso e os playbooks usados |
| 5.5f | As anotações e os playbooks no núcleo, do cliente ativo: a anotação enviada pelo cartão, a decisão da coordenação e os playbooks com os iniciais | A anotação só entra pelo cartão de quem conversou; só a coordenação decide, do cliente ativo; o evento só com o id |
| 5.5g | As rotinas no núcleo, com a rotina agendada `runDuteRoutines`; o WMS deixa de rodar as rotinas onde o núcleo roda | A rotina roda uma vez, por um só; a rotina segue o perfil atual de quem criou; sem acesso, pausa |
| 5.5h | A nota fiscal anexada pelo cliente na conversa, lida pelo Gemini | A nota de outro cliente recusa; só o cliente anexa; a leitura não grava pedido |
| 5.5i | O app com o agente do núcleo onde está liberado: o Agent Dute em cada shell, com o módulo e o cliente ativo; a tela na v3; as anotações e os playbooks do cliente ativo; o radar com as linhas do "Precisa de você" | Textos listados; `axe`; a equipe fala do cliente ativo; o módulo do shell vai à conversa |
| 5.5j | O "Resumo do dia" como rotina pronta por módulo | A rotina pronta segue o papel e o módulo; só liga pela pessoa |
| 5.6 | O painel de acerto: o erro médio da duração prevista e a taxa de aceite das sugestões | O painel sai de `ai_suggestions` |

## Perguntas abertas

- **O homem-minuto.** A medida supõe que o tempo cai na proporção das
  pessoas: 2 pessoas fazem na metade do tempo de 1. Vale para montagem e
  carga? Seguimos assim até a resposta, com as presenças refinando depois.
- **O deslocamento.** O tempo de trabalho deixa a ida e o trajeto entre a
  origem e o destino de fora: a pessoa que planeja soma o trajeto. Vale, ou
  a sugestão estima o trajeto também?
- **A semelhança dos orçamentos (parte 5.3).** O plano fala em vetor do
  resumo em texto, com a busca vetorial do Firestore. Os orçamentos são
  feitos de itens da LPU, e a semelhança pelos itens e pelas quantidades é
  mais exata e explicável que a do texto. Recomendo comparar pelos itens
  (o vetor é o dos itens) e guardar o resumo em texto para o Agent Dute.
  Seguimos assim desde a parte 5.3a.
- **Os limites dos dias parado (parte 5.4).** Os três modelos têm "Parado
  90+ dias" sem entrada nem saída e "Sem giro" aos 180 dias sem saída. O
  mobiliário costuma ficar guardado por mais tempo, e o insumo deveria girar
  mais rápido. Vale o mesmo para os três, ou cada modelo tem os dele?
  Seguimos com o mesmo até a resposta.
- **O Agent Dute no núcleo (parte 5.5).** Seguimos as recomendações abaixo
  até a resposta:
  - a equipe fala do cliente ativo, não mais só da BTG;
  - campo e painel ficam sem o agente;
  - a prévia do faturamento sai até a Fase 7;
  - a anotação sugerida entra só pelo cartão;
  - o briefing vira a rotina pronta "Resumo do dia", e o radar mostra as
    linhas do "Precisa de você".

## Registro

### Parte 5.1a: a codebase do núcleo e o tempo por item

Feita em 23/10/2026. As contas estão em `functions/core/src/domain/medidas.ts`;
a rotina em `medidas-gravacao.ts`.

- **A codebase.** `functions/core`, codebase `core`, no molde do Financeiro.
  - Entra no `firebase.json`, no CI (`core-unit` e `core-integration`) e na publicação.
  - A liberação é `MEMORIA_AMBIENTES_LIBERADOS`, só o `dute-homolog`, igual à do app (`platform-lists.test.ts`).
  - Ainda não tem callable. O perfil e a idempotência entram com a primeira, na parte 5.2a.
- **A rotina `runMeasures`**, a cada 15 minutos, uma instância, só com a liberação.
  - Lê os eventos `os.reviewed` e `os.reopened` depois do cursor (`ai_cursors/medidas`). Só entra o evento gravado há mais de um minuto, como na dos avisos.
  - Com evento novo, recalcula do zero, a partir das OS revisadas. A medida que não mudou não se grava de novo. A do item que ficou sem OS sai.
  - Na primeira vez, recalcula com o histórico que existe e marca o cursor.
- **A amostra.** A OS revisada de serviço, com a equipe, o tempo de trabalho e algum item feito.
  - O tempo de trabalho vai da chegada na origem ao fim, menos o trajeto até o destino.
  - O feito é o corrigido na revisão, senão o registrado no local.
  - O item livre, sem LPU, ocupa o tempo dele na OS, mas não vira medida.
- **O ajuste.** O tempo de cada OS se reparte pelos itens na proporção do tempo típico de cada um, até estabilizar. Começa pela quantidade.
  - Itens que sempre aparecem juntos, na mesma proporção, dividem o tempo pela quantidade até uma OS os separar.
- **A medida** (`ai_measures`, tipo `duracao_item`), uma por item e cliente e uma geral por item.
  - Guarda o homem-minuto por unidade, as execuções, as unidades e as dez OS mais recentes.
  - A do cliente só usa as OS dele. O id sai do tipo, do cliente e do item.
- **Zeragem.** `tools/full_reset_btg.py` preserva `ai_measures` e `ai_cursors`.
- **Testes.**
  - `medidas.test.ts` resolve à mão um caso de dois clientes: no Itaú, A e B em 20; no Safra, A em 30; na geral, A em 25 e B em 17,5. Cobre também o tempo de trabalho, a amostra, a ordem das OS e o item livre.
  - `medidas.integration.test.ts` cobre a primeira vez, o evento que não muda, o do último minuto, a OS reaberta e a medida que não mudou.
  - `callables.test.ts` trava a rotina e a falta de callable.

### Parte 5.1b: as outras medidas e as regras

Feita em 23/10/2026. As contas estão em `functions/core/src/domain/medidas.ts`,
ao lado do tempo por item. A rotina `runMeasures` calcula as quatro do zero, numa
leitura das OS revisadas e dos fechamentos.

- **O erro do planejamento** (`erro_planejamento`), por cliente e geral.
  - A amostra é a OS revisada de serviço com a janela e o tempo real, como a revisão grava (`minutos_planejados` e `minutos_reais`).
  - O erro de cada OS é (real − planejado) ÷ planejado. A medida guarda a média em pontos percentuais (positiva é plano otimista), as OS que passaram da janela e as mais recentes.
- **Os itens que passam do planejado** (`passa_do_planejado`), por item e cliente e geral.
  - A amostra é a linha da LPU com planejado na revisão. O feito é o corrigido, senão o registrado.
  - A medida guarda as OS com o item, em quantas o feito passou, o excesso médio delas e as mais recentes que passaram.
- **O prazo de aprovação do orçamento** (`prazo_aprovacao`), por cliente e geral.
  - A amostra é o fechamento pelo cliente (`demand.won`, do Comercial), com os segundos desde que a demanda passou a esperar o cliente, que é o envio da RV que fechou.
  - A medida guarda a mediana e a média dos dias e as demandas mais recentes. A demanda reaberta e fechada de novo conta o último fechamento.
  - O fechamento também acorda a rotina: `demand.won` entra nos eventos dela.
- **As regras.** `ai_measures` abre a owner, admin, interno e comercial, a do cliente e a geral. O cliente, o campo, o painel e o resto da equipe não leem. `ai_cursors` não abre. Ninguém grava pelo navegador.
- **Testes.**
  - `medidas.test.ts` resolve à mão cada medida: o erro de +25%, −25% e +50% dá 17%; o excesso de +20% e +60% dá 40%; os prazos de 2, 6 e 9 dias dão mediana 6.
  - `medidas.integration.test.ts` cobre o fechamento que acorda a rotina e a janela que dá o erro.
  - `memoria-medidas.rules.test.ts` cobre as regras.

### Parte 5.2a: a duração sugerida no backend

Feita em 23/10/2026. As regras estão em `functions/core/src/domain/sugestao.ts`;
as leituras e a gravação em `sugestao-gravacao.ts`.

- **`suggestDuration`** só lê. Recebe a demanda, a equipe e os itens da OS (o item da LPU, o nome e a quantidade).
  - O cliente vem da demanda, nunca do pedido.
  - A base de cada item é a medida do cliente com 5 execuções; sem ela, a geral com 15. Abaixo disso, o item fica sem base.
  - Cada item com base leva o homem-minuto por unidade vezes a quantidade, dividido pela equipe. O total soma os itens com base e arredonda para cima, de 5 em 5 minutos.
  - Acima da jornada de 8 horas, sugere dividir: em quantas OS e quanto em cada uma.
  - Com o erro médio do planejamento do cliente a partir de 15% (com o mesmo mínimo de execuções), avisa que os planos dele costumam ser otimistas.
  - Devolve a base de cada item: do cliente ou geral, as execuções, o homem-minuto e as OS mais recentes.
- **`answerSuggestion`** grava, quando a OS é salva, o que a pessoa fez: aceitou, mudou ou recusou, e os minutos escolhidos.
  - O sugerido é recalculado no servidor, nunca o que a tela mandou.
  - A OS precisa ser da demanda e do mesmo cliente. A callable não toca na OS: quem salva é a da Operação.
  - Sem base em nenhum item, não houve sugestão e nada se grava.
  - Repetir a mesma chave devolve a mesma resposta. A chave com outra resposta recusa.
- **O valor real.** Quando a OS é revisada, a rotina das medidas grava o tempo de trabalho dela (a mesma conta das medidas) e o erro contra o sugerido. Revisada de novo, vale a última revisão.
- **Quem pede.** Owner, admin e interno, a mesma lista de quem planeja a OS na Operação (`platform-lists.test.ts` trava as duas).
- **Regras.** `ai_suggestions` abre a quem pediu e a owner e admin. Ninguém grava pelo navegador.
- **Zeragem.** `tools/full_reset_btg.py` preserva `ai_suggestions`.
- **Produção.** As duas callables sobem com a próxima publicação e recusam no `dute-prod`. O roteiro do lançamento (`lancamento-producao.md`) conta 116 callables e três rotinas.
- **Testes.**
  - `sugestao.test.ts` cobre a base, o tempo com a equipe, o arredondamento, a divisão, o aviso, o erro e o pedido.
  - `sugestao.integration.test.ts` cobre o cliente da demanda, a base geral do outro cliente, quem pede, a resposta gravada sem tocar na OS, a repetição, a OS de outra demanda e o valor real depois da revisão.
  - `memoria-medidas.rules.test.ts` cobre as regras; `callables.test.ts`, o formato das callables.

### Parte 5.2b: a duração sugerida no Planejar OS

Feita em 23/10/2026. Os textos e a decisão estão em `artifacts/app/src/lib/memoria/sugestao.ts`;
os pedidos em `use-sugestoes.ts`; a tela em `pages/operacao/planejar-view.tsx`.

- **O pedido.** Cada OS do plano pede a sua: a equipe que vai nela e as linhas com quantidade, com o item da tabela.
  - A linha do escopo e o item pedido passam a levar o item da LPU (`lpuItemId`).
  - Sem equipe ou sem nenhum item da tabela, não há o que sugerir.
  - A tela pede só depois que o plano para de mudar e guarda a resposta de cada pedido. Fora da liberação da memória, não pede nada.
- **No Quando**, embaixo da janela da OS:
  - "Duração sugerida 2h30 com 2 pessoas", com "Usar" e "Ignorar";
  - a base de cada item: o tempo por unidade com a equipe, quantas execuções, do cliente ou da média interna, e as três OS mais recentes;
  - o item sem base;
  - acima de 8 horas, em quantas OS dividir;
  - o aviso de que os planos do cliente costumam passar da janela.
  - Sem base em nenhum item, diz só isso.
- **"Usar" só preenche.** Põe o fim a partir do início (sem início, a partir das 8h). A sugestão é o tempo de trabalho: quem planeja soma o trajeto. Quem salva é a pessoa, com Agendar, que continua a única ação principal.
- **A decisão.** Salvo o plano, cada OS com sugestão manda ao `answerSuggestion` o que a pessoa fez:
  - "Ignorar" é recusou;
  - "Usar" sem mexer no fim é aceitou;
  - o resto é mudou.
  - A decisão vale para o pedido daquela hora: mudar a equipe ou os itens depois faz uma sugestão nova.
  - Falhar não segura a volta à demanda.
- **Testes.**
  - `memoria/sugestao.test.ts` cobre o pedido, os textos, o "Usar", a decisão e a resposta.
  - `planejar-view.test.tsx` cobre os textos do Quando, a ação principal, sem base, a divisão, o que não aparece e `axe`.
  - `memoria/api.test.ts` trava a lista das callables contra as exportadas pelo núcleo.

### Parte 5.3a: as lembranças das demandas fechadas

Feita em 23/10/2026. As contas estão em `functions/core/src/domain/lembrancas.ts`;
a rotina em `lembrancas-gravacao.ts`.

- **A lembrança** (`ai_case_memory/{demanda}`), uma por demanda fechada: A faturar, faturada ou paga.
  - O orçado é a RV que fechou o escopo. O realizado é a RV que o cliente validou, ou a mesma quando o executado não mudou. A demanda direta não tem orçado.
  - Cada item guarda a quantidade orçada e a realizada. O ajuste fica de fora, porque é só dinheiro.
  - Guarda o valor dos dois em centavos, os serviços, o período executado e as OS revisadas da demanda e do mesmo cliente, com o tempo de trabalho e o homem-minuto.
  - O resumo em texto junta a demanda, o cliente, o título, os serviços, o feito, os valores e o tempo. Fica para o Agent Dute.
  - O fechamento é a entrada na etapa fechada depois da última reabertura. Sem marco, vale a data da validação.
- **O vetor de semelhança** é o dos itens da LPU feitos, com o log da quantidade (pergunta 29). O item avulso fica de fora. A semelhança de dois casos é o cosseno dos vetores; a busca entra na parte 5.3b.
- **A rotina.** Roda na mesma `runMeasures`, a cada 15 minutos, com o cursor próprio (`ai_cursors/lembrancas`). As medidas e as lembranças rodam juntas, e a falha de uma não para a outra.
  - Lê a mudança de etapa que entra ou sai das etapas fechadas e a OS revisada ou reaberta.
  - Refaz a lembrança da demanda como ela está agora: a fechada ganha, a reaberta perde. A que não mudou não se grava de novo.
  - O Financeiro leva a demanda a faturada e a paga sem mudança de etapa no evento. A lembrança não guarda a etapa, então nada muda nela.
  - Na primeira vez, refaz as de todas as demandas fechadas e marca o cursor.
  - O cursor das duas rotinas mora em `cursor.ts`.
- **As regras.** `ai_case_memory` não abre pelo navegador, nem a owner, porque tem preço e é de cada cliente. A callable da parte 5.3b lê pelo cliente e pelo papel.
- **Zeragem.** `tools/full_reset_btg.py` preserva `ai_case_memory`.
- **Testes.**
  - `lembrancas.test.ts` resolve à mão um caso: no Itaú, 12 mesas e 40 cadeiras orçadas por R$ 5.000,00 e 14 mesas, 40 cadeiras e 3 caixas avulsas validadas por R$ 5.600,00, em duas OS de 3 horas e 420 homem-minutos. Cobre também o vetor, o resumo, a demanda direta, o fechamento depois da reabertura, a semelhança e os eventos que contam.
  - `lembrancas.integration.test.ts` cobre a primeira vez, a OS de outro cliente que nunca entra, a reabertura, o fechamento, a lembrança que não mudou e o evento do último minuto.
  - `memoria-medidas.rules.test.ts` cobre a regra; `callables.test.ts`, a rotina que roda as duas.

### Parte 5.3b: os orçamentos parecidos no backend

Feita em 23/10/2026. As contas estão em `functions/core/src/domain/parecidos.ts`;
a leitura em `parecidos-gravacao.ts`.

- **`findSimilarQuotes`** só lê. Recebe a demanda em montagem e os itens da LPU do orçamento, com as quantidades.
  - O cliente vem da demanda, nunca do pedido. Só as lembranças desse cliente entram, as 300 fechadas mais recentes.
  - A própria demanda nunca aparece.
  - Devolve os três mais parecidos, a partir de 50%. Empatados, o fechado mais recente vem primeiro.
  - Cada caso leva a semelhança, os itens em comum, os itens com o orçado e o realizado, o valor dos dois, o período executado, as OS e o tempo de trabalho. Não leva o vetor nem o cliente.
- **A semelhança** passa a ser o cosseno vezes a razão dos tamanhos dos vetores. O cosseno sozinho dá 100% para 12 e para 300 mesas, porque compara só a proporção. Com a razão, 12 mesas contra 14 dão 95%, e contra 30 dão 75%.
- **Quem pede.** Owner, admin e comercial: quem orça e lê preço. É a lista `ORCAMENTO_ROLES`, igual à `COMERCIAL_ROLES` do Comercial (`platform-lists.test.ts` trava as duas).
- **O índice.** `ai_case_memory` por `customer_code` e `fechada_em`, no `firestore.indexes.json`.
- **Produção.** A callable sobe com a próxima publicação e recusa no `dute-prod`. O roteiro do lançamento conta 117 callables e três índices novos.
- **Testes.**
  - `parecidos.test.ts` resolve à mão o pedido de 12 mesas e 40 cadeiras contra três casos do Itaú e um idêntico do Safra. Cobre também a ordem dos empatados, o limite de três, a própria demanda e o pedido.
  - `parecidos.integration.test.ts` cobre o cliente da demanda, o caso idêntico do outro cliente, quem pede e que nada grava.
  - `callables.test.ts` trava o formato; `memoria/api.test.ts`, a lista do app.

### Parte 5.3c: os orçamentos parecidos na montagem

Feita em 23/10/2026. O pedido, os textos e o "Usar as quantidades" estão em
`artifacts/app/src/lib/memoria/parecidos.ts`; a tela em
`pages/comercial/orcamento-view.tsx`.

- **O pedido.** As linhas da tabela do orçamento com o item da LPU e quantidade. A linha avulsa e o ajuste ficam de fora.
  - A tela pede só na montagem (o rascunho que não foi perdido nem cancelado) e com a memória liberada.
  - Pede depois que as linhas param de mudar. Enquanto o pedido novo carrega, fica a resposta anterior, para o painel não piscar.
- **Depois dos itens**, cada caso parecido aparece com estes dados:
  - "Demanda 10031", que abre o orçamento dela, e "96% parecido";
  - o título e "Fechada em 15/09/2026";
  - os itens com o orçado e o realizado;
  - o orçado, o realizado, o período executado e "7h em 2 OS".
  - Sem caso parecido, o painel não aparece.
- **"Usar as quantidades" só preenche.** O item do caso que já está numa linha fica com a quantidade realizada; o que não está entra pela tabela.
  - O item que a tabela não tem e o que não foi feito ficam de fora.
  - Quem salva é a pessoa, e "Enviar para aprovação" continua a única ação principal.
  - Quando as linhas já têm as quantidades do caso, o botão dá lugar a "Quantidades da demanda 10031 no orçamento".
- **O código comum.**
  - A espera, a memória das respostas e a nova tentativa ficaram num hook só (`use-nucleo.ts`), que a duração sugerida também usa.
  - Carregar itens nas linhas (`carregarItens`, em `montar.ts`) serve à vistoria e aos parecidos.
- **Testes.**
  - `memoria/parecidos.test.ts` cobre o pedido, os textos, os itens que dá para usar e o "Usar as quantidades".
  - `orcamento-view.test.tsx` cobre os textos na ordem, a ação principal, o link sem vermelho, quando não aparece, o ocupado e `axe`.

### Parte 5.4a: o relógio do estoque e a regra dos dias parado

Feita em 23/10/2026. A regra está em `lib/dominio/src/parados.ts`, com a
cópia em `functions/core/src/domain/parados.ts`; a rotina em
`functions/core/src/domain/parados-gravacao.ts`.

- **A regra.** O limite de cada modelo de operação, os movimentos que contam,
  o relógio e a idade do item com as etiquetas, em funções puras.
  - O app e o núcleo rodam os mesmos casos de `parados.casos.json`, e a trava
    confere que a cópia do núcleo é idêntica.
  - A ficha de cada modelo, em Configurações › Clientes, mostra "Dias parado"
    com a regra dele.
- **A rotina.** `runMeasures` passou a fazer também o relógio do estoque, com
  o cursor `parados`. A falha de uma das três não para as outras.
  - Lê o razão em ordem de gravação, até 10 lotes de 300 movimentos por vez.
    Na primeira vez, lê do começo.
  - Cada movimento relê o saldo do item nas posições do mesmo cliente, até o
    que não conta no relógio.
  - O cursor guarda a versão da rotina (`VERSAO_DOS_PARADOS`). Quando o que o
    item guarda mudar, a versão sobe e a rotina relê o razão inteiro.
  - Grava só o item novo ou o que mudou.
- **Regras.** `ai_stock_age` abre a quem lê o estoque (`canReadOperations`).
  O cliente, o comercial, o financeiro, o campo e o painel não leem.
  Ninguém grava pelo navegador.
- **Zeragem.** `ai_stock_age` vai embora com o estoque
  (`tools/full_reset_btg.py`), e o teste da ferramenta trava.
- **Testes.**
  - `parados.test.ts`, no app e no núcleo: os casos de referência e a cópia.
  - `parados.integration.test.ts`, no emulador:
    - o relógio e o saldo por cliente e SKU;
    - a guarda e a contagem cíclica mudam o saldo, não o relógio;
    - o movimento do último minuto espera;
    - ler de novo, sem cursor ou com outra versão, não muda nada;
    - o razão maior que um lote é lido na mesma vez;
    - nada grava fora da memória.
  - `memoria-medidas.rules.test.ts`: quem lê e quem não lê `ai_stock_age`.

### Parte 5.4b: os dias parado da caixa

Feita em 23/10/2026. A idade da caixa está em `lib/dominio/src/parados.ts`
(`idadeDaCaixa`), com a cópia no núcleo; a rotina passou a guardar a última
saída do item em cada posição (`saidas_por_posicao`).

- **A conta.** A caixa guardada conta desde a guarda (`stored_at`) ou desde a
  última saída de um SKU dela pela posição dela, a mais nova das duas.
  - A saída do mesmo SKU por outra posição não conta, nem a de um SKU que não
    está na caixa, nem a entrada na posição.
  - A caixa vazia não tem idade. A posição vale em maiúsculas, como no mapa.
- **A rotina.** A versão subiu para 2: na primeira vez depois da publicação,
  ela relê o razão do começo e grava a saída por posição de cada item. A guarda
  sai da doca e não conta.
- **Testes.**
  - Os casos de referência das saídas por posição e da caixa, no app e no
    núcleo.
  - No emulador, a saída por posição gravada no item e a idade de duas caixas.

### Parte 5.4c: os dias parado em Estoque

Feita em 23/10/2026. A leitura e os textos estão em
`artifacts/app/src/lib/memoria/parados.ts`; a tela em `pages/estoque.tsx`.

- **Os dados.** A tela lê os itens do cliente ativo em `ai_stock_age`
  (`/api/stock-age`, só o filtro do cliente) e as caixas dele. A regra é a do
  modelo do cliente ativo, e o dia é o de São Paulo. Fora do `dute-homolog`,
  onde a memória não roda, a tela não lê nada disso.
- **A lista.** "Parado 90+ dias" e "Sem giro" entram junto das outras
  etiquetas do item, no tom de atenção: o vermelho continua só de Zerado e
  Baixo. Os filtros "Parados" e "Sem giro" entram em Mostrar, com a contagem.
- **A ficha.**
  - Giro: a última entrada, a última saída e há quantos dias o item está
    sem movimento, com as etiquetas.
  - Caixas: as caixas guardadas com o SKU, as mais paradas primeiro, com a
    posição, os dias e o "Parado 90+ dias" da que passou do limite.
  - Sem o item na memória e sem caixa, nenhuma das duas aparece.
- **Testes.**
  - `memoria/parados.test.ts`: a leitura do item, o giro pela regra, os
    filtros, as caixas e os textos.
  - `estoque.test.tsx`: a etiqueta na lista sem o vermelho, os textos da ficha
    na ordem, quando não aparece e `axe`.

### Parte 5.4d: o alerta do item parado no backend

Feita em 23/10/2026. A conta está em
`functions/core/src/domain/alertas-parados.ts`; a rotina e a decisão em
`alertas-parados-gravacao.ts`; o evento em `eventos.ts`.

- **A proposta.** `runMeasures` roda o relógio do estoque e, depois dele, a
  proposta (`runStockFor`), uma vez por dia de São Paulo (o dia fica no
  cursor `alertas_parados`).
  - O cliente pausado, arquivado, prospect ou sem portal (o modelo Insumos,
    da própria Dutelog) não recebe proposta, e a aberta dele sai.
  - A proposta guarda a regra do modelo e cada item com o saldo, o último
    movimento e os dias parado.
- **A decisão.** `answerStockAlert` recebe o alerta, aprovar ou descartar, e
  os itens. Na transação:
  - confere que a proposta está aberta e que os itens são dela;
  - grava a decisão, quem decidiu e os itens enviados;
  - grava o evento.
  - Só a coordenação decide (`ALERTA_ROLES`, owner, admin e interno).
- **Os eventos do núcleo.** O primeiro evento do núcleo (`source:
  functions_core`). Os tipos `estoque_parado.*` ficam fora do roteador de
  avisos do WMS, para nada ir ao cliente antes da parte 5.4f.
- **Regras e zeragem.** `ai_stock_alerts` abre só à coordenação; ninguém
  grava pelo navegador. Vai embora com o estoque na zeragem, com os eventos
  do núcleo.
- **Testes.**
  - `alertas-parados.test.ts`:
    - os itens da proposta, com o limite da regra e o teto;
    - o decidido que não volta e o que se mexeu, que volta;
    - a escolha na aprovação;
    - a resposta e o evento sem valor.
  - `alertas-parados.integration.test.ts`, no emulador:
    - uma vez por dia;
    - só o cliente com portal;
    - aprovar e descartar com o evento;
    - a decisão que não se refaz;
    - o item que volta depois de se mexer;
    - o cliente pausado perde a proposta;
    - só a coordenação decide.
  - `memoria-medidas.rules.test.ts`: quem lê e quem não lê `ai_stock_alerts`.

### Parte 5.4e: o alerta para aprovar

Feita em 23/10/2026. A tela está em `artifacts/app/src/pages/estoque-alertas-view.tsx`
(só a apresentação) e `estoque-alertas.tsx`; a leitura e a escolha em
`lib/memoria/alertas.ts`.

- **Estoque › Alertas** (`/estoque/alertas`), tela nova na v3, só da
  coordenação (`ALERTA_PARADO_ROLES`, a mesma lista do núcleo, travada em
  `platform-lists.test.ts`).
  - Mostra as propostas abertas de todos os clientes, uma por vez. Com mais
    de um cliente, a escolha fica no topo, com a contagem de itens.
  - O alerta traz o cliente, quantos itens e o "Parado 90+ dias" da regra.
    Cada item tem o código, o nome, o saldo, o último movimento e os dias
    sem movimento, com a caixa de marcar; todos começam marcados.
  - "Enviar ao cliente" é a única ação principal e espera sem item marcado;
    "Descartar" fica ao lado. A decisão vai à callable `answerStockAlert`.
    O erro dela aparece embaixo das ações.
- **O Início da Armazenagem.**
  - O "Precisa de você" ganha "Alerta de 2 itens parados para aprovar", com
    o cliente, ou "2 alertas de itens parados para aprovar", com os clientes.
  - A linha leva a Estoque › Alertas, e quem não decide não a vê.
  - A leitura é a mesma da tela, então a decisão atualiza o Início.
- **Fora do `dute-homolog`** nada disso é lido.
- **Testes.**
  - `memoria/alertas.test.ts`:
    - a proposta aberta lida;
    - a escolha dos itens;
    - a linha do Início para quem decide.
  - `estoque-alertas-view.test.tsx`:
    - os textos na ordem;
    - uma ação principal;
    - sem item marcado e gravando;
    - a escolha do cliente;
    - vazio, carregando e erro;
    - `axe`.

### Parte 5.4f: o aviso do alerta aprovado ao cliente

Feita em 23/10/2026. O aviso sai pela rotina dos avisos da Operação
(`runNotifications`, `functions/operacao/src/domain/avisos.ts`), como os da
OS, da NF e da solicitação.

- **O modelo novo.** "Itens parados" (`estoque_parado`) entra na lista dos
  modelos de aviso, em `lib/dominio/src/avisos.ts` e nas cópias da
  `functions/comercial` e da `functions/operacao`, travadas em
  `platform-lists.test.ts`. O contato liga o modelo no cadastro, como os
  outros.
- **Qual evento vira aviso.** Só o `estoque_parado.aprovado` gravado pelo
  núcleo (`source: functions_core`). O descartado e o mesmo tipo de outra
  codebase ficam de fora.
- **O texto.** A rotina lê o alerta em `ai_stock_alerts` e só segue com ele
  aprovado e com item enviado.
  - O título: "2 itens parados no estoque".
  - O texto: "Sem movimento há 90 dias ou mais · POLO-M e ITAU-000002", com o
    limite da regra do alerta e até três códigos (o do cliente, ou o SKU),
    mais quantos sobram.
  - O link leva ao estoque do portal.
  - Nem o saldo nem o valor entram no aviso.
- **Quem recebe.** O aviso vai só ao cliente do alerta, com a armazenagem
  (`wms`) no contrato. O e-mail vai ao contato que ligou o modelo; ele não
  leva valor, então vale para todo papel de contato.
- **Fora do `dute-homolog`** o núcleo não grava o evento, então nada sai.
- **Testes.**
  - `avisos.test.ts`, na Operação:
    - o modelo do evento e a fonte;
    - o documento do alerta;
    - o texto com um, dois e mais de três itens;
    - o proposto, o descartado e o sem item, que não viram aviso;
    - o módulo do contrato.
  - A trava dos tipos confere o do núcleo na lista de eventos do núcleo.
  - `avisos.integration.test.ts`, no emulador: o aprovado vira sino e
    e-mail; o proposto, o do cliente sem armazenagem, o descartado e o de
    outra codebase, não.
  - `clientes.test.ts` e `clientes-dialogos.test.tsx`, no app: o modelo novo
    no diálogo do contato.

### Parte 5.5b: o escopo e o leitor do agente

Feita em 23/10/2026. O escopo está em
`functions/core/src/domain/agente-escopo.ts` e o leitor em
`agente-leitor.ts`. Nenhuma callable ainda: a conversa entra na parte 5.5e.

- **A liberação própria.** `AGENTE_AMBIENTES_LIBERADOS` (só o
  `dute-homolog`), no núcleo e no app (`AGENTE_LIBERADO`), travada em
  `platform-lists.test.ts`.
  - A entrada das callables do agente é `requireDuteCaller`: a liberação do
    agente, o login, o perfil e o papel.
  - Têm o agente owner, admin, interno, wms, comercial, financeiro, suporte e
    o cliente (`AGENTE_ROLES`). O perfil passa a trazer o cliente do login
    de cliente.
- **O escopo.**
  - O cliente fala do próprio cadastro. Pedir outro recusa.
  - A equipe fala do cliente ativo. Ele precisa estar em `customers`, não
    arquivado e não prospect.
  - Os módulos são os do papel (cópia de `MODULOS_POR_PAPEL`).
    Armazenagem, Operação e Financeiro só valem com o cliente contratando
    (`client_access`, com o padrão sem a lista). O Comercial vale para todo
    cliente.
  - O módulo do shell precisa ser um deles.
  - Lê valor quem lê preço nas regras (`VALOR_ROLES`, a lista de
    `canReadPrices`), e o cliente, nos documentos dele.
- **O leitor.** É o que as ferramentas recebem no lugar do banco, congelado
  e sem gravação, lote nem transação.
  - `doCliente` consulta sempre com o cliente do escopo e confere de novo o
    que volta.
  - A ferramenta não filtra pelo cliente, não passa de 5.000 documentos e só
    lê as coleções da lista.
  - `documento` devolve vazio para o de outro cliente.
  - `geral` é só da equipe, com o filtro de cada coleção: a medida geral,
    nunca a de um cliente.
  - O que volta vai em JSON puro, com o instante em ISO.
  - A lista não tem acesso, papel, convite, cadastro, preço nem o uso do
    agente.
- **Testes.**
  - `agente-leitor.test.ts`, num banco falso que recusa qualquer gravação e
    devolve os dois clientes de propósito:
    - a forma do leitor;
    - o cliente primeiro em toda consulta;
    - as recusas;
    - o documento de outro cliente;
    - o geral;
    - o JSON puro.
  - `agente-escopo.test.ts`: a liberação, quem tem o agente, quem lê valor e
    os módulos de cada papel em cada contrato.
  - `agente-escopo.integration.test.ts`, no emulador:
    - o escopo do cliente e da equipe, com as recusas;
    - a entrada das callables;
    - o leitor de um cliente, que não devolve o dado de outro.
  - `platform-lists.test.ts`: a liberação, `VALOR_ROLES` contra as regras e
    as cópias dos módulos.


### Parte 5.5c: as ferramentas da Armazenagem

Feita em 23/10/2026. O registro das ferramentas está em
`functions/core/src/domain/agente-ferramentas.ts` e as da Armazenagem em
`agente-armazenagem.ts`. A conversa que as oferece ao modelo entra na parte
5.5e.

- **As ferramentas.** As do agente do WMS, pelo leitor, com as mesmas
  respostas:
  - `resumo_estoque`, `buscar_itens`, `listar_pedidos`, `ver_pedido`,
    `movimentacoes` e `documentos`, para o cliente com armazenagem e a
    equipe da Armazenagem;
  - `recebimentos`, `tarefas_armazem`, `enderecos` e `itens_parados` (novo,
    da parte 5.4), para a equipe;
  - `fila_solicitacoes` e `eventos`, para a coordenação (owner, admin,
    interno e suporte).
- **As diferenças do WMS.**
  - O razão do período é consultado já pelo cliente, com o índice novo de
    `movements` (`customer_code` e `data`).
  - O conhecimento dos documentos vem pelo leitor. O cliente só recebe o
    trecho de documento publicado para ele.
  - `itens_parados` usa a regra do modelo de operação do cliente, que o
    escopo passa a trazer do cadastro.
  - A prévia do faturamento fica de fora (pergunta 33). As faturas entram
    com o Financeiro, na parte 5.5d.
- **Quem recebe.** Sai do módulo e do papel, no servidor
  (`ferramentasDoEscopo`). A entrada do modelo passa pelo esquema; a
  inválida volta como erro, sem ler nada.
- **Testes.**
  - `agente-armazenagem.test.ts`, num banco em memória que recusa qualquer
    gravação, com dois clientes:
    - nenhuma ferramenta grava;
    - nenhuma devolve dado do outro;
    - nenhuma tem parâmetro de cliente;
    - quem recebe cada uma;
    - o que cada uma responde.
  - `agente-armazenagem.integration.test.ts`, no emulador: as consultas de
    verdade, com o período do razão na ordem e os instantes gravados como
    Timestamp.

### Parte 5.5d: as ferramentas da Operação, do Comercial, do Financeiro e da memória

Feita em 23/10/2026. As ferramentas estão em
`functions/core/src/domain/agente-operacao.ts`, `agente-comercial.ts` e
`agente-financeiro.ts`. O catálogo com todas, por módulo, está em
`agente-catalogo.ts`.

- **Operação**, sem valor: a demanda e a OS não guardam preço.
  - `demandas`: as abertas ou todas, com a etapa, a execução prevista, as
    OS e a NF. O cliente não vê a proposta ainda em montagem na Dutelog.
  - `ver_demanda`: o escopo fechado e as OS.
  - `agenda`: as OS de um período, de até 31 dias. O padrão é hoje e os
    próximos 7.
  - `ver_os`: os itens planejados e executados, as etapas e a conclusão.
  - Nas duas últimas, a equipe e o veículo aparecem só para a equipe
    Dutelog. Saem da cópia que a OS guarda, nunca do cadastro de
    colaboradores, que tem CPF.
  - `tempo_dos_itens` (memória da parte 5.1), para quem planeja:
    - o homem-minuto por unidade, com a mesma base da duração sugerida: 5
      execuções do cliente, ou 15 na média geral; abaixo disso, "ainda sem
      base";
    - o aviso de plano otimista;
    - a medida geral não mostra as OS de origem, que são de outros
      clientes.
- **Comercial**, para quem orça (`ORCAMENTO_ROLES`), com o preço:
  - `orcamentos` e `ver_orcamento`, com as linhas, os ajustes, as condições
    e a validade;
  - `lpu`, com o preço da tabela ativa do cliente, ou da Padrão Dutelog;
  - `orcamentos_parecidos` (memória da parte 5.3), com a mesma conta da
    `findSimilarQuotes`, o orçado e o realizado de cada caso.
- **Financeiro**, com valor:
  - `faturas`, para o cliente e para quem lê valor: as mensais da
    armazenagem e as dos serviços por NF;
  - `a_receber`, para a equipe que lê valor: o saldo das faturas emitidas e
    enviadas, o vencido, os dias em atraso e a armazenagem sem pagamento.
- **O valor no leitor.** As coleções com valor (`quotes`, `price_tables`,
  `client_invoices`, `client_faturas`, `faturas` e `ai_case_memory`, cujo
  resumo tem R$) só abrem para quem lê valor. O leitor de quem não lê recusa
  antes de consultar.
  - A trava de "o valor só para quem lê valor" passa a ser do leitor, e não
    só da escolha das ferramentas.
  - O geral ganha o catálogo da LPU (só os itens ativos) e a tabela Padrão
    (a sem cliente).
- **Os índices.** Entram dois em `firestore.indexes.json`:
  - `service_orders` por `customer_code` e `janela.data`, para a agenda;
  - `client_faturas` por `customer_code` e `vencimento`.
- **Testes.**
  - `agente-modulos.test.ts`, no banco em memória que recusa gravação, com
    dois clientes. Para cada papel com o agente, as ferramentas que ele
    recebe:
    - não gravam;
    - não trazem o outro cliente;
    - nunca tocam valor sem ler valor.
  - O mesmo teste confere o que cada papel recebe e o que cada ferramenta
    responde.
  - `agente-modulos.integration.test.ts`, no emulador: a agenda pelo dia da
    janela, as listas na ordem, o `in` do a receber, a tabela Padrão e a
    medida geral.
  - `agente-leitor.test.ts`: o que tem valor recusa quem não lê valor, sem
    consultar.

### Parte 5.5e: a conversa no núcleo

Feita em 23/10/2026. A callable é `chatWithDute`, em
`functions/core/src/index.ts`. O fluxo está em
`domain/agente-conversa.ts`, o prompt em `agente-prompt.ts`, as
ferramentas comuns em `agente-comuns.ts` e o modelo em `agente-modelo.ts`.

- **A entrada.** `requireDuteCaller`, com a liberação própria do agente, e
  depois o escopo da parte 5.5b. A trava das callables
  (`callables.test.ts`) passa a aceitar as duas entradas:
  - a da memória, por `requireCoreCaller`;
  - a do agente, por `requireDuteCaller`, que pode responder em partes.
- **O prompt.** São as regras do agente do WMS, com algumas mudanças.
  - Entram:
    - o cliente da conversa;
    - o módulo do shell, por onde o agente começa;
    - os módulos que a pessoa vê.
  - Novas regras:
    - dizer de onde tirou o dado;
    - dizer que a memória ainda não tem base, em vez de estimar;
    - para quem não lê valor, que valores ficam com o Comercial ou o
      Financeiro.
  - Também entram as anotações aprovadas (o cliente só recebe as "para
    todos") e o índice dos playbooks.
- **As ferramentas comuns.**
  - `conversas_anteriores`: só da mesma pessoa e do cliente, fora a
    conversa atual.
  - `consultar_playbook`: o uso vai para o registro da resposta, e o
    playbook não muda.
  - Os cartões: `sugerir_anotacao` (o cartão, sem gravar a anotação,
    pergunta 34), `sugerir_rotina`, e `rascunho_pedido` e `rascunho_envio`
    (para o cliente com armazenagem, pelo leitor, no formato do WMS).
- **O fluxo.**
  - Cada chamada de ferramenta passa pelo esquema e fica anotada. O cartão
    e os playbooks usados saem dessas chamadas, não do formato do modelo.
  - Só o fluxo grava, nas coleções e no formato do agente do WMS:
    - a conversa, com o módulo;
    - a pergunta e a resposta, com o cartão;
    - o uso, com os playbooks abertos e o módulo;
    - o resumo da conversa longa (10 mensagens fora da janela de 20).
  - O cartão de pedido e de envio segue saindo pela `createCustomerRequest`
    do WMS.
  - A conversa de outra pessoa, de outro cliente ou de outro módulo recusa.
    A de antes do núcleo, sem módulo, vale como da Armazenagem.
- **O modelo.**
  - O Gemini pelo Genkit no Vertex AI, com os modelos do WMS. O primeiro que
    falha passa ao reserva, e a resposta em partes tem os mesmos tipos de
    hoje.
  - O Genkit é criado na primeira conversa, para a rotina da memória não
    pagar a partida.
  - `gemini-models.test.ts` do núcleo lê a lista de modelos aposentados do
    teste do WMS e confere que os modelos são os mesmos.
- **Ficam para depois.**
  - A anotação enviada pelo cartão: parte 5.5f.
  - A rotina criada pelo cartão: parte 5.5g. A nota anexada pelo cliente:
    parte 5.5h.
    A conversa do núcleo recusa o anexo por ora.
- **O evento.** A conversa não grava evento em `events`: não é transição
  da operação. O registro dela é a conversa, as mensagens e o uso.
- **Testes.**
  - `agente-conversa.test.ts`:
    - o pedido;
    - o prompt do cliente e da equipe, com e sem valor;
    - os cartões, que não gravam;
    - os rascunhos de pedido e de envio pelo leitor;
    - as conversas anteriores.
  - `agente-conversa.integration.test.ts`, no emulador, com um modelo falso
    que chama as ferramentas:
    - só o fluxo grava;
    - o playbook aberto vai ao uso, sem mudar o playbook;
    - a anotação é só o cartão;
    - o histórico em ordem;
    - as recusas de dono, cliente e módulo;
    - a equipe com o cliente ativo;
    - a resposta de reserva;
    - o resumo da conversa longa.
  - `callables.test.ts`: a entrada de cada callable, e a do agente pela
    liberação do agente.

### Parte 5.5f: as anotações e os playbooks no núcleo

Feita em 23/10/2026. As callables estão em `functions/core/src/index.ts` e a
conta em `domain/agente-revisao.ts`. As coleções são as do WMS
(`ai_agent_notes` e `ai_agent_playbooks`).

- **A anotação pelo cartão** (`suggestDuteNote`).
  - Quem conversou envia o cartão de anotação da resposta do agente.
  - A callable confere que a mensagem é do agente, dessa pessoa e do
    cliente dela, com o cartão de anotação ainda não enviado.
  - A anotação fica pendente, com o evento, e a mensagem guarda o envio.
  - A mesma anotação, já pendente ou valendo, não vira outra. O id sai do
    cliente e do texto, igual ao do WMS.
  - Há no máximo 30 pendentes por cliente.
- **A decisão** (`listDuteNotes` e `decideDuteNote`).
  - Só a coordenação decide (`AGENTE_REVISAO_ROLES`, a lista do WMS,
    travada), sempre do cliente ativo.
  - Aprova, podendo ajustar o texto e para quem vale, ou recusa a pendente,
    ou arquiva a que vale.
  - A anotação de outro cliente não aparece. A mesma decisão de novo não
    grava.
- **Os playbooks** (`listDutePlaybooks`, `saveDutePlaybook`,
  `decideDutePlaybook` e `seedDutePlaybooks`).
  - O escrito pela coordenação vale direto, e a mesma chave não cria dois.
  - O recusado ou arquivado não se edita mais.
  - Os iniciais são a cópia literal do WMS, travada letra por letra, com o
    mesmo id. Entram pendentes no cliente ativo, uma vez só.
- **Os eventos.** `agente.anotacao_*` e `agente.playbook_*` levam só o id (e,
  no playbook, quantos passos e para quem). O texto da anotação pode ter o
  nome de um contato e fica no documento dela.
  - A anotação sugerida é o único evento do núcleo que o cliente grava.
  - A edição do playbook e cada decisão têm o evento delas.
- **O app** ainda fala com o WMS nas anotações e nos playbooks. Passa ao
  núcleo na parte 5.5i.
- **Testes.**
  - `agente-revisao.test.ts`:
    - as cópias travadas contra o WMS (os playbooks iniciais e quem revisa);
    - os ids iguais aos do WMS;
    - os eventos só com o id, e o do cliente só na anotação sugerida.
  - `agente-revisao.integration.test.ts`, no emulador:
    - a anotação pelo cartão e as recusas;
    - a mesma anotação, que não vira outra;
    - a decisão, com o ajuste e a repetição;
    - só a coordenação, só do cliente ativo;
    - o playbook escrito, a chave e a edição;
    - os iniciais uma vez só.

### Parte 5.5g: as rotinas no núcleo

Feita em 23/10/2026. As callables estão em `functions/core/src/index.ts` e a
conta em `domain/agente-rotinas.ts`. A coleção é a do WMS (`agent_routines`),
no formato dele, mais o módulo.

- **A rotina da pessoa** (`listDuteRoutines`, `saveDuteRoutine`,
  `deleteDuteRoutine`).
  - Cada pessoa tem no máximo 5 rotinas por cliente.
  - A rotina é de quem criou, no cliente e no módulo da conversa. A equipe
    cria no cliente ativo, e o cliente só no dele.
  - Alterar e excluir é só da própria. A rotina não muda de módulo, porque
    a conversa dela é do módulo em que nasceu.
  - A agenda é a do WMS, no horário de São Paulo e de 15 em 15 minutos:
    todo dia, dia útil, semana ou mês.
- **Pelo cartão.** A rotina sugerida na conversa (`sugerir_rotina`) entra
  com a mensagem.
  - A callable confere que a mensagem é do agente, dessa pessoa e do
    cliente dela, com o cartão de rotina.
  - O id sai da mensagem, igual ao do WMS. Por isso a mesma mensagem não
    cria duas, nem por um agente nem pelo outro.
  - A mensagem guarda a rotina criada, na mesma transação.
- **A rodada** (`runDuteRoutines`, a cada 15 minutos, uma instância, só com
  a liberação do agente).
  - Pega cada vencida numa transação, que já marca a próxima vez. Duas
    rodadas ao mesmo tempo não rodam a mesma rotina.
  - Roda pelo fluxo da conversa, com o perfil atual de quem criou:
    - sem o histórico;
    - com o dia na pergunta;
    - na conversa `routine_<id>`, com a origem "rotina" na pergunta e no uso;
    - sem o resumo.
  - Sem acesso ao agente, ao cliente ou ao módulo, a rotina pausa sem
    chamar o modelo.
  - A primeira falha tenta de novo em 15 minutos. A segunda fica como "não
    rodou" e volta à agenda.
  - Sem modelo, a resposta de reserva não grava: a rotina falha e tenta de
    novo.
  - A rotina excluída no meio da rodada não para as outras.
- **Rodar agora** (`runDuteRoutineNow`).
  - Só a própria rotina, no máximo uma vez a cada 5 minutos.
  - A falha não mexe na agenda.
- **Uma rotina roda por um só.**
  - A `runAgentRoutines` do WMS não roda onde o agente do núcleo está
    liberado: `CORE_AGENT_PROJECTS`, em
    `functions/wms/src/domain/agent-routines.ts`, é a cópia literal de
    `AGENTE_AMBIENTES_LIBERADOS`, travada em `platform-lists.test.ts`.
  - No `dute-prod`, as rotinas seguem pelo WMS.
- **O app** ainda fala com o WMS nas rotinas. Passa ao núcleo na parte 5.5i.
- **Testes.**
  - `agente-rotinas.test.ts`:
    - a agenda, com os casos do teste do WMS;
    - a pergunta da rotina ao modelo;
    - a entrada, que recusa antes de ler.
  - `agente-rotinas.integration.test.ts`, no emulador:
    - o cartão e as recusas;
    - o limite por cliente;
    - alterar e excluir só a própria;
    - a rodada que pega cada vencida uma vez;
    - o fluxo da conversa sem histórico;
    - a pausa sem acesso;
    - a falha sem modelo;
    - a rotina excluída no meio da rodada;
    - rodar agora.
  - `callables.test.ts`: as callables e a rotina agendada pela liberação do
    agente.
  - `agent-routines.test.ts` do WMS: a guarda por projeto.
