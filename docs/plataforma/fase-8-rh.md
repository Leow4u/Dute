# Fase 8: RH

Desenho e registro da Fase 8 do plano de implantação
(`plano-de-implantacao.md`, seção 10). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Os documentos, a CNH, os exames e os treinamentos de cada colaborador, com
  o vencimento avisado.
- Num banco à parte, que a operação não lê.
- A exportação da competência para a contabilidade, que faz a folha e
  transmite o eSocial (parte 8.3; pergunta 24).

## O que existe hoje

- **O papel `rh` e o módulo `rh`** estão na lista única de `lib/dominio`
  desde a Fase 2. As callables de hoje negam o papel `rh` por padrão.
- **O cadastro operacional do colaborador** é o `collaborators` da Operação
  (Fase 3): o nome, a função, os papéis, a CNH com a validade, o telefone e o
  vínculo.
  - A rotina `runDailyAlerts` já avisa a CNH que vence, no Início da
    Operação.
  - Esse cadastro continua onde está. O RH guarda o sensível ligado ao id do
    colaborador.

## Decisões

| Pergunta | Decisão |
|---|---|
| 23 | `owner` e `admin` leem o RH; só `rh` grava (a recomendação). |
| 24 | A folha e o eSocial ficam com a contabilidade: a Dute exporta, por competência, os colaboradores e os exames, com os dados do S-2220, e quem faz a folha transmite (Leonardo, 24/10/2026). A Dute não assina XML nem guarda certificado digital. |
| 61 | No empate da data de emissão, vale o registro lançado por último (25/10/2026; registro abaixo). |
| 62 | Os exames ocupacionais são um grupo só: vale o ASO mais recente (25/10/2026). |
| 63 | Guardar a data de admissão e a de desligamento, e a planilha de colaboradores listar quem teve vínculo no mês (25/10/2026; parte 8.4). |
| Tela da 8.4 | Alinhada em 26/10/2026: as datas ficam no banco `dute-rh`, gravadas só pelo `rh`; o desligamento não mexe no cadastro da Operação; o próprio sem admissão entra na planilha se está ativo; "Sem admissão" aparece em Pessoas e na Exportação, fora do "Precisa de você". |

- **O banco `dute-rh` é um banco Firestore à parte**, no mesmo projeto, com as
  regras dele (`firestore-rh.rules`). Guarda os documentos, os exames e os
  treinamentos ligados ao id do colaborador e, na parte 8.3, as versões da
  exportação para a contabilidade.
- **O navegador não lê nem grava o banco `dute-rh`.**
  - As regras de um banco nomeado não leem o `users` do banco padrão, então
    não sabem o papel de quem pede.
  - Abrir por outro caminho, como uma claim no token ou uma cópia dos papéis
    no banco `dute-rh`, criaria uma segunda lista de papéis, que pode divergir.
  - Quem lê e grava é a codebase `functions/rh`, pelas callables, que
    conferem o papel no `users` do banco padrão, como todas as outras.
  - O RH não tem tempo real: a tela lê pela callable e lê de novo depois de
    cada gravação.
  - Uma transação vale para um banco só: a gravação confere o colaborador
    no banco padrão antes e grava o registro, o recibo e o evento numa
    transação do banco `dute-rh`.
- **A ficha do colaborador** é o conjunto dos registros dele em `registros`.
  - Cada registro é um documento, um exame ou um treinamento, com o tipo
    do catálogo (`functions/rh/src/domain/ficha.ts`).
  - Também traz o dia em que foi emitido ou feito e, quando vence, o dia do
    vencimento.
  - O exame guarda o resultado (apto, apto com restrição, inapto). O tipo
    "outro" leva um nome.
  - A CNH não entra: ela é do cadastro da Operação.
  - Em cada tipo, o vigente é o mais recente. Os outros ficam substituídos,
    com o histórico. Lançar o exame antigo depois do novo não tira o novo do
    lugar, e arquivar o vigente devolve o anterior.
  - O tipo não muda depois de gravado: para trocar, arquiva e registra de
    novo.
- **Os eventos do RH ficam no `events` do próprio banco `dute-rh`**
  (invariante 2).
  - O `events` do banco padrão é lido por interno, wms e suporte, e um
    evento de exame já diz coisa de saúde.
  - O evento leva o id do colaborador, a categoria, o tipo e as datas.
  - Nunca leva o nome do registro, o resultado do exame, o arquivo nem o
    salário.
- **Os arquivos do RH** ficam no Storage, em `rh/{colaborador}/`, fechados ao
  navegador pelas regras. Sobem e descem por URL assinada da callable, que
  confere o papel (parte 8.2).
- **Os vencimentos.**
  - Entra no Início do RH o registro vigente de quem está ativo que vence
    em até 30 dias, e o vencido também. A tela lê pela callable
    `getRhPanel`, a mesma regra da rotina (`vencimentosDoDia`).
  - A rotina diária da codebase `rh` (`runRhAlerts`, 06:10) grava o evento
    `rh.record_expiring` ou `rh.record_expired`. É uma vez por registro, por
    vencimento e por marco: rodar de novo não duplica, e o vencimento
    corrigido avisa de novo. O evento é o que a IA mede.
  - A CNH segue avisada no Início da Operação, como hoje.
- **A zeragem do WMS nunca toca o banco `dute-rh`.** O `tools/full_reset_btg.py`
  abre o banco padrão e recusa o `--database dute-rh` (parte 8.1a).
- **Liberação própria:** `RH_AMBIENTES_LIBERADOS`, só o `dute-homolog` até o
  lançamento, com o OK do Leonardo.

## Como o banco `dute-rh` nasce

O banco `dute-rh` precisa existir antes de o `firebase.json` apontar para
ele, e nos dois projetos que a publicação atende: a homologação e a
produção. A publicação sobe as regras de todo banco do `firebase.json` em
cada projeto. Sem o banco, ela falha, e com ela nada mais sobe. Por isso, as
partes até a 8.2 não ligam o banco nem a codebase na publicação, e a 8.1b só
entra depois de o banco existir nos dois projetos.

