# Diagnóstico: a Contagem cíclica antes da recontagem das caixas da BTG

Levantamento de 17/11/2026 sobre a tela Estoque › Contagem, aba "Contagem
cíclica", do shell da Armazenagem, no código da `main` em `72899bcc` (PR 610)
mais os registros do acerto desta branch (`77f921f3`). Responde a duas
perguntas do Leonardo: **o inventário de abertura da BTG acabou de vez?** e
**o que a aba cíclica faz, o que não faz e onde a recontagem de todas as
caixas (CX-000xxx), que começa hoje, vai travar ou deixar o registro errado.**
Lista as oportunidades de melhoria em ordem, para decidir antes de começar.

Não muda código, dado nem configuração; a produção não foi lida. A ordem dos
PRs fica na seção 6 e as decisões que esperam o Leonardo, na seção 7. Como o
levantamento foi feito está na seção 8.

## 1. Resumo

A abertura da BTG acabou de vez, com três ressalvas (seção 2). A aba cíclica
faz bem o que foi desenhada para fazer: corrige o saldo de um SKU numa
prateleira, em transação, com recibo, movimento e evento, respeitando a
reserva e a separação em curso, fora da cobrança (F28 a F30). O que ela não
faz é o que a recontagem de hoje precisa, do mais grave ao mais cosmético:

1. **Não sabe de caixa (F01, F04, F05).** A recontagem é caixa a caixa, e a
   tela só aceita o total do SKU na prateleira; cada diferença gravada
   corrige o razão e deixa o registro da caixa errado (etiqueta, Mapa,
   sugestão da separação, caixa vazia que segue ocupando a prateleira); não
   há folha do que o sistema espera em cada caixa nem relatório caixas ×
   saldo. É o mesmo motivo pelo qual as cinco rodadas de correção de outubro
   e novembro foram gravadas por script.
2. **A peça fora do lugar não entra (F03).** "Saldo não encontrado… Cadastre
   o recebimento" manda ao Receber, que cobra e duplica; não existe
   transferência; o lançamento manual nasce com `ESTOQUE_BTG` como destino.
3. **Três armadilhas de uso em sequência.** O produto anterior continua
   casado pelo SKU interno e a próxima contagem pode ir para ele (F02); o
   endereço é texto livre comparado ao pé da letra (F08); o "Custo unitário",
   visível e editável para quem conta, reescreve o preço do SKU na base do
   ad valorem (F07).
4. **Sem controle da rodada (F06, F10, F14, F18, F23).** Quem conta ajusta
   direto, sem segunda contagem nem aprovação; nada lista o que foi contado;
   na produção o evento de atenção não cai em fila nenhuma; o portal da BTG
   muda na hora, sem aviso.
5. **Polimento.** Quantidade fracionada e sem teto, a hora do navegador, o
   FIFO do ajuste para mais, o motivo obrigatório sem divergência, as
   legendas de uma tela fora da v3, o celular (F11 a F13, F16, F24 a F27).

A recontagem pode começar hoje no papel, com a folha gerada só de leitura e
as regras de campo da seção 5.5. Onde gravar o que foi contado, pela tela ou
pelo plano do acerto, é a pergunta 1 da seção 7; o que muda no sistema, e em
que ordem, está na seção 6.

## 2. A pergunta da abertura

**Sim, com ressalvas: para a BTG a aba "Inventário de abertura" está
encerrada de fato e de direito.** A sessão de abertura é uma por cliente, com
id fixo (`opening_<cliente>`). Com a sessão `completed`:

- abrir outra sessão é recusado ("O inventário de abertura deste cliente já
  foi concluído.", `functions/wms/src/domain/operations.ts:1686-1693`, trava
  em `operations.integration.test.ts:1601-1610`);
- lançar no modo de abertura é recusado ("O inventário de abertura não está
  ativo.", `operations.ts:2149-2153`);
- "Corrigir caixa" e "Remover para corrigir" são recusados
  (`operations.ts:3076-3078` e `:3288-3292`);
- a conclusão da BTG gravou `stock_initialized: true` e
  `opening_inventory_required: false` em `system_controls/inventory`
  (`operations.ts:1888`) e liberou os pedidos do portal
  (`publishOutboundBlock(..., false)`, `:1901`);
- a Contagem abre direto na cíclica (`defaultCountMode`,
  `artifacts/app/src/lib/opening-inventory.ts:29-36`) e, na aba de abertura,
  mostra "Inventário de abertura encerrado · Novas entradas agora entram por
  Estoque › Receber." com os botões de escrita escondidos
  (`features/warehouse-ops/inventory.tsx:489` e `:1314-1321`);
- não existe "reabrir a abertura" por tela nem por callable; o único caminho
  que volta a flag é a zeragem total (`tools/full_reset_btg.py:1002-1003`),
  que apaga estoque, caixas, sessão e eventos.

Tudo que entra agora é recebimento (`createInboundReceipt`, por linha ou por
caixa) ou ajuste do que já existe; produto novo nasce no Receber ou no aviso
do portal, nunca mais na Contagem (`docs/manual-armazenagem.md:491`). A
decisão de 30/10 já tratava assim: "a sessão de abertura da BTG está
concluída, então as correções por caixa da Contagem não servem"
(`tools/acerto-btg-2026-10/README.md:11`).

As ressalvas:

1. **A aba continua visível e clicável, só de leitura** (as linhas da
   abertura e "Imprimir etiquetas"). Quem for recontar pode achar que corrige
   ali; toda correção vai para a aba cíclica, que não sabe de caixa (seção 3).
   A lista das linhas da abertura, com caixa e endereço, ajuda a comparar.
2. **A abertura continua existindo para outro cliente** que entre com
   estoque já no galpão: cada cliente tem a própria sessão e o próprio
   bloqueio de saída (`domain/customer-scope.ts:39-49`). Cliente que começa
   pelo Receber vem com `opening_required: false` e a Contagem já abre na
   cíclica.
3. **A premissa "tudo que entra e sai é do que já existe ou é recebimento"
   vale também para a devolução** (que volta sem caixa) **e para o
   cancelamento no meio da separação** (o separado vai à `EXPEDICAO`): os
   dois mexem no saldo sem passar por nenhuma das duas abas.

## 3. O que a aba cíclica faz hoje

### 3.1 A tela

`artifacts/app/src/features/warehouse-ops/inventory.tsx`, `CycleCountWorkspace`
(linhas 287 a 337, as duas abas) e `ExistingCycleCountWorkspace` (2385 a
2697, o formulário). A página é `pages/wms-inventory.tsx` (rota
`/wms/contagem`; "Ver itens" leva a `/estoque`). A tela não está em
`TELAS_DO_WMS_NA_V3` (`lib/wms-v3.ts:11-28`): segue o visual antigo.

- **Campos:** Cód. cliente, SKU interno, Produto, Endereço contado (texto
  livre, placeholder "Rua / prateleira / caixa"), Contagem física (número,
  `step="1"`), Custo unitário (opcional, pré-preenchido pelo catálogo em
  `applyProduct`, `:2506-2511`), Referência e Motivo do ajuste.
- **O produto:** o catálogo inteiro do cliente ativo vem de
  `/api/skus?limit=5000` e `/api/products?limit=5000` (`:2398-2410`) e o
  digitado é casado no navegador por `findExistingProduct`
  (`features/warehouse-ops/receiving.tsx:241-251`): primeiro pelo SKU
  interno, depois pelo código do cliente, por fim pelo código de barras. O
  casado aparece no cartão com "Usar este cadastro"; sem casar, "Produto
  ainda não localizado" (depois de o catálogo chegar, carregamento v2, parte
  13c).
- **O envio:** só com produto casado, endereço, contagem maior ou igual a
  zero e motivo com 3 caracteres ou mais (`canSubmit`, `:2445-2450`). A
  chamada (`:2457-2481`) manda `sku_code` do produto casado, o endereço como
  foi digitado, o custo do campo ou do catálogo e `occurred_at` do relógio do
  navegador; a chave de idempotência é por tentativa (`useTentativaDaEscrita`,
  "Tentar de novo" com o mesmo pedido, parte 13k). O botão é o `BotaoDeAcao`
  ("Registrando…").
