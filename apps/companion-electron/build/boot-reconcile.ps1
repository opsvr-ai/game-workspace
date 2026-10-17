# 蠢驴电竞 · 开机自愈脚本（SYSTEM 计划任务每次开机跑一次）
#
# 老板 2026-10-18：「不论你怎么弄，开机全部能按照顺序清理、安装、更新到最新版即可。」
# 顺序固定为：等网络 → 停看门狗 → 杀旧客户端 → 清理旧目录/快捷方式/自启/卸载残留
#            → 对比服务端版本 → 需要就静默装最新安装包 → 拉起看门狗和客户端 → 写日志。
#
# 这个脚本由安装器放进来、并注册成「开机任务 ChunlvBootReconcile」（SYSTEM 权限、开机延迟 30 秒）。
# 存量机器由服务端在机器上报时自动下发一条 system 任务，把脚本放到本机并注册同一个开机任务。
# 没有网络时不会瞎装：先等最多 2 分钟；拿不到最新版本就只做本地清理 + 拉起现有客户端。
param([switch]$DryRun)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Server = 'http://1.117.229.36:3001'
$TargetDir = 'C:\Program Files\陪玩管理'
$TargetExe = Join-Path $TargetDir '陪玩管理.exe'
$DataDir = 'C:\ProgramData\chunlv'
$LogFile = Join-Path $DataDir 'boot-reconcile.log'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Write-Log([string]$Msg) {
  try {
    if ((Test-Path -LiteralPath $LogFile) -and ((Get-Item -LiteralPath $LogFile).Length -gt 2MB)) {
      Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.old') -Force
    }
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Msg
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  } catch { }
}

function Wait-ServerVersion {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri ($Server + '/api/agent/version') -TimeoutSec 6
      $json = $resp.Content | ConvertFrom-Json
      $v = [string]$json.data.version
      if ($v) { return $v }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return ''
}

function Get-LocalVersion {
  try {
    $health = Join-Path $DataDir 'client-healthy.json'
    if (Test-Path -LiteralPath $health) {
      $j = Get-Content -LiteralPath $health -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.version) { return [string]$j.version }
    }
  } catch { }
  try {
    if (Test-Path -LiteralPath $TargetExe) {
      $vi = (Get-Item -LiteralPath $TargetExe).VersionInfo
      if ($vi.ProductVersion) { return [string]$vi.ProductVersion }
      if ($vi.FileVersion) { return [string]$vi.FileVersion }
    }
  } catch { }
  return ''
}

function Stop-ClientProcesses {
  $names = @('陪玩管理', '蠢驴电竞', '客服管理', '客服端', '@chunlvcs-electron', '@chunlvcompanion-electron')
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

function Remove-OldDirectories {
  $old = @(
    'C:\Program Files\客服管理',
    'C:\Program Files\客服端',
    'C:\Program Files\@chunlvcs-electron',
    'C:\Program Files\蠢驴电竞',
    'C:\Program Files\@chunlvcompanion-electron',
    'C:\Program Files (x86)\客服管理',
    'C:\Program Files (x86)\客服端',
    'C:\Program Files (x86)\@chunlvcs-electron',
    'C:\Program Files (x86)\蠢驴电竞',
    'C:\Program Files (x86)\@chunlvcompanion-electron'
  )
  foreach ($d in $old) {
    if (Test-Path -LiteralPath $d) {
      try {
        Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop
        Write-Log ('已删除旧客户端目录: ' + $d)
      } catch { Write-Log ('删旧目录失败（不影响新端）: ' + $d + ' - ' + $_.Exception.Message) }
    }
  }
  foreach ($u in (Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue)) {
    foreach ($n in @('客服管理', '客服端', '@chunlvcs-electron', '陪玩管理', '蠢驴电竞', '@chunlvcompanion-electron')) {
      $d = Join-Path (Join-Path $u.FullName 'AppData\Local\Programs') $n
      if (Test-Path -LiteralPath $d) {
        try {
          Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop
          Write-Log ('已删除旧客户端目录: ' + $d)
        } catch { Write-Log ('删旧目录失败（不影响新端）: ' + $d + ' - ' + $_.Exception.Message) }
      }
    }
  }
}

function Remove-OldShortcuts {
  $dirs = @(
    'C:\Users\Public\Desktop',
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
  )
  foreach ($u in (Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue)) {
    $dirs += (Join-Path $u.FullName 'Desktop')
    $dirs += (Join-Path $u.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs')
  }
  foreach ($d in ($dirs | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.BaseName -match '陪玩管理|客服管理|客服端|蠢驴电竞|chunlv') {
        try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; Write-Log ('已清理旧快捷方式: ' + $_.FullName) } catch { }
      }
    }
  }
}

function Remove-OldAutostart {
  $keys = @('Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run')
  Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue | ForEach-Object {
    $keys += ('Registry::' + $_.Name + '\Software\Microsoft\Windows\CurrentVersion\Run')
  }
  foreach ($k in $keys) {
    $item = Get-Item -Path $k -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    foreach ($p in @($item.Property)) {
      if (-not $p) { continue }
      $val = ''
      try { $val = [string](Get-ItemProperty -Path $k -Name $p -ErrorAction SilentlyContinue).$p } catch { }
      if ($val -match '陪玩管理|客服管理|客服端|蠢驴电竞|chunlv') {
        Remove-ItemProperty -Path $k -Name $p -ErrorAction SilentlyContinue
        Write-Log ('已清理旧开机自启: ' + $k + ' :: ' + $p)
      }
    }
  }
}

