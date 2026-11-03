# Recebimento com caixas: avaliação do fluxo e desenho da fase 1 do mapa

**Situação:** desenho aprovado, em construção por partes. As treze perguntas
foram decididas pelo Leonardo em 01/11/2026 (seção 6), o texto foi revisado no
mesmo dia com o levantamento do código (seções 2.5, 4 e 7) e as telas foram
aprovadas (parte 1, em `docs/mockups`). As partes 2 (liberação e modo da
chegada) e 3 (a caixa do recebimento) estão feitas, e a regra da parte 7 (só
prateleira para o cliente) está no servidor, sem liberação por ambiente; a
tela continua criando por linha até a parte 5. Motivo: em 30/10/2026 a equipe recebeu
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
- **O WMS não tinha chave de liberação por funcionalidade** antes da parte 2
  (`lib/liberacao.ts` era da plataforma; a seção 4.1 cria a do recebimento por
  caixa): o que entra na `main` vai à homologação em cada push e à produção no
  próximo disparo manual, junto com qualquer correção do WMS.
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

A funcionalidade entra atrás de uma liberação própria do WMS, primeiro só o
`dute-homolog` e, desde 03/11/2026, com o OK do Leonardo, também o
`dute-prod` (o `dute-btg` fica de fora); vale no próximo disparo manual da
produção: `RECEBIMENTO_POR_CAIXA_AMBIENTES_LIBERADOS` no app
(`lib/liberacao.ts`) e a cópia `RECEBIMENTO_POR_CAIXA_PROJECTS` nas Functions
(`domain/inbound-mode.ts`), travadas iguais pelo `platform-lists.test.ts`. A
liberação rege só a criação: desligada, a callable recusa a chegada nova por
caixa e a tela volta a criar por linha; as chegadas por caixa já abertas
seguem por caixa até o fim, porque quem as trata lê o modo gravado
(`conference_mode`), nunca a liberação. O modelo que confere por caixa também
é código: `inboundConference` em cada modelo do app e a cópia
`TEMPLATES_WITH_BOX_RECEIVING` em `customer-profile.ts`, travadas pelo
`operations.test.ts`.

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
marcada como falta) e toda caixa fechada; a caixa sem destino não trava a
entrada e ganha o destino na guarda (decisão 14). Faz o que
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
reservando a nova e a etiqueta é reimpressa. É o único jeito de trocar o
destino confirmado: a bancada não libera o destino (decisão 15).

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
- Eventos da conferência por caixa (parte 3), todos `info` e fora da caixa
  de entrada do agente, com nomes que não viram rascunho de aviso ao
  cliente: `warehouse.box_started`, `warehouse.box_line_saved` e
  `warehouse.box_line_removed` (um por lançamento, como os
  `inventory.opening_draft_*` da abertura), `warehouse.box_closed`,
  `warehouse.box_reopened`, `warehouse.box_destination_confirmed`,
  `warehouse.position_refused` e `warehouse.box_removed`. Na guarda e na
  entrada (parte 4), os que já existem (`warehouse.box_stored`,
  `putaway.completed`, `inventory.received`); na etiqueta (parte 6),
  "etiqueta reimpressa".
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

1. **Mockup** das telas que mudam, com os textos finais (sem legenda;
   rótulos, dados e ações). Feito: a versão 2 foi aprovada pelo Leonardo em
   01/11/2026 e as onze fontes estão em `docs/mockups` (a lista e o que cada
   tela muda estão no `README.md` da pasta).
2. **Liberação e modo da chegada:** feita em 01/11/2026. A chegada grava
   `conference_mode` (`per_line` ou `per_box`) no documento, no evento
   `inbound.created` e no resultado; sem o campo, por linha, e a chegada
   anterior ao campo vale por linha. A callable `createInboundReceipt` aceita
   o campo e passa `boxReceivingEnabled(PROJECT_ID)` ao domínio; por caixa
   exige a liberação e o modelo que confere por caixa (o do cadastro ativo;
   sem ele, o do arquivado; sem cadastro nenhum, o padrão), conferidos na
   transação depois da repetição da mesma chave, então repetir a chave
   devolve a chegada gravada mesmo com a liberação desligada. A API REST v1
   (corpo `.strict()`, sem o campo), o aviso do portal e o Documentos criam
   por linha. A conferência e a entrada por linha recusam a chegada por
   caixa, pelo modo gravado. A tela ainda cria por linha: a constante
   `RECEBIMENTO_POR_CAIXA_LIBERADO` do app entra em uso na parte 5. Até as
   partes 3 e 4, nenhuma tela cria chegada por caixa, e a que nascer por
   chamada direta na homologação fica esperando as caixas. Testes:
   `inbound-mode.test.ts` e `inbound-mode.integration.test.ts` no WMS,
   `api/module.test.ts` e `api/module.integration.test.ts` na API, e
   `liberacao.test.ts`, `platform-lists.test.ts` e `operations.test.ts` no
   app. Desligar é tirar o ambiente das duas listas no mesmo PR. Ligada no
   `dute-prod` em 03/11/2026, com o OK do Leonardo, depois da parte 5g; vale
   no próximo disparo manual da produção. Antes da primeira chegada por caixa
   de um cliente, a abertura dele precisa estar concluída (seção 7). O que já
   foi guardado por linha continua sem caixa até a parte 9.
