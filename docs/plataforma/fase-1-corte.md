# Fase 1: corte do WMS do `dute-btg` para o `dute-prod`

Roteiro da migração do WMS em produção (`app.dutelog.com.br`) do projeto
`dute-btg` para o `dute-prod`, conforme a seção "Migração para o projeto novo"
de `docs/plataforma/plano.md`. A janela é num fim de semana, depois da contagem
de abertura do inventário (que começa em 20/10/2026). **Congelar o `dute-btg`,
mexer no DNS e publicar na produção só com OK do Leonardo, passo a passo.** A
volta é pelo DNS: o IP antigo continua intacto.

Ferramentas:

- `tools/migracao_firestore.py`: inventário do banco (contagem por coleção e
  hash de cada documento), comparação entre projetos, troca do bucket nos links
  de foto e anexo, importação e comparação do Auth. Testes em
  `tools/test_migracao_firestore.py`.
- `tools/congelar_projeto.ps1`: congela e descongela um projeto (regras,
  rotinas agendadas e invocação pública das callables publicadas nele). Sem
  `-Apply`, só mostra o plano. Testes em `tools/congelar_projeto.tests.ps1`.
- `tools/trocar_registro_a_hostinger.ps1`: troca um único registro A na
  Hostinger (IP padrão do `dute-prod`), com a zona fotografada antes e depois e
  parada com erro se mudar qualquer outro registro. Sem `-Apply`, só fotografa e
  valida. Testes em `tools/trocar_registro_a_hostinger.tests.ps1`.

Saídas com dado de produção ficam em `tmp\fase-1\` (manifestos, listagens) e
`.secrets\fase-1\` (exports do Auth, com hash de senha; fotos da zona DNS).
Nunca no git nem em serviço externo.

## O que muda de lugar

| Parte | `dute-btg` (hoje) | `dute-prod` |
|---|---|---|
| Firestore `(default)`, `southamerica-east1` | 476 documentos em 15 coleções (19/10/2026) | export gerenciado do `dute-btg` importado; mesmos 52 índices compostos e as regras do repositório |
| Auth (Identity Platform, e-mail e senha) | 6 contas | importadas com o hash SCRYPT do `dute-btg`: cada pessoa entra com a senha de antes |
| Storage | `dute-btg.firebasestorage.app`, 405 arquivos, 50 MB | `dute-prod.firebasestorage.app`, copiado com os metadados (o token dos links vai junto) |
| Links de foto e anexo no banco | apontam para `dute-btg.firebasestorage.app` | trocados para `dute-prod.firebasestorage.app` (`trocar-bucket`) |
| App | Cloud Run `dute-btg-app` | Cloud Run `dute-app` |
| Site institucional | Cloud Run `dutelog-site`, no mesmo Load Balancer | Cloud Run `dutelog-site` (mesma imagem), no Load Balancer novo |
| Load Balancer | IP `8.232.54.179`, certificado clássico | IP `34.54.243.247`, Certificate Manager com autorização por DNS |
| Rotina agendada | `runAgentRoutines` a cada 15 min | a mesma, publicada com as functions |
| E-mail | Agent Dute em `audit_only` (nada sai); e-mails padrão do Auth | igual |

O `dute-btg` não é apagado: fica congelado de 30 a 60 dias e quem apaga é o
Leonardo, no console.

## Preparação do `dute-prod` (feita em 19/10/2026)

O `dute-prod` foi montado como o `dute-homolog` (Fase 0), corrigindo o que
faltava na homologação e existia no `dute-btg`:

- Firestore `(default)` em `southamerica-east1`, com proteção contra exclusão;
  regras, índices e regras do Storage publicados da `main`
  (`firebase deploy --only firestore,storage --project dute-prod`).
- Identity Platform com e-mail e senha; domínios autorizados `localhost`,
  `dute-prod.firebaseapp.com`, `dute-prod.web.app`, `app.dutelog.com.br` e os
  dois endereços `run.app` do `dute-app`; proteção de enumeração de e-mail
  ligada, como no `dute-btg`.
- App web "Dute" (`1:974421124970:web:e224e2335773655bde6713`); a configuração
  pública está no `ci.yml`.
- Bucket padrão `dute-prod.firebasestorage.app` com o CORS de
  `deploy/cloud-storage/cors-dute-prod.json`. A conta de runtime
  (`974421124970-compute@`) pode criar e ler arquivos nele (o upload por link
  assinado depende disso), e o agente do Storage tem
  `roles/firebaserules.firestoreServiceAgent` (as regras do Storage consultam o
  Firestore; sem o papel, o envio de foto de produto dá 403). Os dois faltavam
  na homologação e foram dados lá também.
- Conta de runtime com os mesmos papéis da homologação e permissão para assinar
  links (`serviceAccountTokenCreator` nela mesma).
- Workload Identity `github-pool`/`github-provider` (repositório `Leow4u/Dute`) e
  as contas `github-actions-deploy` e `github-actions-functions` com os papéis
  do `dute-btg`. A `github-actions-functions` age como `dute-prod@appspot` e como
  a conta de runtime; sem isso o `firebase deploy` recusa (foi o que derrubou a
  publicação das functions na homologação em 19/10/2026, já corrigido lá).
- Artifact Registry `dute` e `gcf-artifacts`. O `gcf-artifacts` já nasce com a
  política de limpeza `firebase-functions-cleanup` (1 dia): sem ela, o
  `firebase deploy --non-interactive` do CI sobe as functions mas sai com erro e
  pula a verificação do invoker.
- Cloud Run `dute-app` (imagem provisória do Google até a primeira publicação) e
  `dutelog-site` (imagem copiada do `dute-btg`, mesmo digest).
- Load Balancer: IP `dute-app-ip` (`34.54.243.247`), NEGs `dute-app-neg` e
  `dutelog-site-neg`, mapa `dute-app-url-map` (`dutelog.com.br` e
  `www.dutelog.com.br` vão para o site, o resto para o app), proxy
  `dute-app-https-proxy` com o mapa de certificados `dute-cert-map` e regra
  `dute-app-https-rule` (443). Certificados `dute-app-cert`
  (`app.dutelog.com.br`) e `dutelog-site-cert` (`dutelog.com.br`,
  `www.dutelog.com.br`), autorizados por DNS do tipo por projeto, que não
  disputa registro com outro projeto. Ativos desde 19/10/2026 23:24, emitidos
  pela Google Trust Services; a renovação é automática **enquanto os três CNAMEs
  `_acme-challenge_drmxqhwlpiaruyad*` ficarem na zona**.
- Teste pelo IP, sem DNS: `app.dutelog.com.br` responde 200 com a imagem
  provisória e `dutelog.com.br`/`www` com o site.
- Bucket `gs://dute-prod-migracao` para o export do corte; o agente do Firestore
  do `dute-btg` pode gravar nele.

