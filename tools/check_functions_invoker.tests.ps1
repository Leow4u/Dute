# Testes do check_functions_invoker.ps1 sem tocar no Google Cloud: as APIs
# do Google de mentira respondem como as reais. Rode com:
#   pwsh -NoProfile -File tools/check_functions_invoker.tests.ps1

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "check_functions_invoker.ps1"
$failures = 0
$fakeRepos = @()

function New-FakeIndex([string[]]$names) {
  $file = New-TemporaryFile
  $names | ForEach-Object { "export const $_ = onCall(async (request) => {" } | Set-Content $file
  return $file.FullName
}

# Monta um repositorio de mentira com firebase.json e um src/index.ts por
# codebase, em functions/<codebase>. Valor $null: a codebase nao tem
# src/index.ts. Lista vazia: tem index.ts, mas nenhuma callable.
function New-FakeRepo($codebases) {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("invoker-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $root | Out-Null
  $script:fakeRepos += $root
  $functions = @()
  foreach ($codebase in $codebases.Keys) {
    $source = "functions/$codebase"
    $functions += [ordered]@{ source = $source; codebase = $codebase; runtime = "nodejs22" }
    $names = $codebases[$codebase]
    if ($null -eq $names) { continue }
    $src = Join-Path $root "$source/src"
    New-Item -ItemType Directory -Path $src -Force | Out-Null
    $lines = @('import { onCall } from "firebase-functions/v2/https";', 'export const versao = "1";')
    $lines += @($names | ForEach-Object { "export const $_ = onCall(async (request) => {" })
    $lines | Set-Content (Join-Path $src "index.ts")
  }
  $firebaseJson = Join-Path $root "firebase.json"
  @{ functions = $functions } | ConvertTo-Json -Depth 5 | Set-Content $firebaseJson
  return $firebaseJson
}

# Troca o src/index.ts de uma codebase do repositorio de mentira por linhas
# escritas a mao (tipo generico, declaracao quebrada em duas linhas).
function Set-FakeIndex([string]$firebaseJson, [string]$codebase, [string[]]$lines) {
  $src = Join-Path (Split-Path -Parent $firebaseJson) "functions/$codebase/src"
  New-Item -ItemType Directory -Path $src -Force | Out-Null
  $lines | Set-Content (Join-Path $src "index.ts")
}

# Simula as APIs REST do Google como as reais (listagens paginadas e
# getIamPolicy do Cloud Run), pelo -GcpGet do script:
# - publica: politica com allUsers/roles/run.invoker;
# - privada: politica sem o invoker (servico existe);
# - naoPublicada: fora da listagem dos servicos e das functions.
# - falhou: o servico do Cloud Run existe (politica sem invoker), mas a
#   function ficou FAILED no deploy (02/10/2026, primeiro deploy das rotinas,
#   com a API do Cloud Scheduler desligada). Minutos depois o servico sumiu.
# - semEstado: a function nao aparece na listagem das functions; o script nao
#   pode reprovar so por isso.
# - fantasma: nunca foi publicada (02/10/2026, deploy do painel do sistema
#   parou no timeout de descoberta), mas a politica responde vazia com etag
#   como se o servico existisse. So a listagem dos servicos diz a verdade.
# - sumiu: esta na listagem, mas a politica responde 404 (o servico saiu entre
#   uma chamada e outra).
# - negada: a politica responde 403 (conta sem permissao).
# - instavel: a politica responde 503 na primeira vez e publica depois.
# - outroPapel: allUsers num papel e o invoker para outra conta.
# - aprovaProposta: publica, para a segunda codebase (comercial).
$publicPolicy = '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}'

function Reset-FakeGcp {
  $global:gcpCalls = @()
  $global:fakeGcp = @{
    Services = @("publica", "semestado", "privada", "falhou", "aprovaproposta", "sumiu", "negada", "instavel", "outropapel")
    Functions = @{
      publica = "ACTIVE"; privada = "ACTIVE"; falhou = "FAILED"; aprovaProposta = "ACTIVE"
      sumiu = "ACTIVE"; negada = "ACTIVE"; instavel = "ACTIVE"; outroPapel = "ACTIVE"
    }
    Policies = @{
      publica = $publicPolicy; semestado = $publicPolicy; aprovaproposta = $publicPolicy; instavel = $publicPolicy
      privada = '{"etag":"ACAB"}'; falhou = '{"etag":"ACAB"}'; fantasma = '{"etag":"ACAB"}'
      outropapel = '{"bindings":[{"members":["allUsers"],"role":"roles/run.viewer"},{"members":["serviceAccount:x@y.iam.gserviceaccount.com"],"role":"roles/run.invoker"}],"etag":"BwY"}'
    }
    PolicyStatus = @{ sumiu = 404; negada = 403 }
    ServicesStatus = 200
    FunctionsStatus = 200
    PageSize = 1000
    Flaky = @{ instavel = 1 }
  }
}

# Uma pagina de uma listagem, no formato das APIs v2 (name com o caminho todo).
function Get-FakePage([string]$url, [string]$kind, $entries) {
  $offset = 0
  if ($url -match "pageToken=(\d+)") { $offset = [int]$Matches[1] }
  $size = $global:fakeGcp.PageSize
  $page = @($entries | Select-Object -Skip $offset -First $size)
  $body = @{ $kind = $page }
  if ($offset + $size -lt @($entries).Count) { $body.nextPageToken = "$($offset + $size)" }
  return @{ Status = 200; Json = ($body | ConvertTo-Json -Depth 5 | ConvertFrom-Json) }
}

$fakeGcpGet = {
  param([string]$Url)
  $global:gcpCalls += $Url
  $fake = $global:fakeGcp
  if ($Url -match "^https://run\.googleapis\.com/v2/projects/[^/]+/locations/[^/]+/services\?pageSize=\d+") {
    if ($fake.ServicesStatus -ne 200) { return @{ Status = $fake.ServicesStatus; Json = $null } }
    $entries = @($fake.Services | ForEach-Object { @{ name = "projects/p/locations/r/services/$_" } })
    return Get-FakePage $Url "services" $entries
  }
  if ($Url -match "^https://cloudfunctions\.googleapis\.com/v2/projects/[^/]+/locations/[^/]+/functions\?pageSize=\d+") {
    if ($fake.FunctionsStatus -ne 200) { return @{ Status = $fake.FunctionsStatus; Json = $null } }
    $entries = @($fake.Functions.Keys | Sort-Object | ForEach-Object {
      @{ name = "projects/p/locations/r/functions/$_"; state = $fake.Functions[$_] }
    })
    return Get-FakePage $Url "functions" $entries
  }
  if ($Url -match "^https://run\.googleapis\.com/v2/projects/[^/]+/locations/[^/]+/services/([a-z0-9-]+):getIamPolicy$") {
    $service = $Matches[1]
    if ($fake.Flaky.ContainsKey($service) -and $fake.Flaky[$service] -gt 0) {
      $fake.Flaky[$service]--
      return @{ Status = 503; Json = $null }
    }
    if ($fake.PolicyStatus.ContainsKey($service)) { return @{ Status = $fake.PolicyStatus[$service]; Json = $null } }
    if (-not $fake.Policies.ContainsKey($service)) { return @{ Status = 404; Json = $null } }
    return @{ Status = 200; Json = ($fake.Policies[$service] | ConvertFrom-Json) }
  }
  throw "URL inesperada: $Url"
}

# Com -GcpGet o script nao pode chamar o gcloud.
function global:gcloud { throw "gcloud chamado: $args" }

function Run-Check([string[]]$names) {
  return Invoke-Check @{ IndexFile = (New-FakeIndex $names) }
}

# Erro do script vira falha do caso, sem derrubar os outros. Cada caso comeca
# com as APIs de mentira no estado padrao; -Fake muda algo antes de rodar.
function Invoke-Check([hashtable]$params, [scriptblock]$Fake, [switch]$RealApi) {
  Reset-FakeGcp
  if ($Fake) { & $Fake }
  if (-not $RealApi) { $params.GcpGet = $fakeGcpGet }
  try {
    $output = & $script @params *>&1 | Out-String
    return @{ Output = $output; Exit = $global:LASTEXITCODE }
  } catch {
    return @{ Output = $_.ToString(); Exit = $null }
  }
}

# Sem -IndexFile: as codebases vem do firebase.json.
function Run-CheckCodebases($codebases) {
  return Invoke-Check @{ FirebaseJson = (New-FakeRepo $codebases) }
}

function Expect([string]$name, [bool]$condition, [string]$detail) {
  if ($condition) { Write-Host "ok   $name" }
  else { Write-Host "FAIL $name`n$detail" -ForegroundColor Red; $script:failures++ }
}

$result = Run-Check @("publica")
Expect "todas publicas passam" ($result.Exit -eq 0 -and $result.Output -match "OK: as 1 callable") $result.Output

$result = Run-Check @("publica", "privada")
Expect "sem invoker falha e sugere add-iam-policy-binding" (
  $result.Exit -eq 1 -and $result.Output -match "FALTA\s+privada" -and $result.Output -match "add-iam-policy-binding privada"
) $result.Output

$result = Run-Check @("publica", "naoPublicada")
Expect "nao publicada falha e sugere firebase deploy, nao add-iam-policy-binding" (
  $result.Exit -eq 1 -and
  $result.Output -match "NAO PUBLICADA\s+naopublicada" -and
  $result.Output -match "firebase deploy --only functions:naoPublicada" -and
  $result.Output -notmatch "add-iam-policy-binding naopublicada"
) $result.Output

$result = Run-Check @("publica", "falhou")
Expect "function com deploy falho conta como nao publicada, nao como falta de invoker" (
  $result.Exit -eq 1 -and
  $result.Output -match "NAO PUBLICADA\s+falhou.*FAILED" -and
  $result.Output -match "firebase deploy --only functions:falhou" -and
  $result.Output -notmatch "add-iam-policy-binding falhou"
) $result.Output

$result = Run-Check @("publica", "fantasma")
Expect "servico inexistente com politica vazia conta como nao publicada" (
  $result.Exit -eq 1 -and
  $result.Output -match "NAO PUBLICADA\s+fantasma" -and
  $result.Output -match "firebase deploy --only functions:fantasma" -and
  $result.Output -notmatch "add-iam-policy-binding fantasma"
) $result.Output

$result = Run-Check @("publica", "semEstado")
Expect "function fora da listagem das functions decide pela politica" ($result.Exit -eq 0 -and $result.Output -match "OK: as 2 callable") $result.Output

# Varias codebases no firebase.json (Comercial, Fase 6).
$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = @("aprovaProposta") })
Expect "duas codebases com invoker passam" ($result.Exit -eq 0 -and $result.Output -match "OK: as 2 callable") $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = @("privada") })
Expect "segunda codebase sem invoker falha citando a codebase" (
  $result.Exit -eq 1 -and
  $result.Output -match "FALTA\s+comercial: privada" -and
  $result.Output -match "add-iam-policy-binding privada"
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica", "falhou"); comercial = @("naoPublicada") })
Expect "nao publicada sugere o deploy pela codebase certa" (
  $result.Exit -eq 1 -and
  $result.Output -match "NAO PUBLICADA\s+comercial: naopublicada" -and
  $result.Output -match "firebase deploy --only functions:falhou,functions:comercial:naoPublicada "
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = @("publica") })
Expect "mesma callable em duas codebases falha" (
  $result.Exit -eq 1 -and
  $result.Output -match "default: publica" -and
  $result.Output -match "comercial: publica" -and
  $result.Output -notmatch "OK: as"
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = @("Publica") })
Expect "nomes que viram o mesmo servico do Cloud Run falham" (
  $result.Exit -eq 1 -and $result.Output -match "comercial: Publica" -and $result.Output -notmatch "OK: as"
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = $null })
Expect "codebase sem src/index.ts falha" (
  $result.Exit -eq 1 -and
  $result.Output -match "comercial" -and
  $result.Output -match "functions/comercial/src/index\.ts" -and
  $result.Output -notmatch "OK: as"
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @("publica"); comercial = @() })
Expect "codebase sem callable avisa e nao reprova sozinha" (
  $result.Exit -eq 0 -and
  $result.Output -match "AVISO\s+comercial" -and
  $result.Output -match "OK: as 1 callable"
) $result.Output

