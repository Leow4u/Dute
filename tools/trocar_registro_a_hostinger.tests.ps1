# Testes do trocar_registro_a_hostinger.ps1 sem chamar a API da Hostinger: um
# "Invoke-RestMethod" de mentira guarda a zona e as chamadas e devolve a lista
# como o PowerShell 7 devolve (um objeto so). Rode com:
#   pwsh -NoProfile -File tools/trocar_registro_a_hostinger.tests.ps1

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "trocar_registro_a_hostinger.ps1"
$failures = 0
$token = "token-de-teste-$([guid]::NewGuid())"
$tokenAnterior = $env:HOSTINGER_API_TOKEN
$env:HOSTINGER_API_TOKEN = $token
$raizTemp = Join-Path ([System.IO.Path]::GetTempPath()) "dns-registro-a-testes-$([guid]::NewGuid())"
$global:deletes = 0

function Grupo([string]$name, [string]$type, [int]$ttl, [string[]]$contents) {
  return [pscustomobject]@{
    name = $name; type = $type; ttl = $ttl
    records = @($contents | ForEach-Object { [pscustomobject]@{ content = $_; is_disabled = $false } })
  }
}

# Zona no formato da dutelog.com.br de 20/10/2026, com valores de mentira.
function Reset-Fake {
  $global:zona = @(
    (Grupo "@" "A" 300 @("34.54.243.247")),
    (Grupo "app" "A" 300 @("8.232.54.179")),
    (Grupo "www" "CNAME" 300 @("dutelog.com.br.")),
    (Grupo "@" "MX" 3600 @("0 dutelog-com-br.mail.protection.outlook.com.")),
    (Grupo "@" "TXT" 3600 @('"v=spf1 include:spf.protection.outlook.com -all"', '"hosting-site=dute-btg-app"', '"MS=ms00000000"')),
    (Grupo "_dmarc" "TXT" 3600 @('"v=DMARC1; p=none"')),
    (Grupo "hostingermail-a._domainkey" "CNAME" 300 @("hostingermail-a.dkim.mail.hostinger.com.")),
    (Grupo "notify" "CNAME" 3600 @("ns5.lovable.cloud.")),
    (Grupo "_acme-challenge_drmxqhwlpiaruyad.app" "CNAME" 300 @("00000000-0000.1.authorize.certificatemanager.goog.")),
    (Grupo "lab" "A" 3600 @("185.158.133.1"))
  )
  $global:chamadas = @()
  $global:sonos = 0
  $global:validaFalha = $false
  $global:aoAplicar = $null
  $global:pasta = Join-Path $raizTemp ([guid]::NewGuid())
}

# Como a API real: GET devolve a zona (objetos novos a cada leitura), POST
# /validate so confere, PUT com overwrite troca o grupo de mesmo nome e tipo.
function global:Invoke-RestMethod {
  param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Body)
  $global:chamadas += , [pscustomobject]@{ Method = $Method; Uri = $Uri; Body = $Body; Auth = $Headers.Authorization }
  if ($Method -eq "Get") {
    $copia = @(ConvertTo-Json -InputObject @($global:zona) -Depth 10 | ConvertFrom-Json | ForEach-Object { $_ })
    Write-Output -NoEnumerate $copia
    return
  }
  if ($Method -eq "Delete") { $global:deletes++; return }
  if ($Uri -like "*/validate") {
    if ($global:validaFalha) { throw "422 Unprocessable Entity: zone invalida" }
    return
  }
  if ($Method -eq "Put") {
    $pedido = $Body | ConvertFrom-Json
    foreach ($novo in @($pedido.zone)) {
      $global:zona = @($global:zona | Where-Object { -not ($_.name -eq $novo.name -and $_.type -eq $novo.type) }) +
        @(Grupo $novo.name $novo.type $novo.ttl @($novo.records | ForEach-Object { $_.content }))
    }
    if ($global:aoAplicar) { & $global:aoAplicar }
  }
}

function global:Start-Sleep { $global:sonos++ }

function Run-Script([hashtable]$params) {
  $params.Pasta = $global:pasta
  $global:LASTEXITCODE = -1
  try {
    $output = & $script @params *>&1 | Out-String
    $exit = $global:LASTEXITCODE
  } catch {
    $output = "EXCECAO: $_"
    $exit = "excecao"
  }
  return @{ Output = $output; Exit = $exit }
}

function Expect([string]$name, [bool]$condition, [string]$detail) {
  if ($condition) { Write-Host "ok   $name" }
  else { Write-Host "FAIL $name`n$detail" -ForegroundColor Red; $script:failures++ }
}

function Chamadas([string]$Method) { return @($global:chamadas | Where-Object { $_.Method -eq $Method }) }

