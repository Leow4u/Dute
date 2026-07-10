param(
  [string]$IpAddress = "8.232.54.179",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

$Domain = "dutelog.com.br"
$BaseUrl = "https://developers.hostinger.com/api/dns/v1/zones/$Domain"

if ([string]::IsNullOrWhiteSpace($env:HOSTINGER_API_TOKEN)) {
  throw "HOSTINGER_API_TOKEN nao esta disponivel neste processo. Exporte o token antes de rodar."
}

$Headers = @{
  Authorization = "Bearer $env:HOSTINGER_API_TOKEN"
  "Content-Type" = "application/json"
  "User-Agent" = "Mozilla/5.0"
}

function Invoke-HostingerJson {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  try {
    if ($null -eq $Body) {
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
    }

    $json = $Body | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $json
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      $stream = $response.GetResponseStream()
      if ($null -ne $stream) {
        $reader = [System.IO.StreamReader]::new($stream)
        $errorBody = $reader.ReadToEnd()
        if (-not [string]::IsNullOrWhiteSpace($errorBody)) {
          Write-Host "Erro retornado pela Hostinger:"
          Write-Host $errorBody
        }
      }
    }
    throw
  }
}

function Has-Property($Object, [string]$Name) {
  if ($null -eq $Object) {
    return $false
  }
  return $null -ne ($Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1)
}

function Is-ZoneRecordObject($Object) {
  return (Has-Property $Object "name") -and (Has-Property $Object "type") -and (Has-Property $Object "records")
}

function Find-ZoneItems($Node) {
  $found = @()
  if ($null -eq $Node -or $Node -is [string]) {
    return $found
  }

  if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [pscustomobject])) {
    foreach ($item in $Node) {
      $found += Find-ZoneItems $item
    }
    return $found
  }

  if (Is-ZoneRecordObject $Node) {
    return @($Node)
  }

  foreach ($property in $Node.PSObject.Properties) {
    if ($property.Name -in @("records")) {
      continue
    }
    $found += Find-ZoneItems $property.Value
  }
  return $found
}

function Normalize-Name([string]$Name) {
  $text = ([string]$Name).Trim().TrimEnd(".")
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq "@" -or $text -ieq $Domain) {
    return "@"
  }
  return $text
}

function Normalize-Txt([string]$Value) {
  return ([string]$Value).Trim()
}

function Is-HostingSiteTxt([string]$Value) {
  $text = Normalize-Txt $Value
  if ($text.Length -ge 2 -and $text.StartsWith('"') -and $text.EndsWith('"')) {
    $text = $text.Substring(1, $text.Length - 2)
  }
  return $text -like "hosting-site=*"
}

function To-HostingerTxtContent([string]$Value) {
  $text = Normalize-Txt $Value
  if ($text.Length -ge 2 -and $text.StartsWith('"') -and $text.EndsWith('"')) {
    return $text
  }
  return '"' + $text + '"'
}

$currentResponse = Invoke-HostingerJson -Method Get -Uri $BaseUrl
$zone = @(Find-ZoneItems $currentResponse)

if ($zone.Count -eq 0) {
  throw "Nao consegui interpretar a zona DNS retornada pela Hostinger."
}

$rootTxt = $zone | Where-Object { (Normalize-Name $_.name) -eq "@" -and ([string]$_.type).ToUpperInvariant() -eq "TXT" } | Select-Object -First 1
if ($null -eq $rootTxt) {
  throw "Nao encontrei o grupo @ TXT atual. Parei para nao arriscar registros de e-mail/verificacao."
}

$txtRecords = @()
$removedFirebaseTxt = $false
$seenTxt = @{}
foreach ($record in @($rootTxt.records)) {
  if ($null -eq $record.content -or [string]::IsNullOrWhiteSpace([string]$record.content)) {
    continue
  }

  $content = [string]$record.content
  if (Is-HostingSiteTxt $content) {
    $removedFirebaseTxt = $true
    continue
  }

  $content = To-HostingerTxtContent $content
  if (-not $seenTxt.ContainsKey($content)) {
    $seenTxt[$content] = $true
    $txtRecords += @{ content = $content }
  }
}

if ($txtRecords.Count -eq 0) {
  throw "Nao sobrou nenhum TXT raiz apos remover hosting-site=*. Parei para proteger a zona."
}

$updatePayload = @{
  overwrite = $true
  zone = @(
    @{
      name = "app"
      type = "A"
      ttl = 300
      records = @(@{ content = $IpAddress })
    },
    @{
      name = "@"
      type = "TXT"
      ttl = [int](@($rootTxt.ttl | Select-Object -First 1)[0])
      records = $txtRecords
    }
  )
}

$deletePayload = @{
  filters = @(
    @{ name = "app"; type = "CNAME" },
    @{ name = "app"; type = "A" },
    @{ name = "app"; type = "AAAA" }
  )
}

Write-Host "Plano DNS Google Cloud:"
Write-Host " - Deletar somente app CNAME/A/AAAA antigos."
Write-Host " - Criar app A -> $IpAddress."
Write-Host " - Remover TXT Firebase hosting-site=*:" $removedFirebaseTxt
Write-Host " - Preservar demais TXT raiz:" $txtRecords.Count
Write-Host " - Nao alterar MX, DKIM, DMARC, SPF fora do grupo @ TXT."

Write-Host "Validando update cirurgico na Hostinger..."
Invoke-HostingerJson -Method Post -Uri "$BaseUrl/validate" -Body $updatePayload | Out-Null
Write-Host "Validacao OK."

if (-not $Apply) {
  Write-Host "Dry-run concluido. Para aplicar, rode novamente com -Apply."
  exit 0
}

Write-Host "Deletando app CNAME/A/AAAA antigos..."
Invoke-HostingerJson -Method Delete -Uri $BaseUrl -Body $deletePayload | Out-Null

Write-Host "Aplicando app A e @ TXT..."
Invoke-HostingerJson -Method Put -Uri $BaseUrl -Body $updatePayload | Out-Null

Write-Host "DNS aplicado. app.dutelog.com.br deve apontar para A $IpAddress."
