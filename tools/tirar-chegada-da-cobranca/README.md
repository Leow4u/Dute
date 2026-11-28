# Tirar da cobrança de novembro a chegada repetida da BTG

A chegada `AVL-B1FE59A8` (06/11/2026, pela caixa `CX-000227`) lançou de novo a
mercadoria da `AVL-0D0E620B` (30/10/2026), da mesma NF 046143. O estoque foi
acertado em 16/11/2026 pelo bloco `duplicada-0611` de
`tools/acerto-btg-2026-10` (PR 612): Ajuste − de 30 GG e 41 XGG em B-02, que não
se cobra. A ENTRADA da chegada repetida ficou no razão e conta no uso da
cobrança de novembro: 71 peças em "Entradas (peças)" e 2 em "Nº de
movimentações" (com a Tabela de preços de hoje, sem valor: ver "O que muda em
dinheiro"). Esta ferramenta tira essas duas entradas da cobrança de 11/2026,
uma vez, pelo banco, com recibo e evento. O caso está em `caso.mjs`.

## Como a cobrança conta a entrada

- **A conta.** A prévia e a emissão do WMS (`loadBillingCalculation`, em
  `functions/wms/src/index.ts`) leem os movimentos do cliente, ficam com os do
  mês no horário de São Paulo e **pulam o movimento com `billable: false`**.
  Do resto, o recebimento (`wms_receiving`) é entrada e a expedição
  (`wms_shipping`) é saída (`billingMovementDirection`, em
  `domain/billing-scope.ts`); a guarda da caixa (`wms_putaway`) e o ajuste do
  acerto não se cobram. As linhas com fonte automática da Tabela de preços
  ("Entradas (peças)", "Saídas (peças)", "Nº de movimentações", ad valorem)
  tiram a quantidade desse uso; a quantidade manual não as corrige
  (`calculateLpuLines`, em `functions/wms/src/billing.ts`).
- **O caminho que o código já prevê** é o `billable: false`: a régua
  `functions/wms/src/billing-callables.integration.test.ts` fixa que o
  movimento marcado fica de fora da prévia e da emissão. A ferramenta só põe a
  marca nas duas ENTRADAs; não muda o código do WMS, o estoque, a chegada, a
  caixa, a guarda nem a Tabela de preços.
- **Quando congela.** Até o mês terminar, a prévia recalcula a cada abertura e
  não grava nada, e a emissão de novembro recusa até 01/12/2026
  (`assertCompetenciaClosed`). A primeira prévia ou emissão a partir de
  01/12/2026 00:00 (São Paulo) grava a foto do uso
  (`billing_operational_snapshots/BTG_Pactual__2026-11`,
  `ensureFrozenBillingUsage`), e daí em diante a conta lê só a foto. A tela
  Faturamento abre no mês anterior: **em 01/12, basta alguém abrir a tela para
  congelar novembro.** Marcar o movimento depois da foto não muda mais nada, e
  a ferramenta recusa.
- **A emissão.** A fatura emitida guarda a conta inteira
  (`invoice_snapshot`) e não muda mais; a ferramenta recusa a competência
  emitida. Na produção, desde 28/10/2026 só a Armazenagem está no ar
  (`ARMAZENAGEM_EXCLUSIVA_AMBIENTES`, `artifacts/app/src/lib/somente-armazenagem.ts`):
  a competência se emite e se paga no WMS (`billingPaidInFinanceiro` é falso
  no `dute-prod`). Onde o Financeiro fatura, ele lê o total congelado da
  emissão do WMS (`invoice_snapshot.total_cents`, em
  `functions/financeiro/src/domain/armazenagem.ts`) e não recalcula: corrigir
  antes da emissão é corrigir o que o Financeiro e o portal veriam.

## O que muda em dinheiro

**Nada, com a Tabela de preços de hoje** (a seco na produção, 28/11/2026). A
Tabela da BTG não tem item com fonte automática de entradas, saídas ou
movimentações: fora o Ad Valorem, os itens são de quantidade manual (Posição
Pallet, Recebimento e Expedição por Pedido, Etiquetagem…), que alguém salva na
tela antes de emitir. Tirar a chegada muda o uso do mês (71 entradas e 2
movimentações a menos) e não o valor da prévia. O Ad Valorem não tem a
chegada: o acerto de 16/11 tirou as 71 peças do estoque, e a foto de 01/12 lê
o estoque daquele dia.

Se a chegada repetida pesasse em dinheiro, seria pelas quantidades manuais de
novembro: quem salvar "Recebimento por Pedido" não conta a AVL-B1FE59A8 (1
caixa, a CX-000227, e 71 peças).

Gravar serve para o uso congelado de novembro ficar certo e para o caso de um
preço por entrada entrar na Tabela antes da emissão: o preço só congela na
emissão. O a seco mostra as linhas da prévia e os itens que dependem do uso.

