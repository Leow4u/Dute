# Fase 7: financeiro unificado

Desenho e registro da Fase 7 do plano de implantação
(`plano-de-implantacao.md`, seção 9). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Um só lugar para faturar a armazenagem e as OS.
- Um só a receber, no Financeiro.
- Uma fatura por cliente e competência, quando o contrato fatura por mês.
- A NF e a contabilidade por integração (parte 7.4, com o fornecedor que o
  Leonardo escolher).

## O que existe hoje

### O faturamento do WMS (Armazenagem › Faturamento, `/faturamento`)

- **As callables** estão em `functions/wms/src/index.ts`:
  - `getBillingPreview` dá a prévia;
  - `saveBillingManual` grava as quantidades manuais;
  - `emitBillingInvoice` emite a competência;
  - `payBillingInvoice` marca como paga.
  - Leem owner, admin, financeiro e suporte. Gravam owner, admin e
    financeiro.
- **A conta** fica em `functions/wms/src/billing.ts` (dinheiro em BigInt,
  centavos arredondados por linha) e em `loadBillingCalculation`, privada do
  `index.ts`.
  - A LPU é a `billing_price_list`. O ad valorem sai do valor da mercadoria
    (`catalog_prices` e `client_inventory`).
  - As entradas, as saídas e os movimentos são os do mês, no horário de São
    Paulo. Depois da virada, só o recebimento e a expedição do WMS contam.
  - O mês fechado tem o uso congelado uma vez em
    `billing_operational_snapshots` (`ensureFrozenBillingUsage`).
- **A emissão** congela a fatura em `billing_periods.invoice_snapshot` e
  projeta `client_invoices` para o portal.
  - Os status são `aberto`, `emitido` e `pago`.
  - Cada documento leva o total em centavos e em reais.
  - Não há vencimento, NF nem pagamento parcial.
- **A LPU de cobrança** é editada na Tabela de preços (`/faturamento/tabela`)
  e, na criação, vale só para a BTG.

### O financeiro da demanda (Fase 4, `/financeiro`)

- `registerNf` registra a NF das demandas a faturar e cria a `fatura`:
  - em centavos, com vencimento e forma;
  - status `emitida`, `enviada`, `paga` ou `cancelada`; "vencida" é
    calculada.
- `advanceFatura` envia, recebe (`pagamentos`), estorna e cancela.
  `client_faturas` é a projeção para o portal.
- O a receber do app lê só `faturas`. A fatura do WMS não aparece no shell do
  Financeiro: o item "Armazenagem" do menu leva ao `/faturamento`.

### O catálogo do Comercial

- `lpu_items` não tem preço. Os itens de armazenagem não se orçam, porque "a
  cobrança é do WMS".
- O preço mora em `price_tables`: imutável, por cliente ou contrato, com
  vigência e o preço em texto decimal exato.
- O contrato tem o regime de faturamento: por demanda, medição mensal ou WMS.

## Decisões

Seguem a recomendação até a resposta do Leonardo:

| Pergunta | Recomendação seguida |
|---|---|
| 21 | O fornecedor da NF-e, da NFS-e e da contabilidade fica para a parte 7.4. Até lá, a NF segue registrada à mão no Financeiro, como na Fase 4, também a da armazenagem. |
| 22 | A demanda que perdeu o prazo de faturamento ganha o motivo de perda "prazo de faturamento", aceito só quando o alerta de faturamento venceu. |

- **O a receber é um só: `faturas`.**
  - A competência emitida no WMS passa a ser um item "A faturar" do
    Financeiro, como a demanda.
  - Registrar a NF dela cria a fatura com a origem "armazenagem", o
    vencimento e a forma. A cobrança é a mesma da Fase 4.
  - O cliente com medição mensal fecha a competência numa NF só: a
    armazenagem e as demandas do mês.
- **O WMS continua calculando a armazenagem.** A prévia, o congelamento e a
  emissão ficam onde estão: a emissão do WMS é o "fechado para faturar".
  - O Financeiro não recalcula: lê o total congelado da competência
    emitida.
  - Pagar a fatura da armazenagem marca a competência do WMS como paga, na
    mesma transação, com o evento. O botão de pagar do WMS sai onde o
    Financeiro está liberado.
