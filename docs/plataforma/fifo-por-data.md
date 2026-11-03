# FIFO por data: a separação tira primeiro o mais antigo (P8, versão enxuta)

**Situação:** desenho aprovado em 02/11/2026, em partes. O Leonardo decidiu em
02/11/2026: FIFO pela data de guarda; o cliente vê, no detalhe do produto,
quanto tem de cada data, nunca caixa nem prateleira (a caixa é detalhe
interno); as caixas da contagem de abertura valem a mesma data, com
desempate. No mesmo dia, com uma pessoa separando, ele trocou o pacote de 41
partes (conteúdo por caixa, modo sombra, modo caixa por cliente, montar
caixa, leitor Bluetooth, três listas de liberação) por esta versão: o
sistema sabe quanto há em cada prateleira e de que data, e o conteúdo de
cada caixa fica na caixa. As partes 1, 2 e 3 entraram em 02/11/2026 (PRs
538, 536 e 537), e a parte 4 em 03/11/2026 (PR 539). As telas das partes 5 e
6 estão em desenho, para aprovação antes do código.

Relação com o recebimento com caixas (`recebimento-com-caixas.md`): aquele
desenho deixa de fora de qual caixa a separação tira e a baixa do conteúdo
(regra 8 do mapa, seção 4.7 de lá). Este responde por prateleira e data. A
caixa continua com o conteúdo de entrada, e o saldo por prateleira continua
sendo o ledger.

## 1. O que o Leonardo pediu

1. **FIFO:** sai primeiro o que entrou primeiro, pela data de guarda.
2. **Datas para o cliente:** no detalhe do produto, quanto tem de cada data
   ("300 polos: 100 há 3 meses, 200 há 1 mês"), para ver o que não gira.
3. **Sobras:** o pedido tira parte de uma caixa, e o resto fica controlado.

E a restrição: a operação é pequena, uma pessoa separa, e o sistema precisa
continuar simples de usar.

## 2. O que o sistema faz hoje

- O alocador do pedido tem duas cópias em
  `functions/wms/src/domain/operations.ts`: a criação pelo portal
  (`createCustomerRequestTransaction`) e a decisão da solicitação que chegou
  sem reserva (`decideCustomerRequestTransaction`). Ele ordena os saldos do
  SKU por `location_id`, em ordem alfabética, e enche uma prateleira por vez.
  Desde a parte 7 do recebimento com caixas, deixa de fora o `RECEBIMENTO` e
  a `EXPEDICAO` (`domain/areas-de-passagem.ts`).
- Toda mudança de `qty_on_hand` nas Functions grava um movimento em
  `movements` na mesma transação (`createMovement`), com cliente, SKU, local,
  quantidade, `tipo_mov`, `source` e `created_at` do servidor. Só as
  ferramentas legadas da planilha (`tools/import_btg_firestore.py` e
  `tools/reconcile_btg_operational_data.py`) gravam saldo por fora.
- A saída nunca toca a caixa: o conteúdo dela é o que entrou.
- O cliente lê só `client_inventory`, sem data, caixa nem posição. A idade de
  hoje é por item (`ai_stock_age`, com "Parado 90+" e "Sem giro") e fica
  fechada ao cliente.

## 3. Desenho

### 3.1 A conta das datas

Uma função pura no WMS (`functions/wms/src/domain/datas-do-saldo.ts`, com os
casos em `datas-do-saldo.casos.json` e o teste na lista do `test:unit`). Ela
só lê e nunca dá erro.

- Pelo FIFO, o que sobra numa prateleira são as entradas mais recentes nela. A
  conta pega o saldo da prateleira (`qty_on_hand`) e as `ENTRADA` dela, da mais
  nova para a mais antiga, e atribui quantidade a cada data até cobrir o saldo.
- Conta toda `ENTRADA` da posição, de qualquer origem: Receber, guarda,
  abertura, devolução, ajuste e contagem para mais. Não usa a lista de origens
  de `lib/dominio/src/parados.ts`, que segue como está.
- A data é o dia, no horário de São Paulo, do `created_at` do movimento (hora
  do servidor). O campo `data`, que a movimentação manual e a API deixam
  digitar, não conta.
- O estoque da contagem de abertura vale um dia só por cliente: o
  `started_at` da sessão `opening_<cliente>` (pergunta 1).
- O que as entradas não cobrirem fica "sem data", e o total sempre fecha com
  o saldo.
- O local é o `location_id` como o alocador o compara, só sem o espaço das
  pontas: `A-01` e `a-01` (o destino digitado na movimentação manual) são
  saldos e datas separados.

Exemplo: a prateleira tem 300 polos. Entraram 150 em 05/08 e 200 em 03/10.
Sobram as 200 de 03/10 e 100 das 150 de 05/08.

