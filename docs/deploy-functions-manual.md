# Publicação de Cloud Functions

Procedimento para publicar `functions/` (as callables usadas pelo app BTG) no
projeto Google Cloud `dute-btg`.

Diferente do frontend (`docs/deploy-manual.md`), este processo nunca foi escrito
antes — o que é provavelmente como o incidente de 03/09/2026 (ver abaixo) passou
um mês sem ser percebido.

## Pré-requisitos

Os mesmos do deploy do frontend: `gcloud` autenticado como
`leonardo@dutelog.com.br`, projeto padrão `dute-btg`, `node`/`corepack`. O
diretório `functions/` usa **npm**, não pnpm (tem `package-lock.json` próprio).

## Passo a passo

### 1. Partir de main limpa

```powershell
git checkout main
git pull
git status
```

### 2. Rodar os testes críticos antes de publicar

```powershell
npm --prefix functions run test:critical
```

Isso roda `test:unit` (billing) e `test:integration` (fluxo WMS/estoque contra o
emulador do Firestore — exige Java 21+). Não publique com isso vermelho.

### 3. Publicar

```powershell
firebase deploy --only functions --project dute-btg
```

O `predeploy` do `firebase.json` já roda `npm run build` (tsc) antes de subir.

Para publicar só uma function específica (mais rápido, mas é exatamente o tipo
de deploy que causou o incidente abaixo — **nunca pule o passo 4** depois de um
deploy parcial):

```powershell
firebase deploy --only functions:nomeDaFunction --project dute-btg
```

### 4. Verificar que toda callable continua com invocação pública

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\check_functions_invoker.ps1
```

Esse script lê as callables exportadas em `functions/src/index.ts`, compara com
o Cloud Run real e falha (exit 1) se alguma estiver sem `allUsers` /
`roles/run.invoker`. **Rode sempre, mesmo em deploy que "só" mudou uma
function** — foi exatamente esse tipo de deploy que causou o incidente abaixo.

Isso não é uma falha de segurança: a autorização de verdade acontece dentro de
cada callable via Firebase Auth + papel (`requireCustomerScope`,
`requireOperationsCoordinator`, etc.) — Cloud Run só decide se a requisição
chega até o código. Ver invariante 5 do `CLAUDE.md`.

### 5. Permissões da conta das Functions no Storage

As Functions rodam com a conta `912453685006-compute@developer.gserviceaccount.com`,
que **não** é Editor do projeto. No bucket `dute-btg.firebasestorage.app` ela
precisa de dois papéis:

| Papel | Para quê |
| --- | --- |
| `roles/storage.objectCreator` | gravar o anexo do aviso de envio (`uploadShipmentAttachment`) |
| `roles/storage.objectViewer` | ler a nota para o Agent Dute (`readShipmentInvoice`) |

Em projeto novo, ou se alguém refizer a política do bucket:

```powershell
gcloud storage buckets add-iam-policy-binding gs://dute-btg.firebasestorage.app --member="serviceAccount:912453685006-compute@developer.gserviceaccount.com" --role="roles/storage.objectCreator" --project dute-btg
gcloud storage buckets add-iam-policy-binding gs://dute-btg.firebasestorage.app --member="serviceAccount:912453685006-compute@developer.gserviceaccount.com" --role="roles/storage.objectViewer" --project dute-btg
```

Só no bucket, não no projeto, e sem apagar/sobrescrever. Sem esses papéis o
portal mostra "O servidor não tem permissão para gravar (ou ler) arquivos no
Storage", com o papel que falta. Até 01/10/2026 aparecia só "Falha interna no
servidor", e a causa (403 `storage.objects.create`) estava apenas no log:

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="uploadshipmentattachment" AND severity>=WARNING' --project dute-btg --freshness=1h --limit 5
```

### Deploy lento: "User code failed to load … Timeout after 10000"

O Firebase carrega o código para descobrir as functions e espera 10 s; com o
Genkit isso às vezes passa. Aumente antes do deploy:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
```

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
