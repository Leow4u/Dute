# Recebimento com caixas: avaliação do fluxo e desenho da fase 1 do mapa

**Situação:** desenho para decisão do Leonardo. As oito perguntas da primeira
versão foram decididas em 01/11/2026 (seção 6) e o texto foi revisado no
mesmo dia com o levantamento do código (seções 2.5, 4 e 7). Nada está
construído; a tela espera o mockup. Motivo: em 30/10/2026 a equipe recebeu
uma NF da BTG pela chegada avulsa, guardou as 71 peças em B-02 e o sistema não
deu etiqueta nem mostrou caixa no Mapa, porque o recebimento de hoje não
conhece caixa. O fluxo real do galpão é por caixa; o sistema só tem caixa na
contagem de abertura. O desenho aprovado em 16/10/2026
(`docs/mapa-do-armazem-enderecamento-dirigido.md`, seção 2) já decidiu que
medidas e peso são informados por caixa **no recebimento** e que toda caixa
sai com etiqueta; a entrega dessa parte ficou como "fase 1, logo após o
go-live" (seção 5.3) e não começou.

Documentos relacionados: `docs/mapa-do-armazem-enderecamento-dirigido.md`
(modelo de posição e caixa, motor, etiquetas, pendências P1 a P10),
`docs/wms-abertura-correcoes.md` (estados da caixa e a guarda retomável),
`docs/manual-armazenagem.md` (Receber, Contagem, Mapa, Etiquetas),
`docs/api.md` e `docs/api-cobertura.md` (recebimentos pela API REST v1).

## 1. O fluxo real, como a equipe trabalha

1. O fornecedor entrega no galpão, em caixas, com mais de um tamanho na mesma
   caixa.
2. A equipe recebe os volumes e pega a nota fiscal.
3. Confere o que chegou com a NF: volumes, itens e quantidades.
4. Entra em Estoque › Receber e lança o que chegou, caixa a caixa.
5. Cada caixa vai para uma prateleira, com etiqueta; o Mapa e a cobrança por
   posição refletem o que está no galpão.

Não existe contagem aí: a Contagem é a abertura do inventário e a contagem
cíclica. Receber mercadoria pela Contagem não faz sentido para a operação e
não é o que o manual ensina.

## 2. O que o sistema faz hoje

### 2.1 As portas de entrada da chegada

| Porta | Quem usa | O que cria |
|---|---|---|
| Chegada avulsa (Receber) | Equipe do galpão | A chegada com linhas por produto, sem aviso (`createInboundReceipt`). |
| Aviso de envio do cliente (portal › Envios) | Cliente; aprovação da coordenação em Solicitações | A chegada com as linhas do aviso; a aprovação acha o cadastro pelo código do cliente (`decideCustomerRequest`). O portal já tem "Ler itens da nota": a IA lê o PDF ou a foto da NF e sugere as linhas (`readShipmentInvoice`, `invoice-reading.ts`). |
| Documento | Ninguém, hoje | A callable `applyDocumentOperationalAction` com `create_receiving` cria a chegada a partir de linhas já estruturadas de um documento, mas nenhuma tela a chama. |

As portas convergem no mesmo par `inbound_receipts` + `inbound_items` (uma
linha por produto, nunca por volume), na mesma ficha e na mesma callable de
conferência. A API REST v1 (`/api/v1/armazenagem/recebimentos`: criar,
conferir com `expected_version`, avançar) usa as mesmas funções de domínio;
a guarda está fora da API por construção.

### 2.2 Da ficha da chegada até a prateleira

1. **Ficha da chegada** (`created`): aviso do cliente, referência, prazo e as
   linhas, cada uma com "Físico", "Local" (vem `RECEBIMENTO`, texto livre no
   app; a API valida contra as posições) e "Custo". "Salvar conferência"
   grava o físico de cada linha, falta ou sobra e põe a chegada em
   `checking`; não mexe em saldo.
2. **"Concluir entrada"** (`received`) exige toda linha conferida e a
   justificativa da divergência; lança o saldo de cada linha em
   `stock_balances` no local dela, grava o movimento `ENTRADA` com
   `source: wms_receiving` (é esse movimento que a fatura conta como peça de
   entrada), a projeção do portal e os agregados do catálogo, e cria **uma
   tarefa de guarda por linha** que ficou em `RECEBIMENTO`, com destino vazio
   (`advanceWarehouseTaskTransaction`, ramo `received`).
