# Testes do congelar_projeto.ps1 sem tocar no Google Cloud: "gcloud" e
# "firebase" de mentira guardam o estado (callables publicadas, invoker de cada
# servico, rotinas e deploys de regras). Rode com:
#   pwsh -NoProfile -File tools/congelar_projeto.tests.ps1

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "congelar_projeto.ps1"
$failures = 0
$job = "firebase-schedule-runAgentRoutines-southamerica-east1"

function New-FakeIndex([string[]]$names) {
  $file = New-TemporaryFile
  $names | ForEach-Object { "export const $_ = onCall(async (request) => {" } | Set-Content $file
  return $file.FullName
}

# $listed: o que "functions list" devolve; $services: servicos do Cloud Run que
# existem, todos publicos no comeco.
function Reset-Fake([string[]]$listed, [string[]]$services, [int]$firebaseExit = 0) {
  $global:listed = $listed
  $global:policies = @{}
  foreach ($service in $services) { $global:policies[$service] = $true }
  $global:scheduled = @("runAgentRoutines")
  $global:jobs = @{ $job = "ENABLED" }
  $global:jobsListFails = $false
  $global:unreadable = @()
  $global:firebaseCalls = @()
  $global:firebaseExit = $firebaseExit
  $global:log = @()
}

function global:firebase {
  $global:firebaseCalls += , ($args -join " ")
  $global:LASTEXITCODE = $global:firebaseExit
}

# Como o gcloud real (conferido em 19/10/2026): "run services describe" de
# servico inexistente nao escreve nada no stdout; "get-iam-policy" de servico
# inexistente devolve so o etag, com exit 0.
function global:gcloud {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "functions" -and $args[1] -eq "list") {
    if (($args -join " ") -match "deployment-scheduled") { $global:scheduled } else { $global:listed }
    return
  }
  if ($args[0] -eq "scheduler") {
    $verb = $args[2]
    if ($verb -eq "list") {
      if ($global:jobsListFails) { [Console]::Error.WriteLine("ERROR: UNAVAILABLE") } else { $global:jobs.Keys }
      return
    }
    $name = $args[3]
    if ($verb -eq "pause") { $global:jobs[$name] = "PAUSED"; $global:log += "pause" }
    if ($verb -eq "resume") { $global:jobs[$name] = "ENABLED"; $global:log += "resume" }
    if ($verb -eq "describe") { $global:jobs[$name] }
    return
  }
  $verb = $args[2]
  $service = $args[3]
  $exists = $global:policies.ContainsKey($service)
  switch ($verb) {
    "describe" {
      if ($exists) { $service } else { [Console]::Error.WriteLine("ERROR: NOT_FOUND: Service '$service' not found.") }
    }
    "get-iam-policy" {
      if ($global:unreadable -contains $service) { [Console]::Error.WriteLine("ERROR: 503"); return }
      if ($exists -and $global:policies[$service]) { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
      else { '{"etag":"ACAB"}' }
    }
    "remove-iam-policy-binding" {
      if ($global:unreadable -contains $service) { [Console]::Error.WriteLine("ERROR: 503"); return }
      if ($exists) { $global:policies[$service] = $false; $global:log += "remove:$service" }
      else { [Console]::Error.WriteLine("ERROR: NOT_FOUND") }
    }
    "add-iam-policy-binding" {
      if ($exists) { $global:policies[$service] = $true; $global:log += "add:$service" }
      else { [Console]::Error.WriteLine("ERROR: NOT_FOUND") }
    }
  }
}

function Run-Script([string[]]$inCode, [string[]]$extra) {
  $index = New-FakeIndex $inCode
  $params = @{ ProjectId = "dute-teste"; IndexFile = $index }
  foreach ($flag in $extra) { $params[$flag] = $true }
  $output = & $script @params *>&1 | Out-String
  return @{ Output = $output; Exit = $global:LASTEXITCODE }
}

function Expect([string]$name, [bool]$condition, [string]$detail) {
  if ($condition) { Write-Host "ok   $name" }
  else { Write-Host "FAIL $name`n$detail" -ForegroundColor Red; $script:failures++ }
}

Reset-Fake @("lookupinvite", "createwarehousebox") @("lookupinvite", "createwarehousebox")
$result = Run-Script @("lookupInvite", "createWarehouseBox") @()
Expect "sem -Apply so mostra o plano e nao muda nada" (
  $result.Exit -eq 0 -and $result.Output -match "2 callables publicadas" -and $result.Output -match "So o plano" -and
  $global:log.Count -eq 0 -and $global:firebaseCalls.Count -eq 0
) $result.Output

