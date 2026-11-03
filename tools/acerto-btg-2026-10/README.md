# Acerto único do estoque da BTG (29 e 30/10/2026)

Correção, feita uma vez e pelo banco, do que foi contado errado na abertura de
outubro e apareceu na revisão da Cristiane Penteado (BTG) em 29/10/2026
("RE: Saldão PAN/BTG- Dutelog", 14 pontos) e na conferência física do
Guilherme no mesmo dia. Não muda tela, callable nem regra do sistema: o
script grava pelas funções de domínio de `functions/wms`, as mesmas das
callables, e deixa recibo e evento em cada operação. É o mesmo caminho da
zeragem (`tools/full_reset_btg.py`) e da migração (`tools/migracao_firestore.py`).

Decisões do Leonardo em 30/10/2026: a sessão de abertura da BTG está
concluída, então as correções por caixa da Contagem não servem; a sacola N6
tem a mesma base das outras (J.0149.003.N6); o que foi para as caixas de
saldão sai do sistema e fica só na planilha; as caixas no físico estão como o
Guilherme descreveu.

Os códigos errados estão gravados **com o tamanho no fim**, e o portal mostra
só a base, por isso o e-mail cita `A.01.0808.002` e `J.0562.003`. O `--buscar`
na produção (30/10/2026) achou `A.01.0808.002.M` = BTG-000109,
`A.01.05334.005.M` = BTG-000045, `J.0562.003.N6` = BTG-000169,
`A.01.O719.004.P` = BTG-000087 (com letra O) e `A.01.0719.004.PP` =
BTG-000088. O plano usa essas formas.

## Arquivos

- `plano.mjs`: a lista do que gravar, em blocos, com o motivo de cada
  operação apontando o item do e-mail. `pendente` deixa a operação listada e
  fora da aplicação; para ligar, apague o campo.
- `acerto.mjs`: o motor. Dry-run por padrão; `--aplicar` grava.
- `cenario-emulador.mjs`: cenário sintético da BTG para validar no emulador.
  Recusa rodar fora de `127.0.0.1`.

## Blocos do plano

| Bloco | O que grava | Itens do e-mail |
|---|---|---|
| `cadastro` | Renomeia os sete SKUs da A.01.0805.002 para masculina e troca as fotos entre as famílias A.01.0805.002 e A.02.0805.002 | 1 |
| `skus-novos` | Cria os SKUs que faltam (products, skus e a projeção do portal, com categoria e fotos), copiando de um irmão da família, sem saldo; o que já existe fica "sem mudança" | 2, 5, 7, 11, 12, 13 |
| `transferencias` | Saída do SKU errado e entrada no certo, na mesma posição, mesma quantidade | 2, 5, 6, 7, 11, 12, 13 |
| `quantidades` | Ajuste + e Ajuste − pelas contagens do Guilherme; `delta: "zerar"` tira o que sobrar na posição depois das transferências (a sobra da CX-000150 além das 58 contadas) | 4, 5, 7, 9 |
| `saldao` | Saída de tudo que estava nas caixas 5, 32 e 130, e do que saiu da 4; a linha da abertura dessas caixas sai do registro (o Mapa e as Etiquetas montam o conteúdo pelas linhas), com o que ela tinha guardado no evento. Com `itens` ([{ codigo, qtde }]), a baixa é parcial: a linha diminui, ou sai se zerar, e a caixa continua | 8, 10 |
| `caixas` | Remove as caixas 5, 19, 32 e 130 e corrige SKU e quantidade das linhas da abertura das outras, para o Mapa e as Etiquetas | 4 a 13 |
| `arquivar` | Arquiva os SKUs errados já em zero, inclusive no portal | 2, 6, 7, 11, 12 |

Movimentos saem com origem `functions_inventory_movement` e não entram na
cobrança (`billingMovementDirection` só conta `wms_receiving` e
`wms_shipping`). Transferência não muda o total da posição.