## Ensaio na homologação (19/10/2026)

| Passo | Resultado |
|---|---|
| Export do `dute-btg` | 476 documentos em 27 s; o inventário no início e no fim do export é o mesmo, então o export é exato |
| Import no `dute-homolog` | 476 documentos, **mesmo conteúdo documento por documento** (`comparar`: "Iguais.") |
| Auth | 6 de 6 contas, com senha gravada (`comparar-auth`) |
| Storage | 405 de 405 arquivos com o mesmo checksum, tipo e token; link de download com o bucket novo abre (HTTP 200) |
| Links no banco | nenhum documento cita o bucket hoje (a zeragem de 16/10 apagou catálogo e anexos); a troca roda vazia |
| Congelar e descongelar | 8 min cada; callable sem invoker responde 403; regras de manutenção publicadas e depois as do repositório |
| Login com usuário real | o Leonardo entrou com a senha de antes em https://dute-app-368642218894.southamerica-east1.run.app |

## Antes da janela

1. **CNAMEs da validação dos certificados**: criados em 19/10/2026 pela API da
   Hostinger, só acrescentando (zona antes e depois em
   `.secrets\fase-1\dns-zona-*-cnames.json`). Não apagar: a renovação precisa
   deles.

   | Nome | Tipo | Valor |
   |---|---|---|
   | `_acme-challenge_drmxqhwlpiaruyad.app` | CNAME | `c8043175-2db6-4ea3-99b8-91ee27e1e599.19.authorize.certificatemanager.goog.` |
   | `_acme-challenge_drmxqhwlpiaruyad` | CNAME | `8bcac9ea-348e-4e3c-b9a6-2d7d741aea1d.13.authorize.certificatemanager.goog.` |
   | `_acme-challenge_drmxqhwlpiaruyad.www` | CNAME | `40635450-3c4a-49d1-b23b-3216e1889018.16.authorize.certificatemanager.goog.` |