### 3.2 A ordem do pedido

- O alocador continua enchendo uma prateleira por vez e só passa à seguinte
  quando ela não basta (pergunta 2). Muda a ordem das prateleiras: primeiro a
  de data livre mais antiga, com a reserva descontada das datas mais
  antigas, e no empate o `location_id`, como hoje.
- `RECEBIMENTO` e `EXPEDICAO` continuam fora (decisão 10 do recebimento com
  caixas).
- O ledger só é lido quando o SKU tem saldo livre em duas ou mais
  prateleiras. Sem datas, a ordem é a de hoje.
- A lista dos saldos do SKU continua ordenada por `location_id`, porque a
  primeira linha dá o código do cliente, a categoria e o nome. Só os
  candidatos mudam de ordem.
- Reserva, linha de separação, separar a menos, cancelamento, entrega e
  cobrança ficam iguais: uma reserva e uma linha por item e prateleira. A
  cobrança por movimentação segue a regra de hoje.

### 3.3 O que o cliente vê

- Uma callable só de leitura no WMS, por SKU (e por `client_item_code` na
  variante), com `getProfile` antes da entrada e `requireCustomerScope`. Ao
  cliente, devolve só `[{desde, pecas}]` das prateleiras, sem local nem
  caixa. À equipe, devolve também por prateleira.
