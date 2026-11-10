# Separação com caixa e volumes de expedição

**Situação:** diagnóstico e decisões do Leonardo em 10/11/2026. Os mockups
foram feitos no mesmo dia (canvas privado
https://claude.ai/artifact/EUrq7Fwu9Xt4BpGRiz1mJz, fontes em
`docs/mockups/WmsSeparar*.dc.html` e `WmsEtiquetaTodos*.dc.html`). As páginas
1 e 2 foram **aprovadas em 10/11/2026**, com as decisões 10 a 15, e a página
3 (a etiqueta com todos os produtos), no mesmo dia, com o logo original da
Dutelog (decisão 16). **A parte 1 (a lista de separação) está no código desde
10/11/2026** (PR 590) **e a parte 6 (a etiqueta com todos os produtos), na
caixa e na posição, também** (registro na seção 5.1); as partes 2 a 5 têm o
mockup aprovado e esperam a vez. Tela só depois do mockup aprovado (decisão
8). Produção só com o OK do Leonardo.

Relação com os outros desenhos: este roteiro retoma a regra 8 e a seção 5.4 do
mapa (`docs/mapa-do-armazem-enderecamento-dirigido.md`) e revê a P8 de
02/11/2026 (`fifo-por-data.md`: "o sistema não diz a caixa nem baixa o conteúdo
dela"). O pedido continua reservando por prateleira e data, como a parte 4 do
FIFO deixou; o que muda é dentro da prateleira. Enquanto a parte 3 daqui não
entrar, vale o FIFO por data como está.

## 1. O caso

Em 09/11/2026 a BTG fez o primeiro pedido depois da zeragem. O carrinho passou
de 100 produtos e virou dois pedidos: PED-0001, com 116 linhas e 3.335 un., e
PED-0002, com 5 itens e 7 un. Os pedidos da BTG são sempre grandes e levam de 3
a 4 dias para separar.

Na prática, quem separa tira as caixas da prateleira. Algumas saem inteiras.
Outras são abertas: sai a quantidade do pedido, a caixa volta à prateleira e a
etiqueta dela precisa dizer o que sobrou. O que vai para a expedição sai em
caixas que precisam de etiqueta, e o cliente quer o conteúdo de cada uma.

## 2. O que o sistema fazia em 10/11/2026

O retrato de antes deste roteiro. A parte 1 mudou a lista e a caixa na linha
(os dois itens marcados abaixo); o resto vale até a parte que o troca.

- **"Separado" é um passo só.** O diálogo pede o "Número do lacre"; para o
  `wms`, todas as linhas são confirmadas na quantidade pedida; a tabela com −
  e + é só de `owner`, `admin` e `interno`
  (`artifacts/app/src/pages/pedidos.tsx`, a mutação `pick`). Por baixo são até
  quatro chamadas: a separação e a embalagem, com `package_count: 1` e
  `volume_label: "VOL-1"`. Nada fica salvo antes da confirmação final.
- **A lista não tinha ordem de caminhada** (mudou na parte 1). "Ver itens"
  mostrava as linhas como o Firestore as devolve, pelo id do documento: a
  ordem do carrinho, e a linha 100 depois da 10 (`lib/cloud-api.ts`,
  `readWhereIn` e `pickingItemsFor`). Não imprimia. Continua sem marcar linha
  (parte 2).
- **A linha não dizia a caixa** (mudou na parte 1). O sistema sabe em que
  caixa cada item entrou (a do recebimento, em `lines[]`; a da abertura, nas
  linhas da sessão; as duas com os SKUs em `sku_codes`), mas a separação só
  mostrava a prateleira.
- **A saída nunca toca a caixa.** Separação, embalagem, entrega, cancelamento,
  movimentação manual e contagem cíclica não leem nem escrevem
  `warehouse_boxes`. A etiqueta reimpressa e o Mapa mostram o conteúdo de
  entrada (`lib/warehouse-labels.ts`, `boxLabel`). Depois da abertura
  concluída não há caminho para corrigir o conteúdo.
- **A caixa vazia continua guardada.** Conta em "Posições ocupadas"
  (`lib/warehouse-map.ts`, `summarizeZone`) e não pode ser removida, porque
  ainda tem linhas (`domain/warehouse-boxes.ts`, `removeWarehouseBox`).
- **Um volume e um lacre por pedido.** O servidor aceita o número de volumes
  (1 a 99), mas grava um `packages` só, `pkg_<tarefa>_001`, com todos os itens
  (`domain/operations.ts`, a embalagem concluída). Não há etiqueta de
  expedição nem romaneio.
- **O operador não tem onde registrar a falta.** Em Pedidos, "Tratar" só
  aparece no pedido que já tem exceção.
- **O saldo baixa na entrega**, não na separação. Entre as duas, a contagem
  cíclica do item naquela prateleira é recusada.

## 3. Decisões do Leonardo (10/11/2026)

| # | Decisão |
|---|---|
| 1 | O limite de 100 itens por pedido fica como está. Subir para 200 saiu deste pacote. |
| 2 | O sistema baixa a caixa mais antiga da prateleira, e a pessoa só corrige quando tirou de outra. |
| 3 | A caixa aberta ganha etiqueta nova a cada pedido: o operador troca a etiqueta. |
| 4 | O cliente quer o conteúdo de cada volume. |
| 5 | O lacre é um por pedido. |
| 6 | A caixa que esvazia deixa de contar em "Posições ocupadas": ela é desmontada, e não se cobra por ela. |
| 7 | A lista de separação entra antes de 16/11/2026. |
| 8 | Toda troca de tela passa por mockup aprovado antes do código. |
| 9 | O pedido que leva dias é o caso normal: o progresso fica salvo linha a linha, e as etiquetas saem ao longo do trabalho. |
| 10 | A página 1 está aprovada como está: a lista sai com a caixa de cada item, lida do conteúdo de entrada, e a folha impressa leva "Separado" em branco. |
| 11 | A caixa que sai inteira vira o volume, sem reembalar ("Levar a caixa"). |
| 12 | A etiqueta do volume sai ao fechar cada volume, sem o total; o lote com o total ("Volume 12 de 42") sai depois de concluir. |
| 13 | Toda etiqueta mostra todos os produtos, na caixa e no volume, no sistema inteiro. O formato são várias etiquetas do mesmo tamanho ("etiqueta 1 de 2"); a etiqueta maior, em A6, ficou de fora. |
| 14 | Quem opera registra "Separar menos"; só a coordenação conclui o pedido com diferença. |
| 15 | O peso do volume é opcional. |
| 16 | A etiqueta com todos os produtos está aprovada, com o logo original da Dutelog no lugar da palavra "Dutelog", em todas as etiquetas. |

## 4. Desenho

### 4.1 A lista de separação (parte 1, só leitura)

- "Ver itens" agrupa as linhas por prateleira, na ordem de caminhada do
  cadastro de Posições (`sequence`). O cabeçalho do grupo diz a prateleira, os
  itens e as unidades. A prateleira fora do cadastro vai para o fim.
- Cada linha mostra a caixa onde o item está (decisão 10): as caixas guardadas
  naquela prateleira cujo conteúdo de entrada tem o item, a mais antiga
  primeiro. É leitura, sem baixa.
- "Imprimir lista" abre a lista em A4, com a impressão do navegador, como as
  Etiquetas: o quadrado para marcar, o produto, o código, a caixa, a
  quantidade e "Separado" em branco (decisão 10).
- No celular, a mesma lista; "Imprimir lista" fica ao lado de "Esconder
  itens", porque os botões do pedido vêm depois das 116 linhas.
- O servidor não muda. "Separado" continua como hoje.

### 4.2 Separar com o progresso salvo (parte 2)

- A ação do pedido passa a ser "Separar", e depois "Continuar". Ela abre a
  bancada do pedido, no computador e no celular.
- Cada linha separada é gravada na hora por uma callable, com papel, status,
  transação, idempotência e evento. "Desfazer" volta a linha. A pessoa para e
  continua no dia seguinte, e outra pessoa pode continuar.
- A fila mostra "em separação desde 10/11 · 10 de 116 itens".
- "Concluir separação" só liga com todas as linhas tratadas. Pede o lacre, um
  por pedido, e fecha a separação e a embalagem numa chamada do servidor (hoje
  a tela encadeia até quatro).
- A reserva, a baixa na entrega e a cobrança ficam como estão.

### 4.3 A caixa na separação (parte 3)

- **Saldo da caixa.** Cada caixa passa a ter o conteúdo atual, que começa
  igual ao de entrada. A etiqueta e o Mapa leem o saldo. O conteúdo de entrada
  fica como histórico.
- **Sugestão.** A linha mostra a caixa mais antiga da prateleira que tem o
  item ("12 de CX-000027"). Se ela não basta, a seguinte completa. A caixa que
  a linha esvazia vem marcada "esvazia"; a que sai toda, "inteira".
- **Baixa.** Ao separar a linha, o saldo das caixas baixa na mesma transação.
  "Outra caixa" corrige: a pessoa informa de qual caixa da prateleira saiu, e
  a soma tem de fechar com a linha.
- **Caixa vazia.** É encerrada: sai do Mapa e de "Posições ocupadas". A ficha
  da prateleira guarda o registro em "Saíram desta prateleira".
- **Caixa aberta.** Entra em "Etiquetas para trocar" até a impressão ser
  registrada. A etiqueta nova traz o saldo e "saldo em DD/MM/AAAA", sem o peso
  de entrada. A data de entrada continua nela, porque é a do FIFO.
- **Conferência.** Para cada prateleira e SKU: o saldo do razão, menos o
  separado que espera a entrega, é igual à soma dos saldos das caixas mais o
  saldo sem caixa.
- O item sem caixa na prateleira separa como hoje, sem caixa na linha.

### 4.4 Volumes de expedição (parte 4)

- A bancada tem um volume aberto. A linha separada entra nele. "Fechar
  volume" pede o peso, opcional (decisão 15), e o próximo volume abre sozinho.
- "Levar a caixa" (decisão 11): a caixa que sai inteira vira o volume, sem
  reembalar. A etiqueta do volume substitui a da caixa.
- Cada volume vira um `packages` com os `package_items` dele. O lacre fica no
  pedido.
- **Etiqueta do volume**, no tamanho de hoje (101,6 × 50,8 mm): o pedido, o
  volume, o cliente, o destino, a data, o peso, os produtos com o código do
  cliente e as unidades. Sai ao fechar o volume ("Volume 12"); depois da
  conclusão, o lote sai com o total ("Volume 12 de 42") (decisão 12). Leva
  todos os produtos, em etiquetas de continuação (seção 4.6).
- **Romaneio** em A4: o conteúdo completo de cada volume, com o código do
  cliente, a quantidade e o peso; o lacre e o total de volumes.
- A etiqueta do volume e o romaneio vão ao cliente: não citam caixa (`CX-`),
  posição nem valor, como o aviso ao cliente desde 02/11.
- "Para entregar" mostra os volumes e o lacre, com "Etiquetas dos volumes" e
  "Romaneio". "Entregue" não muda.

### 4.5 Separar menos por quem opera (parte 5)

Quem opera registra na linha o que separou a menos, com o motivo ("Falta" ou
"Avaria") e o detalhe. O pedido com diferença só conclui com a coordenação,
como hoje (decisão 14). Substitui o "Tratar" como porta de entrada da falta.

### 4.6 Etiqueta com todos os produtos (parte 6)

Até 10/11/2026 a etiqueta da caixa imprimia quatro produtos e "+ n
produto(s) no sistema". Pela decisão 13, toda etiqueta mostra todos os
produtos:

- A primeira etiqueta fica como a de antes e leva até cinco produtos. Com
  mais, diz "etiqueta 1 de 2" ao lado do logo.
- Os outros produtos saem em etiquetas de continuação do mesmo tamanho, onze
  em cada: o código da caixa e a posição (no volume, o pedido e o volume),
  "etiqueta 2 de 2" e as unidades do total. Sem código de barras.
- A ordem é a de sempre, a maior quantidade primeiro.
- Vale para a caixa da abertura, a do recebimento, a caixa aberta com o saldo
  e o volume. A mesma folha de dez e o mesmo rolo; a contagem de etiquetas da
  tela soma as de continuação.
- O rodapé de toda etiqueta leva o logo original da Dutelog no lugar da
  palavra (decisão 16), também a de posição. Na folha A4 ele sai nas cores
  originais; no rolo da Zebra, que só imprime preto, sai em preto.

Não depende das partes 2 a 5: entrou antes delas, para a caixa e a posição
(seção 5.1). A caixa aberta com o saldo entra com a parte 3d e o volume, com
a parte 4c, já neste desenho.

## 5. Partes, em ordem

Um problema por commit, com o teste que falha antes.

| # | Parte | O que entra | Teste que falha antes |
|---|---|---|---|
| 0 | Registro | Este roteiro, os mockups e a tabela no README. | Só documentos. |
| 1a | Lista por prateleira | "Ver itens" agrupado pela ordem de caminhada. Só o app. | Linhas em B-09, A-03 e A-05 saem na ordem do carrinho; com 116 linhas, a 100 vem depois da 10. |
| 1b | Imprimir lista | A lista em A4 e o atalho no celular, com os testes de textos e `axe`. | A tela não existe. |
| 1c | A caixa na lista | A caixa de cada linha, lida do conteúdo de entrada. Só leitura. | A linha não mostra caixa. |
| 2a | Progresso no servidor | Separar e desfazer a linha; a conclusão numa chamada. | A linha separada some ao recarregar. |
| 2b | A bancada | "Separar" e "Continuar", o progresso e "em separação desde". | A fila só tem "Separado". |
| 3a | Saldo da caixa | O conteúdo atual por caixa, a etiqueta e o Mapa lendo o saldo, e a conferência. | A caixa de onde saiu peça mostra o conteúdo de entrada. |
| 3b | Baixa na linha | A sugestão da mais antiga, a baixa na transação e "Outra caixa". | A separação não muda a caixa. |
| 3c | Caixa vazia e Mapa | A caixa encerrada, "Posições ocupadas" e "Saíram desta prateleira". | A caixa vazia conta como posição ocupada. |
| 3d | Etiquetas para trocar | A lista das caixas abertas, "saldo em" e o registro da impressão. | A etiqueta sai com o conteúdo de entrada. |
| 4a | Volumes no servidor | Um `packages` por volume, "Levar a caixa" e o lacre no pedido. | O pedido só tem o volume `_001`. |
| 4b | Volumes na bancada | O volume aberto, "Fechar volume" e o peso. | — |
| 4c | Etiqueta do volume e romaneio | As duas impressões. | — |
| 4d | Para entregar | Os volumes e o lacre na fila. | — |
| 5 | Separar menos | A diferença registrada por quem opera. | O operador não tem onde registrar a falta. |
| 6 | Etiqueta com todos os produtos | As etiquetas de continuação e o logo, na caixa e na posição; com a parte 3d, na caixa aberta e, com a 4c, no volume (seção 4.6). | A caixa com nove produtos imprime quatro e "+ 5 produto(s) no sistema". |

As partes 1 a 5 têm o mockup aprovado (páginas 1 e 2), e a parte 6, o da
página 3. Cada parte entra na homologação no merge e na produção só pela
publicação manual, com o OK do Leonardo. A régua `billing-callables` fica
verde em todas.

### 5.1 Registro das partes

**Parte 1, a lista de separação (10/11/2026, PR 590).** Só o app e só
leitura: nenhuma callable, regra ou índice mudou, e "Separado" continua como
estava. Os commits saíram na ordem 1a, 1c e 1b, para a folha já nascer com a
coluna "Caixa" preenchida.

- **1a, por prateleira.** A regra mora em
  `artifacts/app/src/lib/warehouse-ops/lista-de-separacao.ts`
  (`gruposDaSeparacao`): as prateleiras na ordem do `sequence` do cadastro de
  Posições; a que não está no cadastro vem depois, em ordem; a linha sem
  endereço fica no fim. Dentro da prateleira: a caixa, a família com os
  tamanhos em ordem e o número da linha do pedido (`line_number`, que a
  leitura da fila passou a trazer). As posições vêm da mesma leitura do Mapa
  (`use-lista-de-separacao.ts`); enquanto não chegam, a ordem é a do código
  da prateleira. No celular a linha segue `WmsSepararListaCelular`: o nome e
  os códigos à esquerda, a quantidade no alto, à direita.
- **1c, a caixa de cada item.** `caixasDoItem`: as caixas `stored` daquela
  prateleira, do cliente do pedido, com o SKU em `sku_codes`, pela data da
  guarda (`stored_at`) e, no empate, pelo código. As caixas vêm da consulta
  da Contagem (`/api/warehouse/boxes?customer_code=…`), com o índice já
  travado em `cloud-api-indices.test.ts`. A caixa só aparece no pedido que
  ainda está para separar: no separado e no entregue o item já saiu dela. É o
  conteúdo de entrada: depois do primeiro pedido separado, a lista pode citar
  uma caixa que já esvaziou, até a parte 3 (seção 7).
- **1b, "Imprimir lista".** A tela nova Pedidos › Lista de separação
  (`/pedidos/lista?pedido=<chave do pedido>`, na v3, os papéis de Pedidos),
  com a folha em `features/warehouse-ops/lista-de-separacao-documento.tsx`.
  O destino e o "Para quando" vêm da solicitação que originou o pedido
  (`customer_requests/{id}`); "Impressa em" é a hora do clique em "Imprimir".
  A folha espera as posições, as caixas e a solicitação; a leitura que falha
  vira aviso acima da folha, fora do papel. Nada é gravado ao imprimir.
- **O "Para quando" na fila de quem separa.** A prancha mostra o prazo na
  linha do pedido para quem opera; só a coordenação via, porque o prazo vinha
  da lista das solicitações, que o armazém não lê. Quem não decide lê o
  `due_at` da solicitação do pedido, pelo id.

O que a folha tem além da prancha, que só desenha a primeira página:

- O cabeçalho da tabela se repete em cada página; a linha não se parte; a
  prateleira com até 12 linhas fica inteira numa folha, e a maior quebra onde
  a folha acabar, sem repetir o cabeçalho da prateleira.
- O rodapé de cada página ("app.dutelog.com.br" e "PED-0001 · página 2 de 5")
  sai pelas caixas de margem do `@page`, que o Chrome e o Edge imprimem. Em
  navegador sem isso, a folha sai sem o rodapé; na tela, o rodapé fica no fim
  da folha, sem a página.
- O nome comprido quebra a linha em vez de cortar; o código e a caixa não se
  partem no meio.
- O cabeçalho usa o logo da Dutelog, como a OS impressa, e o botão da tela é
  "Imprimir".

Conferido em 10/11/2026 com um pedido sintético de 116 linhas, no Chromium:
cinco páginas A4, o cabeçalho e o rodapé em todas, dentro do shell da
Armazenagem. Os testes: `lista-de-separacao.test.ts`, `pedidos.itens.test.tsx`,
`pedidos.lista.test.tsx` e `pedidos-lista-view.test.tsx` (a lista dos textos
e o `axe`).

**Parte 6, a etiqueta com todos os produtos (10/11/2026).** Só o app: a
etiqueta é desenho e impressão do navegador, e nada muda no servidor nem no
registro da impressão (que é por caixa).

- **Os dados.** `boxLabels` (`artifacts/app/src/lib/warehouse-labels.ts`)
  devolve as etiquetas de uma caixa: a primeira com até cinco produtos
  (`FIRST_LABEL_LINES`) e as de continuação com onze cada
  (`CONTINUATION_LABEL_LINES`), todas com a parte ("1 de 2") e as unidades da
  caixa inteira. O "+ n produto(s) no sistema" e o `MAX_CONTENT_LINES` saíram.
- **O desenho.** `components/labels/label-sheet.tsx`: a primeira etiqueta como
  antes, com "etiqueta 1 de 2" só quando a caixa pede mais de uma; a de
  continuação com a caixa, a posição, a parte e os produtos, sem código de
  barras. A continuação ocupa uma vaga da folha de dez ou uma página do rolo,
  como qualquer etiqueta, e entra na contagem da tela.
- **O logo.** O rodapé das etiquetas de caixa, de continuação e de posição
  leva `/dutelog-logo.png` (3,6 mm de altura) no lugar da palavra. No modo
  "Uma por etiqueta (rolo Zebra)" o logo sai em preto (`filter:
  brightness(0)`), porque a térmica só imprime preto e o vermelho sairia
  reticulado; na folha A4, nas cores originais.
- **O que cabe.** Com o logo no rodapé, a linha do conteúdo passou de 1,3
  para 1,2 de entrelinha. Medido no Chromium, na folha e no rolo: os cinco
  produtos cabem na primeira com 0,6 mm de folga, e os onze na de
  continuação, com 3,5 mm.

Os testes: `warehouse-labels.test.ts` (a caixa com nove produtos, que
imprimia quatro e "+ 5 produto(s) no sistema", sai em duas etiquetas; 16 e 17
produtos) e `label-sheet.test.tsx` (os textos de cada etiqueta, o logo em
todas, o preto no rolo e o `axe`).

## 6. Perguntas

Todas respondidas pelo Leonardo em 10/11/2026.

Página 1 do canvas (a lista), aprovada como está:

| # | Pergunta | Resposta |
|---|---|---|
| 1 | A lista já sai com a caixa de cada item, lida do conteúdo de entrada, sem baixa? | Sim (decisão 10). Hoje é exato, porque nenhum pedido saiu ainda. |
| 2 | A lista impressa leva "Separado" em branco, para anotar a quantidade diferente? | Sim (decisão 10). |

Página 2 (separar com caixa e volumes):

| # | Pergunta | Resposta |
|---|---|---|
| 1 | A caixa que sai inteira vira o volume, sem reembalar? | Sim (decisão 11). |
| 2 | A etiqueta do volume sai ao fechar cada volume, sem o total, e o lote com o total só depois de concluir? | Sim (decisão 12). |
| 3 | A etiqueta do volume mostra até quatro produtos e "+ n no romaneio", ou o cliente precisa de todos os produtos na etiqueta? | Todos os produtos, em todas as etiquetas do sistema, em várias etiquetas do mesmo tamanho (decisão 13). |
| 4 | Quem opera registra "Separar menos", e só a coordenação conclui o pedido com diferença? | Sim (decisão 14). |
| 5 | O peso do volume é opcional? | Sim (decisão 15). |

Página 3 (a etiqueta com todos os produtos): aprovada em 10/11/2026, com um
pedido.

| # | Pergunta do Leonardo | Resposta |
|---|---|---|
| 1 | Dá para colocar o logo original da Dutelog nas etiquetas? | Sim (decisão 16): no rodapé, no lugar da palavra, em todas as etiquetas; em preto no rolo da Zebra. |

## 7. PED-0001 e PED-0002

Os dois são separados com o sistema de hoje e a lista da parte 1. Enquanto a
parte 3 não entra, a caixa aberta leva a sobra e a data escritas à mão, e a
lista impressa guarda de qual caixa saiu cada linha e quais esvaziaram.

A caixa da lista é a do conteúdo de entrada (decisão 10). Nesses dois pedidos
ela é exata, porque nenhum pedido saiu desde a zeragem. Do terceiro pedido em
diante, e até a parte 3, a lista pode citar uma caixa que os pedidos
anteriores já esvaziaram: vale a anotação à mão na caixa.

Quando a parte 3a entrar, o saldo das caixas desses pedidos é acertado uma
vez: pela regra da caixa mais antiga, conferida com a lista anotada, em
simulação antes de gravar.

## 8. O que não muda

O razão por cliente, SKU e posição; a reserva por prateleira e data; a baixa
do saldo na entrega; a cobrança; `client_inventory`; o que o cliente vê (nunca
caixa nem prateleira); as invariantes (escrita crítica por Function, evento em
`events`, IA só recomenda, `customer_code` como fronteira, permissão em Rules e
backend).

## 9. Riscos

- **Pedido separado antes da parte 3.** O conteúdo das caixas fica diferente
  do real até o acerto da seção 7.
- **A sugestão depende do hábito.** Se a pessoa tira de outra caixa e não
  corrige, a etiqueta fica errada; o total da prateleira continua certo.
- **Impressão.** Uma etiqueta por caixa aberta em cada pedido é volume de
  papel em pedido grande.
- **"Posições ocupadas" cai** quando as caixas esvaziam: muda a referência da
  fatura manual (decisão 6).
- **Sem leitura de código de barras.** A confirmação é por toque. A leitura
  fica para depois, como no recebimento.

## 10. Como desfazer

A parte 1 sai revertendo o PR, sem dado para limpar. As partes 2 a 5 gravam
dado novo (progresso da linha, saldo da caixa, volumes): cada uma leva no PR
dela o que fazer com esse dado ao reverter.
