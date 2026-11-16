# Corrigir o código do cliente de um produto recebido com o código errado

Em 10/11/2026 chegou produto novo da BTG, e o Guilherme lançou no Receber a
polo da CX-000229 com o código `A.02.0810.002.M` (polo feminina). Na segunda
conferência da caixa ele viu que a peça é a polo masculina `A.01.0810.002.M`
(e-mail "CX-000229 - Correção no Sistema", 10/11/2026). Pela tela não dá para
corrigir: no Catálogo o código do cliente é identidade imutável
(`CATALOG_IDENTITY_IMMUTABLE`, `functions/wms/src/index.ts`).

Decisões do Leonardo em 11/11/2026:

1. Só o M da CX-000229.
2. Trocar o código no mesmo SKU, se der; o nome, o da família masculina.
3. A NF diz `A.01.0810.002.M`: a linha da NF na ficha da chegada também muda.
4. Depois do primeiro dry-run (abaixo, no registro): o cadastro errado não
   fica arquivado; sai ("vamos manter em arquivados um item cadastrado
   errado").

## Os dois caminhos

A ferramenta escolhe pelo banco, e o dry-run diz qual:

- **Transferência**, quando o código certo já existe no cadastro (o caso da
  CX-000229: a família `A.01.0810.002` tem do PP ao XGG). As peças da caixa
  passam do SKU errado para o certo, na mesma prateleira, e o cadastro errado
  sai. O código de nenhum SKU muda (`transferir.mjs`).
- **No mesmo SKU**, quando o código certo está livre e o SKU errado nasceu na
  própria chegada, sem outro movimento: o SKU passa a ter o código e o nome
  certos, sem movimento nenhum (`corrigir.mjs`).

O tamanho errado (o XGG lançado no lugar do XG, 16/11/2026) só vai pela
transferência: as peças passam para o SKU que já tem o código certo, e a linha
da caixa, da tarefa de guarda e da NF ficam com o tamanho dele. No mesmo SKU,
o tamanho do cadastro não muda, e a correção recusa.

## Transferência: o que grava

Passo a passo, cada um com recibo próprio. Se parar no meio, rodar de novo
continua de onde parou, sem repetir:

1. **O plano congelado**: o que a primeira leitura achou (as caixas, a
   quantidade, a prateleira, os dois SKUs), num recibo, para a retomada não
   depender do banco já mudado.
2. **Por prateleira, a SAIDA do SKU errado e a ENTRADA no certo**, pelas
   funções de domínio do WMS (`functions/wms/lib`, as mesmas das callables),
   com a origem `functions_manual_inventory`, que não entra na cobrança. Com o
   custo unitário da linha da NF, o valor da mercadoria vai junto. Os avisos
   desses movimentos na caixa antiga do agente já ficam resolvidos.
3. **As linhas das caixas, das tarefas de guarda e da linha da NF** passam
   para o SKU certo, numa transação, com o de antes em `acerto_codigo`. A
   `conference_revision` da caixa sobe, para uma tela aberta com a caixa velha
   não gravar por cima. Grava os eventos `warehouse.box_content_corrected` e
   `inbound.item_corrected`.
4. **O cadastro errado sai**, como no "Remover para corrigir" da Contagem
   (`removeOpeningInventoryLineTransaction`, que apaga o cadastro criado por
   engano quando o saldo zera). Saem o SKU, o cartão de `products`, o item do
   portal, o preço guardado e os saldos zerados, e o conteúdo inteiro vai para
   o recibo. A linha da NF de chegada cancelada que ainda aponta para ele passa
   para o certo, com o de antes em `acerto_codigo`: o Receber reusa o número
   que ela guarda quando o código volta como produto novo (`pendingNewSkuFor`),
   e o número nunca pode voltar. Grava o evento `catalog.removed_by_correcao`.
5. **O recibo final.**

Não muda: os movimentos antigos (o razão guarda o código da época), os
eventos, as peças de entrada da cobrança, as fotos e o aviso de chegada que a
BTG já recebeu.

**O cadastro errado só sai quando:**

- nasceu no Receber;
- ficou sem saldo e sem reserva;
- todo movimento dele é a entrada ou a guarda desta chegada, ou a saída desta
  correção;
- nada aberto usa o SKU: chegada a conferir, chegada com entrada, caixa de
  outra chegada, linha da abertura, solicitação do portal em aberto ou pedido
  ainda não entregue (a linha separada a menos, até zero, fica no pedido até
  a entrega).

Senão, as peças vão para o certo do mesmo jeito, e o dry-run diz por que o
cadastro fica. Se o motivo some depois (por exemplo, a chegada aberta é
cancelada no Receber), rodar de novo termina: apaga o que ficou.

## No mesmo SKU: o que grava

Numa transação só, com tudo relido e conferido dentro dela:

| Onde | O que muda |
|---|---|
| `skus/<SKU>` | `cod_cliente`, `cod_cliente_key`, `produto` e `genero`; o de antes fica em `acerto_codigo` |
| `products` | o cartão muda de documento, porque o id dele é o código: nasce o do código certo, com o conteúdo do antigo, e o antigo sai, inteiro no recibo |
| `stock_balances` do SKU | `client_item_code` e `product_name` |
| `client_inventory` | `client_item_code` e `product_name` (o portal) |
| `catalog_prices` | `item_code` (o preço não muda) |
| `ai_stock_age` | `client_item_code` e `product_name` (os dias parado do núcleo) |
| a caixa (`warehouse_boxes`) | a linha do SKU em `lines[]`; sobe a `conference_revision` |
| `putaway_tasks` da caixa | a mesma linha |
| `inbound_items` | a linha da NF, com o de antes em `acerto_codigo` |
| `events` | `catalog.code_corrected`, `warehouse.box_content_corrected` e `inbound.item_corrected` |
| `operational_operations` | o recibo |

O nome: com `nome: "familia"`, o da família do código novo (o mais comum
entre os tamanhos ativos, como na padronização de 06/11); sem família, o nome
de hoje com o gênero da correção.

## Recusas

O dry-run recusa, sem gravar nada, quando:

- **a caixa não serve**: não veio do Receber, não tem exatamente uma linha com
  o código errado, ou a separação já tirou dela o código errado (o que a
  separação tirou de outro produto da mesma caixa não atrapalha);
- **o SKU errado está em outra caixa** da chegada que não está na correção
  (`caixas`);
- **na transferência**, falta saldo livre na prateleira para o que a caixa
  tem, ou a caixa já tem uma linha do SKU certo. A recusa diz qual pedido
  segura a reserva: antes, na linha dele, "Separar menos" com o que existe de
  fato, e a coordenação conclui a separação com a diferença;
- **no mesmo SKU**, o SKU não nasceu na chegada, ou teve movimento de fora,
  pedido, reserva ou solicitação aberta, ou o tamanho muda;
- **o estoque está congelado** (`system_controls/inventory`).

## Como rodar, na máquina do Leonardo

Pré-requisitos, uma vez. O firebase-admin vem de `functions/wms`, e a
transferência usa as funções de domínio de lá, por isso o `build`:

```powershell
cd C:\DEV\Dute
git switch main
git pull
npm --prefix functions/wms ci
npm --prefix functions/wms run build
gcloud auth application-default login
```

Dry-run, só leitura:

```powershell
cd C:\DEV\Dute
node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod
```

Conferir no dry-run, antes de gravar:

- **"caminho"**: transferência, para o SKU certo, com o nome dele;
- **"SKU errado"**: onde ele nasceu (a primeira chegada, se cancelada) e o
  saldo, que deve ser só o da CX-000229;
- **"movimentos"**: só os da chegada da CX-000229;
- **"SKU certo"** e o saldo dele hoje;
- **a CX-000229**: a prateleira e a quantidade, como o Guilherme contou;
- **"aviso de chegada ao cliente"**: se já foi gravado, a BTG recebeu o código
  errado no sino do portal (e por e-mail, quem tem esse aviso ligado);
- **a lista "grava"**, e se o cadastro errado sai ou por que fica.

Gravar, só depois do dry-run limpo:

```powershell
cd C:\DEV\Dute
node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod --aplicar --confirmo "CORRIGIR CODIGO dute-prod"
```

Depois:

1. Rodar o dry-run de novo: a correção aparece como "já aplicada".
2. Reimprimir a etiqueta da CX-000229 (Receber › Recebidos › Guardas › Ver ›
   "Imprimir etiqueta", ou Estoque › Etiquetas) e trocar a da caixa.
3. Conferir o produto em Estoque › Itens e no portal da BTG.
4. Se o aviso de chegada já tinha saído, avisar a BTG da correção.

`--correcao <id>` limita a uma correção de `correcoes.mjs`; `--json` dá o
resultado para outro script. Correção nova entra em `correcoes.mjs`, com `id`
novo. A correção com `pendente` (o motivo) aparece no dry-run, com o estado de
hoje e a recusa, se houver, mas não grava, nem com `--aplicar`; para ligar,
apague o campo.

## Ler antes de corrigir

`ler-estoque.mjs` só lê, e não mostra quem fez cada coisa. Para cada código:
o SKU, o saldo por prateleira, as datas de entrada (a conta do pedido), os
movimentos com a chegada e a NF de cada um (a guarda por linha acha a chegada
pela tarefa de guarda), as caixas com o item (o que entrou, o que a separação
tirou e o que fica) e, com `--pedido`, as linhas do pedido. No fim, as chegadas
citadas, com as linhas da NF: duas chegadas com a mesma NF e as mesmas peças
são a mesma mercadoria lançada duas vezes. `--caixa` mostra uma caixa inteira.

```powershell
cd C:\DEV\Dute
node tools/corrigir-codigo-do-produto/ler-estoque.mjs --projeto dute-prod --pedido PED-0001 --codigo A.01.0806.005.GG --codigo A.01.0806.005.XG
```

## Testes

```powershell
cd C:\DEV\Dute
node --test "tools/corrigir-codigo-do-produto/*.test.mjs"
```

O CI roda esse `node --test` no job das ferramentas.

O cenário no emulador usa Java 21 e firebase-tools, e recusa rodar fora de
127.0.0.1. Ele faz as chegadas de verdade, com as funções de domínio de
`functions/wms/lib`:

1. **O caso da produção**: a família masculina com o M e saldo em A-03; a
   primeira chegada criando o `A.02.0810.002.M` e cancelada; a segunda com a
   CX-000229 guardada em B-07. Roda o dry-run e a gravação, confere cada
   coleção e procura o código errado e o SKU dele no banco inteiro (só o
   histórico, o `acerto_codigo` e o contador de SKU podem guardá-los). Roda de
   novo sem repetir e segue com o produto: o pedido do portal, a separação
   pela CX-000229 e a feminina M de verdade chegando depois com outro SKU.
2. **A transferência com a caixa por guardar**, com uma queda entre a saída e
   a entrada e a retomada.
3. **A transferência antes da entrada.**
4. **O SKU errado com outra vida**, que não sai, e o preso a uma chegada
   aberta, que sai depois de ela ser cancelada.
5. **O caminho no mesmo SKU**, inclusive antes da guarda e antes da entrada.
6. **As recusas.**
7. **O PED-0001**: o XG lançado como XGG numa caixa com GG, a XGG certa em
   outra caixa da mesma prateleira e a feminina nascida na chegada. A
   separação tira as GG da caixa do erro e "Separar menos" registra a falta;
   a correção recusa enquanto o pedido reserva as peças e diz qual pedido;
   depois da conclusão pela coordenação, as peças passam para o XG com o
   tamanho dele, o retirado das GG fica, o cadastro errado só sai depois da
   entrega, e um pedido novo de XG acha as peças na caixa.
8. **A correção pendente**, numa lista só do emulador (`CORRECOES_ARQUIVO`):
   o dry-run mostra o que gravaria, `--aplicar` não grava nada, e sem o campo
   grava.
9. **O SKU certo criado pelo acerto**, como a feminina XG do PED-0001: o
   `criar_sku` do acerto de verdade (por um plano só do emulador,
   `ACERTO_PLANO`) cria o XG, e a transferência passa as peças para ele.

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms ci
npm --prefix functions/wms run build
cd functions\wms
npx firebase-tools emulators:exec --only firestore --project demo-corrigir-codigo "node ../../tools/corrigir-codigo-do-produto/cenario-emulador.mjs"
```

Com `NODE_OPTIONS=--require <raiz>/tools/registrar_consultas.cjs` e
`CONSULTAS_SAIDA`, o mesmo cenário grava as consultas para
`tools/indices_das_consultas.py`. As da ferramenta são todas de igualdade e
não pedem índice composto.

## Registro

- **11/11/2026, primeiro dry-run na produção**, com a versão que só fazia a
  correção no mesmo SKU: recusou, sem gravar. O SKU errado (BTG-000213) nasceu
  em outra chegada, e não na da CX-000229 (AVL-3AE6D686). A família
  `A.01.0810.002` já tem PP, P, M, G, GG, XG e XGG, ou seja, o
  `A.01.0810.002.M` já existe. O nome dela: "Polo Masculino Piquet Azul-Gralha"
  em 6 tamanhos e "Polo Masculino Piquet Azul Gralha" em 1.
- **11/11/2026, segunda versão**: com o código certo no cadastro, o caminho é
  a transferência, e o cadastro errado sai em vez de ficar arquivado (decisão
  4). Validada no emulador com o caso da produção.
- **11/11/2026, segundo dry-run na produção**, limpo:
  - **Caminho:** transferência para o BTG-000219 (`A.01.0810.002.M`, "Polo
    Masculino Piquet Azul-Gralha", com 32 em B-03 e 46 em B-07).
  - **CX-000229:** guardada em B-03, com 92 peças da linha 1 da chegada
    AVL-3AE6D686, NF 046315.
  - **BTG-000213 (`A.02.0810.002.M`, "Polo Feminino Piquet Gralha"):** nasceu
    na outra chegada da mesma NF, a AVL-7428BFDB, que guardou 79 peças na
    CX-000228, também em B-03. Ele tem 171 em B-03, e o dry-run disse "não
    apaga".
  - **Decisão do Leonardo:** a CX-000228 é a feminina de verdade. Grava-se só
    a CX-000229: as 92 peças passam para o BTG-000219, e o BTG-000213 fica
    com as 79.
  - **Aviso ao cliente:** o aviso de chegada da AVL-3AE6D686 saiu para a BTG
    em 10/11/2026, às 15:14, com `A.02.0810.002.M`.
- **11/11/2026, 09:51 (Brasília, a hora do recibo
  `op_corrigir_codigo_5d016d22d6da5e29e80b46749d172421`), aplicação na
  produção**, pelo Leonardo, da máquina dele, com o código do `0d1e157`: 1
  correção gravada, sem erro.
  - **Movimentos:** SAIDA de 92 do BTG-000213 em B-03 e ENTRADA de 92 no
    BTG-000219 em B-03, os dois Ajuste, fora da cobrança.
  - **Caixa e NF:** a CX-000229, a tarefa de guarda dela e a linha 1 da NF da
    AVL-3AE6D686 passaram para o BTG-000219 (`A.01.0810.002.M`, "Polo
    Masculino Piquet Azul-Gralha"), com o de antes em `acerto_codigo`.
  - **Feminina:** o BTG-000213 continua no cadastro, com 79 em B-03 (a
    CX-000228), como decidido.
  - **Dry-run de conferência, logo depois:** "já aplicada", com o BTG-000213
    em 79 em B-03.
  - **BTG avisada:** o Leonardo escreveu à Cristiane (BTG), em 11/11/2026,
    com a correção do aviso de chegada de 10/11.
  - **Etiqueta:** o Leonardo reimprimiu a etiqueta da CX-000229 e a colocou
    na caixa, em 11/11/2026. Com isso, a correção está concluída.

## As correções da separação do PED-0001 (16/11/2026)

Na separação do PED-0001, o Leonardo achou duas caixas com o tamanho lançado
errado: a CX-000227 (41 polos masculinas piquet pretas XGG que são XG) e a
CX-000221 (12 polos femininas piquet pretas XGG que são XG). A leitura da
produção (`ler-estoque.mjs`, 16/11/2026, com o PED-0001 já concluído pela
coordenação) separou os dois casos:

- **CX-000227: a chegada repetida, pelo acerto.** A chegada dela
  (AVL-B1FE59A8, 06/11, por caixa) repetiu a AVL-0D0E620B (30/10, por linha,
  sem caixa), da mesma NF 046143 e com as mesmas peças: GG 30 e as 41 (XG em
  30/10, XGG em 06/11). As 41 XG já estavam no saldo, em B-02, e a
  transferência as dobraria. Por isso ela não está em `correcoes.mjs`: o
  acerto tira o que a segunda chegada lançou a mais e corrige a caixa sem
  movimento (`tools/acerto-btg-2026-10`, bloco `duplicada-0611`). É também a
  resposta das 30 GG que a operação não achou em B-02 e da linha da XG sem
  caixa.
- **CX-000221: o tamanho trocado, por esta ferramenta.** O BTG-000186
  (`A.02.0806.005.XGG`, "POLO FEMININA PIQUET PRETO") nasceu na chegada
  AVL-38450703 (05/11, por caixa, NF 046143) e só tem as 12 da CX-000221, em
  B-01. A linha 44 do PED-0001 separou 0, com a falta "CX-000221 tem XG", e a
  conclusão soltou a reserva. O `A.02.0806.005.XG` não está no cadastro: o
  acerto o cria (bloco `feminina-xg`, cópia do BTG-000186 com o tamanho XG),
  e a correção `cx-000221-a02-0806-005-xg` passa as 12 para ele pela
  transferência. O BTG-000186 fica até a entrega do PED-0001, que o cita.

A ordem:

1. **O acerto** dos três blocos do PED-0001, dry-run e gravação (os comandos
   em `tools/acerto-btg-2026-10/README.md`, "O PED-0001"). Antes dele, a
   correção recusa: o XG não está no cadastro, e o tamanho só muda pela
   transferência.
2. **Dry-run da correção**, conferindo o caminho (transferência para o
   `A.02.0806.005.XG` que o acerto criou), a caixa (CX-000221 em B-01, 12
   peças), o SKU errado (BTG-000186, nascido na AVL-38450703, "não apaga",
   porque está no PED-0001) e a lista "grava":

   ```powershell
   cd C:\DEV\Dute
   node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod --correcao cx-000221-a02-0806-005-xg
   ```

3. **Gravar**, só com o dry-run limpo:

   ```powershell
   cd C:\DEV\Dute
   node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod --correcao cx-000221-a02-0806-005-xg --aplicar --confirmo "CORRIGIR CODIGO dute-prod"
   ```

4. **Reimprimir** a etiqueta da CX-000221 (Estoque › Etiquetas) e trocar na
   caixa. A CX-000227 e as CX-000136, CX-000138 e CX-000140 saem da prateleira
   vazias pelo acerto: não têm etiqueta para trocar.
5. **Depois da entrega do PED-0001**, o dry-run e a gravação da mesma correção
   de novo: o BTG-000186 sai do cadastro.
6. **Avisar a BTG**: o portal mostrava XGG que eram XG, e peças da chegada
   repetida que não existiam.
