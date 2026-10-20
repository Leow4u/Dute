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
e ainda cabe na profundidade. Virar para outro lado exige `allow_tilt`.

Empilhar exige a permissão independente `allow_stacking`. Sem frente livre,
o motor testa o topo de caixas guardadas na mesma posição e cliente. A nova
base precisa caber integralmente sobre uma caixa, a altura total da pilha
precisa caber no vão e o peso de todas as caixas continua limitado pela
prateleira. Cada apoio recebe uma única caixa diretamente acima. A sugestão
identifica `support_box_code` e `base_height_m`; a guarda confirma esse
apoio dentro da transação que reserva capacidade. A resistência da embalagem
é conferida pelo operador, não calculada pelo sistema.

Caixas em `committing` ocupam seu lugar e seu apoio, mas não podem servir
de base até ficarem `stored`. A frente de uma pilha é contada uma única vez.
Caixas antigas sem vínculo de apoio permanecem na base; nada é reorganizado
automaticamente. Não se permite remover uma caixa com outra apoiada sobre ela.

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
`removeWarehousePosition` (`functions/wms/src/domain/warehouse-positions.ts`).

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

Atualizado em 20/10/2026: a abertura começa pela **caixa de destino em
conferência**, antes de escolher posição. A equipe separa fisicamente os
produtos e pode reunir o mesmo modelo/cor com tamanhos distintos, cada um
identificado pelo seu código.

1. **Iniciar conferência** gera o CX e salva a caixa em `counting`, sem medidas
   nem posição. Itens ficam como rascunhos persistidos, editáveis e removíveis;
   não criam SKU, saldo ou cobrança de posição.
2. **Revisar e fechar caixa** confere o resumo e persiste `reviewed`. Reabrir
   é uma ação explícita e auditada.
3. Medidas e conteúdo conferido alimentam **Onde guardar?**. Para apoiar de
   lado é necessário permitir essa orientação; a sugestão mostra frente,
   profundidade e altura efetivas. A preferência é por SKU conhecido, sem
   inferência de família pelo nome.
4. **Confirmar guarda** revalida zona, capacidade, peso e orientação. A caixa
   fica `committing`, reservando espaço; cada linha materializa saldo e
   checkpoint na mesma transação. **Retomar guarda** continua sem duplicar
   linhas publicadas. A revisão da prateleira serializa guardas concorrentes.
5. Quando todas as linhas terminam, a caixa fica `stored` e fechada, pronta
   para etiqueta. O inventário não encerra com caixas pendentes.

**Correção da operação já iniciada:** `Corrigir caixa` transfere uma linha
inteira entre caixas da mesma sessão, mantendo SKU, fotos, custo e quantidade
total. Se faltar o destino no cadastro, use **Cadastrar caixa já armazenada**.
Essa exceção preserva o fluxo antigo para corrigir vínculos existentes.
O estorno continua separado e não deve ser usado para trocar apenas a caixa.

**Recusa:** o motivo e a alternativa escolhida ficam auditados. Recusar uma
sugestão não coloca mais toda a prateleira em verificação.

Capacidade continua por uma fileira na profundidade. Empilhamento é
opcional, com apoio identificado e altura total revalidada (seção 3.5).
Sem permissão para virar de lado, preserva a altura original. Totais de
rascunhos e publicados são separados; posições ocupadas contam caixas
armazenadas. Procedimento e limites em
[`wms-abertura-correcoes.md`](wms-abertura-correcoes.md).

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

**Construído (fase 0, PR 4).** Estoque › Mapa (`/estoque/mapa`); o mapa
antigo do catálogo (`/catalogo/mapa`, pivô da coluna de localização dos
SKUs) foi removido e o endereço redireciona para o novo.

- Quatro números no alto: posições ocupadas (prateleira com ao menos uma
  caixa, o que a fatura manual usa), prateleiras da zona (com caixa, vazias,
  indisponíveis), espaço restante em caixas de referência de 50 × 50 × 35
  cm numa camada, e caixas guardadas com unidades e produtos.
- Filtros por zona e rua, busca por caixa, produto ou código (acha pelo
  código da caixa, SKU, código do cliente e nome, sem acento). Legenda:
  livre, parcial, cheia, em verificação, bloqueada.
- Cada rua é uma linha na ordem de caminhada; cada prateleira mostra o
  código, as caixas, a barra da frente usada e "cabe n" ou "livre". Tocar na
  prateleira abre a ficha: medidas, peso usado e máximo, frente livre, o que
  ainda cabe, as caixas com conteúdo (das linhas da abertura, com
  quantidade), e os atalhos para etiqueta da posição, etiquetas das caixas e
  o cadastro. No celular a ficha sobe como gaveta.
- Só leitura: a frente usada conta uma vez por pilha; peso, caixas e unidades
  incluem todas as camadas. "Cabe ainda" e "sem vaga na base" se referem à
  capacidade de referência na base da prateleira. A ficha identifica o apoio
  das caixas empilhadas. A sugestão de guarda verifica o espaço acima delas.
  Mover caixa e bloquear pela ficha ficam para a fase 1, com a movimentação.

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

**Construído (fase 0, PR 3).** Tela Estoque › Etiquetas (`/estoque/etiquetas`),
aberta pela Contagem (caixa aberta, cada caixa da sessão ou todas da sessão) e
por Posições (as posições filtradas). Sem gerador de PDF: a impressão é a do
navegador, como a fatura (Imprimir → Salvar PDF). Code 128 feito no próprio
app (`lib/code128.ts`, conjunto B, com teste do dígito verificador da norma).

- Etiqueta de 101,6 × 50,8 mm, o rolo de 4 × 2 polegadas da Zebra. Na folha
  A4 saem dez (duas colunas por cinco linhas, bloco centrado); "pular N" usa
  uma folha adesiva já começada.
- Caixa: código em barras e em texto, posição em destaque, cliente, medidas,
  peso, origem e data, até quatro produtos com quantidade e "+ n produto(s)"
  quando não cabe, total de unidades. O conteúdo vem das linhas da abertura
  da caixa, por isso a etiqueta se imprime depois de lançar os produtos.
- Posição: código em barras e em texto, zona, rua e prateleira, medidas e
  peso máximo.
- Modo "uma por etiqueta": cada etiqueta vira uma página do tamanho dela. É o
  caminho da Zebra no primeiro dia, pelo driver do Windows com o rolo
  configurado. ZPL direto (Zebra Browser Print) fica para quando houver a
  impressora, com o mesmo conteúdo; nada da etiqueta muda.
- Ainda sem evento "etiqueta impressa": a impressão é do navegador e o app
  não sabe se saiu. Entra com o ZPL, quando o app passa a mandar o texto.

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
2. a caixa como unidade de manuseio: coleção `warehouse_boxes`, callables de
   sugerir, criar e remover, conciliação com o saldo por `box_code` (feito
   no PR 2; mover e encerrar ficam com a movimentação, fase 1; tipos de
   caixa esperam a pendência P2);
3. motor de endereçamento com os testes de cenário da seção 4 (feito no PR
   2, `functions/wms/src/domain/warehouse-boxes.ts`);
4. contagem de abertura por caixa, com sugestão (feito no PR 2) e etiquetas
   de caixa e de posição (feito no PR 3, seção 6);
5. mapa básico por zona com ocupação (feito no PR 4, seção 5.6).

Com isso a fase 0 está entregue; falta só atribuir as zonas pela tela de
Posições antes da contagem.

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
