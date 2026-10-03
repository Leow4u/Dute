# Testes do check_functions_invoker.ps1 sem tocar no Google Cloud: um
# "gcloud" de mentira responde como o real. Rode com:
#   pwsh -NoProfile -File tools/check_functions_invoker.tests.ps1

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "check_functions_invoker.ps1"
$failures = 0

function New-FakeIndex([string[]]$names) {
  $file = New-TemporaryFile
  $names | ForEach-Object { "export const $_ = onCall(async (request) => {" } | Set-Content $file
  return $file.FullName
}

# Simula o gcloud real:
# - publica: política com allUsers/roles/run.invoker;
# - privada: política sem o invoker (servico existe);
# - inexistente: erro no stderr e NADA no stdout. No Windows o wrapper do
#   gcloud nem sempre devolve exit code diferente de 0, entao o script nao
#   pode depender do $LASTEXITCODE para saber se o servico existe.
# - falhou: o servico do Cloud Run existe (politica sem invoker), mas a
#   function ficou FAILED no deploy (02/10/2026, primeiro deploy das rotinas,
#   com a API do Cloud Scheduler desligada). Minutos depois o servico sumiu.
# - semEstado: "functions describe" nao responde (versao/permissao do
#   gcloud); o script nao pode reprovar so por isso.
# - fantasma: nunca foi publicada (02/10/2026, deploy do painel do sistema
#   parou no timeout de descoberta), mas "run services get-iam-policy"
#   devolveu uma politica vazia com etag como se o servico existisse. So o
#   "run services describe" diz a verdade: nada no stdout.
function global:gcloud {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "functions") {
    $name = $args[2]
    switch ($name) {
      "falhou" { "FAILED" }
      "semEstado" { [Console]::Error.WriteLine("ERROR: describe indisponivel.") }
      "naoPublicada" { [Console]::Error.WriteLine("ERROR: NOT_FOUND: function '$name' does not exist.") }
      default { "ACTIVE" }
    }
    return
  }
  $service = $args[3]
  if ($args[2] -eq "describe") {
    if (@("publica", "semestado", "privada", "falhou") -contains $service) { $service }
    else { [Console]::Error.WriteLine("ERROR: NOT_FOUND: Resource '$service' does not exist.") }
    return
  }
  switch ($service) {
    "publica" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
    "semestado" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
    "privada" { '{"etag":"ACAB"}' }
    "falhou" { '{"etag":"ACAB"}' }
    "fantasma" { '{"etag":"ACAB"}' }
    default { [Console]::Error.WriteLine("ERROR: NOT_FOUND: Resource '$service' does not exist.") }
  }
}

function Run-Check([string[]]$names) {
  $index = New-FakeIndex $names
  $output = & $script -IndexFile $index *>&1 | Out-String
  return @{ Output = $output; Exit = $global:LASTEXITCODE }
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
Expect "sem resposta do functions describe decide pela politica" ($result.Exit -eq 0 -and $result.Output -match "OK: as 2 callable") $result.Output

if ($failures -gt 0) { Write-Host "$failures teste(s) falharam." -ForegroundColor Red; exit 1 }
Write-Host "Todos os testes passaram." -ForegroundColor Green
# O último caso testado sai com 1 de propósito; o runner do CI usa o
# $LASTEXITCODE final como resultado do passo.
exit 0