- **Os dois vocabulários ficam, cada um no seu lugar.** No WMS, `emitido` é
  "fechado para faturar". No Financeiro, `emitida` é a NF registrada. O
  desenho de cada parte diz a passagem de um para o outro.
- **A LPU de cobrança** passa para o catálogo e as tabelas do Comercial (parte
  7.3), com a vigência. A fatura do WMS calcula igual antes e depois: o teste
  da 7.1 é a régua.
  - O item do WMS continua dizendo como a linha se calcula (a fonte
    automática, o grupo e a ordem). O preço passa a ser do Comercial.
  - Vale a tabela do cliente vigente no último dia da competência. Recomendação
    até a resposta do Leonardo: o mês que muda de tabela no meio fatura pelo
    preço do fim.
  - Sem a tabela com o item, ou com duas do cliente no mesmo dia, a conta
    recusa. O preço de dinheiro nunca se adivinha.
  - O ad valorem segue com a taxa do `billing_config`.
- **Antes de mexer nas trilhas de dinheiro do WMS, os testes** (parte 7.1,
  como o `CLAUDE.md` exige).
  - Eles chamam as callables de verdade no emulador, pelo `.run` do
    `onCall`, sem mudar o código.
  - Nenhuma parte seguinte refatora o `index.ts` ou o `operations.ts` sem
    eles.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 7.0 | O desenho (este documento) | — |
| 7.1 | Os testes das trilhas de dinheiro do WMS: a prévia, o uso congelado, a emissão, o pagamento, as quantidades manuais, a virada e o isolamento por cliente | Os casos fixam o comportamento de hoje, com os números resolvidos à mão |
| 7.2a | `registerNf` registra a NF da armazenagem que o WMS emitiu, sozinha ou com as demandas do mesmo cliente, pelo total congelado; cancelar devolve a competência; o WMS não paga a competência que está numa NF | Só a emitida e fora de NF entra; o total é o da foto; outro cliente recusa; a faturada não fatura de novo |
| 7.2b | A competência emitida no "A faturar" do Financeiro e na NF, no app | Só a emitida e sem NF aparece, no grupo do cliente dela, com o total da foto |
| 7.2c | Receber e estornar a fatura da armazenagem marcam a competência do WMS, com o evento; o pagar do WMS sai onde o Financeiro está liberado | A competência fica paga uma vez; o estorno volta a emitida |
| 7.3a | O item da LPU de cobrança ligado ao catálogo do Comercial tira o preço da tabela do cliente vigente no último dia da competência | O item sem ligação calcula igual (a régua da 7.1); sem tabela ou com duas, recusa; a foto guarda a tabela |
| 7.3b | Levar a LPU de cobrança de um cliente ao Comercial: os itens no catálogo, a tabela "Armazenagem" com os preços de hoje e a ligação de cada item, numa transação | A fatura calcula igual antes e depois da passagem |
| 7.3c | A Tabela de preços do WMS mostra de onde vem o preço | O item ligado não edita o preço no WMS |
| 7.4 | A integração da NF e a exportação contábil, com o fornecedor escolhido | Emissão idempotente; a falha não marca a fatura como emitida |
| 7.5a | O motivo de perda "prazo de faturamento" no servidor, aceito só com o prazo do contrato vencido, também a partir de A faturar | Sem o prazo vencido recusa; os outros motivos seguem só antes de faturar |
| 7.5b | A ação "Perder por prazo" na tela Autorizações, na demanda com o prazo vencido | Só a linha vencida tem a ação; o motivo vem fixo |
| 7.5c | Contratos e Autorizações no shell do Financeiro, só leitura | O Financeiro lê sem editar itens nem preço |

**Pronto quando** uma competência fecha com a armazenagem e as OS na mesma
fatura, a NF sai pela integração e o a receber é um só.

