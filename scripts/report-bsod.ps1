# chunlv-bsod-report.ps1 —— 蓝屏取证 + 远程管理账号修复（给老板 / 客服现场用）
#
# 为什么要这个脚本（2026-09-30）：
#   老板报「192.168.1.4 邵泽慧那台蓝屏了」。远程一看：机器在线、445/135 都开着，
#   但装机时建的 chunlvops 账号**密码已过期**（STATUS_PASSWORD_EXPIRED），Windows 拒绝一切
#   远程登录 —— 服务端拿不到它的日志，人也连不进去，只能等人到电脑跟前。
#   这个脚本在那台电脑上双击跑一次：①把远程管理账号修好（下次我直接远程看）；
#   ②把蓝屏（BugCheck）现场、转储文件、显卡驱动、硬件错误等取证回传服务器。
#
# 用法（目标机，管理员）：右键「以管理员身份运行」，或双击（会自动提权）。
# 回传结果落服务器 /home/ubuntu/chunlv/onboard-reports/diag/ 与 machines.jsonl。
#
# 自检开关（只给自己/装机验证用，现场双击不用管）：
#   -NoRemoteFix  不改本机 chunlvops 账号（干跑）
#   -NoUpload     不回传服务器（干跑）
#   -NoPause      跑完不等人按回车

param(
  [switch]$NoRemoteFix,
  [switch]$NoUpload,
  [switch]$NoPause
)

$ErrorActionPreference = 'SilentlyContinue'
$SERVER = 'http://1.117.229.36:3001'
$TOKEN  = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34'
$OUT    = Join-Path $env:SystemRoot 'Temp\chunlv-bsod-report.txt'
$script:LINES = New-Object System.Collections.Generic.List[string]
$script:MAX_LINES = 4000
function L($s) {
  if ($script:LINES.Count -ge $script:MAX_LINES) { return }
  if ($script:LINES.Count -eq ($script:MAX_LINES - 1)) { $s = '（报告太长，后面的内容已省略）' }
  $script:LINES.Add([string]$s); Write-Host $s
}
function Sec($t) { L ''; L ('===== ' + $t + ' =====') }
# 安全读文本尾部：含 NUL 的当二进制跳过，再按 UTF-8 解一次，明显乱码就换 GBK。
function TailText($f, $n) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $nul = 0
    foreach ($b in $bytes) { if ($b -eq 0) { $nul++ } }
    if ($bytes.Length -gt 0 -and $nul -gt ($bytes.Length / 100)) { L '   （二进制文件，跳过）'; return }
    $txt = [System.Text.Encoding]::UTF8.GetString($bytes)
    $head = $txt.Substring(0, [Math]::Min(4000, $txt.Length))
    $bad = @($head.ToCharArray() | Where-Object { $_ -eq [char]0xFFFD }).Count
    if ($bad -gt 40) { try { $txt = [System.Text.Encoding]::GetEncoding(936).GetString($bytes) } catch {} }
    $lines = @($txt -split "`r?`n")
    foreach ($ln in @($lines | Select-Object -Last $n)) { L ('   ' + $ln) }
  } catch { L ('   读日志失败: ' + $_.Exception.Message) }
}
function NetExe { $p = Join-Path $env:SystemRoot 'System32\net.exe'; if (Test-Path -LiteralPath $p) { return $p } return 'net.exe' }

# ── 提权 ──
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  L '需要管理员权限，正在重新以管理员身份启动…'
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $PSCommandPath + '"') -Verb RunAs
  exit
}