3. **Guarda** (`planned` → `completed`): o operador escolhe qualquer
   prateleira ativa da zona do cliente ("Bipe ou busque a prateleira", um
   campo de texto com lista, sem câmera); "Concluir guarda" move o saldo de
   `RECEBIMENTO` para a prateleira com dois movimentos `wms_putaway` (que a
   fatura não conta) e o evento `putaway.completed`. Sem sugestão, sem
   cálculo de encaixe, sem caixa. Guarda parcial conclui a tarefa e o resto
   fica em `RECEBIMENTO` sem tarefa.

Linha com "Local" digitado diferente de `RECEBIMENTO` entra direto na
prateleira, sem guarda. Telas de 30/10/2026, percorridas no ambiente local:
a chegada avulsa, a ficha, a conferência, a guarda e o Mapa depois.

### 2.3 O que falta nesse caminho

- **Não há caixa.** A chegada não tem volumes, medidas nem peso; nenhuma
  `warehouse_boxes` é criada; o saldo vai para a prateleira solto.
- **Não há etiqueta de caixa.** A etiqueta de caixa existe só para caixa
  guardada (`/estoque/etiquetas`, aberta pela Contagem). O recebimento só tem
  a etiqueta da posição.
- **O Mapa e "Posições ocupadas" contam caixas.** A prateleira com 71 peças
  recebidas aparece "sem caixas registradas" e não entra na referência da
  fatura manual (pendência P3: "uma caixa guardada conta uma posição").
- **A guarda não é dirigida.** O motor de endereçamento (mesmo produto, perto
  do produto, primeira livre; cabe ou não cabe) só roda na Contagem e na
  caixa manual. O único caminho em que a guarda já nasce com destino é o
  cancelamento de pedido, que devolve o item à prateleira de onde saiu.
- **Uma guarda por linha, não por caixa.** Uma NF com 12 tamanhos vira 12
  tarefas de guarda, mesmo que tudo esteja em duas caixas.

### 2.4 O que a Contagem já tem e serve de molde

A conferência da caixa de abertura (`inventory.tsx`,
`opening-inventory-conference.ts`, `warehouse-boxes.ts`) faz o que o
recebimento precisa: "Iniciar conferência da caixa" gera o `CX`; os produtos
entram na caixa como rascunho; "Revisar e fechar caixa"; medidas e peso;
"Guardar em" com "Sugestão do sistema" ou "Escolher prateleira", com o
encaixe conferido; "Confirmar guarda em A-03" reserva a prateleira
(`committing`), publica cada linha e fecha a caixa (`stored`); "Imprimir
etiqueta"; "Retomar guarda" se parar; "Não cabe aqui" com motivo.

O que é genérico e serve a qualquer origem de caixa: o documento da caixa e o
contador `CX`, as medidas, a ocupação por frente com pilha e reserva, a
sugestão em três níveis com recusa e alternativas (`suggestPosition`), a caixa
manual já guardada (`createWarehouseBox`) e a remoção, a serialização da
capacidade pela `occupancy_revision` da prateleira, os componentes de escolha
de prateleira e de volume, o formato da etiqueta e o Mapa.

O que está amarrado à abertura: toda a camada de conferência exige a sessão
aberta (`opening_inventory_sessions`) e a caixa com `origin.session_id`; o
conteúdo da caixa mora nas linhas da sessão (`opening_inventory_lines` e os
rascunhos), e é de lá que a etiqueta e o Mapa leem o conteúdo, com a origem
"Abertura" ou "Manual"; a publicação do conteúdo passa pela contagem em modo
abertura (`recordCycleCountTransaction`), o único caminho que soma
`line_count`, `unit_count` e `sku_codes` na caixa; a tolerância de encaixe
(prateleira escolhida à mão entra mesmo sem o cálculo confirmar) só vale com
a sessão aberta; e a regra que recusa guardar caixa da abertura onde o SKU já
tem saldo que não veio da sessão. "Cadastrar caixa já armazenada" é a
exceção para corrigir vínculos: cria a caixa guardada, com encaixe
obrigatório e sem conteúdo.

