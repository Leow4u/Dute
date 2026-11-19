# Mover caixa entre prateleiras

Desenho do "Mover caixa", uma caixa por vez, de uma prateleira para outra.
Decisões do Leonardo em 19/11/2026 (abaixo). Registro definitivo, quando
entrar, no diagnóstico da Contagem
(`docs/plataforma/diagnostico-contagem-ciclica.md`, seção 6, item 5, achado
F03) e no CLAUDE.md, como os PRs da Contagem fizeram. Mockup:
`docs/mockups/mover-caixa/` (fotos dos componentes reais, a aprovar).

## Intenção e porquê

A recontagem geral da BTG (17 a 19/11/2026) deixou as caixas certas, mas
espalhadas: o mesmo produto em várias prateleiras e prateleiras cheias ao
lado de vazias. O Leonardo quer reorganizar: tirar a caixa de uma prateleira
e centralizar em outra mais vazia. Hoje não existe ação para isso:

- a prateleira só é escolhida ao guardar (`suggestPosition`, em
  `functions/wms/src/domain/warehouse-boxes.ts`);
- "Corrigir caixa" (`moveOpeningInventoryLine`) só vale com a abertura
  aberta, e a da BTG está concluída;
- "Guardar" (`domain/area-putaway.ts`) só tira das áreas RECEBIMENTO e
  EXPEDICAO;
- o lançamento manual de Estoque › Itens (`createInventoryMovement`) faz a
  SAÍDA e a ENTRADA à mão, não atômicas, com o local em texto livre, e não
  muda o registro da caixa: o Mapa, a etiqueta, a separação, o Caixas ×
  saldo e o FIFO ficam errados.

Até o "Mover caixa" existir, a orientação é não mover caixa fisicamente.

## Decisões do Leonardo (19/11/2026)

1. **Quem move:** a coordenação e quem opera (owner, admin, interno e wms).
2. **O destino:** o sistema sugere, priorizando a prateleira com o mesmo
   produto e depois a mais vazia; a pessoa pode trocar à mão por outra
   prateleira.
3. **Uma caixa por vez**, sem lista de reorganização impressa.
4. **Onde fica (opção A):** "Mover" em cada caixa da ficha da prateleira no
   Estoque › Mapa (o desenho do mapa já previa "Mover caixa ... pela ficha",
   `docs/mapa-do-armazem-enderecamento-dirigido.md`, seção 5.6) e "Mover
   caixa" no topo do Mapa; os dois abrem uma página v3 de uma caixa. A
   bancada e a entrada da Contagem ficaram de fora: a bancada só existe com
   contagem aberta, e o mover recusa justamente a prateleira da contagem.
   O mockup foi aprovado no mesmo dia (`docs/mockups/mover-caixa/`).
5. **A reserva também no destino:** a caixa não vai para uma prateleira
   onde algum item dela está reservado; essa prateleira sai da sugestão e
   aparece como "Com reserva" na escolha à mão, até a entrega.

## Objetivos

- Mover uma caixa guardada de uma prateleira para outra da zona do cliente,
  numa transação só: o registro da caixa, o saldo de cada item nas duas
  prateleiras, o razão, as linhas da abertura da caixa, o evento e o recibo.
- Sugerir o destino (mesmo produto, depois a mais vazia) e listar as outras
  prateleiras onde a caixa cabe, para a troca à mão.
- Depois de mover, o Mapa, o Caixas × saldo, a lista de separação, a
  separação no servidor e as datas do FIFO continuam certos, e a etiqueta
  nova sai.

## Fora do escopo

- Lista ou plano de reorganização (decisão 3); a "reorganização sugerida"
  da fase 2 do mapa continua para depois.
- Mover parte do conteúdo de uma caixa para outra (isso é o acerto ou a
  correção de código).
- Mover de ou para as áreas de passagem (isso é a guarda).
- Mudar a ordem da sugestão da guarda (`suggestPosition` fica como está).
- Cobrar: o mover fica fora de `billing-scope` (só `wms_receiving` e
  `wms_shipping` cobram) e fora do relógio dos parados (`ORIGENS_QUE_CONTAM`).
- Mudar o que o portal mostra: as duas pontas são prateleiras, o
  `client_inventory` não muda.

