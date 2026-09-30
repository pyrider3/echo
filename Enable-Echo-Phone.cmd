@echo off
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh.exe advfirewall firewall delete rule name="Echo Phone Bridge 8006" >nul 2>&1
netsh.exe advfirewall firewall add rule name="Echo Phone Bridge 8006" dir=in action=allow protocol=TCP localport=8006 profile=any

echo.
echo Echo port 8006 is now allowed through Windows Firewall.
echo Keep this computer and the phone on the same Wi-Fi, then retry Professional mode.
echo.
pause