### 2.5 Fatos do código que condicionam o desenho

- **A fatura não lê caixa nem prateleira.** Peças de entrada e saída saem dos
  movimentos com `source` `wms_receiving` e `wms_shipping`, na competência da
  data do movimento; qualquer origem interna (`wms_putaway`) não cobra. A
  linha de armazenagem continua manual: a fonte automática "pallet" existe no
  código e nunca é alimentada; "Posições ocupadas" do Mapa é só o número que
  quem fatura digita. A régua é `billing-callables.integration.test.ts`.
- **A saída nunca toca a caixa.** Separação, entrega, contagem cíclica e
  devolução mexem só no saldo; nada baixa `unit_count` nem `sku_codes` da
  caixa. O conteúdo de uma caixa é o que entrou nela, não o que resta. Com o
  giro diário do uniforme, a caixa do recebimento ficaria "mentindo" mais
  cedo que a da abertura.
- **A reserva do portal pode cair no saldo de `RECEBIMENTO`**: a alocação da
  aprovação percorre todas as linhas de saldo do SKU. Depois a guarda recusa
  e a separação manda o operador à área de recebimento.
- **A API REST v1** usa esquemas `.strict()` (campo novo dá 400), confere a
  conferência pelo `expected_version` da chegada (toda escrita no documento
  `inbound_receipts` vira 409 para o integrador) e só avança `created` e
  `checking`.
- **A zeragem apaga as coleções de fluxo do WMS por descoberta**, inclusive
  `warehouse_boxes` e o contador `CX` (`warehouse_counters`); só estrutura
  (`warehouse_positions`) é preservada. Coleção nova de fluxo do WMS não
  precisa de lugar na zeragem; cadastro (tipos de caixa, P2) precisaria.
- **O WMS não tem chave de liberação por funcionalidade** (`lib/liberacao.ts`
  é da plataforma): o que entra na `main` vai à homologação em cada push e à
  produção no próximo disparo manual, junto com qualquer correção do WMS.
- **Concorrência:** cada guarda de caixa incrementa a `occupancy_revision` da
  prateleira; a guarda por linha e o cancelamento leem as posições inteiras
  na transação e são abortados por isso; o contador `CX` é um documento único
  para todos os clientes.
- **O cliente da caixa vem do seletor "Cliente ativo"**, enquanto a fila do
  Receber mostra chegadas de todos os clientes; sem o código, o servidor cai
  no cliente legado ("BTG Pactual").
- **O gancho da guarda dirigida já existe e ninguém usa:** a linha da chegada
  tem `destination_location_id`, copiado para a tarefa de guarda e
  pré-preenchido na ficha, mas nenhum caminho grava esse campo.
- **O Agent Dute** lê chegadas e tarefas de guarda com uma lista fechada de
  status, e não enxerga caixa. Status novo de chegada ou tipo novo de tarefa
  sai errado na resposta até a lista ser atualizada.
- **Não há mockup de recebimento por caixa.** `ModEntrada`, `ModWms` e
  `WmsExpedicao` são a entrada por módulos, a barra lateral e o pedido de
  saída; nenhum serve de base. A regra da plataforma é tela aprovada antes do
  PR de tela.

## 3. O que já está decidido e o que está em aberto

Decidido em 16/10/2026 (mapa, seção 2): prateleira de comprimento livre;
**medidas e peso por caixa no recebimento e na abertura**; três tamanhos
padrão mais caixa de fornecedor medida na hora; **toda caixa sai com etiqueta,
na guarda e na expedição**; regras de posição (mesmo SKU, caixa ao lado, livre
mais próxima, zona por cliente); cobrança por posição ocupada com o mapa como
base. A seção 5.3 do mesmo desenho descreve o recebimento com embalagem:
conferência, montagem das caixas, motor direciona, etiqueta impressa já com o
destino, tarefa de guarda nasce com destino preenchido, o operador confirma
lendo a posição e a caixa, **o saldo sai de `RECEBIMENTO` para a posição,
como hoje, na mesma transação da caixa**. Pendências que tocam este desenho:
P2 (tamanhos padrão, não são pré-requisito pela decisão 2), P3 e P4 (cobrança
por posição segue manual), P7 (unidades por caixa declaradas na hora), P10
(balança: sim).

