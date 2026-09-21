@echo off
chcp 65001 >nul
title 蠢驴电竞-陪玩端一键安装
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set PS1=%TEMP%\chunlv-install-companion.ps1
echo.
echo 蠢驴电竞 - 陪玩端一键安装
echo 正在下载安装脚本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://1.117.229.36:3001/uploads/install-companion.ps1' -OutFile '%PS1%' -UseBasicParsing"
if not exist "%PS1%" (
  echo 下载失败：请确认这台电脑能上网。
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