2. **Conferir certificados e Load Balancer** (na véspera):

   ```powershell
   cd C:\DEV\Dute
   gcloud certificate-manager certificates list --project dute-prod --format="table(name,san_dnsnames.list(),managed.state)"
   curl.exe -sS -o NUL -w "%{http_code}`n" --resolve app.dutelog.com.br:443:34.54.243.247 https://app.dutelog.com.br/
   curl.exe -sS -o NUL -w "%{http_code}`n" --resolve dutelog.com.br:443:34.54.243.247 https://dutelog.com.br/
   ```

   Os dois certificados `ACTIVE` e `200` nos dois endereços, sem `-k`.

3. **Publicar a `main` no `dute-prod`** (com OK do Leonardo). O disparo do CI leva
   frontend e functions; regras e índices são à mão, da `main` atualizada:

   ```powershell
   cd C:\DEV\Dute
   git checkout main
   git pull
   firebase deploy --only firestore,storage --project dute-prod
   ```

   Depois, Actions > CI > Run workflow, branch `main`, marcar só
   `publicar_dute_prod`. O job confere o endereço `run.app` e o invoker de cada
   callable. Então:

   ```powershell
   .\tools\check_functions_invoker.ps1 -ProjectId dute-prod
   gcloud scheduler jobs list --project dute-prod --location southamerica-east1
   ```

   O app abre em https://dute-app-974421124970.southamerica-east1.run.app (sem
   dados até o corte).

4. **PR do corte pronto** (ver "Mudanças no repositório no corte"), aberto e
   verde, **sem merge**: o merge é o passo 8 da janela.

5. **Avisar a equipe e o BTG** do horário (Leonardo). Durante a janela o app dá
   erro de permissão; depois, cada pessoa entra de novo com a mesma senha.

6. Se o site institucional for junto: um dia antes, baixar o TTL do registro `@`
   (A) para 300 na Hostinger. O do `app` já é 300.

## Janela de corte

Tempo estimado: 60 a 80 minutos, a maior parte no congelamento, na espera da
propagação e na conferência.
Todos os comandos na máquina do Leonardo, na `main` atualizada, com `gcloud` e
`firebase` logados como `leonardo@dutelog.com.br`:

```powershell
cd C:\DEV\Dute
git checkout main
git pull
$d = Get-Date -Format yyyyMMdd
New-Item -ItemType Directory -Force tmp\fase-1, .secrets\fase-1 | Out-Null
```

### 1. Congelar o `dute-btg` (OK do Leonardo)

```powershell
.\tools\congelar_projeto.ps1 -ProjectId dute-btg
.\tools\congelar_projeto.ps1 -ProjectId dute-btg -Apply
```

Regras de manutenção no Firestore e no Storage, `runAgentRoutines` pausada e
callables publicadas sem invocação pública. Tem que terminar em "CONGELAR
concluido". A remoção do invoker leva alguns minutos para valer em toda parte
(IAM: normalmente 2, até 7 ou mais): anote a hora e só comece o export do passo
3 **10 minutos depois**. O passo 2 cabe nesse intervalo.

### 2. Auth

```powershell
firebase auth:export .secrets\fase-1\auth-dute-btg-${d}.json --format=json --project dute-btg
python tools\migracao_firestore.py importar-auth --arquivo .secrets\fase-1\auth-dute-btg-${d}.json --origem dute-btg --destino dute-prod
firebase auth:export .secrets\fase-1\auth-dute-prod-${d}.json --format=json --project dute-prod
python tools\migracao_firestore.py comparar-auth --origem .secrets\fase-1\auth-dute-btg-${d}.json --destino .secrets\fase-1\auth-dute-prod-${d}.json --projeto-destino dute-prod
```

O `importar-auth` lê a chave do hash na configuração do `dute-btg` na hora e não
a grava em disco. O export do destino não traz o hash de senha importada de outro
projeto; por isso o `comparar-auth` confere a senha de cada conta pela API
("Senha gravada no dute-prod: N de N"). O Auth não é congelado: quem trocar a
senha no `dute-btg` depois do export usa "Esqueci a senha" no `dute-prod`.

### 3. Firestore

Regras e índices da `main` no `dute-prod` e a rotina dele pausada durante o
import, para nada mexer nos dados antes da conferência:

```powershell
firebase deploy --only firestore,storage --project dute-prod
gcloud scheduler jobs pause firebase-schedule-runAgentRoutines-southamerica-east1 --project dute-prod --location southamerica-east1
python tools\migracao_firestore.py inventario --projeto dute-prod --saida tmp\fase-1\manifesto-prod-antes-${d}.json
```

O inventário tem que dar 0 documentos: o import sobrescreve documento com o
mesmo caminho e não apaga o resto. Depois, export com o `dute-btg` conferido
antes e depois:

```powershell
$exp = "corte-${d}"
python tools\migracao_firestore.py inventario --projeto dute-btg --procurar dute-btg --saida tmp\fase-1\manifesto-btg-${d}.json
gcloud firestore export gs://dute-prod-migracao/$exp --project dute-btg --database="(default)"
python tools\migracao_firestore.py inventario --projeto dute-btg --saida tmp\fase-1\manifesto-btg-depois-${d}.json
python tools\migracao_firestore.py comparar --origem tmp\fase-1\manifesto-btg-${d}.json --destino tmp\fase-1\manifesto-btg-depois-${d}.json
```

Tem que dar "Iguais.": nada gravou no `dute-btg` enquanto o export rodava. Se
der diferente, alguma gravação passou pelo congelamento ainda em propagação:
espere 10 minutos e repita este bloco trocando só a primeira linha por
`$exp = "corte-${d}-2"`. Então:

```powershell
gcloud firestore import gs://dute-prod-migracao/$exp --project dute-prod --database="(default)"
python tools\migracao_firestore.py inventario --projeto dute-prod --procurar dute-btg --saida tmp\fase-1\manifesto-prod-${d}.json
python tools\migracao_firestore.py comparar --origem tmp\fase-1\manifesto-btg-depois-${d}.json --destino tmp\fase-1\manifesto-prod-${d}.json
```

"Iguais.": mesma contagem por coleção e mesmo conteúdo em cada documento.

### 4. Storage

```powershell
gcloud storage rsync -r gs://dute-btg.firebasestorage.app gs://dute-prod.firebasestorage.app
gcloud storage rsync -r --dry-run gs://dute-btg.firebasestorage.app gs://dute-prod.firebasestorage.app
gcloud storage du -s gs://dute-btg.firebasestorage.app gs://dute-prod.firebasestorage.app
```

O `--dry-run` não pode listar nada para copiar, e os dois tamanhos precisam ser
iguais. O `rsync` leva o metadado `firebaseStorageDownloadTokens`, então o
link de cada arquivo continua valendo com o bucket novo.

### 5. Trocar o bucket nos links do banco

```powershell
python tools\migracao_firestore.py trocar-bucket --projeto dute-prod --de dute-btg.firebasestorage.app --para dute-prod.firebasestorage.app
python tools\migracao_firestore.py trocar-bucket --projeto dute-prod --de dute-btg.firebasestorage.app --para dute-prod.firebasestorage.app --aplicar
python tools\migracao_firestore.py inventario --projeto dute-prod --procurar dute-btg --saida tmp\fase-1\manifesto-prod-${d}-links.json
```

O inventário final só pode citar `dute-btg` nos registros históricos do export
da zeragem (`events . payload.export`, `system_controls . full_reset_export`),
que ficam como estão. Rodar a troca de novo não muda nada.

Última conferência do `dute-btg` antes do DNS: nada pode ter gravado nele desde o
export.

```powershell
python tools\migracao_firestore.py inventario --projeto dute-btg --saida tmp\fase-1\manifesto-btg-final-${d}.json
python tools\migracao_firestore.py comparar --origem tmp\fase-1\manifesto-btg-depois-${d}.json --destino tmp\fase-1\manifesto-btg-final-${d}.json
```

Tem que dar "Iguais.". Se não der, o que gravou depois do export não está no
`dute-prod`: parar e decidir com o Leonardo (refazer o passo 3 com o `dute-prod`
vazio, ou voltar).

### 6. DNS (OK do Leonardo)

Na Hostinger, zona `dutelog.com.br`: registro `app` (A) de `8.232.54.179` para
**`34.54.243.247`**, TTL 300. Não mexer em MX, SPF, DKIM, DMARC nem nos CNAMEs
`_acme-challenge_*`.

```powershell
nslookup app.dutelog.com.br 8.8.8.8
```

Em até 5 minutos o Google já responde o IP novo; outros resolvedores e
navegadores seguem o TTL. O app é PWA: na primeira visita depois da troca, o
service worker baixa o `sw.js` novo (servido sem cache), assume e recarrega a
página com o build do `dute-prod`. Quem estiver com o app aberto vê erro de
permissão até essa recarga, e todos entram de novo (a sessão do Firebase é por
projeto).

### 7. Conferir e decidir

1. `curl.exe -sSI https://app.dutelog.com.br/` responde `200` com o certificado
   do Certificate Manager.
