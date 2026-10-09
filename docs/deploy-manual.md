# Publicação manual em produção

Procedimento para publicar o app BTG em `https://app.dutelog.com.br`.

Enquanto o deploy automático do GitHub Actions não estiver funcionando, **este é o
processo oficial de publicação**. Ele é o mesmo que colocou no ar tudo que está
rodando hoje.

## Onde isso acontece

A publicação sai da sua própria máquina. Não há painel web para isso.

| Ambiente | Papel |
|---|---|
| `C:\DEV\Dute` (PowerShell) | Onde o código vive e o build é gerado. **É daqui que se publica.** |
| GitHub `Leow4u/Dute` | Guarda o código e roda os testes do CI |
| Google Cloud, projeto `dute-btg` | Cloud Build monta a imagem → Artifact Registry guarda → Cloud Run executa |
| `app.dutelog.com.br` | Load Balancer HTTPS apontando para o serviço `dute-btg-app` |

Abra o **Terminal do Windows (PowerShell)** e vá para a pasta do projeto:

```powershell
cd C:\DEV\Dute
```

## Pré-requisitos

Já instalados e autenticados nesta máquina:

- `gcloud` — logado como `leonardo@dutelog.com.br`, projeto padrão `dute-btg`
- `gh` — logado como `Leow4u`
- `node` e `corepack`

Atenção: **`pnpm` não está no PATH desta máquina.** Use `corepack pnpm`. Por isso o
script de deploy é chamado com `-SkipBuild` — sem essa flag ele tentaria invocar
`pnpm` diretamente e falharia.

Opcional, para poder usar `pnpm` sem prefixo (pode exigir terminal como administrador):

```powershell
corepack enable pnpm
```

## A regra que não pode ser quebrada

O script publica **o que estiver em `artifacts\btg-inventory\dist\public` no disco**.
Ele não consulta o git.

Publicar a partir de uma árvore com alteração não commitada faz produção deixar de ser
rastreável: ninguém consegue mais saber, olhando o repositório, o que está rodando para
o cliente. Sempre parta de `main` limpa e atualizada.

## Passo a passo

### 1. Partir de main limpa

```powershell
git checkout main
git pull
git status
```

`git status` não deve listar nenhuma alteração em arquivo rastreado. Se listar, resolva
antes (commit ou descarte) — não publique por cima.

### 2. Instalar dependências e gerar o build

```powershell
corepack pnpm install
corepack pnpm --filter "@workspace/btg-inventory" run build
```

O build sai em `artifacts\btg-inventory\dist\public`.

### 3. Anotar a revisão atual (para rollback)

```powershell
gcloud run services describe dute-btg-app --region southamerica-east1 --project dute-btg --format="value(status.latestReadyRevisionName)"
```

Guarde esse nome. Se o deploy novo der problema, é para ele que você volta.

### 4. Publicar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\deploy_cloud_run.ps1 -SkipBuild
```

O script habilita as APIs necessárias, cria o repositório no Artifact Registry se não
existir, monta um diretório de staging em `tmp\cloud-run-src` contendo apenas
`Dockerfile`, `nginx.conf` e `dist/public`, submete ao Cloud Build com uma tag de
timestamp, publica no Cloud Run e imprime a URL do serviço.

### 5. Conferir que subiu

```powershell
gcloud run revisions list --service dute-btg-app --region southamerica-east1 --project dute-btg --limit 3 --format="table(name,creationTimestamp.date('%Y-%m-%d %H:%M'),active)"
```

E confirme que o site responde:

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" https://app.dutelog.com.br/
```

Deve retornar `200`.

## Rollback

Não é preciso reconstruir nada — o Cloud Run guarda as revisões anteriores. Para voltar
o tráfego para uma revisão conhecida:

```powershell
gcloud run services update-traffic dute-btg-app --region southamerica-east1 --project dute-btg --to-revisions NOME-DA-REVISAO=100
```

Use o nome anotado no passo 3.

Isso **prende** o tráfego nessa revisão: a partir daí nenhum deploy novo, manual ou do
GitHub Actions, recebe tráfego até você soltar com `--to-latest` (comando na seção do
deploy automático). Depois de corrigir o problema, solte.

## Como saber qual commit está em produção

As tags de imagem são timestamps (`20260812141220`), não commits — então a rastreabilidade
depende da disciplina do passo 1. Para verificar depois, reconstrua o commit suspeito e
compare os assets gerados com os servidos em produção: os nomes de arquivo do Vite são
hash de conteúdo, então batem quando o código é o mesmo. Diferenças restritas a nomes de
variável minificados são ruído do minificador, não diferença de código.

## Configuração do Firebase no build

O build do frontend precisa das seis variáveis `VITE_FIREBASE_*` (configuração web pública
do projeto `dute-btg`: chave de API web, authDomain, projectId, storageBucket,
messagingSenderId e appId). Na sua máquina elas vêm do `.env.local` da raiz (o
`vite.config.ts` aponta `envDir` para a raiz do repositório). No CI elas estão no próprio
workflow, no passo `Install and build frontend`, que trava se o bundle sair sem o
`authDomain`.

