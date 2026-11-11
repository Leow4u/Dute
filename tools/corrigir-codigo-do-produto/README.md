# Corrigir o código do cliente de um produto recebido com o código errado

Em 10/11/2026 chegou produto novo da BTG, e o Guilherme lançou no Receber a
polo da CX-000229 com o código `A.02.0810.002.M` (polo feminina). Na segunda
conferência da caixa ele viu que a peça é a polo masculina `A.01.0810.002.M`
(e-mail "CX-000229 - Correção no Sistema", 10/11/2026). Pela tela não dá para
corrigir: no Catálogo o código do cliente é identidade imutável
(`CATALOG_IDENTITY_IMMUTABLE`, `functions/wms/src/index.ts`).

Decisões do Leonardo em 11/11/2026:

1. Só o M da CX-000229.
2. Trocar o código no mesmo SKU (e não criar outro SKU e transferir, como no
   acerto de outubro): o SKU, a data de entrada e o razão ficam como estão.
3. O nome passa a ser o da família masculina `A.01.0810.002`, se ela já tem
   outros tamanhos (padrão de 06/11/2026). Se não tem, fica o nome de hoje com
   "Masculino" no lugar de "Feminino".
4. A NF diz `A.01.0810.002.M`: a linha da NF na ficha da chegada também muda.

## O que a ferramenta grava

Numa transação só, com tudo relido e conferido dentro dela:

| Onde | O que muda |
|---|---|
| `skus/<SKU>` | `cod_cliente`, `cod_cliente_key`, `produto` e `genero`; o de antes fica em `acerto_codigo` |
| `products` | o cartão muda de documento, porque o id dele é o código: nasce `products/A.01.0810.002.M` com o conteúdo do antigo (inclusive `estoque_btg` e a criação) e sai `products/A.02.0810.002.M`, que vai inteiro para o recibo |
| `stock_balances` do SKU | `client_item_code` e `product_name` (a prateleira e o `RECEBIMENTO`) |
| `client_inventory` | `client_item_code` e `product_name` (o portal da BTG) |
| `catalog_prices` | `item_code` (o preço não muda) |
| `ai_stock_age` | `client_item_code` e `product_name` (os dias parado do núcleo) |
| a caixa (`warehouse_boxes`) | a linha do SKU em `lines[]`, que alimenta a etiqueta, o Mapa e a baixa da separação; sobe a `conference_revision`, para uma tela aberta com a caixa velha não gravar por cima |
| `putaway_tasks` da caixa | a mesma linha |
| `inbound_items` | a linha da NF, com o de antes em `acerto_codigo` |
| `events` | `catalog.code_corrected` (SKU), `warehouse.box_content_corrected` (caixa) e `inbound.item_corrected` (chegada), `info`, fora da caixa de entrada do agente e sem aviso ao cliente |
| `operational_operations` | o recibo `op_corrigir_codigo_…`: rodar de novo não repete |

Não muda: os movimentos (o razão guarda o código da época), os eventos
antigos, a cobrança (as peças de entrada vêm do movimento), as datas do FIFO,
o saldo, as fotos, o histórico de impressão da etiqueta e o aviso de chegada
que a BTG já recebeu.

## Quando serve, e quando recusa

Só no SKU que nasceu na própria chegada e não teve outra vida. O dry-run
recusa, sem gravar nada, quando:

- o código certo já existe no cadastro (qualquer SKU do cliente, mesmo
  arquivado) ou em `products`: aí o caminho é passar as peças para o SKU que
  existe, como no acerto de outubro (`tools/acerto-btg-2026-10`);
- o SKU não nasceu na chegada da caixa (`source_receipt_id`), ou foi reativado;
- o SKU tem movimento que não é a entrada da NF ou a guarda das caixas dessa
  chegada (Ajuste, separação, contagem, devolução);
- há reserva, linha de separação, item de pedido, contagem, linha da abertura
  ou solicitação do portal em aberto com o produto: decida o pedido antes;
- o SKU está numa caixa que não está na correção (`caixas`);
- a caixa não veio do Receber, não tem exatamente uma linha com o código
  errado, ou a separação já tirou dela;