# ── 0. 基本信息 ──
Sec '基本信息'
L ('时间       : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$hostName = $env:COMPUTERNAME
if (-not $hostName) { try { $hostName = [System.Net.Dns]::GetHostName() } catch {} }
if (-not $hostName) { try { $hostName = (Get-CimInstance Win32_ComputerSystem).Name } catch {} }
L ('机器名     : ' + $hostName)
L ('当前用户   : ' + $env:USERNAME)
# 取「到外网去的真实出口网卡」。直接 Get-NetIPAddress 会被 VMware/虚拟网卡抢答成
# 192.168.x.1 这种假地址（这台机器就踩过：报成 192.168.80.1）。
$lan = $null
try {
  $lan = (Find-NetRoute -RemoteIPAddress '223.5.5.5' -ErrorAction Stop | Where-Object { $_.IPAddress -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1).IPAddress
} catch {}
if (-not $lan) {
  $lan = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' -and $_.InterfaceAlias -notmatch 'VMware|Virtual|vEthernet|Hyper-V|Docker|Loopback' } | Select-Object -First 1)[0].IPAddress
}
if (-not $lan) { $lan = 'unknown' }
L ('内网 IP    : ' + $lan)
$os = Get-CimInstance Win32_OperatingSystem
if ($os) {
  L ('系统       : ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber)
  L ('上次开机   : ' + $os.LastBootUpTime)
  L ('内存       : ' + [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) + ' GB')
}
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs) { L ('机型/厂商  : ' + $cs.Manufacturer + ' ' + $cs.Model) }
$cc = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl'
if ($cc) { L ('转储设置   : CrashDumpEnabled=' + $cc.CrashDumpEnabled + ' MinidumpDir=' + $cc.MinidumpDir + ' DumpFile=' + $cc.DumpFile) }

# ── 1. 蓝屏记录 ──
Sec '蓝屏记录：System 日志 1001 (BugCheck)'
$bc = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001} -MaxEvents 6)
if ($bc.Count -eq 0) { L '（没有 1001 记录：可能没蓝屏过，或系统关了转储/日志被清）' }
foreach ($e in $bc) {
  L ('-- ' + $e.TimeCreated + '  ' + $e.ProviderName)
  L ('   ' + (($e.Message -replace "`r?`n", ' ').Trim()))
}

Sec '异常关机 / 意外重启：41 (Kernel-Power) / 6008 / 6005 / 6006'
$shut = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=@(41,6008,6005,6006)} -MaxEvents 12)
if ($shut.Count -eq 0) { L '（无）' }
foreach ($e in $shut) {
  $m = ($e.Message -replace "`r?`n", ' ').Trim()
  if ($m.Length -gt 200) { $m = $m.Substring(0, 200) }
  L ('-- ' + $e.TimeCreated + ' | Id=' + $e.Id + ' | ' + $m)
}

Sec '显卡驱动复位：4101 (显示驱动停止响应并已恢复，蓝屏常见前兆)'
$tdr = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=4101} -MaxEvents 8)
if ($tdr.Count -eq 0) { L '（无）' }
foreach ($e in $tdr) { L ('-- ' + $e.TimeCreated + ' | ' + (($e.Message -replace "`r?`n", ' ').Trim())) }

Sec '硬件错误：WHEA-Logger 17/18/19/47'
$whea = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'} -MaxEvents 8)
if ($whea.Count -eq 0) { L '（无）' }
foreach ($e in $whea) { L ('-- ' + $e.TimeCreated + ' | Id=' + $e.Id + ' | ' + (($e.Message -replace "`r?`n", ' ').Trim())) }

Sec '转储文件（C:\Windows\Minidump）'
$dumps = @(Get-ChildItem (Join-Path $env:SystemRoot 'Minidump\*.dmp') | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
if ($dumps.Count -eq 0) { L '（没有 minidump）' }
foreach ($d in $dumps) { L ('-- ' + $d.Name + '  ' + $d.LastWriteTime + '  ' + [math]::Round($d.Length / 1MB, 1) + ' MB') }
$newest = $dumps | Select-Object -First 1
if ($newest) {
  try {
    $txt = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($newest.FullName))
    $mods = [regex]::Matches($txt, '[A-Za-z0-9_\-\.]{3,40}\.(sys|dll)') | ForEach-Object { $_.Value.ToLower() } | Sort-Object -Unique
    L ('转储里出现的驱动/模块（最多 70 个）: ' + (($mods | Select-Object -First 70) -join ', '))
    $ours = @($mods | Where-Object { $_ -match 'chunlv|systemhelper|peiwang' })
    L ('其中属于我们自己的组件: ' + $(if ($ours.Count -gt 0) { ($ours -join ', ') } else { '（无）' }))
  } catch { L ('读转储失败: ' + $_.Exception.Message) }
}
$mem = Join-Path $env:SystemRoot 'MEMORY.DMP'
if (Test-Path -LiteralPath $mem) { L ('另有完整转储: ' + $mem + '  ' + (Get-Item -LiteralPath $mem).LastWriteTime) }

