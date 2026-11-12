# Separação com caixa e volumes de expedição

**Situação:** diagnóstico e decisões do Leonardo em 10/11/2026. Os mockups
foram feitos no mesmo dia (canvas privado
https://claude.ai/artifact/EUrq7Fwu9Xt4BpGRiz1mJz, fontes em
`docs/mockups/WmsSeparar*.dc.html` e `WmsEtiquetaTodos*.dc.html`). As páginas
1 e 2 foram **aprovadas em 10/11/2026**, com as decisões 10 a 15, e a página
3 (a etiqueta com todos os produtos), no mesmo dia, com o logo original da
Dutelog (decisão 16). **No código desde 10/11/2026** (registro na seção 5.1):
a parte 1 (a lista de separação, PR 590), a parte 6 (a etiqueta com todos os
produtos, na caixa e na posição, PR 591), as partes 2 e 5 (separar com o
progresso salvo e "Separar menos"), a parte 3 (a caixa na separação: o
saldo, a baixa, a caixa vazia e as etiquetas para trocar) e a parte 4 (os
volumes de expedição, a etiqueta do volume, o romaneio e "Para entregar").
As partes 2, 3, 4 e 5 entraram na `main` pelo PR 592, com o OK do Leonardo
em 10/11/2026. **Na produção desde 10/11/2026** (19:52 UTC, commit
`7512f101`): as seis partes, pela publicação manual do Leonardo (seção 5.2).
Tela só depois do mockup aprovado (decisão 8). **Dividir a linha em mais de
um volume (seção 11; pranchas na página 4 do canvas):** perguntas
respondidas e pranchas aprovadas pelo Leonardo em 11/11/2026 (decisões 27 a
30); as partes 7a e 7b vêm a seguir.

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
| 17 | No celular, "Fechar volume" fecha sem peso; o peso fica no computador. |
| 18 | O volume fechado que esvazia sai, e o de maior número ocupa o número dele; a bancada avisa para trocar a etiqueta. |
| 19 | O volume fechado de que sai uma parte perde o peso; a bancada avisa para imprimir a etiqueta de novo. |
| 20 | Depois de "Confirmar separação", a tela fica no pedido separado. |
| 21 | A etiqueta da caixa leva a data de entrada (a do FIFO), e não a da impressão. |
| 22 | O que volta à prateleira (cancelamento, devolução) volta sem caixa. |
| 23 | Ao fechar o volume, a etiqueta não abre sozinha: fica no botão "Etiqueta" do volume fechado. |
| 24 | Com mais de uma caixa saindo inteira na mesma linha, o botão diz "Levar as caixas". |
| 25 | Em "Para entregar", "Ver volumes" fica no lugar de "Ver itens"; no celular, "Etiquetas dos volumes" e "Romaneio" ficam atrás de "Ver volumes". |
| 26 | No romaneio, "Separado" vai da primeira linha separada à conclusão, e "Por" é quem concluiu. |
| 27 | "Dividir em volumes" começa com um volume por caixa de onde a linha sai, a partir do volume aberto, mesmo quando ele já tem itens (11/11/2026, seção 11). |
| 28 | A divisão é automática, e tudo se edita: o último volume já vem com o resto e fica aberto; mexeu numa linha, a última acompanha; mexeu na última, a de cima acompanha. A soma sempre fecha (11/11/2026). |
| 29 | O peso de cada volume que a divisão fecha vai no diálogo, opcional, no computador; no celular, sem peso (11/11/2026). |
| 30 | "Dividir em volumes" também na linha já separada, enquanto o que ela pôs está no volume aberto (11/11/2026). |

As decisões 17 a 26 foram tomadas no caminho das partes 3 e 4, onde as
pranchas não diziam, e confirmadas pelo Leonardo em 10/11/2026, depois do
merge do PR 592. As decisões 27 a 30 são as respostas do Leonardo às
perguntas do "Dividir em volumes", em 11/11/2026 (seção 11.6); a regra da 28
é a forma que a prancha deu ao "automático, podendo editar qualquer coisa".

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
- A primeira linha separada começa a separação: a tarefa vai a `in_progress`
  e o cliente passa a ver "Em separação" no portal.
- A fila mostra "em separação desde 10/11 · 10 de 116 itens".
- "Concluir separação" só liga com todas as linhas tratadas. Pede o lacre, um
  por pedido, e fecha a separação e a embalagem numa chamada do servidor (a
  tela encadeava até quatro).
- A reserva, a baixa na entrega e a cobrança ficam como estão: o progresso é
  só o registro de quem separou o quê, e a reserva e o saldo continuam
  mudando só na conclusão e na entrega.
- A contagem cíclica da prateleira com linha já separada é recusada até a
  entrega, como já era depois da separação concluída.

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

Como ficou no código (registro na seção 5.1): o conteúdo de entrada não muda
de lugar, e a caixa guarda só o que as separações tiraram dela; o saldo é a
entrada menos o retirado. Quem volta à prateleira depois (o pedido cancelado
no meio, a devolução) volta sem caixa. A conferência ainda não tem tela.

### 4.4 Volumes de expedição (parte 4)

- A bancada tem um volume aberto. A linha separada entra nele. "Fechar
  volume" pede o peso, opcional (decisão 15), e o próximo volume abre sozinho.
- "Levar a caixa" (decisão 11): a caixa que sai inteira vira o volume, sem
  reembalar. A etiqueta do volume substitui a da caixa.
- Cada volume vira um `packages` com os `package_items` dele. O lacre fica no
  pedido.
- **Etiqueta do volume**, no tamanho de hoje (101,6 × 50,8 mm; desde
  12/11/2026, na folha A4, 148,5 × 105 mm, quatro por folha, seção 6 de
  `docs/mapa-do-armazem-enderecamento-dirigido.md`): o pedido, o
  volume, o cliente, o destino, a data, o peso, os produtos com o código do
  cliente e as unidades. Sai ao fechar o volume ("Volume 12"); depois da
  conclusão, o lote sai com o total ("Volume 12 de 42") (decisão 12). Leva
  todos os produtos: no rolo, em etiquetas de continuação; na folha A4, em
  etiquetas completas de até cinco produtos (seção 4.6).
- **Romaneio** em A4: o conteúdo completo de cada volume, com o código do
  cliente, a quantidade e o peso; o lacre e o total de volumes.
- A etiqueta do volume e o romaneio vão ao cliente: não citam caixa (`CX-`),
  posição nem valor, como o aviso ao cliente desde 02/11.
- "Para entregar" mostra os volumes e o lacre, com "Etiquetas dos volumes" e
  "Romaneio". "Entregue" não muda.