- o saldo não bate com as caixas ou está fora delas;
- o estoque está congelado (`system_controls/inventory`);
- o nome não fecha com o padrão (aí, `nome: "..."` na correção).

Serve em qualquer etapa da chegada: com a caixa guardada (o caso da
CX-000229), com a entrada concluída e a caixa por guardar, e antes da entrada.
Corrigida antes da última guarda, o aviso ao cliente já sai com o código certo.

## Como rodar, na máquina do Leonardo

Pré-requisitos, uma vez (o firebase-admin vem de `functions/wms`; não precisa
do build):

```powershell
cd C:\DEV\Dute
git switch main
git pull
npm --prefix functions/wms ci
gcloud auth application-default login
```

Dry-run, só leitura:

```powershell
cd C:\DEV\Dute
node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod
```

Conferir no dry-run, antes de gravar:

- "SKU BTG-… · nasceu na chegada AVL-…": o produto foi criado nesse
  recebimento, com o código errado;
- a CX-000229, a prateleira e a quantidade de `A.02.0810.002.M`, como o
  Guilherme contou;
- "saldo": a mesma quantidade, na prateleira da caixa (ou no `RECEBIMENTO`, se
  a caixa não foi guardada), sem reserva;
- "nome": o nome que vai ficar e de onde ele veio;
- "aviso de chegada ao cliente": se já foi gravado, a BTG recebeu o código
  errado no sino do portal (e por e-mail, quem tem esse aviso ligado);
- a lista "grava".

Gravar, só depois do dry-run limpo:

```powershell
cd C:\DEV\Dute
node tools/corrigir-codigo-do-produto/corrigir.mjs --projeto dute-prod --aplicar --confirmo "CORRIGIR CODIGO dute-prod"
```

Depois:

1. Rodar o dry-run de novo: a correção aparece como "já aplicada".
2. Reimprimir a etiqueta da CX-000229 (Receber › Recebidos › Guardas › Ver ›
   "Imprimir etiqueta", ou Estoque › Etiquetas) e trocar a da caixa.
3. Conferir o produto em Estoque › Itens e no portal da BTG, inclusive a foto
   ("Gerenciar fotos"), que não muda.
4. Se o aviso de chegada já tinha saído, avisar a BTG da correção.

`--correcao <id>` limita a uma correção de `correcoes.mjs`; `--json` dá o
resultado para outro script. Correção nova entra em `correcoes.mjs`, com `id`
novo.

## Testes

```powershell
cd C:\DEV\Dute
node --test "tools/corrigir-codigo-do-produto/*.test.mjs"
```

O CI roda esse `node --test` no job das ferramentas: o nome da família, as
linhas da caixa e os campos do cadastro.

O cenário no emulador (Java 21 e firebase-tools; recusa rodar fora de
127.0.0.1) faz a chegada de verdade, com as funções de domínio de
`functions/wms/lib`: `A.02.0810.002.M` novo e `A.01.0810.002.G` na CX-000229,
entrada, etiqueta e guarda em B-07. Roda o dry-run e a gravação, confere cada
coleção, procura o código errado e a família errada no banco inteiro (só o
histórico e o `acerto_codigo` podem guardá-los), roda de novo sem repetir e
segue com o produto: Ajuste, pedido do portal, separação pela CX-000229, e as
chegadas novas com cada código. Também corrige antes da guarda e antes da
entrada e passa pelas recusas.

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms ci
npm --prefix functions/wms run build
cd functions\wms
npx firebase-tools emulators:exec --only firestore --project demo-corrigir-codigo "node ../../tools/corrigir-codigo-do-produto/cenario-emulador.mjs"
```

Com `NODE_OPTIONS=--require <raiz>/tools/registrar_consultas.cjs` e
`CONSULTAS_SAIDA`, o mesmo cenário grava as consultas para
`tools/indices_das_consultas.py`: as da ferramenta são todas de igualdade,
sem índice composto.

## Registro

- 11/11/2026: ferramenta escrita e validada no emulador (cenário completo e
  índices). Falta o dry-run e a aplicação na produção.
