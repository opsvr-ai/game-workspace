# chunlv-repair-cs.ps1 —— 客服端（客服管理）一键修复
#
# 为什么有这一段（老板 2026-09-30）：
#   「邵泽慧的我已经运行了.bat，还是蓝屏」。那不是 Windows 蓝屏死机 ——
#   她机器 2023 年之后再没崩过（蓝屏转储里 2026 年的一个都没有）。
#   是**很老的客服端连不上服务器**：窗口整片深蓝（客户端底色 #0B1024），页面一个字都没渲染出来。
#   两个原因叠在一起：
#     ① 客户端配置文件里的服务器地址被改成了 http://localhost:3001 —— 指向它自己这台电脑，
#        永远连不上云服务器（同一台机器的陪玩端日志里能看到 serverUrl":"http://localhost:3001"）；
#     ② 客户端一直更新不上，停在很老的版本 —— 老版本连「连不上服务器」的兜底页都没有，只剩深蓝。
#   所以本脚本：① 先把服务器地址全部改回云端（这一步往往就已经救回来了）
#              ② 再把客服端换到最新版 ③ 修好桌面图标 ④ 把机器报回台账（以后能远程诊断）。
#
# 用法（客服现场双击「修复客服端.bat」就行）：
#   -DiagOnly         只看现场、只回传，什么都不改（排查用，绝对安全）
#   -ServerUrl=xxx    指定服务器地址（默认 http://1.117.229.36:3001）
$ErrorActionPreference = 'Continue'
$cloud = 'http://1.117.229.36:3001'
foreach ($a in $args) { if (($a -is [string]) -and $a.StartsWith('-ServerUrl=')) { $cloud = $a.Substring(11) } }
if ($env:CHUNLV_SERVER_URL) { $cloud = $env:CHUNLV_SERVER_URL }
$cloud = $cloud.TrimEnd('/')
$onboardToken = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34'
$cn = '客服管理'
$exeName = '客服管理.exe'
$log = Join-Path $env:TEMP 'chunlv-repair-cs.log'
$nl = [string][char]13 + [string][char]10

function W([string]$m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Host $line
  try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
}

function Host-Name {
  # 环境变量不一定在（远程/服务上下文里常见），拿不到就用系统 API。
  if ($env:COMPUTERNAME) { return $env:COMPUTERNAME }
  try { return [System.Net.Dns]::GetHostName() } catch { }
  return 'unknown'
}

function Public-Desktop {
  $p = $env:PUBLIC
  if (-not $p) { $p = [Environment]::GetEnvironmentVariable('PUBLIC', 'Machine') }
  if (-not $p) { $p = 'C:\Users\Public' }
  return (Join-Path $p 'Desktop')
}

# 所有可能藏着「客户端配置文件」的目录（客服端 + 陪玩端，新名字 + 老名字都扫）。
# 一台机器上装过好几个版本的情况很常见（邵泽慧那台就是两个混装），只修一个目录等于白修。
function Get-ConfigRoots {
  $roots = @(
    'C:\Program Files\客服管理', 'C:\Program Files (x86)\客服管理',
    'C:\Program Files\@chunlvcs-electron', 'C:\Program Files (x86)\@chunlvcs-electron',
    'C:\Program Files\陪玩管理', 'C:\Program Files (x86)\陪玩管理',
    'C:\Program Files\@chunlvcompanion-electron', 'C:\Program Files (x86)\@chunlvcompanion-electron',
    'C:\Program Files\蠢驴电竞', 'C:\Program Files (x86)\蠢驴电竞'
  )
  if ($env:LOCALAPPDATA) {
    $roots += (Join-Path $env:LOCALAPPDATA 'Programs\客服管理')
    $roots += (Join-Path $env:LOCALAPPDATA 'Programs\@chunlvcs-electron')
    $roots += (Join-Path $env:LOCALAPPDATA 'Programs\陪玩管理')
    $roots += (Join-Path $env:LOCALAPPDATA 'Programs\蠢驴电竞')
    $roots += (Join-Path $env:LOCALAPPDATA '客服管理')
    $roots += (Join-Path $env:LOCALAPPDATA '陪玩管理')
  }
  if ($env:APPDATA) {
    $roots += (Join-Path $env:APPDATA '@chunlv\cs-electron')
    $roots += (Join-Path $env:APPDATA '@chunlv\companion-electron')
    $roots += (Join-Path $env:APPDATA '客服管理')
    $roots += (Join-Path $env:APPDATA '陪玩管理')
  }
  return $roots
}
$script:configRels = @('config.json', 'resources\config.json', 'companion-config.json', 'resources\companion-config.json')

