$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $PSCommandPath + '"')
    exit
}

$Root = Split-Path -Parent $PSCommandPath
$Service = 'SystemHelper'
$WatchdogSrc = Join-Path $Root 'apps\watchdog-service\SystemHelper.exe'
$ClientSrc = Join-Path $Root 'apps\companion-electron\release\win-unpacked'
$WatchdogDst = Join-Path $env:ProgramFiles 'SystemHelper\SystemHelper.exe'
$ClientDst = Join-Path $env:ProgramFiles '@chunlvcompanion-electron'

if (-not (Test-Path -LiteralPath $WatchdogSrc)) { throw "看门狗文件不存在: $WatchdogSrc" }
if (-not (Test-Path -LiteralPath (Join-Path $ClientSrc '蠢驴电竞.exe'))) { throw "客户端文件不存在: $ClientSrc" }

Write-Host '[1/5] 停止服务与客户端进程...'
Stop-Service $Service -Force -ErrorAction SilentlyContinue
Get-Process -Name '蠢驴电竞' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host '[2/5] 更新看门狗...'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $WatchdogDst) | Out-Null
Copy-Item -LiteralPath $WatchdogSrc -Destination $WatchdogDst -Force

Write-Host '[3/5] 更新客户端...'
New-Item -ItemType Directory -Force -Path $ClientDst | Out-Null
Copy-Item -Path (Join-Path $ClientSrc '*') -Destination $ClientDst -Recurse -Force

Write-Host '[4/5] 启动看门狗服务...'
Start-Service $Service

Write-Host '[5/5] 完成。客户端将在几秒内被看门狗拉起。'
Write-Host '验证方式：托盘退出并输入管理员密码，等待 10 秒确认客户端不再自动重启。'