O nome não pode ser `rh`: o Firestore exige de 4 a 63 caracteres no id do
banco (a correção de 24/10/2026, no registro).

Criar o banco não abre nada. As regras dele negam tudo, e as callables do RH
só atendem na homologação (`RH_AMBIENTES_LIBERADOS`) até o lançamento da
fase.

Quem cria é o workflow `Banco rh` (`.github/workflows/banco-rh.yml`), por
disparo manual, um ambiente por vez. Ele roda o `tools/banco_rh.sh`:

- cria o banco em `southamerica-east1`, nativo, com proteção contra exclusão
  e PITR;
- repete a mudança que o Firestore aborta logo depois de criar o banco;
- na produção, cria o backup diário de 14 dias, como o do banco padrão
  (`docs/plataforma/backup-e-recuperacao.md`);
- se o banco já existe, só confere, e liga o que faltar;
- nunca apaga nem desliga nada.

A conta do workflow é a das functions (`github-actions-functions@<projeto>`).
Criar banco exige `roles/datastore.owner`, que ela não tinha (decisão do
Leonardo em 24/10/2026: liberar a conta do CI). Quem concede é o Leonardo,
uma vez, porque só o Owner do projeto mexe em papel:

```powershell
cd C:\DEV\Dute
foreach ($p in @("dute-homolog", "dute-prod")) {
  gcloud projects add-iam-policy-binding $p --member="serviceAccount:github-actions-functions@$p.iam.gserviceaccount.com" --role=roles/datastore.owner --condition=None
}
```

Depois, Actions > Banco rh > Run workflow, primeiro com `homologacao` e
depois com `producao`. Sem o papel, o job falha dizendo qual falta, e nada é
criado.

Com o banco criado nos dois, o papel pode sair da homologação (o mesmo laço
com `remove-iam-policy-binding`, só com o `dute-homolog`). Na produção ele
fica: o workflow `Teste de restauração` restaura e apaga o banco de teste com
essa conta (`backup-e-recuperacao.md`). Sem o papel, os dois workflows falham
dizendo qual falta, mas a publicação continua: ela só publica as regras do
banco, e para isso bastam os papéis que a conta já tinha.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 8.0 | O desenho (este documento) | — |
| 8.1a | As regras do banco `dute-rh`, fechadas ao navegador; a codebase `functions/rh` (o perfil, a liberação, o recibo e o evento no banco `dute-rh`); os jobs do CI. Ainda fora da publicação | Nenhum papel lê nem grava o banco `dute-rh` pelo navegador; só `rh`, `admin` e `owner` passam pela callable, e só `rh` grava |
| 8.1b | Com o banco criado pelo workflow `Banco rh` nos dois ambientes: o `firebase.json` com o banco `dute-rh` e a codebase `rh`; a publicação confere as regras dele; o `RH_PUBLICADO` do app passa a `true` no mesmo PR, e as telas ligam na homologação | A trava do `platform-lists.test.ts` exige o `RH_PUBLICADO` igual à codebase no `firebase.json` |
| 8.2a | A ficha no servidor: os registros no banco `dute-rh`, o vigente de cada tipo, o recibo e o evento no banco `dute-rh`, o painel e a rotina dos vencimentos | O vencimento gera o alerta uma vez por marco; nada do RH cai no banco padrão; só o rh grava |
| 8.2b | Os arquivos da ficha: sobem e descem por URL assinada da callable, e cada abertura fica registrada | O documento só abre pelo RH |
| 8.2c | As telas de leitura, desligadas até a 8.1b: o shell do RH, o Início com os vencimentos, Pessoas e a ficha | Os textos e o `axe` de cada tela; as rotas só existem com a liberação; só owner, admin e rh abrem |
| 8.2d | As ações na ficha: incluir, alterar e arquivar o registro, subir e abrir o arquivo | Owner e admin não veem as ações de gravar; o arquivo abre pela callable |
| 8.3 | A exportação da competência para a contabilidade: os exames do mês com os códigos do S-2220 e os colaboradores próprios, em CSV, por versão; a tela Exportação | A mesma competência sem mudança devolve a mesma versão, sem evento novo; só o rh gera; cada download fica registrado |
| 8.4a | As datas do vínculo no servidor: a admissão e o desligamento do próprio no banco `dute-rh` (`saveRhVinculo`, só o rh), na ficha e no painel; a planilha de colaboradores com quem teve vínculo no mês | Quem entra depois da competência não aparece nela; o nome mudado depois não cria versão nova do mês; o cadastro da Operação não muda |
| 8.4b | As datas na tela: o formulário da ficha, as datas e o "Sem admissão" em Pessoas, a lista "Sem data de admissão" na Exportação | Os textos e o `axe` de cada tela; owner e admin não veem o botão de gravar |

**Pronto quando** só `rh`, `admin` e `owner` leem o RH, pela callable, e o
exame, o treinamento e o documento vencendo aparecem no Início do RH (a CNH,
no da Operação).

## Registro

### Parte 8.1a: as regras do banco `dute-rh` e a codebase `functions/rh`

Feita em 23/10/2026. Nada entra na publicação: o `firebase.json` só ganha o
banco `dute-rh` e a codebase na parte 8.1b, depois de o banco existir.

- **`firestore-rh.rules`** fecha o banco inteiro ao navegador, para todo
  papel, inclusive o rh, o owner e o admin.
- **A codebase `functions/rh`** (npm, como as outras):
  - `requireRhCaller` confere, nesta ordem:
    - a liberação (`RH_AMBIENTES_LIBERADOS`, só o `dute-homolog`);
    - o login e o perfil no `users` do banco padrão;
    - o papel: owner, admin e rh abrem; só o rh grava.
  - A callable `rhStatus` dizia ao shell quem abre e se grava; saiu na 8.2c,
    porque o app decide pelo papel (`lib/rh/navegacao.ts`).
  - O recibo, o evento e o acesso ao banco `dute-rh` entram na parte 8.2a, com a
    primeira gravação.
- **O CI** ganha `rh-unit` e `rh-integration`, e a publicação da produção
  espera os dois.
