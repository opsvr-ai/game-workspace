@echo off
REM ============================================
REM 蠢驴电竞陪玩 - nssm Windows 服务安装脚本
REM 作用: 开机自启 + 进程被杀后自动重启
REM 运行: 以管理员身份运行此脚本
REM ============================================

set SERVICE_NAME=ChunlvCompanion
set APP_PATH=C:\Program Files\蠢驴电竞\蠢驴电竞.exe
set NSSM_PATH=C:\Program Files\蠢驴电竞\nssm.exe

REM 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本
    pause
    exit /b 1
)

echo [1/4] 停止现有服务...
nssm stop %SERVICE_NAME% 2>nul

echo [2/4] 删除旧服务配置...
nssm remove %SERVICE_NAME% confirm 2>nul

echo [3/4] 安装服务...
nssm install %SERVICE_NAME% "%APP_PATH%"
nssm set %SERVICE_NAME% AppDirectory "C:\Program Files\蠢驴电竞"
nssm set %SERVICE_NAME% DisplayName "蠢驴电竞陪玩"
nssm set %SERVICE_NAME% Description "蠢驴电竞陪玩师桌面客户端 - 自动重启守护"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 5000

echo [4/4] 启动服务...
nssm start %SERVICE_NAME%

echo.
echo ============================================
echo 安装完成！
echo 服务名称: %SERVICE_NAME%
echo 状态:
nssm status %SERVICE_NAME%
echo.
echo 陪玩无法通过托盘退出、任务管理器杀进程后5秒自动重启。
echo 仅系统关机时正常退出。
echo ============================================
pause
