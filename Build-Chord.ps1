$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$env:Path = "$(Split-Path $node);$env:Path"
Set-Location $projectRoot
Copy-Item mobile\private-config.js chord-mobile\private-config.js -Force
& $pnpm exec vite build --config vite.chord.config.ts
$target = Join-Path $projectRoot "chord-android\app\src\main\assets\public"
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item chord-dist\* $target -Recurse -Force
wsl -d Ubuntu-26.04 -- bash -lc "cd /mnt/c/Users/p/Documents/Codex/2026-07-30/b/chord-android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=/home/pr/Android/Sdk ANDROID_SDK_ROOT=/home/pr/Android/Sdk ./gradlew assembleDebug --no-daemon"