$result = Run-CheckCodebases ([ordered]@{ default = @(); comercial = @() })
Expect "nenhuma callable em nenhuma codebase falha" (
  $result.Exit -eq 1 -and $result.Output -match "Nenhuma function onCall"
) $result.Output

$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica") })
'{ "functions": { "source": "functions/default" } }' | Set-Content $firebaseJson
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "functions como objeto unico vale como codebase default" (
  $result.Exit -eq 0 -and $result.Output -match "default: 1 callable" -and $result.Output -match "OK: as 1 callable"
) $result.Output

$result = Invoke-Check @{ FirebaseJson = (Join-Path ([System.IO.Path]::GetTempPath()) "nao-existe-$([guid]::NewGuid()).json") }
Expect "firebase.json inexistente falha" ($result.Exit -eq 1 -and $result.Output -match "Nao encontrei") $result.Output

$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica") })
'{ "functions": [ { "source": "functions/default"' | Set-Content $firebaseJson
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "firebase.json invalido falha com mensagem clara" (
  $result.Exit -eq 1 -and $result.Output -match "nao e um JSON valido" -and $result.Output -notmatch "OK: as"
) $result.Output

# Entrada sem source (ex.: remoteSource): nao ha index.ts para ler.
$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica") })
'{ "functions": [ { "source": "functions/default", "codebase": "default" }, { "codebase": "comercial" } ] }' |
  Set-Content $firebaseJson
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "codebase sem source falha" (
  $result.Exit -eq 1 -and $result.Output -match "comercial: sem source" -and $result.Output -notmatch "OK: as"
) $result.Output

