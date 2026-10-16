# Mapa do armazém e endereçamento dirigido — desenho para decisão

**Situação:** desenho aprovado em 16/10/2026 (mockups das cinco telas da fase 0
avaliados por Leonardo). A fase 0 começou a ser construída: o cadastro de
posições é o primeiro PR. O documento fecha as definições que precisam estar
prontas **antes da contagem de abertura** do novo go-live, porque a contagem
vai gravar posições e caixas no formato definido aqui. Decisão registrada: a
contagem não começa antes disso.

Documentos relacionados: `novo-go-live-zeragem-total.md` (zeragem de
16/10/2026), `manual-producao.md` e `roadmap-producao.md` (invariantes).

## 1. Por que

Hoje o endereço do estoque é texto livre. O operador digita o endereço na
contagem, no recebimento e na guarda, e o backend só remove espaços. Não há
cadastro de posições em uso: a coleção `locations` tem documentos do importador
de julho (rua, prateleira, caixa, sem medidas) que ninguém lê. Produto, SKU,
linha de recebimento e tarefa não têm comprimento, largura, altura, peso ou
volume. O mapa atual (`/catalogo/mapa`) agrupa por campos herdados da planilha
que os cadastros novos não preenchem, e depois da zeragem fica vazio. A tarefa
de guarda nasce com origem `RECEBIMENTO` e destino vazio, para o operador
decidir. A armazenagem é cobrada pela linha "pallet" da lista de preços, cuja
quantidade é digitada à mão no snapshot mensal (`billing_operational_snapshots`).

O objetivo é inverter isso: **o sistema decide onde cada caixa fica**, por
regras determinísticas e auditáveis; o operador executa e confirma. É o
"putaway dirigido" (directed putaway) dos WMS de mercado (SAP EWM, Manhattan,
Blue Yonder, Oracle WMS funcionam assim).

A decisão é de **regra, não de IA**. Regra é previsível, testável (teste que
falha antes e passa depois) e explicável na auditoria; dois recebimentos
iguais dão a mesma resposta. A IA (Agent Dute) entra nas bordas e continua
sem executar: ler medida e quantidade do rótulo ou da nota, explicar a escolha,
propor reorganização para aprovação humana (invariante 3).

## 2. Decisões tomadas em 16/10/2026

1. **A prateleira tem comprimento livre**, ocupado caixa a caixa. Não há vagas
   de tamanho fixo.
2. **Medidas e peso são informados por caixa**, no recebimento e na contagem
   de abertura, e o sistema direciona onde guardar.
3. **Três tamanhos padrão de caixa** (pequena, média, grande) com medidas fixas
   a cadastrar, mais **caixas de fornecedor** com medidas variáveis, medidas na
   hora e apenas armazenadas.
4. **Toda caixa sai com etiqueta impressa**: na guarda (caixa de estoque) e na
   expedição (caixa que sai), com produtos, quantidades e peso. Impressora
   comum agora; Zebra depois.
5. **Regras de posição, nesta ordem:** juntar com o mesmo SKU; se a caixa
   estiver cheia, nova caixa ao lado; posição livre mais próxima; **zona
   separada por cliente**.
6. **A armazenagem é cobrada por posição ocupada**, e o mapa passa a ser a base
   dessa cobrança.
7. **A contagem de abertura só começa** depois de tudo isto definido e da
   fase 0 construída.

## 3. O que o sistema passa a conhecer

### 3.1 Posição (prateleira)

Uma posição é uma prateleira cadastrada, com:

- **código** legível e único, impresso em etiqueta com código de barras na
  própria prateleira (proposta de formato na pendência P1);
- **zona**: o `customer_code` dono da prateleira. Toda prateleira pertence a
  um cliente ou está livre (sem dono). É a mesma fronteira de isolamento do
  resto do sistema (invariante 4);
- **medidas úteis**: comprimento (a frente que vai sendo ocupada),
  profundidade, altura livre e peso máximo;
- **sequência de caminhada**: um número que ordena as prateleiras a partir da
  expedição/recebimento. "Mais próxima" é diferença de sequência, não
  coordenada; basta numerar na ordem em que se anda pelo galpão;
- **tipo**: estante, piso (caixas grandes ou paletes) ou área de apoio
  (`RECEBIMENTO`, `EXPEDICAO`), que não entra no mapa nem na cobrança;
- **situação**: ativa, bloqueada (não recebe caixa) ou em verificação (uma
  recusa de operador a marcou).

A ocupação não é cadastrada: é calculada a partir das caixas que estão na
prateleira (soma das frentes). O cadastro inicial vem da planilha de medidas
que já existe, importada por ferramenta em `tools/`, e depois é mantido por
tela (owner, admin e coordenação, como o catálogo hoje).

### 3.2 Caixa (unidade de manuseio)

