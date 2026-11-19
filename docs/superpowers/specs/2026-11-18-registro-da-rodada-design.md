# O registro da rodada da contagem

Desenho aprovado pelo Leonardo em 18/11/2026, pela sessão que abriu este
trabalho (as duas decisões abaixo e as escolhas propostas). Registro
definitivo no diagnóstico da Contagem
(`docs/plataforma/diagnostico-contagem-ciclica.md`, seções 6, item 4, e 7),
que todo PR da Contagem atualiza. Foto aprovada:
`docs/mockups/contagem-entrada/02-iniciar-contagem.png`.

## Intenção e porquê

Desde o PR 625, a recontagem por caixa grava com um `round_id` fixo
(`recontagem-geral-2026-11-17`): o progresso da recontagem geral sai das
recontagens com esse id, lidas ao vivo, e não existe a rodada como registro.
Por isso a Contagem não tem "Iniciar contagem", nenhuma contagem termina e
"Anteriores" só mostra a abertura. O Leonardo decidiu em 17/11/2026 que a
rodada é a própria Contagem (o cartão "Rodada" e "Anteriores"), que ela pode
ser geral, por rua ou por item, e aprovou em 18/11/2026 a segunda foto da
entrada: "Iniciar contagem" no cabeçalho quando não há contagem em andamento,
e "Anteriores" com a recontagem geral concluída (período, quem, prateleiras,
caixas, diferença) e a abertura.

Este PR dá à rodada o registro: a coleção, iniciar e concluir com recibo e
evento, a bancada gravando com o id da rodada aberta e o servidor recusando
outro id.

## Decisões do Leonardo (18/11/2026)

1. **Concluir com prateleira por contar: conclui mesmo assim.** O diálogo
   mostra os números e avisa quantas prateleiras por contar ficam fora. A
   recontagem geral pode nunca chegar a 100% (prateleiras com pedido em
   separação esperam a entrega).
2. **Sem rodada aberta, a bancada e a Contagem por caixa não contam.** Dizem
   "Nenhuma contagem em andamento", com o link "Iniciar contagem" para a
   entrada. O progresso mora na rodada; o alcance "por item" cobre o caso de
   contar um item só.

As demais escolhas (abaixo) ficaram como propostas.

## Objetivos

- **Servidor (`functions/wms`):**
  - A coleção `count_rounds`, uma rodada por documento (o id é o `round_id`
    das recontagens): cliente, título, alcance (`general`, `aisle` com a rua
    ou `item` com o SKU e o nome), `status` `open` ou `closed`, quem e
    quando iniciou (`started_at`, `started_by`) e concluiu (`closed_at`,
    `closed_by`) e os números do fechamento (`shelves_total`,
    `shelves_counted`, `boxes_total`, `boxes_counted`,
    `boxes_with_difference`, `difference_units`, `recount_count`).
  - `startCountRound` e `completeCountRound`, uma linha cada no
    `src/index.ts`, para quem opera o armazém (owner, admin, interno e wms),
    idempotentes (recibo em `operational_operations`), com os eventos
    `inventory.round_started` e `inventory.round_closed` (`inbox: false`;
    sem valor, sem caixa nem prateleira no título). Uma rodada aberta por
    cliente de cada vez. O título é do servidor, no fuso do armazém:
    "Contagem geral · 19/11/2026", "Contagem da rua A · 19/11/2026",
    "Contagem de Polo Masculino Piquet Preto · P · 19/11/2026".
  - Os números do fechamento calculados pelo servidor, na transação de
    concluir, das recontagens da rodada (`cycle_counts` com o `round_id`) e
    das caixas do cliente: a mesma conta da tela (a última recontagem de
    cada caixa; a prateleira contada com todas as caixas confirmadas; a caixa
    com diferença pelos itens; a diferença líquida).
  - `recountWarehouseBox` recusa o `round_id` que não seja a rodada aberta
    do cliente (a concluída, a de outro cliente, a que não existe) e a
    prateleira fora do alcance da rodada (outra rua; a prateleira sem caixa
    guardada com o item). Sem `round_id`, segue como hoje.
  - **A recontagem geral de 17/11 vira documento ao concluir:** até lá, as
    recontagens com o id fixo e sem documento valem como a rodada aberta
    (a entrada, a rodada e a bancada a tratam assim; o servidor aceita o id
    fixo só enquanto o documento não existe). "Concluir contagem" nela cria
    o documento já concluído, com `started_at` e `started_by` da primeira
    recontagem. `startCountRound` recusa enquanto ela está assim. Nenhuma
    migração à mão, nenhum passo extra para a operação.
  - Linhas novas em `callables-papeis.integration.test.ts` (a
    `callables-auth` acha as callables sozinha), a regra de leitura em
    `firestore.rules` (`canReadOperations`, como `cycle_counts`), a coleção
    na zeragem (apagada com o estoque, como `cycle_counts`; a trava do teste
    ganha a linha) e a régua `billing-callables` verde. Nenhuma consulta nova
    pede índice composto: tudo por igualdade.
