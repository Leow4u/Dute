param(
  [string]$ProjectId = "dute-btg",
  [string]$ProjectNumber = "912453685006",
  [string]$Repository = "Leow4u/Dute",
  [string]$ServiceAccountId = "github-actions-deploy"
)

$ErrorActionPreference = "Stop"

$Email = "${ServiceAccountId}@${ProjectId}.iam.gserviceaccount.com"
$PoolId = "github-pool"
$ProviderId = "github-provider"
$ProviderResource = "projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId/providers/$ProviderId"
$Principal = "principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId/attribute.repository/$Repository"

function Invoke-Gcloud {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: gcloud $($Args -join ' ')"
  }
}

Write-Host "Projeto:" $ProjectId
Write-Host "Service account:" $Email
Write-Host "Repositorio GitHub:" $Repository

$saExists = $false
try {
  Invoke-Gcloud iam service-accounts describe $Email --project $ProjectId | Out-Null
  $saExists = $true
} catch {
  $saExists = $false
}

if (-not $saExists) {
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

try {
  Invoke-Gcloud iam workload-identity-pools describe $PoolId `
    --location global `
    --project $ProjectId | Out-Null
} catch {
  Invoke-Gcloud iam workload-identity-pools create $PoolId `
    --project $ProjectId `
    --location global `
    --display-name "GitHub Actions"
}

try {
  Invoke-Gcloud iam workload-identity-pools providers describe $ProviderId `
    --workload-identity-pool $PoolId `
    --location global `
    --project $ProjectId | Out-Null
} catch {
  Invoke-Gcloud iam workload-identity-pools providers create-oidc $ProviderId `
    --project $ProjectId `
    --location global `
    --workload-identity-pool $PoolId `
    --display-name "GitHub provider" `
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" `
    --attribute-condition "assertion.repository_owner=='Leow4u'" `
    --issuer-uri "https://token.actions.githubusercontent.com"
}

Invoke-Gcloud iam service-accounts add-iam-policy-binding $Email `
  --project $ProjectId `
  --role "roles/iam.workloadIdentityUser" `
  --member $Principal `
  --quiet | Out-Null

Write-Host ""
Write-Host "Deploy automatico pronto (Workload Identity Federation, sem chave JSON)."
Write-Host "Provider:" $ProviderResource
Write-Host "Service account:" $Email
Write-Host ""
Write-Host "Fluxo: push -> CI passa -> deploy-frontend publica no Cloud Run."