- **Depois do sucesso:** toast "Contagem registrada" ou "Estoque ajustado ·
  Diferença registrada: −3"; a tela limpa só a contagem, o motivo e a
  referência e mantém Cód. cliente, SKU interno, Produto e Endereço
  (`:2497-2499`). Não há lista do que foi contado.
- **Textos fora de rótulo, dado e ação:** o subtítulo da página, "Conte um
  item num endereço; a diferença vira ajuste com evento.", o bloco
  "Confirmação operacional", os cartões "Regra operacional" e "Memória do
  Agent Dute" e o selo "ajuste auditado".
- **De outras telas:** "Contar este item", na ficha do item
  (`pages/estoque.tsx:1047-1052`), é um link para `/wms/contagem` sem levar o
  item nem a prateleira.

### 3.2 A callable e a transação

`recordCycleCount` (`functions/wms/src/index.ts:6929-6941`): entra por
`requireWarehouseWrite` (owner, admin, interno e wms; `:1448`) e
`requireCustomerScope`; a entrada é `CycleCountSchema`
(`domain/cycle-count-input.ts`: `counted_qty` não negativo, sem inteiro nem
teto; `reason` com 3 ou mais; `location_id` qualquer texto; `occurred_at`
qualquer string). A transação é `recordCycleCountTransaction`
(`domain/operations.ts:1945` até perto de `:3012`), no modo `cycle`, nesta
ordem:

1. Valida cliente, SKU, endereço e motivo; recusa contagem negativa
   (`:1958-1976`). O endereço só perde os espaços: não vai para maiúsculas
   nem é conferido em `warehouse_positions`.
2. Recibo idempotente em `operational_operations` (a mesma chave com o mesmo
   corpo devolve o resultado anterior; com outro corpo, recusa; `:1991-2010`
   e `:651-660`) e o congelamento do estoque (`system_controls/inventory`,
   `movements_frozen`; `:706-730`).
3. Exige o saldo exato do SKU naquela posição (`exactBalanceQuery`,
   `:732-744`); sem ele, "Saldo não encontrado para SKU … no local …. Cadastre
   o recebimento antes do inventário cíclico." (`:2183-2191`).
