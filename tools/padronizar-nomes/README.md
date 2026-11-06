# Padronizar os nomes do catálogo

O nome do produto foi digitado à mão em cada tamanho e ficou fora de padrão:
o tamanho no fim ("… p", "… m", "… - XG"), o gênero sem padrão ("masculino"
e "masculina") e MAIÚSCULAS misturadas. O padrão, decidido pelo Leonardo em
06/11/2026 (canvas "Catálogo · nome sem tamanho", fontes em
`docs/mockups/Nome*.dc.html`):

1. O nome é o mesmo em todos os tamanhos da família. O tamanho sai do nome
   e vai para o campo Tamanho, preenchido pelo fim do código do cliente
   (A.01.0806.005.XG → XG).
2. O gênero é uma etiqueta igual para tudo, "Masculino" ou "Feminino", sem
   concordar com a peça: "Polo Masculino", "Calça Social Masculino".
3. Inicial maiúscula em cada palavra: "Polo Masculino Piquet Preto".
   Conectivos em minúscula (de, da, com, e), menos na primeira e na última
   palavra; siglas em maiúsculas (a palavra de 2 a 5 letras sem vogal, como
   TNT e MDF, e a lista de `SIGLAS`); unidade depois de número na forma de
   sempre ("500 ml", "2 L", "20 W", "32 GB"), e a colada ao número ganha o
   espaço; cor composta da lista com hífen ("Azul-Marinho").
4. Nada além disso: a regra não reordena palavras, não acrescenta cor nem
   corrige digitação. O que ela não resolve sozinha vira "conferir".

Os tamanhos conhecidos são PP, P, M, G, GG, XG, XGG, XXG, XXXG, EG, EGG, EXG,
XS, S, L, XL, XXL e U, N1 a N99 e os números de 1 a 69. O fim do código só
vale como tamanho quando é um deles (A.01.0806.005 não tem tamanho "005").
No campo Tamanho, "Único", "UNICO" e "Tam. Único" são o U, o mesmo do código
terminado em U, e a medida ("500ML" de uma garrafa, "475ML" de um copo) é a
capacidade: não contradiz o fim do código e fica como está. Fica no nome a medida ("Toalha 500 g"), a letra que é parte dele ("Gola U",
"Vitamina A") e o "U" de quem não é tamanho único.

## Onde a regra mora

- `lib/dominio/src/nome-do-produto.ts`: o original, que o app importa.
- `functions/wms/src/domain/nome-do-produto.ts`: a cópia literal das
  Functions, travada em `nome-do-produto.test.ts` de lá (as Functions não
  importam `lib/dominio`). `nome-para-gravar.ts`, ao lado, é o que o cadastro
  grava.
- `tools/padronizar-nomes/regras.mjs`: gerada do original por
  `gerar-regras.mjs` (só tira os tipos), para a ferramenta rodar em Node puro.
  O vitest do app reprova quando o arquivo não é o que o gerador produz.

As três rodam os mesmos casos de `lib/dominio/src/nome-do-produto.casos.json`:
caso novo entra no JSON. Mudou a regra, rode
`node tools/padronizar-nomes/gerar-regras.mjs` e copie o original para as
Functions, com a linha de origem no topo.

## Passo 1: o relatório, só leitura

`relatorio.mjs` lê `skus` e `products` do projeto inteiros, em páginas, aplica
o padrão a cada SKU ativo, confere a família e grava um CSV para revisão em
`tmp/` (pasta fora do git). Não grava nada no Firestore.