## O que grava

Numa transação só, que lê de novo a competência, a foto do uso e os
movimentos e recusa como a seco:

- nas duas ENTRADAs da chegada: `billable: false` e `billing_exclusion`
  (competência, a chegada, a que ela repetiu, a NF, o motivo, a operação, o
  ator e a hora);
- o evento `billing.movements_excluded` em `events`, da competência
  (`entity_type: "fatura"`, `entity_id: "2026-11"`), com as peças e os
  movimentos e sem valor: interno, wms e suporte leem os eventos e não o
  faturamento;
- o recibo `operational_operations/op_billing_exclude_chegada-repetida-btg-2026-11`,
  com chave fixa: rodar de novo mostra "já aplicado" e não grava.

Recusa, sem gravar nada: a chegada não encontrada, de outro cliente ou de
outra NF; entradas do mês que não sejam 2 com 71 peças; entrada da chegada
fora de novembro; a competência emitida; o uso já congelado.

## Como rodar, na máquina do Leonardo

Pré-requisitos, uma vez:

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms ci
npm --prefix functions/wms run build
gcloud auth application-default login
```

A seco, só leitura:

```powershell
cd C:\DEV\Dute
node tools/tirar-chegada-da-cobranca/tirar.mjs --projeto dute-prod
```

Mostra a chegada, as entradas que saem, a competência, a foto do uso, o uso
de novembro antes e depois e a prévia de hoje com a conta da tela Faturamento:
as linhas que mudam e o total. O total de hoje ainda muda até o uso congelar (o
ad valorem segue o estoque, e o resto do mês soma), mas a diferença é a das
71 peças e dos 2 movimentos. Sai com código 1 se recusar.

Gravar, só com o dry-run limpo ("a gravar") e **antes de 01/12/2026 00:00**,
ou antes de qualquer pessoa abrir o Faturamento de novembro:

```powershell
cd C:\DEV\Dute
node tools/tirar-chegada-da-cobranca/tirar.mjs --projeto dute-prod --aplicar --confirmo "COBRANCA BTG dute-prod"
```

Depois, a mesma ferramenta lê de novo e mostra "já aplicado". Até 30/11, a
Armazenagem › Faturamento › novembro mostra a prévia com o mês em aberto
(abrir não congela): ela deve trazer o total de depois.

**Se o uso de novembro já congelou e a competência não foi emitida**, a
ferramenta recusa. O caminho de `docs/plataforma/lancamento-producao.md`
(outubro) vale aqui: apagar `billing_operational_snapshots/BTG_Pactual__2026-11`,
que guarda só o uso, e rodar a ferramenta; a próxima prévia congela de novo, com
a conta sem a chegada (o ad valorem passa a ser o do estoque desse dia). Só com
o OK do Leonardo, e antes de emitir. **Depois de emitida**, a fatura não muda.

**Para desfazer antes da foto**, tire `billable` e `billing_exclusion` dos dois
movimentos, com um evento que diga por quê; o recibo fica como registro.

## Testes

- `regras.test.mjs` (o CI roda): quais movimentos saem, as recusas, a prévia
  de antes e de depois com as contas do WMS (`functions/wms/lib`, compilado
  pelo build) e o evento sem valor.

  ```powershell
  cd C:\DEV\Dute
  node --test "tools/tirar-chegada-da-cobranca/*.test.mjs"
  ```

- `cenario-emulador.mjs`: a ferramenta contra o WMS de verdade no emulador,
  com a chegada criada pelo fluxo da chegada por caixa e a prévia pela
  callable `getBillingPreview`; a seco não grava, a prévia da ferramenta é a
  da callable antes e depois, gravar de novo não repete, e com a foto do uso
  ou a competência emitida nada muda. Recusa rodar fora de `127.0.0.1` e de
  um projeto `demo-*`. De `functions/wms`, com o Java 21 no PATH:

  ```powershell
  cd C:\DEV\Dute\functions\wms
  npx --no-install firebase emulators:exec --only firestore --project demo-tirar-cobranca "node ../../tools/tirar-chegada-da-cobranca/cenario-emulador.mjs"
  ```

## Registro

### A seco na produção (28/11/2026, 07:19)

- A chegada bate com o caso: BTG, NF 046143, por caixa; saem 2 entradas de
  06/11/2026, em RECEBIMENTO, 71 peças (XGG 41, BTG-000181, e GG 30,
  BTG-000090). A guarda da caixa tem 4 movimentos `wms_putaway`, que não se
  cobram.
- A competência 11/2026 não tem documento, foto do uso nem recibo desta
  ferramenta: "a gravar", sem recusa.
- O uso de novembro perde 71 entradas e 2 movimentações; o valor da prévia
  não muda.
- Nada gravado. A gravação espera o OK do Leonardo.