O que vai para a prateleira é a caixa, não o SKU. Cada caixa tem:

- **código** sequencial próprio (ex.: `CX-000123`), impresso em código de
  barras na etiqueta;
- **cliente** (`customer_code`);
- **tipo**: pequena, média, grande ou fornecedor;
- **medidas** (comprimento × largura × altura) e **peso bruto**. Nos tipos
  padrão as medidas vêm do cadastro do tipo; na caixa de fornecedor são
  medidas na hora;
- **conteúdo**: lista de SKU e quantidade. Pode ter mais de um SKU, mas a
  regra de consolidação trabalha melhor com caixa de um SKU só;
- **posição atual** e **situação**: em recebimento, armazenada, em separação,
  expedida, encerrada (esvaziou);
- **origem**: número do recebimento ou sessão da contagem de abertura;
- **ciclo de vida** com evento em cada passo: criada, etiqueta impressa,
  guardada, movida, retirada parcial, encerrada.

### 3.3 Tipos de caixa

Cadastro pequeno: pequena, média e grande, com medidas e tara (peso vazio).
Fornecedor não tem medida fixa. Medidas a preencher na pendência P2.

### 3.4 Saldo e conciliação

O ledger continua sendo `stock_balances` por cliente × SKU × posição, como
hoje; os fluxos existentes (reserva, separação, contagem cíclica, movimento)
não mudam de chave. A caixa é a camada física por cima: toda guarda, retirada
ou movimento de caixa atualiza caixa e saldo **na mesma transação**, na Cloud
Function (invariante 1). Regra de ouro verificável por relatório diário: para
cada posição e SKU, a soma do conteúdo das caixas é igual ao saldo.

### 3.5 Ocupação

Uma caixa cabe numa prateleira quando: profundidade da caixa ≤ profundidade da
prateleira; altura da caixa ≤ altura livre; frente da caixa ≤ frente livre
(comprimento menos a soma das frentes das caixas já lá); peso bruto somado ≤
peso máximo. "Frente" é o lado da caixa que fica paralelo à prateleira. O
sistema testa as duas orientações horizontais e usa a que deixa a menor frente
e ainda cabe na profundidade. Caixa não é empilhada sobre caixa nesta versão.

## 4. Regras de endereçamento (motor determinístico)

Entrada: uma caixa com cliente, tipo ou medidas, peso e conteúdo.

1. **Candidatas:** prateleiras ativas da zona do cliente.
2. **Cabe:** aplica a seção 3.5. O que não cabe sai.
3. **Preferência, nesta ordem:**
   1. prateleira que já tem caixa do mesmo SKU (consolidação) e ainda cabe;
   2. senão, a prateleira mais próxima dessas, pela sequência de caminhada,
      que cabe ("nova caixa ao lado");
   3. senão (SKU sem caixa no estoque), a primeira prateleira da zona com
      espaço, na sequência de caminhada, para a zona crescer compacta a partir
      do início;
   4. desempate: a que fica com a menor sobra de frente depois de colocar a
      caixa (menos fragmentação); depois, a de menor sequência.