**Liberação.** As partes de tela seguem `FINANCEIRO_AMBIENTES_LIBERADOS`
(só o `dute-homolog`, até a parte 4.9b). O faturamento do WMS segue como está
fora dela.

## Registro

### Parte 7.1: os testes das trilhas de dinheiro do WMS

Feita em 23/10/2026, em
`functions/wms/src/billing-callables.integration.test.ts`.

- **Como.**
  - O teste importa o `index.ts` do WMS no emulador e chama as callables
    pelo `.run`, com o `auth` de cada papel.
  - Nada no código muda. Os números são resolvidos à mão no próprio teste.
- **O que fixa:**
  - **A prévia do mês fechado:**
    - o ad valorem sobre o valor da mercadoria, com a taxa do
      `billing_config`;
    - as entradas, as saídas e os movimentos do mês no horário de São Paulo;
    - o movimento `billable: false`, o do mês seguinte e o de outro cliente
      ficam de fora;
    - o item inativo sai;
    - o item com fonte sem uso (pallet) fatura zero;
    - o item sem cliente vale para a BTG.
  - **O uso congelado:** a primeira prévia do mês fechado grava a foto uma
    vez. O movimento que chega depois não muda a prévia nem a emissão.
  - **A emissão:**
    - o período emitido com a foto e o mesmo total da prévia;
    - o `client_invoices` do portal com o total, `emitido` e `issued`;
    - o evento uma vez;
    - emitir de novo não muda nada;
    - depois de emitida, a prévia é a foto, mesmo com o preço mudado.
  - **O mês em aberto** não emite, e a prévia dele não congela nada.
  - **As quantidades manuais:**
    - a mesma chave não grava duas vezes;
    - com outro conteúdo, recusa;
    - depois da emissão, recusa.
  - **O pagamento:** só da emitida e uma vez, com o portal em `pago` e
    `paid`.
  - **A virada:** com a foto `baseline`, só o recebimento e a expedição do WMS
    somam ao que a foto trouxe.
  - **O isolamento:** cada cliente fatura o dele, no documento dele.
  - **Quem fatura:** o papel `wms` e o cliente não veem a prévia nem emitem.
    O suporte vê a prévia e não grava.
- **O que o teste mostrou do comportamento de hoje** (fica como está; as
  partes seguintes decidem):
  - **Só a quantidade é congelada, não o preço.** A foto do mês fechado
    guarda o uso. O preço da LPU vale o de agora até a emissão. A parte 7.3
    (a LPU com vigência) resolve isso.
  - **A competência só existe depois de salvar as quantidades manuais.** Quem
    cria o `billing_periods` é o `saveBillingManual`. Sem ele, a emissão
    recusa com `PERIOD_NOT_FOUND`, mas o uso do mês fechado fica congelado.
    A tela de Faturamento salva antes de emitir.
  - **As linhas saem por grupo**, na ordem em que o grupo aparece na LPU, e
    dentro do grupo pela `ordem`.
  - **A competência antiga da BTG**, no id do mês, é lida e paga no mesmo
    documento, sem criar o `{cliente}__{competência}`.
- **A régua morde.** Tirar o filtro `billable` do cálculo reprova 9 dos 15
  casos.

### Parte 7.2a: a armazenagem na NF

Feita em 23/10/2026. A callable vem antes da tela (parte 7.2b), como na
publicação.

- **O pedido.** `registerNf` aceita `armazenagem`: os ids de
  `billing_periods` (`{cliente}__{AAAA-MM}`, ou o antigo da BTG, só
  `AAAA-MM`).
  - Até 12 competências por NF.
  - A NF leva ao menos uma demanda ou uma competência.
- **O que confere,** na transação, antes de qualquer escrita:
  - a competência existe e está `emitido` no WMS;
  - tem a foto da emissão e não está noutra NF;
  - é do mesmo cliente das demandas. O id antigo vale como BTG.
- **O valor.** É o `invoice_snapshot.total_cents` da emissão. O Financeiro
  não recalcula e não lê o total solto do período.