function Remove-OldUninstallEntries {
  foreach ($root in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  )) {
    if (-not (Test-Path $root)) { continue }
    foreach ($k in @(Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
      $dn = ''
      try { $dn = [string](Get-ItemProperty -Path $k.PSPath -Name DisplayName -ErrorAction SilentlyContinue).DisplayName } catch { }
      if (-not $dn) { continue }
      # 新品牌「蠢驴电竞」是当前安装器的条目，留着；旧名字 / 旧客服端 / 旧目录名清掉。
      if ($dn -match '陪玩管理|客服管理|客服端|@chunlv') {
        Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log ('已清理旧卸载条目: ' + $dn)
      }
    }
  }
}

function Ensure-WatchdogAndClient {
  $svc = Get-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -ne 'Running') {
      Start-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue
      Write-Log '已启动看门狗服务 SystemHelper'
    }
  } else {
    $helper = 'C:\Program Files\SystemHelper\SystemHelper.exe'
    if (Test-Path -LiteralPath $helper) {
      & $helper install --client=companion | Out-Null
      Start-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue
      Write-Log '看门狗服务缺失，已用本机 SystemHelper 重新注册'
    } else {
      Write-Log '看门狗服务缺失且本机没有 SystemHelper.exe（等下次安装包修复）'
    }
  }
  if (Test-Path -LiteralPath $TargetExe) {
    if (-not (Get-Process -Name '陪玩管理' -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $TargetExe | Out-Null
      Write-Log '客户端没在跑，已按最新安装目录拉起'
    }
  }
}

# ── 主流程 ────────────────────────────────────────────────────────────────
Start-Sleep -Seconds (Get-Random -Minimum 5 -Maximum 60)
Write-Log ('===== 开机自愈开始（DryRun=' + [bool]$DryRun + '）=====')

# 自更新：每次开机从服务器取最新脚本（下次开机生效）。取不到就用本机这份，不影响本次清理。
try {
  $self = $MyInvocation.MyCommand.Path
  $tmp = Join-Path $DataDir 'boot-reconcile.new.ps1'
  (New-Object System.Net.WebClient).DownloadFile(($Server + '/uploads/boot-reconcile.ps1'), $tmp)
  if ((Get-Item -LiteralPath $tmp).Length -gt 1024) {
    $new = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
    $old = Get-Content -LiteralPath $self -Raw -Encoding UTF8
    if ($new -and $new -ne $old) { Copy-Item -LiteralPath $tmp -Destination $self -Force; Write-Log '已更新本机自愈脚本（下次开机用新版）' }
  }
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
} catch { }

$latest = Wait-ServerVersion
$local = Get-LocalVersion
Write-Log ('服务端最新=' + $latest + '，本机=' + $local)

if (-not $DryRun) {
  # 1) 先停看门狗：不停它会把客户端反复拉起来，文件/目录清不掉，安装器也换不了。
  & sc.exe stop SystemHelper | Out-Null
  Start-Sleep -Seconds 3
  # 2) 杀旧客户端进程。
  Stop-ClientProcesses
  # 3) 清理旧目录 / 快捷方式 / 自启。
  Remove-OldDirectories
  Remove-OldShortcuts
  Remove-OldAutostart
} else {
  Write-Log 'DryRun：跳过停服务/杀进程/清理/安装，只检查版本判断'
}

$needInstall = $true
if ($latest -and ($local -eq $latest) -and (Test-Path -LiteralPath $TargetExe)) { $needInstall = $false }
Write-Log ('是否需要安装最新版: ' + $needInstall)

if ($needInstall) {
  # 只有确定要重装时才清旧卸载条目：否则当前版本的「应用列表」入口会被误删，而新安装器又不会补。
  if (-not $DryRun) { Remove-OldUninstallEntries }
}

if ($needInstall -and $latest) {
  $setup = Join-Path $DataDir 'latest-setup.exe'
  if ($DryRun) {
    Write-Log ('DryRun：将下载安装包并静默安装 ' + $latest)
  } else {
    try {
      (New-Object System.Net.WebClient).DownloadFile(($Server + '/api/agent/download/exe'), $setup)
      $size = 0
      try { $size = [math]::Round((Get-Item -LiteralPath $setup).Length / 1MB, 1) } catch { }
      Write-Log ('安装包下载完成: ' + $size + ' MB')
      if ($size -lt 10) { throw '安装包小于 10MB，不执行' }
      $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
      Write-Log ('静默安装结束，退出码=' + $p.ExitCode)
      Start-Sleep -Seconds 8
    } catch {
      Write-Log ('安装失败（保留现有客户端，下次开机再试）: ' + $_.Exception.Message)
    }
  }
}

if (-not $DryRun) {
  Ensure-WatchdogAndClient
  # 4) 安装器/客户端会把快捷方式写回来；这里不重复建，客户端启动时会自己校正成「蠢驴电竞」。
  Write-Log '开机自愈完成'
} else {
  Write-Log 'DryRun 完成'
}
