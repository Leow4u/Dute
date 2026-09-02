param(
  [string]$ProjectId = "dute-btg",
  [string]$Region = "southamerica-east1",
  [string]$Service = "dute-btg-app",
  [string]$Domain = "app.dutelog.com.br",
  [string]$Prefix = "dute-btg-app"
)

$ErrorActionPreference = "Stop"

function Invoke-Gcloud {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: gcloud $($Args -join ' ')"
  }
}

function Test-Gcloud {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & gcloud @Args *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previous
  }
}

$Neg = "$Prefix-neg"
$Backend = "$Prefix-backend"
$UrlMap = "$Prefix-url-map"
$Cert = "$Prefix-cert"
$HttpsProxy = "$Prefix-https-proxy"
$IpName = "$Prefix-ip"
$HttpsRule = "$Prefix-https-rule"

Invoke-Gcloud config set project $ProjectId | Out-Null
Invoke-Gcloud services enable compute.googleapis.com run.googleapis.com --project $ProjectId | Out-Null

if (-not (Test-Gcloud compute network-endpoint-groups describe $Neg --region $Region --project $ProjectId)) {
  Invoke-Gcloud compute network-endpoint-groups create $Neg `
    --region $Region `
    --network-endpoint-type serverless `
    --cloud-run-service $Service `
    --project $ProjectId
}

if (-not (Test-Gcloud compute backend-services describe $Backend --global --project $ProjectId)) {
  Invoke-Gcloud compute backend-services create $Backend `
    --global `
    --load-balancing-scheme EXTERNAL_MANAGED `
    --protocol HTTP `
    --project $ProjectId
}

$backendDescription = (& gcloud compute backend-services describe $Backend --global --project $ProjectId --format json) | ConvertFrom-Json
$hasNeg = $false
foreach ($backendItem in @($backendDescription.backends)) {
  if ([string]$backendItem.group -like "*networkEndpointGroups/$Neg") {
    $hasNeg = $true
  }
}

if (-not $hasNeg) {
  Invoke-Gcloud compute backend-services add-backend $Backend `
    --global `
    --network-endpoint-group $Neg `
    --network-endpoint-group-region $Region `
    --project $ProjectId
}

if (-not (Test-Gcloud compute url-maps describe $UrlMap --global --project $ProjectId)) {
  Invoke-Gcloud compute url-maps create $UrlMap `
    --default-service $Backend `
    --global `
    --project $ProjectId
}

if (-not (Test-Gcloud compute ssl-certificates describe $Cert --global --project $ProjectId)) {
  Invoke-Gcloud compute ssl-certificates create $Cert `
    --domains $Domain `
    --global `
    --project $ProjectId
}

if (-not (Test-Gcloud compute target-https-proxies describe $HttpsProxy --global --project $ProjectId)) {
  Invoke-Gcloud compute target-https-proxies create $HttpsProxy `
    --url-map $UrlMap `
    --ssl-certificates $Cert `
    --global `
    --project $ProjectId
}

if (-not (Test-Gcloud compute addresses describe $IpName --global --project $ProjectId)) {
  Invoke-Gcloud compute addresses create $IpName `
    --global `
    --ip-version IPV4 `
    --project $ProjectId
}

$IpAddress = (& gcloud compute addresses describe $IpName --global --project $ProjectId --format "value(address)").Trim()

if (-not (Test-Gcloud compute forwarding-rules describe $HttpsRule --global --project $ProjectId)) {
  Invoke-Gcloud compute forwarding-rules create $HttpsRule `
    --global `
    --load-balancing-scheme EXTERNAL_MANAGED `
    --address $IpName `
    --target-https-proxy $HttpsProxy `
    --ports 443 `
    --project $ProjectId
}

Write-Host "Load Balancer HTTPS pronto."
Write-Host "Aponte app.dutelog.com.br para A $IpAddress"
Write-Host "Depois valide o certificado:"
Write-Host "gcloud compute ssl-certificates describe $Cert --global --project $ProjectId --format `"value(managed.status)`""