# Com prefix, o firebase deploy publica <prefix>-<nome>; o script conferiria o
# servico errado. Reprova antes de consultar o Cloud Run.
$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica"); comercial = @("aprovaProposta") })
'{ "functions": [ { "source": "functions/default", "codebase": "default" }, { "source": "functions/comercial", "codebase": "comercial", "prefix": "com" } ] }' |
  Set-Content $firebaseJson
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "codebase com prefix falha antes de consultar o Cloud Run" (
  $result.Exit -eq 1 -and
  $result.Output -match "comercial: prefix" -and
  $result.Output -notmatch "NAO PUBLICADA" -and
  $result.Output -notmatch "OK: as"
) $result.Output

# onCall<Tipo>( tambem e callable e precisa ser conferida.
$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica"); comercial = @() })
Set-FakeIndex $firebaseJson "comercial" @(
  'import { onCall } from "firebase-functions/v2/https";',
  'export const aprovaProposta = onCall<AprovarPropostaInput>(async (request) => {'
)
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "callable com tipo generico tambem e conferida" (
  $result.Exit -eq 0 -and $result.Output -match "comercial: 1 callable" -and $result.Output -match "OK: as 2 callable"
) $result.Output

# Declaracao que o padrao nao le nao pode passar com AVISO e exit 0.
$firebaseJson = New-FakeRepo ([ordered]@{ default = @("publica"); comercial = @() })
Set-FakeIndex $firebaseJson "comercial" @(
  'import { onCall } from "firebase-functions/v2/https";',
  'export const aprovaProposta =',
  '  onCall(async (request) => {'
)
$result = Invoke-Check @{ FirebaseJson = $firebaseJson }
Expect "onCall fora do padrao falha em vez de passar sem conferir" (
  $result.Exit -eq 1 -and
  $result.Output -match "comercial: onCall fora do padrao em functions/comercial/src/index\.ts:3" -and
  $result.Output -notmatch "OK: as"
) $result.Output

