$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $PSCommandPath + '"')
    exit
}

$Root = Split-Path -Parent $PSCommandPath

# Source discovery supports both repository layout and portable package layout.
$watchdogCandidates = @(
    (Join-Path $Root 'apps\watchdog-service\SystemHelper.exe'),
    (Join-Path $Root 'SystemHelper.exe')
)
$clientCandidates = @(
    (Join-Path $Root 'apps\companion-electron\release\win-unpacked'),
    (Join-Path $Root 'client')
)

$WatchdogSrc = $null
foreach ($c in $watchdogCandidates) {
    if (Test-Path -LiteralPath $c) { $WatchdogSrc = $c; break }
}
if (-not $WatchdogSrc) { throw "未找到看门狗文件: $watchdogCandidates" }

$ClientSrc = $null
foreach ($c in $clientCandidates) {
    if (Test-Path -LiteralPath (Join-Path $c '蠢驴电竞.exe')) { $ClientSrc = $c; break }
}
if (-not $ClientSrc) { throw "未找到客户端目录: $clientCandidates" }

$WatchdogDst = Join-Path $env:ProgramFiles 'SystemHelper\SystemHelper.exe'
$ClientDst = Join-Path $env:ProgramFiles '@chunlvcompanion-electron'

Write-Host '[1/6] 停止服务与客户端进程...'
Stop-Service 'SystemHelper' -Force -ErrorAction SilentlyContinue
Stop-Service 'ChunlvCompanion' -Force -ErrorAction SilentlyContinue
Get-Process -Name '蠢驴电竞' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host '[2/6] 清理旧版 nssm 服务...'
if (Get-Service -Name 'ChunlvCompanion' -ErrorAction SilentlyContinue) {
    & sc.exe stop ChunlvCompanion 2>$null | Out-Null
    & sc.exe delete ChunlvCompanion 2>$null | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host '[3/6] 更新看门狗...'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $WatchdogDst) | Out-Null
Copy-Item -LiteralPath $WatchdogSrc -Destination $WatchdogDst -Force

Write-Host '[4/6] 更新客户端...'
New-Item -ItemType Directory -Force -Path $ClientDst | Out-Null
Copy-Item -Path (Join-Path $ClientSrc '*') -Destination $ClientDst -Recurse -Force

Write-Host '[5/6] 安装并启动 SystemHelper 服务...'
if (Get-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue) {
    Start-Service 'SystemHelper'
} else {
    & $WatchdogDst install
    if ($LASTEXITCODE -ne 0) { throw "SystemHelper 安装失败: $LASTEXITCODE" }
    Start-Service 'SystemHelper'
}

Write-Host '[6/6] 完成。客户端将在几秒内被看门狗拉起。'
Write-Host '验证：托盘退出并输入管理员密码，等待 10 秒确认客户端不再自动重启。'