- **App:**
  - A entrada (`/wms/contagem`) lê as rodadas do cliente ativo ao vivo
    (`count_rounds` por `customer_code`): "Em andamento" com o cartão da
    rodada aberta, "Continuar", "Ver prateleiras" e "Concluir contagem";
    sem rodada aberta, "Iniciar contagem" no cabeçalho (o primário), com o
    diálogo do alcance (geral, por rua com a lista das ruas com caixa, por
    item com a busca no catálogo do cliente); "Anteriores" lista as rodadas
    concluídas, a mais recente primeiro (título; "17/11 a 21/11 · Guilherme
    Dantas"; "5 prateleiras · 6 caixas · 1 com diferença · −3 un."; "Ver"),
    e a abertura por último.
  - "Concluir contagem": o diálogo com os números da rodada e, com prateleira
    por contar, "3 prateleiras por contar ficam fora."; grava pela
    `completeCountRound`, com o `BotaoDeAcao`, e não fecha no meio (parte
    13a); no sucesso, fecha, com o toast, e a leitura ao vivo traz a rodada
    para "Anteriores".
  - A rodada (`/estoque/contagem/rodada`) e a bancada
    (`/estoque/contagem/prateleira`) usam o id da rodada aberta; com
    `?rodada=<id>` a rodada mostra aquela rodada só leitura (o cartão e as
    prateleiras com o estado nela, sem ações), o "Ver" das anteriores. Sem
    rodada aberta e sem `?rodada=`, as duas dizem "Nenhuma contagem em
    andamento." com "Iniciar contagem".
  - Por rua, a rodada e o cartão contam só as prateleiras da rua; por item,
    só as prateleiras com caixa guardada que tem o item (`sku_codes`),
    contadas inteiras (decisão de 18/11/2026).
  - A rodada aberta dá o começo do cartão ("começou 19/11 08:10 · Guilherme
    Dantas", de `started_at`/`started_by`); a recontagem geral sem documento
    continua com o começo da primeira recontagem.
  - Tudo na v3, sem legenda, com a lista de textos e o `axe`; carregamento
    v2 (`LinhaDeEstado`, esqueleto, a falha nunca vira vazio, o diálogo que
    grava não fecha no meio); só tokens de cor; teste de espera sem tempo
    fixo de relógio real.
- **Registro:** o diagnóstico (seção 6, item 4, e seção 7), o README dos
  mockups (a linha da foto 02) e o CLAUDE.md (a descrição da Contagem).

## Não objetivos

- O limite da diferença e a fila de revisão do admin: outro PR; nada aqui
  depende do limite.
- A prateleira "em contagem" como estado da rodada respeitado pela separação
  e pela guarda: outro PR.
- "Cadastrar caixa" (a caixa física sem registro) e a linha separada antes de
  contar: outros PRs.
- A bancada de uma rodada concluída (`?rodada=` na bancada): o "Ver" das
  anteriores para na rodada.
- Reabrir uma rodada concluída, ou uma rodada por outro critério (por
  cliente já é a fronteira).
- A aba cíclica (`/wms/contagem/abertura`) não muda.

## Restrições

- Um problema por PR, com o teste que falha antes. Nada sobe sem o OK do
  Leonardo; sem merge automático.
- Callable escrita como `export const nome = onCall(`, numa linha, no
  `src/index.ts`; a porta `getProfile` e `requireWarehouseWrite` antes da
  entrada; `requireCustomerScope` dá o cliente.
- Chamada de callable sem campo `undefined` (`semCamposVazios`).
- As recontagens gravadas na produção com o id fixo não se perdem nem mudam:
  a rodada da recontagem geral é identificada por aquele id.
- Teste novo das Functions entra na lista fixa do `test:unit` ou do
  `test:integration` no `package.json`.
- Nenhuma escrita em `catalog_prices`; a rodada não vê valor.

## Modelo

```
count_rounds/{round_id}
  id                      "cr_<24 hex>" (a recontagem geral: "recontagem-geral-2026-11-17")
  customer_code           "BTG Pactual"
  title                   "Contagem geral · 19/11/2026"
  scope                   "general" | "aisle" | "item"
  aisle?                  "A"                      (scope aisle)
  sku_code?               "BTG-000122"             (scope item)
  item?                   { client_item_code, product_name, size }
  status                  "open" | "closed"
  started_at, started_by  ISO, { uid, role, email, name }
  closed_at?, closed_by?
  shelves_total?, shelves_counted?, boxes_total?, boxes_counted?,
  boxes_with_difference?, difference_units?, recount_count?
  created_at, updated_at  serverTimestamp
```

`startCountRound({ customer_code, scope, aisle?, sku_code?, idempotency_key })`
devolve `{ ok, round_id, title, scope, aisle?, sku_code?, status: "open",
started_at, events }`. Recusas: `COUNT_ROUND_ALREADY_OPEN` (a rodada aberta,
com o título), `COUNT_ROUND_LEGACY_OPEN` (a recontagem geral sem documento),
`COUNT_ROUND_AISLE_NOT_FOUND`, `COUNT_ROUND_PRODUCT_NOT_FOUND` (e o dono
errado, `CATALOG_OWNED_BY_OTHER_CUSTOMER`).

`completeCountRound({ customer_code, round_id, idempotency_key })` devolve a
rodada concluída (`{ ok, round_id, title, status: "closed", started_at,
closed_at, shelves_total, …, events }`). Recusas: `COUNT_ROUND_NOT_FOUND`,
`COUNT_ROUND_NOT_OPEN` (já concluída), `permission-denied` (de outro
cliente).

`recountWarehouseBox` com `round_id`: `BOX_RECOUNT_ROUND_NOT_FOUND`,
`BOX_RECOUNT_ROUND_CLOSED`, `BOX_RECOUNT_OUT_OF_SCOPE` (a frase diz a rodada e
a prateleira).

## Abordagens

1. **A rodada como documento próprio, iniciada e concluída por callables; a
   recontagem geral de 17/11 registrada ao concluir.** Escolhida: o registro
   fica onde a tela já lê (o `round_id` das recontagens), a bancada muda só
   o id que manda, e a transição não pede migração nem passo da operação.
2. A rodada inferida das recontagens, sem documento (o dia, ou o id fixo
   para sempre): não há como iniciar, concluir nem listar as anteriores, e
   o alcance por rua ou por item não tem onde morar.
3. Registrar a recontagem geral de 17/11 por script, da máquina do
   Leonardo, antes de publicar: um passo a mais, com a tela travada entre a
   publicação e o script; a opção 1 cobre o mesmo sem ele.
4. Os números do fechamento mandados pela tela, como ela os viu: mais
   simples no servidor, mas o registro ficaria com a conta de quem concluiu;
   o servidor tem as recontagens e as caixas e faz a mesma conta.

## O que fica com quem constrói

- O id da rodada nova (`cr_` e um digest do cliente e da chave), nunca
  digitado.
- A forma do diálogo "Iniciar contagem" (as três opções do alcance, a lista
  das ruas, a busca do item) e do "Concluir contagem" (os números e o aviso),
  dentro da v3 e do carregamento v2.
- A ordem e o espaçamento das linhas de "Anteriores", com a foto 02 como
  referência; "17/11 a 21/11" vira "21/11" quando começa e termina no mesmo
  dia; "sem diferença" no lugar de "0 com diferença · 0 un.".
- O esqueleto da entrada enquanto lê as rodadas e para onde vai o foco quando
  o diálogo fecha.

## Ajustes da revisão final (19/11/2026)

A revisão de contexto novo da branch apontou um crítico e três importantes, e
um achado menor subiu para importante (o pedido diz "diálogo que grava, não
fecha no meio"). Corrigidos com o teste que falha antes:

- O teste de integração de `count_rounds` entrou na lista fixa do
  `test:integration` (sem ela, o CI não o rodava).
- `startCountRound` recusa o alcance sem caixa guardada do cliente
  (`COUNT_ROUND_EMPTY_SCOPE`: "Nenhuma caixa guardada do cliente na rua C.",
  "Nenhuma caixa guardada com Boné Preto.", "Nenhuma caixa guardada do
  cliente: não há prateleira para contar."), e a entrada mostra o cartão da
  rodada aberta mesmo sem prateleira no alcance (o PR 630 escondia a seção
  com 0 prateleiras; com o registro, esconder deixaria a rodada sem saída).
- A recontagem geral de 17/11 (o id fixo sem documento) vale só para o
  cliente legado, a BTG (`LEGACY_CUSTOMER_CODE`), no servidor e no app:
  outro cliente com recontagem nesse id não fica preso nela, e aquelas
  recontagens ficam como histórico.
- O "Ver" da rodada concluída mostra os números gravados no fechamento, e
  não os recalculados com as caixas de hoje.
- Os diálogos de iniciar e de concluir ficam até a resposta, mesmo quando a
  leitura ao vivo traz a rodada nova (ou tira a concluída) antes dela.