- **O que grava:**
  - a fatura leva `armazenagem` (o período, o mês e o total) e
    `periodo_ids`, e o `valor_cents` soma as demandas e a armazenagem;
  - o período ganha o mesmo resumo `faturamento` da demanda. O status do WMS
    fica `emitido` até a parte 7.2c;
  - o evento `nf.registered` leva `competencias`, só o mês, sem valor;
  - a projeção do portal (`client_faturas`) leva a armazenagem com o total,
    sem o id do período.
- **Cancelar o registro** confere que cada competência está nesta NF, tira o
  `faturamento` e grava `competencias` no `nf.cancelled`. A competência volta
  à fila e entra em outra NF.
- **O WMS** recusa pagar a competência que está numa NF
  (`PERIOD_INVOICED`): o pagamento se registra no Financeiro.
- **As cópias literais do WMS** (a coleção, o cliente do id antigo e o formato
  do id) ficam em `functions/financeiro/src/domain/armazenagem.ts`. A trava é
  o `armazenagem.test.ts`, que lê os arquivos do WMS.
- **Testes:**
  - `armazenagem.test.ts`: a leitura do período, o total da foto e os
    motivos de recusa;
  - `fatura.integration.test.ts`: com as demandas, sozinha, o id antigo, as
    recusas sem gravar nada e o cancelamento;
  - `billing-callables.integration.test.ts`: o WMS não paga a competência que
    está numa NF.

### Parte 7.2b: a armazenagem na fila e na NF do app

Feita em 23/10/2026, em `artifacts/app/src/lib/financeiro/a-faturar.ts` e na
tela Financeiro › A faturar.

- **A leitura.** A fila lê ao vivo `billing_periods` com `status: emitido`.
  As regras abrem a coleção a quem lê o faturamento, o que inclui os papéis
  do Financeiro.
  - Fica de fora o período que já tem `faturamento` (está numa NF) e o de id
    fora do formato.
  - O id antigo vale como BTG, pelo `LEGACY_CUSTOMER_CODE` do pacote dela.
- **A linha.** A competência vira uma linha da fila, com o `periodoId`:
  - "Armazenagem 09/2026", "Fatura do WMS · Emitida na Armazenagem";
  - o total da foto da emissão. Sem a foto, fica em Esperando, sem valor;
  - os dias desde a emissão, com o mesmo prazo da demanda.
- **A NF.** A linha entra no grupo do cliente dela, com o nome que a demanda
  do mesmo cliente traz. Só se marca com o mesmo cliente.
  - O pedido leva `armazenagem` à parte, e só quando há: o servidor sem a
    parte 7.2a recusaria o campo.
  - O vencimento pelo contrato sai da primeira demanda que tem contrato.
  - A confirmação diz a armazenagem de cada mês.
- **Os textos.**
  - O painel diz "Na NF", no lugar de "Demandas".
  - A fila vazia diz "Nada a faturar", e a busca sem resultado, "Nada
    encontrado".
  - No Início, a contagem separa as demandas da armazenagem.
- **Testes:**
  - `a-faturar.test.ts`: a leitura do período, a linha, a NF, o pedido, a
    confirmação e o Início;
  - `a-faturar-view.test.tsx`: a linha no grupo do cliente, no painel, os
    textos e o `axe`.

### Parte 7.2c: a armazenagem recebida no Financeiro

Feita em 23/10/2026.

- **Receber.** O pagamento que quita a NF marca cada competência dela como
  paga no WMS, na mesma transação, como o `payBillingInvoice` grava:
  - o período fica `pago`, com o instante, quem registrou e o
    `faturamento.paga_em` (o dia do pagamento);
  - o portal (`client_invoices`) fica `pago` e `paid`. O documento é achado
    como o WMS acha: o id novo e, na BTG, o antigo. Sem nenhum, o novo.
- **Estornar.** O estorno que reabre a NF devolve cada competência a
  `emitido`, sem o pagamento, e o portal a `issued`. É a única passagem de
  `pago` para `emitido` no WMS, e só pelo Financeiro.
