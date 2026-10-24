# Fase 7: financeiro unificado

Desenho e registro da Fase 7 do plano de implantação
(`plano-de-implantacao.md`, seção 9). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Um só lugar para faturar a armazenagem e as OS.
- Um só a receber, no Financeiro.
- Uma fatura por cliente e competência, quando o contrato fatura por mês.
- A NFS-e pela Omie (parte 7.4; pergunta 21, decidida em 24/10/2026). O
  contador acompanha pelo Painel do Contador da Omie.

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

| Pergunta | Decisão |
|---|---|
| 21 | A NFS-e sai pela Omie (Leonardo, 24/10/2026), com a API paga dela. O CT-e, que a Omie não emite, segue emitido fora e registrado à mão. A baixa é da Dute, que lança na Omie. O contador cadastra na Omie os serviços, com a LC 116, o código municipal e o ISS; a Dute só aponta para eles e nunca decide imposto. A contabilidade usa o Painel do Contador da Omie: a Dute não tem exportação contábil própria. |
| 22 | A demanda que perdeu o prazo de faturamento ganha o motivo de perda "prazo de faturamento", aceito só quando o alerta de faturamento venceu (a recomendação). |

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
| 7.4a | O cliente da API da Omie e a máquina da emissão, puros: o formato da chamada, as falhas (chave, limite, instabilidade, duplicado, recusa), a OS montada da fatura e o passo seguinte de cada etapa | Cada falha cai no tipo certo; a OS leva o código de integração e o serviço do contador; a etapa só anda com a resposta certa |
| 7.4b | A reserva: a demanda e a competência numa emissão (`emissao_nf`) não se registram à mão nem se emitem de novo, e o Comercial não as tira de A faturar (perder, as outras ações e cancelar a autorização) | Cada caminho recusa a reservada; a sem reserva segue igual |
| 7.4c | A emissão gravada: `emitNfOmie` confere como o `registerNf`, reserva e põe na fila; retomar e desistir; a leitura das emissões; os eventos | A emissão é idempotente; desistir libera a reserva; o evento não leva valor |
| 7.4d | A rotina `runOmieSync`: acha o cliente pelo CNPJ, inclui a OS, confere o ambiente, fatura e acompanha a prefeitura; a autorizada vira a fatura pelo mesmo caminho do `registerNf` | A falha não marca a fatura como emitida; a homologação nunca fatura numa Omie em produção; a OS repetida não duplica |
| 7.4e | A faturar: o painel escolhe "Pela Omie" ou "Emitida fora"; pela Omie, pede a emissão; a demanda e a competência reservadas esperam "Na emissão da NFS-e" | Os textos e o `axe`; uma só ação primária; a reservada não entra na NF |
| 7.4f | A tela Emissões: a etapa, a mensagem da prefeitura, a NFS-e autorizada, retomar e desistir; a parada e a rejeitada no "Precisa de você" | Os textos e o `axe`; nenhuma ação primária (as ações são da linha) |
| 7.4g | A baixa na Omie: receber na Dute lança o recebimento no título que a OS gerou; estornar cancela | A baixa sai uma vez, também com a resposta perdida; a falha fica na fila e não desfaz o recebimento na Dute |
| 7.4h | A baixa na tela: o pagamento da NF que saiu pela Omie mostra a baixa; a parada no "Precisa de você", com retomar e dispensar | Os textos e o `axe`; dispensar pede a confirmação na linha |
| 7.5a | O motivo de perda "prazo de faturamento" no servidor, aceito só com o prazo do contrato vencido, também a partir de A faturar | Sem o prazo vencido recusa; os outros motivos seguem só antes de faturar |
| 7.5b | A ação "Perder por prazo" na tela Autorizações, na demanda com o prazo vencido | Só a linha vencida tem a ação; o motivo vem fixo |
| 7.5c | Contratos e Autorizações no shell do Financeiro, só leitura | O Financeiro lê sem editar itens nem preço |

**Pronto quando** uma competência fecha com a armazenagem e as OS na mesma
fatura, a NF sai pela integração e o a receber é um só.

## A NFS-e pela Omie (parte 7.4)

Desenho de 24/10/2026, com as respostas do Leonardo à pergunta 21 e a
pesquisa nas páginas da Omie (`developer.omie.com.br`,
`app.omie.com.br/api/v1/...` e `ajuda.omie.com.br`).