function Test-Cloud {
  for ($i = 1; $i -le 2; $i++) {
    try {
      $r = Invoke-WebRequest -Uri ($cloud + '/api/health') -UseBasicParsing -TimeoutSec 15
      if ($r.StatusCode -eq 200) { return $true }
    } catch { if ($i -eq 2) { W ('连不上服务器 ' + $cloud + '：' + $_.Exception.Message) } }
    Start-Sleep -Seconds 2
  }
  return $false
}

# 挑「真正在用的那张网卡」：装了 VMware/VirtualBox 的机器上一堆 192.168.* 虚拟网卡，
# 按顺序挑第一个挑到的往往是虚拟网卡，报上去的地址就不是这台机器实际在用的那个。
function Get-PrimaryNet {
  $ip = ''
  try {
    $route = @(Find-NetRoute -RemoteIPAddress ([System.Uri]$cloud).Host -ErrorAction Stop |
      Where-Object { $_.IPAddress -and ($_.IPAddress -notlike '*:*') } | Select-Object -First 1)
    if ($route.Count -gt 0) { $ip = [string]$route[0].IPAddress }
  } catch { }
  if (-not $ip) {
    try {
      $ip = [string]((Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress)
    } catch { }
  }
  $mac = ''
  try {
    if ($ip) {
      $cfg = Get-NetIPAddress -IPAddress $ip -ErrorAction Stop
      $mac = [string](Get-NetAdapter -InterfaceIndex $cfg.InterfaceIndex -ErrorAction Stop).MacAddress
    }
  } catch { }
  if (-not $mac) {
    try {
      $mac = [string]((Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
        Where-Object { $_.IPEnabled } | Select-Object -First 1).MACAddress)
    } catch { }
  }
  if ($mac) { $mac = ($mac -replace ':', '-').ToUpper() }
  return @{ ip = $ip; mac = $mac }
}

# 机器标识必须和客户端自己报的算法一致（主机名 + 网卡MAC），
# 否则「机器管理」里会出现同一台电脑两行（一眼看上去像两台机器）。
function Get-MachineId {
  $net = Get-PrimaryNet
  $base = ((Host-Name).ToLower() -replace '[^a-z0-9-]', '')
  $macPart = ([string]$net.mac -replace '[^a-zA-Z0-9]', '').ToLower()
  if ($macPart) { return ($base + '-' + $macPart) }
  return $base
}

function Send-Diag([string]$source, [string]$text) {
  try {
    # 中文必须自己转成 UTF-8 字节再发：Windows PowerShell 5.1 的 Invoke-RestMethod
    # 默认按 ANSI 发 body，回传上来的中文全变 "?"，等于白回传。
    $json = (@{ hostname = (Host-Name); source = $source; lines = $text } | ConvertTo-Json -Compress -Depth 6)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Invoke-RestMethod -Uri ($cloud + '/api/agent/diag-report') -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-onboard-token' = $onboardToken } -Body $bytes -TimeoutSec 120 | Out-Null
    W ('诊断已回传云端：' + $source)
    return $true
  } catch {
    W ('诊断回传失败（不影响修复）：' + $_.Exception.Message)
    return $false
  }
}

function Send-MachineReport([string]$appVersion, [string]$installDir, [string]$note) {
  try {
    $net = Get-PrimaryNet
    $body = @{
      machineId   = (Get-MachineId)
      clientType  = 'CS'
      hostname    = (Host-Name)
      windowsUser = ($env:USERDOMAIN + '\' + $env:USERNAME)
      primaryIp   = $net.ip
      mac         = $net.mac
      os          = ('Windows ' + [System.Environment]::OSVersion.Version.ToString())
      appVersion  = $appVersion
      remoteReady = $true
      installDir  = $installDir
      note        = $note
      source      = 'repair-cs'
    }
    $json = ($body | ConvertTo-Json -Compress -Depth 6)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Invoke-RestMethod -Uri ($cloud + '/api/agent/machine-report') -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-onboard-token' = $onboardToken } -Body $bytes -TimeoutSec 60 | Out-Null
    W ('机器台账已上报：' + $body.machineId)
    return $true
  } catch {
    W ('机器台账上报失败（不影响修复）：' + $_.Exception.Message)
    return $false
  }
}

function Tail([string]$path, [int]$n) {
  if (-not (Test-Path -LiteralPath $path)) { return '<不存在>' }
  try { return ((Get-Content -LiteralPath $path -Tail $n -ErrorAction Stop) -join $nl) } catch { return '<读不了>' }
}
function Collect-Diag {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('host=' + (Host-Name))
  [void]$sb.AppendLine('time=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  [void]$sb.AppendLine('user=' + $env:USERNAME)
  try { [void]$sb.AppendLine('os=' + (Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [System.Environment]::OSVersion.Version.ToString()) } catch { }
  [void]$sb.AppendLine('ps=' + $PSVersionTable.PSVersion.ToString())
  [void]$sb.AppendLine('cloud=' + $cloud)
  $net = Get-PrimaryNet
  [void]$sb.AppendLine('ip=' + $net.ip + ' mac=' + $net.mac)

  [void]$sb.AppendLine('[server reachable]')
  [void]$sb.AppendLine('  ' + (Test-Cloud))

  [void]$sb.AppendLine('[proxy]')
  try {
    $ps = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    [void]$sb.AppendLine(('  ProxyEnable={0} ProxyServer={1} AutoConfigURL={2}' -f $ps.ProxyEnable, $ps.ProxyServer, $ps.AutoConfigURL))
    [void]$sb.AppendLine('  ProxyOverride=' + $ps.ProxyOverride)
  } catch { [void]$sb.AppendLine('  <读不到>') }
  try {
    $acc = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'v2ray|clash|verge|sing-box|shadowsocks|xray|netch|leigod|xunyou|tiantian' } | Select-Object -ExpandProperty ProcessName -Unique
    [void]$sb.AppendLine('  accelerators=' + (@($acc) -join ','))
  } catch { }

  [void]$sb.AppendLine('[processes]')
  foreach ($p in @(Get-ClientProcs)) {
    [void]$sb.AppendLine(('  {0} pid={1} path={2}' -f $p.ProcessName, $p.Id, $p.Path))
  }

  [void]$sb.AppendLine('[service SystemHelper]')
  $svc = Get-Service SystemHelper -ErrorAction SilentlyContinue
  [void]$sb.AppendLine('  status=' + $(if ($svc) { $svc.Status } else { '<未安装>' }))

  [void]$sb.AppendLine('[install dirs]')
  foreach ($d in @(Get-ConfigRoots)) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    [void]$sb.AppendLine('  ' + $d)
    foreach ($x in @((Join-Path $d $exeName), (Join-Path $d '蠢驴电竞.exe'), (Join-Path $d '客服端.exe'))) {
      if (Test-Path -LiteralPath $x) {
        $fi = Get-Item -LiteralPath $x
        [void]$sb.AppendLine(('    EXE {0} size={1} version={2} mtime={3}' -f $x, $fi.Length, $fi.VersionInfo.ProductVersion, $fi.LastWriteTime))
      }
    }
    foreach ($r in $script:configRels) {
      $p = Join-Path $d $r
      if (Test-Path -LiteralPath $p) {
        $v = '<读不了>'
        try { $v = [string]((Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json).serverUrl) } catch { }
        [void]$sb.AppendLine(('    CFG {0} serverUrl={1}' -f $p, $v))
      }
    }
  }

  [void]$sb.AppendLine('[client logs]')
  foreach ($d in @((Join-Path $env:APPDATA '@chunlv\cs-electron'), (Join-Path $env:APPDATA '@chunlv\companion-electron'))) {
    $ld = Join-Path $d 'logs'
    if (-not (Test-Path -LiteralPath $ld)) { continue }
    $lf = Get-ChildItem -LiteralPath $ld -Filter '*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($lf) {
      [void]$sb.AppendLine('  ' + $lf.FullName + ' mtime=' + $lf.LastWriteTime)
      [void]$sb.AppendLine((Tail $lf.FullName 40))
    }
  }
  return $sb.ToString()
}

# ── 服务器地址归位 ────────────────────────────────────────────────────────────
# 这是最容易见效的一步：老客户端只要地址对了，多半立刻就能打开。
function Fix-ServerConfig {
  $changed = @()
  foreach ($d in @(Get-ConfigRoots)) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    foreach ($r in $script:configRels) {
      $p = Join-Path $d $r
      if (-not (Test-Path -LiteralPath $p)) { continue }
      try {
        $txt = Get-Content -LiteralPath $p -Raw -Encoding UTF8
        $obj = $txt | ConvertFrom-Json
        if ($null -eq $obj) { continue }
        if (-not ($obj.PSObject.Properties.Name -contains 'serverUrl')) { continue }
        $cur = [string]$obj.serverUrl
        if ($cur.TrimEnd('/') -eq $cloud) { continue }
        Copy-Item -LiteralPath $p -Destination ($p + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force -ErrorAction SilentlyContinue
        $obj.serverUrl = $cloud
        # 必须写成「不带 BOM」的 UTF-8：客户端是 JSON.parse 读的，带 BOM 会解析失败，
        # 整份配置就被忽略（等于又回到默认地址）。PowerShell 5.1 的 Set-Content -Encoding UTF8 会加 BOM。
        $text = ($obj | ConvertTo-Json -Depth 8)
        [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))
        W ('地址已归位：' + $p + '  (' + $cur + ' -> ' + $cloud + ')')
        $changed += ($p + ' : ' + $cur)
      } catch {
        W ('改不了这个配置（跳过）：' + $p + ' ' + $_.Exception.Message)
      }
    }
  }
  return $changed
}