Pendentes no plano, à espera do Guilherme: o código A.01.0605.003.P e se o PP
de 9 peças (BTG-000088, `A.01.0719.004.PP`) é o mesmo caso (item 12; antes de
ligar, `--buscar A.01.0605.003` mostra se a família já existe com outros
tamanhos, para copiar nome e fotos dela em vez do SKU errado); a recontagem
da azul A.02.0814.002 depois de separar as pretas (item 13); a A.01.0805.002
caixa por caixa, com o tamanho e a quantidade da etiqueta do fornecedor, já
que as caixas são lacradas (item 14); se a sacola N6 tem 148 (73 na caixa de
72; o `aj-sacola-N6-mais-1` está pronto, falta a linha da caixa); qual SKU e
quantas peças saíram da CX-000004; e se a CX-000036 está em cima da
CX-000018, para remover a CX-000019 (item 9). O Ajuste − das 12 jaquetas
duplicadas não espera: até a CX-000019 sair, o Mapa mostra em A-05 duas
caixas de 12 para um saldo de 12.

O dry-run mostra, em cada transferência e ajuste, o que as outras operações do
plano tiram da mesma posição antes ("também tira(m)", "depois de ..."), porque
cada operação é lida do banco de hoje e a aplicação segue a ordem dos blocos.

## Como rodar, na máquina do Leonardo

