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
| 7.2a | A competência emitida no WMS no "A faturar" do Financeiro, com o total congelado | Só a emitida e sem NF entra; o total é o da foto; outro cliente não aparece |
| 7.2b | `registerNf` registra a NF da armazenagem e das demandas do mês numa fatura só, com a origem de cada linha | A competência faturada não fatura de novo; o total é a soma das origens |
| 7.2c | Receber e estornar a fatura da armazenagem marcam a competência do WMS, com o evento; o pagar do WMS sai onde o Financeiro está liberado | A competência fica paga uma vez; o estorno volta a emitida |
| 7.3 | A LPU de cobrança do WMS no catálogo e nas tabelas do Comercial, com vigência | A fatura do WMS calcula igual antes e depois (a régua da 7.1) |
| 7.4 | A integração da NF e a exportação contábil, com o fornecedor escolhido | Emissão idempotente; a falha não marca a fatura como emitida |
| 7.5 | Contratos e Autorizações no shell do Financeiro, só leitura; a perda por prazo de faturamento | O Financeiro lê sem editar itens nem preço |

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