- **Como a Omie emite a NFS-e:** pela Ordem de Serviço (`servicos/os/`
  `IncluirOS`, com a etapa 50, e `servicos/osp/` `FaturarOS`). A
  prefeitura processa depois. O `StatusOS` dá a situação da RPS:
  - 001: aguardando envio;
  - 002: na prefeitura;
  - 003: com erro;
  - 004: autorizada, com o número;
  - 005: cancelada.
  - Junto vêm o código de verificação, os links da nota e as mensagens da
    prefeitura.
  - A conta a receber nasce sozinha na autorização.
- **Uma OS por fatura**, com o `cCodIntOS` igual ao id da emissão na Dute.
  Esse é o código de idempotência: a Omie recusa o segundo com o mesmo código,
  e a Dute então consulta a OS que já existe.
  - Um item por demanda e um por competência da armazenagem, com o valor do
    servidor (o mesmo do `registerNf`).
  - O serviço do item é o que o contador cadastrou na Omie, pelo código de
    integração (`cCodIntServico`): um para as OS e um para a armazenagem.
  - Uma parcela, com o vencimento escolhido.
- **O cliente** é o que já existe na Omie, achado pelo CNPJ do cadastro (o
  `document` do cliente no Comercial). A Dute nunca cria nem altera cliente
  na Omie. Sem o cliente lá, a emissão para antes de incluir a OS.
- **O ambiente:**
  - a emissão na homologação da Dute só fatura numa Omie em homologação
    (`cAmbiente` H);
  - a da produção, só numa em produção (P);
  - a Dute confere no `StatusOS`, depois de incluir a OS e antes de
    faturar; ambiente errado para a emissão.
- **As etapas da emissão** (`nf_emissoes`): na fila, OS incluída, na
  prefeitura, autorizada, rejeitada e parada.
  - **Parada** é o que precisa de uma pessoa: o cliente não achado, o
    ambiente errado, a configuração que falta ou as falhas seguidas.
  - **Rejeitada:** a prefeitura recusou. A pessoa corrige na Omie e tenta de
    novo (`ReenviarOS`), ou desiste (`CancelarOS`), e as demandas voltam a A
    faturar.
  - **Autorizada:** a fatura nasce com o número da NFS-e, pela mesma
    transação do `registerNf`, e a emissão guarda o código de verificação e
    os links.
- **A rotina `runOmieSync`**, a cada 5 minutos e uma instância por vez:
  - faz uma chamada por vez, para respeitar os limites da Omie (240 por
    minuto por método, 4 simultâneas, o bloqueio de 60 segundos do consumo
    redundante e o de 30 minutos depois de 10 erros);
  - espaça as tentativas de cada emissão;
  - para depois de 6 falhas seguidas.
- **As chaves da API** (`app_key` e `app_secret` do aplicativo da Omie) ficam
  no Secret Manager, como a do Resend. Sem elas, a rotina não chama a Omie, e
  a emissão que é hora de andar para com o motivo `sem_chaves`, em vez de
  prender as reservas na fila: desistir solta as reservas, e retomar, com as
  chaves, volta de onde parou.
- **A liberação** é `OMIE_AMBIENTES_LIBERADOS`, só o `dute-homolog` até o
  lançamento, com o OK do Leonardo.
- **O CT-e** segue à mão, pelo `registerNf`.
- **A baixa (7.4g):**
  - receber a fatura na Dute põe na fila, na mesma transação, o recebimento
    no título que a OS gerou na Omie (`LancarRecebimento`), um por
    pagamento (`nf_baixas`), com um código de integração que sai do
    pagamento;
  - estornar cancela o recebimento (`CancelarRecebimento`);
  - antes de lançar e antes de cancelar, a rotina confere o título pela OS
    (`PesquisarLancamentos`): o recebimento com o código já lá não se lança
    de novo, e sem ele não há o que cancelar;
  - a falha fica na fila e não desfaz o recebimento na Dute.
- **O que só o Leonardo e o contador fazem:**
  - gerar as chaves no aplicativo da Omie (só o administrador vê);
  - usar um aplicativo de teste, ou a empresa em homologação, para o
    `dute-homolog`;
  - guardar as chaves no Secret Manager, pelo comando que a parte 7.4d
    registra;
  - o contador cadastra os dois serviços na Omie com os códigos de
    integração `DUTE-OS` e `DUTE-ARMAZENAGEM`;
  - o contador passa a conta corrente e a categoria de receita das OS.

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