Pré-requisitos, uma vez:

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms ci
npm --prefix functions/wms run build
gcloud auth application-default login
```

O `build` é obrigatório: o script importa `functions/wms/lib`. O login grava a
credencial padrão da conta; ela precisa ter acesso ao projeto.

Dry-run, só leitura:

```powershell
cd C:\DEV\Dute
node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod
```

Imprime, por operação, o que o banco tem hoje ("agora") e o que gravaria
("grava"), ou "já aplicado", "sem mudança", "PENDENTE" e "ERRO". Termina com
o resumo. Sai com código 1 se houver erro em operação não pendente.

Erros comuns do dry-run e o que fazer:

- "tem saldo em N posições; informe a posição": acrescente `posicao` na
  operação do plano, literal ("A-13") ou `{ caixa: "CX-000091" }`.
- "Mais de um SKU ativo com o código": o cadastro tem duplicata; ponha o SKU
  (`BTG-000xxx`) no lugar do código do cliente naquela operação.
- "N linha(s) da abertura ... com qtde ou caixa precisa ser exatamente 1": a
  operação de linha com `qtde` ou `caixa` só serve para uma linha; sem os dois,
  `corrigir_linha` corrige todas as linhas do SKU errado (uma por caixa), cada
  uma com a própria quantidade e o próprio recibo.
- "Com FIRESTORE_EMULATOR_HOST o projeto precisa ser demo-*": a variável do
  emulador ficou no shell; limpe-a (`Remove-Item Env:FIRESTORE_EMULATOR_HOST`)
  antes de rodar contra a nuvem.
- "serve de apoio para CX-...": a caixa tem outra em cima no registro. Ou ela
  fica como caixa vazia de apoio, com `se_apoia: "esvaziar"`, ou a de cima
  passa para outra caixa da mesma posição, com `transferir_apoio_para:
  "CX-..."`, ou passa a apoiar direto na prateleira, com `apoio:
  "prateleira"`, e a vazia é removida.
- Para ver uma caixa como o banco a tem (posição, apoio, contadores e cada
  linha da abertura com o saldo do SKU na posição):
  `node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --caixa CX-000004`.
  O `--buscar` com a base e o ponto no fim (`--buscar A.01.0805.002.`) lista a
  família inteira, com saldos e linhas por caixa, e o `--nome` acha o código
  pelo nome do produto (`--nome MAND`).
- "não tem saldo em ...; um Ajuste + criaria saldo numa posição nova": se a
  posição nova é a certa, ponha `posicao_nova: true` no ajuste.
- "SKU ... não encontrado · parecidos: ...": a busca tenta `cod_cliente_key`,
  `cod_cliente`, o `client_item_code` do saldo e o da linha da abertura e, por
  fim, a forma comparável do código, sem pontuação e com letra O valendo zero.
  Quando acha por essa forma, o dry-run mostra `no cadastro "..."` ao lado do
  código. Quando não acha, lista os códigos do cadastro que começam igual
  (quase sempre o mesmo código com o tamanho no fim): ponha no plano o código
  como está gravado ou o SKU (`BTG-000xxx`). Para ver saldo e linhas de um
  código: `node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --buscar A.01.0534.005`.

Dry-runs na produção em 30/10/2026:

1. 27 a gravar, 6 sem mudança, 14 pendentes, 13 erros: quatro cadastros que
   não respondiam pela chave de busca, as caixas 5 e 19 servindo de apoio para
   a 33 e a 36, e o nome do PP da 0805, o único dos sete ainda como "feminina".
2. 29 a gravar, 6 sem mudança, 15 pendentes, 11 erros: só os quatro cadastros.
3. Igual ao 2. O `--buscar` mostrou a causa: os códigos estão gravados com o
   tamanho no fim (`A.01.0808.002.M`, `A.01.05334.005.M`, `J.0562.003.N6`,
   `A.01.O719.004.P`), e o plano pedia a base. O plano passou a usar as formas
   gravadas, ganhou o `criar-0534-M` (o tricot M certo pode não existir) e a
   sobra da 0808 virou `zerar`.
4. 39 a gravar, 7 sem mudança, 15 pendentes, 1 erro. BTG-000109 tem 59 em
   A-11 (o `zerar` tira 1); o tricot certo existe (BTG-000044, `A.01.0534.005.M`,
   30 em A-06), então o `criar-0534-M` fica sem mudança e as 12 entram nele em
   A-02, onde a caixa está. O erro: a sacola N6 tem duas linhas da abertura
   (duas caixas em B-12) e a correção de linha pedia uma só; `corrigir_linha`
   passou a corrigir todas as linhas do SKU errado. Ficou para conferir: a
   CX-000032 tem 24 na linha e a camiseta BTG-000034 tem 25 em A-01
   (`--buscar A.01.0219.004.M` mostra se outra caixa tem a 1 que sobra).
5. Rodado no `28fb51a`, antes das correções da revisão adversarial; serviu só
   para confirmar a sacola em duas caixas.
6. No `18abb70`: 40 a gravar, 7 sem mudança, 15 pendentes, 0 erros. A sacola
   N6 está nas caixas CX-000207 (75) e CX-000208 (72, a que o Guilherme
   contou 73), as duas em B-12; o `ajustar_linha` do +1 pendente é na
   CX-000208. A camiseta BTG-000034 tem 25 em A-01 porque a CX-000004 tem 1
   além das 24 da CX-000032: nada sobra sem caixa, e a CX-000004 entra no
   pendente do item 10. Dry-run limpo: pronto para aplicar.

Aplicar, só depois do dry-run limpo:

```powershell
cd C:\DEV\Dute
node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --aplicar --confirmo "ACERTO BTG dute-prod"
```

Grava na ordem dos blocos. Se uma operação falhar, para ali; o que já foi
gravado fica, e rodar de novo continua de onde parou, porque cada operação
tem chave de idempotência fixa. Uma transferência é duas gravações (saída e
entrada): se parar entre as duas, o dry-run seguinte mostra "saída já
gravada; falta a entrada", com a quantidade e a posição lidas do recibo da
saída, e a aplicação seguinte grava só a entrada. Depois, rode o dry-run de novo: tudo deve
aparecer como "já aplicado". `--bloco <id>` e `--op <id>` limitam a execução.

Depois de aplicar: conferir no portal da BTG os cards 0805, 0809, 0808, 0811,
0534 e a sacola; reimprimir em Estoque › Etiquetas as caixas 76, 79, 83, 90,
91, 92, 150, 198, a caixa que recebeu as 4 G da mescla preto, a do tricot e a
da sacola N6 (a 4 e a 180 quando os pendentes entrarem); responder à Cristiane.
Cada movimento do acerto abre um aviso na caixa de entrada do agente (evento
"attention"), e o script já o deixa resolvido, com o ator do acerto, para o
Início não listar vinte e tantos "avisos para revisar". Os movimentos têm a
origem `functions_manual_inventory`, que conta como entrada de verdade para
o relógio de parados (`lib/dominio/src/parados.ts`): a oceano G, a mescla
preto, a arpoador e a sacola N6 recomeçam a contar os dias parados na data
do acerto, não na da abertura.
A produção tem PITR de 7 dias e backup diário
(`docs/plataforma/backup-e-recuperacao.md`); restaurar é sempre para um banco
novo, com o OK do Leonardo.

## Aplicação na produção (30/10/2026)

Aplicado pelo Leonardo, da máquina dele, depois do sexto dry-run limpo, com o
código do `18abb70`: 40 operações gravadas, nenhuma falha, e o sétimo dry-run
em seguida com 40 "já aplicado", 7 sem mudança, 15 pendentes e 0 erros.

O que ficou no banco:

- SKUs criados: BTG-000174 (`A.02.0809.002.M`, 75 em A-13), BTG-000175
  (`A.02.0808.002.M`, 54 em A-11) e BTG-000176 (`J.0149.003.N6`, 147 em B-12).
- Arquivados, com saldo zero: BTG-000165 (oceano G solto), BTG-000109
  (`A.01.0808.002.M`), BTG-000045 (`A.01.05334.005.M`) e BTG-000169
  (`J.0562.003.N6`).
- O masculino arpoador M (BTG-000075) ficou com 140 em A-13 e 67 em B-11; a
  oceano G (BTG-000160) com 198; o tricot M (BTG-000044) com 12 em A-02 e 30
  em A-06; a mescla preto G (BTG-000062) com 22; a jaqueta P (BTG-000024) com
  12; as caixas 32 e 130 saíram do registro e a 5 ficou vazia como apoio da 33.
- Os sete SKUs da A.01.0805.002 têm as fotos que eram da feminina, e os
  quatro da A.02.0805.002 as que eram da masculina; o PP da masculina ficou
  "POLO MASCULINO PIQUET AZUL MARINHO PP".

Os 15 pendentes continuam no plano. Para ligar um, apague o campo `pendente`
na operação, rode o dry-run (as operações já gravadas aparecem como "já
aplicado") e aplique de novo: só o que faltar é gravado.

## Segunda rodada: respostas do Guilherme (30/10/2026)

1. Sacola N6: a CX-000208 tem 73 (não 72), total 148. Ligados o
   `aj-sacola-N6-mais-1` (+1 em B-12) e o `cx-linha-sacola-mais-1` (linha da
   CX-000208 para 73).
2. CX-000019 não existe; a CX-000036 está em A-05 direto na prateleira, não
   em cima de caixa nenhuma. O `cx-remover-19` ganhou `apoio: "prateleira"`
   (a CX-000036 deixa de depender da CX-000019 no registro) e foi ligado.
3. CX-000004: saíram 12 peças para o saldão (rosa OUT rosa G, GG e XG, 1 cada;
   PAN rosa P, 3; camiseta fio egípcio M, 1; mescla black P, M, G, GG e XG, 1
   cada) e ficaram 12. O `saldao-cx4` virou `baixar_caixa` com `itens`,
   pendente até casar a lista com as linhas da caixa (`--caixa CX-000004`).
4. Polo PAN cinza P: a etiqueta da peça diz `A.01.0719.004.P` (o cadastro
   tinha letra O no lugar do zero), e o PP já está certo. As quatro operações
   do item 12 passaram a criar `A.01.0719.004.P`, mover as 15, corrigir a
   linha e arquivar o `A.01.O719.004.P`; ligadas.
5. Pima preta GG e XG: a CX-000180 só tem pretas, 15 GG e 15 XG; as azuis GG
   e XG são 15 e 15. As quantidades do plano passaram de 25/15 para 15/15;
   ficam pendentes até ver as linhas da CX-000180 e os saldos da azul
   (`--caixa CX-000180`, `--buscar A.02.0814.002.`).
6. Azul-marinho: fotos das etiquetas das caixas, todas em B-05 segundo o
   Guilherme; falta cruzar com as linhas do sistema (`--buscar
   A.01.0805.002.`), inclusive as registradas em B-10.

Antes do oitavo dry-run (02/11/2026), três travas a mais: a busca exata
(criar e destino) só aceita o SKU cujo próprio cadastro tem o código pedido,
para um saldo com `A.01.0719.004.P` digitado certo não fazer o BTG-000087
(`A.01.O719.004.P`) passar pelo SKU novo; transferência e correção de linha
recusam origem e destino iguais; e criar SKU recusa quando já existe um
`products` com o mesmo id, para não gravar por cima.

Com isso o plano tem 62 operações: 47 já gravadas ou a gravar, 7 sem mudança
e 8 pendentes. No emulador: dry-run com 47 a gravar, aplicação com 47, dry-run
seguinte com 47 já aplicadas; a baixa parcial da CX-000004 tem teste próprio
(`ACERTO_PLANO`, só no emulador: um plano alternativo com `itens`).

## Terceira rodada: diagnósticos na produção (02/11/2026)

O oitavo dry-run deu 40 já aplicadas, 7 a gravar, 7 sem mudança, 8 pendentes
e 0 erros (a PAN cinza P está em B-09, na CX-000131). Com o `--caixa` e o
`--buscar`:

1. **Pima preta GG e XG (item 13).** A azul `A.02.0814.002` GG e XG está
   registrada em duas caixas de 15 em A-03: a CX-000179, que é a azul, e a
   CX-000180, que é a das pretas. As seis operações do item 13 foram ligadas:
   criam `A.02.0813.005.GG` e `.XG`, passam 15 de cada da azul para a preta em
   A-03 e corrigem as duas linhas da CX-000180. A azul fica com 15 e 15.
2. **CX-000004 (item 10).** O sistema tem 16 linhas e 19 peças em A-01; as
   duas listas do Guilherme somam 24 (12 saíram para o saldão, 12 ficaram). Por
   SKU: saem para o saldão as 8 peças que o sistema tem e a caixa não tem mais
   (rosa OUT rosa G, GG e XG, 1 cada; PAN rosa P, 3; camiseta fio egípcio M, 1;
   mescla black XG, 1), com o `saldao-cx4` em baixa parcial; a mescla black P,
   M e G que foi para o saldão era peça a mais, fora do sistema, e o sistema já
   mostra a 1 de cada que ficou; a mescla black GG sobe de 1 para 2 e a pima
   preta SW G desce de 2 para 1 (`aj-cx4-*` e `cx-linha-4-*`). Falta a polo
   feminina mand algodão preto G que ficou na caixa: o sistema não a tem ali, e
   o código sai do `--nome MAND`.
3. **Azul-marinho por tamanho (item 14).** As 6 caixas registradas em B-05
   (CX-000154, 156, 157, 158, 159 e 160) batem uma a uma com as etiquetas que o
   Guilherme somou no PDF. A diferença inteira está nas 5 registradas em B-10
   (CX-000136 a CX-000140: G 72, P 34, GG 41, XG 22, M 72, 241 peças), que pelas
   etiquetas são PP 22, P 44 e 50, M 50 e 20, G 20, GG 15 e XG 15 (236 peças).
   Os ajustes `aj-0805-*` acertam os totais em B-10 (PP +22, P +60, M −2,
   G −52, GG −26, XG −7) e deixam o portal com PP 34, P 138, M 246, G 177,
   GG 74, XG 57 e XGG 13; estão pendentes até o Leonardo decidir se corrige os
   totais já ou espera as fotos para corrigir caixa por caixa. O conteúdo das 5
   caixas espera as fotos das etiquetas.

Plano com 73 operações. Na produção, o nono dry-run deve dar 40 já aplicadas,
18 a gravar, 7 sem mudança, 8 pendentes e 0 erros. No emulador, com o cenário
espelhando a CX-000004, a CX-000179 e a CX-000180 da produção: 58 a gravar,
58 aplicadas e 58 já aplicadas em seguida; com os `aj-0805-*` ligados, 64, e os
totais da azul-marinho ficam como as etiquetas.

## Segunda aplicação na produção (02/11/2026)

Aplicada pelo Leonardo depois do nono dry-run limpo, com o código do
`a5291b9`: as 18 operações da segunda e da terceira rodadas. O décimo dry-run
deu 58 já aplicadas, 0 a gravar, 7 sem mudança, 8 pendentes e 0 erros.

O que ficou no banco:

- SKUs criados: BTG-000177 (`A.01.0719.004.P`, a PAN cinza P, 15 em B-09, na
  CX-000131), BTG-000178 (`A.02.0813.005.GG`, 15 em A-03) e BTG-000179
  (`A.02.0813.005.XG`, 15 em A-03), as duas pima pretas na CX-000180.
  Arquivado o BTG-000087 (`A.01.O719.004.P`, com letra O).
- A pima azul `A.02.0814.002` GG e XG ficou com 15 e 15, na CX-000179.
- A sacola N6 ficou com 148 (a CX-000208 com 73).
- A CX-000019 saiu do registro; a CX-000036 apoia direto na prateleira.
- A CX-000004 ficou com 10 linhas e 11 peças: saíram para o saldão a rosa OUT
  rosa G, GG e XG, a PAN rosa P (3), a camiseta fio egípcio M e a mescla black
  XG; a mescla black GG subiu para 2 e a pima preta SW G desceu para 1.

Pendentes, à espera do Guilherme (e-mail do Leonardo de 02/11/2026): as fotos
das etiquetas do fornecedor das caixas CX-000136 a CX-000140, da azul-marinho
(item 14), e o código da polo feminina mand algodão preto G que ficou na
CX-000004, que não existe no cadastro (`--nome MAND` não acha nada).

## Quarta rodada: etiquetas da azul-marinho (03/11/2026)

O Guilherme mandou as etiquetas das 5 caixas da A.01.0805.002 registradas em
B-10. A CX-000137 (P 34) e a CX-000139 (XG 22, caixa da Dutelog, contada)
estão certas. As outras três não:

| Caixa | Sistema | Etiqueta do fornecedor |
|---|---|---|
| CX-000136 | G 72 | G 88 |
| CX-000138 | GG 41 | M 1, G 4, GG 61, XGG 1 |
| CX-000140 | M 72 | M 90 |

As somas do PDF de 29/10 não valem (a etiqueta G 88 nem aparece nelas), então
os ajustes por total da terceira rodada saíram do plano. Entraram, por caixa,
Ajustes + nas três caixas e as linhas correspondentes; as linhas novas da
CX-000138 (M, G e XGG) usam o tipo novo `adicionar_linha`, que copia a sessão
e a posição de uma linha viva da mesma caixa. Os totais ficam M 267, G 249,
GG 120 e XGG 14 (60 peças a mais, todas nas três caixas).

A polo feminina mand algodão preto G da CX-000004 tem o código
`A.02.0712.005.G` na etiqueta; o Ajuste + e a linha dela ficam pendentes até o
`--buscar A.02.0712.005.` mostrar se o SKU existe.

## Validação no emulador (30/10/2026)

Feita no ambiente de desenvolvimento, sem credencial da nuvem, com o
`cenario-emulador.mjs` reproduzindo os números do e-mail e da conferência:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8399
node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto --refazer
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto --buscar A.01.0808.002 --buscar A.01.0534.005
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto              # dry-run: 62 operações, 40 a gravar, 7 sem mudança, 15 pendentes, 0 erros
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto --aplicar    # 40 gravadas
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto              # 40 já aplicadas, 0 a gravar
node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto --conferir
```

