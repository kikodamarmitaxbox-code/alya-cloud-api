$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

trap {
  Write-Host ''
  Write-Host 'A Sofia encontrou um erro ao iniciar:' -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host ''
  [void](Read-Host 'Pressione Enter para fechar esta janela')
  exit 1
}

Write-Host '========================================'
Write-Host '          Iniciando Sofia...'
Write-Host '========================================'
Write-Host ''

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

$port = 3000
$existingProcess = Get-PortProcess -Port $port

if ($existingProcess) {
  try {
    $healthJson = & curl.exe --silent --max-time 2 'http://127.0.0.1:3000/health'
    $health = $healthJson | ConvertFrom-Json
    if ($health.ok -and $health.name -eq 'Sofia') {
      Write-Host 'A Sofia ja esta ligada.' -ForegroundColor Green
      Write-Host "Servidor: $($existingProcess.ProcessName) (PID $($existingProcess.Id))"
      Write-Host 'Chat privado: http://localhost:3000/aly' -ForegroundColor Cyan
      Write-Host 'Code Sofia:   http://localhost:3000/code-alya' -ForegroundColor Cyan
      Write-Host 'Discord:      ligado' -ForegroundColor Green
      Write-Host ''
      Start-Process 'http://localhost:3000/aly'
      Write-Host 'Esta janela ficara aberta ate voce fecha-la.'
      [void](Read-Host 'Pressione Enter somente se quiser fechar esta janela')
      exit 0
    }
  } catch {
    # A porta pertence a outro programa; a mensagem detalhada aparece abaixo.
  }

  Write-Host ''
  Write-Host "A porta $port esta sendo usada por outro programa: $($existingProcess.ProcessName) (PID $($existingProcess.Id))." -ForegroundColor Red
  Write-Host 'A Sofia nao encerrou esse programa por seguranca.'
  Write-Host 'Feche o programa manualmente e tente outra vez.'
  [void](Read-Host 'Pressione Enter para fechar esta janela')
  exit 1
}

$browserOpened = $false

while ($true) {
Write-Host 'Iniciando servidor Node.js...'
$env:PORT = '3000'
$server = Start-Process -FilePath 'node' -ArgumentList 'server.js' -PassThru -WorkingDirectory $projectRoot -NoNewWindow

Write-Host ''
Write-Host 'Aguardando servidor...'

$maxRetries = 30
$retry = 0
$serverReady = $false
while ($retry -lt $maxRetries) {
  try {
    $healthJson = & curl.exe --silent --max-time 2 'http://127.0.0.1:3000/health'
    $health = $healthJson | ConvertFrom-Json
    if ($health.ok -and $health.name -eq 'Sofia') {
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
  Write-Host 'A Sofia tentara iniciar novamente em 5 segundos.'
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 5
  continue
}

Write-Host ''
Write-Host '========================================'
Write-Host '🟢 Servidor iniciado com sucesso'
Write-Host '========================================'
Write-Host ''
$chatUrl = 'http://localhost:3000/aly'
Write-Host 'Chat privado: ' -NoNewline
Write-Host $chatUrl -ForegroundColor Cyan
Write-Host 'Code Sofia:   ' -NoNewline
Write-Host 'http://localhost:3000/code-alya' -ForegroundColor Cyan
Write-Host 'Discord:      ligado' -ForegroundColor Green
Write-Host ''
Write-Host 'A Sofia continuara ligada ate voce fechar esta janela ou pressionar Ctrl+C.'
Write-Host ''

if (-not $browserOpened) {
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
  $browserOpened = $true
}

Write-Host ''
try {
  Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
} catch {
  # Fechar a janela ou pressionar Ctrl+C encerra o processo compartilhado.
}

Write-Host ''
if ($server.HasExited) {
  Write-Host "A Sofia foi encerrada (codigo $($server.ExitCode))." -ForegroundColor Yellow
} else {
  Write-Host 'A Sofia foi encerrada.' -ForegroundColor Yellow
}
Write-Host 'Reiniciando automaticamente em 5 segundos. Feche esta janela para desligar de vez.'
Start-Sleep -Seconds 5
}
