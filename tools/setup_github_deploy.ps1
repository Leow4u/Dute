param(
  [string]$ProjectId = "dute-btg",
  [string]$ServiceAccountId = "github-actions-deploy",
  [string]$KeyOut = "tmp/github-actions-deploy-key.json"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$KeyPath = Join-Path $Root $KeyOut
$Email = "${ServiceAccountId}@${ProjectId}.iam.gserviceaccount.com"

function Invoke-Gcloud {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: gcloud $($Args -join ' ')"
  }
}

Write-Host "Projeto:" $ProjectId
Write-Host "Service account:" $Email

Invoke-Gcloud iam service-accounts describe $Email --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  Invoke-Gcloud iam service-accounts create $ServiceAccountId `
    --display-name "GitHub Actions deploy (Dute frontend)" `
    --project $ProjectId
}

$roles = @(
  "roles/run.admin",
  "roles/cloudbuild.builds.editor",
  "roles/artifactregistry.writer",
  "roles/iam.serviceAccountUser"
)

foreach ($role in $roles) {
  Invoke-Gcloud projects add-iam-policy-binding $ProjectId `
    --member "serviceAccount:$Email" `
    --role $role `
    --quiet | Out-Null
}

$keyDir = Split-Path $KeyPath -Parent
if (-not (Test-Path $keyDir)) {
  New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
}

Invoke-Gcloud iam service-accounts keys create $KeyPath `
  --iam-account $Email `
  --project $ProjectId

Write-Host ""
Write-Host "Chave criada em:" $KeyPath
Write-Host ""
Write-Host "Proximo passo (uma vez):"
Write-Host "  gh secret set GCP_SA_KEY --repo Leow4u/Dute < `"$KeyPath`""
Write-Host ""
Write-Host "Depois apague a chave local:"
Write-Host "  Remove-Item -LiteralPath `"$KeyPath`""
