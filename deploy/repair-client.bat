@echo off
chcp 65001 >nul
title 蠢驴电竞 - 客户端一键修复
rem ============================================================
rem 2026-09-23 起本脚本已废弃，不要再跑：请改用
rem     http://1.117.229.36:3001/uploads/repair-companion.bat
rem 新脚本（scripts\repair-companion.ps1）会先下包并校验（三种解压方式依次试）、
rem 整目录换新、装最新看门狗、重建桌面图标，任何一步不合适就中止（本机一个文件都不动）；
rem 本文件下面那套「逐文件覆盖」正是 2026-09-23 那次「客户端被更新成半残」的老做法。
rem 这里只留作历史参考，逻辑一律改在 scripts\repair-companion.ps1 里。
rem ============================================================
net session >nul 2>&1 || (echo 请右键「以管理员身份运行」本文件 & pause & exit /b 1)

set CLOUD=http://1.117.229.36:3001
set CLIDIR=C:\Program Files\陪玩管理
set CLIEXE=

echo.
echo [1/5] 安装最新看门狗服务（负责自动拉起/修复客户端）...
curl -L -o "%TEMP%\SystemHelper.exe" "%CLOUD%/uploads/SystemHelper.exe"
sc stop SystemHelper >nul 2>&1
sc delete SystemHelper >nul 2>&1
if not exist "C:\Program Files\SystemHelper" mkdir "C:\Program Files\SystemHelper"
copy /Y "%TEMP%\SystemHelper.exe" "C:\Program Files\SystemHelper\SystemHelper.exe" >nul
"C:\Program Files\SystemHelper\SystemHelper.exe" install
sc start SystemHelper >nul
echo      看门狗已启动。

echo.
echo [2/5] 检查客户端连的服务器地址（不对就改成云端并留 .bak 备份）...
powershell -NoProfile -Command "$dirs=@('C:\Program Files\陪玩管理','C:\Program Files\蠢驴电竞','C:\Program Files\@chunlvcompanion-electron','C:\Program Files (x86)\蠢驴电竞','C:\Program Files\@chunlvcs-electron','C:\Program Files\客服管理','C:\Users\Administrator\AppData\Roaming\@chunlv\companion-electron'); $cloud='http://1.117.229.36:3001'; foreach($d in $dirs){ foreach($rel in @('resources\companion-config.json','resources\config.json','companion-config.json','config.json')){ $p=Join-Path $d $rel; if(Test-Path $p){ try{ $j=Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json }catch{ Write-Output ('  跳过(读不了): '+$p); continue }; if($j.PSObject.Properties.Name -contains 'serverUrl'){ Write-Output ('  当前: '+$p+' = '+$j.serverUrl); if($j.serverUrl -ne $cloud){ Copy-Item -LiteralPath $p ($p+'.bak') -Force; $j.serverUrl=$cloud; $j | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $p -Encoding UTF8; Write-Output ('  已改成: '+$cloud) } } else { Write-Output ('  不动(无 serverUrl 键): '+$p) } } } }"

echo.
echo [3/5] 查找客户端程序...
if exist "%CLIDIR%\陪玩管理.exe" set CLIEXE=%CLIDIR%\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\蠢驴电竞\陪玩管理.exe" set CLIEXE=C:\Program Files\蠢驴电竞\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\蠢驴电竞\蠢驴电竞.exe" set CLIEXE=C:\Program Files\蠢驴电竞\蠢驴电竞.exe
if not defined CLIEXE if exist "C:\Program Files\@chunlvcompanion-electron\陪玩管理.exe" set CLIEXE=C:\Program Files\@chunlvcompanion-electron\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe" set CLIEXE=C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe
if not defined CLIEXE if exist "C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe" set CLIEXE=C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe
if not defined CLIEXE if exist "C:\Program Files\陪玩管理\蠢驴电竞.exe" set CLIEXE=C:\Program Files\陪玩管理\蠢驴电竞.exe

if defined CLIEXE (
  echo      找到客户端：%CLIEXE%
  goto launch
)

echo.
echo [4/5] 客户端程序已丢失，从云端重新装一份...
if not exist "%CLIDIR%" mkdir "%CLIDIR%"
curl -L -o "%TEMP%\chunlv-latest.zip" "%CLOUD%/api/agent/download/latest"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TEMP%\chunlv-latest.zip' -DestinationPath '%TEMP%\chunlv-unpack' -Force; $inner = Join-Path '%TEMP%\chunlv-unpack' 'win-unpacked'; if (-not (Test-Path $inner)) { $inner = '%TEMP%\chunlv-unpack' }; Copy-Item (Join-Path $inner '*') '%CLIDIR%' -Recurse -Force"
set CLIEXE=%CLIDIR%\陪玩管理.exe

:launch
echo.
echo [5/5] 启动客户端...
start "" "%CLIEXE%"
echo.
echo 修复完成：看门狗 + 客户端 + 服务器地址都已就位。
echo 若客户端仍打不开，把 C:\Program Files\SystemHelper\service.log 最后几行发给管理员。
pause