Decidido em 01/11/2026 pelo Leonardo: a tabela da seção 6.

## 4. Desenho proposto

Princípios: a caixa é a unidade de manuseio também na entrada; a NF é o
esperado; a conferência é por caixa, como na abertura; o motor direciona e o
operador confirma; a etiqueta sai com o destino antes de levar a caixa à
prateleira; `RECEBIMENTO` continua sendo a área de passagem, como a seção 5.3
manda, para a fatura, o relógio de parados e a API não mudarem; caixa e saldo
mudam na mesma transação; nada muda no ledger.

### 4.1 Modo da chegada e liberação

Cada chegada nasce com um modo: **por caixa** ou **por linha**. A tela cria
por caixa para o cliente cujo modelo de operação pede caixa (uniformes,
decisão 1); a API REST v1 e o aviso do portal criam por linha, como hoje. O
modo fica gravado na chegada e não muda depois da primeira caixa. A chegada
por linha continua exatamente como está.

A funcionalidade entra atrás de uma liberação própria do WMS
(`RECEBIMENTO_POR_CAIXA_AMBIENTES`, primeiro o `dute-homolog`), travada por
teste como as das outras fases, com o desligamento descrito: desligada, a
tela volta a criar por linha e as chegadas por caixa já abertas seguem até o
fim.

### 4.2 Chegada e NF