### Parte 7.5b: a ação "Perder por prazo" em Autorizações

Feita em 23/10/2026, na tela Comercial › Autorizações. O Início do Comercial
já levava o "Prazo de faturamento vencido" para lá.

- **A seção "Prazo de faturamento vencido"** aparece só quando há demanda
  vencida. Ela lista as demandas aguardando a autorização ou a faturar com o
  prazo de perda do contrato vencido, a que venceu antes primeiro
  (`prazosVencidos`, com o mesmo `alertaDePrazoDePerda` do Início). Em cada
  uma:
  - a RV, o título, o cliente e a etapa;
  - "Venceu em" no tom de alerta;
  - a ação "Perder por prazo".
- **O diálogo** pede só a nota, opcional. A perda vai pelo `advanceDemand`,
  com o motivo `prazo_faturamento` fixo e com a etapa e a RV que a tela viu.
  O servidor confere o prazo de novo (parte 7.5a).
- **Testes:**
  - `lib/comercial/autorizacoes.test.ts`: a lista e o pedido;
  - `pages/comercial/autorizacoes-view.test.tsx`: os textos da seção, o
    rótulo da ação, a seção ausente sem vencida e o `axe`.

### Parte 7.5c: Contratos e Autorizações no Financeiro, só leitura

Feita em 23/10/2026.

- **As rotas** `/financeiro/contratos` e `/financeiro/autorizacoes`, no menu
  do Financeiro entre Faturas e Relatórios, com a mesma liberação e os mesmos
  papéis (owner, admin e financeiro).
- **As telas são as do Comercial** com `somenteLeitura`.
  - Em Contratos: sem Novo contrato, Editar nem Registrar aditivo. A ficha
    inteira fica: vigência, condições, tabelas, aditivos e documentos.
  - Em Autorizações: sem Nova autorização, o painel, as caixas de marcar,
    Cancelar nem Perder por prazo. Ficam a fila, as autorizadas e o prazo
    vencido.
- **As regras** já abriam `contracts`, `client_authorizations`, `demands`
  e as RVs a quem lê preço, o que inclui o financeiro.
  - O financeiro não lê o cadastro (`customers`). Sem ele, o cliente
    aparece pelo nome gravado na demanda ou pelo código.
  - Nenhuma escrita: as callables do Comercial recusam o papel financeiro.
- **Testes:**
  - `contratos-view.test.tsx` e `autorizacoes-view.test.tsx`: a leitura sem
    nenhuma ação, com o `axe`;
  - `financeiro/navegacao.test.ts`, `modules.test.ts` e `ambientes.test.ts`:
    o menu, as rotas, os papéis e o shell.

### Parte 7.4a: o cliente da Omie e a máquina da emissão

Feita em 24/10/2026. Puro, sem Firestore nem rede: a 7.4c grava, e a 7.4d chama.

- **`domain/omie.ts`:**
  - monta o corpo da chamada (`call`, as chaves e o `param` numa lista);
  - chama pelo transporte, que no teste é de mentira e na rotina é o
    `fetch`, com 30 segundos de limite;
  - classifica a falha:
    - a chave inválida para tudo;
    - o limite (429, o consumo redundante, o bloqueio de 30 minutos) só
      espera;
    - a instabilidade e a recusa contam como falha;
    - o duplicado é a idempotência funcionando.
  - A Omie devolve 500 também na recusa de negócio; por isso a recusa tenta
    algumas vezes antes de parar.
  - As chaves nunca saem na mensagem.
- **`domain/emissao-omie.ts`:**
  - as etapas;
  - o passo de cada etapa;
  - a OS montada da emissão: o `cCodIntOS`, o cliente, a etapa 50, um item
    por demanda e por competência com o serviço do contador (`DUTE-OS` e
    `DUTE-ARMAZENAGEM`) e uma parcela;
  - o pedido de cada passo;
  - o que a resposta e a falha fazem com a emissão;
  - as ações de retomar e desistir.
- **As travas da máquina:**
  - o ambiente errado para antes de faturar;
  - a OS já faturada segue para a prefeitura;
  - o StatusOS sem o código da OS conta como falha, sem laço;
  - a prefeitura que não responde em 72 horas para a emissão;
  - seis falhas seguidas param.
- **A liberação** `OMIE_AMBIENTES_LIBERADOS` (só o `dute-homolog`) e o
  ambiente da Omie de cada projeto (`dute-homolog` H, `dute-prod` P).
