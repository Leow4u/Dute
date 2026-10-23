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

## Liberação

`MEMORIA_AMBIENTES_LIBERADOS = ["dute-homolog"]`, no app (`lib/liberacao.ts`)
e na `functions/core`, travada por `platform-lists.test.ts`. A rotina e as
callables recusam fora dela. O `dute-prod` entra no fim da fase, com o OK do
Leonardo.

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
| 5.4e | O alerta para aprovar no Início da Armazenagem, com os itens para escolher | Textos listados; aprovar pede os itens; `axe` |
| 5.4f | O aviso do alerta aprovado ao cliente, no sino do portal e por e-mail, pela rotina dos avisos | Só o aprovado vira aviso; só ao cliente dele, com a armazenagem no contrato |
| 5.5 | O Agent Dute no núcleo, com as ferramentas de leitura dos módulos; o WMS passa a usar o do núcleo. Desenho próprio antes do código | Ferramenta nunca escreve; isolamento por cliente nas respostas |
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