# ── 代理体检 ──────────────────────────────────────────────────────────────────
# 客服电脑上常见加速器/科学上网工具（v2rayN、Clash…）。它们不一定坏，但会让
# 「明明能上网却连不上服务器」，所以顺手把服务器地址加进「不走代理」名单。
function Fix-ProxyBypass {
  try {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    $ps = Get-ItemProperty -Path $key -ErrorAction Stop
    $hostName = ([System.Uri]$cloud).Host
    if ($ps.ProxyEnable -eq 1) { W ('检测到系统代理已打开：' + $ps.ProxyServer + '（如果连不上服务器，先把它关掉）') }
    $ov = [string]$ps.ProxyOverride
    if ($ov -notlike ('*' + $hostName + '*')) {
      $nv = $hostName
      if ($ov) { $nv = $ov + ';' + $hostName }
      Set-ItemProperty -Path $key -Name ProxyOverride -Value $nv -ErrorAction Stop
      W ('已把 ' + $hostName + ' 加入「不走代理」名单（只影响这一个地址）')
    }
  } catch { W ('代理设置没动（不影响修复）：' + $_.Exception.Message) }
  try {
    $acc = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'v2ray|clash|verge|sing-box|shadowsocks|xray|netch|leigod|xunyou|tiantian' } | Select-Object -ExpandProperty ProcessName -Unique)
    if ($acc.Count -gt 0) { W ('这台电脑正在跑代理/加速器：' + ($acc -join ',') + ' —— 修好后如果还连不上，先把它退掉再开客服端') }
  } catch { }
}