O cenário grava os códigos errados como a produção os tem (com o tamanho e o
SKU fixo: BTG-000109, -045, -169, -087, -088), a 0808 com 59 para exercitar o
`zerar`, a sacola N6 nas caixas CX-000207 (75) e CX-000208 (72), o tricot
`A.01.0534.005.M` já existente, para o `criar-0534-M` ficar "sem mudança", e
a CX-000004 com quatro linhas para o teste da baixa parcial. Na segunda
rodada os números são 62 operações, 47 a gravar, 7 sem mudança, 8 pendentes. Dois ciclos a mais
valem a pena: a 0808 com 58 (o `zerar` fica "sem mudança" e a aplicação grava
39), e a retomada, com `ACERTO_TESTE_FALHA_APOS_FOTOS=3` e depois
`ACERTO_TESTE_FALHA_APOS_SAIDA=transf-sacola-N6` na aplicação (só funcionam
no emulador): a primeira para no meio da troca de fotos, a segunda depois da
saída da sacola; cada dry-run seguinte mostra o que falta ("3 SKU(s) já
trocado(s)", "saída já gravada; falta a entrada") e a aplicação seguinte
termina com o mesmo resultado do ciclo sem falha. No fim: A.02.0809.002.M com 75 em A-13 e o masculino M com 207
(140 em A-13, 67 em B-11); arpoador P 66, G 57, GG 19; oceano G 198 e
BTG-000165 arquivado; mescla preto M 54 e G 22, BTG-000109 arquivado; tricot
42 e BTG-000045 arquivado; sacola N6 147 e BTG-000169 arquivada; jaqueta 12;
caixas 32 e 130 removidas, a 5 vazia como apoio da 33, a 19 à espera; 26
movimentos, nenhum com origem cobrada; os pendentes intocados. O emulador
precisa de Java 21 e do `firebase-tools`
(`npx firebase-tools emulators:exec --only firestore --project demo-acerto "..."`).