# Sem parametros, como no publicar.yml: le o firebase.json da raiz do repo.
# Aqui toda callable do codigo esta publicada, ativa e com invoker.
$repoRoot = Split-Path -Parent $PSScriptRoot
$realNames = @(Get-ChildItem (Join-Path $repoRoot "functions/*/src/index.ts") |
  Select-String -Pattern '^export const (\w+) = onCall(<.*>)?\(' |
  ForEach-Object { $_.Matches[0].Groups[1].Value })
$result = Invoke-Check @{} -Fake {
  $global:fakeGcp.Services = @($realNames | ForEach-Object { $_.ToLower() })
  $global:fakeGcp.Functions = @{}
  $realNames | ForEach-Object { $global:fakeGcp.Functions[$_] = "ACTIVE"; $global:fakeGcp.Policies[$_.ToLower()] = $publicPolicy }
}
Expect "sem parametros le as codebases do firebase.json da raiz" (
  $result.Exit -eq 0 -and
  $result.Output -match "default: \d+ callable\(s\) em functions/wms/src/index\.ts" -and
  $result.Output -match "OK: as $($realNames.Count) callable"
) $result.Output

# 23/10/2026: eram 3 chamadas ao gcloud por callable (7 min com 95). Agora
# sao duas listagens e uma politica por callable, sem abrir o gcloud.
$result = Run-Check @("publica", "privada", "aprovaProposta")
Expect "consulta em lote: duas listagens e uma politica por callable" (
  $result.Exit -eq 1 -and
  $global:gcpCalls.Count -eq 5 -and
  @($global:gcpCalls | Where-Object { $_ -match "/services\?pageSize=" }).Count -eq 1 -and
  @($global:gcpCalls | Where-Object { $_ -match "/functions\?pageSize=" }).Count -eq 1 -and
  @($global:gcpCalls | Where-Object { $_ -match ":getIamPolicy$" }).Count -eq 3
) ($result.Output + "`nchamadas:`n" + ($global:gcpCalls -join "`n"))