# ── 关掉客户端 ────────────────────────────────────────────────────────────────
function Get-ClientProcs {
  $list = @()
  # 「客服管理」在老版本里可能叫别的名字（客服端 / 蠢驴电竞），所以还要按 exe 路径找。
  $list += Get-Process -Name '客服管理', '客服端', '蠢驴电竞' -ErrorAction SilentlyContinue
  $dirs = @(Get-ConfigRoots)
  foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $pth = $p.ExecutablePath
    if (-not $pth) { continue }
    $hit = $false
    foreach ($d in $dirs) { if ($pth.StartsWith($d + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true } }
    if ($hit) {
      $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      if ($proc) { $list += $proc }
    }
  }
  return @($list | Where-Object { $_ -ne $null } | Sort-Object Id -Unique)
}

function Resolve-CsInstallDir {
  foreach ($d in @('C:\Program Files\客服管理', 'C:\Program Files\@chunlvcs-electron',
                   'C:\Program Files (x86)\客服管理', 'C:\Program Files (x86)\@chunlvcs-electron')) {
    if (Test-Path -LiteralPath (Join-Path $d $exeName)) { return $d }
  }
  foreach ($d in @('C:\Program Files\客服管理', 'C:\Program Files\@chunlvcs-electron')) {
    if (Test-Path -LiteralPath $d) { return $d }
  }
  return 'C:\Program Files\客服管理'
}

