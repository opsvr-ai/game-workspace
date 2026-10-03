/**
 * 「一键开通远程管理」脚本正文（客服端 / 陪玩端 / 装机脚本共用）。
 *
 * 干的事：建（或修）一个专属运维账号 chunlvops（管理员组 + 密码永不过期）、
 * 打开 LocalAccountTokenFilterPolicy 和文件共享 / 远程服务 / WMI 防火墙，
 * 再把账号口令回传到服务端台账，这样以后不用再问任何人要密码。
 *
 * 跟 client-diag.ts 一样用 String.raw 保存，不要出现模板字符串的插值符号和反引号。
 */
export const CLIENT_ENABLE_REMOTE_VERSION = '2026-10-03.2';

export const CLIENT_ENABLE_REMOTE_PS = String.raw`# 蠢驴电竞 · 一键开通远程管理（客服端 / 陪玩端通用）
# 作用：在这台电脑上开一个专属运维账号 + 打开远程管理通道，并把结果回传到服务器。
# 三种用法：
#   ① 客户端下发（机器管理页点「一键开通远程管理」）：服务端把本脚本写进任务，客户端以管理员身份执行
#   ② 客服/老板手工双击：scripts/开通远程管理.bat（会自己弹 UAC 提权）
#   ③ 装机脚本内嵌：安装包安装完自动跑一次
param(
  [string]$ServerUrl = '',
  [string]$ClientType = '',
  [string]$HostnameOverride = '',
  [string]$ReportedWatchdogBuild = '',
  [switch]$NoUpload
)

$ErrorActionPreference = 'Continue'
$account = 'chunlvops'
$out = New-Object System.Collections.Generic.List[string]
function W([string]$t) { $out.Add([string]$t); Write-Host $t }

# 读一份 exe 里编着的看门狗构建号（看门狗把自己的构建号当字面量编进了二进制）。
# 不认识构建号 = 那份看门狗老到不会自己升级，就得靠这条任务把它带上来。
function Get-WatchdogBuild([string]$p) {
  try {
    $s = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($p))
    if ($s -match 'CHUNLV_WATCHDOG_BUILD=(\d+)') { return $Matches[1] }
  } catch { }
  return ''
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
W ('是不是管理员: ' + $isAdmin)
if (-not $isAdmin) {
  W '[!] 没有管理员权限，账号建不了。请用「以管理员身份运行」重开一次。'
  exit 1
  exit 1
}

# 1) 口令：本机已经留过档就沿用原来那一份，绝不每次跑都换。
#    为什么（2026-10-01）：这条脚本现在会自动重跑（自愈），要是每次换一个口令，
#    管理端刚抄走的口令就当场失效了。
$pwDir = $env:ProgramData + '\chunlv'
$pwRecord = $pwDir + '\remote-account.txt'
$password = ''
if (Test-Path -LiteralPath $pwRecord) {
  try {
    $rec = Get-Content -LiteralPath $pwRecord -Raw
    if ($rec -match 'password=(\S+)') { $password = $Matches[1] }
  } catch { }
}
if ($password) {
  W ('沿用本机留档的口令: ' + $pwRecord)
} else {
  # 生成一个每台机器都不一样的高强度密码（不再用所有人同一个口令）
  $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  $rand = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $buf = New-Object byte[] 1
  $pwChars = @()
  for ($i = 0; $i -lt 14; $i++) {
    $rand.GetBytes($buf)
    $pwChars += $chars[($buf[0] % $chars.Length)]
  }
  $password = 'Chunlv!' + (-join $pwChars)
}

# 2) 建账号 / 修账号
$exist = Get-LocalUser -Name $account -ErrorAction SilentlyContinue
if ($exist) {
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  Set-LocalUser -Name $account -Password $secure -PasswordNeverExpires $true -AccountNeverExpires -ErrorAction SilentlyContinue
  Enable-LocalUser -Name $account -ErrorAction SilentlyContinue
  W ('账号已存在，已重置密码并设成永不过期: ' + $account)
} else {
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  New-LocalUser -Name $account -Password $secure -PasswordNeverExpires -AccountNeverExpires -Description 'Chunlv remote support account' -ErrorAction SilentlyContinue | Out-Null
  if (-not (Get-LocalUser -Name $account -ErrorAction SilentlyContinue)) {
    net user $account $password /add /expires:never 2>&1 | ForEach-Object { W ('  net user: ' + $_) }
    net user $account /active:yes 2>&1 | Out-Null
    W 'New-LocalUser 不可用，已退回 net user 创建账号'
  }
  W ('已创建运维账号: ' + $account)
}

# 幂等：先看是不是已经在管理员组，避免每次装机都报「已存在」的红字
$inAdmins = $false
try {
  $inAdmins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -match $account
} catch { }
if (-not $inAdmins) {
  net localgroup administrators $account /add 2>&1 | ForEach-Object { W ('  加管理员组: ' + $_) }
}
$inAdmins = $false
try {
  $inAdmins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -match $account
} catch { }
W ('已在管理员组: ' + $inAdmins)

# 3) 打开被 UAC 拦住的远程管理通道
New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -PropertyType DWord -Force | Out-Null
W 'LocalAccountTokenFilterPolicy = 1'

# 4) 文件共享（远程管理走 445）
Set-Service -Name LanmanServer -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name LanmanServer -ErrorAction SilentlyContinue
try {
  Set-NetFirewallRule -DisplayGroup 'File and Printer Sharing' -Enabled True -ErrorAction SilentlyContinue
  Set-NetFirewallRule -DisplayGroup 'Remote Service Management' -Enabled True -ErrorAction SilentlyContinue
  Set-NetFirewallRule -DisplayGroup 'Windows Management Instrumentation (WMI)' -Enabled True -ErrorAction SilentlyContinue
  W '已放行 文件共享 / 远程服务管理 / WMI 防火墙规则'
} catch { W ('防火墙规则设置失败（可能已被域策略接管）: ' + $_.Exception.Message) }

# 5) 把口令存一份在本机固定位置，云端台账丢了也能在这台机器上找回来
try {
  $dir = $env:ProgramData + '\chunlv'
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $info = 'account=' + $account + [Environment]::NewLine + 'password=' + $password + [Environment]::NewLine + 'createdAt=' + (Get-Date).ToString('s')
  [System.IO.File]::WriteAllText(($dir + '\remote-account.txt'), $info, (New-Object System.Text.UTF8Encoding($true)))
  W ('口令已在本机留档: ' + $dir + '\remote-account.txt')
} catch { W ('本机留档失败: ' + $_.Exception.Message) }

# 6) 看门狗（SystemHelper）也顺手跟云端对齐。
#    老板 2026-10-01：「你看看还谁不是全自动的……以后都弄全自动好么？」看门狗负责
#    「自动更新 + 领远程任务」，它一旧，这两件事就都得靠人跑到电脑跟前。比它自己
#    云端自更新更早的版本还不认识那套机制，只能靠这条任务把它带上来。
#
#    老板 2026-10-03：「能不能一次行全部所有电脑都修好？」—— 这儿以前只看「磁盘上那份
#    跟云端一不一样」，漏了更常见的一种：老看门狗换文件时只 stage、不重启自己
#    （service.log 里那句 "staged new SystemHelper (takes effect on next service start)"），
#    于是文件早就是新的了、服务还跑着老进程，等下次开机才生效 —— 常年不关机的机器
#    等于永远不生效，只能人工一台台重启。现在三件事一起看：
#      ① 磁盘上那份落后云端 → 换文件；
#      ② 台账里这台机器上报的构建号（-ReportedWatchdogBuild）跟磁盘上那份对不上，
#         或者服务压根没在跑 → 重启服务（老看门狗自己不会重启自己）；
#      ③ SYSTEM 身份（看门狗自己领的任务）不能 sc stop 自己 —— 服务一停，脚本跟着被结束，
#         换到一半就烂在那儿。照抄新版看门狗自己那套做法（stageSelfReplace + 计划任务重启）：
#         先换文件（Windows 允许重命名正在运行的 exe），再把「停/起服务」交给一次性计划任务
#         （SYSTEM，不属于本服务进程），服务被停掉它照样能把服务拉起来。
#      ④ 「重启」这一步最终交给看门狗守卫（见下）：每 5 分钟一次的 SYSTEM 计划任务 + 装完立刻跑一次，
#         它自己按「磁盘版本 vs 正在跑的版本」判断，服务卡死了直接 taskkill 再拉起来。
#
#    另外记一笔 2026-10-03 挖到的真根因：上一版是用 PowerShell 数组拼 watchdog-restart.cmd，
#    PowerShell 里「逗号比加号紧」，@( 'a' + $x + 'b' ) 会被拆成三个数组元素，落盘后路径各占一行，
#    cmd.exe 认为重定向目标非法、整条命令都不执行 —— sc stop / sc start 一次都没跑过。
#    所以现在一段脚本正文都不拼了：正文都用 here-string，落盘前用 -split/-join 统一换行。
$wdPath = $env:ProgramFiles + '\SystemHelper\SystemHelper.exe'
$wdBuild = ''
if (Test-Path -LiteralPath $wdPath) { $wdBuild = Get-WatchdogBuild $wdPath }
$cloudBuild = ''
$cloudWd = Join-Path $env:TEMP 'SystemHelper.cloud.exe'
if ($ServerUrl) {
  try {
    Invoke-WebRequest -Uri ($ServerUrl.TrimEnd('/') + '/uploads/SystemHelper.exe') -OutFile $cloudWd -UseBasicParsing -TimeoutSec 300
    $cloudBuild = Get-WatchdogBuild $cloudWd
  } catch { W ('取云端看门狗失败（不影响远程管理）: ' + $_.Exception.Message) }
}
$isSystem = $false
try { $isSystem = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq 'S-1-5-18') } catch { }
$reportedBuild = [string]$ReportedWatchdogBuild
$svcState = ''
try { $svc = Get-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue; if ($svc) { $svcState = [string]$svc.Status } } catch { }
$needSwap = [bool]$cloudBuild -and ((-not $wdBuild) -or ([string]$wdBuild).CompareTo([string]$cloudBuild) -lt 0)
$needRestart = [bool]$needSwap
if ((-not $needRestart) -and $reportedBuild -and $wdBuild -and ($reportedBuild -ne $wdBuild)) { $needRestart = $true }
if ((-not $needRestart) -and (Test-Path -LiteralPath $wdPath) -and ($svcState -ne 'Running')) { $needRestart = $true }
W ('看门狗: 磁盘=' + $(if ($wdBuild) { $wdBuild } else { '未知' }) + ' 云端=' + $(if ($cloudBuild) { $cloudBuild } else { '未知' }) + ' 上报=' + $(if ($reportedBuild) { $reportedBuild } else { '未知' }) + ' 服务=' + $(if ($svcState) { $svcState } else { '未安装' }) + ' 执行身份=' + $(if ($isSystem) { 'SYSTEM' } else { '用户' }) + ' 换文件=' + $needSwap + ' 重启=' + $needRestart)
$kind = 'companion'
if ($ClientType -and ($ClientType.ToUpper() -eq 'CS')) { $kind = 'cs' }
elseif (Test-Path -LiteralPath ($env:ProgramData + '\chunlv\watchdog-client.txt')) {
  try { $k = (Get-Content -LiteralPath ($env:ProgramData + '\chunlv\watchdog-client.txt') -Raw).Trim(); if ($k) { $kind = $k } } catch { }
}
function Install-WatchdogGuard {
  $gdir = $env:ProgramData + '\chunlv'
  if (-not (Test-Path -LiteralPath $gdir)) { New-Item -ItemType Directory -Path $gdir -Force | Out-Null }
  # 2026-10-03 真根因：上一版把「重启看门狗」写成一个 watchdog-restart.cmd，用 @( '...' + $x + '...' ) 拼行。
  # PowerShell 里「逗号比加号紧」，一行的三段被拆成三个数组元素，落盘后路径各占一行 ——
  # cmd.exe 认为重定向目标非法、整条命令都不执行，sc stop / sc start 一次都没跑过，
  # 所以「文件换了、服务还跑着老的」拖了一整天。现在不再拼任何脚本正文。
  Remove-Item -LiteralPath ($gdir + '\watchdog-restart.cmd') -Force -ErrorAction SilentlyContinue
  $gps = $gdir + '\watchdog-guard.ps1'
  $got = $false
  if ($ServerUrl) {
    try {
      $tmp = $gdir + '\watchdog-guard.tmp'
      Invoke-WebRequest -Uri ($ServerUrl.TrimEnd('/') + '/uploads/watchdog-guard.ps1') -OutFile $tmp -UseBasicParsing -TimeoutSec 60
      $text = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8)
      if ($text -and ($text.Length -gt 400)) {
        # 必须带 BOM：PowerShell 5.1 见到没 BOM 的 UTF-8 会按 GBK 解码，中文注释当场乱码。
        [System.IO.File]::WriteAllText($gps, $text, (New-Object System.Text.UTF8Encoding($true)))
        $got = $true
      }
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    } catch { W ('  取看门狗守卫脚本失败: ' + $_.Exception.Message) }
  }
  if (-not $got) { W '  没拿到看门狗守卫脚本，这轮跳过（不影响远程管理，下一轮自愈会再补）'; return }
  $tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + $gps
  schtasks /Delete /TN ChunlvWatchdogGuard /F 2>&1 | Out-Null
  $null = schtasks /Create /TN ChunlvWatchdogGuard /TR $tr /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F 2>&1
  W ('  看门狗守卫任务（每 5 分钟）: exit=' + $LASTEXITCODE)
  if ($LASTEXITCODE -eq 0) {
    # 立刻跑一次：schtasks /Run 在这批机器上会报「无法启动」（真机实测过），
    # 只有「定在未来、由计划任务按时间拉起」这条路靠得住。
    $st = (Get-Date).AddMinutes(2).ToString('HH:mm')
    schtasks /Delete /TN ChunlvWatchdogGuardNow /F 2>&1 | Out-Null
    $null = schtasks /Create /TN ChunlvWatchdogGuardNow /TR $tr /SC ONCE /ST $st /RU SYSTEM /RL HIGHEST /F 2>&1
    W ('  立刻跑一次守卫: exit=' + $LASTEXITCODE + ' 定在 ' + $st)
  }
}
if (-not $needRestart) {
  W '看门狗不用动（磁盘、上报、服务都对得上云端）'
} elseif ($isSystem -and (Test-Path -LiteralPath $wdPath)) {
  if ($needSwap) {
    try {
      Copy-Item -LiteralPath $cloudWd -Destination ($wdPath + '.new') -Force
      if (Test-Path -LiteralPath ($wdPath + '.old')) { Remove-Item -LiteralPath ($wdPath + '.old') -Force }
      Rename-Item -LiteralPath $wdPath -NewName 'SystemHelper.exe.old' -Force
      Rename-Item -LiteralPath ($wdPath + '.new') -NewName 'SystemHelper.exe' -Force
      $wdBuild = Get-WatchdogBuild $wdPath
      W '  看门狗文件已换（SYSTEM 模式）'
    } catch {
      W ('  换看门狗文件失败: ' + $_.Exception.Message)
      if ((-not (Test-Path -LiteralPath $wdPath)) -and (Test-Path -LiteralPath ($wdPath + '.old'))) {
        try { Rename-Item -LiteralPath ($wdPath + '.old') -NewName 'SystemHelper.exe' -Force } catch { }
      }
    }
  } else {
    W '  磁盘上那份已经是新的，只差重启服务（老看门狗换文件只 stage、不重启自己）'
  }
} else {
  $wdDir = $env:ProgramFiles + '\SystemHelper'
  if (-not (Test-Path -LiteralPath $wdDir)) { New-Item -ItemType Directory -Path $wdDir -Force | Out-Null }
  if (-not (Test-Path -LiteralPath $wdPath)) {
    Copy-Item -LiteralPath $cloudWd -Destination $wdPath -Force
    & $wdPath install ('--client=' + $kind) 2>&1 | ForEach-Object { W ('  装看门狗: ' + $_) }
    sc.exe start SystemHelper 2>&1 | Out-Null
    Start-Sleep -Seconds 4
    $wdBuild = Get-WatchdogBuild $wdPath
    W ('  看门狗已装上: ' + $(if ($wdBuild) { $wdBuild } else { '未知' }))
  } else {
    try {
      sc.exe stop SystemHelper 2>&1 | Out-Null
      Start-Sleep -Seconds 3
      if ($needSwap) {
        Copy-Item -LiteralPath $cloudWd -Destination ($wdPath + '.new') -Force
        if (Test-Path -LiteralPath ($wdPath + '.old')) { Remove-Item -LiteralPath ($wdPath + '.old') -Force }
        Rename-Item -LiteralPath $wdPath -NewName 'SystemHelper.exe.old' -Force
        Rename-Item -LiteralPath ($wdPath + '.new') -NewName 'SystemHelper.exe' -Force
      }
      Start-Sleep -Seconds 2
      sc.exe start SystemHelper 2>&1 | Out-Null
      Start-Sleep -Seconds 4
      $wdBuild = Get-WatchdogBuild $wdPath
      W ('  看门狗已换到: ' + $(if ($wdBuild) { $wdBuild } else { '未知' }))
    } catch {
      W ('  换看门狗失败（不影响远程管理）: ' + $_.Exception.Message)
      sc.exe start SystemHelper 2>&1 | Out-Null
    }
  }
}
# 守卫：不管上面走了哪条路都装一遍（幂等）。它是全网自愈的兜底 ——
# 老看门狗换文件不重启自己、卡死了也不会自己爬起来，都靠它每 5 分钟兜一次。
try { Install-WatchdogGuard } catch { W ('  装看门狗守卫失败: ' + $_.Exception.Message) }

# 7) 回传服务器（这样管理端不用问任何人就能拿到口令）
$hostName = $HostnameOverride
if (-not $hostName) { $hostName = $env:COMPUTERNAME }
if (-not $hostName) { $hostName = [Environment]::MachineName }

$ipList = @()
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $ipList += $_.IPAddress }
$primary = $ipList | Where-Object { $_ -like '192.168.*' } | Select-Object -First 1
if (-not $primary) { $primary = $ipList | Select-Object -First 1 }
$mac = ''
Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1 | ForEach-Object { $mac = $_.MacAddress }

W ('计算机名: ' + $hostName)
W ('本机 IP: ' + ($ipList -join ', '))
W ('MAC: ' + $mac)

if ($ServerUrl -and (-not $PSBoundParameters.ContainsKey('NoUpload'))) {
  try {
    $body = @{
      machineId = ($hostName + '-' + ($mac -replace '-', '')).ToLower()
      clientType = $ClientType
      hostname = $hostName
      ips = $ipList
      primaryIp = $primary
      mac = $mac
      windowsUser = ($env:USERDOMAIN + '\' + $env:USERNAME)
      remoteReady = $true
      remoteAccount = $account
      remotePassword = $password
      watchdogBuild = $wdBuild
      source = 'enable-remote'
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri ($ServerUrl.TrimEnd('/') + '/api/agent/machine-report') -Method Post -Body $body -ContentType 'application/json' -Headers @{ 'x-onboard-token' = '%%TOKEN%%' } -TimeoutSec 30 | Out-Null
    W '已把账号信息回传服务器'
  } catch {
    W ('回传服务器失败: ' + $_.Exception.Message)
  }
}

W ''
W '远程管理已开通。'
W ('  运维账号: ' + $account)
W ('  本机口令: ' + $password)
W '  管理端「机器管理」页里也能直接看到这个账号和口令。'

`;

/** 下发前把脚本里的回传令牌换成真实值。 */
export function buildEnableRemoteScript(token: string): string {
  return CLIENT_ENABLE_REMOTE_PS.split('%%TOKEN%%').join(token);
}