- **A configurar quando o contador passar:** a categoria de receita e a
  conta corrente (`CONFIGURACAO_DA_OMIE`). Sem elas, a Omie usa o padrão.
- **A conferir no primeiro teste com a Omie de homologação:** se o
  `IncluirOS` aceita a OS já na etapa 50 (senão, entra o `TrocarEtapaOS`
  antes do `FaturarOS`) e o filtro de CNPJ do `ListarClientes`.
- **Testes:**
  - `omie.test.ts`: cada falha no tipo certo, o corpo e as chaves fora da
    mensagem;
  - `emissao-omie.test.ts`:
    - o passo de cada etapa;
    - a OS e o pedido de cada passo;
    - a resposta de cada passo, com o cliente, o ambiente, a prefeitura e o
      cancelamento;
    - o intervalo que dobra e para na sexta falha;
    - retomar e desistir.

### Parte 7.4b: a reserva da emissão

Feita em 24/10/2026, antes de qualquer emissão existir, para a trava chegar
antes de quem reserva.

- **O campo** `emissao_nf: { id, desde }` na demanda e na competência da
  armazenagem. Quem grava é a emissão (7.4c); quem libera é a desistência ou
  a fatura que nasce da NFS-e autorizada (7.4d).
- **No Financeiro:**
  - `registerNf` recusa a demanda e a competência reservadas ("está na
    emissão da NFS-e pela Omie");
  - a fatura da própria emissão passa (o `problemaParaFaturar` e o
    `problemaDaArmazenagem` recebem a emissão que está faturando).
- **No Comercial:**
  - `advanceDemand` recusa toda ação na demanda reservada: perder, fechar,
    reabrir, registrar a execução, validar e recusar o aditivo;
  - cancelar a autorização recusa quando uma das demandas dela está
    reservada;
  - a regra fica em `emissaoNfDaDemanda` (`domain/demanda.ts`), que lê o
    mesmo campo do `emissaoReservada` do Financeiro.
- **No WMS** nada muda: a competência emitida não volta a aberta, e onde o
  Financeiro está ligado o WMS não registra pagamento (parte 7.2c).
- **Testes:**
  - Financeiro: `fatura.test.ts` e `armazenagem.test.ts` (a reservada recusa,
    a da própria emissão passa) e `fatura.integration.test.ts` (o
    `registerNf` recusa as duas e, sem a reserva, registra);
  - Comercial: `demandas.integration.test.ts` (a reservada não se perde e,
    sem a reserva, perde) e `autorizacoes.integration.test.ts` (a autorização
    dela não se cancela).

### Parte 7.4c: a emissão gravada

Feita em 24/10/2026. Nenhuma chamada à Omie: quem chama é a rotina (7.4d).
Fica no `dute-homolog` (`OMIE_AMBIENTES_LIBERADOS`).

- **`lerParaFaturar`** (`domain/fatura-gravacao.ts`) saiu do `registerNf`:
  as leituras e as conferências do faturamento, antes de qualquer escrita.
  O `registerNf` e a emissão conferem e valoram igual. O `registerNf` faz o
  mesmo de antes (os testes da 4.1a e da 7.2a seguem verdes).
- **`emitNfOmie`** (owner, admin e financeiro):
  - o pedido é o do `registerNf` sem a NF (a Omie numera), com o vencimento
    de hoje em diante;
  - confere pela `lerParaFaturar`;
  - acha o CNPJ no cadastro do cliente (`customers`) e recusa sem ele;
  - grava `nf_emissoes/{nfe_...}` na fila, com os itens e os valores do
    servidor;
  - reserva as demandas e a competência (`emissao_nf`, parte 7.4b);
  - grava o evento `nf.emission_requested`, sem valor;
  - a mesma chave repete o resultado.
- **`actOnNfEmission`:** retomar ou desistir da emissão parada ou
  rejeitada, com a edição que a tela viu.
  - Desistir sem a OS na Omie solta as reservas na hora.
  - Com a OS lá, passa a "cancelando" e espera a rotina cancelar; a reserva
    continua até lá.
  - Eventos `nf.emission_resumed` e `nf.emission_abandoned`.
- **`listNfEmissions`:** as 50 mais novas, com a etapa, a mensagem da
  prefeitura, o total e a reserva, sem o CNPJ.
- **O evento** da emissão é da entidade `nf_emissao`, com o cliente. O tipo
  não tem as palavras do roteador de avisos do WMS (a trava do
  `events.test.ts`).
- **Testes:**
  - `emissao.integration.test.ts`:
    - a fila com os valores do servidor, as reservas e o evento;
    - repetir não duplica;
    - a reservada não se emite de novo nem se registra à mão;
    - sem CNPJ, fora de A faturar, com o vencimento no passado, fora da
      liberação e sem o papel, nada se grava;
    - desistir sem a OS solta as reservas;
    - desistir com a OS espera o cancelamento;
    - retomar volta à etapa de onde parou;
    - a lista;
  - `events.test.ts`: os três tipos novos, estritos e da emissão;
  - `emissao-omie.test.ts`: a emissão gravada lida campo a campo e o id.

### Parte 7.4d: a rotina da Omie

Feita em 24/10/2026. Fica no `dute-homolog` (`OMIE_AMBIENTES_LIBERADOS`) e
não chama a Omie sem as chaves.

- **`runOmieSync`**, a cada 5 minutos e uma instância por vez
  (`domain/omie-rotina.ts`):
  - cada emissão que é hora de andar dá um passo (até 20 por passada): uma
    chamada à Omie e uma transação que grava o resultado;
  - a chave inválida para a emissão e a passada inteira;
  - se uma pessoa mexeu na emissão durante a chamada (a edição mudou), o
    resultado se descarta; o `cCodIntOS` e o `StatusOS` reconciliam na
    passada seguinte.
- **A NFS-e autorizada vira a fatura na mesma transação**, pela
  `lerParaFaturar` e pela `gravarFatura`. As duas saíram do `registerNf`,
  que segue igual.
  - O número é o da NFS-e, a série é 1 (a do registro à mão) e a emissão é
    o dia da autorização.
  - A fatura guarda `origem_nf: omie`, a emissão e o código de verificação.
  - A reserva sai, e o evento é `nf.registered` com o
    `nf.emission_authorized`.
- **A fatura que não pode nascer** (a mesma NF já registrada à mão, a
  demanda que mudou) para a emissão com o motivo `fatura_recusada`, e a
  reserva continua: a nota existe, e uma pessoa decide.
- **Sem as chaves no ambiente,** nada se chama, e a emissão que é hora de
  andar para com o motivo `sem_chaves` ("As chaves da API da Omie não estão
  neste ambiente."), com o `nf.emission_stopped`. Sem isso, o pedido feito
  antes de as chaves existirem ficaria na fila com as reservas presas, sem
  ação para uma pessoa. Desistir da que nunca saiu solta as reservas na hora;
  retomar, com as chaves, volta de onde parou.
- **Desistida com a OS na Omie:** a rotina cancela a OS lá (`CancelarOS`),
  solta as reservas e grava `nf.emission_released`.
- **Os eventos da rotina** (ator `sistema`): `nf.emission_authorized`,
  `nf.emission_rejected`, `nf.emission_stopped` (com o motivo) e
  `nf.emission_released`. Sem valor nem o número da nota.
- **O que só o Leonardo faz para a rotina chamar a Omie:**
  - gerar as chaves no aplicativo da Omie (Omie › Aplicativos, perfil
    administrador), num aplicativo de teste ou na empresa em homologação
    para o `dute-homolog`;
  - guardar no Secret Manager:

    ```powershell
    cd C:\DEV\Dute
    firebase functions:secrets:set OMIE_APP_KEY --project dute-homolog
    firebase functions:secrets:set OMIE_APP_SECRET --project dute-homolog
    ```

  - Com os segredos criados, uma parte pequena declara
    `secrets: ["OMIE_APP_KEY", "OMIE_APP_SECRET"]` no `runOmieSync`, como
    no Resend. Antes disso, a publicação não pode citar segredo que não
    existe.
- **Testes** (`omie-rotina.integration.test.ts`, com uma Omie de mentira
  que responde como as páginas da API descrevem):
  - do pedido à fatura;
  - a Omie em produção na homologação para antes de faturar;
  - a OS que já existe não duplica;
  - rejeitada não vira fatura; retomada reenvia e autoriza;
  - desistir cancela na Omie e só então solta as reservas;
  - a chave inválida para a passada;
  - a NF já registrada à mão para a emissão;
  - a edição que mudou descarta o resultado;
  - fora da liberação, nada se faz;
  - sem as chaves, nada se chama, a emissão para com o motivo
    `sem_chaves`, desistir solta as reservas e, com as chaves, a retomada
    anda (o caso falha com a rotina que só esperava).
- **`emissao-omie.test.ts`:** a parada sem as chaves, a retomada e a
  desistência dela.

### Parte 7.4e: A faturar pela Omie

Feita em 24/10/2026. Só onde a emissão pela Omie está liberada
(`OMIE_LIBERADA` no app, a mesma lista do servidor, dentro da do
Financeiro).

- **O painel** passa a "Faturar" e escolhe como a NF sai:
  - "Pela Omie": só o vencimento (de hoje em diante), a forma e a
    observação; a ação é "Emitir pela Omie" (`emitNfOmie`);
  - "Emitida fora" (o CT-e, que a Omie não emite): o número, a série e a
    emissão, como antes; a ação é "Registrar NF" (`registerNf`).
  - Trocar a via troca a chave de idempotência: é outro pedido.
- **A confirmação** diz o que foi pedido à Omie ("NFS-e pedida à Omie: 1
  demanda e a armazenagem de 09/2026").
- **A demanda e a competência reservadas** (`emissao_nf`) esperam com a
  marca "Na emissão da NFS-e", sem caixa, e não contam no "Precisa de você"
  como a faturar.
- **Fora da liberação** nada muda: o painel é o "Registrar NF" de antes.
- **As travas:** `platform-lists.test.ts` compara a liberação do app com a
  do servidor e as callables do Financeiro com as do `index.ts`.
- **Testes:** `a-faturar.test.ts` (a reserva, o formulário pela Omie, o
  pedido e a confirmação) e `a-faturar-view.test.tsx` (a via, os campos de
  cada uma, uma só ação primária, a reservada esperando, os textos e o
  `axe`).

### Parte 7.4f: a tela Emissões

Feita em 24/10/2026. Só onde a emissão pela Omie está liberada: a rota
`/financeiro/emissoes` e o item "Emissões" do menu, logo antes dos
Relatórios, existem só com `OMIE_LIBERADA`, dentro da liberação do
Financeiro.

- **A tela** lê `listNfEmissions` a cada minuto e mostra três grupos, cada
  um com quantas:
  - "Precisam de você": a rejeitada, com o que a prefeitura disse, e a
    parada, com o motivo e a mensagem da Omie (também a parada "Sem as
    chaves da Omie", do pedido feito antes de as chaves existirem);
  - "Em andamento": na fila, OS incluída, na prefeitura, reenviando e
    cancelando na Omie, que a rotina anda sozinha;
  - "Concluídas": a autorizada, com o número da NFS-e e o link do PDF da
    Omie (só `https`), e a desistida.
- **As ações** são da linha, nenhuma é a principal da tela:
  - "Tentar de novo" e "Desistir" na rejeitada e na parada;
  - a parada pela OS cancelada na Omie só se desiste;
  - "Desistir" pede a confirmação na linha ("Confirmar desistência" ou
    "Voltar").
- **A chave de idempotência** é da intenção (a emissão, a ação e a edição
  que a tela viu). A nova tentativa depois da falha leva a mesma chave: se a
  primeira gravou, o servidor repete o resultado. A lista é lida de novo
  depois de cada ação, deu certo ou não.
- **O "Precisa de você"** do Início conta as rejeitadas e as paradas, como
  críticas, logo depois da cobrança vencida. A entrada, o menu e o radar
  contam pela mesma lista. Fora da liberação da Omie nada é lido, e o Início
  conta o resto como antes.
- **Testes:**
  - `emissoes.test.ts`: a leitura, os itens, as ações de cada etapa, os
    grupos e o "Precisa de você";
  - `emissoes-view.test.tsx`: os textos, nenhuma ação primária, a
    confirmação na linha, os estados e o `axe`;
  - `emissoes.test.tsx`: as callables, a chave que fica depois da falha e a
    desistência que só chama depois de confirmada;
  - `navegacao.test.ts`, `modules.test.ts` e `ambientes.test.ts`: a rota e
    o item só com a liberação da Omie, com os papéis de quem fatura.
  - `platform-lists.test.ts`: as etapas e os motivos da tela são os do
    servidor, e o evento da parada aceita os mesmos motivos.

### Parte 7.4g: a baixa na Omie

Feita em 24/10/2026. Anda na mesma rotina `runOmieSync`, depois das
emissões, só onde a Omie está liberada.

- **No pagamento** da fatura que saiu pela Omie (`origem_nf: omie`, com a
  emissão e a OS), a mesma transação do `advanceFatura` põe a baixa na fila:
  - `nf_baixas/{bxa_...}`, o id com o sufixo do pagamento: uma baixa por
    pagamento;
  - o código de integração do recebimento na Omie é `DUTE` e 16 dígitos do
    pagamento (a Omie aceita até 20);
  - a fatura registrada à mão não tem baixa.
- **A rotina** dá um passo por baixa (até 20 por passada), uma chamada por
  vez:
  - confere o título a receber da OS (`PesquisarLancamentos` com `nCodOS`);
  - lança o recebimento (`LancarRecebimento`) no título, com a conta
    corrente da configuração ou, sem ela, a do título, o valor e o dia do
    pagamento;
  - no estorno, confere e cancela (`CancelarRecebimento`).
- **Uma vez só:** a rotina só lança depois de conferir, e confere de novo
  depois de qualquer falha. Se a Omie gravou e a resposta se perdeu, a
  conferência acha o recebimento com o código, e a baixa fica lançada sem
  lançar de novo.
- **O estorno** do pagamento, na mesma transação:
  - a baixa que nunca conferiu o título não saiu nem está saindo, e fica
    cancelada ali, com o evento de quem estornou;
  - a conferida, a lançada e a que tentou lançar vão a cancelar na Omie;
  - se o estorno chega durante o lançamento, o resultado da Omie se
    descarta (a edição mudou), e o cancelamento confere e desfaz o que ela
    gravou.
- **A falha** espera, dobra o intervalo e para na sexta seguida
  (`falhas_seguidas`). O recebimento na Dute nunca se desfaz por ela.
- **Para e espera uma pessoa:**
  - `titulo_nao_achado`, depois de seis conferências sem o título;
  - `titulo_repetido`, com mais de um título a receber na OS;
  - `titulo_liquidado`, com o título já recebido na Omie sem a Dute;
  - `sem_conta_corrente`, sem a conta no título nem na configuração;
  - `chave`, com a chave recusada;
  - `sem_chaves`, sem as chaves no ambiente.
- **Os eventos** (`nf.settlement_posted`, `nf.settlement_cancelled` e
  `nf.settlement_stopped`, entidade `nf_baixa`) não levam valor. Retomar e
  dispensar a parada entram na 7.4h, com a tela.
- **Testes:**
  - `baixa-omie.test.ts`: o id e o código, o passo e o pedido, a
    conferência, o lançamento, as falhas e o estorno;
  - `baixa.integration.test.ts`, com uma Omie de mentira que guarda os
    recebimentos do título:
    - lança uma vez;
    - a resposta perdida não duplica;
    - o estorno da lançada cancela na Omie;
    - o estorno antes de conferir cancela sem chamar a Omie;
    - o estorno durante o lançamento desfaz o que a Omie gravou;
    - a Omie fora do ar para na sexta falha sem mexer no pagamento;
    - sem as chaves e fora da liberação;
    - a fatura registrada à mão não tem baixa.
- **Para conferir no primeiro teste na Omie de homologação:**
  - o filtro `nCodOS` da `PesquisarLancamentos` e o `cCodIntLanc` que ela
    devolve com o código de integração do recebimento;
  - o título com retenção (o ISS retido pelo tomador): o valor dele na Omie
    contra o valor recebido na Dute. Se a Omie recusar o recebimento maior
    que o saldo, a baixa para com a mensagem dela, e uma pessoa decide.

## Onde a Fase 7 está

- Feitas: 7.0 a 7.3c, 7.4a a 7.4g e 7.5a a 7.5c.
- **7.4 em andamento,** com a pergunta 21 respondida em 24/10/2026: a
  NFS-e pela Omie (desenho em "A NFS-e pela Omie"). Falta a 7.4h, a baixa
  na tela. A emissão espera as chaves da Omie (`OMIE_APP_KEY` e
  `OMIE_APP_SECRET`) no `dute-homolog`: sem elas, a rotina não chama a Omie
  e a NF segue registrada à mão ("Emitida fora").
- **O "pronto quando" da fase:**
  - a armazenagem e as OS já fecham a competência na mesma fatura;
  - o a receber já é um só (`faturas`);
  - falta a NF sair pela integração (7.4).
- **Na produção,** tudo depende do lançamento da Fase 4 (parte 4.9b): ligar
  o Financeiro no `dute-prod` põe o projeto nas três listas.
