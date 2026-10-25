# Publicação de Cloud Functions

Procedimento para publicar `functions/wms/` (as callables usadas pelo app BTG) no
projeto Google Cloud `dute-prod`.

> Desde o corte da Fase 1 (20/10/2026) a produção é o `dute-prod`. Os incidentes
> e a configuração inicial contados abaixo aconteceram no `dute-btg`, a
> produção anterior, hoje congelada.

Diferente do frontend (`docs/deploy-manual.md`), este processo nunca foi escrito
antes — o que é provavelmente como o incidente de 03/09/2026 (ver abaixo) passou
um mês sem ser percebido.

**A publicação normal é pelo GitHub Actions** (jobs `Regras e índices` e
`Cloud Functions` em `.github/workflows/publicar.yml`, ver seção no fim deste
documento): regras, índices e functions sobem sem passar pela máquina de
ninguém. O roteiro manual abaixo é a reserva, para quando o CI estiver fora.

## Pré-requisitos

Os mesmos do deploy do frontend: `gcloud` autenticado como
`leonardo@dutelog.com.br`, projeto padrão `dute-prod`, `node`/`corepack`. O
diretório `functions/wms/` usa **npm**, não pnpm (tem `package-lock.json` próprio).

**Duas codebases.** O `firebase.json` tem `default` (`functions/wms/`, o nome
não muda) e `comercial` (`functions/comercial/`, desde a parte 3 do Comercial,
`docs/plataforma/fase-6-comercial.md`). Cada uma tem o seu `package-lock.json`;
rode `npm ci` nas duas antes do deploy, porque o `predeploy` roda `tsc` em cada
pasta. `firebase deploy --only functions` publica as duas, e o passo 4 confere
as callables das duas. As callables do Comercial recusam fora do `dute-homolog`
(`functions/comercial/src/domain/liberacao.ts`), menos o `comercialStatus`, que
responde `liberado: false`.

## Passo a passo

### 1. Partir de main limpa

```powershell
git checkout main
git pull
git status
```

### 2. Rodar os testes críticos antes de publicar

```powershell
npm --prefix functions/wms run test:critical
npm --prefix functions/comercial run test:critical
```

Isso roda `test:unit` (billing) e `test:integration` (fluxo WMS/estoque contra o
emulador do Firestore — exige Java 21+). Não publique com isso vermelho.

### 3. Publicar

Regras e índices primeiro, depois as functions, na mesma ordem do CI. Os dois
comandos rodam da raiz do repositório, onde fica o `firebase.json`:

```powershell
firebase deploy --only firestore,storage --project dute-prod
bash tools/check_rules_deployed.sh dute-prod
firebase deploy --only functions --project dute-prod
```

O `predeploy` do `firebase.json` já roda `npm run build` (tsc) antes de subir as
functions.

`--only functions` **não publica `firestore.rules`, `firestore.indexes.json` nem
`storage.rules`.** Em 16/10/2026 a tela Estoque › Posições ficou em "Missing or
insufficient permissions" depois de um deploy só de functions, até as regras
subirem. `tools/check_rules_deployed.sh` compara as regras servidas pelo projeto
com as do checkout (usa o `gcloud` para o token e precisa de `bash`, `curl` e
`node`).

Para publicar só uma function específica (mais rápido, mas é exatamente o tipo
de deploy que causou o incidente abaixo — **nunca pule o passo 4** depois de um
deploy parcial):

```powershell
firebase deploy --only functions:nomeDaFunction --project dute-prod
```

`functions:<nome>` publica a codebase inteira se `<nome>` for o nome de uma
codebase (`functions:comercial` sobe todo o Comercial); senão, procura a
function só na `default` (o WMS). Function de outra codebase precisa do nome
dela: `functions:comercial:nomeDaFunction`.

