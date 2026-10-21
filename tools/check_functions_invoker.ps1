param(
  [string]$ProjectId = "dute-prod",
  [string]$Region = "southamerica-east1",
  [string]$IndexFile,
  [string]$FirebaseJson = (Join-Path (Split-Path -Parent $PSScriptRoot) "firebase.json")
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
# functions:<codebase>:<nome>; functions:<nome> procura so na default.

$ErrorActionPreference = "Continue"
$callablePattern = '^export const (\w+) = onCall\('

function Get-Callables([string]$file) {
  @(Select-String -LiteralPath $file -Pattern $callablePattern |
    ForEach-Object { $_.Matches[0].Groups[1].Value })
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
  $config = Get-Content -LiteralPath $FirebaseJson -Raw | ConvertFrom-Json
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
    $source = $entry.source.TrimEnd("/", "\")
    $index = [System.IO.Path]::Combine($root, $source, "src", "index.ts")
    if (-not (Test-Path -LiteralPath $index)) {
      $problems += "${codebase}: nao encontrei $source/src/index.ts"
      continue
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

Write-Host "$($callables.Count) callables encontradas. Verificando roles/run.invoker (allUsers) em cada Cloud Run service..."
Write-Host ""

$missing = @()
$notFound = @()

foreach ($callable in $callables) {
  $fn = $callable.Name
  $service = $callable.Service
  $label = Get-Label $callable
  $exists = (gcloud run services describe $service `
    --project $ProjectId --region $Region --format="value(metadata.name)" 2>$null | Out-String).Trim()
  $json = if ($exists) {
    (gcloud run services get-iam-policy $service `
      --project $ProjectId --region $Region --format=json 2>$null | Out-String).Trim()
  }
  if (-not $exists -or -not $json -or $json -notmatch '"etag"') {
    Write-Host "NAO PUBLICADA $label - nao existe no Cloud Run" -ForegroundColor Red
    $notFound += $callable
    continue
  }
  $state = (gcloud functions describe $fn `
    --project $ProjectId --region $Region --format="value(state)" 2>$null | Out-String).Trim()
  if ($state -and $state -ne "ACTIVE") {
    Write-Host "NAO PUBLICADA $label - deploy nao terminou (estado $state)" -ForegroundColor Red
    $notFound += $callable
    continue
  }
  if (($json -match '"allUsers"') -and ($json -match 'roles/run\.invoker')) {
    Write-Host "OK    $label"
  } else {
    Write-Host "FALTA $label - sem allUsers/roles.run.invoker" -ForegroundColor Red
    $missing += $callable
  }
}

Write-Host ""
$failed = $false
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