## O que achei no código e muda o desenho

1. **A sugestão de hoje é outra ordem.** `suggestPosition` faz: mesmo SKU
   (nível 1), a mais perto da prateleira que tem o SKU (nível 2), a primeira
   da caminhada com espaço (nível 3), e desempata pela menor sobra de frente
   (o encaixe mais justo, o contrário de "a mais vazia"). O mover ganha uma
   ordem própria; a guarda não muda.
2. **O conteúdo da caixa da abertura mora nas linhas da abertura, com a
   prateleira.** `opening_inventory_lines` guarda `box_code` e
   `location_id`. A separação no servidor acha o conteúdo das caixas de uma
   prateleira por essas linhas, pela prateleira
   (`lerCaixasDaPrateleira`, `domain/box-balance.ts`, usada por
   `pick-progress.ts`), e a recontagem também (as outras caixas da
   prateleira, no item fora da lista). As ferramentas do acerto preferem o
   local da linha ao da caixa. Mover só a caixa a deixaria vazia no
   destino: o mover leva as linhas junto (o app já lê pelo `box_code`).
3. **As datas do FIFO erram na origem.** A conta (`datas-do-saldo.ts`)
   supõe que o que fica numa prateleira são as entradas mais recentes nela.
   Se a caixa movida for mais nova que as que ficam, a origem fica com a
   data dela, e o portal (as datas por dia do cliente) conta a caixa duas
   vezes. A ENTRADA do mover diz de onde a caixa veio, e a conta tira essas
   peças, daquele dia, da origem.
4. **"Etiquetas para trocar" só pega a caixa aberta** (com saída ou ajuste
   de recontagem: `caixaAberta`, `domain/box-relabel.ts`, e
   `boxNeedsRelabel` no app). A etiqueta imprime a prateleira
   (`lib/warehouse-labels.ts`), então a caixa intacta movida também precisa
   entrar, até a impressão ser registrada.
5. **A contagem aberta trava o mover.** O alcance da rodada é calculado das
   caixas de cada prateleira (`prateleiraNoAlcance`, `count-rounds.ts`), e a
   recontagem só vale na prateleira em que foi feita. Mover uma caixa de ou
   para uma prateleira da contagem aberta mudaria os números dela. Com uma
   contagem geral aberta (e a recontagem geral de 17/11, enquanto não for
   concluída, é a geral da BTG), nenhuma caixa do cliente se move.

## A ordem da sugestão do mover

Uma função nova em `warehouse-boxes.ts` (nome a definir no plano, ao lado de
`suggestPosition`, sem mudá-la), pura e determinística:

- **As prateleiras que entram:** as da zona do cliente
  (`warehouse_positions.customer_code`), ativas (nem `review` nem
  `blocked`), não a de origem, sem reserva de nenhum item da caixa
  (decisão 5), fora da contagem aberta (o destino conferido
  como ficaria depois do mover, já com a caixa; a origem, como está, antes
  de a caixa sair) e onde a caixa cabe pelo
  encaixe estrito do motor (`placementFor`, com as medidas da caixa e os
  `allow_tilt` e `allow_stacking` gravados nela; a ocupação de
  `buildOccupancy` com as caixas `stored` e `committing` e os saldos).
- **A ordem:** primeiro as que têm algum item da caixa em saldo (nível 1,
  "mesmo produto"); depois as outras (nível 2). Em cada nível, a de mais
  frente livre primeiro (a frente da prateleira menos a usada, antes de
  pôr a caixa, em metros: a mesma unidade do motor); no empate, a ordem de
  caminhada (`sequence`) e o código.
- **O motivo:** nível 1, "Já tem Polo Masculino Piquet Preto · M e ainda
  cabe." (o nome com o tamanho, como a tela mostra); nível 2, "A mais vazia
  da zona: 1,78 m livres de frente.".
- **A sugestão** é a primeira; as duas seguintes vão como alternativas,
  como na guarda.

## Servidor (PR 1)

### As callables (`functions/wms`, codebase `default`)

Duas, para quem opera o armazém (`requireWarehouseWrite`: owner, admin,
interno e wms), no molde de `recountWarehouseBox` (a entrada pelo Zod com a
frase para quem opera, o cliente por `requireCustomerScope`):