### 4.5 Separar menos por quem opera (parte 5)

Quem opera registra na linha o que separou a menos, com o motivo ("Falta" ou
"Avaria") e o detalhe. O pedido com diferença só conclui com a coordenação
(decisão 14): a diferença solta a reserva na conclusão, pela regra de sempre
da pergunta 59. Substitui o "Tratar" como porta de entrada da falta, e o
diálogo "Separado" da coordenação, com − e + por linha, sai: a conferência
linha a linha é a própria bancada. Entrou junto com a parte 2, porque sem
ela a bancada deixaria a coordenação sem como separar a menos.

### 4.6 Etiqueta com todos os produtos (parte 6)

Até 10/11/2026 a etiqueta da caixa imprimia quatro produtos e "+ n
produto(s) no sistema". Pela decisão 13, toda etiqueta mostra todos os
produtos:

- A primeira etiqueta fica como a de antes e leva até cinco produtos. Com
  mais, diz "etiqueta 1 de 2" ao lado do logo.
- No rolo da Zebra, os outros produtos saem em etiquetas de continuação do
  mesmo tamanho, onze em cada: o código da caixa e a posição (no volume, o
  pedido e o volume), "etiqueta 2 de 2" e as unidades do total. Sem código
  de barras.
- Na folha A4 (desde 12/11/2026, seção 6 de
  `docs/mapa-do-armazem-enderecamento-dirigido.md`), cada etiqueta é
  completa, com o código de barras e até cinco produtos, quatro por folha
  deitada, porque cada uma é recortada: a "etiqueta 2 de 2" repete o
  cabeçalho da primeira e traz os produtos seguintes.
- A ordem é a de sempre, a maior quantidade primeiro.
- Vale para a caixa da abertura, a do recebimento, a caixa aberta com o saldo
  e o volume; a contagem de etiquetas da tela soma todas.
- O rodapé de toda etiqueta leva o logo original da Dutelog no lugar da
  palavra (decisão 16), também a de posição. Na folha A4 ele sai nas cores
  originais; no rolo da Zebra, que só imprime preto, sai em preto.

Não depende das partes 2 a 5: entrou antes delas, para a caixa e a posição
(seção 5.1). A caixa aberta com o saldo entrou com a parte 3d e o volume, com
a parte 4c, já neste desenho.

## 5. Partes, em ordem

Um problema por commit, com o teste que falha antes.

| # | Parte | O que entra | Teste que falha antes |
|---|---|---|---|
| 0 | Registro | Este roteiro, os mockups e a tabela no README. | Só documentos. |
| 1a | Lista por prateleira | "Ver itens" agrupado pela ordem de caminhada. Só o app. | Linhas em B-09, A-03 e A-05 saem na ordem do carrinho; com 116 linhas, a 100 vem depois da 10. |
| 1b | Imprimir lista | A lista em A4 e o atalho no celular, com os testes de textos e `axe`. | A tela não existe. |
| 1c | A caixa na lista | A caixa de cada linha, lida do conteúdo de entrada. Só leitura. | A linha não mostra caixa. |
| 2a | Progresso no servidor | Separar e desfazer a linha; a conclusão numa chamada; a contagem cíclica recusa a prateleira com linha separada. | A linha separada some ao recarregar. |
| 2b | A bancada | "Separar" e "Continuar", o progresso e "em separação desde". Entrou com a parte 5. | A fila só tem "Separado". |
| 3a | Saldo da caixa | O conteúdo atual por caixa, a etiqueta, o Mapa e a lista lendo o saldo. A conferência ficou sem tela (seção 5.1). | A caixa de onde saiu peça mostra o conteúdo de entrada. |
| 3b | Baixa na linha | A sugestão da mais antiga, a baixa na transação e "Outra caixa". | A separação não muda a caixa. |
| 3c | Caixa vazia e Mapa | A caixa encerrada, "Posições ocupadas" e "Saíram desta prateleira". | A caixa vazia conta como posição ocupada. |
| 3d | Etiquetas para trocar | A lista das caixas abertas, "saldo em" e o registro da impressão. | A etiqueta sai com o conteúdo de entrada. |
| 4a | Volumes no servidor | Um `packages` por volume, "Levar a caixa" e o lacre no pedido. | O pedido só tem o volume `_001`. |
| 4b | Volumes na bancada | O volume aberto, "Fechar volume" e o peso. | A bancada não tem volume. |
| 4c | Etiqueta do volume e romaneio | As duas impressões. | O pedido sai sem etiqueta de volume e sem romaneio. |
| 4d | Para entregar | Os volumes e o lacre na fila, e a tela do pedido separado. | A linha só diz os itens e as unidades, e o pedido concluído, "Separação concluída". |
| 5 | Separar menos | A diferença registrada por quem opera, na linha; só a coordenação conclui com diferença. Entrou com a parte 2. | O operador não tem onde registrar a falta. |
| 6 | Etiqueta com todos os produtos | As etiquetas de continuação e o logo, na caixa e na posição; com a parte 3d, na caixa aberta e, com a 4c, no volume (seção 4.6). | A caixa com nove produtos imprime quatro e "+ 5 produto(s) no sistema". |

As partes 1 a 5 têm o mockup aprovado (páginas 1 e 2), e a parte 6, o da
página 3. Cada parte entra na homologação no merge e na produção só pela
publicação manual, com o OK do Leonardo. As seis chegaram à produção juntas,
em 10/11/2026 (seção 5.2). A régua `billing-callables` fica verde em todas.

O que as partes decidiram no caminho está junto do registro de cada uma
(seção 5.1) e foi confirmado pelo Leonardo em 10/11/2026 (decisões 17 a 26,
seção 3).

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

**Partes 2 e 5, separar com o progresso salvo e "Separar menos"
(10/11/2026).** As duas entraram juntas: a bancada sem a parte 5 deixaria a
coordenação sem como separar a menos, e a prancha aprovada já traz o "Separar
menos" na linha.

