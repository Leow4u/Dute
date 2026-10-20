param(
  # Grupo a trocar: "app", "@" (raiz) etc. Aceita tambem "app.dutelog.com.br".
  [Parameter(Mandatory = $true)][string]$Nome,
  # Fotos da zona: <Pasta>\dns-zona-antes-<Rotulo>.json e dns-zona-depois-<Rotulo>.json
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Rotulo,
  # Padrao: Load Balancer do dute-prod. A volta para o dute-btg passa o IP dele.
  [string]$Ip = "34.54.243.247",
  [ValidateRange(60, 86400)][int]$Ttl = 300,
  [switch]$Apply,
  [string]$Pasta = ""
)

# Troca um unico registro A da zona dutelog.com.br na Hostinger sem tocar no
# resto (MX, SPF, DKIM e DMARC da Microsoft e da Hostinger, registros do
# Lovable, CNAMEs _acme-challenge_drmxqhwlpiaruyad* do Certificate Manager):
#   1. fotografa a zona em .secrets\fase-1\dns-zona-antes-<Rotulo>.json;
#   2. valida na Hostinger (POST /validate) um PUT com overwrite e um grupo so,
#      <Nome> (A), com um IP;
#   3. com -Apply, aplica, fotografa de novo (dns-zona-depois-<Rotulo>.json) e
#      para com erro se mudou qualquer grupo alem de <Nome> (A) ou se ele nao
#      ficou como o planejado.
# Sem -Apply, so fotografa, mostra o plano e valida. DNS so com OK do Leonardo.
#
# O token vem so de $env:HOSTINGER_API_TOKEN e nao vai para arquivo. Rotulo de
# troca ja aplicada (foto "depois" existe) e recusado, para nao sobrescrever o
# registro dela.

$ErrorActionPreference = "Stop"
$Domain = "dutelog.com.br"
$BaseUrl = "https://developers.hostinger.com/api/dns/v1/zones/$Domain"
# No Windows PowerShell 5.1 o $PSScriptRoot chega vazio no param(); por isso aqui.
if (-not $Pasta) { $Pasta = Join-Path (Join-Path (Join-Path $PSScriptRoot "..") ".secrets") "fase-1" }

function Parar([string]$Mensagem) {
  Write-Host $Mensagem -ForegroundColor Red
  exit 1
}

function Nome-Relativo([string]$Valor) {
  $n = $Valor.Trim().TrimEnd(".").ToLowerInvariant()
  if ($n -eq "" -or $n -eq "@" -or $n -eq $Domain) { return "@" }
  if ($n.EndsWith(".$Domain")) { return $n.Substring(0, $n.Length - $Domain.Length - 1) }
  return $n
}

# Grupo = nome + tipo: e o que o PUT com overwrite substitui inteiro.
function Chave($Grupo) {
  return "$(Nome-Relativo ([string]$Grupo.name))|$(([string]$Grupo.type).ToUpperInvariant())"
}

# TTL e conteudos em ordem; registro desativado conta como diferente.
function Resumo($Grupo) {
  $conteudos = @($Grupo.records | ForEach-Object {
      "$($_.content)$(if ($_.is_disabled) { ' (desativado)' })"
    } | Sort-Object)
  return "ttl=$($Grupo.ttl) " + ($conteudos -join " ; ")
}

function Mapa($Zona) {
  $mapa = [ordered]@{}
  foreach ($grupo in $Zona) {
    $chave = Chave $grupo
    if ($mapa.Contains($chave)) { Parar "Grupo repetido na zona: $chave. Parei." }
    $mapa[$chave] = Resumo $grupo
  }
  return $mapa
}

# Imprime cada grupo que mudou, criado ou apagado, e devolve as chaves.
function Comparar($Antes, $Depois) {
  $a = Mapa $Antes
  $d = Mapa $Depois
  $mudaram = @()
  foreach ($chave in @($a.Keys) + @($d.Keys | Where-Object { -not $a.Contains($_) })) {
    $va = if ($a.Contains($chave)) { $a[$chave] } else { "(nao existe)" }
    $vd = if ($d.Contains($chave)) { $d[$chave] } else { "(nao existe)" }
    if ($va -ne $vd) {
      $mudaram += $chave
      Write-Host "  $chave"
      Write-Host "    antes:  $va"
      Write-Host "    depois: $vd"
    }
  }
  Write-Host "Grupos: $($a.Count) antes, $($d.Count) depois; mudaram: $($mudaram.Count)"
  return , $mudaram
}

$alvo = Nome-Relativo $Nome
$chaveAlvo = "$alvo|A"
$plano = "ttl=$Ttl $Ip"

$ipLido = $null
if (-not [System.Net.IPAddress]::TryParse($Ip, [ref]$ipLido) -or
  $ipLido.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $ipLido.ToString() -ne $Ip) {
  Parar "IP invalido para registro A: $Ip"
}