3. **Domínio: a caixa do recebimento**, em módulo próprio
   (`functions/wms/src/domain/inbound-boxes.ts`), sem parametrizar a contagem
   de abertura nem crescer `operations.ts`: iniciar, lançar linha, fechar,
   confirmar destino com reserva, recusar; cliente da chegada; conteúdo
   embutido; eventos. Testes de integração: cabe e não cabe, mesmo produto,
   recusa, repetir a mesma chave, outro cliente, zona cheia, congelamento.
   Feita em 01/11/2026, com as callables (a tela da parte 5 só chama):
   `startInboundBox`, `saveInboundBoxLine` (0 tira o produto),
   `setInboundBoxState` (fechar com medidas e peso, ou reabrir),
   `suggestInboundBoxPosition` (só lê), `refuseInboundBoxPosition`,
   `confirmInboundBoxDestination` (reserva com a caixa em `committing`,
   `location_id` igual ao `destination_location_id`, e a
   `occupancy_revision` da prateleira) e `removeInboundBox` (antes do
   destino; as linhas voltam a faltar caixa). O cliente vem da chegada, e o
   código enviado só recusa a de outro cliente. A chegada é lida em toda
   escrita e nunca escrita; a linha da NF ganha `boxed_qty` e `box_codes`. A
   caixa guarda `lines[]` e os contadores de rascunho (`draft_line_count`,
   `draft_unit_count`); `line_count`, `unit_count` e `sku_codes` só sobem na
   guarda, como na abertura. O encaixe é o estrito do motor, sem a tolerância
   da abertura. "Mesmo produto" também vê a caixa do recebimento já
   reservada numa prateleira. Peso obrigatório no fechar. Fora da área de
   recebimento, a linha não entra em caixa. Testes:
   `inbound-boxes.test.ts`, `inbound-boxes.integration.test.ts` e sete
   linhas em `callables-papeis.integration.test.ts`; as suítes do motor e da
   abertura passam sem mudança.
3b. **Sobra e produto novo dentro da caixa** (passo 2 da seção 4.3): o
   produto que não está na NF entra como linha nova da chegada, marcada como
   sobra, na transação do lançamento, com o SKU gerado ou reativado e o
   custo da NF, como na chegada de hoje; a parte 4 recalcula as quantidades
   da chegada na conclusão. A parte 3 lança só as linhas da NF.