- **A prévia (só leitura):** a caixa (código, situação, prateleira, os itens
  com o saldo da caixa pela regra de `lib/dominio/src/saldo-da-caixa.ts`,
  nome, tamanho e código do cliente, as unidades, a origem e a data, as
  medidas e o peso), a recusa que já se sabe (código e frase) ou nada, a
  sugestão com o motivo e as alternativas, a lista das prateleiras onde a
  caixa cabe, na ordem acima (código, nível, frente livre, caixas
  guardadas), as que não cabem e as que têm reserva de algum item da caixa
  (só os códigos).
- **O mover (escrita):** `customer_code`, `box_code`, `from_location_id`
  (a prateleira que a tela viu), `to_location_id`, a sugestão que a tela
  mostrou (para o evento dizer se foi seguida) e `idempotency_key`. Recibo
  em `operational_operations` (`warehouse.box.move`), com o mesmo resultado
  na repetição e a recusa da chave usada com outro conteúdo.

### A transação do mover

Lê tudo antes de escrever, como a recontagem:

1. O recibo; o congelamento do estoque (`assertInventoryOperationsEnabled`).
2. A caixa: existe, é do cliente, está `stored` e em `from_location_id`.
3. As duas prateleiras (`warehouse_positions`), as caixas guardadas e a
   caminho no destino (para o encaixe), a caixa que tem esta como apoio, as
   linhas da abertura da caixa (`box_code`), os saldos de cada SKU do
   cliente (`skuBalancesQuery`), as reservas de cada SKU na origem e no
   destino, a
   rodada aberta do cliente (`count_rounds` aberto e, na BTG, a recontagem
   geral de 17/11 sem documento) e a sessão de abertura do cliente.
4. As recusas (abaixo).
5. As escritas:
   - **A caixa:** `location_id` no destino; o encaixe no destino
     (`front_m`, `depth_m`, `placed_height_m`, `orientation`,
     `support_box_code`, `base_height_m`, pelo `placementFor`);
     `moved_at`, `moved_from_location_id`, `moved_by`, `move_count` e
     `last_move_id`. O `stored_at` não muda: ele é a ordem de saída da
     separação (`ordemDeSaida`) e o dia do FIFO da caixa.
   - **As prateleiras:** `occupancy_revision` +1 nas duas, como a guarda e
     a remoção (serializa com a confirmação concorrente de destino).
   - **As linhas da abertura da caixa:** `location_id` no destino; a
     primeira prateleira fica em `opening_location_id` (o registro da
     abertura não se perde).
   - **Por item, com o saldo da caixa:** o saldo da origem desce, o do
     destino sobe (criado se não existe), e o razão ganha a SAIDA na origem
     e a ENTRADA no destino, com a origem `functions_box_move`, o
     `movement_kind` `box_move_out` e `box_move_in`, a caixa e as duas
     prateleiras. A ENTRADA leva a data FIFO da caixa como a recontagem:
     `fifo_opening_session_id` na caixa da abertura, `fifo_day` (o dia de
     São Paulo do `stored_at`) nas outras, e `fifo_from_location_id` com a
     origem. Sem preço (o custo não entra), sem `client_inventory` e sem os
     agregados do catálogo: os totais não mudam.
   - **O evento** `warehouse.box_moved` (`inbox: false`, `entity_type`
     `warehouse_box`): o título com a caixa e as duas prateleiras; no
     payload, os itens, as unidades, se seguiu a sugestão e as
     alternativas. A caixa no título faz o rascunho de aviso, se houver,
     ser interno (`citaCaixa`, `index.ts`): o cliente nunca vê caixa nem
     prateleira.
   - **O recibo.**

### As recusas

Cada uma com o código no `details`, como a recontagem:

| Situação | Código |
|---|---|
| A caixa não existe, é de outro cliente ou não está guardada (a caminho, vazia, em conferência) | `BOX_MOVE_BOX_NOT_FOUND`, `permission-denied`, `BOX_MOVE_BOX_NOT_STORED` |
| A caixa não está mais onde a tela viu | `BOX_MOVE_WRONG_SHELF` |
| O destino não está em Posições, é área de passagem, é a mesma prateleira, está em verificação ou bloqueado, ou é de outra zona | `BOX_MOVE_SHELF_NOT_FOUND`, `BOX_MOVE_NOT_A_SHELF`, `BOX_MOVE_SAME_SHELF`, `BOX_MOVE_SHELF_UNAVAILABLE`, `BOX_MOVE_OTHER_ZONE` |
| A caixa não cabe no destino pelo encaixe estrito | `BOX_MOVE_DOES_NOT_FIT` |
| Outra caixa está em cima desta | `BOX_MOVE_SUPPORTS_ANOTHER` |
| Algum item da caixa tem reserva na origem (o pedido aprovado, em separação ou separado esperando a entrega) | `BOX_MOVE_RESERVED` |
| Algum item da caixa tem reserva no destino (decisão 5) | `BOX_MOVE_DESTINATION_RESERVED` |
| A origem ou o destino está na contagem aberta | `BOX_MOVE_COUNT_ROUND_OPEN` |
| A abertura do cliente está em andamento | `BOX_MOVE_OPENING_OPEN` |
| A prateleira de origem tem menos do item do que a caixa diz (precisa do acerto antes) | `BOX_MOVE_SHELF_SHORT` |
| Mais de um saldo do item na mesma prateleira | `BOX_MOVE_DUPLICATED_BALANCE` |

A reserva é por item e prateleira, não por caixa: "a caixa com reserva" é a
que tem algum item reservado na prateleira de origem. A regra estrita evita
que a lista de separação impressa, que diz a caixa de cada item, mande
alguém buscar na prateleira uma caixa que saiu dali. No destino vale o
mesmo (decisão 5): a caixa movida guarda o `stored_at`, então pode virar a
mais antiga do item ali, e a separação em andamento registraria a saída
dela enquanto a lista impressa manda tirar de outra caixa; o total da
prateleira fecharia, mas o saldo das duas caixas ficaria trocado até a
próxima recontagem.

A contagem aberta confere a origem como está, antes de a caixa sair, e o
destino como ficaria, já com a caixa. Conferir a origem depois deixaria,
numa contagem por rua, a última caixa de uma prateleira da rua sair para
outra rua sem ter sido contada, e a contagem fecharia como toda contada.

### O FIFO (`datas-do-saldo.ts`)

`entradasDoRazao` lê a ENTRADA com `fifo_from_location_id` (a do mover)
duas vezes: põe as peças no dia dela no destino, como hoje, e tira as mesmas
peças do mesmo dia na origem, depois de juntar todas as entradas (nunca
abaixo de zero). Os leitores (`lerDatasDoEstoque` e o alocador do pedido)
já leem todas as ENTRADAs do SKU, então nenhuma consulta muda. O cabeçalho
do arquivo e `docs/plataforma/fifo-por-data.md` dizem a regra; os casos
entram em `datas-do-saldo.test.ts`.

### A etiqueta (`box-relabel.ts` e o app)

- A caixa movida pede etiqueta nova até a impressão registrada:
  `moved_at` diferente de `location_label_printed_for`.
- `recordBoxBalanceLabelPrint` registra também a caixa movida (hoje pula a
  intacta): grava `location_label_printed_for = moved_at`, além do que já
  grava para a caixa aberta.
- No app, `boxNeedsRelabel` e o registro da impressão na tela de etiquetas
  (`saldosParaRegistrar`) seguem a mesma regra.

### Testes e travas

- Unitários (`node --test`, na lista do `test:unit`): a ordem da sugestão,
  o alcance da contagem depois do mover, as frases das recusas, o FIFO com
  o mover e a regra da etiqueta.
- Integração (emulador, na lista do `test:integration`): mover A-01 → B-09
  pela sugestão e pela troca à mão (saldos, razão, linhas da abertura,
  caixa, evento, recibo e repetição); cada recusa; as datas do FIFO das
  duas prateleiras depois do mover (`lerDatasDoEstoque`); a separação no
  destino achando a caixa (`lerCaixasDaPrateleira`); o `client_inventory`
  igual; a impressão registrada tirando a caixa da lista.
- As linhas das duas callables em `callables-auth.integration.test.ts` e
  `callables-papeis.integration.test.ts`; os índices conferidos pelo job de
  integração (`tools/registrar_consultas.cjs`); a régua
  `billing-callables.integration.test.ts` verde, com um mover no meio do
  fluxo sem mudar a prévia da cobrança.
