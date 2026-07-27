$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host '========================================'
Write-Host '          Iniciando Alya...'
Write-Host '========================================'
Write-Host ''

$toolsDir = Join-Path $projectRoot 'tools'
if (-not (Test-Path $toolsDir)) {
  New-Item -ItemType Directory -Path $toolsDir | Out-Null
}

$cloudflaredPath = Join-Path $toolsDir 'cloudflared.exe'

if (-not (Test-Path $cloudflaredPath)) {
  Write-Host 'Baixando cloudflared...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Invoke-WebRequest -Uri $url -OutFile $cloudflaredPath
  Write-Host 'Download concluido.'
  Write-Host ''
}

function Get-PortProcess {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object State -eq 'Listen'
  if (-not $connections) {
    return $null
  }
  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
      return $proc
    }
  }
  return $null
}

function Stop-PortProcess {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object State -eq 'Listen'
  if (-not $connections) {
    return $false
  }
  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "Finalizando processo antigo: $($proc.ProcessName) (PID $processId) na porta $Port"
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
  $remaining = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object State -eq 'Listen'
  return (-not $remaining)
}

$port = 3000
$existingProcess = Get-PortProcess -Port $port

if ($existingProcess) {
  Write-Host "Porta $port em uso por: $($existingProcess.ProcessName) (PID $($existingProcess.Id))"
  $freed = Stop-PortProcess -Port $port
  if (-not $freed) {
    Write-Host ''
    Write-Host 'Erro: Nao foi possivel liberar a porta 3000.'
    Write-Host 'Feche manualmente o programa que esta usando a porta e tente novamente.'
    pause
    exit 1
  }
  Write-Host "Porta $port liberada com sucesso."
  Write-Host ''
}

Write-Host 'Iniciando servidor Node.js...'
$env:PORT = '3000'
$server = Start-Process -FilePath 'node' -ArgumentList 'server.js' -PassThru -WorkingDirectory $projectRoot -WindowStyle Minimized

Write-Host ''
Write-Host 'Aguardando servidor...'

$maxRetries = 30
$retry = 0
$serverReady = $false
while ($retry -lt $maxRetries) {
  try {
    $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/aly-link' -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $serverReady = $true
      break
    }
  } catch {
    $retry++
    Start-Sleep -Seconds 2
  }
}

if (-not $serverReady) {
  Write-Host ''
  Write-Host 'Erro: Nao foi possivel iniciar o servidor.'
  Write-Host 'Verifique se a porta 3000 esta disponivel.'
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  pause
  exit 1
}

Write-Host ''
Write-Host '========================================'
Write-Host '🟢 Servidor iniciado com sucesso'
Write-Host '========================================'
Write-Host ''
Write-Host '🌐 Alya disponivel em http://localhost:3000/aly'
Write-Host ''

try {
  $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/aly-link' -UseBasicParsing -TimeoutSec 2
  $data = $response.Content | ConvertFrom-Json
  $chatUrl = $data.chatUrl
  Write-Host 'Link publico: ' -NoNewline
  Write-Host $chatUrl -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Compartilhe esse link com seus amigos!'
  Write-Host ''
  Write-Host 'Pressione Ctrl+C para encerrar.'
  Write-Host ''

  $opened = $false
  $bravePaths = @(
    "$env:PROGRAMFILES\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:PROGRAMFILES(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
  )
  foreach ($bravePath in $bravePaths) {
    if (Test-Path $bravePath) {
      Start-Process $bravePath $chatUrl
      $opened = $true
      break
    }
  }
  if (-not $opened) {
    Start-Process $chatUrl
  }
} catch {
  Write-Host 'Nao foi possivel obter o link publico automaticamente.'
  Write-Host 'Acesse manualmente: http://localhost:3000/aly'
}

Write-Host ''
try {
  Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
} catch {
  Write-Host ''
  Write-Host 'Servidor encerrado.'
}