A chegada continua nascendo pelas portas de hoje. Ganha dois dados opcionais:
**volumes declarados** (na NF) e **volumes recebidos** (contados na portaria,
antes de abrir), com aviso quando diferem. As linhas da NF são o esperado.
A leitura da nota por IA que já existe no aviso do portal ("Ler itens da
nota") entra na chegada avulsa para pré-preencher as linhas, com revisão da
pessoa (decisão 4); XML depois. A porta pelo Documentos fica como está, sem
tela.

### 4.3 Conferência por caixa

Na ficha da chegada por caixa, no lugar de "Físico" por linha:

1. **"Iniciar caixa"** gera o `CX-` com origem na chegada (`origin.kind:
   receipt`, com o id e o número da chegada e a NF) e a caixa fica "em
   conferência" (`counting`). O cliente da caixa é o da chegada, nunca o do
   seletor; divergência é recusada.
2. **Lançar o que está na caixa:** cada produto das linhas da NF, com a
   quantidade física contada; a busca acha pelo código do cliente, SKU ou
   código de barras no catálogo inteiro; produto que não está na NF entra
   como sobra; produto novo segue a regra de hoje (foto, categoria, custo, SKU
   gerado ou reativado). O custo unitário é o da NF e quem o informa é a
   operação, na chegada, como hoje (decisão 12); é custo de entrada, não
   preço, e a tabela de preços continua restrita. Caixa do fornecedor com
   vários tamanhos é normal (decisão 3); até 100 linhas por caixa, como na
   abertura. A conferência por caixa é feita no computador da bancada do
   recebimento; a guarda tem a tela de celular (decisão 11).
3. **"Fechar caixa"** (`reviewed`): comprimento, largura, altura e peso na
   balança; "pode virar de lado" e "pode empilhar". A caixa é a do
   fornecedor, como chegou, medida na hora (decisão 2).
4. **"Onde guardar?":** a sugestão do motor (mesmo produto, perto do produto,
   primeira livre da zona) ou "Escolher prateleira", com o encaixe conferido
   e bloqueando fora da abertura, como já está previsto. "Não cabe aqui"
   recusa com motivo e pede outra.
5. **"Confirmar destino em B-02"** (`committing`): a prateleira fica
   reservada para a caixa (a ocupação já conta `committing`), o destino fica
   na caixa e **"Imprimir etiqueta"** sai aqui, com a posição impressa. A
   etiqueta passa a aceitar caixa `committing` com destino; se a posição
   mudar numa recusa na prateleira, reimprime, com evento.

O "Físico" de cada linha da NF passa a ser a soma do que foi lançado nas
caixas; falta e sobra são calculadas por linha, e a justificativa da
divergência continua como hoje, na chegada. Quem precisa de linha sem caixa
(peça grande, no modelo de operação que permitir) usa o modo por linha.

### 4.4 Concluir entrada

"Concluir entrada" exige toda linha da NF tratada (coberta por caixas ou
marcada como falta) e toda caixa fechada com destino confirmado. Faz o que
faz hoje, na mesma transação e do mesmo tamanho: lança o saldo de cada linha
em `RECEBIMENTO`, grava a `ENTRADA` com `source: wms_receiving` uma vez por
linha (a fatura e o relógio de parados continuam iguais, numa data só por NF)
e a projeção do portal. O que muda: cria **uma tarefa de guarda por caixa**,
com `box_code` e o destino já preenchido, no lugar de uma por linha.

A chegada só sai de "Em aberto" quando todas as guardas das caixas estiverem
concluídas (decisão 5): a fila mostra "recebida · 2 de 3 caixas guardadas".
O cliente é avisado de que chegou produto novo quando a última caixa da
chegada é guardada, que é quando as peças ficam disponíveis para pedido
(decisão 10), com a descrição dos itens e as quantidades, sem valor, sem
caixa e sem posição (decisão 7, seção 4.8). Concluir a entrada não avisa
ninguém.

### 4.5 Guarda por caixa

A tarefa de guarda da caixa lista a prateleira de destino e pede a
confirmação (hoje por toque; por leitura da etiqueta da caixa e da posição
quando houver leitor, seção 5). "Concluir guarda" move, numa transação só, o
saldo de todas as linhas da caixa de `RECEBIMENTO` para a prateleira com os
movimentos `wms_putaway` de hoje, põe a caixa em `stored` e grava o evento. A
quantidade é a da caixa: não há guarda parcial de caixa. "Não cabe aqui" na
prateleira recusa com motivo, o motor sugere outra, a caixa continua
reservando a nova e a etiqueta é reimpressa.

Zona cheia ou sem zona não trava a entrada: a NF entra em `RECEBIMENTO` e a
caixa fica por guardar até owner, admin ou coordenação ampliarem a zona em
Posições, como o desenho do mapa já prevê. Devolução e cancelamento de
pedido seguem como estão (decisão 8): o cancelamento já guarda a partir de
`EXPEDICAO` com destino preenchido; a devolução grava direto no local.

### 4.6 Etiqueta

A mesma etiqueta de caixa de hoje (código em barras, posição em destaque,
cliente, medidas, peso, origem, data, produtos e unidades), com a origem
"Recebimento · NF 48.212" e o conteúdo vindo das linhas da caixa do
recebimento. Sai ao confirmar o destino, caixa a caixa, e em "Etiquetas da
chegada" (todas as caixas da chegada, dez por folha A4 ou uma por etiqueta,
decisão 6). A etiqueta não condiciona o saldo: a impressão é do navegador e o
app não sabe se saiu, até o ZPL.

### 4.7 Mapa, posições ocupadas e cobrança

A caixa do recebimento entra no Mapa ao confirmar o destino (`committing`) e
conta como posição ocupada ao ser guardada (`stored`), como a da abertura. O
Mapa e a etiqueta ganham uma segunda fonte de conteúdo, a da caixa do
recebimento, ao lado das linhas da sessão de abertura. A cobrança não muda:
peças de entrada continuam vindo da `ENTRADA` em "Concluir entrada", a guarda
continua `wms_putaway`, a armazenagem segue manual com a referência do Mapa
(P3, P4) e a fase 2 (snapshot diário) continua pendente. O que muda é que a
referência passa a enxergar o que entrou depois da abertura.

O conteúdo da caixa é o **conteúdo de entrada**: a saída não baixa caixa, e
isso vale também para as caixas da abertura. A etiqueta e o Mapa dizem o que
entrou em cada caixa; o saldo por prateleira continua sendo o ledger. Dizer de
qual caixa a separação tira e baixar o conteúdo é a regra 8 do mapa, fora
deste desenho.

### 4.8 Aviso ao cliente e o que o cliente pode pedir

