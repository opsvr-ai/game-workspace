@echo off
chcp 65001 >nul
setlocal
set "PS=%TEMP%\chunlv-client-diag.ps1"
echo 正在下载「一键诊断」脚本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $out = Join-Path $env:TEMP 'chunlv-client-diag.ps1'; try { Invoke-WebRequest -Uri 'http://1.117.229.36:3001/api/agent/client-diag.ps1' -OutFile $out -UseBasicParsing } catch { Write-Host ('下载失败：' + $_.Exception.Message) -ForegroundColor Red; Start-Sleep 6; exit 1 }"
if not exist "%PS%" ( echo 下载失败了，检查这台电脑能不能上网。& pause & exit /b 1 )
echo 接下来会弹出一个窗口，请点「是」允许管理员权限。
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%PS%','-OutFile',(Join-Path $env:TEMP 'chunlv-diag-report.txt'),'-ServerUrl','http://1.117.229.36:3001','-Upload'"
exit /b 0