- **O que confere.** A competência tem de estar nesta NF e no status que a
  ação pede: `emitido` para quitar e cancelar, `pago` para estornar. Senão,
  nada se grava.
- **O evento.** `cobranca.payment_registered` e `cobranca.payment_reversed`
  levam `competencias`, só o mês, sem valor.
- **O WMS.**
  - Onde o Financeiro está ligado (`FINANCEIRO_PROJECTS` em
    `domain/billing-scope.ts`, cópia da liberação do Financeiro), o
    `payBillingInvoice` recusa (`PAID_IN_FINANCEIRO`).
  - A prévia devolve o `fatura_id`.
  - A tela Faturamento troca "Marcar como paga" por "Faturar no Financeiro"
    (o A faturar) ou "Ver a NF no Financeiro" (a via comercial). O suporte,
    que não abre o Financeiro, não ganha o link.
  - Ligar o Financeiro no `dute-prod` (parte 4.9b) põe o projeto nas três
    listas (`docs/plataforma/lancamento-producao.md`, seção 6).
- **Testes:**
  - `fatura.integration.test.ts`: quitar e estornar com o portal, a BTG
    antiga e a competência fora de `emitido`;
  - `armazenagem.test.ts`: o id do portal e o status de cada ação;
  - `billing-scope.test.ts` e `platform-lists.test.ts`: a lista do WMS;
  - `billing-callables.integration.test.ts`: o `fatura_id` da prévia;
  - `lib/financeiro/armazenagem.test.ts`: a ação da tela do WMS.

### Parte 7.3a: o preço da armazenagem pela tabela do Comercial

Feita em 23/10/2026, em `functions/wms/src/domain/billing-price-tables.ts` e
no `loadBillingCalculation`.

- **A ligação.** O item de `billing_price_list` com `lpu_item_id` tira o
  `valor_unit` da tabela do cliente (`price_tables`, `customer_code`) vigente
  no último dia da competência.
  - O preço é o texto decimal exato da tabela. A conta segue a do WMS
    (`billing.ts`).
  - A linha leva o `tabela_id`, e a foto da emissão o guarda.
  - O item sem ligação, o inativo e o ad valorem não leem tabela nenhuma.
- **As recusas.** Sem a tabela com o item, `PRICE_NOT_IN_TABLE`. Com duas do
  cliente valendo no mesmo dia, `PRICE_TABLE_AMBIGUOUS`. A tabela de outro
  cliente nunca vale.
- **O uso congela sem o preço.** O `ensureFrozenBillingUsage` não resolve o
  preço, então o mês fechado congela o uso mesmo quando a tabela falta.
- **Achado e corrigido.** O `emitBillingInvoice` congelava o uso fora do
  `try`. Um erro de faturamento nessa hora chegava ao app como "internal".
  Agora chega com o código.
- **O WMS não muda o preço do item ligado** (`mutateManagedEntity`).
- **A cópia literal** da coleção do Comercial tem a trava no
  `billing-price-tables.test.ts`.
- **Testes:**
  - `billing-price-tables.test.ts`: a data-base, a tabela vigente, as duas
    no mesmo dia e o preço ilegível;
  - `billing-callables.integration.test.ts`:
    - o item ligado com o preço da tabela do fim do mês, e a foto com a
      tabela;
    - a tabela do outro cliente;
    - as recusas, sem emitir;
    - o preço que não muda no WMS.
  - A régua da 7.1 segue verde sem mudar um número: o item sem ligação
    calcula igual.

### Correção: a prévia do agente lia o período de outro cliente

Achada na parte 7.3a, em 23/10/2026.

- **O defeito.** A ferramenta `previa_faturamento` do Agent Dute do WMS lia
  `billing_periods/{AAAA-MM}`, o id antigo da BTG, para qualquer cliente.
  - Para outro cliente, na competência em que a BTG tinha o documento antigo
    emitido, o agente dava o status e o total congelado da BTG.
  - A ferramenta é só da equipe (owner, admin, financeiro e suporte), que já
    lê o faturamento de todos. Nenhum cliente viu número de outro.