Pré-requisitos, uma vez:

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms ci
gcloud auth application-default login
```

O firebase-admin vem de `functions/wms`; não precisa do `build`. O login grava
a credencial padrão da conta, que precisa ler o projeto.

Rodar na produção:

```powershell
cd C:\DEV\Dute
node tools/padronizar-nomes/relatorio.mjs --projeto dute-prod
```

Imprime o resumo (quantos SKUs, famílias, por decisão, por motivo, o que há
para conferir) e grava `tmp/nomes-fora-do-padrao-dute-prod-AAAA-MM-DD.csv`,
que o Excel em português abre direto (ponto e vírgula, BOM, CRLF). Não
sobrescreve: se o arquivo do dia já existe, talvez já revisado, o novo sai com
`-2`, `-3` no nome, e o de antes fica como estava. Opções:

- `--familia A.01.0806.005`: só uma família (ou um prefixo de código).
- `--cliente "BTG Pactual"`: só um cliente, pelo `customer_code` (o registro
  sem ele é do cliente legado, "BTG Pactual", como nas Functions). Cliente
  sem SKU para a execução e lista os clientes do cadastro.
- `--saida tmp\outro-nome.csv`: outro arquivo.
- `--com-arquivados`: inclui os SKUs arquivados, marcados em Conferir.
- `--json`: o resumo em JSON, para outro script.

Com `FIRESTORE_EMULATOR_HOST` apontando para o emulador local, o projeto tem
de ser `demo-*`; para a nuvem, limpe a variável antes
(`Remove-Item Env:FIRESTORE_EMULATOR_HOST`).

## O CSV

| Coluna | O que é |
|---|---|
| Cliente, Família, Código, SKU | O cliente, a família (o código sem o tamanho; vazia no SKU sem código do cliente), o código do cliente e o SKU interno. |
| Nome hoje, Nome proposto | O nome como está e o nome no padrão. O proposto é o nome da família: o nome próprio mais comum entre os tamanhos (empate: o de mais saldo; depois, o do menor tamanho), sem contar o nome vazio, o que é só o tamanho ou o que tem o tamanho em conflito. |
| Motivo | O que mudou: espaços, tamanho no nome, gênero, hífen, maiúsculas, caixa das letras, tamanho pelo código e família (o proposto é o nome da família, não o próprio da linha). Vazio quando nada mudou. |
| Tamanho hoje, Tamanho proposto | O campo Tamanho como está e o que ele deve ter: o fim do código quando é um tamanho conhecido; senão, o campo, em maiúsculas quando é um tamanho. |
| Gênero | O campo Gênero, para a conferência. |
| Decisão | `aprovar` quando só a regra agiu; `conferir` quando há algo em Conferir; `—` quando nada muda. É para leitura: o passo 3 não lê o CSV e grava a proposta de todas as linhas, menos as de fora (nome vazio, nome que é só o tamanho, código com mais de um SKU ativo), com as escolhas de `decisoes.mjs` por cima. |
| Conferir | O que uma pessoa decide: família com mais de um nome (todas as linhas dela, com a contagem de cada nome), tamanho no nome diferente do código, tamanho no nome e código sem tamanho, tamanho do código que não é um tamanho conhecido, campo Tamanho diferente do código, gênero do nome diferente do campo Gênero, código com mais de um SKU ativo, `products` com outro nome ou sem registro, SKU sem código do cliente, nome vazio ou só com o tamanho. |

Valor que começa com `=`, `+`, `-` ou `@` sai com um apóstrofo na frente, para
o Excel não ler como fórmula. A planilha do canvas
(`docs/mockups/NomePlanilhaRevisao.dc.html`) foi a ilustração para a
avaliação: o CSV de verdade é este, com estas colunas, e a regra não
acrescenta cor nem aponta digitação (o erro aparece como família com mais de
um nome).

## Passo 2: o cadastro e as telas (na `main` desde o PR 584)

O cadastro grava o produto novo no padrão, pelo `nomeParaGravar` das
Functions: o nome sem o tamanho, com a etiqueta do gênero e a caixa das
letras, e o tamanho do código no campo Tamanho.

- A Contagem, a conferência de abertura, a chegada avulsa, a API e o
  Documentos recusam o que contradiz o código (outro tamanho no fim do nome,
  o campo Tamanho com outro tamanho, o nome que é só o tamanho), com a mesma
  frase da tela.
- O aviso do cliente aprovado e o código a definir da conferência não
  recusam: vale o código, e o nome vai para o padrão.
- O Catálogo só aplica o padrão quando o nome ou o tamanho mudam: editar a cor
  de um produto cujo nome antigo ainda tem o tamanho não trava nem renomeia.
- O produto já cadastrado guarda o nome que tem até o passo 3.

As telas mostram o tamanho ao lado do nome onde há uma linha por tamanho
("Polo Masculino Piquet Preto · XG", com `nomeComTamanho`), e o card do portal
mostra o nome da família, igual em todos os tamanhos. A tela recusa antes o
nome que traz o próprio tamanho (`problemaDoNome`), e a Contagem sugere o nome,
os campos e as fotos da família quando o código é de um tamanho novo.

## Passo 3: aplicar os renomes, sem planilha

O passo 3 grava o padrão nos produtos já cadastrados. Ele não lê o CSV: monta
o mesmo relatório do passo 1 na hora e grava o Nome proposto e o Tamanho
proposto de cada SKU, com as escolhas que a regra não faz sozinha por cima
(`decisoes.mjs`, aprovadas pelo Leonardo em 06/11/2026):

- "Arpoardor", a grafia da maioria da família masculina A.01.0809.002, vira
  "Arpoador"; "Basica" vira "Básica"; "Copo Termico" vira "Copo Térmico";
  "Lancheira Grande Az" vira "Lancheira Grande Azul".
- Os copos de café B.0790.005.U e B.0791.005.U, que tinham o "P" e o "G" no
  nome, viram "Copo Café Pequeno" e "Copo Café Grande".

Fica de fora, sem gravar, o que precisa de uma pessoa: o nome vazio, o nome
que é só o tamanho e o código com mais de um SKU ativo. O campo Gênero não
muda; onde ele contradiz o nome, corrige-se no Catálogo.

Grava por SKU, numa transação, como o `renomear` do acerto de outubro
(`tools/acerto-btg-2026-10`): o nome e o tamanho em `skus` e `products`, o
`product_name` dos saldos e das linhas da abertura, o `product_name` e o
`size` da projeção do portal, o recibo em `operational_operations` e o evento
`catalog.renamed` em `events`. Rodar de novo não repete, pelo recibo de cada
SKU, e o SKU que mudou desde a leitura fica de fora. O histórico (pedidos,
movimentos, eventos) guarda o nome da época.

Só depois de publicar na produção a `main` com o passo 2: nas telas antigas,
os tamanhos de uma família apareceriam todos com o mesmo nome. Os
pré-requisitos são os do passo 1.

```powershell
cd C:\DEV\Dute
git switch main
git pull
node tools/padronizar-nomes/aplicar.mjs --projeto dute-prod
```

Mostra quantos mudam, as linhas com as escolhas e o que fica de fora, sem
gravar nada. `--listar` mostra todas as linhas; `--familia` e `--cliente`
limitam como no relatório; `--json` dá o resumo para outro script. Para
gravar:

```powershell
cd C:\DEV\Dute
node tools/padronizar-nomes/aplicar.mjs --projeto dute-prod --aplicar --confirmo "PADRONIZAR NOMES dute-prod"
```

## Testes

```powershell
cd C:\DEV\Dute
node --test "tools/padronizar-nomes/*.test.mjs"
corepack pnpm --filter "@workspace/app" exec vitest run src/lib/nome-do-produto.test.ts
```

O CI roda os dois: o `node --test` no job das ferramentas e o vitest no
`frontend-typecheck`. O `node --test` cobre o plano do passo 3
(`aplicar.test.mjs`); a gravação roda no cenário do emulador abaixo.

Para ver a leitura do Firestore de ponta a ponta, o cenário no emulador
grava uma família sintética, roda o relatório contra ela e confere o CSV
(exige Java e o firebase-tools; recusa rodar fora de 127.0.0.1):

```powershell
cd C:\DEV\Dute
npx firebase-tools emulators:exec --only firestore --project demo-nomes "node tools/padronizar-nomes/cenario-emulador.mjs"
```

O do passo 3 grava produtos fora do padrão, com saldos, linhas da abertura e a
projeção do portal, roda o `aplicar.mjs` sem gravar e gravando e confere cada
coleção, o recibo, o evento, a retomada sem repetir, o SKU que mudou no meio e
o cliente que não é o do SKU:

```powershell
cd C:\DEV\Dute
npx firebase-tools emulators:exec --only firestore --project demo-nomes "node tools/padronizar-nomes/cenario-aplicar.mjs"
```
