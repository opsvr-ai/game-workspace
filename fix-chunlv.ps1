$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '请以管理员身份运行这个修复工具。' -ForegroundColor Red
  Start-Sleep -Seconds 5
  exit 1
}

$installerUrl = 'http://192.168.0.106:3001/uploads/%E8%A0%A2%E9%A9%B4%E7%94%B5%E7%AB%9E%20Setup%201.0.20260826.exe'
$out = Join-Path $env:TEMP 'Chunlv-Setup-20260826.exe'

# 1. 先停掉看门狗服务，否则它会一直把旧进程拉起来
sc.exe stop SystemHelper
sc.exe delete SystemHelper

# 2. 只结束属于蠢驴电竞的进程，不误杀其他 electron/node 程序
Get-Process | Where-Object {
  $_.Path -and ($_.Path -match '蠢驴|chunlv|@chunlvcompanion')
} | ForEach-Object {
  try { $_.Kill() } catch {}
}

Start-Sleep -Seconds 2

# 3. 删除所有旧安装目录
$paths = @(
  'C:\Program Files\蠢驴电竞',
  'C:\Program Files\@chunlvcompanion-electron',
  'C:\Program Files (x86)\蠢驴电竞',
  'C:\Program Files (x86)\@chunlvcompanion-electron',
  "$env:LOCALAPPDATA\Programs\蠢驴电竞",
  "$env:LOCALAPPDATA\Programs\@chunlvcompanion-electron"
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    Remove-Item $p -Recurse -Force
  }
}

# 4. 清理注册表里旧的卸载记录
$roots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($root in $roots) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $displayName = (Get-ItemProperty $_.PSPath -Name DisplayName -ErrorAction SilentlyContinue).DisplayName
    if ($displayName -and $displayName -match '蠢驴') {
      Remove-Item $_.PSPath -Recurse -Force
    }
  }
}

# 5. 下载新版安装包并静默安装
Invoke-WebRequest -Uri $installerUrl -OutFile $out -UseBasicParsing
Start-Process -FilePath $out -ArgumentList '/S' -Wait
Remove-Item $out -Force

# 6. 安装完成后启动新客户端
$newExe = 'C:\Program Files\蠢驴电竞\蠢驴电竞.exe'
if (Test-Path $newExe) {
  Start-Process $newExe
}

Write-Host ''
Write-Host '修复完成。如果安装成功，新客户端会自动启动。' -ForegroundColor Green
Read-Host '按回车键退出'
