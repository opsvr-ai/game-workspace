@echo off
chcp 65001 >nul
title 蠢驴电竞 - 客户端一键修复
net session >nul 2>&1 || (echo 请右键「以管理员身份运行」本文件 & pause & exit /b 1)

set CLOUD=http://1.117.229.36:3001
set CLIDIR=C:\Program Files\陪玩管理
set CLIEXE=

echo.
echo [1/4] 安装最新看门狗服务（负责自动拉起/修复客户端）...
curl -L -o "%TEMP%\SystemHelper.exe" "%CLOUD%/uploads/SystemHelper.exe"
sc stop SystemHelper >nul 2>&1
sc delete SystemHelper >nul 2>&1
if not exist "C:\Program Files\SystemHelper" mkdir "C:\Program Files\SystemHelper"
copy /Y "%TEMP%\SystemHelper.exe" "C:\Program Files\SystemHelper\SystemHelper.exe" >nul
"C:\Program Files\SystemHelper\SystemHelper.exe" install
sc start SystemHelper >nul
echo      看门狗已启动。

echo.
echo [2/4] 查找客户端程序...
if exist "%CLIDIR%\陪玩管理.exe" set CLIEXE=%CLIDIR%\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\蠢驴电竞\陪玩管理.exe" set CLIEXE=C:\Program Files\蠢驴电竞\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\蠢驴电竞\蠢驴电竞.exe" set CLIEXE=C:\Program Files\蠢驴电竞\蠢驴电竞.exe
if not defined CLIEXE if exist "C:\Program Files\@chunlvcompanion-electron\陪玩管理.exe" set CLIEXE=C:\Program Files\@chunlvcompanion-electron\陪玩管理.exe
if not defined CLIEXE if exist "C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe" set CLIEXE=C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe
if not defined CLIEXE if exist "C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe" set CLIEXE=C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe

if defined CLIEXE (
  echo      找到客户端：%CLIEXE%
  goto launch
)

echo.
echo [3/4] 客户端程序已丢失，从云端重新装一份...
if not exist "%CLIDIR%" mkdir "%CLIDIR%"
curl -L -o "%TEMP%\chunlv-latest.zip" "%CLOUD%/api/agent/download/latest"
powershell -NoProfile -Command "Expand-Archive -LiteralPath \"%TEMP%\chunlv-latest.zip\" -DestinationPath \"%TEMP%\chunlv-unpack\" -Force; $inner = Join-Path \"%TEMP%\chunlv-unpack\" 'win-unpacked'; if (-not (Test-Path $inner)) { $inner = \"%TEMP%\chunlv-unpack\" }; Copy-Item (Join-Path $inner '*') \"%CLIDIR%\" -Recurse -Force"
set CLIEXE=%CLIDIR%\陪玩管理.exe

:launch
echo.
echo [4/4] 启动客户端...
start "" "%CLIEXE%"
echo.
echo 修复完成：看门狗 + 客户端都已就位。
echo 若客户端仍打不开，把 C:\Program Files\SystemHelper\service.log 最后几行发给管理员。
pause