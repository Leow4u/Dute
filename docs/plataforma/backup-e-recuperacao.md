# Backup e recuperação do Firestore

Proteção dos dados do Firestore do `dute-prod` (produção) e como recuperar:
o banco `(default)` e, desde 24/10/2026, o `dute-rh`, o banco do RH. **Quem
decide uma restauração é o Leonardo**, passo a passo, como em toda mudança na
produção.

## O que está ligado

Ligado em 20/10/2026, 14:28 UTC, com o OK do Leonardo, no dia em que começou a
contagem de abertura do estoque da BTG.

| Proteção | Configuração | Cobre |
|---|---|---|
| PITR (recuperação para um momento passado) | `POINT_IN_TIME_RECOVERY_ENABLED`, `versionRetentionPeriod` 604800 s | qualquer minuto dos últimos 7 dias, mas nunca antes de 20/10/2026 13:28 UTC (`earliestVersionTime`) |
| Backup diário | agenda `f7938ffd-309d-42db-9dd3-8c5ba4b04005`, `daily`, retenção 1209600 s | um backup por dia, guardado 14 dias. A hora é o Google que escolhe e muda de um dia para outro |
| Proteção contra exclusão | `DELETE_PROTECTION_ENABLED` (desde a criação do banco) | o banco não pode ser apagado sem desligá-la antes |
| Export do corte | `gs://dute-prod-migracao/corte-20261020/` | o banco como estava às 03:17 UTC de 20/10/2026 (476 documentos), antes da contagem de abertura |

Antes de 13:28 UTC de 20/10/2026, a única cópia é o export do corte. Apagar o
banco não apaga os backups: eles ficam até vencer.