- **A zeragem** recusa o `--database dute-rh`.
- **As travas:**
  - `platform-lists.test.ts` trava os papéis do RH contra `lib/dominio`: os
    que têm o módulo `rh` abrem, e só o rh grava;
  - também trava a liberação.
- **Testes:**
  - `functions/wms/src/rh.rules.test.ts`: nenhum papel lê, lista, cria,
    muda nem apaga;
  - `functions/rh`: o formato das callables, os papéis, a liberação e o
    perfil no emulador;
  - `tools/test_full_reset_btg.py`: a zeragem recusa o banco do RH.

### O workflow `Banco rh` (antes da parte 8.1b)

Feito em 24/10/2026. O Leonardo pediu que o banco fosse criado sem ele rodar
os comandos e escolheu liberar a conta do CI (`roles/datastore.owner`).

- **`.github/workflows/banco-rh.yml`:** disparo manual, um ambiente por vez,
  com a conta das functions pelo Workload Identity.
- **`tools/banco_rh.sh`:**
  - cria o banco `dute-rh` com proteção contra exclusão;
  - liga o PITR;
  - na produção, cria o backup diário de 14 dias;
  - se o banco existe, só confere e liga o que faltar;
  - falha sem mexer quando o banco está em outra região ou é de outro tipo;
  - sem o papel, falha dizendo qual falta.
- **Testes:**
  - `tools/test_banco_rh.py`: o script com um `gcloud` de mentira (criar,
    rodar de novo, homologação sem backup, sem o papel, outra região, projeto
    fora da lista);
  - `tools/test_workflows.py`: o workflow só roda por disparo manual, com os
    projetos e os números da publicação, a conta das functions e o script.
- **A primeira execução**, na homologação em 24/10/2026, antes do papel: o
  `describe` achou o banco ausente e o `create` recusou com "does not have
  permission", sem a palavra `PERMISSION_DENIED`, e a dica do papel não
  saiu. O script passou a reconhecer as duas formas; nada foi criado.
- **A execução com o papel**, na homologação em 24/10/2026: o `create`
  recusou o nome, "database_id should be 4-63 characters". Nada foi criado.

### Correção: o banco se chama `dute-rh`

Feita em 24/10/2026, antes da parte 8.1b. O id de um banco do Firestore tem
de 4 a 63 caracteres, só minúsculas, números e hífen, e começa por letra. O
`rh` tem dois e foi recusado na execução com o papel. O emulador aceita
qualquer nome e o `gcloud` de mentira não conferia, então nenhum teste
pegou.

- **O nome** passa a `dute-rh` no `RH_DATABASE`
  (`functions/rh/src/domain/banco.ts`), no `tools/banco_rh.sh` e na zeragem
  (`PROTECTED_DATABASES` do `tools/full_reset_btg.py`). O workflow continua
  `Banco rh`, e a codebase, o papel e o módulo continuam `rh`.
- **Testes:**
  - `functions/rh/src/domain/banco.test.ts`: o id segue a regra do
    Firestore;
  - `tools/test_banco_rh.py`: com o papel, o `gcloud` de mentira recusa o id
    como o Firestore, e o nome do script é o da codebase e o que a zeragem
    recusa;
  - `tools/test_full_reset_btg.py`: a zeragem recusa o `dute-rh`.
- **A execução com o nome novo**, na homologação em 24/10/2026: criou o
  `dute-rh` com a proteção contra exclusão, mas ligar o PITR logo depois
  voltou "ABORTED: There are concurrent database changes". A execução
  seguinte, um minuto depois, só ligou o PITR e terminou OK.

### Correção: o banco nasce com o PITR, e a mudança abortada se repete

Feita em 24/10/2026, antes da produção. Logo depois de criar o banco, o
Firestore recusa mudá-lo por alguns segundos.

- **O `create`** leva o `--enable-pitr`: o banco nasce com a proteção e o
  PITR, sem mudança logo em seguida.
- **As mudanças** (ligar a proteção ou o PITR num banco que já existia e
  criar a agenda do backup na produção) se repetem até 5 vezes quando voltam
  `ABORTED`, esperando 5, 10, 15 e 20 segundos. Qualquer outro erro falha na
  hora, como antes.
- **Testes** (`tools/test_banco_rh.py`, com o `gcloud` de mentira que aborta
  as próximas mudanças):
  - a produção cria com o PITR e só depois agenda o backup;
  - a mudança abortada se repete e termina;
  - a agenda do backup abortada também se repete;
  - abortada nas 5 tentativas, o script desiste com o erro.

### Parte 8.2a: a ficha no servidor

Feita em 23/10/2026. Ainda fora da publicação, como a 8.1a.

- **Os registros** (`domain/ficha.ts`, puro, e `domain/ficha-gravacao.ts`):
  - `saveRhRecord` inclui ou altera; `archiveRhRecord` arquiva. Só o rh
    grava. A edição velha recusa, e o recibo fica em `rh_operations`.
  - Cada gravação refaz a situação do grupo (o mesmo colaborador, a mesma
    categoria e o mesmo tipo) e grava o evento de cada registro que passou
    a substituído ou voltou a vigente.
- **As leituras.** `getRhPanel` traz quem está ativo, com a ficha resumida,
  e os vencimentos, que são o "Precisa de você" do RH. `getRhFicha` traz a
  ficha de uma pessoa, ativa ou não, com o histórico. Do cadastro da
  Operação, o RH lê só o nome, a função, o vínculo e se está ativo.
- **A rotina** `runRhAlerts` (`domain/rotina-gravacao.ts`), todo dia às
  06:10, fora da liberação não faz nada.
- **Testes:**
  - `ficha.test.ts` e `events.test.ts`: o catálogo, a entrada, o vigente de
    cada tipo, os vencimentos e o payload sem resultado nem nome;
  - `ficha.integration.test.ts`: o registro no banco `dute-rh` e nada no
    padrão, owner e admin só leem, a troca do vigente, arquivar devolve o
    anterior e o painel;
  - `rotina.integration.test.ts`: o alerta uma vez por marco, o vencimento
    corrigido e o renovado;
  - `rh.rules.test.ts` passa a conferir as coleções de verdade
    (`registros`, `events` e `rh_operations`).