2. O `index.html` servido em `app.dutelog.com.br` é o mesmo do `dute-app`:

   ```powershell
   curl.exe -sS https://app.dutelog.com.br/index.html | Select-String -Pattern 'shell-app-[^"]*\.js' -AllMatches | ForEach-Object { $_.Matches.Value }
   curl.exe -sS https://dute-app-974421124970.southamerica-east1.run.app/index.html | Select-String -Pattern 'shell-app-[^"]*\.js' -AllMatches | ForEach-Object { $_.Matches.Value }
   ```

3. O Leonardo entra com a senha de antes; um usuário do portal BTG também.
4. Uma foto ou anexo existente abre, e **uma foto de produto nova sobe** pelo app
   (passa pelas regras do Storage, que consultam o Firestore).
5. Telas com contagem batem com o `manifesto-btg-depois-${d}.json` (Estoque,
   Posições, Clientes, Usuários).
6. Painel Sistema: functions ok, sem erro de permissão.

Se tudo bateu, **seguir**: retomar a rotina do `dute-prod` e conferir que só ele
tem rotina ativa.

```powershell
gcloud scheduler jobs resume firebase-schedule-runAgentRoutines-southamerica-east1 --project dute-prod --location southamerica-east1
gcloud scheduler jobs list --project dute-prod --location southamerica-east1
gcloud scheduler jobs list --project dute-btg --location southamerica-east1
```

