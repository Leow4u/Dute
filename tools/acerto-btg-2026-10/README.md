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
| `skus-novos` | Cria os SKUs que faltam, copiando categoria, gênero e fotos de um irmão da família, sem saldo | 2, 5, 7, 12, 13 |
| `transferencias` | Saída do SKU errado e entrada no certo, na mesma posição, mesma quantidade | 2, 5, 6, 7, 11, 12, 13 |
| `quantidades` | Ajuste + e Ajuste − pelas contagens do Guilherme | 4, 5, 7, 9 |
| `saldao` | Saída de tudo que estava nas caixas 5, 32 e 130, e do que saiu da 4 | 8, 10 |
| `caixas` | Remove as caixas 5, 19, 32 e 130 e corrige SKU e quantidade das linhas da abertura das outras, para o Mapa e as Etiquetas | 4 a 13 |
| `arquivar` | Arquiva os SKUs errados já em zero, inclusive no portal | 2, 6, 7, 11, 12 |

Movimentos saem com origem `functions_inventory_movement` e não entram na
cobrança (`billingMovementDirection` só conta `wms_receiving` e
`wms_shipping`). Transferência não muda o total da posição.

Pendentes no plano, à espera do Guilherme: o código A.01.0605.003.P e o PP
de 9 peças (item 12); a recontagem da azul A.02.0814.002 depois de separar as
pretas (item 13); a A.01.0805.002 por tamanho (item 14); se a sacola N6 tem
147 ou 148; e qual SKU e quantas peças saíram da CX-000004.

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
- "N linha(s) da abertura ... precisa ser exatamente 1": informe `caixa` na
  operação de linha.
- "serve de apoio para CX-...": a caixa tem outra em cima. Ou ela fica como
  caixa vazia de apoio, com `se_apoia: "esvaziar"`, ou a de cima passa para
  outra caixa da mesma posição, com `transferir_apoio_para: "CX-..."`, e a
  vazia é removida.
- "SKU ... não encontrado": a busca tenta `cod_cliente_key`, `cod_cliente`,
  o `client_item_code` do saldo e o da linha da abertura e, por fim, a forma
  comparável do código, sem pontuação e com letra O valendo zero. Quando acha
  por essa forma, o dry-run mostra `no cadastro "..."` ao lado do código. Se
  mesmo assim não acha, veja o que o banco tem com
  `node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --buscar A.01.0808.002`
  e ponha o SKU (`BTG-000xxx`) no plano.

Primeiro dry-run na produção, 30/10/2026: 27 a gravar, 6 sem mudança, 14
pendentes e 13 erros. Os erros eram quatro cadastros que não respondiam pela
chave de busca, as caixas 5 e 19 servindo de apoio para a 33 e a 36, e o
nome do PP da 0805, o único dos sete ainda como "feminina". Tudo isso entrou
nesta versão; a segunda rodada deve ficar sem erro fora dos pendentes.

Aplicar, só depois do dry-run limpo:

```powershell
cd C:\DEV\Dute
node tools/acerto-btg-2026-10/acerto.mjs --projeto dute-prod --aplicar --confirmo "ACERTO BTG dute-prod"
```

Grava na ordem dos blocos. Se uma operação falhar, para ali; o que já foi
gravado fica, e rodar de novo continua de onde parou, porque cada operação
tem chave de idempotência fixa. Depois, rode o dry-run de novo: tudo deve
aparecer como "já aplicado". `--bloco <id>` e `--op <id>` limitam a execução.

Depois de aplicar: conferir no portal da BTG os cards 0805, 0809, 0808, 0811
e a sacola; reimprimir em Estoque › Etiquetas as caixas 4, 76, 79, 83, 90,
91, 92, 150, 152, 198, a do tricot e a da sacola N6; responder à Cristiane.
A produção tem PITR de 7 dias e backup diário
(`docs/plataforma/backup-e-recuperacao.md`); restaurar é sempre para um banco
novo, com o OK do Leonardo.

## Validação no emulador (30/10/2026)

Feita no ambiente de desenvolvimento, sem credencial da nuvem, com o
`cenario-emulador.mjs` reproduzindo os números do e-mail e da conferência:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8399
node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto --refazer
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto              # dry-run: 46 a gravar, 14 pendentes, 0 erros
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto --aplicar    # 46 gravadas
node tools/acerto-btg-2026-10/acerto.mjs --projeto demo-acerto              # 46 já aplicadas, 0 a gravar
node tools/acerto-btg-2026-10/cenario-emulador.mjs --projeto demo-acerto --conferir
```

No fim: A.02.0809.002.M com 75 em A-13 e o masculino M com 207; arpoador P
66, G 57, GG 19; oceano G 198 e BTG-000165 arquivado; mescla preto M 54 e G
22, A.01.0808.002 arquivado; tricot 42; sacola N6 147 e J.0562.003 arquivada;
jaqueta 12; caixas 5, 19, 32 e 130 removidas; 26 movimentos, nenhum com
origem cobrada; os pendentes intocados. O emulador precisa de Java 21 e do
`firebase-tools` (`npx firebase-tools emulators:exec --only firestore --project demo-acerto "..."`).
