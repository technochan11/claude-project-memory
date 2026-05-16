$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Label = 'com.claude-project-memory'
$TaskName = 'ClaudeProjectMemory'
$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DataDir = Join-Path $env:APPDATA 'claude-project-memory'
$LogsDir = Join-Path $DataDir 'logs'

Write-Host "[setup] label: $Label"
Write-Host "[setup] task:  $TaskName"
Write-Host "[setup] repo:  $RepoDir"
Write-Host "[setup] data:  $DataDir"
Write-Host "[setup] logs:  $LogsDir"

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

if (-not (Test-Path (Join-Path $RepoDir 'node_modules'))) {
  Write-Error "[setup] node_modules not present — run 'npm install' first."
}

$NodeCmd = Get-Command node -ErrorAction Stop
$NodeBin = $NodeCmd.Source
$ServerEntry = Join-Path $RepoDir 'packages/web-app/src/server/index.ts'
$TsxBin = Join-Path $RepoDir 'node_modules/.bin/tsx.cmd'
if (-not (Test-Path $TsxBin)) {
  Write-Error "[setup] tsx not installed at $TsxBin. Run 'npm install' first."
}

$Action = New-ScheduledTaskAction -Execute $TsxBin -Argument "`"$ServerEntry`"" -WorkingDirectory $RepoDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Setup complete. Open http://localhost:47823 to finish configuration."
Write-Host "(First run downloads the ~20MB embeddings model; expect 30s-2min before /api/health reports embeddings_ready:true.)"