Se algo não bateu, **voltar** (seção "Volta"), antes de a equipe voltar a
operar.

### 8. Trocar o CI para o `dute-prod` (depois de decidir seguir)

Merge do PR do corte. O push na `main` publica só na homologação. Depois,
Actions > CI > Run workflow com `publicar_producao` (agora o `dute-prod`), com OK
do Leonardo: confirma o caminho de publicação com a verificação de
`app.dutelog.com.br`.

### 9. Site institucional (pode ser na mesma janela)

Com o `dutelog-site-cert` `ACTIVE`: registro `@` (A) de `8.232.54.179` para
`34.54.243.247` na Hostinger. O `www` é CNAME de `@` e vai junto. Conferir
`https://dutelog.com.br` e `https://www.dutelog.com.br`.

## Volta

A conferência de cada descongelamento é o próprio "DESCONGELAR concluido": o
script relê a política de cada callable publicada no projeto. O
`check_functions_invoker.ps1` lê as callables do código; um "NAO PUBLICADA" de
callable que o congelamento listou como "ainda nao publicadas no projeto" não é
falha da volta.

- **Antes do passo 6 (DNS):** descongelar o `dute-btg`. O `dute-prod` fica com
  os dados importados, a rotina pausada e não atende ninguém.

  ```powershell
  .\tools\congelar_projeto.ps1 -ProjectId dute-btg -Desfazer -Apply
  ```

- **Depois do passo 6:** primeiro congelar o `dute-prod`, para que abas e PWAs já
  no build novo (que falam direto com o Firestore e as functions do `dute-prod`,
  sem passar pelo DNS) parem de gravar nele. Depois, registro `app` (A) de volta
  para `8.232.54.179` na Hostinger, descongelar o `dute-btg` e pedir a todos que
  recarreguem o app. Se o passo 8 já foi feito, reverter o PR do corte.

  ```powershell
  cd C:\DEV\Dute
  .\tools\congelar_projeto.ps1 -ProjectId dute-prod -Apply
  $env:HOSTINGER_API_TOKEN = "cole-o-token-aqui"
  .\tools\trocar_registro_a_hostinger.ps1 -Nome app -Ip 8.232.54.179 -Rotulo volta-app -Apply
  .\tools\congelar_projeto.ps1 -ProjectId dute-btg -Desfazer -Apply
  ```

  O que tiver sido gravado no `dute-prod` depois da troca não volta sozinho para
  o `dute-btg`.