### 4. Verificar que toda callable continua com invocação pública

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\check_functions_invoker.ps1
```

Esse script lê as codebases do `firebase.json` e as callables exportadas no
`src/index.ts` de cada uma (`functions/wms` é a `default`), compara com o Cloud
Run real e falha (exit 1) se alguma estiver sem `allUsers` /
`roles/run.invoker` ou não tiver sido publicada. **Rode sempre, mesmo em deploy
que "só" mudou uma function** — foi exatamente esse tipo de deploy que causou o
incidente abaixo.

Desde 20/10/2026 (Comercial, Fase 6) o script lê todas as codebases. Também
falha, antes de consultar o Cloud Run, quando:

- o `firebase.json` não é um JSON válido;
- uma codebase listada não tem `source` (ex.: usa `remoteSource`) ou não tem
  `src/index.ts`;
- uma codebase tem `prefix`: o deploy publicaria `<prefix>-<nome>` e o script
  conferiria o serviço errado. As codebases da Dute não usam `prefix`;
- o `src/index.ts` usa `onCall(` ou `onCall<...>(` numa linha fora do padrão
  (ex.: `export const nome =` numa linha e `onCall(` na outra);
- a mesma callable aparece em duas codebases (o serviço do Cloud Run é o nome
  em minúsculas, sem a codebase, então `approveQuote` e `approvequote` também
  contam como repetidas);
- nenhuma codebase tem callable.

Codebase sem callable só gera um `AVISO` e não reprova sozinha. As mensagens
dizem a codebase (`FALTA comercial: approvequote`) e o `firebase deploy`
sugerido já vem com `functions:<codebase>:<nome>` fora da `default`. O script
só enxerga callable declarada numa linha só, como `export const nome = onCall(`
ou `export const nome = onCall<Tipo>(`, no `src/index.ts` da codebase.
Reexportada de outro arquivo, ela não é conferida: no `functions/comercial`,
toda callable fica declarada no `src/index.ts`. Com `-IndexFile <arquivo>`, lê
só aquele arquivo, como antes.

Isso não é uma falha de segurança: a autorização de verdade acontece dentro de
cada callable via Firebase Auth + papel (`requireCustomerScope`,
`requireOperationsCoordinator`, etc.) — Cloud Run só decide se a requisição
chega até o código. Ver invariante 5 do `CLAUDE.md`.

### 5. Permissões da conta das Functions no Storage

As Functions rodam com a conta de runtime do projeto
(`<número do projeto>-compute@developer.gserviceaccount.com`; no `dute-prod`,
`974421124970-compute@`), que **não** é Editor. No bucket padrão
(`<projeto>.firebasestorage.app`) ela precisa de dois papéis:

| Papel | Para quê |
| --- | --- |
| `roles/storage.objectCreator` | gravar o anexo do aviso de envio (`uploadShipmentAttachment`) |
| `roles/storage.objectViewer` | ler a nota para o Agent Dute (`readShipmentInvoice`) |

No `dute-prod` e no `dute-homolog` os dois foram dados no corte da Fase 1
(`docs/plataforma/fase-1-corte.md`). Em projeto novo, ou se alguém refizer a
política do bucket:

```powershell
$p = "dute-prod"
$sa = "$(gcloud projects describe $p --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$p.firebasestorage.app" --member="serviceAccount:$sa" --role="roles/storage.objectCreator" --project $p
gcloud storage buckets add-iam-policy-binding "gs://$p.firebasestorage.app" --member="serviceAccount:$sa" --role="roles/storage.objectViewer" --project $p
```

Só no bucket, não no projeto, e sem apagar/sobrescrever. Sem esses papéis o
portal mostra "O servidor não tem permissão para gravar (ou ler) arquivos no
Storage", com o papel que falta. Até 01/10/2026 aparecia só "Falha interna no
servidor", e a causa (403 `storage.objects.create`) estava apenas no log:

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="uploadshipmentattachment" AND severity>=WARNING' --project dute-prod --freshness=1h --limit 5
```

### Deploy lento: "User code failed to load … Timeout after 10000"

O Firebase carrega o código para descobrir as functions e espera 10 s; com o
Genkit isso às vezes passa. Aumente antes do deploy:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
```

Se ainda der "Timeout after 60000", suba para `"180"`. O código carrega em
poucos segundos; a demora é da máquina na hora (em 02/10/2026, 60 s não bastou
e 180 s publicou). Nada é publicado quando o deploy para aqui.

## Incidente de 03/09/2026 — invoker ausente em 8 callables

Um cliente tentou montar um pedido no portal (`/portal/estoque`, papel
`cliente`) e recebeu "Falha interna no servidor" ao enviar. Investigação:

- `createCustomerRequest`, `decideCustomerRequest` e `advanceWarehouseTask`
  estavam com a política de IAM do Cloud Run **vazia** — nenhum member, nenhum
  `roles/run.invoker`. Toda chamada (de qualquer tamanho, não só pedidos
  grandes) era rejeitada na borda do Cloud Run antes do código rodar (`403
  The request was not authenticated` nos logs do `OPTIONS` de preflight). O
  SDK do Firebase mapeia qualquer falha de transporte/autorização assim para o
  mesmo código genérico `internal`, que o frontend traduz para essa mensagem —
  indistinguível, do lado do cliente, de um bug real no código.
- Rodar o script acima contra produção achou mais 5 na mesma condição:
  `extractOperationalDocumentContent`, `recordWarehouseException`,
  `recordOperationalEvent`, `analyzeEvent`, `generateDailyBriefing`.
- As outras ~24 callables (deployadas no mesmo lote de 31/07) tinham o invoker
  correto. Não há como confirmar pelo histórico de revisões *qual* deploy
  causou a lacuna nessas 8 especificamente — algumas foram redeployadas
  isoladamente depois do lote de 31/07 (ex.: `createCustomerRequest` em
  06/08 e 12/08), outras nunca mais foram tocadas desde 31/07, o que sugere
  que a falha em setar o invoker pode ter sido silenciosa mesmo dentro do
  deploy em lote original, não só em redeploys parciais.
- As 8 foram corrigidas manualmente em produção:
  ```
  gcloud run services add-iam-policy-binding NOME_DA_FUNCTION `
    --project dute-btg --region southamerica-east1 `
    --member=allUsers --role=roles/run.invoker
  ```
- `tools/check_functions_invoker.ps1` e o passo 4 acima existem para que essa
  classe de regressão seja percebida no próximo deploy, não semanas depois por
  um cliente.

## 01/10/2026 — function nova que não subiu

`cancelShipmentNotice` (PR #28) não chegou a ser publicada. O script dizia
"FALTA … sem invoker" e o `add-iam-policy-binding` sugerido respondia
`NOT_FOUND`: no Windows o `gcloud` nem sempre devolve código de erro, e o
script decidia "existe?" por ele. Agora o script decide pela saída da política
(serviço existente sempre traz `etag`) e mostra **NAO PUBLICADA**, com o
`firebase deploy --only functions:…` certo, e falha (exit 1) — antes, function
não publicada passava como "normal para function nova". Os casos estão em
`tools/check_functions_invoker.tests.ps1`, que roda no CI.

## 02/10/2026 — function nova com deploy falho (rotinas do Agent Dute)

No primeiro deploy das rotinas (PR #53), a API do Cloud Scheduler ainda estava
desligada no projeto, e a `runAgentRoutines` é agendada. As 4 callables novas
(`listAgentRoutines`, `saveAgentRoutine`, `deleteAgentRoutine`,
`runAgentRoutineNow`) ficaram com o deploy falho: o serviço do Cloud Run chegou
a existir, sem invoker, e o script disse "FALTA … sem invoker". Minutos depois
o serviço sumiu e o `add-iam-policy-binding` sugerido respondeu `NOT_FOUND`.
Um novo `firebase deploy --only functions:…` dessas 5 ativou a API
(`cloudscheduler.googleapis.com`) e criou tudo; aí o invoker veio certo.

O script agora também consulta o estado da function
(`gcloud functions describe … --format="value(state)"`). Estado diferente de
`ACTIVE` aparece como **NAO PUBLICADA** (com o estado), sugere o
`firebase deploy` certo e falha. Se o `describe` não responder, vale só a
política, como antes. Na lista de "FALTA", o script também avisa que
`NOT_FOUND` no `add-iam-policy-binding` quer dizer "a function não subiu".

Function agendada nova (`onSchedule`) usa o Cloud Scheduler. Agora a API já
está ativa em `dute-btg`; em outro projeto, o deploy pode precisar ativá-la.

## 02/10/2026 — function que nunca subiu aparecendo como "FALTA" (painel do sistema)

O deploy do PR #57 parou em "User code failed to load … Timeout after 60000",
então `getSystemDashboard` e `saveAgentCostSettings` nem foram criadas. Mesmo
assim o script disse "FALTA … sem invoker": o `gcloud run services
get-iam-policy` devolveu uma política vazia com `etag` para um serviço que não
existia, e o `gcloud functions describe` não respondeu (o que o script já
tratava como "decide pela política"). O `add-iam-policy-binding` respondeu
`NOT_FOUND`.

Agora o script decide se o serviço existe pelo `gcloud run services describe`
(sem saída quando não existe) antes de olhar a política. Serviço inexistente
aparece como **NAO PUBLICADA** e sugere o `firebase deploy`.

## 23/10/2026 — conferência em lote, direto nas APIs (7 min → 1,5 min)

Com 95 callables, o script fazia 285 chamadas ao `gcloud` em série (`run
services describe`, `get-iam-policy` e `functions describe` por callable), de
~1,5 s cada, porque o `gcloud` demora para abrir: 7 min em toda publicação.
Agora ele pede um token ao `gcloud` uma vez (`gcloud auth print-access-token`)
e lê as APIs REST, como o painel do sistema já fazia: uma listagem dos serviços
do Cloud Run, uma das functions e a política de cada callable (`run.googleapis.com`
e `cloudfunctions.googleapis.com`, v2). Na primeira publicação da homologação com
o script novo (23/10/2026, 95 callables), a conferência levou 1 min 33 s: cada
política responde em cerca de 1 s.

Os critérios são os mesmos dos incidentes acima: fora da listagem dos serviços
é **NAO PUBLICADA**, estado diferente de `ACTIVE` também, e sem a listagem das
functions vale só a política. Mudou o que antes caía no lugar errado: erro HTTP
ao ler uma política (403 de permissão, por exemplo) aparece como **ERRO** e
falha, sem sugerir `firebase deploy`; sem a listagem dos serviços, o script
falha antes de conferir qualquer callable; e `allUsers` só vale com o papel
`roles/run.invoker`, no mesmo binding. 429, 5xx e falha de rede são repetidos
até 3 vezes. A conta precisa de `run.services.list`, `run.services.getIamPolicy`
e `cloudfunctions.functions.list`, que a `github-actions-functions` já tem
(`roles/run.admin` e `roles/cloudfunctions.developer`). Continua rodando no
Windows PowerShell 5.1, pelo mesmo comando.

## Deploy automático pelo GitHub Actions

O job `Cloud Functions` em `.github/workflows/publicar.yml` publica
`functions/wms/` e `functions/comercial/` antes do frontend, sempre depois de
os testes do `.github/workflows/ci.yml` passarem no mesmo commit e de o job
`Regras e índices` (abaixo) publicar as regras.
O frontend só sobe depois que este job termina verde, com a conferência do
invoker; uma publicação por ambiente de cada vez, sem cancelar a que está
rodando (ver "Ordem e fila" em `docs/deploy-manual.md`). Roda na homologação
(`dute-homolog`) a cada push em `main`, pelo `.github/workflows/homologacao.yml`,
e na produção (`dute-prod`) só por disparo
manual com `publicar_producao` marcado. Ele sempre publica o lote inteiro
(`firebase deploy --only functions`, nunca `--only functions:nome`) e termina
rodando `tools/check_functions_invoker.ps1 -ProjectId <projeto>` contra o projeto
que acabou de publicar.

**Ele não autocorrige.** Se alguma callable ficar sem `allUsers`/
`roles/run.invoker`, ou não publicar, o job termina vermelho e mostra o comando
certo — uma pessoa ainda precisa rodar. Isso foi proposital: o histórico desta
página é de falhas silenciosas (03/09, 01/10, 02/10 x2), e preferimos um deploy
automático que avisa a um que tenta se corrigir sozinho sem nunca ter rodado
antes num ambiente não observado por humano.

### Regras e índices (job `regras`, desde 20/10/2026)

Antes do frontend e das functions, o job `Regras e índices (Firestore e
Storage)` roda `firebase deploy --only firestore,storage --project <projeto>
--non-interactive` da raiz do repositório e confere com
`tools/check_rules_deployed.sh` se o Firestore e o bucket padrão do Storage
passaram a servir as regras do commit. As functions têm `needs: regras` e o
frontend vem depois delas: se as regras não sobem, nada mais sobe. Os testes de regras do
Firestore rodam antes, em `functions-integration`; o `storage.rules` ainda não
tem teste.

Os índices novos ficam construindo por alguns minutos depois do job; uma
consulta que dependa deles falha com "requires an index" até terminarem. Sem
`--force`, o CI não apaga índice: o que sair do `firestore.indexes.json` continua
no projeto e o log do job avisa. Para apagar, alguém roda
`firebase deploy --only firestore:indexes --force --project <projeto>`.

A conta é a mesma do job de functions (`github-actions-functions@<projeto>`), que
já tinha `firebase.viewer` (acha o banco e o bucket padrão) e
`serviceusage.serviceUsageConsumer`. Ela publica functions que leem e gravam o
banco inteiro pelo Admin SDK, então poder publicar regras não amplia o que ela
alcança; uma conta só para regras seria mais uma identidade e mais um vínculo de
Workload Identity para manter em cada projeto. Papéis acrescentados uma vez, por
quem tem Owner:

```powershell
foreach ($p in @("dute-homolog", "dute-prod")) {
  $SA = "github-actions-functions@$p.iam.gserviceaccount.com"
  foreach ($role in @("roles/firebaserules.admin", "roles/datastore.indexAdmin")) {
    gcloud projects add-iam-policy-binding $p --member="serviceAccount:$SA" --role=$role --condition=None
  }
}
```

Para desfazer, o mesmo laço com `remove-iam-policy-binding`.

O `storage.rules` usa `firestore.get()`, e para isso o agente do Storage
(`service-<número do projeto>@gcp-sa-firebasestorage.iam.gserviceaccount.com`)
precisa de `roles/firebaserules.firestoreServiceAgent`. O `dute-homolog` e o
`dute-prod` já têm; num projeto novo, quem concede é uma pessoa com Owner, porque
a conta do CI não pode mexer em IAM.

### Function com segredo (Secret Manager)

A function que declara um segredo (`secrets: [...]`) só publica se o segredo
existe no projeto. São duas:

- A `runOmieSync` (parte 7.4 da Fase 7) declara as chaves da Omie só onde a
  Omie está liberada (`segredosDaOmie`, pela `OMIE_AMBIENTES_LIBERADOS`), hoje
  só o `dute-homolog`. Na homologação vão as chaves de um aplicativo de teste
  da Omie, e na produção, quando a Omie for liberada lá, as da empresa real.
- A `runNotifications` (parte 4.6a da Fase 4), quando declarar a do Resend,
  nos dois projetos.

Na publicação, o `firebase deploy`:

- confere a versão do segredo;
- dá à conta de runtime das functions
  (`<número do projeto>-compute@developer.gserviceaccount.com`) o papel
  `roles/secretmanager.secretAccessor` naquele segredo.

A `github-actions-functions` não tem papel no Secret Manager, e sem ele a
publicação falha nesse passo. Por isso, antes do PR que declara o segredo,
quem tem Owner faz, em cada projeto que o declara e para cada segredo:

- cria o segredo;
- dá à conta do CI a administração só daquele segredo, não do projeto.

Pelo console, em `https://console.cloud.google.com/security/secret-manager?project=<projeto>`:

1. **Criar secret**, com o nome (por exemplo `OMIE_APP_KEY`) e o valor.
2. No secret criado, aba **Permissões** › **Conceder acesso**: o principal
   `github-actions-functions@<projeto>.iam.gserviceaccount.com` com o papel
   **Administrador do Secret Manager**.

Ou pelo terminal, aqui com as chaves da Omie no `dute-homolog`:

```powershell
cd C:\DEV\Dute
$p = "dute-homolog"
foreach ($segredo in @("OMIE_APP_KEY", "OMIE_APP_SECRET")) {
  firebase functions:secrets:set $segredo --project $p
  gcloud secrets add-iam-policy-binding $segredo --project $p --member="serviceAccount:github-actions-functions@$p.iam.gserviceaccount.com" --role=roles/secretmanager.admin --condition=None
}
```

- O `secrets:set` pede o valor de cada um. Os valores nunca vão para o
  repositório nem para o chat.
- A homologação nunca emite numa Omie de produção: a emissão confere o
  ambiente antes de faturar. Mas a OS de teste nasce antes da conferência,
  por isso a homologação usa um aplicativo de teste da Omie.
- Para o Resend, a lista é só `RESEND_API_KEY`, nos dois projetos.
- Sem o segredo num projeto que o declara, a publicação daquele ambiente
  falha e nada mais sobe. Por isso o segredo nasce antes do PR, também na
  produção, que só publica com o OK do Leonardo.

### Pré-requisito: criar a identidade do job (manual, uma vez)

Feito no `dute-btg` antes do primeiro deploy automático (16/10/2026), como
está abaixo; no `dute-prod` e no `dute-homolog`, no corte da Fase 1
(`docs/plataforma/fase-1-corte.md`). Para um projeto novo, troque `dute-btg`
e o número `912453685006` pelos dele.

O classificador do Claude Code bloqueia IaC apply (criar service account/IAM)
mesmo com o usuário pedindo — por isso isso nunca roda sozinho. Rode uma vez,
autenticado como `leonardo@dutelog.com.br` (mesmo pré-requisito do resto deste
documento):

```powershell
# 1. Service account dedicada (não reusa a do frontend: menor escopo de dano
#    se uma das duas vazar ou for usada errado).
gcloud iam service-accounts create github-actions-functions `
  --project dute-btg `
  --display-name="GitHub Actions - deploy Cloud Functions"

# 2. Papéis no projeto. Espelha a SA do frontend (artifactregistry.writer,
#    cloudbuild.builds.editor, serviceusage.serviceUsageConsumer) e acrescenta
#    o que function/scheduler precisam que o frontend não precisa.
$SA = "github-actions-functions@dute-btg.iam.gserviceaccount.com"
foreach ($role in @(
  "roles/cloudfunctions.developer",
  "roles/run.admin",
  "roles/artifactregistry.writer",
  "roles/cloudbuild.builds.editor",
  "roles/cloudscheduler.admin",
  "roles/serviceusage.serviceUsageConsumer"
)) {
  gcloud projects add-iam-policy-binding dute-btg --member="serviceAccount:$SA" --role=$role
}

# 3. iam.serviceAccountUser só na SA de runtime das functions (mais estreito
#    que dar esse papel no projeto inteiro, que é o que a SA do frontend tem).
gcloud iam service-accounts add-iam-policy-binding `
  912453685006-compute@developer.gserviceaccount.com `
  --project dute-btg `
  --member="serviceAccount:$SA" `
  --role="roles/iam.serviceAccountUser"

# 4. Workload Identity: reusa o mesmo pool/provider do frontend (mesmo repo),
#    só autoriza a SA nova a ser assumida por ele.
gcloud iam service-accounts add-iam-policy-binding $SA `
  --project dute-btg `
  --role="roles/iam.workloadIdentityUser" `
  --member="principalSet://iam.googleapis.com/projects/912453685006/locations/global/workloadIdentityPools/github-pool/attribute.repository/Leow4u/Dute"
```

Depois de rodar isso, o job `Cloud Functions` já publica sozinho na próxima
execução. **Antes disso, ele falha na autenticação** (a SA não existe) —
não há risco de publicar pela metade por falta desse passo.

Papéis ainda não testados contra um deploy de verdade com uma SA restrita (só
o Leonardo, com Owner, já publicou functions até hoje): se o primeiro run
falhar com erro de permissão em vez de falhar no `check_functions_invoker`,
veja de qual API a mensagem reclama e adicione o papel que faltar — bucket de
build do Cloud Functions gen2 é o candidato mais provável, por analogia com o
`dute-btg_cloudbuild` que travou o deploy do frontend antes de 09/10/2026.

### Para desfazer

```powershell
gcloud iam service-accounts delete github-actions-functions@dute-btg.iam.gserviceaccount.com --project dute-btg
```

Remove a SA e, com ela, todo acesso que os passos acima deram — não precisa
reverter papel por papel.

## 16/10/2026 — primeiro deploy automático falhou antes de tocar em produção

Depois do pré-requisito de IAM acima rodado pela primeira vez, o primeiro
`deploy-functions` real falhou no passo "Garantir API do Cloud Scheduler
ativa": `PERMISSION_DENIED` em `serviceusage.services.enable`.
`roles/serviceusage.serviceUsageConsumer` (o papel dado à SA) permite *usar*
serviço já ativo, não ativar um novo — faltava `serviceusage.serviceUsageAdmin`
pra esse comando específico.

O job falhou **antes** do `firebase deploy --only functions` rodar — nenhuma
function foi tocada, nada ficou pela metade. Dar `serviceUsageAdmin` (que deixa
a SA ligar/desligar qualquer API do projeto) só por causa de um passo que já é
redundante em `dute-btg` (a API já está ativa desde 02/10) não parecia troca
boa. Em vez disso, o passo ganhou `continue-on-error: true`: tenta, mas não
trava o job se faltar permissão ou a API já estiver ativa — quem garante que
um projeto sem a API configurada não quebra é o próprio `firebase deploy`,
que falha claro se precisar dela e ela estiver desligada.

Ainda não sabemos se os papéis dados à SA bastam pro `firebase deploy --only
functions` em si — esse teste continua pendente pro próximo push em `main`.
