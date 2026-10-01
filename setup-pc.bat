@echo off
chcp 65001 >nul
title 蠢驴电竞-新电脑一键装机
rem 用 fltmc 判管理员：不依赖 net.exe，也不依赖 Server 服务开着。
rem （新机器 / 被清理过的机器上 LanmanServer 常常是停的，net session 会把管理员误判成「没权限」，
rem  于是无限弹授权窗口 —— 2026-09-24 修秦伟杰那台时确认过；当时只改了「陪玩端一键安装.bat」，这条漏了。）
fltmc >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在弹出授权窗口，请点“是”...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set PS1=%TEMP%\chunlv-setup-pc.ps1
echo.
echo 蠢驴电竞 - 新电脑一键装机
echo 正在下载装机脚本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://1.117.229.36:3001/uploads/setup-pc.ps1' -OutFile '%PS1%' -UseBasicParsing"
for %%A in ("%PS1%") do set PSIZE=%%~zA
if not defined PSIZE set PSIZE=0
if %PSIZE% LSS 1500 (
  echo 装机脚本没下全（%PSIZE% 字节）：请确认这台电脑能上网，再双击一次。
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
