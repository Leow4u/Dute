param(
  [string]$ProjectId = "dute-prod",
  [string]$Region = "southamerica-east1",
  [string]$IndexFile,
  [string]$FirebaseJson = (Join-Path (Split-Path -Parent $PSScriptRoot) "firebase.json"),
  # So para os testes: recebe uma URL das APIs do Google e devolve
  # @{ Status = <codigo HTTP, 0 sem resposta>; Json = <corpo> }.
  [scriptblock]$GcpGet
)

# Incidente de 03/09/2026: createCustomerRequest, decideCustomerRequest e
# advanceWarehouseTask ficaram sem roles/run.invoker para allUsers (provavel
# falha silenciosa num "firebase deploy --only functions" anterior). Toda
# chamada dessas callables era rejeitada na borda do Cloud Run, antes do
# codigo rodar, e o SDK do Firebase traduzia isso para o mesmo erro generico
# de qualquer excecao nao tratada (Falha interna no servidor) - sem pista
# nenhuma de que era uma permissao de infraestrutura, nao um bug de codigo.
#
# Este script compara cada callable exportada no src/index.ts de cada
# codebase do firebase.json com o Cloud Run real e falha (exit 1) se alguma
# estiver sem invocacao publica ou se nem tiver sido publicada. Rode depois
# de qualquer deploy de functions. Com -IndexFile, le so aquele arquivo.
# Ver docs/deploy-functions-manual.md. Testes: check_functions_invoker.tests.ps1.
#
# 01/10/2026: cancelShipmentNotice nao subiu no deploy e o script disse
# "FALTA ... sem invoker"; o add-iam-policy-binding sugerido respondeu
# NOT_FOUND. No Windows o gcloud nem sempre devolve exit code de erro, entao
# "existe?" e decidido pela saida: politica de servico existente sempre traz
# pelo menos o etag; servico inexistente nao imprime nada.
#
# 02/10/2026: no primeiro deploy das rotinas (API do Cloud Scheduler
# desligada) as 4 callables novas ficaram com deploy falho: o servico do
# Cloud Run existia, sem invoker, e o script disse "FALTA"; minutos depois o
# servico sumiu e o add-iam-policy-binding respondeu NOT_FOUND. Agora o
# estado da function (gcloud functions describe) tambem conta: diferente de
# ACTIVE e "NAO PUBLICADA", com o firebase deploy certo. Se o describe nao
# responder, vale so a politica, como antes.
#
# 02/10/2026 (painel do sistema): o deploy parou no timeout de descoberta e
# as 2 callables novas nem foram criadas, mas o get-iam-policy devolveu uma
# politica vazia com etag e o script disse "FALTA"; o add-iam-policy-binding
# respondeu NOT_FOUND. A existencia agora vem do "run services describe",
# que nao imprime nada quando o servico nao existe.
#
# 20/10/2026 (Comercial, Fase 6): o modulo novo nasce em functions/comercial,
# com codebase propria. Sem -IndexFile, o script le todas as codebases do
# firebase.json. Reprova se o src/index.ts de uma delas nao existe ou se a
# mesma callable aparece em duas: o servico do Cloud Run e o nome em
# minusculas, sem a codebase, e uma sobrescreveria a outra. Codebase sem
# callable so avisa. Fora da codebase default, o firebase deploy precisa de
# functions:<codebase>:<nome>; functions:<nome> procura o nome na default,
# a menos que <nome> seja uma codebase (ai publica a codebase inteira).
# Tambem reprova: codebase com prefix (o servico viraria <prefix>-<nome> e o
# script conferiria o nome errado) e linha com onCall( ou onCall<...>( que o
# padrao nao le (sem isso ela passaria sem conferencia, so com AVISO).
#
# 23/10/2026: o script chamava o gcloud 3 vezes por callable, uma depois da
# outra (run services describe, get-iam-policy e functions describe). Com 95
# callables eram 285 chamadas de ~1,5 s (o gcloud demora para abrir): 7 min
# em toda publicacao. Agora pede um token ao gcloud uma vez e le as APIs REST,
# como o painel do sistema (functions/wms/src/domain/system-infra.ts): uma
# listagem dos servicos do Cloud Run, uma das functions e a politica de cada
# callable. Os criterios sao os mesmos: fora da listagem dos servicos e
# NAO PUBLICADA (o caso do painel do sistema acima), estado diferente de
# ACTIVE tambem, e sem a listagem das functions vale so a politica. Erro HTTP
# ao ler uma politica (permissao, por exemplo) falha como erro de leitura, nao
# como NAO PUBLICADA. Continua rodando no Windows PowerShell 5.1.