### Parte 8.2b: os arquivos da ficha

Feita em 23/10/2026. Ainda fora da publicação.

- **Os caminhos.** O arquivo fica em
  `rh/{colaborador}/{registro}/{arquivo}`. Aceita PDF, JPG, PNG ou WebP,
  até 10 MB. O `storage.rules` não abre `rh/**` a nenhum papel: cai na
  regra que nega tudo.
- **As callables** (`domain/arquivos.ts`, puro, e
  `domain/arquivos-gravacao.ts`):
  - `requestRhUpload` (só o rh) dá a URL assinada para subir, válida por
    10 minutos, e não grava nada.
  - `attachRhFile` (só o rh) confere no bucket se o arquivo chegou, se é
    do tipo informado e se cabe. Depois o liga ao registro, com a edição,
    o recibo e o evento `rh.file_attached`. O arquivo trocado continua no
    bucket, em `arquivos_anteriores`.
  - `openRhFile` (owner, admin e rh) dá a URL assinada para abrir, válida
    por 5 minutos. Antes, grava o evento `rh.file_opened` com quem abriu.
    O registro arquivado ainda abre: é o histórico.
- **A ficha na tela** recebe o arquivo sem o caminho no bucket.
- **A assinatura** usa a service account das Functions, como o upload de
  documentos do WMS (role Service Account Token Creator). Sem ela, a
  callable recusa com a mensagem que diz o que falta.
- **Testes:**
  - `arquivos.test.ts`: o caminho, a entrada, a conferência do bucket e
    quem grava cada evento;
  - `arquivos.integration.test.ts`, com o Storage do emulador: subir,
    anexar e trocar; a recusa sem o arquivo, com outro tipo e com a edição
    velha; owner e admin não sobem; cada abertura registrada;
  - `functions/wms/src/rh-arquivos.rules.test.ts`: nenhum papel lê, sobe,
    troca, apaga nem lista `rh/**` pelo navegador.

### Parte 8.2c: as telas de leitura do RH

Feita em 23/10/2026. As telas ficam desligadas em todo ambiente até a parte
8.1b.

- **O portão.** O app tem a liberação própria do RH
  (`RH_AMBIENTES_LIBERADOS`, a mesma lista das callables) e o
  `RH_PUBLICADO`, que diz se a codebase `rh` está no `firebase.json`. As
  telas só existem com os dois. Hoje o `RH_PUBLICADO` é `false`, e a trava do
  `platform-lists.test.ts` o compara com o `firebase.json`. Assim a parte
  8.1b, que põe a codebase na publicação, liga as telas no mesmo PR.
- **O shell** (`components/layout/rh-layout.tsx`) segue o molde dos outros
  módulos: o seletor, o menu com o Início e Pessoas e os contadores do
  "Precisa de você". O RH não tem Agent Dute nem cliente ativo.
- **O Início** (`/rh`) tem uma linha por pessoa com registro vencido ou
  vencendo. O vencido é crítico e vem primeiro, e a ação abre a ficha. Ao
  lado, as pessoas ativas em números. O card da entrada conta pela mesma
  lista.
- **Pessoas** (`/rh/pessoas`) lista quem está ativo, com a função, o
  vínculo, o próximo vencimento e as marcas de vencido, vencendo e sem
  registro.
- **A ficha** (`/rh/ficha?colaborador=`) mostra, por categoria, os vigentes
  com o resultado do exame e o prazo dentro da janela. O histórico fica em
  "Histórico · N".
- **O papel rh** cai direto no Início do RH. Owner e admin trocam pelo
  seletor.
- **O catálogo** do app (`lib/rh/ficha.ts`) é cópia literal do de
  `functions/rh`. A trava confere o catálogo, os papéis, a liberação e as
  callables que o app chama.
- **A callable `rhStatus`** da 8.1a saiu, porque o app decide pelo papel.
- **Testes:**
  - `lib/rh/navegacao.test.ts`: os papéis, o card, a aterrissagem, o
    menu, o seletor e as rotas só com a liberação;
  - `lib/rh/ficha.test.ts`: a leitura das callables, o prazo e o "Precisa
    de você";
  - as três telas, com a lista dos textos e o `axe`.

### Parte 8.2d: as ações na ficha

Feita em 23/10/2026. Desligada até a parte 8.1b, como a 8.2c.

- **Só o rh grava.** Quem tem o papel rh vê "Novo registro", que é a única
  ação principal da tela. Em cada registro que não está arquivado, vê
  "Alterar", "Anexar arquivo" (ou "Trocar arquivo") e "Arquivar".
- **Owner e admin** leem a ficha e abrem o arquivo.
- **O formulário** fica ao lado da ficha. Leva a categoria, o tipo, o nome
  (só no "outro"), a data, o vencimento e o resultado (só no exame). Ao
  alterar, a categoria e o tipo não mudam.
  - O pedido leva só o que o tipo pede (`lib/rh/formulario.ts`).
  - A callable confere o resto, e a mensagem dela aparece como veio.
- **Arquivar** pede a confirmação na própria linha.
- **O arquivo** sobe pela URL assinada de `requestRhUpload` (PUT do
  navegador, com o CORS do bucket de cada projeto em
  `deploy/cloud-storage/`) e só vale na ficha depois de `attachRhFile`.
  Abre numa aba nova pela URL de `openRhFile`, que registra a abertura. A
  tela confere o tipo e o tamanho antes de pedir a URL, com a mesma regra
  da callable, travada pelo `platform-lists.test.ts`.
- **Depois de cada gravação**, a ficha e o painel do RH são lidos de novo.
- **Testes:**
  - `lib/rh/formulario.test.ts`: o pedido de cada tipo, alterar e o
    arquivo;
  - `pages/rh/ficha-view.test.tsx`: quem lê não vê as ações de gravar,
    uma só ação principal, o formulário, a confirmação, a lista dos textos
    e o `axe` em cada estado.

### Correção: o próximo vencimento de Pessoas

