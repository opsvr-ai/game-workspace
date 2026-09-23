@echo off
chcp 65001 >nul
title 蠢驴电竞-陪玩端一键安装
rem 用 fltmc 判管理员：不依赖 net.exe，也不依赖 Server 服务开着
rem （新机器/被清理过的机器上 LanmanServer 常常是停的，net session 会把管理员误判成没权限，
rem  于是无限弹授权窗口；2026-09-24 修秦伟杰那台时确认了这个坑）
fltmc >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在弹出授权窗口，请点“是”...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set PS1=%TEMP%\chunlv-install-companion.ps1
echo.
echo 蠢驴电竞 - 陪玩端一键安装
echo 正在下载安装脚本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://1.117.229.36:3001/uploads/install-companion.ps1' -OutFile '%PS1%' -UseBasicParsing"
for %%A in ("%PS1%") do set PSIZE=%%~zA
if not defined PSIZE set PSIZE=0
if %PSIZE% LSS 8000 (
  echo 安装脚本没下全（%PSIZE% 字节）：请确认这台电脑能上网，再双击一次。
  pause
  exit /b 1
)
if not exist "%PS1%" (
  echo 下载失败：请确认这台电脑能上网。
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