function Get-InstalledVersion {
  foreach ($p in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                   'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
                   'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    try {
      $hit = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and ($_.DisplayName -match '客服管理') } | Select-Object -First 1
      if ($hit -and $hit.DisplayVersion) { return [string]$hit.DisplayVersion }
    } catch { }
  }
  return ''
}

function Get-LatestVersion {
  try {
    $r = Invoke-RestMethod -Uri ($cloud + '/api/agent/cs-version') -TimeoutSec 30
    return [string]$r.data.version
  } catch { return '' }
}

function Fix-Shortcut([string]$exePath) {
  if (-not (Test-Path -LiteralPath $exePath)) { return }
  $dir = Split-Path -Parent $exePath
  $desktops = @((Public-Desktop))
  Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = Join-Path $_.FullName 'Desktop'
    if (Test-Path -LiteralPath $d) { $desktops += $d }
  }
  $w = New-Object -ComObject WScript.Shell
  foreach ($d in ($desktops | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    try {
      $s = $w.CreateShortcut((Join-Path $d ($cn + '.lnk')))
      $s.TargetPath = $exePath
      $s.WorkingDirectory = $dir
      $s.IconLocation = ($exePath + ',0')
      $s.Description = $cn
      $s.Save()
      W ('桌面图标已修好：' + (Join-Path $d ($cn + '.lnk')))
    } catch { W ('图标写不进去：' + $d) }
    # 清掉指向「已经不存在的文件」的老图标（老品牌的图标点了只会报错）。
    Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name -match $cn) { return }
      if (-not ($_.Name -match '蠢驴|chunlv|客服')) { return }
      $t = ''
      try { $t = $w.CreateShortcut($_.FullName).TargetPath } catch { }
      if ($t -ne $exePath) {
        $alive = $false
        if ($t) { $alive = Test-Path -LiteralPath $t }
        if (-not $alive) {
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
          W ('清掉失效图标：' + $_.FullName)
        }
      }
    }
  }
}# 装完之后到哪儿去找「新装上的客服端」：
# electron-builder 对中文 productName 的安装目录有回退行为（历史上就出现过
# @chunlvcompanion-electron 这种「包名」目录，而不是中文名目录），所以不能只认一个路径 ——
# 不然明明装成功了，脚本却报「没装上」，客服白等一场。
function Find-CsExe {
  $cands = @()
  foreach ($d in @('C:\Program Files\客服管理', 'C:\Program Files\@chunlvcs-electron',
                   'C:\Program Files (x86)\客服管理', 'C:\Program Files (x86)\@chunlvcs-electron')) {
    $cands += (Join-Path $d $exeName)
  }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $base) { continue }
    $subs = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'chunlv|客服|蠢驴' }
    foreach ($s in $subs) { $cands += (Join-Path $s.FullName $exeName) }
  }
  $found = @()
  foreach ($c in ($cands | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $c)) { continue }
    $fi = Get-Item -LiteralPath $c
    if ($fi.Length -lt 30000000) { continue }
    $found += @{ exe = $c; size = $fi.Length; mtime = $fi.LastWriteTime; fresh = ($fi.LastWriteTime -gt (Get-Date).AddMinutes(-15)) }
  }
  if ($found.Count -eq 0) { return $null }
  $fresh = $found | Where-Object { $_.fresh } | Select-Object -First 1
  if ($fresh) { return $fresh }
  return $found[0]
}

$DiagOnly = ($args -contains '-DiagOnly') -or ($env:CHUNLV_DIAG_ONLY -eq '1')