Um modelo novo na lista de avisos da Operação
(`functions/operacao/src/domain/avisos.ts`, a mesma rotina `runNotifications`
que manda "Itens parados"), disparado pelo evento da última guarda da chegada,
por e-mail aos contatos do cliente e no sino do portal
(`client_notifications`), com a descrição dos itens e as quantidades, sem
valor, sem caixa e sem posição (decisão 7). O e-mail sai em HTML com a
identidade da Dutelog, no molde dos e-mails de convite e de confirmação
(`convite-email-template.ts`), e o mesmo molde passa a valer para os outros
modelos de aviso (decisão 13). O portal não mostra caixa nem posição: ele lê
só `client_inventory`, que não tem local, e as caixas são fechadas ao cliente
nas regras.

Para o cliente, só existe o que está na prateleira (decisão 10): o
"Disponível" do portal passa a contar só o saldo das prateleiras, o que está
em `RECEBIMENTO` aparece como "Em recebimento" e não pode ser pedido, e a
reserva do pedido deixa de cair nas áreas de passagem (`RECEBIMENTO` e
`EXPEDICAO`). Hoje a entrada já conta como disponível e a aprovação do pedido
pode reservar da área de recebimento (seção 2.5).

### 4.9 Dados

- `inbound_receipts`: `conference_mode` (`per_box` ou `per_line`),
  `declared_volumes`, `received_volumes`. Durante a conferência por caixa, o
  documento da chegada não é escrito (a API confere pelo `updateTime` dele);
  só caixas e linhas.
- `warehouse_boxes`: `origin.kind: receipt` com `receipt_id`,
  `receipt_number` e `invoice_number`; o conteúdo embutido na própria caixa
  (`lines[]`: `inbound_item_id`, SKU, código do cliente, nome, quantidade,
  até 100), em vez de coleção nova; `destination_location_id` desde o
  `committing`. O ciclo é o mesmo: `counting` → `reviewed` → `committing` →
  `stored`, com os mesmos contadores `line_count`, `unit_count` e
  `sku_codes`.
- `inbound_items`: `boxed_qty` (soma das caixas) e `box_codes`; `received_qty`
  derivada no modo por caixa.
- `putaway_tasks`: `box_code` e `destination_location_id` na criação.
- Eventos nos nomes e fontes que já existem (`warehouse.box_stored`,
  `warehouse.position_refused`, `putaway.completed`, `inventory.received`),
  com `inbox: false` nos eventos por caixa para não inundar a caixa de
  entrada do agente; evento novo só para "caixa fechada" e "etiqueta
  reimpressa".
- Leitura "caixas desta chegada" pela rota `/api/warehouse/boxes` com filtro
  por `receipt_id` e o índice travado em `lib/cloud-api-indices.test.ts`.
- Idempotência e recibos como hoje (`operational_operations`), com replay
  exato; `customer_code` em tudo (invariante 4); toda escrita passa por
  `assertInventoryOperationsEnabled` (congelamento para reconciliação).

### 4.10 API REST v1 e integrações

Os endpoints de recebimento continuam valendo sem mudança de contrato: a
integração cria por linha, confere por `PATCH` e avança; esquemas `.strict()`
intactos; `avancar` segue aceitando `created` e `checking`. Caixas pela API
ficam para depois, se alguma integração precisar. O aviso do portal também
nasce por linha, até a coordenação optar por caixas na aprovação (parte
futura). A ferramenta do Agent Dute que lê chegadas e guardas ganha os status
e o tipo de tarefa novos na mesma parte que os cria.

### 4.11 Travas de teste que mudam de propósito