Sec 'WER 内核报告（含 BugcheckCode）'
$wer = @(Get-ChildItem 'C:\ProgramData\Microsoft\Windows\WER\ReportArchive' -Directory | Where-Object { $_.Name -like 'Kernel*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
if ($wer.Count -eq 0) { L '（无）' }
foreach ($w in $wer) {
  L ('-- ' + $w.Name + '  ' + $w.LastWriteTime)
  $rep = Join-Path $w.FullName 'Report.wer'
  if (Test-Path -LiteralPath $rep) {
    Get-Content -LiteralPath $rep | Where-Object { $_ -match '^(EventType|BugcheckCode|BugcheckParameter1|BugcheckParameter2|WindowsCrashTime|AppName|Response)' } | ForEach-Object { L ('   ' + $_) }
  }
}

Sec '显卡 / 驱动版本'
Get-CimInstance Win32_VideoController | ForEach-Object { L ('-- ' + $_.Name + ' | driver ' + $_.DriverVersion + ' | ' + $_.DriverDate) }

Sec '装了哪些反作弊 / 游戏平台（从卸载列表里挑）'
$keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
$apps = Get-ItemProperty $keys | Where-Object { $_.DisplayName } | Select-Object -ExpandProperty DisplayName -Unique | Sort-Object
$hits = @($apps | Where-Object { $_ -match 'ACE|TenProtect|腾讯|反作弊|Anti|Vanguard|Valorant|无畏|三角洲|网易|NetEase|完美|Riot|EasyAntiCheat|BattlEye|WeGame|英雄联盟|League|NVIDIA|AMD|Intel|MSI|雷蛇|Razer|火绒|360|腾讯电脑管家' })
if ($hits.Count -eq 0) { L '（没匹配到常见反作弊/平台/安全软件）' }
foreach ($h in $hits) { L ('-- ' + $h) }

Sec '我们自己的客户端 / 看门狗日志（最后 60 行）'
# 只读「真日志」：客户端自己写的 logs 目录 + 看门狗的 service.log。
# 别整个目录递归 *.log —— Electron 的 Local Storage / Session Storage 里也有 .log，
# 那是 LevelDB 二进制，读进来会把报告刷成一堆乱码（这台机器就踩过）。
$logFiles = @()
foreach ($d in @((Join-Path $env:APPDATA '@chunlv'), (Join-Path $env:APPDATA 'logs'), 'C:\Program Files\SystemHelper', 'C:\Program Files (x86)\SystemHelper')) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  $logFiles += @(Get-ChildItem -LiteralPath $d -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.log' -and $_.Length -lt 4MB -and ($_.FullName -match '\\logs\\' -or $_.Name -eq 'service.log') })
}
$logFiles = @($logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 6)
if ($logFiles.Count -eq 0) { L '（没找到客户端 / 看门狗日志）' }
foreach ($f in $logFiles) {
  L ('-- ' + $f.FullName + '  (' + $f.LastWriteTime + ')')
  TailText $f 60
}

Sec '最近 24 小时严重错误（级别 1/2，最多 40 条）'
$sev = @(Get-WinEvent -FilterHashtable @{LogName='System'; Level=@(1,2); StartTime=(Get-Date).AddHours(-24)} -MaxEvents 40)
if ($sev.Count -eq 0) { L '（无）' }
foreach ($e in $sev) {
  $m = ($e.Message -replace "`r?`n", ' ').Trim()
  if ($m.Length -gt 160) { $m = $m.Substring(0, 160) }
  L ('-- ' + $e.TimeCreated + ' | ' + $e.ProviderName + ' | Id=' + $e.Id + ' | ' + $m)
}

# ── 2. 修远程管理账号（密码过期 = 远程永远连不进来）──
if ($NoRemoteFix) {
  Sec '远程管理账号 chunlvops'
  $adminUser = 'chunlvops'
  $newPass = ''
  L '（-NoRemoteFix：本次干跑，没有改动本机任何账号/策略）'
} else {
Sec '远程管理账号 chunlvops'
$adminUser = 'chunlvops'
$needFix = $false
$u = Get-LocalUser -Name $adminUser
if (-not $u) {
  $needFix = $true
  L '账号不存在 → 新建'
} else {
  L ('账号存在：密码过期标志 PasswordExpires=' + $u.PasswordExpires)
  $raw = (& (NetExe) user $adminUser) -join ' '
  L ('net user 摘要: ' + (($raw -replace '\s+', ' ').Trim()))
  if ($u.PasswordExpires -ne $false) { $needFix = $true; L '密码会过期 → 重设并设为永不过期' }
  if ($raw -match 'Password expires\s+([0-9/]+)') {
    $d = [datetime]::MinValue
    if ([datetime]::TryParse($matches[1], [ref]$d)) { if ($d -lt (Get-Date)) { $needFix = $true; L '密码已过期 → 重设' } }
  }
}
$admGroup = 'Administrators'
try { $admGroup = (Get-LocalGroup -SID 'S-1-5-32-544').Name } catch {}
$isAdm = $false
try { $isAdm = (@(Get-LocalGroupMember -Group $admGroup | Where-Object { $_.Name -like ('*\' + $adminUser) }).Count -gt 0) } catch {}
$newPass = ''
if ($needFix) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $rand = New-Object System.Random
  $newPass = 'Chunlv!' + (-join (1..6 | ForEach-Object { $chars[$rand.Next($chars.Length)] })) + $rand.Next(10)
  try {
    $sec = ConvertTo-SecureString $newPass -AsPlainText -Force
    if ($u) { Set-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires $true }
    else { New-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires -Description 'Chunlv remote support account' | Out-Null }
    L '密码已重设（永不过期）'
  } catch {
    L ('PowerShell 重设失败，改用 net：' + $_.Exception.Message)
    & (NetExe) user $adminUser $newPass /add /passwordchg:no /expires:never | Out-Null
    L '密码已重设（net，永不过期）'
  }
} else { L '账号状态正常，密码不动' }
if (-not $isAdm) { & (NetExe) localgroup $admGroup $adminUser /add | Out-Null; L '已加入管理员组' }
try {
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -Force
  L '远程管理通道（LocalAccountTokenFilterPolicy=1）已配好'
} catch {}
}

# ── 3. 打印账号 + 落盘 + 回传 ──
L ''
if ($newPass) { L ('本机远程管理账号: ' + $adminUser + ' / ' + $newPass) }
else { L ('本机远程管理账号: ' + $adminUser + '（密码未改，如远程仍连不上请告诉我）') }

try { $script:LINES | Out-File -LiteralPath $OUT -Encoding utf8; Write-Host ('
已保存到 ' + $OUT) } catch {}

if (-not $NoUpload) {
try {
  $mac = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).MacAddress
  $body = @{ hostname = $hostName; ip = $lan; mac = $mac; account = $adminUser; password = $newPass; version = 'bsod-report'; source = 'bsod-report' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri ($SERVER + '/api/agent/onboard-report') -Method Post -Headers @{ 'x-onboard-token' = $TOKEN } -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null
  Write-Host '远程管理账号已回传服务器（下次可直接远程）'
} catch { Write-Host ('账号回传失败: ' + $_.Exception.Message) }

try {
  $body2 = @{ hostname = $hostName; ip = $lan; version = 'bsod-report'; source = 'bsod-report'; lines = ($script:LINES -join "`n") } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri ($SERVER + '/api/agent/diag-report') -Method Post -Headers @{ 'x-onboard-token' = $TOKEN } -ContentType 'application/json' -Body $body2 -TimeoutSec 60 | Out-Null
  Write-Host '蓝屏取证已回传服务器（管理员可直接看）'
} catch { Write-Host ('取证回传失败: ' + $_.Exception.Message) }
} else { Write-Host '（-NoUpload：本次干跑，没有回传服务器）' }

Write-Host ''
Write-Host '完成。把这个窗口里的内容截图发我也行。' -ForegroundColor Green
if (-not $NoPause) { Read-Host '按回车键退出' }