$antesArq = Join-Path $Pasta "dns-zona-antes-$Rotulo.json"
$depoisArq = Join-Path $Pasta "dns-zona-depois-$Rotulo.json"
if (Test-Path -LiteralPath $depoisArq) {
  Parar "Ja existe $($depoisArq): o rotulo $Rotulo e de uma troca aplicada. Use outro rotulo."
}

if ([string]::IsNullOrWhiteSpace($env:HOSTINGER_API_TOKEN)) {
  Parar "HOSTINGER_API_TOKEN nao esta neste processo. Defina antes de rodar."
}
$Headers = @{
  Authorization = "Bearer $env:HOSTINGER_API_TOKEN"
  "Content-Type" = "application/json"
  "User-Agent" = "Mozilla/5.0"
}

function Api([string]$Metodo, [string]$Uri, $Corpo = $null) {
  $params = @{ Method = $Metodo; Uri = $Uri; Headers = $Headers }
  if ($null -ne $Corpo) { $params.Body = ConvertTo-Json -InputObject $Corpo -Depth 20 }
  try {
    return Invoke-RestMethod @params
  } catch {
    $detalhe = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    Parar "Hostinger ($Metodo $Uri): $detalhe"
  }
}

function E-Grupo($Item) {
  if ($null -eq $Item -or $Item -is [string] -or $Item -is [System.Array]) { return $false }
  $nomes = @($Item.PSObject.Properties | ForEach-Object { $_.Name })
  return ($nomes -contains "name") -and ($nomes -contains "type") -and ($nomes -contains "records")
}

function Fotografar([string]$Arquivo) {
  # No PowerShell 7 o Invoke-RestMethod devolve a lista da zona como um objeto
  # so; o pipe a desenrola antes de contar os grupos.
  $zona = @(Api Get $BaseUrl | ForEach-Object { $_ })
  if ($zona.Count -eq 0 -or @($zona | Where-Object { -not (E-Grupo $_) }).Count -gt 0) {
    Parar "A Hostinger devolveu uma zona que nao entendi ($($zona.Count) itens). Parei."
  }
  ConvertTo-Json -InputObject $zona -Depth 20 | Set-Content -Encoding utf8 -LiteralPath $Arquivo
  return , $zona
}

New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$zona = Fotografar $antesArq
Write-Host "Zona $($Domain): $($zona.Count) grupos, foto em $antesArq"

$doNome = @($zona | Where-Object { (Nome-Relativo ([string]$_.name)) -eq $alvo })
$atual = @($doNome | Where-Object { (Chave $_) -eq $chaveAlvo })
if ($atual.Count -ne 1) {
  Parar "Esperava um grupo $alvo (A) na zona, achei $($atual.Count). Este script so troca registro A que ja existe."
}
$conflitos = @($doNome | Where-Object { ([string]$_.type).ToUpperInvariant() -in @("AAAA", "CNAME") })
if ($conflitos.Count -gt 0) {
  Parar "$alvo tambem tem $(@($conflitos | ForEach-Object { $_.type }) -join ', '): trocar so o A deixaria o nome dividido. Parei."
}
Write-Host "$alvo (A) agora: $(Resumo $atual[0])"

if ((Resumo $atual[0]) -eq $plano) {
  Write-Host "$alvo (A) ja esta em $plano. Nada a fazer."
  exit 0
}

$payload = @{
  overwrite = $true
  zone = @(@{ name = $alvo; type = "A"; ttl = $Ttl; records = @(@{ content = $Ip }) })
}
Write-Host "Plano: $alvo (A) -> $plano (PUT com overwrite, so este grupo)"
Api Post "$BaseUrl/validate" $payload | Out-Null
Write-Host "Validacao da Hostinger: ok"

if (-not $Apply) {
  Write-Host "Sem -Apply: nada mudou. Para aplicar, rode de novo com -Apply."
  exit 0
}

Api Put $BaseUrl $payload | Out-Null
Write-Host "Aplicado. Conferindo a zona..."

# A API pode levar alguns segundos para devolver o grupo novo.
for ($tentativa = 1; $tentativa -le 5; $tentativa++) {
  Start-Sleep -Seconds 3
  $depois = Fotografar $depoisArq
  $novo = @($depois | Where-Object { (Chave $_) -eq $chaveAlvo })
  if ($novo.Count -eq 1 -and (Resumo $novo[0]) -eq $plano) { break }
}
Write-Host "Foto depois em $depoisArq"

$mudaram = Comparar $zona $depois
$fora = @($mudaram | Where-Object { $_ -ne $chaveAlvo })
if ($fora.Count -gt 0) {
  Parar "ERRO: mudou fora de $alvo (A): $($fora -join ', '). Compare as fotos antes e depois e corrija a mao."
}
if ($novo.Count -ne 1 -or (Resumo $novo[0]) -ne $plano) {
  $ficou = if ($novo.Count -eq 1) { Resumo $novo[0] } else { "(nao existe)" }
  Parar "ERRO: $alvo (A) ficou $ficou, e o plano era $plano."
}
Write-Host "OK: so $alvo (A) mudou, agora $plano."
exit 0
