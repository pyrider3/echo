[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeDir = Join-Path $projectRoot "bridge"
$workDir = Join-Path $projectRoot "work"
$envFile = Join-Path $bridgeDir ".env.local"
$bridgeServer = Join-Path $bridgeDir "server.mjs"
$nodePath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$wslExe = Join-Path $env:WINDIR "System32\wsl.exe"
$distro = "Ubuntu-26.04"
$publicUrl = "https://arichm.dpdns.org"
$launcherLog = Join-Path $workDir "launcher.log"

New-Item -ItemType Directory -Path $workDir -Force | Out-Null

function Write-Step([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message) -ForegroundColor $Color
  Add-Content -LiteralPath $launcherLog -Encoding utf8 -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Get-BridgeHealth {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:8006/health" -TimeoutSec 2 } catch { return $null }
}

function Test-WslProcess([string]$Pattern) {
  & $wslExe -d $distro -- pgrep -f $Pattern *> $null
  return ($LASTEXITCODE -eq 0)
}

function Start-WslService([string]$DisplayName, [string]$Pattern, [string]$ScriptName) {
  if (Test-WslProcess $Pattern) {
    Write-Step "$DisplayName 已在运行。" DarkGray
    return
  }
  Write-Step "正在启动 $DisplayName..." Cyan
  Start-Process -FilePath $wslExe -ArgumentList @("-d", $distro, "--", "bash", "$wslProject/bridge/$ScriptName") -WindowStyle Hidden | Out-Null
}

try {
  Write-Step "开始检查回声服务环境..." Cyan
  foreach ($requiredPath in @($envFile, $bridgeServer, $nodePath, $wslExe)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "缺少必要文件：$requiredPath" }
  }

  $distroNames = (& $wslExe -l -q 2>$null) -replace "`0", ""
  if ($distroNames -notcontains $distro) { throw "未找到 WSL 发行版 $distro，请先确认 Ubuntu 已安装并可启动。" }

  Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
  $voiceProvider = if ($env:ECHO_VOICE_PROVIDER) { $env:ECHO_VOICE_PROVIDER.ToLowerInvariant() } else { "local" }
  $useCloudVoice = $voiceProvider -eq "aliyun"
  if ($useCloudVoice -and (-not $env:DASHSCOPE_API_KEY -or -not $env:DASHSCOPE_WORKSPACE_ID)) {
    throw "已选择阿里云语音，但 DASHSCOPE_API_KEY 或 DASHSCOPE_WORKSPACE_ID 尚未填写。"
  }

  if ($projectRoot -notmatch '^([A-Za-z]):\\(.*)$') { throw "无法把项目路径转换为 WSL 路径：$projectRoot" }
  $driveLetter = $matches[1].ToLowerInvariant()
  $pathTail = $matches[2] -replace '\\', '/'
  $wslProject = "/mnt/$driveLetter/$pathTail"

  $health = Get-BridgeHealth
  if ($health -and $health.service -eq "echo-computer-bridge") {
    Write-Step "桥接服务已在运行。" DarkGray
  } else {
    if (Get-NetTCPConnection -LocalPort 8006 -State Listen -ErrorAction SilentlyContinue) {
      throw "端口 8006 已被其他程序占用，请关闭占用程序后重试。"
    }
    Write-Step "正在启动电脑桥接服务..." Cyan
    Start-Process -FilePath $nodePath -ArgumentList $bridgeServer -WorkingDirectory $projectRoot -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $workDir "bridge.log") `
      -RedirectStandardError (Join-Path $workDir "bridge-error.log") | Out-Null
  }

  $useCosyVoice = $false
  if ($useCloudVoice) {
    Write-Step "使用阿里云 CosyVoice，跳过本地语音模型和专业档。" Green
  } else {
    Start-WslService "语音克隆服务" "uvicorn voice_server:app" "start_voice.sh"
    $voiceEngineFile = Join-Path $workDir "voice-engine.txt"
    $useCosyVoice = (Test-Path -LiteralPath $voiceEngineFile) -and ((Get-Content -LiteralPath $voiceEngineFile -Raw).Trim() -eq "cosyvoice")
    if ($useCosyVoice) { Start-WslService "CosyVoice" "uvicorn cosyvoice_server:app" "start_cosyvoice.sh" }
  }
  Start-WslService "Cloudflare 公网隧道" "cloudflared.*run (echo|0986f366-c473-490a-8113-383412067c9f)" "start_tunnel.sh"

  Write-Step "正在等待模型与接口就绪，这可能需要几十秒..." Yellow
  $allReady = $false
  for ($attempt = 1; $attempt -le 120; $attempt++) {
    $health = Get-BridgeHealth
    $voiceRunning = $useCloudVoice -and $health -and $health.voice -and $health.voice.configured
    if (-not $useCloudVoice) { $voiceRunning = Test-WslProcess "uvicorn voice_server:app" }
    if (-not $useCloudVoice -and $useCosyVoice) {
      try { $voiceHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8009/health" -TimeoutSec 2; $voiceRunning = [bool]$voiceHealth.ok }
      catch { $voiceRunning = $false }
    }
    $tunnelRunning = Test-WslProcess "cloudflared.*run (echo|0986f366-c473-490a-8113-383412067c9f)"
    if ($health.ok -and $health.protected -and $voiceRunning -and $tunnelRunning) {
      $allReady = $true
      break
    }
    if (($attempt % 10) -eq 0) {
      Write-Step ("等待中：桥接={0}，语音={1}，隧道={2}" -f [bool]$health.ok, $voiceRunning, $tunnelRunning) DarkGray
    }
    Start-Sleep -Seconds 1
  }
  if (-not $allReady) { throw "服务未能在 120 秒内全部就绪，请查看 $workDir 中的日志。" }

  Write-Step "本机服务已全部就绪，正在验证公网地址..." Cyan
  $publicReady = $false
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
      $publicHealth = Invoke-RestMethod -Uri "$publicUrl/health" -TimeoutSec 5
      if ($publicHealth.ok -and $publicHealth.service -eq "echo-computer-bridge") { $publicReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  Write-Host ""
  Write-Step "回声服务已全部启动。" Green
  if ($publicReady) {
    Write-Host "公网地址：$publicUrl" -ForegroundColor Cyan
    Write-Host "云端声音克隆和手机异地访问现在均可使用。" -ForegroundColor Green
  } else {
    Write-Step "本机服务正常，但当前网络未能连接 Cloudflare；局域网仍可使用。" Yellow
    Write-Host "这通常由 VPN/代理拦截 Cloudflare Tunnel 引起，可关闭 VPN 后再次运行。" -ForegroundColor Yellow
  }
  Write-Host "使用期间请保持电脑开机；再次运行不会重复启动服务。" -ForegroundColor DarkGray
  exit 0
} catch {
  Write-Host ""
  Write-Step ("启动失败：" + $_.Exception.Message) Red
  Write-Host "日志目录：$workDir" -ForegroundColor Yellow
  exit 1
}
