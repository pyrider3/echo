$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$env:Path = "$(Split-Path $node);$env:Path"
Set-Location $projectRoot

Remove-Item Env:VITE_APP_VARIANT -ErrorAction SilentlyContinue
& $pnpm exec vite build --config vite.mobile.config.ts
& $node .\node_modules\@capacitor\cli\bin\capacitor sync android

$env:VITE_APP_VARIANT = "chord"
& $pnpm exec vite build --config vite.mobile.config.ts
$chordAssets = Join-Path $projectRoot "android\app\src\chord\assets\public"
$resolvedProject = [IO.Path]::GetFullPath($projectRoot)
$resolvedChord = [IO.Path]::GetFullPath($chordAssets)
if (-not $resolvedChord.StartsWith($resolvedProject, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe chord asset path" }
New-Item -ItemType Directory -Force $chordAssets | Out-Null
Get-ChildItem -LiteralPath $chordAssets -Force | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "mobile-dist\*") -Destination $chordAssets -Recurse -Force

wsl -d Ubuntu-26.04 -- bash -lc "cd /mnt/c/Users/p/Documents/Codex/2026-07-30/b/android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=/home/pr/Android/Sdk ANDROID_SDK_ROOT=/home/pr/Android/Sdk ./gradlew assembleEchoDebug assembleChordDebug --no-daemon"