Reset-Fake @("lookupinvite", "createwarehousebox") @("lookupinvite", "createwarehousebox")
$result = Run-Script @("lookupInvite", "createWarehouseBox") @("Apply")
Expect "congelar publica as regras de manutencao" (
  $global:firebaseCalls.Count -eq 1 -and
  $global:firebaseCalls[0] -match "--only firestore:rules,storage" -and
  $global:firebaseCalls[0] -match "deploy.manutencao.firebase\.json" -and
  $global:firebaseCalls[0] -match "--project dute-teste"
) ($global:firebaseCalls -join "`n")
Expect "congelar pausa as rotinas antes de tirar o invoker" (
  $result.Exit -eq 0 -and $global:log[0] -eq "pause" -and
  -not $global:policies["lookupinvite"] -and -not $global:policies["createwarehousebox"] -and
  $global:jobs[$job] -eq "PAUSED" -and $result.Output -match "CONGELAR concluido"
) (($global:log -join ", ") + "`n" + $result.Output)

$result = Run-Script @("lookupInvite", "createWarehouseBox") @("Apply", "Desfazer")
Expect "desfazer volta as regras do repositorio, o invoker e as rotinas" (
  $result.Exit -eq 0 -and $global:policies["lookupinvite"] -and $global:policies["createwarehousebox"] -and
  $global:jobs[$job] -eq "ENABLED" -and $global:log[-1] -eq "resume" -and
  $global:firebaseCalls[-1] -notmatch "--config" -and $result.Output -match "DESCONGELAR concluido"
) $result.Output

# A main tem uma callable nova que o projeto ainda nao recebeu, e o projeto tem
# uma antiga que saiu do codigo: a antiga e congelada, a nova so gera aviso.
Reset-Fake @("lookupinvite", "antiga") @("lookupinvite", "antiga")
$result = Run-Script @("lookupInvite", "novaNoCodigo") @("Apply")
Expect "a lista vem do projeto: callable fora do codigo tambem congela" (
  $result.Exit -eq 0 -and -not $global:policies["antiga"] -and
  $result.Output -match "fora de .*antiga" -and $result.Output -match "nao publicadas .*novanocodigo"
) $result.Output
$result = Run-Script @("lookupInvite", "novaNoCodigo") @("Apply", "Desfazer")
Expect "desfazer nao trava em callable que so existe no codigo" (
  $result.Exit -eq 0 -and $global:policies["antiga"] -and $global:policies["lookupinvite"]
) $result.Output

Reset-Fake @("lookupinvite") @("lookupinvite") -firebaseExit 1
$result = Run-Script @("lookupInvite") @("Apply")
Expect "regras que falham param antes de mexer em rotinas e functions" (
  $result.Exit -eq 1 -and $global:policies["lookupinvite"] -and $global:log.Count -eq 0
) $result.Output

Reset-Fake @() @("lookupinvite")
$result = Run-Script @("lookupInvite") @("Apply")
Expect "sem callables listadas (gcloud mudo) para sem mudar nada" (
  $result.Exit -eq 1 -and $global:firebaseCalls.Count -eq 0 -and $global:log.Count -eq 0 -and $global:policies["lookupinvite"]
) $result.Output

Reset-Fake @("lookupinvite", "fantasma") @("lookupinvite")
$result = Run-Script @("lookupInvite", "fantasma") @("Apply")
Expect "function listada sem servico no Cloud Run reprova" (
  $result.Exit -eq 1 -and $result.Output -match "NAO EXISTE fantasma" -and -not $global:policies["lookupinvite"]
) $result.Output

Reset-Fake @("lookupinvite") @("lookupinvite")
$global:jobsListFails = $true
$result = Run-Script @("lookupInvite") @("Apply")
Expect "listagem do Scheduler muda para sem mudar nada" (
  $result.Exit -eq 1 -and $global:firebaseCalls.Count -eq 0 -and $global:log.Count -eq 0 -and
  $global:jobs[$job] -eq "ENABLED" -and $result.Output -match "Nao encontrei no Scheduler"
) $result.Output
$global:jobs[$job] = "PAUSED"
$result = Run-Script @("lookupInvite") @("Apply", "Desfazer")
Expect "no desfazer, listagem do Scheduler muda tambem para" (
  $result.Exit -eq 1 -and $global:firebaseCalls.Count -eq 0 -and $global:jobs[$job] -eq "PAUSED"
) $result.Output

# Remocao e releitura falham (503): a callable continua publica e o script nao
# pode dizer que congelou.
Reset-Fake @("lookupinvite", "createwarehousebox") @("lookupinvite", "createwarehousebox")
$global:unreadable = @("createwarehousebox")
$result = Run-Script @("lookupInvite", "createWarehouseBox") @("Apply")
Expect "politica que nao se le reprova em vez de passar como fechada" (
  $result.Exit -eq 1 -and $result.Output -match "ERRO createwarehousebox - nao consegui ler" -and
  $global:policies["createwarehousebox"] -and -not $global:policies["lookupinvite"] -and
  $result.Output -notmatch "CONGELAR concluido"
) $result.Output

if ($failures -gt 0) {
  Write-Host "$failures teste(s) falharam." -ForegroundColor Red
  exit 1
}
Write-Host "Todos os testes passaram."
exit 0