Essas chaves são públicas por construção: vão em todo bundle servido ao navegador, e o
acesso é controlado por Firestore Rules e pelo backend. Segredos de verdade (`AGENT_DUTE_*`,
chaves de serviço) ficam fora do repositório e do workflow.

Em 09/10/2026 à noite, a primeira publicação feita pelo CI subiu um build sem essas
variáveis: o login parou com "Firebase não configurado" e o tráfego voltou para
`dute-btg-app-00143-loc` em poucos minutos (Actions > CI > Run workflow com
`liberar_trafego` marcado e `revisao` preenchida). A trava do passo de build existe para
isso não se repetir.

## Deploy automático pelo GitHub Actions

O job `deploy-frontend` em `.github/workflows/ci.yml` publica o frontend a cada push
em `main` (depois do `frontend-typecheck`) e também por disparo manual em
Actions > CI > Run workflow, sempre a partir de `main`. A tag da imagem é o commit
curto, então dá para saber o que está no ar olhando a revisão do Cloud Run.

**Verde não basta.** Em 09/10/2026, oito execuções seguidas do job terminaram com
sucesso e nenhuma mudou o que `app.dutelog.com.br` servia: todas imprimiram a mesma
revisão (`dute-btg-app-00143-loc`), com "Creating Revision" concluído em menos de um
segundo, e o app continuou no build de 08/10. Por isso o job termina com
`tools/check_frontend_deployed.sh`, que compara os assets do `index.html` do build com
os servidos pela URL do Cloud Run e pelo domínio; se não baterem, o job falha e imprime
`spec.traffic`, `status.traffic` e as últimas revisões do serviço.

No caso de 09/10 a causa era esta: o tráfego estava preso em `dute-btg-app-00143-loc`
desde 08/10 01:55 UTC (`spec.traffic` com `revisionName` fixo), e as oito revisões que o
job criou (`00143-cg4` a `00150-lk5`, todas prontas, a última com a imagem `8324dbb`)
ficaram com 0% de tráfego. O job `Diagnóstico do Cloud Run (só leitura)`, que roda no
disparo manual do CI (Actions > CI > Run workflow, de qualquer branch), mostra tráfego,
revisões e o que as URLs servem sem precisar de gcloud na máquina.

Quando a verificação falhar, olhe primeiro o tráfego e as revisões:

```powershell
gcloud run services describe dute-btg-app --region southamerica-east1 --project dute-btg --format "yaml(spec.traffic,status.traffic,status.latestCreatedRevisionName,status.latestReadyRevisionName)"
gcloud run revisions list --service dute-btg-app --region southamerica-east1 --project dute-btg --limit 5 --format "table(name,creationTimestamp.date('%Y-%m-%d %H:%M'),active,spec.containers[0].image)"
```

Se `spec.traffic` apontar para um `revisionName` fixo em vez de `latestRevision: true`
(é o que o rollback da seção acima faz), as revisões novas ficam com 0% de tráfego.
Solte o tráfego e a última revisão pronta passa a receber tudo:

```powershell
gcloud run services update-traffic dute-btg-app --region southamerica-east1 --project dute-btg --to-latest
```

Sem gcloud na máquina, o mesmo efeito vem de Actions > CI > Run workflow com
`liberar_trafego` marcado (job `Liberar tráfego para a última revisão`). Foi assim que o
tráfego foi solto em 09/10/2026 às 20:28 UTC, colocando no ar a revisão `00150-lk5`
(`8324dbb`); desde então `spec.traffic` volta a seguir a última revisão e cada push em
`main` passa a valer de novo.

Se a lista não mostrar nenhuma revisão criada pelo job (a imagem dela tem o commit
curto como tag), o deploy não está criando revisões: publique pelo roteiro manual deste
documento e investigue o job antes de confiar nele de novo.

A imagem é montada no próprio runner e enviada ao Artifact Registry com `docker push`,
autenticado com o token da Workload Identity. Até 09/10/2026 o job usava
`gcloud builds submit` e falhava em todo push com:

```
The user is forbidden from accessing the bucket [dute-btg_cloudbuild]
```

Já verificado e descartado como causa: o binding `roles/iam.workloadIdentityUser` do
principalSet `Leow4u/Dute` sobre a service account está correto; não há política de
organização no projeto; e a SA `github-actions-deploy@dute-btg.iam.gserviceaccount.com`
tem `artifactregistry.writer`, `cloudbuild.builds.editor`, `iam.serviceAccountUser`,
`run.admin`, `serviceusage.serviceUsageConsumer` no projeto, mais `storage.objectAdmin` e
`storage.legacyBucketReader` no bucket `gs://dute-btg_cloudbuild`. Sem Cloud Build no
caminho, o bucket deixa de importar.

As Cloud Functions continuam com publicação manual (`docs/deploy-functions-manual.md`).
Quando uma mudança toca frontend e functions, publique as functions logo depois do
merge para os dois lados não ficarem fora de sincronia.