- **Depois do passo 9 (site):** registro `@` (A) de volta para `8.232.54.179`; o
  `www` vai junto.

  ```powershell
  cd C:\DEV\Dute
  .\tools\trocar_registro_a_hostinger.ps1 -Nome "@" -Ip 8.232.54.179 -Rotulo volta-site -Apply
  ```

- **Prazo da volta pelo DNS:** o Load Balancer antigo usa certificados clássicos,
  que só se renovam com o DNS apontando para ele. O `dute-btg-app-cert` vence em
  **02/12/2026** e o `dutelog-site-cert` em 21/12/2026. Depois dessas datas, voltar
  exige antes um certificado novo no Load Balancer do `dute-btg` (Certificate
  Manager com autorização por DNS, como no `dute-prod`).

- **Nova tentativa depois de uma volta:** o banco do `dute-prod` precisa estar
  vazio de novo (passo 3); apagar os dados do `dute-prod` é decisão do Leonardo
  (`firebase firestore:delete --all-collections --project dute-prod`). Se o
  `dute-prod` foi congelado na volta, descongelá-lo antes do passo 1
  (`.\tools\congelar_projeto.ps1 -ProjectId dute-prod -Desfazer -Apply`); o passo
  3 pausa a rotina dele de novo.

## Depois do corte

- O `dute-btg` fica congelado, com o Load Balancer antigo no ar (é o caminho da
  volta, até o prazo dos certificados acima). Não descongelar sem decidir
  voltar.
- Antes de o Leonardo apagar o `dute-btg` (30 a 60 dias): o site institucional
  já está no `dute-prod` desde 20/10/2026 (passo 9); falta só um último export do
  `dute-btg` guardado fora dele, se quiser histórico.
- Os exports do corte ficam em `gs://dute-prod-migracao`, e os do ensaio em
  `gs://dute-homolog-migracao`; apagar quando não forem mais necessários
  (decisão do Leonardo).

## Mudanças no repositório no corte

PR preparado antes da janela e mergeado no passo 8:

- `.github/workflows/ci.yml`: `publicar-producao` com `project_id: dute-prod`,
  `project_number: "974421124970"`, `service: dute-app`, `repository: dute`,
  `public_url: https://app.dutelog.com.br`,
  `firebase_api_key: "AIzaSyAqA8X_nzaN145XHBbRbviSbXENw_fQkpw"` e
  `firebase_app_id: "1:974421124970:web:e224e2335773655bde6713"`; os jobs
  `cloud-run-diagnostico` e `liberar-trafego` com `dute-prod`, `dute-app` e o
  provedor `projects/974421124970/locations/global/workloadIdentityPools/github-pool/providers/github-provider`;
  sai o `publicar-dute-prod` e o input `publicar_dute_prod`.
- `.firebaserc`: `default` passa a ser `dute-prod`.
- `tools/check_functions_invoker.ps1`: padrão `dute-prod`.
- `CLAUDE.md`, `docs/deploy-manual.md` e `docs/deploy-functions-manual.md`: a
  produção passa a ser o `dute-prod` (Cloud Run `dute-app`).
- `deploy/cloud-run/cloudbuild-site.yaml`: repositório `dute` em vez de
  `dute-btg`, para o site ser publicado no `dute-prod`.

## Corte de 20/10/2026, antes da contagem de abertura

A contagem de abertura do inventário recomeça tudo do zero (produtos, fotos,
estoque). Por isso o Leonardo decidiu cortar **antes** dela, com o `dute-btg` só
com a configuração preservada na zeragem de 16/10. Isso dispensou parte do
roteiro completo:

- **Storage não copiado.** Os 405 arquivos do `dute-btg.firebasestorage.app`
  são sobras de antes da zeragem e nenhum documento aponta para eles; ficam lá
  até o `dute-btg` ser apagado.