4. A contagem é o novo saldo da prateleira. Abaixo da reserva, recusa ("A
   contagem física (N) é menor que a reserva ativa (R)…", `:2219-2225`). Com
   reserva, lê `stock_reservations` da prateleira: reserva `picked` recusa
   ("tem itens separados esperando a entrega (pedido X). Conte depois da
   entrega.") e reserva `reserved` com linha de separação já separada
   (`pick_lines.separated_qty > 0`) recusa pelo mesmo motivo (`:2228-2270`).
5. Lê todos os saldos do SKU (`:2280-2283`), porque a projeção do portal é
   por SKU.
6. Grava: o saldo (`qty_on_hand`, `qty_available`, `status: empty` quando
   zera, `last_cycle_count_*`; `:2765-2797`); o documento `cycle_counts`
   (antes, contado, diferença, motivo, referência, ator, hora; `:2801-2838`);
   com diferença, o movimento ENTRADA ou SAIDA com `source:
   functions_cycle_count` (`:2841-2866`; `createMovement` grava o
   `occurred_at` do navegador em `data` e `occurred_at`, `:1336-1365`), a
   projeção `client_inventory` (`updateClientInventory`, `:2870-2888`) e os
   agregados do catálogo com custo (`applyCatalogStockAggregates`, `cost =
   delta × unitCost`, `:2889-2892`); sem diferença, só o snapshot da projeção
   (`:2896-2929`); o evento `inventory.adjusted` ("Inventário cíclico
   ajustado" ou "… sem divergência", `severity: attention` quando há
   diferença, a prateleira só no payload; `:2932-2985`); o recibo (`:3011`).
7. O custo: `unitCost = input.unit_cost || saldo || catálogo` (`:2491-2498`).
   Com diferença, `updateClientInventory` chama `rememberCatalogPrice`
   (`:1026-1035`), que grava `preco_unit` em `catalog_prices` quando o custo
   é maior que zero (`domain/catalog-prices.ts:92-107`); sem diferença,
   `setClientInventorySnapshot` faz o mesmo (`:1097-1102`). `catalog_prices`
   é a base do `merchandiseValue` do ad valorem (`index.ts:3555`).

### 3.3 O que a gravação muda e o que ela não toca

- **Não toca a caixa.** O `box_code` é zerado fora da abertura
  (`operations.ts:1961`) e `warehouse_boxes` só é lido e escrito no bloco do
  modo de abertura (`:2119` e `:2754`). `lines[]` e `taken_lines` da caixa
  (a regra em `lib/dominio/src/saldo-da-caixa.ts`) ficam como estavam. O
  Mapa, as Etiquetas, "Posições ocupadas", a sugestão da caixa mais antiga
  na separação e "Etiquetas para trocar" leem a caixa. A regra de ouro do
  mapa, "por posição e SKU, a soma do conteúdo das caixas é igual ao saldo"
  (`docs/mapa-do-armazem-enderecamento-dirigido.md:109-114`), quebra a cada
  diferença gravada, e nenhuma tela mostra a divergência
  (`docs/plataforma/separacao-com-caixas.md:791-794`).
- **Não confere a posição.** Um endereço inexistente passa quando por acaso
  há saldo nele; "b-10" ou "B10" dão "Saldo não encontrado" para um saldo em
  "B-10"; o código da caixa digitado no endereço dá o mesmo; `RECEBIMENTO` e
  `EXPEDICAO` são aceitos (`domain/areas-de-passagem.integration.test.ts:463`).
- **Não abre fila para ninguém na produção.** O evento de atenção só abre
  aviso na caixa antiga do agente onde o agente do núcleo não roda
  (`operations.ts:592-596`, `domain/caixa-do-agente.ts:15-17`,
  `CORE_AGENT_PROJECTS` inclui o `dute-prod`); o painel "Para decidir" lê só
  alertas de parados, anotações e playbooks (`pages/agente-painel.tsx:38`); o
  "Precisa de você" da Armazenagem não conta eventos. O rascunho de aviso ao
  cliente ("Estoque atualizado pela Dutelog") só nasce quando alguém roda a
  sincronização (`syncOperationalNotificationsFlow`, `index.ts:1855-1895`,
  pela tela antiga `pages/ai-control.tsx`), um por evento `inventory.*`
  (`notificationDraftFromEvent`, `:1640-1660`), e precisa de aprovação.
- **Redata o que ajusta para mais.** As datas do FIFO saem das ENTRADAs do
  razão pelo `created_at` do movimento (`domain/datas-do-saldo.ts:228-234`):
  a diferença para mais ganha a data da contagem e passa a ser o mais novo da
  prateleira; a hora do navegador não entra aí. O relógio dos parados não
  muda (`functions_cycle_count` não está em `ORIGENS_QUE_CONTAM`,
  `lib/dominio/src/parados.ts:51-63`).
- **Não cobra.** `functions_cycle_count` fica fora das entradas, saídas e
  movimentações da fatura (`domain/billing-scope.ts:98-100`; a régua
  `billing-callables.integration.test.ts:621-640` semeia um e confirma). O
  que muda é o valor da mercadoria, pela quantidade e, se o custo for
  digitado, pelo preço.

## 4. Achados

Cada achado tem o número com que passou pela verificação (seção 8), a
severidade pela recontagem de hoje (alta = impede a recontagem ou deixa o
saldo ou o registro das caixas errado; média = atrapalha muito ou gera
retrabalho; baixa = polimento) e o que fazer. Os de tipo "confirmação" são o
que está certo e vale manter.

### 4.1 O registro das caixas

- **F01 · alta · lacuna. A contagem cíclica não sabe de caixa.** O modo
  `cycle` descarta o `box_code` (`operations.ts:1961`) e nunca lê nem
  escreve `warehouse_boxes` (só o bloco da abertura, `:2119` e `:2754`). A
  diferença contada vira ENTRADA ou SAIDA no saldo da prateleira, e o
  conteúdo da caixa (`lines[]` ou as linhas da abertura por `box_code`) e o
  retirado pela separação (`taken_lines`) ficam como estavam. Tudo que lê a
  caixa passa a divergir do razão: o Mapa soma o saldo das caixas e conta a
  prateleira em "Posições ocupadas" enquanto houver caixa `stored`
  (`lib/warehouse-map.ts:171` e `:224`); a etiqueta imprime entrada menos
  retirado (`lib/warehouse-labels.ts:334`); a separação sugere a caixa mais
  antiga pelo saldo de cada caixa (`domain/pick-progress.ts:784`) e marca
  `emptied` pela conta dela. É a divergência que a recontagem quer eliminar,
  recriada pelo próprio registro dela, e foi por isso que a recontagem de
  16/11 foi gravada por script. *O que fazer:* decidir antes de começar
  (seção 7, pergunta 1); no produto, uma porta "recontar caixa" (seção 6).
- **F04 · alta · lacuna. Não existe folha do que o sistema espera em cada
  caixa, nem tela que mostre caixas × razão.** O Mapa guarda o saldo do razão
  ao lado das unidades das caixas sem confrontar os dois
  (`lib/warehouse-map.ts:174`; só mostra "Saldo sem caixa registrada" quando
  a prateleira não tem caixa, `pages/warehouse-map.tsx:471`); `reports.ts`
  não lê caixa; o núcleo não lê `warehouse_boxes`; nenhuma página lê
  `cycle_counts`. O relatório diário da regra de ouro previsto no desenho do
  mapa não existe. O único leitor que junta saldo, movimentos e caixas é
  `tools/corrigir-codigo-do-produto/ler-estoque.mjs`, por código. Sem a
  folha, a pessoa compara o físico com a etiqueta, e a divergência que já
  existe entre caixa e razão se mistura com a divergência física do dia. *O
  que fazer:* a folha por prateleira só de leitura, antes de começar; é o
  primeiro PR da seção 6.
- **F05 · alta · risco. A caixa vazia continua ocupando a prateleira, e a
  caixa física sem registro não tem como nascer com conteúdo.** Contar zero
  zera o saldo, mas a caixa segue `stored`: só a separação
  (`pick-progress.ts:871`) e o script marcam `emptied`, e `removeWarehouseBox`
  recusa caixa com conteúdo (`warehouse-boxes.ts:944`). "Cadastrar caixa já
  armazenada" só existe dentro do workspace da abertura e cria a caixa sem
  conteúdo (`inventory.tsx:836` e `:1344`). *O que fazer:* hoje, a caixa
  vazia sai pelo plano do acerto; reencaixotar não tem caminho até haver a
  porta por caixa.
- **F20 · média · melhoria. A etiqueta e o Mapa dizem o saldo da caixa
  (entrada menos retirado), não a entrada.** O retirado é gravado só pela
  separação (`pick-progress.ts:863`); o razão vem dos movimentos. A etiqueta
  pode estar errada com o razão certo (a separação tirou de outra caixa sem
  "Outra caixa"; a entrada da abertura veio da etiqueta do fornecedor) ou o
  contrário. Quem conta não distingue "falta peça" de "a separação tirou
  daqui e a etiqueta não foi trocada". *O que fazer:* a folha de contagem com
  entrada, retirado e saldo por caixa; reimprimir "Etiquetas para trocar"
  antes de começar.

### 4.2 A peça que a tela não aceita e os desvios

- **F03 · alta · lacuna. A peça achada onde o razão não tem saldo não
  entra.** O modo `cycle` exige saldo existente do SKU na prateleira
  (`operations.ts:2183-2191`): a peça na prateleira errada, o tamanho trocado
  (o XGG que era XG) e a caixa física sem registro param em "Saldo não
  encontrado… Cadastre o recebimento antes do inventário cíclico". A
  mensagem manda ao Receber, que cria uma chegada cobrada (`wms_receiving` é
  a única entrada cobrada, `domain/billing-scope.ts:98`) e não tira a peça de
  onde ela falta. Não existe callable de transferência entre prateleiras
  (`index.ts`: só `openAreaPutaway`, das áreas de passagem). O desvio que
  existe é o lançamento manual ("Ajustar saldo" e "Registrar movimentação" em
  Estoque › Itens, `pages/estoque.tsx:300-308` e `:1062-1070`): dois
  lançamentos à mão, não atômicos, com Origem e Destino de texto livre cujos
  padrões são `ESTOQUE_BTG`, `FORNECEDOR` e `CLIENTE`
  (`pages/movements.tsx:450-458` e `:533-541`); a ENTRADA cria saldo na
  posição digitada sem conferir `warehouse_positions`
  (`operations.ts:1391-1531`), então com os padrões o saldo nasce em
  "ESTOQUE_BTG", fora do mapa; ele também recusa o SKU fora do cadastro
  (`:1472-1477`), então o tamanho que ainda não existe não entra nem por
  ele, e grava o evento "Entrada manual de estoque" (`inventory.received`),
  não `inventory.adjusted`, o que esconde depois os acertos feitos por esse
  caminho. *O que fazer:* hoje, listar esses casos à
  parte e gravá-los pelo plano do acerto (bloco `transferencias`), que faz as
  duas pernas juntas; no código, a mensagem certa e uma ação "Transferir" da
  coordenação (seção 6).
- **F08 · média · risco. "Endereço contado" é texto livre comparado ao pé
  da letra.** `locationId` só perde os espaços (`operations.ts:1958`) e a
  consulta é por igualdade (`:732-744`): "b-10", "B10" ou o código da caixa
  (que o placeholder "Rua / prateleira / caixa" sugere) dão "Saldo não
  encontrado"; um endereço válido digitado por engano ajusta a prateleira
  errada quando ela tem saldo do mesmo SKU; `RECEBIMENTO` e `EXPEDICAO` são
  aceitos e mudam o "Em recebimento" do portal
  (`areas-de-passagem.integration.test.ts:463`). *O que fazer:* hoje, a
  folha com o código da prateleira em maiúsculas e a instrução de não digitar
  a caixa; no servidor, maiúsculas e posição ativa de `warehouse_positions`;
  na tela, a prateleira escolhida numa lista (mockup).

### 4.3 A tela usada em sequência

- **F02 · alta · defeito. Depois de um sucesso, o SKU interno anterior
  continua no formulário e manda na identificação.** A tela limpa só a
  contagem, o motivo e a referência (`inventory.tsx:2497-2499`) e
  `findExistingProduct` casa primeiro pelo SKU interno, depois pelo código do
  cliente (`receiving.tsx:241-251`). Quem digita o próximo Cód. cliente sem
  apagar o SKU anterior vê o cartão do produto anterior e, se não reparar,
  grava a contagem nele (`sku_code: existingProduct?.skuCode`,
  `inventory.tsx:2465-2469`): um ajuste errado em dois SKUs. O "Custo
  unitário" também não é limpo, e o corpo manda o custo que ficou no campo
  (`:2470-2472`): mesmo acertando o produto, o ajuste pode sair com o custo
  do anterior (F07). *O que fazer:* hoje, apagar os quatro campos (os três do
  produto e o custo) antes de cada SKU; no código, limpar o produto e o custo
  no sucesso (ou casar primeiro pelo campo que mudou por último) e levar o
  foco ao Cód. cliente.
- **F10 · média · lacuna. Contagem cega sem confirmação da diferença, sem
  desfazer e sem lista do que já foi contado.** A tela não mostra o saldo nem
  a reserva da prateleira ("O saldo atual será lido no backend…",
  `inventory.tsx:2642-2648`) e grava no primeiro clique; a diferença só
  aparece no toast (`:2484-2492`). Desfazer é outra contagem, com outro
  movimento e outro evento. `cycle_counts` tem tudo (antes, contado,
  diferença, ator, hora), mas nenhuma página o lê. *O que fazer:* com
  mockup, mostrar saldo e reserva ao escolher produto e prateleira, pedir
  confirmação acima de um limite e listar as contagens do dia por
  prateleira.
- **F16 · média · melhoria. "Motivo do ajuste" obrigatório mesmo sem
  divergência.** O servidor exige 3 caracteres em toda contagem
  (`cycle-count-input.ts:31`) e a tela só habilita o botão com ele
  (`inventory.tsx:2445-2450`), também quando a contagem confere; Motivo e
  Referência limpam a cada sucesso. Em centenas de contagens o motivo vira
  qualquer coisa e deixa de servir à auditoria. *O que fazer:* motivo da
  rodada preenchido uma vez, ou obrigatório só com diferença (mockup).
- **F17 · média · risco. O esforço da tela como está.** Três a cinco
  gravações por caixa, somando no papel as caixas do mesmo SKU na mesma
  prateleira: entre 600 e 1.000 gravações com motivo, sem lista do contado e
  com o produto anterior casado pelo SKU (F02). *O que fazer:* as regras de
  campo da seção 5 e os PRs 1 e 2 da seção 6.
- **F26 · baixa · melhoria. "Contar este item" leva à Contagem sem levar o
  item nem a prateleira** (`pages/estoque.tsx:1047-1052`). *O que fazer:*
  levar o SKU e a prateleira na rota e preencher os campos (mockup).
- **F25 · baixa · melhoria. No celular cabe em 390 px, mas sem leitura de
  código, com campos de 40 px e foco que não volta ao primeiro campo.** O
  botão tem 44 px (`inventory.tsx:2654`); os `Input` têm 40
  (`components/ui/input.tsx:10`); um leitor Bluetooth que manda Enter
  dispara o envio. *O que fazer:* com mockup, leitura pela câmera, campos de
  44 px e foco no primeiro campo depois do sucesso.
- **F24 · baixa · melhoria. A aba está fora da v3 e tem legenda que a regra
  1.2 proíbe.** `/wms/contagem` não está em `TELAS_DO_WMS_NA_V3`
  (`lib/wms-v3.ts:11-28`); o subtítulo, "Conte um item num endereço…", o
  bloco "Confirmação operacional", os cartões "Regra operacional" e "Memória
  do Agent Dute" e o selo "ajuste auditado" são legenda; o `axe` roda em dois
  estados da aba (o catálogo que falhou,
  `devolucoes-e-contagem.carregamento.test.tsx:380`, e o resultado incerto,
  `escritas-por-tentativa.test.tsx:520`), mas a lista dos textos do formulário
  não existe em teste nenhum, nem o `axe` nos estados vazio, produto achado,
  enviando e recusado. O cartão do agente promete o que a produção não faz
  (F14). Qualquer mudança nesta tela pede
  mockup v3 aprovado e o alinhamento de UX decidido em 23/10/2026.

### 4.4 Reserva, separação e concorrência

- **F09 · média · risco. Reserva e separação em aberto travam a correção
  para baixo, e contar enquanto se separa grava um número que já mudou.** As
  três recusas (`operations.ts:2219-2270`) estão certas (F28), mas: a
  prateleira com pedido aprovado só se conta com o reservado incluído; a
  prateleira com linha já separada ou separado esperando a entrega não se
  conta até a entrega, e os pedidos da BTG levam de 3 a 4 dias; a pessoa só
  descobre a reserva na recusa; e a peça que o separador já tirou da
  prateleira antes de gravar a linha passa na trava e é contada a menos. O
  congelamento (`movements_frozen`) para a contagem também. *O que fazer:*
  decisão da seção 7 (pergunta 3): pedidos abertos entregues ou cancelados
  antes, ou as prateleiras com reserva por último, com a separação parada
  naquela rua.
- **F18 · média · risco. Duas pessoas na mesma prateleira e a contagem
  repetida não têm teste nem aviso.** A contagem é o novo saldo
  (`operations.ts:2214`); duas gravações seguidas ou concorrentes deixam a
  última e geram dois `cycle_counts` e dois eventos (o da que só confirma a
  anterior sai `info`; só o que muda o saldo sai `attention`); a chave de
  idempotência é por tentativa da tela, então nunca colidem. Os testes de
  concorrência do WMS cobrem a aprovação de reserva
  (`operations.integration.test.ts:381`) e a conclusão da separação
  (`pick-progress.integration.test.ts:368`); a contagem cíclica não tem teste
  de concorrência, de repetição com chave distinta nem da chave com outro
  corpo. *O que fazer:* hoje, uma pessoa só grava, por rua; testes de
  integração dos três casos; decidir se a prateleira contada por outra
  pessoa há poucos minutos recusa ou avisa.

### 4.5 Dinheiro e dados

- **F07 · média · risco. O "Custo unitário" da contagem aparece para quem
  conta, prevalece sobre o catálogo e reescreve o preço do SKU na base do
  ad valorem.** A tela mostra o campo a todo papel que grava, sem guarda por
  papel (`inventory.tsx:2607`). O preço do catálogo só chega a quem vê valor:
  o leitor do app apaga os campos de dinheiro de `/api/skus` e
  `/api/products` para quem não passa em `canSeeCatalogPrice` (owner, admin e
  financeiro; `lib/cloud-api.ts`, `stripPublishedMoney`;
  `lib/permissions.ts:44`), então para wms e interno o campo vem vazio. O
  risco é o valor digitado: o servidor usa `input.unit_cost` antes do saldo e
  do catálogo (`operations.ts:2491`) e, com ou sem diferença,
  `rememberCatalogPrice` grava `preco_unit` em `catalog_prices` quando o custo
  é maior que zero (`:1026-1035`, `:1097-1102`; `catalog-prices.ts:92-107`),
  a base do `merchandiseValue` do ad valorem (`index.ts:3555`); os agregados
  de custo de `skus` e `products` são apagados a cada escrita
  (`publishedMoneyDeletes`), então `catalog_prices` é a única escrita de
  dinheiro que a contagem alcança. Um "12" no campo errado muda o preço de
  todo o saldo daquele SKU e a fatura de novembro, sem evento próprio. *O que
  fazer:* hoje, ninguém toca no campo, e owner ou admin conferem
  `catalog_prices` no fim; no código, o modo `cycle` ignora `unit_cost` e a
  tela esconde o campo de quem não vê preço.
- **F11 · média · defeito. A contagem aceita quantidade fracionada e sem
  teto.** `counted_qty` é `z.number().nonnegative()` sem `.int()` nem
  máximo (`cycle-count-input.ts:28`); a tela confia no `step="1"` do
  navegador (`inventory.tsx:2597-2603`); a API e a callable direta aceitam
  2,5 ou 2.500.000. *O que fazer:* `.int()` e um teto, com caso em
  `cycle-count-input.test.ts`; confirmação acima de um limite na tela.
- **F12 · média · risco. `occurred_at` vem do navegador sem validação.**
  Qualquer string (`cycle-count-input.ts:33`) vira a data do movimento, do
  `cycle_counts` e do `last_cycle_count_at`; o evento e o FIFO usam a hora do
  servidor (`createEvent`; `datas-do-saldo.ts:232`) e a cobrança ignora a
  contagem, então um relógio errado só desordena o Histórico de movimentos e
  a hora do registro. `recordOperationalEvent` descarta a hora do cliente
  (`index.ts:6999`); a contagem não. *O que fazer:* no modo `cycle`, a hora
  do servidor; conferir o relógio dos aparelhos antes de começar.
- **F13 · média · risco. FIFO por data: o ajuste para mais nasce "de hoje",
  o para menos apaga as datas mais antigas, e "zerar e contar de novo"
  redata a prateleira inteira.** As datas saem de toda ENTRADA do razão pelo
  `created_at` (`datas-do-saldo.ts:14` e `:232`); a diferença para mais ganha
  a data da contagem e vai para o fim da fila, no portal e na sugestão da
  caixa mais antiga. O relógio dos parados não muda (`parados.ts:51-63`). *O
  que fazer:* instrução de campo: nunca zerar para recontar; decisão da
  seção 7 sobre a data que a ENTRADA de contagem deve valer.

### 4.6 Quem ajusta, quem revisa e o que o cliente vê

- **F06 · alta · lacuna. Quem conta é quem ajusta.** `recordCycleCount`
  entra por `requireWarehouseWrite` (owner, admin, interno e wms;
  `index.ts:1448`) e grava movimento, saldo, portal e agregados na mesma
  chamada, inclusive zerando a prateleira sem reserva, sem segunda contagem,
  aprovação ou limite. O modelo alvo de `docs/modulos-e-permissoes.md:122` e
  `:143` promete o contrário: "wms conta, interno aprova ajuste" e "resultado
  publicado somente após revisão, quando afetar saldo do cliente". *O que
  fazer:* decisão da seção 7 (pergunta 2); no código, um estado pendente
  acima do limite com a confirmação da coordenação, que muda a linha de
  `recordCycleCount` em `callables-papeis` e pede mockup da fila.
- **F14 · média · lacuna. Na produção o evento de atenção não cai em fila
  nenhuma, e a tela promete o contrário.** O aviso na caixa antiga do agente
  só abre onde o agente do núcleo não roda (`operations.ts:593-597`,
  `caixa-do-agente.ts:15-17`; `CORE_AGENT_PROJECTS` tem o `dute-prod`); o
  "Para decidir" lê só alertas de parados, anotações e playbooks
  (`pages/agente-painel.tsx:38`); o "Precisa de você" tem a linha "avisos
  para revisar" da caixa antiga, suprimida onde o agente do núcleo roda
  (`lib/home-inbox.ts:253-268`); a rotina de avisos da Operação não tem
  `inventory.adjusted`. O evento fica em
  `events` e no Movimentações como "Ajuste · Contagem". *O que fazer:* hoje,
  a coordenação revisa Relatórios › Movimentações filtrado por origem
  "Contagem" ao fim de cada turno; decisão da seção 7 (pergunta 7).
- **F15 · média · risco. Quando a sincronização de avisos roda, cada evento
  da contagem vira um rascunho ao cliente "Estoque atualizado pela
  Dutelog".** Os rascunhos nascem em `syncOperationalNotificationsFlow`
  (`index.ts:1855-1895`), chamada pelo botão do painel antigo
  (`pages/ai-control.tsx`), que não abre onde o agente do núcleo está
  liberado (o `dute-homolog` e o `dute-prod`); a callable
  `syncOperationalNotifications` continua publicada e qualquer papel interno
  pode chamá-la (`lib/functions-api.ts:690-694`). Quando roda, lê até 500
  eventos e todo tipo `inventory.*` vira aviso ao cliente, salvo a abertura e
  o que cita `CX-` (`index.ts:1563` e `:1654`), inclusive o "conferido sem
  diferença". *O que fazer:* ninguém sincroniza nem aprova rascunho de
  estoque durante a recontagem; no código, `inventory.adjusted` vira aviso
  interno e o sem diferença não vira rascunho.
- **F23 · média · pergunta. O que a BTG vê.** O portal lê só
  `client_inventory`, que muda a cada gravação (`operations.ts:2870`), sem
  histórico, motivo nem aviso; as regras negam `events` e `movements` ao
  cliente. *O que fazer:* decisão da seção 7 (pergunta 4).
- **F27 · baixa · melhoria. A severidade `attention` em todo ajuste vira
  ruído numa recontagem planejada**, e não há evento de rodada que agrupe os
  ajustes com o resumo líquido. *O que fazer:* a sessão de recontagem da
  porta por caixa (seção 6).

### 4.7 Testes e ensaio

- **F19 · média · lacuna. Não existe ensaio da recontagem no emulador.** O
  cenário da BTG (`tools/acerto-btg-2026-10/cenario-emulador.mjs`) serve ao
  acerto por script: sem `taken_lines`, sem caixas `emptied`, sem reservas,
  sem usuários nem Functions; `--conferir` não compara a soma das caixas com
  o saldo. A primeira contagem real de hoje é também o primeiro teste do
  fluxo com o estado atual. *O que fazer:* um `--conferir-caixas` (a regra de
  ouro por posição e SKU) e o estado de 16/11 no cenário, antes de qualquer
  PR que mexa na contagem.
- O que os testes garantem hoje: a transação sem romper reservas
  (`operations.integration.test.ts:1641`), a espera da entrega do separado
  (`:1754`), a projeção agregada sem divergência (`:2513`), os agregados do
  catálogo (`:2578`), a reativação do arquivado (`:2754`), a entrada do
  schema (`cycle-count-input.test.ts`), os papéis
  (`callables-papeis.integration.test.ts:209`), a cobrança
  (`billing-callables.integration.test.ts:621`); no app, a espera do
  catálogo e a chave por tentativa
  (`devolucoes-e-contagem.carregamento.test.tsx:358`,
  `escritas-por-tentativa.test.tsx:275`). O que não tem teste: inteiro e
  teto (F11), posição inexistente e texto livre (F08), hora do navegador
  (F12), custo digitado (F07), duas pessoas e a repetição (F18), a lista dos
  textos e o `axe` do formulário (F24).

### 4.8 Processo

- **F21 · média · melhoria. O que o 16/11 ensina.** A quarta rodada (03/11)
  somou à azul-marinho 59 peças pela etiqueta do fornecedor, e a recontagem
  peça por peça de 16/11 provou que a abertura estava certa; o acerto teve
  de desfazer a rodada, mover o retirado entre caixas e esvaziar as três
  (`tools/acerto-btg-2026-10/README.md`, quinta rodada). Cinco rodadas de
  correção em três semanas (quatro gravações na produção), com divergências
  de várias naturezas: cadastro (a letra O no lugar do zero, o tamanho no fim
  do código, a família nomeada no gênero errado), peças tiradas para o saldão
  fora do sistema, a peça que ficou fora da contagem de uma caixa e a chegada
  repetida de 06/11. O que se repete é a correção feita sem recontar a peça e
  sem o sistema saber de qual caixa; a Referência de texto livre dá trilha
  legível, mas não liga a contagem ao registro da caixa. *O que fazer:* as
  regras de campo da seção 5.5 e o relatório caixas × saldo (F04) como
  fechamento.
- **F22 · média · pergunta. A recontagem de hoje vai pelo plano do acerto ou
  pela tela?** Seção 7, pergunta 1.

### 4.9 O que o crítico de completude apontou

Depois dos 33 achados, um revisor de completude apontou seis frentes que
ninguém tinha olhado. Quatro delas receberam uma rodada própria de leitura
(20 achados, G01 a G20, todos confirmados pelos dois revisores); o resumo de
cada uma vem depois da lista.

1. **Guardas abertas e chegadas em curso.** A transação da contagem lê só
   `stock_reservations` e `pick_lines`; não lê as tarefas de guarda abertas
   nem a caixa em `committing`. O domínio conhece o conceito
   (`domain/area-putaway.ts:39`, `OPEN_PUTAWAY`, "a guarda que ainda vai
   tirar peças da origem"). Uma prateleira contada com uma guarda a caminho
   dela, ou de saída dela, pode ficar errada quando a guarda conclui.
2. **O motor da abertura já conta por caixa.** No modo de abertura a mesma
   transação exige que a caixa exista, seja do cliente e esteja guardada
   naquela posição (`operations.ts:2117-2160`), soma ao saldo quando é mais
   uma caixa do mesmo SKU na prateleira (`additive`, `:2206-2215`) e grava a
   linha por `box_code`, com a conferência retomável
   (`domain/opening-inventory-conference.ts`). Está fechado para a BTG com a
   sessão concluída; a porta "recontar caixa" do PR 4 tem onde se apoiar.
3. **Ponto de volta.** Cada contagem grava saldo, `cycle_counts`, movimento,
   projeção do portal, agregados, `catalog_prices` (com custo), evento e
   recibo, e não existe desfazer; a volta de uma rodada errada (como a quarta
   rodada, desfeita em 16/11) não tem ferramenta. A produção tem PITR de 7
   dias e backup diário, e a volta é sempre para um banco novo
   (`docs/plataforma/backup-e-recuperacao.md`). Um export gerenciado antes da
   primeira gravação custa pouco.
4. **Não há como marcar a prateleira "em contagem".** `warehouse_positions`
   tem os status `review` e `blocked`, que a guarda respeita como destino
   (`domain/warehouse-positions.ts:117-140`), mas a contagem não lê a posição
   (F08) e a reserva e a separação não foram conferidas quanto a esses
   status; o único congelamento (`movements_frozen`) para a contagem também.
5. **A peça de SKU arquivado e a peça fora da zona.** O acerto arquivou os
   SKUs errados já em zero; o catálogo da aba não traz arquivados, e a
   reativação só existe no modo de abertura (`operations.ts:2041-2060`). A
   peça cujo cadastro certo foi arquivado cai em "ainda não localizado".
6. **Afirmações sem teste.** Recontar depois de zerar (o saldo `empty` que
   deveria aceitar nova contagem), "Mais de um saldo existe", a hora do
   navegador, a quantidade fracionada e a contagem com guarda aberta não têm
   teste na cíclica.

O que a rodada das lacunas confirmou:

- **Guardas e chegadas (G01 a G05).** A contagem não lê `putaway_tasks` nem
  a caixa em `committing`. Contar o RECEBIMENTO com guarda aberta grava um
  saldo que a guarda ainda vai baixar (G01); contar a prateleira de destino
  antes de a guarda concluir dá "Saldo não encontrado" ou dobra a prateleira
  quando a guarda soma (G02); a caixa em `committing` aparece na prateleira
  do Mapa com o saldo ainda no RECEBIMENTO (G03); a única lista das guardas
  abertas é Receber › "Para guardar" (G04). A decisão (G05) é de processo:
  parar o Receber e as guardas durante a recontagem, ou contar as áreas de
  passagem por último, com as guardas concluídas antes.
- **O motor da abertura (G06 a G10).** Não serve como está para a
  recontagem: iniciar a sessão trava o portal (`outbound_blocked`) e marca o
  faturamento "em abertura" (G06); o conteúdo da caixa da abertura é a soma
  de `opening_inventory_lines` por `box_code`, sem sessão nem status, e não
  existe a primitiva "conteúdo = contado" (G07); a soma `additive` só vale
  para saldo da própria sessão sem reserva (G08); cada linha reescreve o
  catálogo e `catalog_prices` e exige custo, gênero e grupo (G09); a sessão
  única por cliente prende "Corrigir caixa", a conferência e as datas do FIFO
  (G10). A porta "recontar caixa" do PR 4 reaproveita a validação da caixa e
  a soma por prateleira, com primitiva própria e sem o resto.
- **Ponto de volta (G11 a G15).** Nenhum marco antes da primeira gravação:
  nem export, nem o minuto do PITR anotado, nem um manifesto "antes" (G11);
  a volta por PITR ou import é por coleção inteira e devolveria também os
  pedidos do dia, porque contagem e separação escrevem em `stock_balances`,
  `movements` e `events` (G12); `cycle_counts` guarda o `qty_before` de cada
  contagem, mas nenhuma ferramenta lê isso para uma volta seletiva (G13);
  não existe "pare só a contagem" (G14); o PITR cobre 7 dias e a última
  rodada errada foi descoberta 13 dias depois (G15).
- **A prateleira em contagem (G16 a G20).** `review` e `blocked` só freiam a
  guarda e o motor de caixas; a reserva do pedido, a separação e a própria
  contagem nunca leem `warehouse_positions` (G16); o único congelamento é
  tudo ou nada e só liga por script (G17); pôr "em verificação" é um clique
  por prateleira, de owner, admin ou interno, e o evento não diz o status nem
  o motivo (G18); `review` quer dizer "uma recusa marcou", não "em contagem"
  (G19); a base que existe é o status lido em transação pela guarda, com
  papel e evento (G20).

### 4.10 O que está certo e vale manter

- **F28.** As travas de reserva, `picked` e linha separada; a semântica
  "contagem = novo saldo da prateleira"; a idempotência pela chave da
  tentativa e pelo hash do corpo (`operations.ts:651-660`); os papéis; o
  evento no mesmo fluxo, com a prateleira só no payload; o carregamento v2
  na aba (`BotaoDeAcao`, "Tentar de novo", a espera do catálogo); as
  consultas sem índice composto.
- **F29.** A contagem não entra na cobrança por movimento
  (`billing-scope.ts:93-100`), não mexe no relógio dos dias parado nem em
  `ai_measures` e `ai_case_memory`; nos relatórios é "Ajuste · Contagem". O
  lançamento manual (`functions_manual_inventory`) conta no relógio: corrigir
  por ele mascara item parado.
- **F30.** O `total_cost = 0` da contagem sem divergência (Fase 7) está
  corrigido: `setClientInventorySnapshot` só grava custo maior que zero e
  `merchandiseValue` calcula saldo × `preco_unit` (`catalog-prices.ts:146`).
- **F31, F32, F33.** O isolamento por cliente (`requireCustomerScope`,
  `customer-isolation.integration.test.ts:94`); as Rules (o cliente não lê
  `cycle_counts`, `stock_balances`, `movements`, `warehouse_boxes` nem
  `events`, `firestore.rules:1097`); a zeragem apaga `cycle_counts` com o
  estoque, por descoberta (vale nomear em `APAGADAS_DE_PROPOSITO`).

## 5. A recontagem caixa a caixa com o que existe hoje

### 5.1 O passo a passo por caixa

Uma caixa física com três SKUs, na prateleira B-10:

1. Abrir a caixa e contar cada SKU. Como a aba grava por **SKU × prateleira**,
   somar antes todas as caixas do mesmo SKU que estão na mesma prateleira: a
   tela não aceita o código da caixa e não sabe de qual caixa falta.
2. Digitar o código do cliente (ou o SKU, ou o código de barras), conferir o
   cartão do produto, digitar "B-10" como está na etiqueta da posição (com
   hífen e em maiúsculas), a contagem total da prateleira para aquele SKU,
   um motivo e, se quiser, a referência.
3. "Registrar contagem": o toast diz se houve diferença; o portal da BTG já
   mostra o novo saldo; o evento ficou em `events`.
4. Repetir para o segundo e o terceiro SKU. Antes de digitar o próximo
   código, apagar o SKU interno do anterior (seção 4, achado sobre o produto
   que continua casado).

Cerca de 200 caixas em 43 prateleiras, três a cinco SKUs por caixa: entre
600 e 1.000 gravações, cada uma com motivo, sem lista do que já foi contado
e sem folha do que o sistema espera em cada caixa.

### 5.2 Onde trava

- A peça achada numa prateleira onde o SKU não tem saldo (a peça na
  prateleira errada, o tamanho trocado, a caixa física sem registro): "Saldo
  não encontrado… Cadastre o recebimento".
- A prateleira com reserva de pedido aprovado: a contagem precisa incluir o
  reservado; abaixo dele, recusa.
- A prateleira com linha já separada ou com separado esperando a entrega:
  recusa até a entrega. Com os pedidos da BTG levando de 3 a 4 dias para
  separar, essas prateleiras ficam para o fim.
- O estoque congelado (`movements_frozen`) para tudo, inclusive a contagem.
- O endereço em minúsculas, sem hífen ou com o código da caixa: "Saldo não
  encontrado".

### 5.3 O que fica inconsistente

Toda diferença gravada pela aba corrige o razão e deixa o registro das caixas
como estava: a etiqueta e o Mapa continuam com o número velho, a separação
continua sugerindo tirar de uma caixa que não tem a peça, a caixa que ficou
vazia continua ocupando a prateleira e a regra de ouro fica quebrada sem
nenhuma tela que a mostre. Foi por isso que a recontagem de 16/11 das
CX-000136, CX-000138 e CX-000140 foi contada no papel e gravada pelo plano do
acerto, não pela tela (`tools/acerto-btg-2026-10/README.md`, quinta rodada).

### 5.4 Os caminhos que existem hoje

| Caminho | O que grava | O que não faz |
|---|---|---|
| Aba "Contagem cíclica" | O saldo da prateleira por SKU, com movimento, evento e recibo, na hora. | Não toca a caixa; não cria saldo em prateleira nova; grava sem conferir a diferença. |
| "Ajustar saldo" e "Registrar movimentação" (Estoque › Itens, `pages/movements.tsx`) | ENTRADA ou SAIDA por SKU e posição (`createInventoryMovement`), inclusive em posição nova. | Origem e Destino de texto livre com os padrões `ESTOQUE_BTG`, `FORNECEDOR` e `CLIENTE`: com os padrões, o saldo nasce fora do mapa. Sem as travas de separação da Contagem. Não toca a caixa. |
| Plano do acerto (`tools/acerto-btg-2026-10`) | A caixa e o saldo juntos (`baixar_caixa` com itens, `ajustar_linha`, `adicionar_linha`, `mover_retirado`, `remover_caixa`), com dry-run e recibo. | Cada caixa divergente é uma operação escrita no `plano.mjs` e gravada da máquina do Leonardo. |
| `tools/corrigir-codigo-do-produto` | O tamanho errado, pela transferência entre SKUs. | Só o caso do código do cliente. |

### 5.5 Regras de campo, se a recontagem começar com o que existe

1. Peça por peça, caixa aberta. Nunca pela etiqueta do fornecedor nem pela da
   Dutelog: foi assim que a quarta rodada pôs 59 peças que não existiam.
2. A folha por prateleira, gerada antes só de leitura, com caixa, SKU,
   entrada, retirado, saldo esperado e reservado; o contado é anotado por
   caixa, e a soma por SKU é o que vai para a tela.
3. A ordem é por rua e prateleira (a `sequence` de `warehouse_positions`,
   a mesma da lista de separação). As prateleiras com pedido aberto (reserva
   ou linha separada) ficam para o fim, com a separação parada naquela rua, ou
   os pedidos são entregues ou cancelados antes.
4. Uma pessoa só grava, por rua. Quando a diferença passa de um limite (10
   peças ou 10%), outra pessoa conta a caixa antes de gravar. A segunda
   contagem é da operação, no papel: o sistema recebe só o número já
   conferido (decisão do Leonardo, 17/11/2026).
5. Grava-se só a diferença: nunca zerar a prateleira para contar de novo
   (redata o FIFO), nunca pelo Receber (cobra e duplica) e, no lançamento
   manual, nunca com os padrões de Origem e Destino.
6. Na tela: apagar os três campos do produto antes de cada SKU; o endereço
   como está na etiqueta da posição ("B-10"); "Custo unitário" sempre vazio;
   a Referência com a caixa ("CX-000136") e o motivo padrão ("Recontagem
   geral 17/11"), para o `cycle_counts` e o evento guardarem de qual caixa foi.
7. O que a tela não aceita (peça fora do lugar, tamanho trocado, caixa vazia,
   caixa sem registro) vai para uma lista à parte, por caixa, para o plano do
   acerto.
8. Ninguém roda a sincronização de avisos nem aprova rascunho de estoque. A
   coordenação revisa Relatórios › Movimentações filtrado por origem
   "Contagem" ao fim de cada turno; owner ou admin conferem `catalog_prices`
   no fim.
9. Os aparelhos com o relógio e o fuso certos.
10. O fechamento é a folha regerada: caixas × saldo sem diferença em cada
    prateleira, e a lista das divergências por caixa para a Cristiane.

## 6. Oportunidades de melhoria, em ordem

A ordem é a da dor da recontagem: primeiro o que não muda o sistema, depois o
que é só leitura, depois o servidor e, por último, as telas, que só entram
com mockup v3 aprovado. Um problema por PR, com o teste que falha antes. As
pranchas da proposta (a rodada por prateleira, a prateleira caixa a caixa, o
celular e a folha) estão em `docs/mockups/WmsContagem*.dc.html`, registradas
no README da pasta com o canvas privado; **a direção foi aprovada pelo
Leonardo em 17/11/2026**, com a segunda contagem fora do sistema.

0. **Sem código, antes de começar.** As regras da seção 5.5; a folha gerada
   por script só de leitura (um `ler-estoque.mjs` ampliado para todas as
   caixas do cliente ativo, por prateleira); a reimpressão das "Etiquetas para
   trocar"; a lista das prateleiras com reserva ou separação e das guardas
   abertas (Receber › Para guardar); o relógio dos aparelhos; um export
   gerenciado do Firestore antes da primeira gravação (seção 4.9, item 3).
   *Pronto quando* a folha impressa por rua traz entrada, retirado,
   saldo esperado e reservado por caixa e SKU, com a divergência caixa × razão
   que já existe marcada antes de contar.
1. **Folha de contagem e "Caixas × saldo", só leitura (F04, F20, F01).** A
   folha A4 por prateleira no molde da lista de separação (`/pedidos/lista`),
   na ordem de caminhada, com caixa, SKU, esperado e "Contado" em branco; e o
   relatório da regra de ouro (saldo do razão, soma das caixas, diferença) por
   prateleira, em Relatórios ou no Mapa, com a lista das contagens do dia. Sem
   callable nova: lê `warehouse_boxes`, `opening_inventory_lines`,
   `stock_balances`, `warehouse_positions` e `cycle_counts`. Tela com mockup,
   lista de textos e `axe`. *Pronto quando* a folha e o relatório batem com o
   emulador e o `--conferir-caixas` do cenário (PR 6) dá zero depois de um
   acerto. **No código desde 17/11/2026 (PR 615):** a folha em
   `/estoque/contagem/folha?rua=A` e o relatório em
   `/estoque/contagem/caixas`, os dois abertos pela Contagem, na v3, com os
   papéis do armazém; a conta em `lib/warehouse-ops/contagem-por-caixa.ts`
   (o esperado pelo `saldoDaCaixa` do domínio, a entrada pela
   `entradaDasCaixas`), as leituras as do Mapa e das Etiquetas e as
   contagens do dia lidas de `cycle_counts` por `occurred_at`. A caixa
   `committing` sai marcada "a caminho" e fora das somas; o saldo que
   nenhuma caixa tem sai como linha "sem caixa"; a prateleira que fecha no
   total e não por SKU conta como diferente ("2 itens diferem"). Conferido
   com a prancha pela folha de estilos do build, não com o emulador; o
   `--conferir-caixas` (PR 6) continua pendente.
2. **O servidor da cíclica mais seguro, sem tela (F11, F08, F07, F12, F15,
   F03, F18).** `counted_qty` inteiro com teto; o endereço em maiúsculas e
   conferido em `warehouse_positions`, com a área de passagem só para owner e
   admin; `unit_cost` ignorado no modo `cycle` (o preço muda só no Catálogo,
   por quem vê valor); `occurred_at` do servidor; a recusa "Saldo não
   encontrado" dizendo o caminho certo; `inventory.adjusted` como aviso
   interno e o sem diferença sem rascunho; a recusa da prateleira com guarda
   aberta ou caixa em `committing` e o respeito ao status `review` e
   `blocked` da posição (seção 4.9, itens 1 e 4); os testes das duas
   pessoas, da repetição, da chave com outro corpo, do recontar depois de
   zerar e do "Mais de um saldo existe". Cada um com o teste que falha antes
   (`cycle-count-input.test.ts`, `operations.integration.test.ts`,
   `rascunhos-de-aviso.integration.test.ts`). *Pronto quando* `billing-callables`
   e `callables-papeis` seguem verdes e nenhum valor digitado na Contagem muda
   `catalog_prices`.

   *No código desde 17/11/2026 (PR 616, três commits, só no modo `cycle`; a
   abertura não muda):* a quantidade inteira, com teto de 100.000, no esquema
   e na transação (a callable recusa a entrada fora do formato com a frase
   para quem opera, não mais com o `INTERNAL` do ZodError cru); o endereço em
   maiúsculas, a prateleira conferida em `warehouse_positions` (a recusa diz o
   que foi digitado) e RECEBIMENTO e EXPEDICAO, em qualquer grafia, só para
   owner e admin; o `unit_cost` digitado ignorado (o custo sai do saldo ou de
   `catalog_prices`, e a contagem não grava nada em `catalog_prices`, com ou
   sem diferença) e `occurred_at` do servidor, no movimento, no registro e no
   saldo. A tela ainda manda os três campos; o servidor trata. Ficam: a recusa
   "Saldo não encontrado" com o caminho certo, o `inventory.adjusted` como
   aviso interno, a guarda aberta e a caixa em `committing`, o status `review`
   e `blocked` da posição (pergunta 9) e os testes das duas pessoas, da
   repetição e da chave com outro corpo.
3. **A aba cíclica para a sequência, com mockup v3 (F02, F10, F16, F17, F24,
   F25, F26).** Limpar o produto no sucesso e levar o foco ao código; a
   prateleira escolhida numa lista; saldo, reserva e "em separação" antes de
   digitar; a diferença confirmada acima de um limite; o motivo da rodada
   uma vez; a lista das contagens do dia; "Contar este item" com o item e a
   prateleira; campos de 44 px e leitura pela câmera; sem legenda, com a
   lista de textos e o `axe`. *Pronto quando* uma prateleira com três SKUs se
   conta no emulador sem retocar nenhum campo do produto.
4. **Contagem por caixa, servidor e depois tela (F01, F05, F06, F14, F18,
   F27).** A callable "recontar caixa": a caixa e os itens contados; o
   esperado é entrada menos retirado; a diferença gravada no razão (pela
   própria `recordCycleCountTransaction`, ou chamando-a) e na caixa
   (`lines[]` ou as linhas da abertura, `taken_lines` intacto) na mesma
   transação; o item que a caixa não tinha entra, mesmo sem saldo prévio na
   prateleira; contado zero marca `emptied`; a caixa no `cycle_counts`, no
   movimento e no evento; uma sessão de recontagem (progresso por prateleira,
   quem, quando; eventos `inventory.recount_*` com o resumo líquido) e o
   ajuste acima do limite pendente da coordenação; a peça de SKU arquivado
   reativada como a abertura já faz (seção 4.9, item 5). O molde é o motor
   da abertura (seção 4.9, item 2): a validação da caixa, o `additive` por
   prateleira e a linha por `box_code`. Paridade com
   `saldo-da-caixa.ts` travada em teste; linhas novas em `callables-auth`,
   `callables-papeis`, nos índices e na zeragem (`test_full_reset_btg.py`); a
   régua `billing-callables` verde. *Pronto quando* recontar B-10 no emulador
   deixa caixas e razão iguais e o relatório do PR 1 em zero.
5. **Transferir entre prateleiras e caixas, pela coordenação (F03).** SAIDA
   e ENTRADA na mesma transação, com a caixa de origem e a de destino,
   recusando o que está separado; o lançamento manual sem os literais
   `ESTOQUE_BTG`, `FORNECEDOR` e `CLIENTE` e com a posição escolhida na lista.
   *Pronto quando* o XGG que era XG se corrige pela tela, sem script.
6. **Ensaio no emulador (F19).** O cenário com `taken_lines`, caixas
   `emptied` e as reservas do PED-0001; o `--conferir-caixas`; um roteiro que
   suba o app com o WMS e deixe gravar uma contagem antes da produção. Entra
   junto com o PR 1 ou antes dele.
7. **A fila da revisão (F06, F14).** "N ajustes de contagem para revisar" no
   "Precisa de você" da Armazenagem (a régua única, `lib/resumo-do-modulo.ts`,
   lida de `cycle_counts` com diferença do dia) ou no "Para decidir" do
   agente; depende da pergunta 7 e de mockup.

## 7. Perguntas para o Leonardo

1. **Hoje.** Contar no papel e gravar pelo plano do acerto (caixa e razão
   juntos, com dry-run, da sua máquina), ou gravar pela tela (o razão na
   hora, as caixas acertadas depois por script)? A porta por caixa (PR 4)
   ainda não existe.
2. **Quem conta e quem grava.** Só interno e admin, ou também wms? O ajuste
   grande fica pendente até a coordenação confirmar? (A segunda contagem é da
   operação, fora do sistema, e o limite dela é regra de campo: decidido em
   17/11/2026.)
3. **Os pedidos e as guardas abertos.** Entregar ou cancelar os pedidos
   antes de começar, ou deixar as prateleiras com reserva e separação para o
   fim, com a separação parada naquela rua? E o Receber: parado durante a
   recontagem, ou as áreas de passagem contadas por último, com as guardas
   concluídas antes (G05)?
4. **A Cristiane.** Avisar antes que o portal vai oscilar e mandar um aviso
   único no fim (itens e quantidades líquidas, sem prateleira, caixa nem
   valor), ou nada até fechar?
5. **A data do ajuste para mais no FIFO.** O dia da contagem (hoje), o dia da
   abertura, a entrada mais antiga da prateleira ou sem data?
6. **O "Custo unitário".** Sai da cíclica, e o preço muda só no Catálogo, por
   quem vê valor?
7. **A revisão dos ajustes.** "Precisa de você" da Armazenagem ou "Para
   decidir" do agente?
8. **A v3.** A Contagem entra na v3 junto com a contagem por caixa (PR 4) ou
   antes, com o PR 3?
9. **A prateleira em contagem.** Um estado próprio da rodada, ou o "em
   verificação" de Posições com a observação, até a porta por caixa existir
   (G16 a G19)?

*Decidido em 17/11/2026, ao avaliar as pranchas: a segunda contagem não
entra no sistema; a operação conta duas vezes, no papel, e grava só o número
conferido.*

*Respostas do Leonardo em 17/11/2026 às perguntas do canvas:* a contagem é
por caixa, com a caixa e o saldo gravados na mesma transação ("faça o que for
melhor"); a rodada pode ser geral, por rua ou por item; a diferença é
aprovada por qualquer admin (pergunta 2, em parte); a data FIFO da peça
achada a mais é a data da caixa, não o dia da contagem (pergunta 5, com a
concordância deste levantamento: a peça sempre esteve na caixa, e datar de
hoje a mandaria para o fim da fila e ao portal como "desde 17/11"); a folha e
o relatório entram antes da bancada (seção 6, item 1). E, conforme a
recomendação deste levantamento ("pode fazer conforme a sua recomendação",
17/11/2026): o ajuste acima do limite grava na hora e vai para a revisão do
admin, na lista das diferenças da rodada, sem ficar pendente nem travar o
chão; e a peça "fora da lista" entra sempre: com saldo do SKU em outra caixa
da mesma prateleira, a tela move entre caixas e o saldo da prateleira não
muda; sem saldo em caixa nenhuma da prateleira, a tela cria o saldo ali, com
a origem dita ("entrada em A-03"), e a prateleira onde a peça estava
registrada se acerta quando for contada.

## 8. Como este levantamento foi feito

Só leitura, em 17/11/2026, sobre o código desta branch (a `main` em
`72899bcc` mais os registros do acerto, `77f921f3`). Nada foi executado,
nenhum teste rodou, a produção não foi lida e `tmp/` e `.secrets/` ficaram
fechados. A tela foi lida a partir da captura do Leonardo e do código; o
estado da sessão de abertura da BTG (`completed`) é inferido do registro do
acerto de 30/10 e da operação desde então.

1. **Leitura direta** da tela (`inventory.tsx`, `wms-inventory.tsx`,
   `receiving.tsx`, `product-match.ts`, `estoque.tsx`, `movements.tsx`), da
   callable e da transação (`index.ts`, `cycle-count-input.ts`,
   `operations.ts`), das regras de caixa, FIFO, parados e cobrança, dos
   runbooks (`separacao-com-caixas.md`, `recebimento-com-caixas.md`,
   `fifo-por-data.md`, `mapa-do-armazem-enderecamento-dirigido.md`,
   `wms-abertura-correcoes.md`, `plano-de-implantacao.md`) e do
   `tools/acerto-btg-2026-10/README.md`.
2. **Sete frentes em paralelo** (a tela em sequência; a callable e a
   transação; caixas × razão; o fluxo da recontagem; eventos, memória, FIFO
   e dinheiro; testes e ensaio; permissões e dados), mais uma leitura
   dedicada à pergunta da abertura, cada uma devolvendo achados com arquivo,
   linha e trecho. Na primeira passada, quatro frentes caíram no limite de
   gasto da conta e foram refeitas depois da liberação; as outras voltaram do
   cache. Sete achados da leitura direta entraram na mesma esteira.
3. **Consolidação** dos achados das frentes em 33 únicos (F01 a F33), sem
   descartar nenhum.
4. **Verificação adversarial**: cada um dos 33 passou por um refutador (que
   leu o código citado e o entorno para provar o contrário) e por um juiz
   (testes e docs, relevância para a recontagem e severidade). Resultado: 33
   confirmados, nenhum refutado, nenhum em dúvida; as precisões dos
   revisores (o custo que fica no campo depois do sucesso, o preço do
   catálogo que não chega a quem não vê valor, o evento `info` da contagem
   que só confirma, as naturezas das divergências do acerto, o painel antigo
   fechado nos dois ambientes, o `axe` que já roda em dois estados) estão
   incorporadas ao texto.
5. **Crítico de completude**, que apontou as seis lacunas da seção 4.9;
   quatro receberam uma rodada própria de leitura, com 20 achados (G01 a
   G20) verificados do mesmo jeito: todos confirmados. No total, 120
   leituras independentes, 53 achados confirmados e nenhum refutado.

As frentes conferiram também as seções 2, 3 e 5 deste documento contra o
código. Linhas citadas valem para os commits acima; a numeração muda com o
próximo PR.