$result = Run-Check @("publica", "naoPublicada", "falhou")
Expect "nao publicada e deploy falho nao leem a politica" (
  $result.Exit -eq 1 -and
  @($global:gcpCalls | Where-Object { $_ -match ":getIamPolicy$" }).Count -eq 1
) ($result.Output + "`nchamadas:`n" + ($global:gcpCalls -join "`n"))

$result = Invoke-Check @{ IndexFile = (New-FakeIndex @("publica", "aprovaProposta", "privada")) } -Fake { $global:fakeGcp.PageSize = 2 }
Expect "listagens com mais de uma pagina sao lidas inteiras" (
  $result.Exit -eq 1 -and
  $result.Output -match "OK\s+publica" -and
  $result.Output -match "OK\s+aprovaproposta" -and
  $result.Output -match "FALTA\s+privada" -and
  $result.Output -notmatch "NAO PUBLICADA"
) $result.Output

$result = Run-Check @("publica", "sumiu")
Expect "politica com 404 conta como nao publicada" (
  $result.Exit -eq 1 -and
  $result.Output -match "NAO PUBLICADA\s+sumiu" -and
  $result.Output -match "firebase deploy --only functions:sumiu"
) $result.Output

$result = Run-Check @("publica", "negada")
Expect "politica com 403 falha como erro de leitura, nao como nao publicada" (
  $result.Exit -eq 1 -and
  $result.Output -match "ERRO\s+negada.*HTTP 403" -and
  $result.Output -match "run\.services\.getIamPolicy" -and
  $result.Output -notmatch "NAO PUBLICADA" -and
  $result.Output -notmatch "add-iam-policy-binding negada"
) $result.Output