- Nenhuma coleção nova: a zeragem não muda.

## Tela (PR 2)

Fotos do mockup em `docs/mockups/mover-caixa/` (a aprovar).

- **A página `/estoque/mapa/mover`** (na v3, `TELAS_DO_WMS_NA_V3`; o shell
  marca o Mapa), para owner, admin, interno e wms. `?caixa=CX-000121` abre
  a caixa; sem ela, o campo "Caixa" (digitar ou ler o código) e "Abrir".
  - O cartão da caixa: o código, a situação, "em A-01", as unidades, os
    itens (quantidade × nome · tamanho, com o código do cliente), a origem,
    a data e as medidas.
  - "Mover para", com "Sugestão do sistema" e "Escolher prateleira" (o
    segmentado do Receber): a sugestão (a prateleira, o motivo, "1,42 m
    livres · 2 caixas", o selo "mesmo produto" e as alternativas) e "Mover
    para B-09"; ou a lista das prateleiras onde a caixa cabe, na ordem da
    sugestão, com o selo e a frente livre, as oito primeiras e "Ver as N
    prateleiras", "Não cabe: A-02 · B-11", "Com reserva: B-10" e "Mover
    para C-02".
  - Movida: "CX-000121 em B-09", "saiu de A-01 · 20 un. · 19/11 14:32 ·
    Leonardo", "Imprimir etiqueta" (a tela de etiquetas com a caixa, que
    registra a impressão) e "Mover outra caixa". No cabeçalho, "Etiquetas
    para trocar · N" com as caixas movidas sem etiqueta nova, quando são
    duas ou mais.
  - A recusa no lugar do "Mover para", com a frase do servidor.
- **O Mapa** (fica no visual de hoje): "Mover caixa" no cabeçalho e, no
  cartão de cada caixa guardada da ficha da prateleira, "Etiqueta" e
  "Mover" no rodapé (no cabeçalho do cartão não cabem os dois). Só para
  quem move.
- O carregamento v2 (`BotaoDeAcao`, `CarregandoNaRegiao`, a falha que nunca
  vira vazio), sem legenda, com o teste dos textos (`src/test/textos.ts`) e
  o `axe` (`src/test/acessibilidade.ts`).
- O histórico do item (Estoque › Itens) diz o movimento do mover com o
  rótulo dele, sem caixa nem prateleira para o cliente.

## Pronto quando

No emulador: mover uma caixa de A-01 para B-09 pela sugestão e outra pela
troca à mão deixa o Mapa, o Caixas × saldo, a lista de separação e as datas
do FIFO certos, e a etiqueta nova sai e tira a caixa de "Etiquetas para
trocar". O diagnóstico (seção 6, item 5) e o CLAUDE.md registram. Produção
só com o OK do Leonardo.

## Escolhas minhas, para conferir

- A reserva é a regra estrita: qualquer item da caixa reservado na origem
  recusa (o porquê está nas recusas); no destino, a decisão 5.
- A abertura em andamento recusa o mover (na abertura existe o "Corrigir
  caixa"; a da BTG está concluída).
- Sem motivo digitado: o mover é o próprio motivo; o evento diz se a
  pessoa seguiu a sugestão.
- "A mais vazia" é a de mais frente livre em metros, a unidade do motor.
- O suporte vê o Mapa, mas não o "Mover" nem a página.
- Sem liberação por ambiente: a produção recebe só pela publicação manual,
  como a recontagem e a rodada.
- A idade da caixa nos Alertas ("Parado 90+ dias", `idadeDaCaixa` em
  `lib/dominio/src/parados.ts`) conta a guarda e a última saída dos itens
  na prateleira em que a caixa está: depois do mover, conta as saídas da
  prateleira nova, e o rótulo de uma caixa movida pode mudar. Fica assim
  neste trabalho; o relógio do item (o alerta ao cliente) não muda, porque
  o mover está fora de `ORIGENS_QUE_CONTAM`. Se incomodar, a caixa leva a
  última saída junto, num PR próprio.
- Dois PRs: o servidor primeiro (com a etiqueta e o FIFO), a tela depois.
