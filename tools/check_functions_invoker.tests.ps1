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
function global:gcloud {
  $service = $args[3]
  $global:LASTEXITCODE = 0
  switch ($service) {
    "publica" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
    "privada" { '{"etag":"ACAB"}' }
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

if ($failures -gt 0) { Write-Host "$failures teste(s) falharam." -ForegroundColor Red; exit 1 }
Write-Host "Todos os testes passaram." -ForegroundColor Green
# O último caso testado sai com 1 de propósito; o runner do CI usa o
# $LASTEXITCODE final como resultado do passo.
exit 0
