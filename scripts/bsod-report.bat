@echo off
chcp 65001 >nul
title chunlv-bsod-report
rem 用 fltmc 判管理员：不依赖 net.exe（有的机器 PATH 里没有它，会误判成没有权限）
fltmc >nul 2>&1
if %errorlevel% neq 0 (
  echo Need admin. Approve the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
rem 每次换个名字：上一份可能被杀毒软件锁着，同名覆盖会下载失败
set PS1=%TEMP%\chunlv-bsod-%RANDOM%%RANDOM%.ps1
echo.
echo chunlv - bsod report
echo 正在下载脚本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://1.117.229.36:3001/uploads/report-bsod.ps1' -OutFile '%PS1%' -UseBasicParsing"
for %%A in ("%PS1%") do set PSIZE=%%~zA
if not defined PSIZE set PSIZE=0
if %PSIZE% LSS 8000 (
  echo download incomplete (%PSIZE% bytes). Check internet and retry.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
echo.
pause