- **O servidor** (`functions/wms/src/domain/pick-progress.ts`), duas callables
  de quem opera o armazém (`owner`, `admin`, `interno` e `wms`):
  - `setPickLineSeparated` separa, registra o separado a menos ou desfaz uma
    linha. O progresso mora na linha de separação (`pick_lines`):
    `separated_qty`, `separated_at`, `separated_by` e, a menos,
    `separated_shortage_reason` e `separated_shortage_detail`. A linha
    continua `open`; a reserva, o saldo e o `qty_picked` não mudam. A primeira
    linha começa a separação pela porta de sempre
    (`advanceWarehouseTaskTransaction`, de `planned` a `in_progress`) e data
    o começo na tarefa (`separation_started_at`). Idempotente pela chave e
    pelo estado, em transação, com o recibo em `operational_operations` e o
    evento `picking.line_separated` ou `picking.line_unseparated`, fora da
    caixa de avisos (um pedido tem mais de cem linhas).
  - `completeOrderSeparation` conclui: confere que toda linha foi tratada,
    recusa o pedido com diferença para quem não é da coordenação e roda, em
    ordem, as transições que a tela encadeava (separação concluída, embalagem
    iniciada e fechada com o lacre, um volume). Cada passo tem a chave
    derivada da chave da chamada; repetir continua de onde parou. O resultado
    é o mesmo da cadeia antiga: a régua `billing-callables` e o teste do
    separar a menos seguem verdes.
  - A conclusão manda à transação o `separated_at` que leu de cada linha: a
    linha desfeita ou separada de novo depois dessa leitura recusa ("A
    separação mudou enquanto o pedido era concluído"), e nada conclui.
  - Duas pessoas concluindo ao mesmo tempo: o pedido conclui uma vez. A
    transição que a outra pessoa já fez recusa pelo status, e a conclusão lê
    de novo e continua do que encontrou (até quatro voltas, uma por passo).
    Quem chega com outro lacre recebe "A separação deste pedido já foi
    concluída, com o lacre X"; com o mesmo lacre, é a repetição da chamada.
  - A contagem cíclica (`recordCycleCountTransaction`) recusa a prateleira
    com reserva cuja linha já tem algo separado: o item saiu da prateleira e
    só baixa do saldo na entrega. A linha separada com zero não barra a
    contagem.
  - O cancelamento no meio da separação (`cancelWarehouseOrderTransaction`)
    segue a decisão da pergunta 59 ("se já foi separado, pede a volta do
    item à posição"), agora por linha: a reserva sai inteira, e o que a linha
    já separou (`separated_qty`, nunca mais que a reserva) passa no razão da
    prateleira para a `EXPEDICAO` e ganha a guarda de volta, pelo mesmo
    caminho do separado do pedido concluído (movimento interno, sem
    cobrança). A linha por separar e a linha zerada só soltam a reserva. A
    reserva guarda `returned_qty`. Antes, o cancelamento soltava a reserva e
    deixava disponível na prateleira o que estava na bancada.
- **O app.** A bancada é a tela nova Pedidos › Separar
  (`/pedidos/separar?pedido=<chave do pedido>`, na v3, os papéis de Pedidos;
  o suporte só consulta): `pages/pedidos-separar.tsx` lê as linhas e a tarefa
  ao vivo do Firestore e chama as callables (`lib/wms/separacao.ts`);
  `pages/pedidos-separar-view.tsx` é a tela; as regras do progresso ficam em
  `lib/warehouse-ops/separacao.ts`. Os diálogos são
  `features/warehouse-ops/separar-menos.tsx` e `concluir-separacao.tsx`. Em
  Pedidos, o "Separado" de um passo só e o diálogo da coordenação
  (`separado.tsx`) saíram. O diálogo "Cancelar pedido" lista em "Voltam à
  posição" também as linhas já separadas do pedido em separação, na mesma
  tabela de antes, sem texto novo (`cancel-order.tsx`).
- **O que da prancha da bancada ficou para as partes 3 e 4** (e entrou com
  elas): a caixa sugerida com a quantidade ("12 de CX-000027", "esvazia",
  "inteira"), "Levar a caixa", "Outra caixa" no "⋯", o painel dos volumes, as
  "Etiquetas para trocar" e os números de volumes e caixas do diálogo de
  concluir.
- **O pedido que parou entre a separação e a embalagem** (a conclusão caiu no
  meio) continua em "Para separar": a bancada abre só para concluir.

Os testes: `pick-progress.test.ts` (a regra sem banco),
`pick-progress.integration.test.ts` (no emulador, do pedido aprovado à
entrega: o progresso, o desfazer, a outra pessoa, a conclusão, a retomada, a
linha que mudou depois da leitura, as duas pessoas concluindo ao mesmo tempo,
o separar a menos, a contagem cíclica e o cancelamento no meio da separação,
com a guarda de volta), as duas linhas na tabela de papéis
(`callables-papeis.integration.test.ts`), `separacao.test.ts`,
`pedidos-separar-view.test.tsx`, `separar-menos.test.tsx`,
`concluir-separacao.test.tsx` (a lista dos textos e o `axe`) e
`cancel-order.test.tsx` (as linhas já separadas em "Voltam à posição").

**Parte 3, a caixa na separação (10/11/2026).** Em commits próprios no PR
592, depois das partes 2 e 5.

- **O saldo é a entrada menos o retirado.** O conteúdo de entrada continua
  onde estava: nas linhas da abertura (`opening_inventory_lines`, pelo
  `box_code`) ou na própria caixa do recebimento (`lines[]`). A caixa passa a
  guardar só o que as separações tiraram dela: `taken_lines` (por SKU),
  `taken_units` e `balance_at`. Assim a correção de uma linha da abertura
  (mover ou remover) continua valendo sem tocar o saldo, e a caixa sem nada
  retirado não ganha campo nenhum. A regra sem banco é
  `lib/dominio/src/saldo-da-caixa.ts`, com a cópia literal em
  `functions/wms/src/domain/saldo-da-caixa.ts` travada por teste; os dois
  lados rodam os mesmos casos (`saldo-da-caixa.casos.json`).
- **A baixa na linha (3b).** `setPickLineSeparated` lê as caixas guardadas do
  cliente na prateleira da linha e baixa, na mesma transação, a mais antiga
  que tem o item (a data da guarda; no empate, o código); a seguinte completa,
  e o que as caixas não têm sai sem caixa. Com `boxes` ("Outra caixa"), baixa
  as caixas informadas: cada uma tem de ter o item na quantidade informada, e
  a soma tem de fechar com a linha (`SEPARATION_BOXES_MISMATCH`). A linha
  guarda de onde saiu (`separated_boxes`, com `whole` na caixa intacta que
  saiu toda e `emptied` na já aberta que a linha esgotou), e o evento
  `picking.line_separated` leva `boxes`. "Desfazer", e a linha separada de
  novo com outra quantidade, devolvem antes às mesmas caixas. A reserva e o
  saldo da prateleira não mudam.
- **"Separar" não manda caixa.** A bancada mostra a sugestão lida ao vivo,
  mas quem baixa é o servidor, pela mesma regra: se outra pessoa tirou da
  mesma caixa no intervalo, a linha sai da caixa seguinte, e a linha separada
  mostra de onde saiu de fato. Só "Outra caixa" manda as caixas, e aí a
  recusa aparece para quem informou.
- **A caixa vazia (3c).** A caixa de que a separação tira tudo passa a
  `emptied`, com `emptied_at`, `emptied_by`, o pedido, a linha e
  `emptied_whole` (saiu inteira). O encaixe da prateleira, o Mapa, "Posições
  ocupadas" e a lista leem só a guardada: a vazia libera a frente e deixa de
  contar. "Desfazer" devolve a caixa à prateleira. Cada mudança grava
  `warehouse.box_emptied` ou `warehouse.box_reopened`, fora da caixa de
  avisos. A caixa empilhada sobre a que esvaziou fica como base, pela regra
  do encaixe para o apoio que falta.
- **As telas.** Na bancada, a linha por separar mostra "12 de CX-000027",
  "esvazia" e "CX-000029 inteira"; a separada mostra de onde saiu; "Outra
  caixa" fica no "⋯" da linha com mais de uma caixa na prateleira
  (`features/warehouse-ops/outra-caixa.tsx`,
  `lib/warehouse-ops/caixas-da-separacao.ts`). O Mapa diz "CX-000028 · aberta"
  ou "· guardada", mostra o saldo, "saldo em" e "Saíram desta prateleira" (as
  dez mais recentes), e "Posições ocupadas" passa a "Prateleiras com caixa
  com saldo." A lista de separação ("Ver itens" e a folha impressa) mostra só
  as caixas que ainda têm o item.
- **Etiquetas para trocar (3d).** A etiqueta da caixa aberta sai com o saldo,
  "7 un. · saldo em 12/11/2026", sem o peso de entrada. A bancada lista as
  caixas que o pedido abriu e que estão com a etiqueta velha, com "Imprimir".
  `recordBoxBalanceLabelPrint` registra o clique: a caixa guarda para qual
  saldo a etiqueta saiu (`balance_label_printed_for`), e volta à lista quando
  o saldo muda de novo. O evento é `warehouse.box_balance_label_printed`.
- **A data da etiqueta.** Toda etiqueta de caixa passa a levar a data de
  entrada (a da guarda), que é a do FIFO, como nas pranchas aprovadas
  ("Abertura · 22/10/2026"). Até aqui saía a data da impressão: era a mesma
  quando a etiqueta saía no dia da guarda, e errada na reimpressão.
  Confirmado pelo Leonardo (decisão 21).
- **O diálogo de concluir** diz as caixas de onde o pedido saiu: "Caixas
  inteiras", "Caixas abertas" e "Caixas vazias". "Volumes" entrou com a parte 4.
- **O que volta à prateleira volta sem caixa.** No pedido cancelado no meio
  da separação e na devolução, o que a guarda devolve à prateleira entra no
  saldo dela, sem caixa: a caixa de onde saiu continua com o saldo baixado (ou
  vazia). A linha seguinte daquele item sai das caixas e, depois, sem caixa.
  Confirmado pelo Leonardo (decisão 22).
- **A conferência não tem tela.** A conta da seção 4.3 vale como está: o
  saldo sem caixa da prateleira é o que sobra do razão depois do separado que
  espera a entrega e do saldo das caixas. Mostrar a divergência (as caixas
  dizendo mais do que o razão) pede uma tela, e tela pede mockup.
- **O que da prancha ficou para a parte 4** (e entrou com ela): "Levar a
  caixa", o volume em cada linha separada, o painel dos volumes, "Volumes" no
  diálogo de concluir e a tela do pedido separado (`WmsSepararConcluido`), com
  as etiquetas para trocar e as caixas vazias depois da conclusão.

Os testes: `saldo-da-caixa.test.ts` (os casos da regra, nos dois lados, e a
trava da cópia), `pick-progress.integration.test.ts` (a mais antiga e a
seguinte, o desfazer, o separar menos, a que esvazia, o que sai sem caixa,
"Outra caixa" com as recusas, a caixa vazia e a de volta à prateleira),
`box-relabel.integration.test.ts`, a linha nova na tabela de papéis,
`caixas-da-separacao.test.ts`, `outra-caixa.test.tsx`,
`pedidos-separar-view.test.tsx`, `concluir-separacao.test.tsx`,
`warehouse-labels.test.ts`, `label-sheet.test.tsx`, `warehouse-map.test.ts` e
`warehouse-map.test.tsx` (a lista dos textos e o `axe`).

**Parte 4, os volumes de expedição (10/11/2026).** Em commits próprios no PR
592, depois da parte 3: 4a (servidor), 4b (bancada), 4c (etiqueta e
romaneio) e 4d ("Para entregar" e o pedido separado).

- **Onde os volumes moram (4a).** Durante a separação, na tarefa:
  `pick_tasks.volumes` (cada um com `id`, `number`, `status` `open` ou
  `closed`, `units` e, no fechado, `weight_kg`, `box_code`, `closed_at` e
  `closed_by`) e `volume_seq`, o contador dos ids, que não volta. A linha
  guarda em quais volumes foi (`separated_volumes`). Na conclusão, cada
  volume vira um `packages` (`pkg_<embalagem>_001`, `_002`, …) com os
  `package_items` dele; a linha da remessa (`shipment_items`) continua uma por
  item do pedido e diz em quais volumes ele foi (`package_ids`). O lacre
  continua um por pedido. Nenhuma coleção nova: a zeragem não muda. A regra
  sem banco é `functions/wms/src/domain/order-volumes.ts`.
- **A linha entra no volume aberto.** `setPickLineSeparated` põe o separado
  no volume aberto da tarefa, na mesma transação da caixa; sem volume aberto,
  abre o seguinte. "Desfazer" tira a linha dos volumes. A linha separada a
  menos até zero não entra em volume.
- **"Fechar volume".** `closeOrderVolume` fecha o volume aberto com o peso,
  opcional (decisão 15; até duas casas, até 2.000 kg), e grava
  `picking.volume_closed`, fora da caixa de avisos. O volume vazio, o já
  fechado e o que não existe recusam. O seguinte não é criado na hora: abre
  na próxima linha separada, e a tela mostra o número dele, vazio.
- **"Levar a caixa" (decisão 11).** A linha por separar de que uma caixa sai
  inteira ganha "Levar a caixa". A bancada manda as caixas que mostrou
  (`boxes`) com `take_boxes`: a caixa que sai inteira vira um volume fechado,
  com a caixa (`box_code`) e o peso que ela tinha na entrada
  (`gross_weight_kg`), e o resto da linha entra no volume aberto. Se a caixa
  não sai mais inteira (outra pessoa tirou dela), recusa
  (`SEPARATION_BOX_NOT_WHOLE`) e nada fica gravado. A caixa guarda qual
  volume ela é (`emptied_volume_id` e `emptied_volume_number`, que acompanha
  o volume se ele mudar de número): o Mapa diz, em "Saíram desta prateleira",
  "inteira em 11/11/2026 · PED-0001, volume 11".
- **Os números vão de 1 a N, sem buraco.** O volume que esvazia (o desfazer
  da linha, ou da caixa levada) sai, e o de maior número ocupa o lugar dele:
  é o que troca menos etiqueta. Só o fechado tem etiqueta para trocar, e a
  resposta diz qual mudou (`renumbered_volumes`). O volume fechado de que sai
  só uma parte continua fechado, sem o peso que tinha, e a resposta diz qual
  (`changed_volumes`). A bancada avisa nos dois casos.
- **A conclusão.** `completeOrderSeparation` fecha junto o volume aberto que
  tem alguma coisa, sem peso, e grava um `packages` por volume. A conta parte
  dos itens do pedido: o que um item separou e nenhum volume diz que leva vai
  no volume aberto (ou num volume a mais), para os volumes fecharem sempre
  com o separado. O pedido sem volume nenhum (separado antes desta parte)
  fecha no volume único de sempre. A saída, a entrega e o cancelamento já
  liam todos os `packages` do pedido e seguem iguais.
- **A bancada (4b).** O painel "Volumes": o volume aberto com o que já tem,
  "Peso (kg)" e "Fechar volume"; os fechados, do mais recente ao mais antigo
  (os dois primeiros e "Ver os N volumes"), cada um com "Etiqueta". A linha
  separada diz em qual volume está. O diálogo de concluir diz "Volumes" antes
  das caixas. No celular, o volume aberto vem em cima da lista, numa linha,
  como na prancha (`lib/warehouse-ops/volumes-do-pedido.ts`).
- **A etiqueta do volume (4c).** No tamanho de hoje, com o pedido, o volume,
  o código de barras (`PED-0001-V12`), o cliente e o destino, a data em que o
  volume fechou, o peso, e os produtos com o código do cliente (sem ele, o
  SKU), a maior quantidade primeiro; com mais de cinco produtos, sai em
  etiquetas de continuação. Sai em Estoque › Etiquetas: `?pedido=` com
  `volumes=12` (ao fechar o volume, sem o total) ou `volumes=todos` (o lote,
  com "de 42", depois de concluir). Não registra a impressão.
- **O romaneio (4c).** `/pedidos/romaneio`, em A4: o cliente, o destino, o
  prazo, o lacre, os volumes, as unidades, de quando a quando o pedido
  separou (da primeira linha à conclusão) e quem concluiu; e o conteúdo de
  cada volume, na ordem das linhas do pedido, com o código, a quantidade e o
  peso. Só do pedido já separado. A etiqueta e o romaneio vão ao cliente: não
  citam caixa, posição nem valor.
- **De onde as telas leem os volumes.** `use-volumes-do-pedido.ts`, ao vivo:
  da tarefa e das linhas, enquanto o pedido separa (só os fechados); dos
  `packages` e `package_items`, depois de concluído. As duas consultas novas
  são por `order_id`, sem índice composto.
- **"Para entregar" (4d).** A linha diz "116 itens · 3.335 un. · 42 volumes ·
  lacre 88231", com "Ver volumes" no lugar de "Ver itens", "Etiquetas dos
  volumes" e "Romaneio" antes de "Entregue", e o aviso "5 etiquetas de caixa
  para trocar", com "Imprimir". O lacre e a contagem dos volumes passaram a
  chegar na fila.
- **O pedido separado (4d).** A bancada do pedido já concluído
  (`/pedidos/separar`) mostra os volumes com o conteúdo de cada um, "Etiquetas
  dos volumes", "Romaneio", as caixas que o pedido abriu e as que ele
  esvaziou (`pages/pedido-separado-view.tsx`). É onde "Confirmar separação"
  deixa a pessoa, e para onde "Ver volumes" leva.
- **O pedido de antes dos volumes** aparece com um volume só, com todos os
  itens: "Ver volumes", a etiqueta e o romaneio funcionam para ele.

Decidido no caminho, sem prancha que dissesse. Confirmados pelo Leonardo
em 10/11/2026 (seção 3, decisões 17 a 20 e 23 a 26):

1. No celular, "Fechar volume" fecha sem peso, como na prancha; o peso só no
   computador.
2. O volume fechado que esvazia some, e o de maior número ocupa o número
   dele; a bancada avisa "O volume 12 passou a ser o volume 5. Troque a
   etiqueta dele."
3. O volume fechado de que sai uma parte perde o peso; a bancada avisa "O
   volume 5 mudou. Imprima a etiqueta dele de novo." Não há como informar o
   peso de novo.
4. Depois de "Confirmar separação", a pessoa fica no pedido separado, e não
   volta a Pedidos.
5. Ao fechar o volume, a etiqueta não abre sozinha: fica em "Etiqueta", na
   linha do volume fechado.
6. Com mais de uma caixa saindo inteira na mesma linha, o botão diz "Levar as
   caixas".
7. Em "Para entregar", "Ver volumes" fica no lugar de "Ver itens"; no
   celular, "Etiquetas dos volumes" e "Romaneio" ficam atrás de "Ver volumes".
8. No romaneio, "Separado" vai da primeira linha separada à conclusão, e
   "Por" é quem concluiu.

**Dois acertos que a parte 4 trouxe junto**, em commits próprios:

- **A fila de Pedidos não recebia o pedido da tarefa.** A fila lê as tarefas
  de `queues`, e o mapeamento não copiava o `order_id` nem o
  `separation_started_at`, que ficavam só em `lanes`. Sem o `order_id`, a
  linha do pedido não sabia de qual pedido era: "Entrega" não aparecia e
  "Cancelar pedido" não abria. Sem o começo da separação, o selo saía "em
  separação", sem "desde 12/11". Os testes das telas montavam a tarefa já
  com os dois campos; o teste novo passa pela leitura de verdade
  (`cloud-api-warehouse.test.ts`).
- **A conclusão repetida não devolvia a remessa.** A embalagem nunca guardou
  o `shipment_id`; com a embalagem já fechada, a resposta lê a remessa do
  pedido.

Os testes: `order-volumes.test.ts` (a regra dos volumes),
`pick-progress.integration.test.ts` (o volume aberto, "Fechar volume",
"Levar a caixa" e a recusa, o desfazer com o número e o peso, a conclusão
com um `packages` por volume, a linha zerada, o pedido de antes dos volumes,
o item sem linha e o cancelamento), a linha nova na tabela de papéis,
`volumes-do-pedido.test.ts`, `use-volumes-do-pedido.test.ts`,
`romaneio.test.ts`, `pedidos-separar-view.test.tsx`,
`pedido-separado-view.test.tsx`, `pedidos-romaneio-view.test.tsx`,
`pedidos.lista.test.tsx`, `concluir-separacao.test.tsx`,
`warehouse-labels.test.ts`, `label-sheet.test.tsx` (a lista dos textos e o
`axe`) e `cloud-api-warehouse.test.ts`.

### 5.2 Na produção

**10/11/2026, 19:35 a 19:52 UTC.** O Leonardo publicou o commit `7512f101`
(o merge do PR 592) pelo disparo manual do CI (run 42886730481), depois da
homologação do mesmo commit, verde às 19:30 UTC (run 42882681524). As seis
partes chegaram juntas ao `dute-prod`: a 1 pelo PR 590, a 6 pelo PR 591 e as
2 a 5 pelo PR 592; a publicação anterior da produção era a do PR 587, de
07/11/2026. Todas as conferências da publicação passaram:

- o commit ainda era o HEAD da `main`;
- as regras e os índices publicados, com as regras servidas conferidas;
- as functions de todas as codebases publicadas, cada callable pública (a
  `closeOrderVolume` nova entre elas) e a API REST com o contrato e a
  autenticação certos;
- o Cloud Run e o `app.dutelog.com.br` servindo o build, e a tela de login
  abrindo no Chromium, no computador e no celular, sem erro.

Depois dela, os PRs 593 e 594 mudaram só este documento. Antes do PED-0001,
falta imprimir na Zebra a etiqueta da caixa aberta (parte 3d) e a do volume
(parte 4c).

**Defeito achado em 11/11/2026, na produção desde esta publicação.** O SDK
do Firebase manda o campo `undefined` como `null`, e as callables da
separação recusam `null` nos campos opcionais. Por isso "Fechar volume" sem
peso (sempre, no celular) e "Separar menos" sem detalhe voltavam "Entrada
inválida para a separação.". Os testes de integração chamam o domínio
direto, sem o SDK, e não pegavam. A correção é a bancada não mandar o campo
sem valor (`semCamposVazios`, em `artifacts/app/src/lib/wms/separacao.ts`,
com o teste que falhava antes). Até ela chegar à produção: fechar os
volumes no computador, com o peso, e escrever o detalhe no "Separar menos".
O mesmo defeito estava no "Confirmar destino" do Receber por caixa; a
correção é de 12/11/2026 (`recebimento-com-caixas.md`, parte 5c, com o que
fazer até ela chegar à produção).

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

**Em 10/11/2026, quando as partes 2 a 5 entraram na `main`, nenhum dos dois
tinha começado a ser separado** (Leonardo). Os dois começam pela bancada,
com as caixas e os volumes desde a primeira linha, e não há acerto de caixa
a fazer: o conteúdo das caixas é o de entrada, exato, porque nenhum pedido
saiu desde a zeragem. A bancada chegou à produção no mesmo dia (seção 5.2).
Os parágrafos abaixo ficam como o plano para o caso de eles terem começado
antes dela.

Os dois são separados com o sistema de hoje e a lista da parte 1. Enquanto a
parte 3 não entra, a caixa aberta leva a sobra e a data escritas à mão, e a
lista impressa guarda de qual caixa saiu cada linha e quais esvaziaram.

Se a parte 2 chegar à produção com um deles ainda por concluir, a bancada
abre com todas as linhas por separar: o que já foi separado pela lista
impressa não está no sistema. Quem está com a lista marca as linhas já
separadas, um toque por linha, e segue dali.

A caixa da lista é a do conteúdo de entrada (decisão 10). Nesses dois pedidos
ela é exata, porque nenhum pedido saiu desde a zeragem. Do terceiro pedido em
diante, e até a parte 3, a lista pode citar uma caixa que os pedidos
anteriores já esvaziaram: vale a anotação à mão na caixa.

O pedido concluído antes de a parte 3 chegar não baixou caixa nenhuma: as
caixas de onde ele saiu continuam com o saldo de entrada no sistema, e a
sugestão dos pedidos seguintes pode apontar para elas. O acerto é pela
própria bancada: no pedido seguinte, "Outra caixa" diz de onde o item saiu de
fato. O total da prateleira não depende disso.

Quando a parte 3a entrar, o saldo das caixas desses pedidos é acertado uma
vez: pela regra da caixa mais antiga, conferida com a lista anotada, em
simulação antes de gravar.

Com a parte 4, o pedido concluído pelo fluxo antigo aparece com um volume só
(o `_001`, com todos os itens): "Ver volumes", a etiqueta e o romaneio
funcionam para ele, com esse volume único. O pedido que estiver em separação
quando a parte 4 chegar monta os volumes a partir da primeira linha separada
na bancada.

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
- **O saldo da caixa não acompanha tudo.** A contagem cíclica, a devolução e
  a guarda por linha mexem no saldo da prateleira e não sabem de caixa. O que
  volta à prateleira volta sem caixa (seção 5.1). A divergência entre as
  caixas e o razão ainda não aparece em tela nenhuma.
- **A leitura das caixas tem teto.** As telas leem até 5.000 caixas do
  cliente, da mais nova para a mais velha, e a caixa vazia continua no banco.
  Longe do teto hoje (cerca de 200 caixas); quando chegar perto, a leitura
  passa a pedir só as guardadas.
- **Impressão.** Uma etiqueta por caixa aberta em cada pedido é volume de
  papel em pedido grande.
- **Um volume aberto por pedido.** Duas pessoas separando o mesmo pedido ao
  mesmo tempo põem as linhas no mesmo volume aberto, embora possam estar
  enchendo caixas diferentes. Quem fecha o volume fecha o que as duas
  puseram.
- **O volume fechado não reabre.** "Fechar volume" por engano não se desfaz:
  a linha seguinte abre o volume seguinte. O conteúdo de um volume fechado só
  muda desfazendo a linha, e aí a etiqueta dele precisa sair de novo.
- **A etiqueta do volume não registra a impressão.** Nada diz se a etiqueta
  de um volume já saiu, nem se saiu antes de ele mudar: o lote com o total,
  depois de concluir, é o que vale.
- **"Posições ocupadas" cai** quando as caixas esvaziam: muda a referência da
  fatura manual (decisão 6).
- **Sem leitura de código de barras.** A confirmação é por toque. A leitura
  fica para depois, como no recebimento.
- **Pedido cancelado no meio da separação.** Tratado com a parte 2 (seção
  5.1): o que as linhas já separaram vai para a `EXPEDICAO` e volta pela
  guarda, como o separado do pedido concluído. A tabela "Voltam à posição" do
  diálogo lê a fila, que pode estar alguns segundos atrás do que outra pessoa
  acabou de separar; o servidor decide pelo que está gravado na linha.

## 10. Como desfazer

A parte 1 sai revertendo o PR, sem dado para limpar. As partes 2 a 5 gravam
dado novo (progresso da linha, saldo da caixa, volumes): cada uma leva no PR
dela o que fazer com esse dado ao reverter.

A parte 4 sai revertendo os commits dela. Os volumes gravados na tarefa
(`volumes`, `volume_seq`) e nas linhas (`separated_volumes`) ficam nos
documentos, sem efeito: o pedido em separação conclui no volume único de
antes. O pedido já concluído com vários `packages` continua certo para a
saída, a entrega e o cancelamento, que sempre leram todos os volumes do
pedido; só deixa de haver tela para vê-los.

A parte 3 sai revertendo os commits dela. O retirado gravado nas caixas
(`taken_lines`, `taken_units`, `balance_at`) e nas linhas (`separated_boxes`)
fica nos documentos, sem efeito. A caixa `emptied` é o único dado que pede
cuidado: a tela antiga não a mostra em lugar nenhum (para ela, caixa é a
guardada), o que é o certo para a caixa que saiu de fato; se alguma tiver de
voltar à prateleira, é um acerto à mão no documento dela.

As partes 2 e 5 saem revertendo o PR delas. O progresso gravado nas linhas
(`separated_*`) e na tarefa (`separation_started_at`) fica nos documentos, sem
efeito: a tela antiga não o lê. O pedido que estiver em separação continua
pelo "Separado" antigo, que confirma todas as linhas na quantidade pedida: a
diferença já registrada numa linha precisa ser informada de novo pela
coordenação.

## 11. A linha em mais de um volume (11/11/2026)

**Situação:** as perguntas foram respondidas pelo Leonardo em 11/11/2026
(decisões 27 a 30, seção 11.6), e as pranchas, atualizadas com as respostas,
foram aprovadas por ele no mesmo dia; as partes 7a e 7b vêm a seguir. As
pranchas estão na página 4 do
canvas (https://claude.ai/artifact/EUrq7Fwu9Xt4BpGRiz1mJz), com as fontes em
`docs/mockups/WmsDividir*.dc.html` (tabela no README dos mockups).

### 11.1 O caso

Em 11/11/2026, na separação do PED-0001, a linha "Polo Masculino Piquet
Preto · M" tinha 95 un., e o sistema sugeria 54 da CX-000218 e 41 da
CX-000219. Não havia caixa de expedição para as 95: elas precisavam ir em
dois volumes, e a bancada não deixa.

### 11.2 Por que não dá hoje

- "Separar" põe todo o separado da linha no único volume aberto
  (`pick-progress.ts`, `porNoVolumeAberto` em `order-volumes.ts`). Só
  "Levar a caixa" põe a linha em mais de um volume, e só quando uma caixa
  sai inteira nela.
- Separar a linha de novo substitui, não soma: ela sai dos volumes em que
  estava e a quantidade nova entra inteira no volume aberto.
- "Separar menos" pede o motivo (falta ou avaria) e vira diferença no
  pedido.
- "Levar a caixa" não aparecia porque a caixa inteira é decidida linha a
  linha (`saldo-da-caixa.ts`, `daLinha`): a CX-000218 também tem a GG, e 54
  nunca é o total dela.

O resto já aceita um produto em vários volumes: a linha guarda uma lista
(`separated_volumes`), a conclusão grava um `packages` por volume com o item
repartido, a embalagem confere a soma do item em todos eles
(`operations.ts`), e a etiqueta e o romaneio são por volume. O teste da
conclusão com volumes já tem uma linha em dois
(`pick-progress.integration.test.ts`, com "Levar a caixa").

### 11.3 O desenho

- "Dividir em volumes" fica em dois lugares. Na linha por separar com 2 un.
  ou mais, é o primeiro item do "⋯", antes de "Outra caixa" e "Separar
  menos": o diálogo separa a linha, das caixas que o sistema sugere, como
  "Separar", e a divide. Na linha já separada, enquanto o que ela pôs está
  no volume aberto, é um botão ao lado de "Desfazer" (decisão 30): o
  diálogo só divide, sem tocar as caixas nem a diferença. Isso cobre quem
  tocou "Separar" por hábito, a linha corrigida pelo "Outra caixa", a
  separada a menos e o resto de "Levar a caixa".
- A primeira linha do diálogo é o volume aberto ("tem 35 un." quando já tem
  itens de outras linhas). Cada volume, menos o último, fecha ao confirmar,
  com o peso opcional no computador; no celular, sem peso (decisões 15, 17 e
  29).
- O último volume já vem com o resto e fica aberto: as próximas linhas
  entram nele. Todas as linhas se editam, com − e + ou digitando, a última
  também: mexeu numa linha, a última acompanha; mexeu na última, a de cima
  acompanha. A soma sempre fecha (decisão 28).
- Toda linha do diálogo tem ao menos 1 un. Para fechar o volume aberto como
  está, "Fechar volume" vem antes.
- O diálogo começa com um volume por caixa de onde a linha sai (54 e 41), a
  partir do volume aberto, mesmo quando ele já tem itens (decisão 27); a
  linha de uma caixa só começa ao meio. "Mais um volume" põe um volume antes
  do último, com a quantidade do de cima ou, se não couber, metade do resto;
  o volume acrescentado sai pela lixeira ("Tirar o volume 17").
- O botão diz em quantos volumes: "Separar em 2 volumes" na linha por
  separar e "Dividir em 2 volumes" na já separada. Depois vem o aviso
  "Volume 16 fechado", e o volume fechado aparece no painel com "Etiqueta"
  (decisão 23).
- A linha separada com mais de duas etiquetas (caixas e volumes) as mostra
  embaixo dos códigos; com até duas, elas ficam à direita, como hoje. Vale
  também para "Levar a caixa" com resto, que hoje já tem três.
- "Desfazer" tira a linha de todos os volumes, com os avisos de hoje
  (decisões 18 e 19). O volume fechado que esvazia e sai passa a avisar
  também: "O volume 16 saiu. Tire a etiqueta dele." Hoje, quando ele é o de
  maior número, sai sem aviso.

### 11.4 O servidor

`setPickLineSeparated` ganha `split_volumes` (de 2 a 20 linhas
`{ number, qty, weight_kg? }`, todas, o resto inclusive, sem peso na
última), `open_volume_id` (o volume aberto que o diálogo mostrou, ou `null`
quando não há), `open_volume_units` (as unidades gravadas nele) e
`line_separated_at` (a linha como o diálogo a viu: o `separated_at` dela,
ou `null` na linha por separar). Vale só com `separated: true` e sem
`take_boxes`, `boxes` ou `separated_qty`. Na transação de sempre:

1. Na linha por separar, a chamada separa e divide. Na linha já separada
   (decisão 30), ela só divide o que a linha pôs no volume aberto: as caixas
   e a diferença ficam como estão, e a linha que não tem nada no volume
   aberto recusa (`SEPARATION_LINE_NOT_IN_OPEN_VOLUME`). A repetição, com as
   mesmas quantidades, responde `changed: false`.
2. As linhas do diálogo somam o que se divide: na linha por separar, a
   quantidade dela; na já separada, o que ela tem no volume aberto.
3. A linha, o volume aberto (o id e as unidades) e os números que o
   servidor daria são os que o diálogo mostrou, conferidos antes da soma.
   Senão, recusa (`SEPARATION_VOLUMES_CHANGED`, "Os volumes mudaram.
   Confira e tente de novo.") sem gravar nada: outra pessoa pode estar
   separando no mesmo volume aberto (seção 9), ou ter separado ou desfeito
   a linha. A repetição só vale quando os volumes da linha vieram da mesma
   divisão: fechados, sem caixa levada inteira e com o mesmo peso.
4. Cada linha, menos a última: `porNoVolumeAberto` e `fecharVolume`, com o
   peso arredondado como no `closeOrderVolume`. A última:
   `porNoVolumeAberto`, que abre o volume novo.

Os eventos: o `picking.line_separated` de sempre, com os volumes, e um
`picking.volume_closed` por volume fechado. A resposta traz
`closed_volumes` para o aviso, e a do desfazer passa a dizer os volumes
fechados que saíram. É a mesma callable: nenhuma callable nova e nenhuma
linha nova na tabela de papéis. A conta de que a soma fecha (decisão 28) é
da tela; o servidor confere a soma de novo e recusa a que não fecha.

### 11.5 Partes

| # | Parte | O que entra | Teste que falha antes |
|---|---|---|---|
| 7a | Dividir no servidor | `split_volumes` na linha por separar e na já separada, a recusa do volume que mudou, os eventos e o aviso do volume fechado que sai no desfazer. | A linha de 95 un. só entra num volume. |
| 7b | Dividir na bancada | O item do "⋯" e o botão na linha já separada, o diálogo no computador e no celular, o aviso e as etiquetas da linha embaixo dos códigos, com a lista dos textos e o `axe`. | A bancada não tem como dividir a linha. |

A régua `billing-callables` fica verde. Homologação no merge; produção pela
publicação manual, com o OK do Leonardo.

**Parte 7a no código (11/11/2026).** A regra sem banco em `order-volumes.ts`
(`dividirNoVolumeAberto`, e `tirarDosVolumes` dizendo os fechados que saem)
e a entrada em `pick-progress.ts` (`entradaDaSeparacao`, a divisão na linha
por separar e na já separada, o `picking.line_divided` e um
`picking.volume_closed` por volume fechado, com o mesmo evento do "Fechar
volume"). Os testes: `order-volumes.test.ts`, `pick-progress.test.ts` (as
recusas da entrada) e `pick-progress.integration.test.ts`, no emulador: as
duas entradas, o volume aberto com itens, as recusas da tela desatualizada
(o volume que mudou, a linha separada ou desfeita por outra pessoa, a soma),
a repetição, o "Levar a caixa" antes, o desfazer com os volumes que saem e a
conclusão com o item em dois `packages`. A régua `billing-callables` e as
tabelas de papéis e de login seguem verdes.

**Parte 7b no código (11/11/2026).** A conta do diálogo em
`artifacts/app/src/lib/warehouse-ops/divisao-em-volumes.ts` (a divisão por
caixa, os números, a soma que sempre fecha, "Mais um volume", a lixeira, o
pedido para o servidor e o aviso "Volume 16 fechado"); o diálogo em
`features/warehouse-ops/dividir-em-volumes.tsx`, no computador e no celular
(sem peso, botões de 44 px, foco por dentro do −, do número e do +, o peso
inválido em vermelho); na bancada (`pages/pedidos-separar-view.tsx` e
`pedidos-separar.tsx`), o item do "⋯", o botão na linha já separada, as
etiquetas embaixo dos códigos e o volume aberto e os números relidos ao
vivo, para a recusa "Os volumes mudaram" mostrar o estado novo; e o aviso do
volume fechado que saiu em `avisoDosVolumes`. A prancha da bancada depois de
dividir foi feita antes da decisão 30: na tela, a linha dividida que ainda
tem 2 un. ou mais no volume aberto ganha também "Dividir em volumes". Os
testes: `divisao-em-volumes.test.ts`, `dividir-em-volumes.test.tsx` e
`dividir-em-volumes.interacao.test.tsx` (a lista dos textos, o `axe` e o
foco depois de tirar um volume), `volumes-do-pedido.test.ts` e
`pedidos-separar-view.test.tsx`.

### 11.6 Perguntas e respostas

Respondidas pelo Leonardo em 11/11/2026.

| # | Pergunta | Resposta |
|---|---|---|
| 1 | O diálogo começa com um volume por caixa de onde a linha sai (54 e 41; com três caixas, três volumes), a partir do volume aberto, mesmo quando ele já tem itens (35 + 54 = 89)? | Sim (decisão 27). |
| 2 | O último volume fica aberto e leva o resto, sem digitar? Ou digitar todos e conferir a soma, como no "Outra caixa"? Ou o último também fecha? | Automático, podendo editar qualquer coisa (decisão 28). Nas pranchas: o último já vem com o resto e fica aberto, e todas as linhas se editam; mexeu numa, a última acompanha; mexeu na última, a de cima acompanha. |
| 3 | No computador, o peso de cada volume que fecha vai no próprio diálogo, opcional; no celular, sem peso, como no "Fechar volume"? | Ok (decisão 29). |
| 4 | "Dividir em volumes" também na linha já separada, enquanto ela está no volume aberto? | Sim (decisão 30). |

### 11.7 Enquanto não entra

A linha que não cabe num volume fica por último: a bancada não exige ordem.
As peças vão nas caixas de expedição que couberem, anotadas à mão, e a linha
se marca quando a divisão chegar à produção. Se o pedido precisar sair
antes, a linha vai sozinha num volume (fechar o aberto antes, separar e
fechar), e a etiqueta desse volume sai duas vezes, com as quantidades à mão.
O romaneio dirá um volume a menos do que as caixas, e a BTG precisa saber.
