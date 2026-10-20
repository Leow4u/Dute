param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "southamerica-east1",
  [switch]$Desfazer,
  [switch]$Apply,
  [string]$IndexFile = ""
)

# Congela um projeto do WMS para a janela de corte (docs/plataforma/fase-1-corte.md):
#   1. regras do Firestore e do Storage trocadas por "ninguem le nem grava"
#      (deploy/manutencao/);
#   2. rotinas do Cloud Scheduler pausadas (runAgentRoutines);
#   3. invocacao publica (allUsers) tirada de cada callable publicada no
#      projeto: as Functions usam o Admin SDK e passariam por cima das regras.
# O frontend e o site continuam no ar; quem abrir o app recebe erro de permissao.
#
# A lista de callables vem do projeto (label deployment-callable), nao do
# codigo: o dute-btg so recebe a main por disparo manual, entao a main pode ter
# callable que o projeto nao tem, e o contrario. A diferenca para
# functions/wms/src/index.ts aparece como aviso.
#
# A remocao do invoker leva alguns minutos para valer em toda parte (IAM:
# normalmente 2, ate 7 ou mais). O roteiro confere o banco depois do export
# para pegar qualquer gravacao atrasada.
#
# Com -Desfazer, o caminho inverso: regras do repositorio, invoker de volta e
# rotinas retomadas. Confira depois com tools/check_functions_invoker.ps1.
# Sem -Apply, so mostra o plano.

$ErrorActionPreference = "Continue"
# No Windows PowerShell 5.1 o $PSScriptRoot chega vazio no param(); por isso aqui.
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $IndexFile) { $IndexFile = Join-Path $Root "functions/wms/src/index.ts" }

# O gcloud no Windows nem sempre devolve exit code de erro (ver
# check_functions_invoker.ps1): existencia e estado sao decididos pela saida.
$callables = @(gcloud functions list --project $ProjectId --regions $Region `
    --filter="labels.deployment-callable=true" --format="value(serviceConfig.service.basename())" 2>$null |
  Where-Object { $_ } | ForEach-Object { $_.Trim().ToLower() } | Sort-Object -Unique)
if ($callables.Count -eq 0) {
  Write-Host "Nenhuma callable publicada em $ProjectId (ou o gcloud nao respondeu). Parei sem mudar nada." -ForegroundColor Red
  exit 1
}

$inCode = @()
if (Test-Path $IndexFile) {
  $inCode = @(Select-String -Path $IndexFile -Pattern '^export const (\w+) = onCall\(' |
    ForEach-Object { $_.Matches[0].Groups[1].Value.ToLower() })
}
$onlyProject = @($callables | Where-Object { $inCode -notcontains $_ })
$onlyCode = @($inCode | Where-Object { $callables -notcontains $_ })

$jobs = @(gcloud scheduler jobs list --project $ProjectId --location $Region --format="value(name.basename())" 2>$null |
  Where-Object { $_ })
# Cada function agendada tem o job firebase-schedule-<nome>-<regiao>. Se a
# listagem do Scheduler falhar, a rotina continuaria rodando (ou parada, no
# -Desfazer) com o script dizendo que concluiu: por isso o job de cada uma tem
# que aparecer antes de qualquer mudanca.
$scheduled = @(gcloud functions list --project $ProjectId --regions $Region `
    --filter="labels.deployment-scheduled=true" --format="value(name.basename())" 2>$null |
  Where-Object { $_ } | ForEach-Object { $_.Trim() })
$missingJobs = @($scheduled | ForEach-Object { "firebase-schedule-$_-$Region" } | Where-Object { $jobs -notcontains $_ })
if ($missingJobs.Count -gt 0) {
  Write-Host "Nao encontrei no Scheduler o job de: $($missingJobs -join ', ') (ou o gcloud nao respondeu). Parei sem mudar nada." -ForegroundColor Red
  exit 1
}