4. **Concluir entrada e guarda por caixa**, em PRs pequenos, nesta ordem
   (desenho e crítica de 02/11/2026, com as decisões 14 e 17 a 24):
   - **4a, as linhas da chegada por caixa:** feita em 02/11/2026. Toda
     linha passa pelo `RECEBIMENTO`, gravado sempre como "RECEBIMENTO",
     porque a entrada e a guarda da caixa acham o saldo pelo local exato;
     outro local é recusado na criação ("A linha 1 vai direto para A-02: na
     chegada por caixa, toda linha passa pela área de recebimento.",
     `boxReceiptLineLocation` em `inbound-mode.ts`). A chegada por linha
     guarda o local como veio. Testes: `inbound-mode.test.ts` e
     `inbound-mode.integration.test.ts`.
   - **4b, a guarda genérica:** feita em 02/11/2026. A tarefa de guarda
     com `box_code` não anda pelo avanço genérico, com ou sem destino ("A
     guarda da caixa CX-… é feita pela guarda da caixa: a prateleira e o
     conteúdo vêm dela.", `assertLinePutaway`), e a guarda por linha move no
     máximo a quantidade da tarefa ("A tarefa guarda no máximo 10 un. de
     …", `putawayQuantityWithinTask`, decisão 23); o "+" do painel de guarda
     para na quantidade da tarefa. A tarefa sem quantidade gravada não tem
     teto, e a guarda parcial continua valendo. Testes:
     `inbound-mode.test.ts`, `inbound-mode.integration.test.ts` e
     `task-detail.test.tsx`.
   - **4c, marcar falta:** feita em 02/11/2026. A callable
     `markInboundBoxShortage` (papel do armazém, decisão 17) marca a falta
     numa linha da NF da chegada por caixa, a conferir ou em conferência,
     com o motivo (falta ou avaria) e um detalhe opcional, ou a desmarca.
     Grava só `inbound_items.shortage` (`qty`, `boxed_qty`, `expected_qty`,
     `reason`, `detail`, `marked_at`, `marked_by`), nunca a chegada, com os
     eventos `warehouse.line_shortage_marked` e
     `warehouse.line_shortage_cleared` (info, fora da caixa do agente).
     Recusa a linha já coberta e a tela velha (`expected_boxed_qty`
     diferente do que está nas caixas). A marca vale para o que estava nas
     caixas quando foi feita: a linha que depois passa a ser coberta, ou
     muda, deixa a marca sem valor (a 4d confere). Testes:
     `inbound-boxes.integration.test.ts`, `inbound-boxes.test.ts` e uma
     linha em `callables-papeis.integration.test.ts`.
   - **4d, concluir a entrada:** feita em 02/11/2026. Porta própria, a
     callable `completeInboundBoxReceipt` (papel do armazém), que chama o
     ramo da entrada de `advanceWarehouseTaskTransaction` com a opção
     `boxEntry`; a porta genérica e a API seguem recusando a chegada por
     caixa ("a entrada é concluída pelas caixas, na ficha da chegada"). As
     regras ficam no módulo puro `inbound-box-entry.ts`
     (`entradaPorCaixa`): a chegada vai de `created` ou `checking` direto a
     `received`; nenhuma caixa vazia ou em conferência (decisão 18, a recusa
     nomeia a caixa); ao menos uma caixa (decisão 19); a quantidade de cada
     linha é a soma das caixas, conferida com `boxed_qty` e `box_codes`; a
     linha a menos precisa da falta marcada para essa quantidade (parte 4c);
     a divergência pede a justificativa, com a frase da entrada por linha. A
     transação lê as caixas da chegada e o contador `CX`, que o "Iniciar
     caixa" grava, para a caixa iniciada no mesmo instante derrubar uma das
     duas. A `ENTRADA` sai como hoje: uma por linha da NF, `wms_receiving`,
     no `RECEBIMENTO`, numa data só, com o portal em "em recebimento"; a
     linha grava `received_qty`, `difference_qty` e `conference_status`, e a
     marca de falta da linha coberta sai. Nasce uma guarda por caixa
     (`boxPutawayTaskId`, sem `sku_code`, com `box_code`, as linhas e os
     SKUs), com o destino da caixa reservada ou sem destino na caixa fechada
     sem prateleira (decisão 14), e a caixa sem prateleira avisa a
     coordenação (`warehouse.boxes_without_shelf`, atenção). A chegada fica
     `received` com `box_count`, `box_codes`, `boxes_stored` 0 e
     `putaway_status` `pending`, em aberto até a última guarda; o aviso de
     envio vinculado e o rascunho "Estoque atualizado" não saem na
     conclusão (os eventos levam `client_notice: after_putaway`, decisão
     20), e o aviso vinculado aprovado nessa janela segue em recebimento: a
     aprovação só conta a chegada por caixa como recebida depois da última
     guarda. Testes: `inbound-box-entry.test.ts`,
     `inbound-boxes.integration.test.ts` e uma linha em
     `callables-papeis.integration.test.ts`.
   - **4f, a guarda da caixa:** feita em 02/11/2026. A callable
     `storeInboundBox` (papel do armazém), numa transação: a chegada
     `received` com a caixa nela, a caixa `committing` com a revisão, a
     tarefa da caixa aberta e a prateleira pedida igual à reservada ("guarde
     lá ou use \"Não cabe aqui\""), conferida pelo documento dela (apagada,
     bloqueada ou de outra zona recusa e manda para o "Não cabe aqui"). Para
     cada SKU da caixa, o `RECEBIMENTO` precisa ter o livre do conteúdo: sem
     guarda parcial, a recusa diz o produto, quanto há e quanto a caixa tem,
     e a coordenação acerta o saldo (decisão 24). Move com o par SAIDA/ENTRADA
     `wms_putaway` da guarda por linha (não cobra), no mesmo saldo da
     prateleira, regrava o disponível e o em recebimento do portal, põe a
     caixa em `stored` (`stored_at`, `line_count`, `unit_count`,
     `sku_codes`), sobe a revisão da prateleira, conclui a tarefa e soma
     `boxes_stored` na chegada. Na última guarda, `putaway_status`
     `completed`, o evento `inventory.arrival_stored` (com `payload.id` e os
     itens com as quantidades, sem valor, caixa nem posição; dele sai o
     aviso de produto novo da parte 8 e o rascunho "Estoque atualizado") e o
     aviso de envio vinculado vira recebido no portal (decisão 20). Testes:
     `inbound-boxes.integration.test.ts` (guarda, recusas sem efeito, a
     corrida das duas últimas guardas e a paridade com a guarda por linha) e
     um caso novo na régua `billing-callables.integration.test.ts`, com a
     conclusão e a guarda de verdade: a entrada cobra as peças uma vez, na
     competência da conclusão, e a guarda não cobra.
   - **4g, o destino depois da conclusão:** feita em 02/11/2026. Com a
     chegada `received`, a caixa fechada sem prateleira ganha o destino pelas
     mesmas callables da bancada (sugerir, recusar a sugestão, confirmar),
     desde que a guarda dela esteja aberta; o confirmar grava também o
     destino na tarefa, e o evento leva `phase: putaway`. Iniciar, lançar,
     fechar ou reabrir e remover seguem só com a chegada a conferir ou em
     conferência (`RECEIPT_NOT_OPEN`), para a caixa não se descolar da
     ENTRADA já gravada. Testes: `inbound-boxes.test.ts` e
     `inbound-boxes.integration.test.ts`.
   - **4h, "Não cabe aqui" na prateleira:** feita em 02/11/2026. A callable
     `refuseInboundBoxShelf` (papel do armazém), o único jeito de trocar o
     destino confirmado (decisão 15): só na guarda, com a chegada `received`
     e a guarda da caixa aberta; na bancada recusa
     (`BOX_DESTINATION_LOCKED`). A prateleira reservada entra nas recusas da
     caixa, a reserva sai (a caixa volta a fechada e sem prateleira, e a
     tarefa fica sem destino), a revisão da prateleira sobe se ela ainda
     existe, e a coordenação é avisada com o evento de atenção
     `warehouse.box_shelf_refused` (decisão 21). O novo destino é pelo
     sugerir e confirmar da 4g. Testes: `inbound-boxes.integration.test.ts`
     (inclusive a prateleira apagada) e uma linha em
     `callables-papeis.integration.test.ts`.
   - **4i, o Agent Dute:** feita em 02/11/2026, nas duas cópias
     (`agent-team.ts` no WMS e `agente-armazenagem.ts` no núcleo, mudadas
     juntas). A chegada por caixa `received` com `putaway_status` `pending`
     segue entre os recebimentos abertos, como "recebida, guardando caixas",
     com `caixas` e `caixas_guardadas`; a guarda da caixa mostra a caixa, o
     conteúdo (produto e peças, sem custo) e "sem prateleira" quando não tem
     destino. As descrições das ferramentas dizem isso. Testes:
     `agent-team.integration.test.ts` e `agente-armazenagem.test.ts`.

   A 4d, a 4f e a 4g sobem uma logo depois da outra: entre elas, a chegada
   por caixa concluída na homologação fica sem guarda. A primeira chegada por
   caixa de um cliente espera a abertura dele terminar, por procedimento
   (decisão 22). A tela da parte 5 lê o que a parte 4 grava; o mockup de
   01/11 desabilitava "Concluir entrada" com caixa sem destino, o que a
   decisão 14 mudou, e foi atualizado em 03/11/2026 (parte 5, abaixo).
5. **Ficha da chegada por caixa (tela)**, a fila do Receber e a guarda da
   caixa no computador e no celular; "Físico" derivado; divergência
   automática. Testes de textos e `axe`. A guarda da caixa não estava em
   nenhuma parte e entra aqui, por decisão do Leonardo em 03/11/2026: sem
   ela, a caixa não chega à prateleira. Os mockups foram atualizados com as
   decisões 14, 15, 17, 21 e 24 e aprovados pelo Leonardo em 03/11/2026
   (`docs/mockups/README.md`, seção do recebimento com caixas): a ficha e a
   fila mudam, e seis telas novas mostram marcar a falta, a caixa sem
   prateleira livre na bancada, a ficha pronta para concluir, a guarda sem
   prateleira (no computador e no celular) e o "Não cabe aqui" na guarda.
   Em PRs pequenos, nesta ordem:
   - **5a, os dados e as regras no app:** feita em 03/11/2026. O Receber
     (`getWarehouseOps`, em `lib/cloud-api.ts`) passa a trazer da chegada o
     modo (`conference_mode`), o número, a NF, `box_count`, `boxes_stored`,
     `putaway_status` e, da chegada por caixa aberta, as caixas dela
     (`warehouse_boxes` pelo `receipt_id` que a caixa grava no topo, só
     dessas chegadas); a linha da NF traz `line_number`, `boxed_qty`,
     `box_codes` e a falta marcada; a guarda traz `box_code`, a chegada e o
     conteúdo da caixa. `lib/wms/caixas-do-recebimento.ts` tem as chamadas
     às callables da caixa e as regras que a tela mostra antes de chamar,
     espelhadas de `entradaPorCaixa`: a situação de cada linha (OK, faltam,
     sobram, falta marcada, marca velha), o que impede concluir, na ordem do
     servidor (nenhuma caixa, a caixa vazia ou em conferência, a linha sem
     falta marcada; a caixa sem prateleira não impede), quando a conclusão
     pede a justificativa e o selo da caixa. Nada muda na tela. Testes:
     `caixas-do-recebimento.test.ts` e um caso novo em
     `cloud-api-warehouse.test.ts`.
   - **5b, a bancada:** feita em 03/11/2026. No Receber, a chegada por caixa
     abre a ficha dela (`features/warehouse-ops/chegada-por-caixa.tsx`), no
     lugar da conferência por linha: as caixas da chegada com o selo de cada
     uma, "Iniciar caixa", a caixa em conferência com o código lido (código
     do cliente, SKU ou código de barras da linha da NF; o lido soma uma
     peça) e a quantidade de cada linha (0 tira o produto), "Fechar caixa"
     com as medidas em centímetros, o peso em quilos e se pode virar ou
     empilhar, "Reabrir para ajustar" e "Remover caixa" na caixa sem
     destino, e as linhas da NF com o que está nas caixas e a situação de
     cada uma. Fechar e a caixa fechada abrem a vista da caixa (mockup
     `WmsRecebimentoFecharCaixa`), com "Voltar à chegada", que os mockups
     não desenharam; fechar de novo a caixa reaberta começa pelas medidas
     dela. A partir de 1280 px a ficha fica larga e a fila, estreita, como
     nos mockups; abaixo disso, a ficha tem a largura de hoje e as caixas
     vêm antes das linhas da NF. Quem só consulta (o suporte) vê as caixas e
     as linhas, sem as ações. Cada escrita manda a revisão que a anterior
     devolveu, sem esperar a releitura da fila. A busca só acha a linha da NF (a sobra e o
     produto fora da NF são a parte 3b). Testes: `chegada-por-caixa.test.tsx`
     (textos e `axe`) e `chegada-por-caixa.interacao.test.tsx`.
   - **5c, o destino na bancada:** feita em 03/11/2026. A vista da caixa
     fechada ganha o "Guardar em" (`features/warehouse-ops/destino-da-caixa.tsx`,
     mockups `WmsRecebimentoFecharCaixa` e `WmsRecebimentoSemPrateleira`):
     a prateleira que o motor sugere, com o motivo dele, como a caixa fica,
     o nível e as alternativas; "Escolher prateleira", na lista das
     prateleiras ativas da zona do cliente sem as já recusadas para a caixa,
     com a prévia do encaixe; "Confirmar destino em …", que manda o encaixe
     e a sugestão do motor mesmo quando a pessoa escolheu outra; e "Não cabe
     aqui", com o motivo e "Recusar …" (o diálogo segue o da guarda, mockup
     `WmsGuardaNaoCabe`), que tira a prateleira da escolha da caixa e traz
     outra sugestão. Sem prateleira livre na zona, a caixa fica "fechada ·
     sem prateleira", com a frase do servidor (decisão 14). Confirmado, a
     ficha volta à chegada; fechar a caixa espera a releitura da fila e
     passa direto ao destino. Testes: `destino-da-caixa.test.tsx` (textos e
     `axe`) e casos novos em `chegada-por-caixa.interacao.test.tsx`.
   - **5d, as linhas da NF:** feita em 03/11/2026 (mockups
     `WmsRecebimentoFalta`, `WmsRecebimentoCaixa` e `WmsRecebimentoConcluir`).
     A linha a menos ganha "Marcar falta" (`falta-da-linha.tsx`): o que a NF
     pede, o que está nas caixas e a falta, o motivo (falta ou avaria) e o
     detalhe, e a marca vai com o que a tela viu nas caixas. A linha com a
     falta marcada mostra o motivo e o detalhe e ganha "Desmarcar"; a marca
     velha volta a pedir a marca. Os totais contam linha a linha (a sobra de
     uma linha não cobre a falta de outra) e mostram a "Falta marcada" à
     parte do "Sem caixa". "Concluir entrada" chama a porta da chegada por
     caixa com o status que a tela viu e, desligado, diz o que falta na
     frase do servidor ("CX-000132 em conferência · linha 1 sem falta
     marcada"); com as caixas e as linhas tratadas e falta ou sobra, entra a
     "Justificativa da divergência", e só ela impede. Quem só consulta não
     vê essas ações. Testes: `falta-da-linha.test.tsx`, casos novos em
     `chegada-por-caixa.test.tsx`, `chegada-por-caixa.interacao.test.tsx` e
     `caixas-do-recebimento.test.ts`.
   - **5e, a fila:** feita em 03/11/2026 (mockup `WmsReceberFila`). A
     chegada por caixa recebida com caixa por guardar sai de Recebidos e fica
     em aberto, em "Recebidas, por guardar", com "0 de 2 caixas guardadas" e
     o apoio "Avulsa · recebida · NF … · 59 un. · falta marcada 12 un. ·
     entrada concluída …"; guardada a última caixa, vai a Recebidos. A
     chegada a conferir diz "por caixa", a NF e as caixas, e a com caixa
     iniciada fica "em conferência" (na fila e na ficha), embora o servidor
     só mude a chegada na conclusão. A guarda da caixa tem o destino no
     título ("Guardar caixa CX-000131 em B-02") ou o selo "sem prateleira"
     (o local igual à origem não é destino), e o conteúdo com o nome em
     comum ("POLO MASCULINO PIQUET PRETO XG 29 · GG 12 · 41 un."); a guarda
     aberta no Estoque diz "aberta no Estoque". O `cloud-api.ts` passa a
     data da entrada concluída da chegada por caixa e a origem da tarefa.
     Testes: `receiving.test.ts`, `queue-list.test.tsx`, `receber.test.tsx`
     e um caso novo em `cloud-api-warehouse.test.ts`.
   - **5f, a guarda da caixa:** feita em 03/11/2026 (mockups
     `WmsGuardaCaixa`, `WmsGuardaCaixaCelular`, `WmsGuardaCaixaSemPrateleira`,
     `WmsGuardaCaixaCelularSemPrateleira` e `WmsGuardaNaoCabe`). A guarda da
     caixa abre a ficha dela (`features/warehouse-ops/guarda-da-caixa.tsx`),
     não o avanço por linha, que o servidor recusa. Com o destino, "Destino"
     com a prateleira e o endereço do cadastro ("Rua B · prateleira 02 · zona
     …"), o conteúdo, as medidas, "Concluir guarda em …" (`storeInboundBox`,
     com a revisão da caixa e a prateleira reservada) e "Não cabe aqui", que
     pede o motivo e solta a reserva ("Liberar …", `refuseInboundBoxShelf`);
     a caixa volta à guarda sem prateleira. Sem prateleira, o selo e o mesmo
     "Guardar em" da bancada (a sugestão, escolher, confirmar e recusar, num
     hook só, `useDestinoDaCaixa`), com "Concluir guarda" desligado até o
     destino. A recusa do servidor ao guardar (o `RECEBIMENTO` curto,
     decisão 24) fica na própria guarda. Guardada, a ficha mostra onde a
     caixa ficou, sem ações; quem só consulta não vê as ações. No celular é a
     mesma ficha, no painel de baixo do Receber. O `cloud-api.ts` passa a
     caixa da guarda (lida pela chegada da guarda) e a NF. A linha do tempo
     do mockup (caixa fechada, destino confirmado, etiqueta impressa) fica
     para a parte 6, que traz a etiqueta. Testes: `guarda-da-caixa.test.tsx`
     (textos e `axe`), `guarda-da-caixa.interacao.test.tsx`, um caso em
     `receber.test.tsx` e asserções novas em `cloud-api-warehouse.test.ts`.
   - **5g, a chegada avulsa por caixa:** feita em 03/11/2026 (mockup
     `WmsChegadaAvulsa`, decisão 1). A parte 2 deixou a tela criando por
     linha até aqui; a 5g fecha a parte 5 por último, para a homologação só
     criar chegada por caixa com a bancada, o destino, a conclusão, a fila e
     a guarda já na `main`. Onde a liberação vale
     (`RECEBIMENTO_POR_CAIXA_LIBERADO`) e o modelo do cliente ativo confere
     por caixa, o diálogo mostra o selo "Conferência por caixa", tira o
     "Local" da linha (toda linha entra no `RECEBIMENTO`, parte 4a) e manda
     `conference_mode: per_box`; o servidor confere os dois de novo. Os
     volumes da NF (parte 10) e a leitura da nota ficam de fora. Testes:
     `caixas-do-recebimento.test.ts` (`modoDaChegadaAvulsa`) e
     `receber.test.tsx`.
6. **Etiquetas:** caixa `committing` com destino, origem "Recebimento", o
   conteúdo da caixa do recebimento na etiqueta e no Mapa, "Etiquetas da
   chegada", reimpressão com evento.
7. **Só prateleira para o cliente** (decisão 10), sem liberação por ambiente:
   o Leonardo decidiu em 02/11/2026 que vale já para a produção, no próximo
   disparo manual dele. Em quatro PRs:
   - **7a e 7b, a regra no servidor:** feita em 02/11/2026. A reserva do
     pedido, na criação pelo portal e na aprovação da solicitação que chegou
     sem reserva, só cai em saldo de prateleira: os locais `RECEBIMENTO` e
     `EXPEDICAO`, sem diferenciar maiúscula nem acento (a regra mora em
     `lib/dominio/src/areas-de-passagem.ts`, com a cópia literal do WMS em
     `functions/wms/src/domain/areas-de-passagem.ts` travada por teste e os
     casos em `areas-de-passagem.casos.json`), ficam de fora; o
     "Disponível" da recusa por saldo insuficiente conta só a prateleira; e o
     item que pede o local de uma área é recusado ("O local RECEBIMENTO não
     atende pedido: o pedido só reserva o que está na prateleira."). A
     reserva que já estava numa área continua valendo. O `client_inventory`
     grava `qty_available` com o livre das prateleiras e o campo novo
     `qty_receiving` com o livre do `RECEBIMENTO`, tirados dos saldos do SKU
     depois da escrita, em todas as escritas da projeção e na guarda, que até
     aqui não mexia no portal (a guarda grava só esses dois campos, e só na
     projeção que já existe). O total (`qty_on_hand`), a reserva
     (`qty_reserved`) e o valor da mercadoria ficam como estavam; a EXPEDICAO
     entra só no total; `DEVOLUCAO` e os demais locais contam como
     prateleira. O Agent Dute, que lê o disponível da projeção, passa a
     responder só com a prateleira, e a conferência de saldo da tela interna
     de aprovação (`customer-requests.tsx`, para a solicitação que chegou sem
     reserva) usa a mesma regra. Testes: `areas-de-passagem.test.ts` e
     `areas-de-passagem.integration.test.ts` no WMS, `areas-de-passagem.test.ts`
     e `customer-requests.test.ts` no app. O saldo que entra numa área sem
     tarefa de guarda (entrada manual ou contagem no `RECEBIMENTO`, devolução
     com o local de uma área) sai do disponível; o caminho de volta à
     prateleira é a ação "Guardar" no Estoque (decisão 16, parte 7e).
   - **7c, o recálculo:** feito em 02/11/2026. A projeção só se acerta
     quando o SKU tem uma escrita nova; a rotina `runPortalAvailability` (WMS,
     de 15 em 15 minutos, uma instância) refaz `qty_available` e
     `qty_receiving` de cada `client_inventory` pelos saldos, numa transação
     por projeção (`refreshClientInventorySplitTransaction`), sem mexer no
     total, na reserva nem no resto do documento, e não cria projeção. Com o
     estoque congelado (reconciliação ou zeragem), a rodada não grava nada,
     nem o controle (cada gravação dele confere o congelamento na mesma
     transação), e a seguinte continua de onde parou. Só conclui com uma
     passada sem nada a refazer que começou ao menos uma hora depois da
     primeira rodada (`ESPERA_MINIMA_MS`): durante a publicação, uma function
     de revisão antiga ainda grava o disponível de antes. A página fica
     marcada como aberta até a rodada gravar o fim dela, e a rodada que parou
     no meio de uma página não deixa a passada se dar por limpa. Concluído,
     grava o evento `warehouse.client_projection_recalculated` (sem cliente,
     fora da caixa do agente; um por recálculo), marca o controle
     `system_controls/client_inventory_split` como feito e daí em diante só
     lê esse controle. Subir `VERSAO_DO_RECALCULO` refaz tudo; para refazer
     sem mudar a conta (uma publicação do WMS que parou no meio, por exemplo),
     apague esse documento, e o novo recálculo grava o seu evento. Testes:
     `disponivel-do-portal.test.ts` e
     `disponivel-do-portal.integration.test.ts`.
   - **7d, o portal:** feita em 02/11/2026, na tela de hoje (decisões 25 a
     27, mockup `PortalEstoqueRecebimento`). O `cloud-api.ts` passa o
     `qty_receiving` da projeção ao Estoque do portal
     (`quantidadesDoPortal`), e a prévia interna, que lê os saldos por local,
     separa a área de passagem pela mesma regra; a projeção ainda sem o
     campo conta zero. A Lista ganha a coluna "Em recebimento", entre
     "Disponível" e "Reservado", com o número em destaque quando há peça
     chegando; o card mostra "24 em recebimento" só quando há ("neste
     tamanho" no card agrupado, que abre no tamanho chegando quando nenhum
     tem saldo, e o tamanho chegando diz "em recebimento", não "esgotado");
     o detalhe do produto ganha o "Em recebimento"; a linha do topo ganha "·
     24 em recebimento". O produto sem disponível e com peça chegando leva o
     selo "Em recebimento" no lugar de "Sem saldo", e a dica do Agent Dute
     não sugere reposição; os botões, o filtro "Sem saldo" e a contagem dele
     seguem o disponível, como antes. O destaque usa a cor de informação do
     sistema, e não o âmbar do mockup, para não se confundir com o "Baixo
     estoque". A "Última entrada" do mockup fica para depois (decisão 26).
     Testes: `estoque.test.tsx` (lista, card, card agrupado e detalhe, com
     a lista dos textos e o axe), `portal-stock.test.ts` e
     `cloud-api-portal.test.ts`.
   - **7e, a ação "Guardar" no Estoque (decisão 16):** feita em 02/11/2026,
     com o mockup `WmsEstoqueGuardar` aprovado no mesmo dia. A coordenação
     (owner, admin e interno) abre a guarda de um saldo parado numa área de
     passagem: a entrada manual ou a contagem no `RECEBIMENTO`, a devolução
     com o local de uma área, o resto de uma guarda feita a menos e o que já
     estava parado. As callables `previewAreaPutaway` (só lê) e
     `openAreaPutaway`, em `domain/area-putaway.ts`: o que dá para guardar é
     o livre do saldo naquele local menos o que as guardas abertas do SKU vão
     tirar dali (por linha, pela origem gravada, como a volta do pedido
     cancelado; por caixa, pelas linhas dela), em três casas, e a guarda
     nunca pede mais do que a origem tem de fato (o resto de ponto
     flutuante). A guarda nasce por linha, sem destino, com o motivo, numa
     transação idempotente, com o evento `warehouse.area_putaway_opened`
     (sem rascunho ao cliente nem item na caixa do agente), e segue a guarda
     de hoje. O cliente vem da tela, sempre. Na ficha do item (Estoque ›
     Itens), o "Onde está" mostra a área em âmbar e o "Guardar"; o diálogo
     mostra "Livre no RECEBIMENTO", "Em guardas abertas" e "Sem guarda". O
     "disponível" da ficha continua contando todos os locais, como o WMS por
     dentro. Testes: `area-putaway.test.ts` e
     `area-putaway.integration.test.ts` no WMS (da entrada manual à
     prateleira e ao portal), e `guardar-da-area.test.tsx`,
     `guardar-da-area.dialogo.test.tsx`, `guarda-da-area.test.ts` e
     `estoque.test.tsx` no app.
   - A API REST v1 recusava com 404 a retirada de um SKU com saldo fora de
     prateleira cadastrada (`stockLocations`, em `api/module.ts`); a correção
     entrou em 02/11/2026 (PR 533), e com esta parte a conferência dela também
     deixa de fora o saldo das áreas de passagem, como o alocador.

   Antes do disparo da produção com a 7a e a 7b: a 7c junto, para o portal
   não mostrar como disponível o que o pedido recusa (o recálculo começa
   sozinho na primeira rodada depois da publicação e conclui cerca de uma
   hora depois), e a conferência dos saldos parados no `RECEBIMENTO` e na
   `EXPEDICAO` (o que está ali só volta a atender pedido depois da guarda).
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
| 14 | Zona cheia na conclusão: a entrada se conclui com a caixa fechada e sem destino? (02/11/2026) | Sim: a caixa ganha o destino na guarda. A seção 4.4 deixa de pedir toda caixa com destino. |
| 15 | Trocar o destino depois de confirmado, antes de levar a caixa? (02/11/2026) | Só pelo "Não cabe aqui" na prateleira (parte 4); a bancada não libera o destino. |
| 16 | Saldo numa área sem guarda: a entrada manual e a contagem no `RECEBIMENTO`, a devolução com o local de uma área e o que já está parado nas áreas? (02/11/2026) | Uma ação "Guardar" no Estoque: a coordenação abre a guarda do saldo parado numa área, e a guarda segue a de hoje (parte 7e). |
| — | A parte 7 entra com liberação por ambiente? (02/11/2026) | Não: pode ir à produção; quem dispara a produção é o Leonardo, à mão. |
| 17 | Marcar falta na linha da NF da chegada por caixa: quem marca, e com que dado? (02/11/2026) | A operação, com o motivo (falta ou avaria); a justificativa da divergência continua na conclusão. |
| 18 | Caixa vazia ainda em conferência na hora de concluir a entrada? (02/11/2026) | A conclusão recusa e nomeia a caixa a remover. |
| 19 | NF sem nenhuma caixa, com toda linha marcada como falta? (02/11/2026) | A conclusão recusa; a chegada fica aberta até alguém tratar. |
| 20 | Aviso de envio do cliente vinculado: quando o portal o mostra como recebido? (02/11/2026) | Na última guarda, quando as peças ficam disponíveis para pedido. |
| 21 | O "Não cabe aqui" na prateleira avisa a coordenação? (02/11/2026) | Sim, com evento de atenção. |
| 22 | Travar a primeira chegada por caixa enquanto a abertura do cliente está aberta? (02/11/2026) | Não: é procedimento da coordenação. |
| 23 | Teto na guarda por linha? (02/11/2026) | Sim, na parte 4: a guarda por linha move no máximo a quantidade da tarefa. |
| 24 | Caixa com mais peças que o saldo do `RECEBIMENTO`? (02/11/2026) | A guarda recusa com o produto e quanto falta; a coordenação acerta o `RECEBIMENTO` (entrada manual, que não cobra) e a guarda segue. |
| 25 | Como o "Em recebimento" entra no Estoque do portal (parte 7d)? (02/11/2026) | Na tela de hoje: coluna na Lista, linha no card só quando há, o detalhe do produto e a linha do topo. |
| 26 | A "Última entrada" do mockup entra na parte 7d? (02/11/2026) | Não: fica para uma parte própria, com a gravação no WMS. |
| 27 | Produto sem disponível e com peça chegando: que selo? (02/11/2026) | "Em recebimento", no lugar de "Sem saldo", e a dica não sugere reposição; os botões continuam como hoje. |

Nada em aberto.

Os mockups das telas que mudam (chegada avulsa, ficha da chegada por caixa,
fechar caixa e onde guardar, fila do Receber, guarda da caixa no computador e
no celular, etiqueta, painel do Mapa, portal, e-mail e a correção pontual)
foram enviados ao Leonardo em 01/11/2026 em duas versões, e a versão 2 foi
aprovada no mesmo dia. As fontes estão em `docs/mockups` (`WmsChegadaAvulsa`,
`WmsRecebimentoCaixa`, `WmsRecebimentoFecharCaixa`, `WmsReceberFila`,
`WmsGuardaCaixa`, `WmsGuardaCaixaCelular`, `WmsEtiquetaCaixaRecebimento`,
`WmsMapaRecebimento`, `PortalEstoqueRecebimento`, `EmailProdutoNovo` e
`WmsEncaixotarSaldo`, todos `.dc.html`), com o que cada tela muda no
`README.md` da pasta.

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
