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
   Conectivos em minúscula (de, da, com, e), siglas em maiúsculas (BTG),
   unidade depois de número em minúscula ("500 ml"), cor composta com hífen
   ("Azul-Marinho").
4. Nada além disso: a regra não reordena palavras, não acrescenta cor nem
   corrige digitação. O que ela não resolve sozinha vira "conferir".

A regra mora em `lib/dominio/src/nome-do-produto.ts` (o app e as Functions
vão usá-la na validação do cadastro e na Contagem). `regras.mjs` é a cópia em
JavaScript para a ferramenta, e os dois rodam os mesmos casos de
`lib/dominio/src/nome-do-produto.casos.json`: caso novo entra no JSON.

## Passo 1: o relatório, só leitura

`relatorio.mjs` lê `skus` e `products` do projeto, aplica o padrão a cada SKU
ativo, confere a família e grava um CSV para revisão em `tmp/` (pasta fora do
git). Não grava nada no Firestore.

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
que o Excel em português abre direto (ponto e vírgula, BOM, CRLF). Opções:

- `--familia A.01.0806.005`: só uma família (ou um prefixo de código).
- `--cliente BTG`: só um cliente.
- `--saida tmp\outro-nome.csv`: outro arquivo.
- `--com-arquivados`: inclui os SKUs arquivados, marcados em Conferir.
- `--limite 20000`: mais de 10.000 documentos por coleção (o padrão avisa
  quando chega no limite).
- `--json`: o resumo em JSON, para outro script.

Com `FIRESTORE_EMULATOR_HOST` apontando para o emulador local, o projeto tem
de ser `demo-*`; para a nuvem, limpe a variável antes
(`Remove-Item Env:FIRESTORE_EMULATOR_HOST`).

## O CSV

| Coluna | O que é |
|---|---|
| Cliente, Família, Código, SKU | O cliente, a família (o código sem o tamanho), o código do cliente e o SKU interno. |
| Nome hoje, Nome proposto | O nome como está e o nome no padrão. Numa família com nomes diferentes, o proposto é o nome mais comum entre os tamanhos (empate: o de mais saldo; depois, o do menor tamanho), e as linhas que diferem viram Conferir. |
| Motivo | O que a regra mudou: espaços, tamanho no nome, gênero, hífen, maiúsculas, caixa das letras, tamanho pelo código. Vazio quando nada mudou. |
| Tamanho hoje, Tamanho proposto | O campo Tamanho como está e o que ele deve ter (o fim do código; sem tamanho no código, o campo como está). |
| Gênero | O campo Gênero, para a conferência. |
| Decisão | `aprovar` quando só a regra agiu; `conferir` quando há algo em Conferir; `—` quando nada muda. A coluna é para a revisão: troque o que quiser antes do passo 3. |
| Conferir | O que uma pessoa decide: tamanho no nome diferente do código, campo Tamanho diferente do código, gênero do nome diferente do campo Gênero, nome que difere da família, código com mais de um SKU ativo, `products` com outro nome ou sem registro, nome vazio ou só com o tamanho. |

A linha 13 da planilha do canvas acrescentava a cor na calça; a regra não
faz isso (decisão 4): a cor entra à mão na revisão, se for o caso.

## Os próximos passos

2. PR de código, antes dos dados: o campo Tamanho preenchido pelo fim do
   código, o tamanho ao lado do nome nas telas que só mostravam o nome, e a
   validação na criação do produto (Contagem, Receber, portal, Catálogo) com
   `padronizarNome` de `lib/dominio`, para não voltar a acontecer.
3. Aplicar os renomes com o CSV revisado, na homologação e depois na
   produção, pelo motor do acerto de outubro (`tools/acerto-btg-2026-10`,
   operação `renomear`: skus, products, saldos, linhas da abertura e a
   projeção do portal, com recibo e evento por item, idempotente). Essa
   ferramenta ainda não existe: entra com o OK do Leonardo sobre o CSV.

## Testes

```powershell
cd C:\DEV\Dute
node --test "tools/padronizar-nomes/*.test.mjs"
corepack pnpm --filter "@workspace/app" exec vitest run src/lib/nome-do-produto.test.ts
```

O CI roda os dois: o `node --test` no job das ferramentas e o vitest no
`frontend-typecheck`.
