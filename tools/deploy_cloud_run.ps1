param(
  [string]$ProjectId = "dute-btg",
  [string]$Region = "southamerica-east1",
  [string]$Service = "dute-btg-app",
  [string]$Repository = "dute-btg",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$PublicDir = Join-Path $Root "artifacts\btg-inventory\dist\public"
$StageDir = Join-Path $Root "tmp\cloud-run-src"

if (-not $SkipBuild) {
  Write-Host "Gerando build do frontend..."
  & pnpm --filter "@workspace/btg-inventory" run build
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao gerar build do frontend."
  }
} elseif (-not (Test-Path $PublicDir)) {
  throw "Build nao encontrado em $PublicDir. Rode sem -SkipBuild ou gere pnpm --filter @workspace/btg-inventory run build."
}

$Stamp = Get-Date -Format "yyyyMMddHHmmss"
$Image = "$Region-docker.pkg.dev/$ProjectId/$Repository/$Service`:$Stamp"

function Invoke-Gcloud {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: gcloud $($Args -join ' ')"
  }
}

Write-Host "Projeto:" $ProjectId
Write-Host "Regiao:" $Region
Write-Host "Servico Cloud Run:" $Service
Write-Host "Imagem:" $Image

Invoke-Gcloud config set project $ProjectId | Out-Null

Invoke-Gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  --project $ProjectId | Out-Null

$repoExists = $true
try {
  Invoke-Gcloud artifacts repositories describe $Repository --location $Region --project $ProjectId | Out-Null
} catch {
  $repoExists = $false
}

if (-not $repoExists) {
  Invoke-Gcloud artifacts repositories create $Repository `
    --repository-format docker `
    --location $Region `
    --description "Dute BTG app images" `
    --project $ProjectId | Out-Null
}

$ResolvedRoot = (Resolve-Path $Root).Path
$ResolvedTmp = Join-Path $ResolvedRoot "tmp"
$ExpectedStagePrefix = Join-Path $ResolvedTmp "cloud-run-src"
if (Test-Path $StageDir) {
  $ResolvedStage = (Resolve-Path $StageDir).Path
  if (-not $ResolvedStage.StartsWith($ExpectedStagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "StageDir inesperado: $ResolvedStage"
  }
  Remove-Item -LiteralPath $ResolvedStage -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "deploy\cloud-run") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "artifacts\btg-inventory\dist") | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "Dockerfile") -Destination (Join-Path $StageDir "Dockerfile") -Force
Copy-Item -LiteralPath (Join-Path $Root "deploy\cloud-run\nginx.conf") -Destination (Join-Path $StageDir "deploy\cloud-run\nginx.conf") -Force
Copy-Item -LiteralPath $PublicDir -Destination (Join-Path $StageDir "artifacts\btg-inventory\dist\public") -Recurse -Force

Invoke-Gcloud builds submit $StageDir --tag $Image --project $ProjectId

Invoke-Gcloud run deploy $Service `
  --image $Image `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --project $ProjectId

Invoke-Gcloud run services describe $Service `
  --region $Region `
  --project $ProjectId `
  --format "value(status.url)"
