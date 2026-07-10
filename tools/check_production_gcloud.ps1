param(
  [string]$ProjectId = "dute-btg",
  [string]$CertName = "dute-btg-app-cert",
  [string]$Domain = "app.dutelog.com.br",
  [string]$CloudRunUrl = "https://dute-btg-app-pgv7m7drtq-rj.a.run.app"
)

$ErrorActionPreference = "Continue"

function Show-Dns {
  param(
    [string]$Type,
    [string]$Server = "8.8.8.8"
  )

  Write-Host "DNS $Type via ${Server}:"
  $answer = Resolve-DnsName $Domain -Type $Type -Server $Server -ErrorAction SilentlyContinue |
    Where-Object { $_.Section -eq "Answer" }
  if ($null -eq $answer) {
    Write-Host "  Sem resposta $Type."
    return
  }
  $answer | Select-Object Name, Type, TTL, IPAddress, NameHost | Format-Table -AutoSize
}

function Show-HttpProbe {
  param(
    [string]$Label,
    [string]$Url,
    [switch]$Ipv4Only
  )

  Write-Host ""
  Write-Host $Label
  $args = @("-sS", "-D", "-", "-o", "NUL")
  if ($Ipv4Only) {
    $args = @("-4") + $args
  }
  $args += $Url
  $output = curl.exe @args 2>&1
  $matches = $output | Select-String "HTTP/|server:|content-type:|location:|x-served-by:|x-cache:|vary:"
  if ($null -eq $matches) {
    Write-Host "  Sem resposta HTTP legivel."
    return
  }
  $matches | ForEach-Object { Write-Host ("  " + $_.Line) }
}

Show-Dns -Type "A"
Write-Host ""
Show-Dns -Type "AAAA"
Write-Host ""
Show-Dns -Type "CNAME"

Write-Host ""
Write-Host "Certificado Google Cloud:"
gcloud compute ssl-certificates describe $CertName `
  --global `
  --project $ProjectId `
  --format "yaml(managed.status,managed.domainStatus,managed.domains)"

Show-HttpProbe -Label "Cloud Run direto:" -Url "$CloudRunUrl/portal/estoque"
Show-HttpProbe -Label "Dominio final HTTPS:" -Url "https://$Domain/portal/estoque"