$acao = if ($Desfazer) { "DESCONGELAR" } else { "CONGELAR" }
Write-Host "$acao $ProjectId ($Region)"
if ($Desfazer) {
  Write-Host " - regras: as do repositorio (firestore.rules e storage.rules)"
  Write-Host " - $($callables.Count) callables publicadas: devolver allUsers/roles.run.invoker"
  Write-Host " - rotinas do Scheduler a retomar: $($jobs -join ', ')"
} else {
  Write-Host " - regras: deploy/manutencao (ninguem le nem grava pelo app)"
  Write-Host " - rotinas do Scheduler a pausar: $($jobs -join ', ')"
  Write-Host " - $($callables.Count) callables publicadas: tirar allUsers/roles.run.invoker"
}
if ($onlyProject.Count -gt 0) {
  Write-Host "Aviso: publicadas no projeto e fora de $IndexFile (entram assim mesmo): $($onlyProject -join ', ')" -ForegroundColor Yellow
}
if ($onlyCode.Count -gt 0) {
  Write-Host "Aviso: no codigo e ainda nao publicadas no projeto (nada a fazer nelas): $($onlyCode -join ', ')" -ForegroundColor Yellow
}

if (-not $Apply) {
  Write-Host "So o plano. Para executar, rode de novo com -Apply."
  exit 0
}

$erradas = @()

function Set-Jobs([string]$verbo, [string]$esperado) {
  foreach ($job in $jobs) {
    gcloud scheduler jobs $verbo $job --project $ProjectId --location $Region *> $null
    $state = (gcloud scheduler jobs describe $job --project $ProjectId --location $Region --format="value(state)" 2>$null | Out-String).Trim()
    if ($state -ne $esperado) {
      Write-Host "ERRO rotina $job - estado $state" -ForegroundColor Red
      $script:erradas += $job
    } else {
      Write-Host "ok   rotina $job - $state"
    }
  }
}

# 1. Regras primeiro: se falharem, nada mais muda.
if ($Desfazer) {
  Push-Location $Root
  firebase deploy --only "firestore:rules,storage" --project $ProjectId --non-interactive
  $rulesExit = $LASTEXITCODE
  Pop-Location
} else {
  $config = Join-Path $Root "deploy/manutencao/firebase.json"
  firebase deploy --only "firestore:rules,storage" --config $config --project $ProjectId --non-interactive
  $rulesExit = $LASTEXITCODE
}
if ($rulesExit -ne 0) {
  Write-Host "O deploy das regras falhou. Parei antes de mexer nas rotinas e nas functions." -ForegroundColor Red
  exit 1
}

# 2. No congelamento, as rotinas param antes das callables.
if (-not $Desfazer) { Set-Jobs "pause" "PAUSED" }

# 3. Invocacao publica das callables, conferida relendo a politica de cada uma.
foreach ($service in $callables) {
  $exists = (gcloud run services describe $service --project $ProjectId --region $Region --format="value(metadata.name)" 2>$null | Out-String).Trim()
  if (-not $exists) {
    Write-Host "NAO EXISTE $service - a function esta listada mas o servico do Cloud Run nao" -ForegroundColor Red
    $erradas += $service
    continue
  }
  if ($Desfazer) {
    gcloud run services add-iam-policy-binding $service --project $ProjectId --region $Region `
      --member=allUsers --role=roles/run.invoker --format="value(etag)" *> $null
  } else {
    gcloud run services remove-iam-policy-binding $service --project $ProjectId --region $Region `
      --member=allUsers --role=roles/run.invoker --format="value(etag)" *> $null
  }
  # So conta a politica que foi lida de fato (com etag): leitura que falha nao
  # pode passar por "sem invocacao publica".
  $json = (gcloud run services get-iam-policy $service --project $ProjectId --region $Region --format=json 2>$null | Out-String)
  $publica = $null
  try {
    $policy = $json | ConvertFrom-Json -ErrorAction Stop
    if ($policy -and $policy.etag) {
      $publica = [bool](@($policy.bindings) | Where-Object { $_ -and $_.role -eq "roles/run.invoker" -and @($_.members) -contains "allUsers" })
    }
  } catch {
    $publica = $null
  }
  if ($null -eq $publica) {
    Write-Host "ERRO $service - nao consegui ler a politica" -ForegroundColor Red
    $erradas += $service
  } elseif ($publica -ne [bool]$Desfazer) {
    Write-Host "ERRO $service - invocacao publica: $publica" -ForegroundColor Red
    $erradas += $service
  } else {
    Write-Host "ok   $service - invocacao publica: $publica"
  }
}

if ($Desfazer) { Set-Jobs "resume" "ENABLED" }

Write-Host ""
if ($erradas.Count -gt 0) {
  Write-Host "FALHOU em $($erradas.Count) item(ns): $($erradas -join ', '). Rode de novo com -Apply." -ForegroundColor Red
  exit 1
}
Write-Host "$acao concluido em $ProjectId." -ForegroundColor Green
exit 0