- **Troca de bucket vazia.** Nenhum link de foto ou anexo no banco
  (`trocar-bucket`: 0 documentos).
- **Sem congelamento antes da cópia.** De madrugada, sem uso, o inventário antes
  e depois do export bastou para provar a cópia exata.

Feito, com o OK do Leonardo:

| Hora (UTC) | Passo | Resultado |
|---|---|---|
| 03:07 | PR #104 mergeado; regras e índices da `main` no `dute-prod` | ok |
| 03:10–03:21 | `publicar_dute_prod` (execução 39362881155) | frontend e as 69 functions publicados; invoker de cada callable conferido |
| 03:17–03:19 | Export do `dute-btg` (`gs://dute-prod-migracao/corte-20261020`) e import no `dute-prod` | 476 documentos; `dute-btg` igual antes e depois; `dute-prod` "Iguais." ao `dute-btg` |
| 03:20 | Contas | 6 de 6 com a senha de antes |
| 03:23 | `dute-btg` de novo contra o export | "Iguais.": nada gravou depois da cópia |
| — | Leonardo entrou com a senha de antes pelo `run.app` do `dute-prod` | ok |
| 03:27–03:38 | `congelar_projeto.ps1 -ProjectId dute-btg -Apply` | "CONGELAR concluido": regras de manutenção, rotina pausada, 68 callables sem invocação pública (403) |
| 03:38 | `dute-btg` congelado contra o export | "Iguais." |
| 03:39 | Hostinger, registro `app` (A) de `8.232.54.179` para `34.54.243.247`, TTL 300 | só esse registro mudou (zona antes e depois em `.secrets\fase-1\dns-zona-*-app.json`) |
| 03:41 | Conferência | servidor da Hostinger, Google e Cloudflare respondem o IP novo; `https://app.dutelog.com.br` 200 com o certificado do Certificate Manager e o mesmo build do `dute-app` (configuração do `dute-prod`) |

### Site institucional (passo 9), 20/10/2026

Feito depois, com o OK do Leonardo a cada passo. Zona antes e depois de cada
mudança em `.secrets\fase-1\dns-zona-*-site-ttl.json` e `dns-zona-*-site.json`.

| Hora (UTC) | Passo | Resultado |
|---|---|---|
| — | Conferência pelo IP novo (`curl --resolve`) | `dutelog.com.br` e `www` 200 em `34.54.243.247`, certificado do Certificate Manager válido até 18/01/2027; página igual byte a byte à do IP antigo; `dutelog-site` com a mesma imagem nos dois projetos |
| 04:16 | Hostinger, TTL do `@` (A) de 1800 para 300, mesmo IP | só esse registro mudou; os servidores da Hostinger alternaram entre 300 e 1800 por mais de 20 minutos |
| 09:43 | Hostinger, registro `@` (A) de `8.232.54.179` para `34.54.243.247`, TTL 300 | só esse registro mudou; nenhum registro da zona aponta mais para `8.232.54.179` |
| 09:44 | Conferência | servidores da Hostinger, Google, Cloudflare, Quad9 e OpenDNS respondem o IP novo; `https://dutelog.com.br` e `https://www.dutelog.com.br` 200 pelo `dute-prod`, com o certificado do Certificate Manager, a mesma página e os recursos dela |

Com isso o `dute-btg` não serve mais nada. O Load Balancer antigo segue no ar só
como caminho da volta (seção "Volta").

## Histórico

| Data | O quê |
|---|---|
| 19/10/2026 | Ensaio na homologação (tabela acima), `dute-prod` preparado, CNAMEs criados na Hostinger, certificados ativos e Load Balancer novo testado pelo IP |
| 20/10/2026 | Corte antes da contagem de abertura: `app.dutelog.com.br` no `dute-prod` desde 03:39 UTC, `dute-btg` congelado (seção acima) |
| 20/10/2026 | Site institucional (`dutelog.com.br` e `www`) no `dute-prod` desde 09:43 UTC; o `dute-btg` não serve mais nada |
| 20/10/2026 | Firestore do `dute-prod` com PITR de 7 dias e backup diário de 14 dias desde 14:28 UTC; antes disso, a única cópia é o export do corte (`docs/plataforma/backup-e-recuperacao.md`) |
