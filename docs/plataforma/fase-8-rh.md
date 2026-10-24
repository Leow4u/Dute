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

- **O banco `rh` é um banco Firestore à parte**, no mesmo projeto, com as
  regras dele (`firestore-rh.rules`). Guarda os documentos, os exames e os
  treinamentos ligados ao id do colaborador e, na parte 8.3, as versões da
  exportação para a contabilidade.
- **O navegador não lê nem grava o banco `rh`.**
  - As regras de um banco nomeado não leem o `users` do banco padrão, então
    não sabem o papel de quem pede.
  - Abrir por outro caminho, como uma claim no token ou uma cópia dos papéis
    no banco `rh`, criaria uma segunda lista de papéis, que pode divergir.
  - Quem lê e grava é a codebase `functions/rh`, pelas callables, que
    conferem o papel no `users` do banco padrão, como todas as outras.
  - O RH não tem tempo real: a tela lê pela callable e lê de novo depois de
    cada gravação.
  - Uma transação vale para um banco só: a gravação confere o colaborador
    no banco padrão antes e grava o registro, o recibo e o evento numa
    transação do banco `rh`.
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
- **Os eventos do RH ficam no `events` do próprio banco `rh`** (invariante 2).
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
- **A zeragem do WMS nunca toca o banco `rh`.** O `tools/full_reset_btg.py`
  abre o banco padrão e recusa o `--database rh` (parte 8.1a).
- **Liberação própria:** `RH_AMBIENTES_LIBERADOS`, só o `dute-homolog` até o
  lançamento, com o OK do Leonardo.

## Como o banco `rh` nasce

O banco `rh` precisa existir antes de o `firebase.json` apontar para ele, e
nos dois projetos que a publicação atende: a homologação e a produção. A
publicação sobe as regras de todo banco do `firebase.json` em cada projeto.
Sem o banco, ela falha, e com ela nada mais sobe. Por isso, as partes até a
8.2 não ligam o banco nem a codebase na publicação, e a 8.1b só entra
depois de o banco existir nos dois projetos.

Criar o banco não abre nada. As regras dele negam tudo, e as callables do RH
só atendem na homologação (`RH_AMBIENTES_LIBERADOS`) até o lançamento da
fase.

Quem cria é o workflow `Banco rh` (`.github/workflows/banco-rh.yml`), por
disparo manual, um ambiente por vez. Ele roda o `tools/banco_rh.sh`:

- cria o banco em `southamerica-east1`, nativo, com proteção contra exclusão;
- liga o PITR;
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

Com o banco criado nos dois, o papel pode sair (o mesmo laço com
`remove-iam-policy-binding`). Sem ele, o workflow volta a falhar, mas a
publicação continua: ela só publica as regras do banco, e para isso bastam
os papéis que a conta já tinha.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 8.0 | O desenho (este documento) | — |
| 8.1a | As regras do banco `rh`, fechadas ao navegador; a codebase `functions/rh` (o perfil, a liberação, o recibo e o evento no banco `rh`); os jobs do CI. Ainda fora da publicação | Nenhum papel lê nem grava o banco `rh` pelo navegador; só `rh`, `admin` e `owner` passam pela callable, e só `rh` grava |
| 8.1b | Com o banco criado pelo workflow `Banco rh` nos dois ambientes: o `firebase.json` com o banco `rh` e a codebase `rh`; a publicação confere as regras dele; o `RH_PUBLICADO` do app passa a `true` no mesmo PR, e as telas ligam na homologação | A trava do `platform-lists.test.ts` exige o `RH_PUBLICADO` igual à codebase no `firebase.json` |
| 8.2a | A ficha no servidor: os registros no banco `rh`, o vigente de cada tipo, o recibo e o evento no banco `rh`, o painel e a rotina dos vencimentos | O vencimento gera o alerta uma vez por marco; nada do RH cai no banco padrão; só o rh grava |
| 8.2b | Os arquivos da ficha: sobem e descem por URL assinada da callable, e cada abertura fica registrada | O documento só abre pelo RH |
| 8.2c | As telas de leitura, desligadas até a 8.1b: o shell do RH, o Início com os vencimentos, Pessoas e a ficha | Os textos e o `axe` de cada tela; as rotas só existem com a liberação; só owner, admin e rh abrem |
| 8.2d | As ações na ficha: incluir, alterar e arquivar o registro, subir e abrir o arquivo | Owner e admin não veem as ações de gravar; o arquivo abre pela callable |
| 8.3 | A exportação da competência para a contabilidade: os exames do mês com os códigos do S-2220 e os colaboradores próprios, em CSV, por versão; a tela Exportação | A mesma competência sem mudança devolve a mesma versão, sem evento novo; só o rh gera; cada download fica registrado |

**Pronto quando** só `rh`, `admin` e `owner` leem o RH, pela callable, e o
exame, o treinamento e o documento vencendo aparecem no Início do RH (a CNH,
no da Operação).

## Registro

### Parte 8.1a: as regras do banco `rh` e a codebase `functions/rh`

Feita em 23/10/2026. Nada entra na publicação: o `firebase.json` só ganha o
banco `rh` e a codebase na parte 8.1b, depois de o banco existir.

- **`firestore-rh.rules`** fecha o banco inteiro ao navegador, para todo
  papel, inclusive o rh, o owner e o admin.
- **A codebase `functions/rh`** (npm, como as outras):
  - `requireRhCaller` confere, nesta ordem:
    - a liberação (`RH_AMBIENTES_LIBERADOS`, só o `dute-homolog`);
    - o login e o perfil no `users` do banco padrão;
    - o papel: owner, admin e rh abrem; só o rh grava.
  - A callable `rhStatus` dizia ao shell quem abre e se grava; saiu na 8.2c,
    porque o app decide pelo papel (`lib/rh/navegacao.ts`).
  - O recibo, o evento e o acesso ao banco `rh` entram na parte 8.2a, com a
    primeira gravação.
- **O CI** ganha `rh-unit` e `rh-integration`, e a publicação da produção
  espera os dois.
- **A zeragem** recusa o `--database rh`.
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
  - cria o banco `rh` com proteção contra exclusão;
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
  - `ficha.integration.test.ts`: o registro no banco `rh` e nada no padrão,
    owner e admin só leem, a troca do vigente, arquivar devolve o anterior
    e o painel;
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
    demissional);
  - o arquivado não entra; o substituído entra, porque o exame aconteceu;
  - o terceiro e o freelancer não entram: o eSocial deles é de quem os
    emprega.
- **O CPF** entra porque a contabilidade identifica o empregado por ele. É a
  única leitura do CPF no RH; a ficha e o painel continuam sem ele.
- **A versão** (`domain/exportacao-gravacao.ts`, coleção `exportacoes` do
  banco `rh`):
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
  banco `rh`, com a competência, a versão e as contagens, nunca nome nem CPF.
  Cada download fica registrado.
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

