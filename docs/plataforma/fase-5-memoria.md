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
| `ai_cursors/{rotina}` | `functions/core` | Até onde cada rotina leu os eventos |
| `core_operations/{id}` | `functions/core` | O recibo de idempotência das callables |

- **Regras.** As medidas e as lembranças abrem à equipe interna que planeja
  e orça: owner, admin, interno e comercial. As sugestões abrem a quem as
  pediu e a owner e admin. O cliente, o campo e o painel não leem nada
  delas. Ninguém grava pelo navegador.
- **Preço.** A medida de duração e a do planejamento não têm valor. O orçado
  e o preço da lembrança só abrem a quem lê preço, numa leitura pela
  callable (parte 5.3).
- **Zeragem.** As medidas, as sugestões e as lembranças saem das OS e das
  demandas. `tools/full_reset_btg.py` preserva as quatro coleções, como
  preserva a Operação e o Comercial de onde elas saem.

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
| 5.3b | Orçamentos parecidos no Comercial: os itens, as quantidades, o prazo e o preço, com o orçado e o realizado de cada caso | Caso de outro cliente nunca aparece; nada grava no orçamento sem a pessoa aceitar |
| 5.4a | Os dias parado no WMS por item, caixa e peça; as etiquetas pela regra do perfil do cliente | O limite do perfil vale; a etiqueta sai da regra |
| 5.4b | O alerta do item parado, no portal e por e-mail, só depois da aprovação | O alerta não sai sem aprovação |
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