`operations.integration.test.ts` ("somente confirma entrada no estoque ao
concluir") continua valendo, porque a entrada segue em "Concluir entrada";
mudam de propósito as travas da guarda em posição cadastrada (guarda por
caixa), `callables-papeis` e `callables-auth` (uma linha por callable nova),
`inbound-notice`, `warehouse-boxes` e `opening-inventory-conference` (o motor
é compartilhado: mexer em `warehouse-boxes.ts` exige as duas suítes), a
régua `billing-callables` (sem mudança esperada: prova de que a fatura não
mudou), `customer-isolation` (cliente da caixa vem da chegada) e, no app,
`receber.test.tsx`, `warehouse-labels.test.ts` e `warehouse-map.test.ts`.

## 5. Partes, em ordem

Um problema por PR, com teste que falha antes e passa depois, e tela
desenhada e aprovada antes do PR de tela.

1. **Mockup** da ficha da chegada por caixa (computador e celular), no canvas
   v3, com os textos finais (sem legenda; rótulos, dados e ações): iniciar
   caixa, linhas da NF dentro da caixa, fechar com medidas, onde guardar,
   confirmar destino, etiqueta, a fila com "2 de 3 caixas guardadas".
2. **Liberação e modo da chegada:** `RECEBIMENTO_POR_CAIXA_AMBIENTES`,
   `conference_mode` na chegada, o desligamento descrito; a tela ainda cria
   por linha.
3. **Domínio: a caixa do recebimento**, em módulo próprio
   (`functions/wms/src/domain/inbound-boxes.ts`), sem parametrizar a contagem
   de abertura nem crescer `operations.ts`: iniciar, lançar linha, fechar,
   confirmar destino com reserva, recusar; cliente da chegada; conteúdo
   embutido; eventos. Testes de integração: cabe e não cabe, mesmo produto,
   recusa, repetir a mesma chave, outro cliente, zona cheia, congelamento.
4. **Concluir entrada e guarda por caixa:** barreira por linhas cobertas e
   caixas confirmadas, `ENTRADA` como hoje, uma guarda por caixa com destino,
   a guarda que move todas as linhas da caixa e fecha a caixa `stored`, a
   chegada em aberto até a última guarda, API inalterada
   (`api.integration.test.ts`), o Agent Dute com os status novos.
5. **Ficha da chegada por caixa (tela)** e a fila do Receber; "Físico"
   derivado; divergência automática. Testes de textos e `axe`.
6. **Etiquetas:** caixa `committing` com destino, origem "Recebimento", o
   conteúdo da caixa do recebimento na etiqueta e no Mapa, "Etiquetas da
   chegada", reimpressão com evento.
7. **Só prateleira para o cliente:** "Disponível" e "Em recebimento" no
   portal e a reserva do pedido só de prateleira (decisão 10), em PR próprio,
   antes ou junto da parte 4; testes da alocação e do portal.
8. **Aviso ao cliente de produto novo:** modelo na lista de avisos da
   Operação, disparado pela última guarda da chegada; e-mail em HTML com a
   identidade da Dutelog (molde dos e-mails de convite e confirmação, que
   passa a valer para todos os avisos) e sino. Teste de integração como os
   dos outros modelos (`avisos.integration.test.ts`) e teste do modelo HTML.
9. **Encaixotar o que já está na prateleira sem caixa**, correção pontual,
   feita uma vez (decisão 9): pelo painel da prateleira com saldo sem caixa,
   para owner, admin e coordenação, com medidas, motivo e etiqueta; a ação
   some quando esse saldo acaba.
10. **Volumes na portaria** (declarados e recebidos) e o aviso de diferença.
11. **Confirmação por leitura** (bipar caixa e posição) e, depois, ZPL para a
    Zebra, como já previsto na fase 1 e 2 do mapa. Até lá, a confirmação é
    por toque.

Manual, treinamento e a seção 5.3 do desenho do mapa são atualizados junto
com cada parte. Uma alternativa barata, que o código já comporta, é gravar o
destino sugerido pelo motor na linha da chegada e manter a guarda por linha;
não resolve caixa, etiqueta nem Mapa, e por isso não entra como etapa.

## 6. Decisões do Leonardo (01/11/2026) e o que ainda falta decidir

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Caixa obrigatória em toda chegada? | Sim, no modelo de uniformes; mobiliário e insumos decidem no modelo de operação de cada um. |
| 2 | A caixa do fornecedor fica como chegou ou a equipe reembala em caixa padrão? | Fica como chegou do fornecedor; a equipe mede a caixa dele. Tamanhos padrão (P2) não são pré-requisito. |
| 3 | Vários tamanhos na mesma caixa? | Sim; os fornecedores entregam mais de um tamanho na mesma caixa. |
| 4 | Como a NF entra? | Digitada na chegada avulsa e pela leitura da nota com revisão; XML depois. |
| 5 | Concluir entrada só com tudo guardado? | Sim: a chegada não se conclui com caixa por guardar. |
| 6 | Impressora no recebimento? | Sim: a etiqueta sai antes de levar a caixa à prateleira; impressora comum agora, Zebra depois. |
| 7 | Portal do cliente mostra as caixas? | Não. O cliente só é avisado de que chegou produto novo, com a descrição dos itens, por e-mail e no sino. Ajuste do mesmo dia: o aviso sai quando a chegada termina de ser guardada, que é quando as peças ficam disponíveis para pedido; sem caixa nem posição. |
| 8 | Devolução e cancelamento de pedido em caixa? | Não; continuam na guarda por linha. |
| 9 | O que já está na prateleira sem caixa (as 71 peças de B-02 e o que mais entrou pelo Receber antes)? | Encaixotar, uma vez: é correção pontual, porque o procedimento não existia; não vira caminho permanente. |
| 10 | O cliente pode pedir o que está na área de recebimento? | Não. Para o cliente só existe o que está na prateleira: "Disponível" só de prateleira, "Em recebimento" separado e sem pedido, reserva só de prateleira. |
| 11 | A conferência por caixa é no computador ou no celular? | No computador da bancada; o celular fica para a guarda. |
| 12 | Quem informa o custo do produto? | A operação, na chegada, com o custo unitário da NF, como hoje. |
| 13 | E-mail do aviso em texto ou HTML? | HTML com a identidade da Dutelog, no molde dos e-mails de convite e confirmação. |

Os mockups das telas que mudam (chegada avulsa, ficha da chegada por caixa,
fechar caixa e onde guardar, fila do Receber, guarda da caixa no computador e
no celular, etiqueta, painel do Mapa, portal, e-mail e a correção pontual)
foram enviados ao Leonardo em 01/11/2026, na versão 2, para validação antes do
primeiro PR de tela; depois de validados, entram em `docs/mockups`.

## 7. Riscos técnicos e como o desenho os trata

- **Dupla fonte de verdade caixa × saldo.** A saída não baixa caixa. O
  desenho limita o que a caixa afirma (conteúdo de entrada) e não cria
  conciliação nova; a conciliação diária e a regra 8 ficam na fase 2 do mapa.
- **Cobrança.** A `ENTRADA` continua em "Concluir entrada", uma por linha,
  `wms_receiving`, numa data só por NF; a guarda da caixa é `wms_putaway`.
  Sem isso uma NF se repartiria entre meses ou cobraria duas vezes. A régua
  `billing-callables` tem de continuar verde sem mudança.
- **API v1.** Modo por linha para integrações e o documento da chegada
  intocado durante a conferência por caixa; esquemas e `avancar` como estão.
- **Concorrência.** Guarda por caixa lê só a prateleira de destino; o
  contador `CX` continua único (volume do galpão comporta); a
  `occupancy_revision` segue serializando guardas na mesma prateleira.
- **Zeragem.** Caixas e contador `CX` somem com a zeragem, como hoje;
  etiquetas físicas antigas não podem sobrar no galpão depois de uma zeragem.
- **Abertura e recebimento na mesma prateleira.** A caixa da abertura recusa
  prateleira onde o SKU tem saldo que não veio da sessão. Regra: a abertura
  do cliente está concluída antes da primeira chegada por caixa; sessão
  reaberta para correção convive com saldo recebido só nas prateleiras sem
  caixa da abertura.
- **Zona cheia ou sem zona** não trava a NF, só a guarda; quem amplia a zona
  é owner, admin ou coordenação, em Posições.
- **Liberação.** Nada do recebimento por caixa chega à produção sem a chave
  ligada no `dute-prod`, e o desligamento devolve a tela ao modo por linha.
- **Etiqueta e leitura não são controle** até o ZPL e o leitor: o saldo não
  depende da impressão.
- **Permissões.** As mesmas da caixa de hoje (owner, admin, coordenação e
  operação escrevem; suporte consulta; o cliente não lê).

## 8. O que não muda

O ledger `stock_balances` por cliente, SKU e posição; a área `RECEBIMENTO`
como passagem; os movimentos e a fatura; as invariantes (escrita crítica por
Function, evento em `events`, IA só recomenda, `customer_code` como
fronteira, permissão em Rules e backend); a contagem de abertura e a cíclica;
a API REST v1; devolução e cancelamento.