$result = Run-Check @("publica", "instavel")
Expect "503 na politica tenta de novo" ($result.Exit -eq 0 -and $result.Output -match "OK: as 2 callable") $result.Output

$result = Run-Check @("publica", "outroPapel")
Expect "allUsers em outro papel nao vale como invoker publico" (
  $result.Exit -eq 1 -and $result.Output -match "FALTA\s+outropapel"
) $result.Output

$result = Invoke-Check @{ IndexFile = (New-FakeIndex @("publica")) } -Fake { $global:fakeGcp.ServicesStatus = 403 }
Expect "sem a listagem dos servicos falha sem conferir nada" (
  $result.Exit -eq 1 -and
  $result.Output -match "nao consegui listar os servicos do Cloud Run.*HTTP 403" -and
  $result.Output -notmatch "OK\s+publica"
) $result.Output

$result = Invoke-Check @{ IndexFile = (New-FakeIndex @("publica", "falhou")) } -Fake { $global:fakeGcp.FunctionsStatus = 403 }
Expect "sem a listagem das functions avisa e vale a politica" (
  $result.Exit -eq 1 -and
  $result.Output -match "AVISO: nao consegui listar as functions" -and
  $result.Output -match "OK\s+publica" -and
  $result.Output -match "FALTA\s+falhou"
) $result.Output

# Caminho real (sem -GcpGet): token do gcloud uma vez e Invoke-WebRequest com
# Bearer. O gcloud e o Invoke-WebRequest de mentira respondem como os reais.
function global:gcloud {
  $global:gcloudCalls += "$args"
  if ("$args" -eq "auth print-access-token") { "tok-123" }
}
function global:Invoke-WebRequest {
  param([string]$Uri, $Headers, [switch]$UseBasicParsing, $TimeoutSec, $ErrorAction)
  if ($Headers.Authorization -ne "Bearer tok-123") { throw "sem o token" }
  if (-not $TimeoutSec) { throw "sem tempo limite" }
  $response = & $fakeGcpGet $Uri
  if ($response.Status -ne 200) {
    $message = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]$response.Status)
    throw [Microsoft.PowerShell.Commands.HttpResponseException]::new("HTTP $($response.Status)", $message)
  }
  [pscustomobject]@{ StatusCode = 200; Content = ($response.Json | ConvertTo-Json -Depth 10) }
}
$global:gcloudCalls = @()
$result = Invoke-Check @{ IndexFile = (New-FakeIndex @("publica", "negada", "naoPublicada")) } -RealApi
Expect "caminho real: um token do gcloud e o codigo HTTP dos erros" (
  $result.Exit -eq 1 -and
  $global:gcloudCalls.Count -eq 1 -and
  $result.Output -match "OK\s+publica" -and
  $result.Output -match "ERRO\s+negada.*HTTP 403" -and
  $result.Output -match "NAO PUBLICADA\s+naopublicada"
) ($result.Output + "`ngcloud:`n" + ($global:gcloudCalls -join "`n"))

function global:gcloud { }
$result = Invoke-Check @{ IndexFile = (New-FakeIndex @("publica")) } -RealApi
Expect "sem token do gcloud falha pedindo login" (
  $result.Exit -eq 1 -and $result.Output -match "gcloud auth login"
) $result.Output
Remove-Item function:global:Invoke-WebRequest

$fakeRepos | ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force -ErrorAction SilentlyContinue }

if ($failures -gt 0) { Write-Host "$failures teste(s) falharam." -ForegroundColor Red; exit 1 }
Write-Host "Todos os testes passaram." -ForegroundColor Green
# O último caso testado sai com 1 de propósito; o runner do CI usa o
# $LASTEXITCODE final como resultado do passo.
exit 0
