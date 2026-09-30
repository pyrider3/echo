param([ValidateSet('spark', 'cosyvoice')][string]$Engine = 'spark')
$ErrorActionPreference = 'Stop'
$port = if ($Engine -eq 'cosyvoice') { 8009 } else { 8007 }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 10
if (-not $health.ok -or -not $health.modelLoaded) {
    throw "$Engine is not ready. Selection was not changed."
}
$directory = Join-Path $PSScriptRoot 'work'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$target = Join-Path $directory 'voice-engine.txt'
$temporary = Join-Path $directory ('voice-engine-' + [guid]::NewGuid() + '.tmp')
[System.IO.File]::WriteAllText($temporary, $Engine, [System.Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $target -Force
Write-Host "Voice engine selected: $Engine. New requests use this engine; current audio is not interrupted."