O `dute-rh` nasceu em 24/10/2026, 22:34 UTC, já com as três proteções: PITR
de 7 dias, backup diário de 14 dias (agenda própria) e proteção contra
exclusão (workflow `Banco rh`, `tools/banco_rh.sh`, `fase-8-rh.md`). É o banco
com os dados mais sensíveis (CPF, exames e documentos dos colaboradores): as
saídas das ferramentas ficam em `tmp\backup\`, como as do `(default)`, nunca no
git nem em serviço externo.

A homologação (`dute-homolog`) não tem backup, e só o `dute-rh` de lá tem PITR,
porque o script que cria o banco é o mesmo nos dois ambientes: os dados da
homologação são de teste.

Para conferir (só leitura):

```powershell
cd C:\DEV\Dute
gcloud firestore databases describe --database="(default)" --project dute-prod --format="value(pointInTimeRecoveryEnablement,versionRetentionPeriod,earliestVersionTime,deleteProtectionState)"
gcloud firestore databases describe --database=dute-rh --project dute-prod --format="value(pointInTimeRecoveryEnablement,versionRetentionPeriod,earliestVersionTime,deleteProtectionState)"
gcloud firestore backups schedules list --database="(default)" --project dute-prod
gcloud firestore backups schedules list --database=dute-rh --project dute-prod
gcloud firestore backups list --project dute-prod --format="table(name.basename(),database.basename(),snapshotTime,expireTime,state)"
```

## Como recuperar

Nada restaura por cima do `(default)`. Primeiro olhe o passado, depois tire uma
cópia num banco novo, e só então decida o que volta para o `(default)`. Saídas
com dado de produção ficam em `tmp\backup\` (fora do git).

O `dute-rh` se recupera pelos mesmos passos, trocando o banco de origem: no
inventário, `--banco dute-rh`; no clone, `--source-database="projects/dute-prod/databases/dute-rh"`;
no restore, um backup do `dute-rh` (a coluna do banco no `backups list`); no
export e no import, `--database=dute-rh`. Nada restaura por cima dele também.

```powershell
cd C:\DEV\Dute
New-Item -ItemType Directory -Force tmp\backup | Out-Null
```

### 1. Ler o passado (PITR, só leitura)

Na última hora vale qualquer instante. Antes disso, só minuto cheio
(`...:00Z`), e nunca antes do `earliestVersionTime`. Fora dessas regras, o
Firestore recusa ("not a whole minute" ou "too old").

O banco inteiro num minuto passado, comparado com o de agora:

```powershell
python tools\migracao_firestore.py inventario --projeto dute-prod --read-time 2026-10-20T13:30:00Z --saida tmp\backup\manifesto-20261020T1330.json
python tools\migracao_firestore.py inventario --projeto dute-prod --saida tmp\backup\manifesto-agora.json
python tools\migracao_firestore.py comparar --origem tmp\backup\manifesto-20261020T1330.json --destino tmp\backup\manifesto-agora.json
```

O manifesto mostra a contagem por coleção e quais documentos mudaram. Para ver
o conteúdo de um documento naquele minuto:

```powershell
$t = gcloud auth print-access-token
curl.exe -sS -H "Authorization: Bearer $t" "https://firestore.googleapis.com/v1/projects/dute-prod/databases/(default)/documents/customers/BTG_Pactual?readTime=2026-10-20T13:30:00Z" -o tmp\backup\customers-BTG_Pactual-20261020T1330.json
```

### 2. Copiar para um banco novo (OK do Leonardo)

Escolha um nome novo, por exemplo `recuperacao-20261021`. O banco novo vem com
os dados e os índices, mas sem regras e sem TTL (hoje não há política de TTL).
Sem regras, o app não lê nem grava nele, porque só fala com o `(default)`.
Quem lê são o gcloud e as ferramentas de `tools/`.

De um minuto dos últimos 7 dias (PITR):

```powershell
gcloud firestore databases clone --source-database="projects/dute-prod/databases/(default)" --snapshot-time=2026-10-21T10:00:00Z --destination-database=recuperacao-20261021 --project dute-prod
```

Ou do backup diário, de até 14 dias atrás:

```powershell
gcloud firestore backups list --project dute-prod --format="table(name.basename(),snapshotTime,state)"
gcloud firestore databases restore --source-backup=projects/dute-prod/locations/southamerica-east1/backups/<ID> --destination-database=recuperacao-20261021 --project dute-prod
gcloud firestore operations list --database=recuperacao-20261021 --project dute-prod
```

O banco só pode ser lido depois que a operação termina. Para comparar com o
`(default)`, rode o `inventario` com `--banco recuperacao-20261021` e o
`comparar`, como no passo 1.

### 3. Trazer de volta para o `(default)` (OK do Leonardo)

Só depois de comparar e de decidir quais coleções voltam. Se for muita coisa,
congele o `dute-prod` antes (`tools\congelar_projeto.ps1`) para ninguém gravar
no meio.

```powershell
$d = Get-Date -Format yyyyMMddTHHmm
gcloud firestore export gs://dute-prod-migracao/antes-da-recuperacao-$d --project dute-prod --database="(default)"
gcloud firestore export gs://dute-prod-migracao/recuperacao-$d --collection-ids=<colecoes> --project dute-prod --database=recuperacao-20261021
gcloud firestore import gs://dute-prod-migracao/recuperacao-$d --collection-ids=<colecoes> --project dute-prod --database="(default)"
```

O primeiro export guarda o estado atual. O import sobrescreve cada documento que
tem o mesmo caminho e não apaga os outros: o que foi criado depois do momento
escolhido continua lá. O import não grava em `events`. Por isso, registre no
histórico abaixo o momento escolhido, as coleções, o motivo e quem decidiu.
Depois, apague o banco de recuperação. Ele nasce com a proteção contra
exclusão, como o de origem, e ela sai antes, só nele:

```powershell
gcloud firestore databases update --database=recuperacao-20261021 --no-delete-protection --project dute-prod
gcloud firestore databases delete --database=recuperacao-20261021 --project dute-prod
```

## Teste de restauração

Prova que o backup diário restaura: antes da primeira carga do Comercial na
produção e, depois, a cada trimestre (`plano-de-implantacao.md`, seção 11). Um
teste por banco, o `(default)` e o `dute-rh`. O banco de origem não é gravado
em nenhum passo.

Quem roda é o workflow `Teste de restauração`
(`.github/workflows/teste-restauracao.yml`), por disparo manual, com o OK do
Leonardo: Actions > Teste de restauração > Run workflow, com o banco.

- **Sem marcar "executar"**, ele só mostra o backup `READY` mais novo do banco
  e o nome do banco de teste. Comece assim.
- **Com "executar"**, ele (`tools/teste_restauracao.py`):
  1. apaga o banco de teste que sobrou de um teste anterior, se houver;
  2. restaura o backup num banco novo, `teste-restauracao-<banco>-<instante>`,
     e espera a restauração terminar (até 45 minutos);
  3. lê os caminhos dos documentos do banco restaurado e os do banco de
     origem no minuto cheio do backup e no seguinte, pelo PITR;
  4. apaga o banco de teste, mesmo quando a conferência falha.

  O banco restaurado nasce com a proteção contra exclusão, como o de origem.
  Para apagar o de teste (no passo 1 e no 4), a ferramenta tira a proteção
  antes, só dele: a trava do nome `teste-restauracao-*` vale para os dois
  comandos.
- **O esperado** é "OK: o backup restaurou os N documentos". A diferença só
  vale para o documento criado ou apagado dentro do minuto do backup, que a
  leitura em minutos cheios não alcança. Qualquer outra reprova o teste.
- **Só caminhos.** A consulta pede só o caminho de cada documento, nunca os
  campos. O log e o resumo do job mostram só as contagens por coleção.
- **O registro:** o resumo do job traz a linha para a tabela abaixo.
- **A conta** é a das functions, `github-actions-functions@dute-prod`, com
  `roles/datastore.owner` (`fase-8-rh.md`). Sem o papel, o teste falha dizendo
  qual falta, e nada é restaurado.
- **O backup** precisa ter menos de 7 dias, o alcance do PITR. Com mais de 48
  horas, o job avisa que a agenda parou.

### Conferir também o conteúdo, à mão

O workflow confere os caminhos. Para conferir também o conteúdo (o hash dos
campos de cada documento), rode o teste da máquina do Leonardo. O manifesto tem
dado de produção e fica em `tmp\backup\`. Os passos 1 e 3 gravam, cada um com o
OK do Leonardo.

```powershell
cd C:\DEV\Dute
New-Item -ItemType Directory -Force tmp\backup | Out-Null
gcloud firestore backups list --project dute-prod --format="table(name.basename(),snapshotTime,state)"
```

Anote o ID do backup `READY` mais recente e o `snapshotTime` dele.

1. **Restaurar num banco de teste** (OK do Leonardo):

   ```powershell
   gcloud firestore databases restore --source-backup=projects/dute-prod/locations/southamerica-east1/backups/<ID> --destination-database=restauracao-teste --project dute-prod
   gcloud firestore operations list --database=restauracao-teste --project dute-prod
   ```

   Espere a operação terminar (`SUCCESSFUL`).

2. **Comparar** (só leitura). O `(default)` é lido no minuto cheio do
   `snapshotTime`, sem os segundos (exemplo: `2026-10-21T04:12:37Z` vira
   `2026-10-21T04:12:00Z`):

   ```powershell
   python tools\migracao_firestore.py inventario --projeto dute-prod --banco restauracao-teste --saida tmp\backup\manifesto-restauracao-teste.json
   python tools\migracao_firestore.py inventario --projeto dute-prod --read-time <minuto-cheio> --saida tmp\backup\manifesto-default-no-backup.json
   python tools\migracao_firestore.py comparar --origem tmp\backup\manifesto-default-no-backup.json --destino tmp\backup\manifesto-restauracao-teste.json
   ```

   O esperado é "Iguais.", com as mesmas contagens de `customers`,
   `warehouse_positions` e `warehouse_boxes`. Se houver diferença, ela só pode
   estar em documentos com `update_time` entre o minuto cheio e o
   `snapshotTime`. Confira esses documentos no manifesto. Diferença em qualquer
   outro documento é falha do teste.

3. **Apagar o banco de teste** (OK do Leonardo). Ele nasce com a proteção
   contra exclusão, que sai antes, só nele:

   ```powershell
   gcloud firestore databases update --database=restauracao-teste --no-delete-protection --project dute-prod
   gcloud firestore databases delete --database=restauracao-teste --project dute-prod
   gcloud firestore databases list --project dute-prod
   ```

   Só o `(default)` e o `dute-rh` podem sobrar na lista.

À mão, o `dute-rh` usa um backup dele no passo 1 e `--banco dute-rh` no
inventário do minuto cheio do passo 2. Os manifestos guardam só o caminho, o
hash dos campos e a data de cada documento, sem o conteúdo; mesmo assim,
apague-os de `tmp\backup\` depois de comparar.

### Registro dos testes

| Data | Banco | Backup (`snapshotTime`) | Resultado |
|---|---|---|---|
| 26/10/2026 | `(default)` | 2026-10-25T23:46:47.420101Z | OK: o backup restaurou os 4940 documentos do (default), em 11 min 36 s. O banco de teste não foi apagado: nasceu com a proteção contra exclusão (ver o histórico) |
| — | `dute-rh` | — | pendente: o banco nasceu em 24/10/2026 22:34 UTC |

## Histórico

| Data | O quê |
|---|---|
| 20/10/2026 14:28 UTC | PITR de 7 dias e backup diário com retenção de 14 dias ligados no `dute-prod`, com o OK do Leonardo. Leitura no passado conferida: o inventário de 13:30:00 UTC deu 679 documentos, e as leituras fora do minuto cheio ou anteriores a 13:28 foram recusadas |
| 24/10/2026 22:34 UTC | O banco `dute-rh` criado no `dute-prod` pelo workflow `Banco rh`, com o OK do Leonardo: proteção contra exclusão, PITR de 7 dias e backup diário de 14 dias desde a criação (`fase-8-rh.md`) |
| 26/10/2026 17:04 UTC | Primeiro teste de restauração do `(default)`, com o OK do Leonardo (workflow `Teste de restauração`, run 40365137550): o backup restaurou os 4940 documentos. O banco de teste `teste-restauracao-default-20261026t170444` nasceu com a proteção contra exclusão, e a exclusão foi recusada (`FAILED_PRECONDITION`). Ele ficou no projeto, com a cópia dos dados, até o teste seguinte. A ferramenta passou a tirar a proteção do banco de teste antes de apagar |