Feita em 23/10/2026. O `getRhPanel` dava como próximo vencimento a data
mais antiga entre os vigentes, inclusive a que já tinha passado. Agora é a
próxima que ainda não venceu. O vencido já conta na marca "N vencidos". O
`ficha.integration.test.ts` falhava antes e passa depois.

### Correção: as datas fora do intervalo e a rotina que parava

Feita em 23/10/2026, da revisão do código do RH.

- **O defeito.** O campo de data do navegador aceita o ano de dois dígitos
  como 0025, e a entrada aceitava qualquer ano. Um vencimento em 0026 não
  cabia no evento `rh.record_expired`. Como era o mais atrasado, a rotina
  tentava esse registro primeiro, e a falha dele parava a rotina inteira,
  todo dia.
- **A entrada** agora só aceita datas de 1900 a 2100 ("Use uma data entre
  1900 e 2100."). O evento do vencido cabe nesse intervalo.
- **A rotina** trata cada registro à parte. O registro que não vira evento
  conta em `falhas`, fica no log e tenta de novo no dia seguinte; os outros
  seguem.
- **Testes:** `ficha.test.ts` (a data fora do intervalo) e
  `rotina.integration.test.ts` (um registro gravado antes do limite não para
  os outros).

### Correção: o vigente no empate das datas

Feita em 23/10/2026, da revisão do código do RH. Quando o RH lançava de novo
um exame ou um documento com as mesmas datas (para corrigir o anterior), o
desempate era o id sorteado: metade das vezes, o lançamento novo nascia
substituído pelo antigo. Agora o registro guarda o `criado_em` (o instante do
lançamento), e no empate vale o lançado por último. Testes: `ficha.test.ts`
(o empate com o id ao contrário) e `ficha.integration.test.ts` (o exame
lançado de novo com as mesmas datas).

### Correção: a ficha com a edição velha

Feita em 23/10/2026, da revisão do código do RH.

- **O defeito.** A ficha só era lida de novo depois de uma gravação que
  dava certo. Bastava outra pessoa mudar o registro, ou o anexo mudá-lo com
  o formulário aberto, para cada nova tentativa levar a edição velha e ser
  recusada até a página ser recarregada.
- **A correção:**
  - A ficha e o painel são lidos de novo depois de toda gravação, também
    da que falha.
  - Com o formulário aberto, Alterar, o arquivo e Arquivar ficam travados
    nas linhas.
  - Os campos de data têm o intervalo do servidor (1900 a 2100), travado
    pelo `platform-lists.test.ts`.
- **Teste:** `pages/rh/ficha.test.tsx`, com as callables de mentira. A
  falha relê a ficha, a próxima tentativa leva a edição nova, e as linhas
  travam com o formulário aberto.

### Correção: o arquivo conferido é o que abre

Feita em 24/10/2026, do achado da revisão ("o link de envio depois do
anexo"). A URL assinada de envio vale por 10 minutos e não limita o
tamanho. Quem a recebeu (só o papel rh) podia, nesse tempo, sobrescrever o
arquivo já conferido e anexado, sem o evento, ou subir um arquivo grande
que o anexo recusava mas ficava no bucket.

- **O anexo guarda a geração** do objeto que conferiu (`arquivo.geracao`),
  e a abertura assina a URL só dessa geração. O arquivo regravado depois
  não toma o lugar do conferido: a abertura segue pedindo o que o anexo
  conferiu, e o que mudou fica de fora (sem o versionamento do bucket, a
  geração sobrescrita some, e a abertura dá erro em vez de mostrar outro
  arquivo).
- **O arquivo que o anexo recusa** (outro tipo, vazio ou grande demais) sai
  do bucket. O que já está no registro nunca sai por aí.
- **O arquivo anexado antes** fica sem a geração e abre como antes.
- **Testes:** `arquivos.test.ts` (a geração conferida e o vazio) e
  `arquivos.integration.test.ts` (a geração no registro e na abertura, o
  recusado apagado e o regravado que não toma o lugar do conferido).
- **Fica para o Leonardo decidir:** impedir o envio grande e a regravação
  já na URL pede o cabeçalho `x-goog-content-length-range` (ou o
  `x-goog-if-generation-match: 0`) na assinatura e a mudança no CORS dos
  buckets (`deploy/cloud-storage/`), que se publica à mão.

### Parte 8.3: a exportação para a contabilidade

Feita em 24/10/2026, com a decisão do Leonardo na pergunta 24: a folha e o
eSocial ficam com a contabilidade, que recebe da Dute uma exportação por
competência.

- **O que vai** (`domain/exportacao.ts`, puro):
  - os exames cujo ASO é da competência, com o tpExameOcup e o resAso do
    S-2220 (o "outro" da ficha é a monitoração pontual; o apto com restrição
    é apto);
  - os colaboradores próprios ativos, e os inativos com exame no mês (o
    demissional); desde a parte 8.4a, quem teve vínculo no mês, pelas datas
    de admissão e desligamento;
  - o arquivado não entra; o substituído entra, porque o exame aconteceu;
  - o mesmo exame lançado de novo para corrigir (o mesmo tipo e a mesma
    data do ASO) entra uma vez, o que a ficha deixa vigente no empate (ver
    "Correção: o exame corrigido saía duas vezes na exportação");
  - o terceiro e o freelancer não entram: o eSocial deles é de quem os
    emprega.
- **O CPF** entra porque a contabilidade identifica o empregado por ele. É a
  única leitura do CPF no RH; a ficha e o painel continuam sem ele.
- **A versão** (`domain/exportacao-gravacao.ts`, coleção `exportacoes` do
  banco `dute-rh`):
  - guarda as linhas que foram, o hash do conteúdo, quem gerou e quando;
  - a mesma competência sem mudança devolve a versão de antes (`nova:
    false`), sem evento novo;
  - com mudança, nasce a versão seguinte, e a anterior continua;
  - o recibo fica em `rh_operations`, como as outras gravações.
- **A planilha** é montada no servidor, da versão guardada: CSV com BOM,
  ponto e vírgula e CRLF, que a planilha em português abre; datas em
  dd/mm/aaaa e o CPF com a máscara. A célula que parece fórmula ganha
  apóstrofo.
- **As callables:** `exportRhMonth` (só o rh), `listRhExports` e
  `downloadRhExport` (owner, admin e rh).
- **Os eventos** `rh.export_created` e `rh.export_downloaded`, no `events` do
  banco `dute-rh`, com a competência, a versão e as contagens, nunca nome nem
  CPF. Cada download fica registrado.
- **A tela** Exportação (`/rh/exportacao`, no menu do RH):
  - o rh escolhe a competência, que abre no mês anterior, e gera;
  - a lista mostra cada versão com as contagens, quem gerou e as duas
    planilhas para baixar;
  - owner e admin só baixam.
- **Testes:**
  - `exportacao.test.ts`: a seleção, os códigos do S-2220, o hash que não
    depende da ordem, a entrada e o CSV (aspas, separador, fórmula, datas e
    CPF);
  - `exportacao.integration.test.ts`, no emulador:
    - a versão 1 com o evento, a repetição e a mesma versão sem mudança;
    - a versão 2 com um exame novo;
    - só o rh gera;
    - os três papéis baixam a planilha guardada, cada um com o evento;
    - nada no banco padrão;
  - no app: a leitura, a tela (os textos, uma só ação primária e o `axe`) e o
    contêiner (a chave que se mantém na falha e troca no sucesso e na
    competência).

### Parte 8.1b: o banco `dute-rh` e a codebase na publicação

Entra só depois de o banco `dute-rh` existir na homologação e na produção,
pelo workflow `Banco rh` (seção "Como o banco `dute-rh` nasce").

- **O banco** existe nos dois ambientes desde 24/10/2026, em
  `southamerica-east1`, com a proteção contra exclusão e o PITR de 7 dias. Na
  produção, também com o backup diário de 14 dias.
- **Na produção**, as duas primeiras execuções recusaram o `create`: o papel
  tinha ido para outra conta. Com o `roles/datastore.owner` na
  `github-actions-functions@dute-prod`, a execução das 22:34 UTC criou o
  banco já com o PITR e agendou o backup logo em seguida, sem o `ABORTED`
  (a correção do PITR na criação).

- **O `firebase.json`** passa o `firestore` a uma lista: o banco padrão,
  com as regras e os índices de sempre, e o `dute-rh`, com o
  `firestore-rh.rules`. A codebase `rh` entra nas functions.
- **A publicação** instala o `functions/rh` e publica a codebase com as
  outras.
  - O `tools/check_rules_deployed.sh` confere a release de cada banco do
    `firebase.json`: `cloud.firestore` para o padrão e
    `cloud.firestore/dute-rh` para o do RH.
  - O `check_functions_invoker.ps1` já lê as codebases do `firebase.json`.
- **O app** passa o `RH_PUBLICADO` a `true`, e as telas do RH ligam na
  homologação, onde a liberação atende. A trava do `platform-lists.test.ts`
  exige o `RH_PUBLICADO` igual à codebase no `firebase.json`.
- **A trava** `tools/test_banco_rh.py` exige que o único banco nomeado do
  `firebase.json` seja o `RH_DATABASE` da codebase, com o
  `firestore-rh.rules`.
- **Conferido no emulador:** com o `firestore` em lista, as regras do banco
  padrão, as do `dute-rh` e as do Storage passam como antes.
- **Na homologação,** a publicação do merge (24/10/2026) conferiu as regras
  servidas dos dois bancos, as 145 callables públicas, 10 delas do RH, e o
  app servindo o build. A produção recebe o código com o lançamento
  (`lancamento-producao.md`), e o RH continua desligado lá até outro OK
  (`RH_AMBIENTES_LIBERADOS`).

### Correção: o exame corrigido saía duas vezes na exportação

Feita em 25/10/2026, da revisão do código do RH.

- **O defeito.** Corrigir um exame lançando de novo com as mesmas datas é o
  caminho que "o vigente no empate das datas" prevê: o novo fica vigente, e
  o anterior, substituído.
  - A exportação leva o substituído, porque o exame aconteceu. Então o
    mesmo ASO ia duas vezes, com o resultado errado e o corrigido.
  - Exemplo: "Periódico; 05/10/2026; Apto" e "Periódico; 05/10/2026;
    Inapto". Cada linha vira um S-2220 na contabilidade.
- **A correção.** Na exportação, o mesmo colaborador, o mesmo tipo e a
  mesma data do ASO são um exame só: entra o que a ficha deixa vigente no
  empate (`maisRecentePrimeiro`).
  - Outra data no mês continua outro exame.
  - O "outro" continua um exame por registro: duas monitorações no mesmo
    dia são exames diferentes.
- **Testes:** `exportacao.test.ts`, com o periódico lançado apto e de novo
  inapto: uma linha, inapto.
  - O mesmo vale com um periódico mais novo que substitui os dois.
  - A outra data e os dois "outro" do mesmo dia continuam.
  - Antes, as duas linhas iam.


### Decisão: no empate da emissão, vale o lançado por último (pergunta 61)

Decidida pelo Leonardo em 25/10/2026, antes de ligar o RH na produção.

- **Antes.** No empate da data de emissão, valia o registro que vence
  depois e, só no empate do vencimento, o lançado por último. Corrigir um
  vencimento digitado a mais (2027 em vez de 2026) lançando de novo não
  funcionava: a correção nascia substituída, o vencimento errado ficava
  vigente, e o aviso do vencimento real não saía.
- **Agora.** No empate da emissão, vale o lançado por último, vença quando
  vencer (`maisRecentePrimeiro` em `ficha.ts`). "Alterar" continua sendo o
  jeito limpo de corrigir.
  - O que a regra antiga protegia deixa de valer: o mesmo registro lançado
    de novo sem vencimento fica vigente, e o aviso do anterior sai do
    Início.
  - A exportação para a contabilidade usa a mesma ordem no exame do mesmo
    tipo e da mesma data do ASO: entra o lançado por último.
- **A situação gravada.** O vigente e o substituído ficam no registro e se
  recalculam no grupo a cada gravação. O `dute-rh` da produção estava vazio
  ao ligar o RH, então nada se recalcula lá. Na homologação, o grupo que já
  tinha um empate por vencimento só se acerta na próxima gravação nele.
- **Teste:** `ficha.test.ts`. Com a mesma emissão, o vencimento de 2027
  lançado antes e o de 2026 lançado depois: fica vigente o de 2026. Antes,
  ficava o de 2027.

### Decisão: os exames ocupacionais são um grupo só (pergunta 62)

Decidida pelo Leonardo em 25/10/2026, antes de ligar o RH na produção.

- **Antes.** Cada tipo de exame era um grupo. Depois do periódico, o
  admissional continuava vigente para sempre. Com vencimento, ele aparecia
  vencido no Início do RH, e a rotina gravava o `rh.record_expired` dele.
  Arquivá-lo para calar o aviso o tirava da exportação do mês dele.
- **Agora.** O admissional, o periódico, o de retorno ao trabalho e o de
  mudança de função são um grupo só (`EXAMES_OCUPACIONAIS` e
  `grupoDoRegistro` em `ficha.ts`). O ASO mais recente de qualquer deles é
  o vigente, como na NR-7, e os outros ficam substituídos por ele, com o
  evento `rh.record_status_changed`. O demissional e o "outro" ficam como
  estavam.
- **A exportação não junta.** Na planilha da contabilidade, cada ASO
  continua um S-2220. O exame repetido se reconhece pelo tipo e pela data
  (`chaveDoTipo`), e não pelo grupo: o admissional e o periódico do mesmo
  dia são duas linhas.
- **A situação gravada.** Como na pergunta 61, o grupo se recalcula a cada
  gravação. No `dute-prod`, o banco estava vazio ao ligar o RH. Na
  homologação, o admissional que já estava vigente ao lado de um periódico
  só fica substituído na próxima gravação num exame da pessoa.
- **Testes:**
  - `ficha.test.ts`: o periódico substitui o admissional e o de mudança de
    função, e o admissional vencido sai do Início. O demissional e o
    "outro" continuam vigentes. Antes, o admissional ficava vigente e
    vencido.
  - `ficha.integration.test.ts`: o periódico gravado substitui o
    admissional, com o evento da mudança.
  - `exportacao.test.ts`: o admissional e o periódico do mesmo dia são duas
    linhas.

### Decisão: a exportação lista quem tinha vínculo no mês (pergunta 63)

Decidida pelo Leonardo em 25/10/2026: guardar a data de admissão e a de
desligamento do colaborador, e a exportação listar quem tinha vínculo no
mês. O RH liga na produção sem esperar por elas.

- **Hoje.** A planilha de colaboradores sai do cadastro de hoje, não do mês
  exportado. Quem entrou em 01/10 aparece ativo na exportação de setembro
  gerada em outubro. Qualquer mudança de nome ou de função depois cria uma
  versão nova de um mês passado. O manual (`docs/manual-rh.md`) diz isso.
- **A parte 8.4** (no plano) guarda as duas datas e filtra a planilha por
  elas. É tela nova, então o alinhamento de UX vem antes, como em toda tela.
  O alinhamento também decide se as datas ficam no cadastro da Operação
  (`collaborators`) ou no banco `dute-rh`: ficam no `dute-rh` ("Alinhamento
  da parte 8.4", abaixo).

### Lançamento na produção

Feito em 25/10/2026, com o OK do Leonardo ("Pode fazer então, vamos
seguir") e as perguntas 61 a 63 respondidas. A 61 e a 62 entraram antes, em
PRs próprios, para a produção começar com as regras novas.

- **A lista.** `RH_AMBIENTES_LIBERADOS` ganha o `dute-prod`, no app e em
  `functions/rh`. O `platform-lists.test.ts` trava as duas iguais.
- **O que mudou na produção**, desde a segunda publicação do mesmo dia
  (`59d78bc`, run 1090, `lancamento-producao.md`, seção 1):
  - o shell do RH aparece para owner, admin e rh;
  - as dez callables respondem;
  - a `runRhAlerts` passa a rodar às 06:10.
  - O banco `dute-rh` da produção já existia, com PITR e backup diário, e
    estava vazio. O arquivo do registro sobe e abre por URL assinada, como
    na homologação.
- **Os testes.** `liberacao.test.ts` e `profile.integration.test.ts` do RH
  e `platform-lists.test.ts` do app passam a esperar a liberação na
  produção. O `dute-btg` continua recusando.
- **Como desfazer.** Tirar o `dute-prod` das duas listas e publicar de novo.
  As telas somem, as callables recusam, e o que foi gravado fica no
  `dute-rh`.

### Alinhamento da parte 8.4

Feito em 26/10/2026, com o canvas das telas
(`https://claude.ai/artifact/P3dXT4G48unzy3tCK3whM1`: a ficha, Pessoas, a
Exportação e a planilha de setembro). O Leonardo aprovou as telas ("Sim,
aprovado, pode fazer") e as quatro recomendações:

1. **Onde ficam as datas:** no banco `dute-rh`, em `vinculos`, gravadas só
   pelo `rh`, com o recibo e o evento `rh.*`, como o resto da ficha. A
   Operação não lê. Só o vínculo próprio tem as datas: o freelancer e o
   terceiro não estão na folha da Dutelog.
2. **O desligamento e a Operação ficam independentes:** gravar o
   desligamento não tira a pessoa da escala. Quem a inativa na Operação é a
   coordenação, como hoje.
3. **O próprio sem data de admissão** entra na planilha se está ativo, como
   antes, ou inativo com exame no mês.
4. **"Sem admissão"** aparece em Pessoas e na Exportação, com o link da
   ficha. O "Precisa de você" do Início continua só com os vencimentos.

A parte saiu em dois PRs: o servidor (8.4a) e as telas (8.4b).

### Parte 8.4a: as datas do vínculo no servidor

Feita em 26/10/2026.

- **As datas** (`domain/vinculo.ts`, puro): um documento por colaborador
  em `vinculos/{col_…}` no banco `dute-rh`, com a admissão, o desligamento
  (ou null) e a edição.
  - A admissão é obrigatória, e o desligamento pode ser no mesmo dia, nunca
    antes. As datas vão de 1900 a 2100, como na ficha.
  - A tela manda a edição que leu (`expected_edicao`, null quando ainda não
    há datas). A edição velha, ou a tela que leu sem datas quando outra
    pessoa já gravou, recarrega.
- **A gravação** (`domain/vinculo-gravacao.ts`, callable `saveRhVinculo`):
  - só o `rh`; owner e admin recebem "Só o RH grava no RH.";
  - confere o colaborador no cadastro da Operação e recusa o freelancer e o
    terceiro ("Só o vínculo próprio tem admissão e desligamento.");
  - grava as datas, o recibo (`rh_operations`) e o evento
    `rh.vinculo_saved` numa transação do banco `dute-rh`. O cadastro da
    Operação não muda;
  - o evento leva o id do colaborador, as duas datas e as edições, nunca o
    nome nem o CPF; a entidade é `rh_vinculo`.
- **A leitura:** a ficha (`getRhFicha`) traz `datas_do_vinculo`, com a
  edição, e o painel (`getRhPanel`), a admissão e o desligamento de cada
  próprio. Se o cadastro da Operação muda o vínculo para terceiro ou
  freelancer, as datas gravadas antes deixam de aparecer e de contar.
- **A planilha de colaboradores** (`domain/exportacao.ts`):
  - com a admissão, entra quem teve vínculo no mês: admitido até o último
    dia e, se desligado, desligado a partir do primeiro. Quem entra depois
    não aparece, e quem saiu antes também não, mesmo ativo na Operação;
  - sem a admissão, vale a regra de antes: ativo, ou inativo com exame no
    mês;
  - as colunas são Nome, CPF, Função, Admissão, Desligamento e Situação no
    mês: Ativo, Inativo (só sem as datas), Admissão no mês, Desligamento no
    mês, ou Admissão e desligamento no mês;
  - o hash da versão não conta o nome nem a função, e a ordem dele é a do
    id: o nome ou a função mudados depois não criam versão nova de um mês já
    exportado. O CPF, as datas, a situação e os exames criam. A versão nova
    leva o cadastro de hoje inteiro.
- **As versões guardadas** levam `formato: 2`. A de antes da parte não tem
  o campo e baixa com as colunas de então (Nome, CPF, Função, Situação). A
  primeira exportação de um mês já exportado, depois desta parte, nasce
  numa versão nova, porque a planilha mudou.
- **Testes:**
  - `vinculo.test.ts`: a entrada (a admissão obrigatória, o desligamento no
    dia e antes, as datas, o campo a mais), a edição, a leitura conferida, o
    vínculo no mês com o fevereiro bissexto e a situação no mês;
  - `vinculo.integration.test.ts`, no emulador: a gravação com o recibo e o
    evento só no `dute-rh`, o cadastro da Operação intacto, a repetição, a
    edição velha, owner, admin, freelancer, terceiro e o colaborador que
    não existe recusados, e a ficha e o painel com as datas;
  - `exportacao.test.ts` e `exportacao.integration.test.ts`: quem é admitido
    depois do mês fica de fora, a desligada no mês entra, o hash sem o nome
    e a função, o nome mudado que não cria versão e o CPF mudado que cria, e
    a versão antiga que baixa com as colunas de então;
  - `events.test.ts`: o payload estrito e só o rh grava;
  - no app, `platform-lists.test.ts` exige a callable nova em
    `CALLABLES_DO_RH`.
- **Limitação:** Pessoas lista só quem está ativo na Operação. Quem a
  coordenação desativa antes de o RH gravar o desligamento continua na
  planilha como ativo, e a ficha dele só abre pelo endereço. A pergunta 70
  (plano, seção 13) propõe mostrar essas pessoas em Pessoas.

### Parte 8.4b: as datas do vínculo nas telas

Feita em 26/10/2026, nas telas aprovadas no alinhamento (as fontes em
`docs/mockups/Rh*Vinculo.dc.html`).

- **A ficha** (`pages/rh/ficha-view.tsx`):
  - abaixo da função e do vínculo, a linha "Admissão dd/mm/aaaa ·
    Desligamento dd/mm/aaaa", para quem lê o RH;
  - o rh vê "Datas do vínculo" ao lado de "Novo registro", só no vínculo
    próprio. O formulário ao lado abre com as datas lidas e a edição, e
    grava por `saveRhVinculo`. Com ele aberto, os botões do topo somem e as
    ações das linhas esperam, como no formulário do registro;
  - a ficha e o painel são lidos de novo depois de gravar e depois da
    falha, e a mensagem do servidor aparece como veio. Com a edição velha,
    o servidor pede para recarregar: fechar e abrir o formulário traz as
    datas novas, como no registro.
- **Pessoas:** as datas entram na linha de cada próprio, e "Sem admissão"
  marca o próprio que ainda não tem a data.
- **Exportação:** abaixo do Gerar, só para o rh, "Sem data de admissão" com
  o link da ficha de cada um. A lista sai do painel do RH, o mesmo de Pessoas
  (os ativos). O "Precisa de você" do Início não muda.
- **No app, os links** da lista seguem os das outras telas v3 (sublinhados,
  na cor do texto), não o azul do mockup.
- **Testes:**
  - `lib/rh/ficha.test.ts`: as datas legíveis no painel e na ficha, o "Sem
    admissão" só do próprio e as datas como dados da linha;
  - `lib/rh/formulario.test.ts`: o pedido da primeira gravação sem edição,
    a seguinte com a lida e o desligamento vazio como null;
  - `ficha-view.test.tsx`, `pessoas-view.test.tsx` e
    `exportacao-view.test.tsx`: os textos, uma só ação primária e o `axe`,
    com o formulário das datas e a lista "Sem data de admissão";
  - `ficha.test.tsx` e `exportacao.test.tsx`, com as callables de mentira:
    as duas gravações das datas, com a edição, e a lista que sai do painel.
