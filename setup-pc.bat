@echo off
chcp 65001 >nul
title 蠢驴电竞-新电脑一键装机
rem 用 fltmc 判管理员：不依赖 net.exe，也不依赖 Server 服务开着。
rem （新机器 / 被清理过的机器上 LanmanServer 常常是停的，net session 会把管理员误判成「没权限」，
rem  于是无限弹授权窗口 —— 2026-09-24 修秦伟杰那台时确认过）
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
if %PSIZE% LSS 1500 goto :badscript
rem 光看字节数不够：酒店 / 公司的 wifi 登录页回的就是一个网页，比 1500 字节还大。
rem 所以再看开头和结尾两处标记都在，才算整份下全了。
rem 这里必须走 PowerShell、不能用 findstr：批处理里 findstr 会把 $ 当成行尾锚点，
rem 于是查 "$ErrorActionPreference" 永远查不到（2026-10-01 干跑时踩到），好脚本会被误判成没下全。
rem 顺便确认开头带 UTF-8 BOM：PS 5.1 少了 BOM 会按 ANSI 解码，脚本里的中文路径会变乱码。
powershell -NoProfile -Command "$b=[System.IO.File]::ReadAllBytes($env:TEMP+'\chunlv-setup-pc.ps1'); if ($b.Length -lt 1500 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191) { exit 1 }; $t=[System.Text.Encoding]::UTF8.GetString($b); if ($t -notlike '*ErrorActionPreference*' -or $t -notlike '*CHUNLV_SETUP_PC_END*') { exit 1 }"
if errorlevel 1 goto :badscript
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
exit /b 0

:badscript
echo.
echo [!] 装机脚本没下全（%PSIZE% 字节）：多半是这台电脑现在上不了网，
echo     或者连的是「要先登录的 wifi」（下到的是 wifi 登录页）。
echo     确认能正常上网后，关掉这个窗口，重新双击一次。
echo.
pause
exit /b 1