4. **Saída:** uma posição recomendada, até duas alternativas e o motivo em
   texto ("mesmo SKU em R02-P03", "mais próxima de R02-P03", "primeira livre da
   zona"), gravados na tarefa e no evento.
5. **Recusa:** o operador não escolhe outra posição; ele recusa com motivo
   (ocupada fisicamente, danificada, não coube, outro). A prateleira entra em
   verificação, o motor recalcula sem ela e o evento guarda a recusa, o
   motivo e o endereço efetivo. Quem tira a prateleira da verificação é
   coordenação ou admin.
6. **Zona cheia:** o sistema não transborda sozinho para prateleira de outro
   cliente nem para prateleira livre. Bloqueia a guarda com "zona do cliente X
   cheia" e avisa coordenação/admin, que ampliam a zona atribuindo
   prateleiras livres. Mantém o isolamento e a cobrança limpos.
7. **Caixa aberta (fase 2):** quando o SKU tem caixa aberta com capacidade
   restante conhecida, o sistema manda primeiro completar essa caixa e só
   depois abrir caixa nova ao lado. Capacidade restante vem de "unidades por
   caixa" no SKU, quando cadastrado, ou da declaração do operador ao fechar a
   embalagem. No go-live a consolidação é por prateleira (mesmo SKU perto);
   completar caixa aberta entra depois.
8. **Retirada na separação (fase 1):** o sistema diz de qual caixa tirar.
   Padrão: a caixa de entrada mais antiga (FIFO). Alternativa a decidir:
   esvaziar primeiro a caixa com menos unidades, porque libera posição e
   reduz a cobrança do cliente (pendência P8).

O motor roda no backend, dentro da mesma Cloud Function que cria a tarefa, e
tem teste unitário por cenário: cabe/não cabe em cada medida, mesmo SKU,
mais próxima, primeira livre, desempate, zona cheia, recusa.

## 5. Fluxos

### 5.1 Cadastro de posições e zonas (antes da contagem)

**Construído (fase 0, PR 1).** Tela Estoque › Posições, coleção
`warehouse_positions`, callables `saveWarehousePositions`,
`seedWarehouseLayout`, `createWarehouseAislePositions` e
`removeWarehousePosition` (`functions/src/domain/warehouse-positions.ts`).

Não há importação por planilha: as medidas levantadas em 16/10/2026 (ruas A,
B e C, 43 prateleiras) estão no código como mapa inicial e entram com um
clique, só com o cadastro vazio. A partir daí tudo muda pela tela: editar uma
prateleira, cadastrar uma rua nova com N prateleiras iguais, atribuir a zona
de uma rua inteira a um cliente, bloquear, remover (só sem saldo). Se o galpão
mudar um dia, é por aí que o mapa é reconstruído.

Vocabulário da planilha, mantido na tela: comprimento é a frente da
prateleira (1,80 m ou 1,78 m), largura é a profundidade (0,75 m, 0,88 m na
C-01) e altura é o vão livre (0,65 a 1,90 m). Código da posição: rua e
prateleira, `A-01` a `C-12`. A planilha não tem a prateleira 8 da rua A, e a
altura da A-16 ficou incompleta ("9"): entrou como 0,90 m com observação para
conferir. Peso máximo e zona não foram levantados: entram pela tela.

A etiqueta de posição (código de barras da prateleira) fica para o PR das
etiquetas, junto com a etiqueta de caixa.

### 5.2 Contagem de abertura por caixa (novo go-live)

Base: a tela restaurada no PR #94 (Estoque › Contagem, aba "Inventário de
abertura", uma sessão por cliente). Muda a linha: em vez de SKU + quantidade +
endereço digitado, a linha vira **uma caixa**: tipo ou medidas, peso, conteúdo
(SKU + quantidade + custo unitário, como hoje). O sistema sugere a posição,
imprime a etiqueta com o destino, e a linha é confirmada lendo a posição e a
caixa. Saldo e caixa nascem na posição confirmada.

Dois modos possíveis, a decidir (pendência P5):

- **direcionada**: o motor escolhe a posição de cada caixa e o galpão é
  reorganizado durante a contagem. Recomendado, porque as zonas por cliente
  são novas e as caixas vão mudar de lugar de qualquer forma. Custo: cada
  caixa é medida, pesada, etiquetada e levada; a contagem demora mais;
- **no lugar**: a caixa é registrada onde está (posição lida no cadastro, que
  precisa ser da zona do cliente e caber). O motor só passa a decidir a partir
  do primeiro recebimento.

### 5.3 Recebimento com guarda dirigida (fase 1)

Conferência (existe) → **embalagem**: o operador monta as caixas (tipo ou
medidas, peso, conteúdo) → o motor direciona cada caixa → etiqueta impressa já
com o destino → tarefa de guarda nasce com destino preenchido (hoje nasce
vazia) → o operador confirma lendo a posição e a caixa → o saldo sai de
`RECEBIMENTO` para a posição, como hoje, na mesma transação da caixa.

### 5.4 Expedição com etiqueta (fase 1)

Separação (existe) → o sistema indica a caixa de onde tirar (regra 8) → caixa
de expedição montada com etiqueta própria: pedido ou solicitação, destinatário,
volume 1/N, conteúdo, quantidades, peso → a caixa de estoque que esvaziou é
encerrada e libera a frente da prateleira.

### 5.5 Movimentação de caixa (fase 1)

Mover uma caixa inteira entre posições, com motivo, evento e o mesmo teste de
"cabe". Substitui, para caixas, o movimento de origem/destino digitados.

### 5.6 Mapa (fase 0, básico)

Por zona: ruas e prateleiras com ocupação da frente (livre, parcial, cheia,
bloqueada), caixas e SKUs em cada uma, filtro por cliente e SKU. Substitui o
mapa atual. Fica em Estoque, ao lado de Itens e Contagem.

### 5.7 Cobrança por posição ocupada (fase 2)

Snapshot diário automático das posições ocupadas por cliente, calculado do
mapa. A linha de armazenagem da lista de preços ganha fonte automática (hoje
"pallet" digitado no snapshot mensal), como já acontece com peças de entrada,
saída e movimentações. Depende das pendências P3 e P4.

## 6. Etiquetas

- **Caixa de estoque:** código da caixa em código de barras (Code 128),
  cliente, tipo e medidas, peso bruto, lista de SKU × quantidade, data, origem
  (recebimento ou abertura), posição de destino.
- **Caixa de expedição:** pedido ou solicitação, destinatário, volume 1/N,
  lista de SKU × quantidade, peso, data.
- **Posição:** código da prateleira em código de barras e zona.
- **Impressão:** o sistema gera PDF; agora em impressora comum, com gabarito de
  etiqueta adesiva A4 a definir (pendência P6); depois ZPL para Zebra com o
  mesmo conteúdo. "Etiqueta impressa" é evento.
- **Leitura:** câmera do celular (a tela de contagem já é usada no celular) ou
  digitação do código. Coletor dedicado fica para depois.

## 7. Invariantes que continuam valendo

1. Toda escrita (posição, caixa, guarda, movimento, encerramento, snapshot de
   cobrança) passa por Cloud Function, com papel, status atual, transação e
   idempotência.
2. Cada passo grava evento: `position.created/updated/blocked`,
   `zone.updated`, `box.created`, `label.printed`, `putaway.suggested`,
   `putaway.confirmed`, `putaway.refused`, `box.moved`, `box.closed`,
   `storage.snapshot`.
3. A IA não escolhe posição nem move caixa. Pode explicar e propor.
4. Zona é `customer_code`. Prateleira de um cliente nunca recebe caixa de
   outro; o portal do cliente vê só a própria zona.
5. Permissão em Rules e backend: cadastro de posições e zonas para owner,
   admin e coordenação; guarda, contagem e movimento para os papéis de armazém;
   snapshot de cobrança para quem fecha faturamento.

## 8. Pendências a decidir antes da contagem

| # | Pendência | Proposta |
|---|-----------|----------|
| P1 | Formato do código da posição. | **Decidido:** rua e prateleira, `A-01`. Caixa em cima de caixa fica dentro da mesma prateleira e não entra no código; a capacidade considera a altura livre. |
| P2 | Medidas das prateleiras e das caixas. | **Prateleiras: decidido**, 43 medidas de 16/10/2026 no mapa inicial. **Caixas: ainda sem tamanhos padrão**; as medidas entram à mão por caixa até os três tamanhos serem definidos. |
| P3 | O que é "uma posição ocupada". | **Decidido para agora:** uma caixa guardada conta uma posição. O mapa só mostra o número; a fatura segue manual. Rever quando a cobrança for automatizada. |
| P4 | Regra do mês para a cobrança. | Adiado: a cobrança não será automatizada neste primeiro momento. |
| P5 | Modo da contagem de abertura. | **Decidido:** direcionada, reorganizando todas as posições. |
| P6 | Etiqueta. | **Decidido:** impressa em A4, mas menor: 10 por folha, 101,6 × 50,8 mm. |
| P7 | "Unidades por caixa" por SKU: cadastrar ou declarar na hora. | Declarar na hora no go-live; cadastrar depois para os SKUs de giro. |
| P8 | De qual caixa a separação retira. | FIFO por data de entrada. Alternativa: esvaziar primeiro a caixa com menos unidades. |
| P9 | Zonas iniciais: quais prateleiras pertencem a cada cliente. | Atribuir pela tela de Posições ("Zona da rua") antes da contagem. |
| P10 | Balança disponível para o peso bruto por caixa? | Sim, no recebimento e na contagem. |

## 9. Entrega em fases

**Fase 0, bloqueia a contagem.** Um problema por PR, com teste que falha
antes e passa depois:

1. cadastro de posições e zonas: coleção, callables, tela, mapa inicial no
   código (feito no PR 1; a etiqueta de posição vai com as etiquetas);
2. tipos de caixa e a caixa como unidade de manuseio: coleção, callables de
   criar, mover e encerrar, conciliação com o saldo;
3. motor de endereçamento com os testes de cenário da seção 4;
4. contagem de abertura por caixa, com sugestão e etiqueta em PDF;
5. mapa básico por zona com ocupação.

**Fase 1, logo após o go-live:** recebimento com embalagem e guarda dirigida;
confirmação por leitura; movimentação de caixa; expedição com etiqueta.

**Fase 2:** cobrança por posição ocupada com snapshot diário automático;
relatório de conciliação caixas × saldo; completar caixa aberta; ZPL para
Zebra; reorganização sugerida (IA recomenda, pessoa aprova).

Mockups das telas da fase 0 (mapa, posições, contagem por caixa, celular,
etiquetas) feitos e aprovados em 16/10/2026, com uma mudança: posições sem
importação por planilha.

## 10. O que muda para quem opera

- Ninguém mais digita endereço. A posição vem do sistema e é confirmada por
  leitura.
- Toda caixa tem etiqueta; caixa sem etiqueta não existe no sistema.
- Recusar uma sugestão é possível, com motivo, e fica registrado.
- Quando a zona de um cliente enche, a guarda para e coordenação amplia a
  zona. Não é o operador que escolhe onde encaixar.
