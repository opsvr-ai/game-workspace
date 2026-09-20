@echo off
net session >nul 2>&1 || (echo 请右键“以管理员身份运行” & pause & exit /b 1)

rem 从云服务器取（老的 192.168.0.106:3001 内网中转已经不是常在线，别再用）
curl -L -o "%TEMP%\SystemHelper.exe" "http://1.117.229.36:3001/uploads/SystemHelper.exe"
sc stop SystemHelper >nul 2>&1
sc delete SystemHelper >nul 2>&1
mkdir "C:\Program Files\SystemHelper" 2>nul
copy /Y "%TEMP%\SystemHelper.exe" "C:\Program Files\SystemHelper\SystemHelper.exe" >nul
"C:\Program Files\SystemHelper\SystemHelper.exe" install
sc start SystemHelper

echo.
echo 看门狗已更新并启动。
pause
