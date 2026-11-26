param(
  [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "logs\server.pid"

function Show-Message([string]$Message) {
  if ($NoPrompt) {
    Write-Host $Message
    return
  }
  try {
    Add-Type -AssemblyName PresentationFramework | Out-Null
    [System.Windows.MessageBox]::Show($Message, "Alive", "OK", "Information") | Out-Null
  } catch {
    Write-Host $Message
  }
}

if (-not (Test-Path $PidFile)) {
  Show-Message "Alive is not running (no pid file)."
  exit 0
}

$serverId = 0
$raw = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not [int]::TryParse([string]$raw, [ref]$serverId)) {
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Show-Message "The pid file was invalid and has been removed."
  exit 0
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId" -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Show-Message "Alive is already stopped."
  exit 0
}

$expected = (Join-Path $Root "dist\server\index.js")
if (-not $process.CommandLine -or $process.CommandLine.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  Show-Message "The recorded process does not look like Alive. Nothing was stopped.`n`nPID: $serverId"
  exit 1
}

Stop-Process -Id $serverId -Force
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 250
  if (-not (Get-Process -Id $serverId -ErrorAction SilentlyContinue)) { break }
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Show-Message "Alive has been stopped."
