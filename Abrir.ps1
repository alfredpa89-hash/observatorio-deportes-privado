param([switch]$NoBrowser, [switch]$Restart)

$ErrorActionPreference = 'Stop'
$appDirectory = $PSScriptRoot
$baseUrl = 'http://127.0.0.1:4173'
$running = $false
try {
  $state = Invoke-RestMethod -Uri "$baseUrl/api/state" -TimeoutSec 2
  $running = $state.app -eq 'observatorio-futbol'
} catch { }
if ($running -and $Restart) {
  if ($state.appDirectory -ne $appDirectory) { throw 'El puerto pertenece a otra copia del programa o a una version antigua. No se detiene automaticamente.' }
  Invoke-RestMethod -Method Post -Uri "$baseUrl/api/server/stop" -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
  $running = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod -Uri "$baseUrl/api/state" -TimeoutSec 1 | Out-Null } catch { break }
  }
}
if (-not $running) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($nodeCommand) { $nodeCommand.Source }),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique
  $nodeExecutable = $null
  foreach ($candidate in $candidates) {
    try {
      $version = & $candidate --version
      if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
        $nodeExecutable = $candidate
        break
      }
    } catch { }
  }
  if (-not $nodeExecutable) { throw 'No se encontro Node.js 24 o posterior. Los datos guardados no se han modificado.' }
  $logDirectory = Join-Path $appDirectory 'data'
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $previousPort = $env:PORT
  $previousDataDirectory = $env:OBSERVATORIO_DATA_DIR
  try {
    $env:PORT = '4173'
    $env:OBSERVATORIO_DATA_DIR = $logDirectory
    $server = Start-Process -FilePath $nodeExecutable -ArgumentList 'server.mjs' -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'server.stderr.log')
  } finally {
    $env:PORT = $previousPort
    $env:OBSERVATORIO_DATA_DIR = $previousDataDirectory
  }
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $state = Invoke-RestMethod -Uri "$baseUrl/api/state" -TimeoutSec 1
      if ($state.app -eq 'observatorio-futbol') { $running = $true; break }
    } catch { }
    $server.Refresh()
    if ($server.HasExited) { break }
  }
}
if (-not $running) { throw 'No se pudo iniciar el programa. Comprueba que el puerto 4173 este libre; el diagnostico esta en data\server.stderr.log. Los historicos se conservan.' }
Write-Output "Aplicacion disponible en $baseUrl"
if (-not $NoBrowser) { Start-Process $baseUrl }
