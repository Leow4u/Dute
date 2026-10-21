# Testes do check_functions_invoker.ps1 sem tocar no Google Cloud: um
# "gcloud" de mentira responde como o real. Rode com:
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
# - aprovaProposta: publica, para a segunda codebase (comercial).
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
    if (@("publica", "semestado", "privada", "falhou", "aprovaproposta") -contains $service) { $service }
    else { [Console]::Error.WriteLine("ERROR: NOT_FOUND: Resource '$service' does not exist.") }
    return
  }
  switch ($service) {
    "publica" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
    "semestado" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
    "aprovaproposta" { '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}' }
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

# Erro do script vira falha do caso, sem derrubar os outros.
function Invoke-Check([hashtable]$params) {
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
Expect "sem resposta do functions describe decide pela politica" ($result.Exit -eq 0 -and $result.Output -match "OK: as 2 callable") $result.Output

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

# Sem parametros, como no publicar.yml: le o firebase.json da raiz do repo.
# Aqui o gcloud de mentira responde "publica" para qualquer servico.
$fakeGcloud = ${function:gcloud}
function global:gcloud {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "functions") { "ACTIVE"; return }
  if ($args[2] -eq "describe") { $args[3]; return }
  '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}],"etag":"BwY"}'
}
$result = Invoke-Check @{}
Set-Item function:global:gcloud $fakeGcloud
Expect "sem parametros le as codebases do firebase.json da raiz" (
  $result.Exit -eq 0 -and $result.Output -match "default: \d+ callable\(s\) em functions/wms/src/index\.ts"
) $result.Output

$fakeRepos | ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force -ErrorAction SilentlyContinue }

if ($failures -gt 0) { Write-Host "$failures teste(s) falharam." -ForegroundColor Red; exit 1 }
Write-Host "Todos os testes passaram." -ForegroundColor Green
# O último caso testado sai com 1 de propósito; o runner do CI usa o
# $LASTEXITCODE final como resultado do passo.
exit 0