$ErrorActionPreference = "Continue"
$callablePattern = '^export const (\w+) = onCall(<.*>)?\('
$onCallUsePattern = '\bonCall\s*[<(]'

function Get-Callables([string]$file) {
  @(Select-String -LiteralPath $file -Pattern $callablePattern |
    ForEach-Object { $_.Matches[0].Groups[1].Value })
}

# Linhas que usam onCall mas nao seguem o padrao: o script nao as enxergaria.
function Get-UnreadOnCallLines([string]$file) {
  @(Select-String -LiteralPath $file -Pattern $onCallUsePattern -CaseSensitive |
    Where-Object { $_.Line -notmatch $callablePattern } |
    ForEach-Object { $_.LineNumber })
}

# "comercial: approvequote", ou so o servico quando nao ha codebase (-IndexFile).
function Get-Label($callable) {
  if ($callable.Codebase) { "$($callable.Codebase): $($callable.Service)" } else { $callable.Service }
}

function Get-DeployTarget($callable) {
  if ($callable.Codebase -and $callable.Codebase -ne "default") {
    "functions:$($callable.Codebase):$($callable.Name)"
  } else {
    "functions:$($callable.Name)"
  }
}

$callables = @()
if ($IndexFile) {
  if (-not (Test-Path -LiteralPath $IndexFile)) {
    Write-Host "Nao encontrei $IndexFile." -ForegroundColor Red
    exit 1
  }
  Write-Host "Lendo callables exportadas de $IndexFile ..."
  $callables = @(Get-Callables $IndexFile | ForEach-Object {
    [pscustomobject]@{ Name = $_; Service = $_.ToLower(); Codebase = $null }
  })
} else {
  if (-not (Test-Path -LiteralPath $FirebaseJson)) {
    Write-Host "Nao encontrei $FirebaseJson." -ForegroundColor Red
    exit 1
  }
  $root = Split-Path -Parent (Resolve-Path -LiteralPath $FirebaseJson).Path
  try {
    $config = Get-Content -LiteralPath $FirebaseJson -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Write-Host "$FirebaseJson nao e um JSON valido: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
  # "functions" pode ser uma lista de codebases ou um objeto so (a default).
  $codebases = @($config.functions | Where-Object { $_ })
  if ($codebases.Count -eq 0) {
    Write-Host "Nenhuma codebase em functions no $FirebaseJson." -ForegroundColor Red
    exit 1
  }

  Write-Host "Lendo callables das $($codebases.Count) codebase(s) de $FirebaseJson ..."
  $problems = @()
  $owners = @{}
  foreach ($entry in $codebases) {
    $codebase = if ($entry.codebase) { $entry.codebase } else { "default" }
    if (-not $entry.source) {
      $problems += "${codebase}: sem source no firebase.json"
      continue
    }
    if ($entry.prefix) {
      $problems += "${codebase}: prefix '$($entry.prefix)' nao suportado por este script (o servico viraria $($entry.prefix)-<nome>)"
      continue
    }
    $source = $entry.source.TrimEnd("/", "\")
    $index = [System.IO.Path]::Combine($root, $source, "src", "index.ts")
    if (-not (Test-Path -LiteralPath $index)) {
      $problems += "${codebase}: nao encontrei $source/src/index.ts"
      continue
    }
    foreach ($line in (Get-UnreadOnCallLines $index)) {
      $problems += "${codebase}: onCall fora do padrao em $source/src/index.ts:$line (declare como export const nome = onCall( numa linha so)"
    }
    $names = @(Get-Callables $index)
    if ($names.Count -eq 0) {
      Write-Host "AVISO ${codebase}: nenhuma callable em $source/src/index.ts" -ForegroundColor Yellow
      continue
    }
    Write-Host "  ${codebase}: $($names.Count) callable(s) em $source/src/index.ts"
    foreach ($name in $names) {
      $service = $name.ToLower()
      if ($owners.ContainsKey($service)) {
        $problems += "callable repetida: $($owners[$service]) e ${codebase}: $name viram o mesmo servico $service no Cloud Run"
        continue
      }
      $owners[$service] = "${codebase}: $name"
      $callables += [pscustomobject]@{ Name = $name; Service = $service; Codebase = $codebase }
    }
  }

  if ($problems.Count -gt 0) {
    Write-Host ""
    Write-Host "FALHOU: o firebase.json e o codigo das functions nao batem. Nada foi conferido no Cloud Run." -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
  }
}

if ($callables.Count -eq 0) {
  Write-Host "Nenhuma function onCall encontrada - verifique o padrao/caminho." -ForegroundColor Red
  exit 1
}

if (-not $GcpGet) {
  # O Windows PowerShell 5.1 nem sempre liga o TLS 1.2.
  if ($PSVersionTable.PSEdition -eq "Desktop") {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }
  $token = (gcloud auth print-access-token 2>$null | Out-String).Trim()
  if (-not $token) {
    Write-Host "Nao consegui um token do gcloud (gcloud auth print-access-token). Rode gcloud auth login e tente de novo." -ForegroundColor Red
    exit 1
  }
  $GcpGet = {
    param([string]$Url)
    # Sem isso o 5.1 desenha a barra de progresso a cada chamada e fica varias
    # vezes mais lento. Fica aqui dentro: o GetNewClosure tem escopo proprio.
    $ProgressPreference = "SilentlyContinue"
    try {
      $response = Invoke-WebRequest -Uri $Url -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
      @{ Status = [int]$response.StatusCode; Json = ($response.Content | ConvertFrom-Json) }
    } catch {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      @{ Status = $status; Json = $null }
    }
  }.GetNewClosure()
}

# 429, 5xx e falha de rede: tenta de novo, ate 3 vezes.
function Invoke-GcpGet([string]$url) {
  for ($attempt = 1; ; $attempt++) {
    $response = & $GcpGet $url
    $transient = $response.Status -eq 0 -or $response.Status -eq 429 -or $response.Status -ge 500
    if (-not $transient -or $attempt -ge 3) { return $response }
    Start-Sleep -Milliseconds (500 * $attempt)
  }
}

# Todas as paginas de uma listagem, pelo nome curto (ultimo pedaco de "name").
function Get-Listing([string]$url, [string]$field) {
  $items = @{}
  $pageToken = ""
  for ($page = 0; $page -lt 20; $page++) {
    $pageUrl = $url
    if ($pageToken) { $pageUrl = "$url&pageToken=$([uri]::EscapeDataString($pageToken))" }
    $response = Invoke-GcpGet $pageUrl
    if ($response.Status -ne 200) { return @{ Status = $response.Status; Items = $null } }
    foreach ($item in @($response.Json.$field | Where-Object { $_ })) {
      $items[($item.name -split "/")[-1]] = $item
    }
    $pageToken = $response.Json.nextPageToken
    if (-not $pageToken) { break }
  }
  return @{ Status = 200; Items = $items }
}

$runApi = "https://run.googleapis.com/v2/projects/$ProjectId/locations/$Region"
$functionsApi = "https://cloudfunctions.googleapis.com/v2/projects/$ProjectId/locations/$Region"

Write-Host "$($callables.Count) callables encontradas. Verificando roles/run.invoker (allUsers) em cada Cloud Run service..."
Write-Host ""

$services = Get-Listing "$runApi/services?pageSize=50" "services"
if ($services.Status -ne 200) {
  Write-Host "FALHOU: nao consegui listar os servicos do Cloud Run de $ProjectId (HTTP $($services.Status)). Nada foi conferido." -ForegroundColor Red
  exit 1
}
$functions = Get-Listing "$functionsApi/functions?pageSize=50" "functions"
if ($functions.Status -ne 200) {
  Write-Host "AVISO: nao consegui listar as functions de $ProjectId (HTTP $($functions.Status)); vale so a politica de cada servico." -ForegroundColor Yellow
}

$missing = @()
$notFound = @()
$unreadable = @()

foreach ($callable in $callables) {
  $fn = $callable.Name
  $service = $callable.Service
  $label = Get-Label $callable
  if (-not $services.Items.ContainsKey($service)) {
    Write-Host "NAO PUBLICADA $label - nao existe no Cloud Run" -ForegroundColor Red
    $notFound += $callable
    continue
  }
  $state = $null
  if ($functions.Items -and $functions.Items.ContainsKey($fn)) { $state = $functions.Items[$fn].state }
  if ($state -and $state -ne "ACTIVE") {
    Write-Host "NAO PUBLICADA $label - deploy nao terminou (estado $state)" -ForegroundColor Red
    $notFound += $callable
    continue
  }
  $policy = Invoke-GcpGet "$runApi/services/${service}:getIamPolicy"
  if ($policy.Status -eq 404) {
    Write-Host "NAO PUBLICADA $label - nao existe no Cloud Run" -ForegroundColor Red
    $notFound += $callable
    continue
  }
  if ($policy.Status -ne 200) {
    Write-Host "ERRO  $label - nao consegui ler a politica (HTTP $($policy.Status))" -ForegroundColor Red
    $unreadable += $callable
    continue
  }
  $public = @($policy.Json.bindings | Where-Object {
    $_.role -eq "roles/run.invoker" -and @($_.members) -contains "allUsers"
  }).Count -gt 0
  if ($public) {
    Write-Host "OK    $label"
  } else {
    Write-Host "FALTA $label - sem allUsers/roles.run.invoker" -ForegroundColor Red
    $missing += $callable
  }
}

Write-Host ""
$failed = $false
if ($unreadable.Count -gt 0) {
  $failed = $true
  Write-Host "FALHOU: nao consegui ler a politica de $($unreadable.Count) callable(s); nada foi decidido sobre elas." -ForegroundColor Red
  $unreadable | ForEach-Object { Write-Host "  - $(Get-Label $_)" -ForegroundColor Red }
  Write-Host "Confira se a conta tem run.services.getIamPolicy no $ProjectId (roles/run.admin, por exemplo) e rode este script de novo."
  Write-Host ""
}
if ($notFound.Count -gt 0) {
  $failed = $true
  Write-Host "FALHOU: $($notFound.Count) callable(s) do codigo nao estao publicadas. O portal recebe erro generico ao chama-las." -ForegroundColor Red
  $notFound | ForEach-Object {
    $name = if ($_.Codebase) { "$($_.Codebase): $($_.Name)" } else { $_.Name }
    Write-Host "  - $name" -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "Publique com (e rode este script de novo):"
  Write-Host "  firebase deploy --only $(($notFound | ForEach-Object { Get-DeployTarget $_ }) -join ',') --project $ProjectId"
  Write-Host ""
}
if ($missing.Count -gt 0) {
  $failed = $true
  Write-Host "FALHOU: $($missing.Count) callable(s) sem invocacao publica. Clientes recebem erro generico ao chama-las." -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $(Get-Label $_)" -ForegroundColor Red }
  Write-Host ""
  Write-Host "Corrija com:"
  $missing | ForEach-Object {
    Write-Host "  gcloud run services add-iam-policy-binding $($_.Service) --project $ProjectId --region $Region --member=allUsers --role=roles/run.invoker"
  }
  Write-Host ""
  Write-Host "Se algum desses responder NOT_FOUND, a function nao subiu: publique de novo com firebase deploy --only functions:<nome> (ou functions:<codebase>:<nome> fora da default) e rode este script."
}
if ($failed) { exit 1 }

Write-Host "OK: as $($callables.Count) callable(s) publicada(s) tem allUsers/roles.run.invoker." -ForegroundColor Green
exit 0