- No portal, o detalhe do produto ganha uma linha por data ("100 peças ·
  desde 05/08/2026"). O que está no `RECEBIMENTO` segue como "Em
  recebimento", sem data.
- Nenhuma data é gravada em `client_inventory`.

### 3.4 A ficha interna

Em Estoque › Itens, "Onde está" mostra as datas e as quantidades de cada
prateleira, pela mesma callable. A quantidade da data mais antiga é a sobra
da caixa aberta.

### 3.5 Hábitos na prateleira

A conta supõe que a pessoa pega a caixa mais antiga. Os hábitos estão no
`docs/manual-armazenagem.md`, em "Caixa na prateleira":

- Ao guardar peça sem etiqueta de caixa, escrever a data do dia na frente da
  caixa (DD/MM/AA). Com o recebimento com caixas ligado, a etiqueta já traz a
  data.
- Caixa nova atrás ou embaixo; a mais antiga na frente ou em cima.
- Separar sempre da caixa mais antiga da prateleira indicada, e deixar a sobra
  nela, na frente.
- Uma caixa aberta por item em cada prateleira. Caixa vazia sai na hora.
- Caixa da abertura não precisa de data escrita. Se sair inteira para o
  cliente, tirar a etiqueta `CX`.
- Não mudar caixa de prateleira. Se precisar, tratar como guarda nova, com a
  data do dia.

## 4. Partes, em ordem

Um problema por PR, com o teste que falha antes. Tela só depois do desenho
aprovado.

| # | Parte | O que entra | Teste que falha antes |
|---|---|---|---|
| 1 | Registro | Este roteiro, a P8 no desenho do mapa, os hábitos no manual e a linha no `CLAUDE.md`. | Só documentos. |
| 2 | Aviso sem caixa (A1, PR 536) | O evento da abertura e qualquer evento que cite `CX-` viram rascunho interno; o aviso ao cliente com `CX-` não se aprova nem se envia. | `rascunhos-de-aviso.integration.test.ts`. |
| 3 | Aviso sem prateleira (A5, PR 537) | A descrição da contagem cíclica não diz o local; ele fica no payload. | `operations.integration.test.ts`. |
| 4 | Pedido pela data mais antiga (PR 539) | A conta das datas (3.1) e a ordem nova nas duas cópias do alocador (3.2). | B-01 com peças de 05/08 e A-01 com peças de 03/10: hoje o pedido reserva A-01. |
| 5 | Datas no portal | A callable de leitura e as datas no detalhe do produto (3.3), com os testes de textos e `axe`, e a linha nova nas travas de callables. | O cliente recebe as datas do próprio item, sem prateleira, e não lê as de outro cliente. |
| 6 | Datas na ficha interna | As datas por prateleira em "Onde está" (3.4), na v3. | A ficha mostra só a quantidade por prateleira. |

A A2 e a A3 da lista anterior entraram em 02/11/2026 (PRs 533 e 532). Fica em
fila própria, sem mudar o uso, a A4: arquivar item na ficha interna exige
saldo e reserva zero, como no portal. Fica para depois, só se a pessoa errar
a caixa na prática, a data na linha de Para separar.

Cada parte entra na homologação no merge e na produção só pela publicação
manual, com o OK do Leonardo. Não há lista de liberação: o pedido muda de
prateleira para todo cliente quando a parte 4 é publicada.

## 5. Perguntas

As três perguntas abaixo receberam o Ok do Leonardo às recomendações em
02/11/2026, no chat. As outras nove do pacote de 41 partes deixam de existir.

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Que dia vale para o estoque da contagem de abertura? | Um dia por cliente, o dia em que a contagem começou (`started_at`). Entre prateleiras, desempata a ordem delas. |
| 2 | Para seguir a data à risca, o pedido pode se dividir entre prateleiras? | Não: vai à prateleira de data livre mais antiga e completa nela. Numa simulação, dividir à risca levou os pedidos divididos de 11% para 17%. |
| 3 | "Posições ocupadas" do Mapa conta caixa guardada, e a caixa que esvazia continua contando. | Um PR à parte, fora deste pacote, para contar a prateleira com saldo. Até lá, conferir na prateleira antes de faturar por posição. |

Decididos pelo Leonardo em 03/11/2026, antes de a parte 4 ir à produção:

| # | Pergunta | Decisão |
|---|---|---|
| 4 | Devolução e locais digitados (`DEVOLUCAO`, `ESTOQUE_BTG`, `CLIENTE`, `LOC-*`) contam como prateleira (decisão 10 do recebimento com caixas). Com a peça mais antiga, passam à frente das ruas A, B e C? | Sim: seguem a ordem por data, sem chave a mais. É raro, porque a peça devolvida entra com a data da devolução; quando acontece, sai primeiro a que está parada há mais tempo. A peça devolvida e boa volta à prateleira por movimentação e entra na ordem normal. |
| 5 | O SKU legado `BTG-1043`, que separava duas variantes do cliente (`A.01.0533.004.G` e `.M`) por `client_item_code`, ainda existe? | Não: o Leonardo não achou nenhum item com esses códigos na produção, e todo produto novo nasce com o código gerado (`<SIGLA>-000001`). O caso especial sai do código, em PR próprio. |

Regras assumidas: o pedido só reserva da prateleira (decisão 10 do
recebimento com caixas); a peça de pedido cancelado depois de separado volta
com a data do dia, porque volta por uma guarda nova; Para separar não muda;
a linha Movimentação da fatura fica como está; o alerta "Parado 90+" continua
por item; o Agent Dute do cliente e a API não mostram as datas neste pacote.

## 6. O que se perde e os riscos

| Perda | Quando dói | O que fazer |
|---|---|---|
| Conteúdo de cada caixa | Duas caixas abertas do mesmo item na prateleira, ou o cliente pergunta quanto há numa caixa. | Uma caixa aberta por item; a data mais antiga, na ficha, é a sobra dela. |
| Conferência da caixa na separação | Num dia corrido, ou com alguém cobrindo a pessoa, sai a caixa nova: o portal mostra peças mais novas do que são, e a contagem não corrige a data. | A mais antiga sempre na frente; os hábitos por escrito para quem cobrir. |
| Correção de data | Um erro de hábito fica no sistema até a prateleira girar. | A data escrita na caixa é a prova; não mudar caixa de prateleira. |
| Caixa vazia no Mapa | A caixa que esvazia continua contando como posição ocupada. | Pergunta 3. |
| Data antiga na volta do cancelado | As peças voltam como novas. | Tratar como caixa nova, com a data do dia, atrás. É raro. |

Riscos:

- O histórico começa na contagem de abertura, depois da zeragem de
  16/10/2026. Enquanto todo o estoque vier da abertura, tudo tem a mesma data;
  a diferença aparece com as primeiras chegadas.
- As ferramentas legadas da planilha, se rodarem no `dute-prod`, deixam saldo
  "sem data".
- Passam a existir duas idades para o cliente: "desde DD/MM" no portal e "sem
  movimento há N dias" no aviso "Itens parados". O texto da parte 5 separa as
  duas.
- O volume do ledger é pequeno (620 movimentos para 373 SKUs de 30/07 a
  16/10/2026). A leitura sob demanda cabe. Se crescer, a consulta lê só até
  cobrir o saldo, com o índice do cliente, do SKU e da data.

## 7. O que não muda

O ledger por cliente, SKU e posição; os movimentos e a fatura; o conteúdo de
entrada da caixa; o recebimento com caixas; `client_inventory`; a zeragem
(nenhuma coleção nova); as invariantes (escrita crítica por Function, evento
em `events`, IA só recomenda, `customer_code` como fronteira, permissão em
Rules e backend).

## 8. Como desfazer

Cada parte sai revertendo o PR dela. Sem a parte 4, o pedido volta à ordem
alfabética; sem as partes 5 e 6, as telas perdem as datas. Não há dado para
limpar, porque nada novo é gravado.