Write-Host ''
Write-Host '===== 蠢驴电竞 · 客服端（客服管理）一键修复 =====' -ForegroundColor Cyan
Write-Host ('本机：' + (Host-Name) + '   时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host '这一步会：① 把服务器地址改回云端 ② 换装最新客服端 ③ 修好桌面图标 ④ 把机器报回台账'
Write-Host ''
W '开始收集现场…'
$before = Collect-Diag
Send-Diag 'repair-cs-before' $before | Out-Null

if ($DiagOnly) {
  Write-Host ''
  Write-Host '只做诊断（-DiagOnly）：现场已回传云端，本机未做任何改动。' -ForegroundColor Green
  Write-Host ('本机日志：' + $log)
  exit 0
}

# ── 1/6 网络体检 ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '[1/6] 检查这台电脑能不能连上服务器…' -ForegroundColor Cyan
$online = Test-Cloud
if ($online) { W ('服务器连得上：' + $cloud) } else { W ('连不上服务器：' + $cloud + '（下面会先修地址和代理，再重试）') }
Fix-ProxyBypass

# ── 2/6 服务器地址归位 ───────────────────────────────────────────────────────
Write-Host ''
Write-Host '[2/6] 把客户端里的服务器地址全部改回云端…' -ForegroundColor Cyan
$fixed = @(Fix-ServerConfig)
if ($fixed.Count -eq 0) { W '没有发现被改坏的地址（这台机器的配置本来就是对的）' }
else { W ('共改回 ' + $fixed.Count + ' 处地址') }

# ── 3/6 关掉正在跑的客户端 ───────────────────────────────────────────────────
Write-Host ''
Write-Host '[3/6] 关掉正在跑的客服端（安装程序要替换文件）…' -ForegroundColor Cyan
for ($i = 0; $i -lt 4; $i++) {
  $victims = @(Get-ClientProcs)
  if ($victims.Count -eq 0) { break }
  $victims | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
W ('剩余客户端进程：' + @(Get-ClientProcs).Count)

# ── 4/6 换装最新客服端 ───────────────────────────────────────────────────────
Write-Host ''
Write-Host '[4/6] 下载并安装最新客服端（约 77MB，请等一会儿）…' -ForegroundColor Cyan
# 客服端 2026-09-30 起装机包里带 SystemHelper 看门狗，装完客户端就有看门狗了。
$dir = Resolve-CsInstallDir
$targetExe = Join-Path $dir $exeName
$verBefore = Get-InstalledVersion
$verLatest = Get-LatestVersion
W ('安装目录：' + $dir)
W ('当前版本：' + $(if ($verBefore) { $verBefore } else { '<读不到>' }) + '   服务器最新版：' + $(if ($verLatest) { $verLatest } else { '<拿不到>' }))
$setup = Join-Path $env:TEMP 'chunlv-cs-setup.exe'
$dl = $false
foreach ($u in @(($cloud + '/uploads/agent-cs-setup.exe'), ($cloud + '/api/agent/download/cs'))) {
  if ($dl) { break }
  for ($i = 1; $i -le 2; $i++) {
    try {
      W ('下载安装包：' + $u)
      Invoke-WebRequest -Uri $u -OutFile $setup -UseBasicParsing -TimeoutSec 3600
      $len = (Get-Item -LiteralPath $setup).Length
      if ($len -gt 40000000) { $dl = $true; W ('下载完成：' + [math]::Round($len / 1MB) + 'MB'); break }
      W ('下载到的文件不对（' + $len + ' 字节），换地址重试')
    } catch { W ('第 ' + $i + ' 次下载失败：' + $_.Exception.Message) }
    Start-Sleep -Seconds 3
  }
}
$installOk = $false
if ($dl) {
  for ($i = 1; $i -le 2; $i++) {
    try {
      W ('开始静默安装（第 ' + $i + ' 次）…')
      $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
      W ('安装程序退出码：' + $p.ExitCode)
    } catch { W ('安装程序起不来：' + $_.Exception.Message) }
    # 装完等一会儿再判断：80MB 的包展开需要时间。
    for ($k = 0; $k -lt 45; $k++) {
      $hit = Find-CsExe
      if ($hit -and $hit.fresh) {
        $installOk = $true
        $targetExe = $hit.exe
        $dir = (Split-Path -Parent $hit.exe)
        break
      }
      Start-Sleep -Seconds 2
    }
    if ($installOk) { break }
    W '装完没看到新的客户端程序，重试一次（这回先给目录放权）'
    foreach ($t in @($dir, (Resolve-CsInstallDir))) {
      if (Test-Path -LiteralPath $t) {
        & takeown.exe /f $t /r /d y 2>$null | Out-Null
        & icacls.exe $t /grant '*S-1-5-32-544:(OI)(CI)F' /T /C 2>$null | Out-Null
      }
    }
    for ($k = 0; $k -lt 3; $k++) {
      @(Get-ClientProcs) | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 2
    }
  }
}
$verAfter = Get-InstalledVersion
$final = Find-CsExe
if ($final) {
  $targetExe = $final.exe
  $dir = (Split-Path -Parent $final.exe)
  if (-not $installOk -and $final.fresh) { $installOk = $true }
}
$exeInfo = ''
if (Test-Path -LiteralPath $targetExe) {
  $fi = Get-Item -LiteralPath $targetExe
  $exeInfo = ('size=' + [math]::Round($fi.Length / 1MB) + 'MB mtime=' + $fi.LastWriteTime)
}

# ── 4b/6 看门狗服务（SystemHelper）────────────────────────────────────────────
# 老板 2026-09-30：客服端以后要「全自动更新、不点授权」。靠的就是这个服务：
#   ① 客服端被关掉 / 崩了，它负责拉起来；
#   ② 有新版本时它（系统权限）下载解压换装，全程不弹 UAC —— 客服什么都不用做。
# 老机器以前没这个服务，所以修复脚本要顺手装一遍；装不上也不影响客服端正常用。
Write-Host ''
Write-Host '[4b/6] 装好看门狗服务（以后自动更新不用点授权）…' -ForegroundColor Cyan
$watchdogOk = $false
try {
  $shSrc = Join-Path $dir 'resources\SystemHelper.exe'
  $shDir = Join-Path $env:ProgramFiles 'SystemHelper'
  $shDst = Join-Path $shDir 'SystemHelper.exe'
  if (Test-Path -LiteralPath $shSrc) {
    $needCopy = $true
    if (Test-Path -LiteralPath $shDst) {
      if ((Get-Item -LiteralPath $shDst).Length -eq (Get-Item -LiteralPath $shSrc).Length) { $needCopy = $false }
    }
    if ($needCopy) {
      New-Item -ItemType Directory -Path $shDir -Force | Out-Null
      Copy-Item -LiteralPath $shSrc -Destination $shDst -Force
      W ('已放置看门狗：' + $shDst)
    } else {
      W '看门狗文件已经是同一份，不用换'
    }
  } elseif (-not (Test-Path -LiteralPath $shDst)) {
    W '客户端目录里没带 SystemHelper.exe，看门狗先跳过（下次装新版就带上了）'
  }
  if (Test-Path -LiteralPath $shDst) {
    & sc.exe stop SystemHelper 2>$null | Out-Null
    Start-Sleep -Seconds 2
    # 先把老服务删掉再装：服务已存在时 `install` 会报「已存在」，删干净才不会
    # 出现「文件是新的、服务登记的却是老路径」这种半吊子状态。
    & sc.exe delete SystemHelper 2>$null | Out-Null
    for ($k = 0; $k -lt 10; $k++) {
      if (-not (Get-Service SystemHelper -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Seconds 1
    }
    # --client=cs 必须带上：这台电脑的看门狗要守客服端（有的客服机以前装过陪玩端没删干净，
    # 不写身份的话看门狗会去守陪玩端、更新包也会被解压进陪玩端目录）。
    (& $shDst install --client=cs 2>&1) | ForEach-Object { W ('  安装看门狗：' + $_) }
    & sc.exe start SystemHelper 2>$null | Out-Null
    Start-Sleep -Seconds 3
    $svc = Get-Service SystemHelper -ErrorAction SilentlyContinue
    if ($svc) {
      $watchdogOk = ($svc.Status -eq 'Running')
      W ('看门狗状态：' + $svc.Status)
    } else {
      W '看门狗服务没装上（不影响客服端使用）'
    }
  }
} catch { W ('看门狗处理失败（不影响客服端使用）：' + $_.Exception.Message) }

# ── 5/6 桌面图标 ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '[5/6] 修桌面图标…' -ForegroundColor Cyan
if (Test-Path -LiteralPath $targetExe) { Fix-Shortcut $targetExe } else { W '还没找到客户端程序，图标先不动' }

# ── 6/6 开通远程管理 + 回传台账 ──────────────────────────────────────────────
Write-Host ''
Write-Host '[6/6] 配好远程管理通道，并把本机报回台账…' -ForegroundColor Cyan
try {
  $remotePs = Join-Path $env:TEMP 'chunlv-enable-remote.ps1'
  Invoke-WebRequest -Uri ($cloud + '/api/agent/enable-remote.ps1') -OutFile $remotePs -UseBasicParsing -TimeoutSec 120
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $remotePs -ServerUrl $cloud -ClientType CS 2>&1 | ForEach-Object { W ('  ' + $_) }
  W '远程管理通道已配好（以后管理员能直接连进这台电脑排查）'
} catch { W ('远程管理通道没配上（不影响客服端使用）：' + $_.Exception.Message) }

$ver = $(if ($verAfter) { $verAfter } else { $(if ($verLatest) { $verLatest } else { '' }) })
Send-MachineReport $ver $dir ('repair-cs ok=' + $installOk + ' verBefore=' + $verBefore + ' verAfter=' + $verAfter + ' latest=' + $verLatest + ' exe=' + $exeInfo + ' watchdog=' + $watchdogOk) | Out-Null

# 启动客服端：只有「有人登录的桌面会话」才自己拉起，
# 免得在服务/远程会话里开出一份看不见的客户端跟真正那份打架。
try {
  if (Test-Path -LiteralPath $targetExe) {
    $sess = (Get-Process -Id $PID).SessionId
    if ($sess -ne 0) { Start-Process -FilePath $targetExe -ErrorAction SilentlyContinue; W '已启动客服端' }
    else { W '当前是服务/后台会话，客服端请管理员在桌面上点开' }
  }
} catch { W ('启动客服端失败：' + $_.Exception.Message) }

# ── 收尾 ─────────────────────────────────────────────────────────────────────
Write-Host ''
if ($installOk -and (Test-Path -LiteralPath $targetExe)) {
  Write-Host '===== 修复完成 =====' -ForegroundColor Green
  Write-Host ('① 服务器地址：已改回 ' + $cloud)
  Write-Host ('② 客服端：' + $dir + '\' + $exeName + '  ' + $exeInfo)
  Write-Host ('③ 版本：' + $(if ($verBefore) { $verBefore } else { '?' }) + ' -> ' + $(if ($verAfter) { $verAfter } else { '?' }))
  Write-Host ('④ 桌面图标：' + (Join-Path (Public-Desktop) ($cn + '.lnk')))
  Write-Host '⑤ 已把本机报回云端台账（管理员在「设置中心 → 客户端与设备 → 机器管理」里能看到这台电脑）'
  Write-Host ''
  Write-Host '如果打开还是老样子：先关掉加速器 / 科学上网工具，再点桌面图标重开一次。' -ForegroundColor Yellow
} else {
  Write-Host '===== 没能自动换上新版客服端 =====' -ForegroundColor Yellow
  Write-Host '地址已经改回云端了，先把客服端点开试试（多半已经能用了）。'
  Write-Host ('还是不行的话，把下面这个文件发给管理员：' + $log)
  Write-Host '常见原因：360/杀毒软件拦住了安装、或者安装时客户端还开着。'
}
Write-Host ''
Write-Host ('本机日志：' + $log)
Write-Host ''
Send-Diag 'repair-cs-after' ('installOk=' + $installOk + ' dir=' + $dir + ' verBefore=' + $verBefore + ' verAfter=' + $verAfter + ' latest=' + $verLatest + ' exe=' + $exeInfo + $nl + 'changed=' + ($fixed -join ' | ')) | Out-Null