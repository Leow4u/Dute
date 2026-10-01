param(
  [string]$ProjectId = "dute-btg",
  [string]$Region = "southamerica-east1",
  [string]$IndexFile = "$PSScriptRoot\..\functions\src\index.ts"
)

# Incidente de 03/09/2026: createCustomerRequest, decideCustomerRequest e
# advanceWarehouseTask ficaram sem roles/run.invoker para allUsers (provavel
# falha silenciosa num "firebase deploy --only functions" anterior). Toda
# chamada dessas callables era rejeitada na borda do Cloud Run, antes do
# codigo rodar, e o SDK do Firebase traduzia isso para o mesmo erro generico
# de qualquer excecao nao tratada (Falha interna no servidor) - sem pista
# nenhuma de que era uma permissao de infraestrutura, nao um bug de codigo.
#
# Este script compara cada callable exportada em functions/src/index.ts com
# o Cloud Run real e falha (exit 1) se alguma estiver sem invocacao publica
# ou se nem tiver sido publicada. Rode depois de qualquer deploy de functions.
# Ver docs/deploy-functions-manual.md. Testes: check_functions_invoker.tests.ps1.
#
# 01/10/2026: cancelShipmentNotice nao subiu no deploy e o script disse
# "FALTA ... sem invoker"; o add-iam-policy-binding sugerido respondeu
# NOT_FOUND. No Windows o gcloud nem sempre devolve exit code de erro, entao
# "existe?" e decidido pela saida: politica de servico existente sempre traz
# pelo menos o etag; servico inexistente nao imprime nada.

$ErrorActionPreference = "Continue"

if (-not (Test-Path $IndexFile)) {
  Write-Host "Nao encontrei $IndexFile." -ForegroundColor Red
  exit 1
}

Write-Host "Lendo callables exportadas de $IndexFile ..."
$exports = Select-String -Path $IndexFile -Pattern '^export const (\w+) = onCall\(' |
  ForEach-Object { $_.Matches[0].Groups[1].Value }

if ($exports.Count -eq 0) {
  Write-Host "Nenhuma function onCall encontrada - verifique o padrao/caminho." -ForegroundColor Red
  exit 1
}

Write-Host "$($exports.Count) callables encontradas. Verificando roles/run.invoker (allUsers) em cada Cloud Run service..."
Write-Host ""

$missing = @()
$notFound = @()

foreach ($fn in $exports) {
  $service = $fn.ToLower()
  $json = (gcloud run services get-iam-policy $service `
    --project $ProjectId --region $Region --format=json 2>$null | Out-String).Trim()
  if (-not $json -or $json -notmatch '"etag"') {
    Write-Host "NAO PUBLICADA $service - nao existe no Cloud Run" -ForegroundColor Red
    $notFound += $fn
    continue
  }
  if (($json -match '"allUsers"') -and ($json -match 'roles/run\.invoker')) {
    Write-Host "OK    $service"
  } else {
    Write-Host "FALTA $service - sem allUsers/roles.run.invoker" -ForegroundColor Red
    $missing += $service
  }
}

Write-Host ""
$failed = $false
if ($notFound.Count -gt 0) {
  $failed = $true
  Write-Host "FALHOU: $($notFound.Count) callable(s) do codigo nao estao publicadas. O portal recebe erro generico ao chama-las." -ForegroundColor Red
  $notFound | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host ""
  Write-Host "Publique com (e rode este script de novo):"
  Write-Host "  firebase deploy --only $(($notFound | ForEach-Object { "functions:$_" }) -join ',') --project $ProjectId"
  Write-Host ""
}
if ($missing.Count -gt 0) {
  $failed = $true
  Write-Host "FALHOU: $($missing.Count) callable(s) sem invocacao publica. Clientes recebem erro generico ao chama-las." -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host ""
  Write-Host "Corrija com:"
  $missing | ForEach-Object {
    Write-Host "  gcloud run services add-iam-policy-binding $_ --project $ProjectId --region $Region --member=allUsers --role=roles/run.invoker"
  }
}
if ($failed) { exit 1 }

Write-Host "OK: as $($exports.Count) callable(s) publicada(s) tem allUsers/roles.run.invoker." -ForegroundColor Green
exit 0