- **A correção.** A ferramenta lê como a prévia: o documento novo do cliente
  e, só na BTG, o antigo (`readBillingPeriod`, em `domain/billing-scope.ts`).
- **Teste:** `billing-scope.integration.test.ts`.

### Parte 7.3b: levar a LPU de cobrança ao Comercial

Feita em 23/10/2026, na carga `functions/comercial/src/cargas/armazenagem.ts`
(roteiro em `comercial-cargas.md`).

- **Três passos, cada um com dry-run.**
  - Exportar: só lê. Escreve o CSV da carga de tabela com os itens ativos do
    cliente, sem o ad valorem, o código `WMS-<id>` e o preço de hoje.
  - Carregar: a carga de tabela que já existe, na variante Armazenagem.
  - Ligar: grava o `lpu_item_id` de cada item numa transação, com o recibo
    e o evento `price_table.wms_linked` (sem preço).
- **O que a ligação confere,** de novo dentro da transação:
  - o item na tabela pelo código, com o mesmo valor (1.25 é 1.2500);
  - a tabela do cliente, na variante Armazenagem;
  - o item que não está ligado a outro item do catálogo;
  - a vigência que cobre a competência anterior e a atual, enquanto
    estiverem sem emitir, e as abertas. Sem isso, o WMS recusaria a emissão
    delas por falta de preço (parte 7.3a).
- **A fatura calcula igual.** O preço da tabela é o do WMS. A régua da 7.1
  ganhou o caso: ligado à tabela com o preço de hoje, setembro dá os mesmos
  75,08.
- **Onde grava:** só onde a carga grava (`podeGravarNoProjeto`), nunca no
  `dute-prod` nem no `dute-btg`.
- **Testes:**
  - `cargas/armazenagem.test.ts`: os argumentos, o preço em texto, os itens,
    o CSV relido pela carga de tabela, a ligação e as recusas;
  - `cargas/armazenagem.integration.test.ts`: exportar, carregar e ligar no
    emulador, o dry-run, a repetição e as recusas sem gravar;
  - `billing-callables.integration.test.ts`, no WMS: a fatura igual.

### Parte 7.3c: o preço do Comercial na Tabela de preços do WMS

Feita em 23/10/2026, em `artifacts/app/src/lib/preco-da-cobranca.ts` e na
tela Faturamento › Tabela de preços.

- O item ligado (`lpu_item_id`) mostra "Tabela do Comercial" no lugar do
  valor do WMS, que não vale mais para ele. O ad valorem segue mostrando a
  taxa, ligado ou não.
- No formulário, o valor do item ligado não se edita, e salvar não manda o
  `valor_unit`. O servidor já recusava (parte 7.3a).
- **Teste:** `lib/preco-da-cobranca.test.ts`.

### Parte 7.5a: a perda por prazo de faturamento

Feita em 23/10/2026, no Comercial (pergunta 22, que segue a recomendação; é
a pergunta 10 do desenho do Comercial).

- **O motivo** `prazo_faturamento` ("prazo de faturamento vencido") entra em
  `MOTIVOS_PERDA`.
- **Quando vale.** Só com o prazo de perda do contrato
  (`autorizacao.prazo_perda_dias`) vencido, conferido no servidor pelo
  `alertaDePrazoDePerda`, que só existe aguardando a autorização ou a
  faturar.
  - Vale também a partir de "A faturar", antes de a NF ser registrada. A
    faturada já não se perde.
  - Os outros motivos seguem só antes de faturar.
- **Reabrir** devolve a demanda à etapa de antes, como em toda perda.
- **No app,** o motivo entra na lista travada, mas fica fora do diálogo de
  Perdido. Ele sai numa ação própria (parte 7.5b).
- **Testes:**
  - `demanda.test.ts`: a regra;
  - `demandas.integration.test.ts`: antes e depois do prazo, o contrato
    sem prazo, o evento e a reabertura;
  - `depois-do-envio.test.ts`: a lista travada e o diálogo sem o motivo.