# O corpo pedido: overwrite e um grupo so, com um IP.
function Corpo-Ok($chamada, [string]$name, [string]$ip, [int]$ttl) {
  if ($null -eq $chamada) { return $false }
  $corpo = $chamada.Body | ConvertFrom-Json
  $grupos = @($corpo.zone)
  $records = @($grupos[0].records)
  return $corpo.overwrite -eq $true -and $grupos.Count -eq 1 -and $grupos[0].name -eq $name -and
    $grupos[0].type -eq "A" -and $grupos[0].ttl -eq $ttl -and $records.Count -eq 1 -and $records[0].content -eq $ip
}

function Do-Grupo([string]$name, [string]$type) {
  return @($global:zona | Where-Object { $_.name -eq $name -and $_.type -eq $type })[0]
}

function Arquivo([string]$tipo, [string]$rotulo) { return Join-Path $global:pasta "dns-zona-$tipo-$rotulo.json" }

try {
  Reset-Fake
  Expect "a falsa devolve a zona como um objeto so, como o PowerShell 7" (
    @(Invoke-RestMethod -Method Get -Uri "x" -Headers @{}).Count -eq 1
  ) ""

  Reset-Fake
  $antes = ConvertTo-Json -InputObject $global:zona -Depth 10
  $result = Run-Script @{ Nome = "app"; Rotulo = "t1" }
  $validate = @(Chamadas "Post")[0]
  Expect "sem -Apply fotografa, valida um grupo so e nao muda nada" (
    $result.Exit -eq 0 -and (Test-Path (Arquivo "antes" "t1")) -and -not (Test-Path (Arquivo "depois" "t1")) -and
    (Corpo-Ok $validate "app" "34.54.243.247" 300) -and $validate.Uri -like "*/zones/dutelog.com.br/validate" -and
    (Chamadas "Put").Count -eq 0 -and (ConvertTo-Json -InputObject $global:zona -Depth 10) -eq $antes -and
    $result.Output -match "Sem -Apply: nada mudou"
  ) $result.Output
  $foto = @()
  if (Test-Path (Arquivo "antes" "t1")) { $foto = @(Get-Content -Raw (Arquivo "antes" "t1") | ConvertFrom-Json | ForEach-Object { $_ }) }
  Expect "desenrola a lista: a foto e a contagem tem os 10 grupos" (
    $foto.Count -eq 10 -and $result.Output -match "Zona dutelog\.com\.br: 10 grupos"
  ) $result.Output
  Expect "o token vem do ambiente" ($validate.Auth -eq "Bearer $token") $validate.Auth

  $result = Run-Script @{ Nome = "app"; Rotulo = "t1"; Apply = $true }
  $put = @(Chamadas "Put")[0]
  $txt = Do-Grupo "@" "TXT"
  Expect "com -Apply troca so o app (A), confere e guarda as duas fotos" (
    $result.Exit -eq 0 -and (Corpo-Ok $put "app" "34.54.243.247" 300) -and
    (Do-Grupo "app" "A").records[0].content -eq "34.54.243.247" -and
    (Test-Path (Arquivo "antes" "t1")) -and (Test-Path (Arquivo "depois" "t1")) -and
    $result.Output -match "mudaram: 1" -and $result.Output -match "OK: so app \(A\) mudou"
  ) $result.Output
  Expect "o @ TXT continua com hosting-site e o resto" (
    @($txt.records).Count -eq 3 -and @($txt.records | Where-Object { $_.content -like '*hosting-site=*' }).Count -eq 1
  ) ($txt | ConvertTo-Json -Depth 5)

  $global:chamadas = @()
  $result = Run-Script @{ Nome = "app"; Rotulo = "t1"; Apply = $true }
  Expect "rotulo de troca ja aplicada e recusado antes de chamar a API" (
    $result.Exit -eq 1 -and $global:chamadas.Count -eq 0 -and $result.Output -match "troca aplicada"
  ) $result.Output

  Reset-Fake
  $result = Run-Script @{ Nome = "dutelog.com.br."; Rotulo = "raiz"; Ip = "8.232.54.179"; Ttl = 1800; Apply = $true }
  Expect "raiz pelo nome do dominio, com IP e TTL por parametro" (
    $result.Exit -eq 0 -and (Corpo-Ok @(Chamadas "Put")[0] "@" "8.232.54.179" 1800) -and
    (Do-Grupo "@" "A").ttl -eq 1800 -and (Do-Grupo "app" "A").records[0].content -eq "8.232.54.179" -and
    $result.Output -match "OK: so @ \(A\) mudou"
  ) $result.Output

  Reset-Fake
  $global:aoAplicar = {
    $txt = Do-Grupo "@" "TXT"
    $txt.records = @($txt.records | Where-Object { $_.content -notlike '*hosting-site=*' })
  }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t2"; Apply = $true }
  Expect "TXT da raiz mexido junto com o app para com erro" (
    $result.Exit -eq 1 -and $result.Output -match "mudou fora de app \(A\): @\|TXT" -and $result.Output -notmatch "OK:"
  ) $result.Output

  Reset-Fake
  $global:aoAplicar = { (Do-Grupo "@" "MX").ttl = 300 }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t3"; Apply = $true }
  Expect "TTL de outro grupo mudado conta" ($result.Exit -eq 1 -and $result.Output -match "mudou fora de app \(A\): @\|MX") $result.Output

  Reset-Fake
  $global:aoAplicar = { (Do-Grupo "_dmarc" "TXT").records[0].is_disabled = $true }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t4"; Apply = $true }
  Expect "registro desativado conta" ($result.Exit -eq 1 -and $result.Output -match "_dmarc\|TXT") $result.Output

  Reset-Fake
  $global:aoAplicar = {
    $global:zona = @($global:zona | Where-Object { $_.name -notlike "_acme-challenge*" }) + @(Grupo "novo" "A" 300 @("1.2.3.4"))
  }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t5"; Apply = $true }
  Expect "grupo apagado e grupo criado contam" (
    $result.Exit -eq 1 -and $result.Output -match "_acme-challenge_drmxqhwlpiaruyad\.app\|CNAME" -and
    $result.Output -match "novo\|A" -and $result.Output -match "\(nao existe\)"
  ) $result.Output

  Reset-Fake
  $global:aoAplicar = { $txt = Do-Grupo "@" "TXT"; $txt.records = @($txt.records)[2, 0, 1] }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t6"; Apply = $true }
  Expect "ordem dos registros dentro do grupo nao conta" ($result.Exit -eq 0 -and $result.Output -match "mudaram: 1") $result.Output

  Reset-Fake
  $global:aoAplicar = { (Do-Grupo "app" "A").records[0].content = "8.232.54.179" }
  $result = Run-Script @{ Nome = "app"; Rotulo = "t7"; Apply = $true }
  Expect "troca que nao pegou para com erro depois de reler a zona" (
    $result.Exit -eq 1 -and $result.Output -match "ficou ttl=300 8\.232\.54\.179" -and $global:sonos -eq 5
  ) $result.Output

  Reset-Fake
  $result = Run-Script @{ Nome = "ap"; Rotulo = "t8"; Apply = $true }
  Expect "nome inexistente (erro de digitacao) nao cria registro" (
    $result.Exit -eq 1 -and (Chamadas "Post").Count -eq 0 -and (Chamadas "Put").Count -eq 0 -and $result.Output -match "achei 0"
  ) $result.Output

  Reset-Fake
  $global:zona += Grupo "app" "AAAA" 300 @("2001:db8::1")
  $result = Run-Script @{ Nome = "app"; Rotulo = "t9"; Apply = $true }
  Expect "AAAA no mesmo nome para antes de validar" (
    $result.Exit -eq 1 -and (Chamadas "Post").Count -eq 0 -and $result.Output -match "app tambem tem AAAA"
  ) $result.Output

  Reset-Fake
  $result = Run-Script @{ Nome = "app"; Rotulo = "t10"; Ip = "34.54.243"; Apply = $true }
  Expect "IP invalido para sem chamar a API" ($result.Exit -eq 1 -and $global:chamadas.Count -eq 0) $result.Output

  Reset-Fake
  $global:validaFalha = $true
  $result = Run-Script @{ Nome = "app"; Rotulo = "t11"; Apply = $true }
  Expect "validacao recusada para antes do PUT" (
    $result.Exit -eq 1 -and (Chamadas "Put").Count -eq 0 -and $result.Output -match "422"
  ) $result.Output

  Reset-Fake
  (Do-Grupo "app" "A").records[0].content = "34.54.243.247"
  $result = Run-Script @{ Nome = "app"; Rotulo = "t12"; Apply = $true }
  Expect "registro ja no valor pedido nao valida nem aplica" (
    $result.Exit -eq 0 -and (Chamadas "Post").Count -eq 0 -and (Chamadas "Put").Count -eq 0 -and $result.Output -match "Nada a fazer"
  ) $result.Output

  Reset-Fake
  $env:HOSTINGER_API_TOKEN = ""
  $result = Run-Script @{ Nome = "app"; Rotulo = "t13"; Apply = $true }
  $env:HOSTINGER_API_TOKEN = $token
  Expect "sem token nao chama a API" ($result.Exit -eq 1 -and $global:chamadas.Count -eq 0) $result.Output

  Expect "nenhum DELETE em nenhum teste" ($global:deletes -eq 0) "$global:deletes"
  $comToken = @(Get-ChildItem -Recurse -File $raizTemp | Where-Object { (Get-Content -Raw $_.FullName) -match [regex]::Escape($token) })
  Expect "o token nao foi para nenhum arquivo" ($comToken.Count -eq 0) ($comToken.FullName -join "`n")
} finally {
  $env:HOSTINGER_API_TOKEN = $tokenAnterior
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $raizTemp
}

if ($failures -gt 0) {
  Write-Host "$failures teste(s) falharam." -ForegroundColor Red
  exit 1
}
Write-Host "Todos os testes passaram."
exit 0
