$ErrorActionPreference = 'Continue'
$cloud = 'http://1.117.229.36:3001'
$onboardToken = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34'
$cn = '陪玩管理'
$exeName = $cn + '.exe'
$log = Join-Path $env:TEMP 'chunlv-repair.log'

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
  # PUBLIC 环境变量缺失时自己拼；C:\Users\*\Desktop 的枚举本来也覆盖公共桌面。
  $p = $env:PUBLIC
  if (-not $p) { $p = [Environment]::GetEnvironmentVariable('PUBLIC', 'Machine') }
  if (-not $p) { $p = 'C:\Users\Public' }
  return (Join-Path $p 'Desktop')
}

function Send-Diag([string]$source, [string]$text) {
  try {
    # 中文必须自己转成 UTF-8 字节再发：Windows PowerShell 5.1 的 Invoke-RestMethod
    # 默认按 ANSI 发 body，回传上来的中文全变 "?"，等于白回传。
    $json = (@{ hostname = (Host-Name); source = $source; lines = $text } | ConvertTo-Json -Compress)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Invoke-RestMethod -Uri ($cloud + '/api/agent/diag-report') -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-onboard-token' = $onboardToken } -Body $bytes -TimeoutSec 90 | Out-Null
    W ('诊断已回传云端：' + $source)
    return $true
  } catch {
    W ('诊断回传失败（不影响修复）：' + $_.Exception.Message)
    return $false
  }
}

function Tail([string]$path, [int]$n) {
  if (-not (Test-Path -LiteralPath $path)) { return '<不存在>' }
  try { return ((Get-Content -LiteralPath $path -Tail $n -ErrorAction Stop) -join "`n") } catch { return '<读不了>' }
}
function Collect-Diag {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('host=' + (Host-Name))
  [void]$sb.AppendLine('time=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  [void]$sb.AppendLine('user=' + $env:USERNAME)
  [void]$sb.AppendLine('os=' + (Get-CimInstance Win32_OperatingSystem).Caption)

  [void]$sb.AppendLine('[disk]')
  Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Used -ne $null) { [void]$sb.AppendLine(('  {0} free={1}MB total={2}MB' -f $_.Name, [math]::Round($_.Free/1MB), [math]::Round(($_.Free + $_.Used)/1MB))) }
  }

  [void]$sb.AppendLine('[processes]')
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'SystemHelper|electron|chunlv' -or $_.ProcessName -eq $cn -or $_.ProcessName -eq '蠢驴电竞' } | ForEach-Object {
    [void]$sb.AppendLine(('  {0} pid={1} start={2}' -f $_.ProcessName, $_.Id, $_.StartTime))
  }

  [void]$sb.AppendLine('[service]')
  $svc = Get-Service SystemHelper -ErrorAction SilentlyContinue
  [void]$sb.AppendLine('  SystemHelper status=' + $(if ($svc) { $svc.Status } else { '<未安装>' }))
  foreach ($l in ((sc.exe qc SystemHelper 2>&1 | Out-String) -split "`r?`n")) { if ($l.Trim()) { [void]$sb.AppendLine('  ' + $l.Trim()) } }
  [void]$sb.AppendLine('[install dirs]')
  foreach ($d in @('C:\Program Files\陪玩管理', 'C:\Program Files\@chunlvcompanion-electron', 'C:\Program Files\蠢驴电竞', 'C:\Program Files (x86)\陪玩管理', 'C:\Program Files (x86)\蠢驴电竞')) {
    if (-not (Test-Path -LiteralPath $d)) { [void]$sb.AppendLine('  ' + $d + '  <不存在>'); continue }
    [void]$sb.AppendLine('  ' + $d + '  <存在>')
    Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $kind = $(if ($_.PSIsContainer) { 'dir ' } else { 'file' })
      [void]$sb.AppendLine(('    {0} {1} {2}' -f $kind, $_.Name, $_.Length))
    }
    foreach ($x in @((Join-Path $d $exeName), (Join-Path $d '蠢驴电竞.exe'))) {
      if (Test-Path -LiteralPath $x) {
        $fi = Get-Item -LiteralPath $x
        [void]$sb.AppendLine(('    EXE {0} size={1} version={2}' -f $x, $fi.Length, $fi.VersionInfo.ProductVersion))
        try {
          $fs = [System.IO.File]::OpenRead($x)
          $b = New-Object byte[] 2
          $null = $fs.Read($b, 0, 2)
          $fs.Close()
          [void]$sb.AppendLine('    EXE header=' + [System.Text.Encoding]::ASCII.GetString($b))
        } catch { [void]$sb.AppendLine('    EXE 打不开/被占用：' + $_.Exception.Message) }
      }
    }
    $asar = Join-Path $d 'resources\app.asar'
    if (Test-Path -LiteralPath $asar) { [void]$sb.AppendLine('    resources\app.asar size=' + (Get-Item -LiteralPath $asar).Length) } else { [void]$sb.AppendLine('    resources\app.asar <不存在>') }
    [void]$sb.AppendLine('    resources\app.asar.unpacked exists=' + (Test-Path -LiteralPath (Join-Path $d 'resources\app.asar.unpacked')))
  }
  [void]$sb.AppendLine('[C:\ProgramData\chunlv]')
  foreach ($f in @('update.json', 'pending-update.json', 'client-healthy.json', 'blocked-versions.json', 'update.zip', 'update-download.zip')) {
    $p = Join-Path 'C:\ProgramData\chunlv' $f
    if (Test-Path -LiteralPath $p) {
      $fi = Get-Item -LiteralPath $p
      $body = ''
      if ($fi.Length -lt 4000 -and $f -ne 'update.zip' -and $f -ne 'update-download.zip') { $body = ' = ' + (Get-Content -LiteralPath $p -Raw -ErrorAction SilentlyContinue) }
      [void]$sb.AppendLine(('  {0} size={1} mtime={2}{3}' -f $f, $fi.Length, $fi.LastWriteTime, $body))
    } else { [void]$sb.AppendLine('  ' + $f + ' <不存在>') }
  }

  [void]$sb.AppendLine('[desktop shortcuts]')
  $desktops = @((Public-Desktop))
  Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { $desktops += (Join-Path $_.FullName 'Desktop') }
  $w = New-Object -ComObject WScript.Shell
  foreach ($d in ($desktops | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {
      $t = ''
      try { $t = $w.CreateShortcut($_.FullName).TargetPath } catch { }
      $ok = '<无目标>'
      if ($t) { $ok = (Test-Path -LiteralPath $t -ErrorAction SilentlyContinue) }
      [void]$sb.AppendLine(('  {0} -> {1} (target exists={2})' -f $_.FullName, $t, $ok))
    }
  }

  [void]$sb.AppendLine('[uninstall registry]')
  foreach ($k in @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object {
      $n = (Get-ItemProperty $_.PSPath -Name DisplayName -ErrorAction SilentlyContinue).DisplayName
      if ($n -and ($n -match '蠢驴|陪玩|chunlv')) { [void]$sb.AppendLine(('  {0} = {1}' -f $_.PSChildName, $n)) }
    }
  }

  [void]$sb.AppendLine('[service.log tail]')
  [void]$sb.AppendLine((Tail 'C:\Program Files\SystemHelper\service.log' 60))
  [void]$sb.AppendLine('[client userData log tail]')
  foreach ($ud in @((Join-Path $env:APPDATA $cn), (Join-Path $env:APPDATA '@chunlv'))) {
    if (Test-Path -LiteralPath $ud) {
      $lf = Get-ChildItem -LiteralPath $ud -Filter '*.log' -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($lf) {
        [void]$sb.AppendLine(('  ' + $lf.FullName + ' mtime=' + $lf.LastWriteTime))
        [void]$sb.AppendLine((Tail $lf.FullName 40))
      }
    }
  }
  return $sb.ToString()
}
function Resolve-InstallDir {
  foreach ($d in @('C:\Program Files\陪玩管理', 'C:\Program Files\@chunlvcompanion-electron', 'C:\Program Files\蠢驴电竞', 'C:\Program Files (x86)\陪玩管理', 'C:\Program Files (x86)\蠢驴电竞')) {
    if (Test-Path -LiteralPath $d) { return $d }
  }
  return 'C:\Program Files\陪玩管理'
}

# Test-Fresh 判断这套解压出来的东西是不是「一份能跑的客户端」。
function Test-Fresh([string]$base) {
  $exe = Join-Path (Join-Path $base 'win-unpacked') $exeName
  $asar = Join-Path (Join-Path $base 'win-unpacked') 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $exe)) { return $false }
  if (-not (Test-Path -LiteralPath $asar)) { return $false }
  return ((Get-Item -LiteralPath $exe).Length -gt 50000000)
}

# Unpack-Client 解压整包，三种办法依次试，任一成功且文件齐了就算通过。
# 为什么不能只用 tar.exe：Windows 自带的 bsdtar 会把中文文件名（陪玩管理.exe）解成乱码，
# 而且它一边建目录一边中途报错，看起来「解压过了」其实只出来一半文件 —— 2026-08-29
# 和陈佳祺这台机器上留下的「????????.exe」就是这么来的，客户端从那以后就再也点不开。
function Unpack-Client([string]$zipPath, [string]$dest) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $dest, $enc)
    if (Test-Fresh $dest) { $script:unpackHow = 'ZipFile(UTF8)'; return $true }
    W '方式1 解压完但文件不齐'
  } catch { W ('方式1 解压失败：' + $_.Exception.Message) }

  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  try {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $dest -Force -ErrorAction Stop
    if (Test-Fresh $dest) { $script:unpackHow = 'Expand-Archive'; return $true }
    W '方式2 解压完但文件不齐'
  } catch { W ('方式2 解压失败：' + $_.Exception.Message) }

  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  try {
    & tar.exe -xf $zipPath -C $dest
    if (Test-Fresh $dest) { $script:unpackHow = 'tar.exe'; return $true }
    W '方式3 解压完但文件不齐'
  } catch { W ('方式3 解压失败：' + $_.Exception.Message) }
  return $false
}

function Fix-Shortcut([string]$exePath) {
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
      W ('快捷方式已修好：' + (Join-Path $d ($cn + '.lnk')))
    } catch { W ('快捷方式写不进去：' + $d + ' ' + $_.Exception.Message) }
    Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name -match $cn) { return }
      if (-not ($_.Name -match '蠢驴|chunlv')) { return }
      $t = ''
      try { $t = $w.CreateShortcut($_.FullName).TargetPath } catch { }
      if ((-not $t) -or (-not (Test-Path -LiteralPath $t -ErrorAction SilentlyContinue))) {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        W ('清掉失效图标：' + $_.FullName)
      }
    }
  }
}
# 参数：-DiagOnly 只回传现场，什么都不改（排查用，绝对安全）
$DiagOnly = ($args -contains '-DiagOnly') -or ($env:CHUNLV_DIAG_ONLY -eq '1')
# 参数：-ForceOverwrite 跳过「目录改名」，直接走「复制留底 + 覆盖」。
# 给那些「整个目录改不了名」（系统 / 杀毒软件按住目录）的机器用，2026-09-24 实测到 3 台。
$ForceOverwrite = ($args -contains '-ForceOverwrite') -or ($env:CHUNLV_FORCE_OVERWRITE -eq '1')

Write-Host ''
Write-Host '===== 蠢驴电竞 · 陪玩端一键修复 =====' -ForegroundColor Cyan
Write-Host ('本机：' + (Host-Name) + '   时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host '本脚本会：① 配好远程管理通道 ② 换新客户端 ③ 重建看门狗和桌面图标'
Write-Host ''

W '开始收集现场…'
$before = Collect-Diag
Send-Diag 'repair-before' $before | Out-Null

if ($DiagOnly) {
  Write-Host ''
  Write-Host '只做诊断（-DiagOnly）：现场已回传云端，本机未做任何改动。' -ForegroundColor Green
  Write-Host ('本机日志：' + $log)
  exit 0
}

Write-Host ''
Write-Host '[1/7] 配好远程管理账号和通道（以后管理员能直接连进来，不用再等人到电脑前）…' -ForegroundColor Cyan
# 为什么这步要放在修复脚本里：2026-09-24 老板报「秦伟杰的电脑打不开」，那台机器从来没跑过
# 装机脚本，本机既没有 chunlvops 账号、也没开远程管理通道 —— 我们连不进去，也看不到现场，
# 只能干等人在那台电脑跟前。修复顺带把机器配成标准状态，下次同类故障我直接远程排查。
$adminUser = 'chunlvops'
$netExe = Join-Path $env:SystemRoot 'System32\net.exe'
if (-not (Test-Path -LiteralPath $netExe)) { $netExe = 'net.exe' }
$alreadyAdmin = $false
try {
  $admGroup = (Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop).Name
  $alreadyAdmin = (@(Get-LocalGroupMember -Group $admGroup -ErrorAction Stop | Where-Object { $_.Name -like ('*\' + $adminUser) }).Count -gt 0)
} catch { }
$exists = $false
try { $exists = [bool](Get-LocalUser -Name $adminUser -ErrorAction SilentlyContinue) } catch { $exists = $false }
$accountEvent = ''
$adminPass = ''
if ($exists -and $alreadyAdmin) {
  # 已经配好的机器不动密码：改密码会把我们本来能用的那把换掉，万一回传又失败，
  # 这台机器反而连不进去了。配置本来就是幂等的，保持原样最安全。
  $accountEvent = 'kept'
} else {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $rand = New-Object System.Random
  # 14 位是故意的：net user 对超过 14 位的口令会追问一句「继续吗」，脚本里答不上来会直接卡住。
  $adminPass = 'Chunlv!' + (-join (1..6 | ForEach-Object { $chars[$rand.Next($chars.Length)] })) + $rand.Next(10)
  $made = $false
  try {
    $sec = ConvertTo-SecureString $adminPass -AsPlainText -Force
    if ($exists) {
      Set-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires $true
      $accountEvent = 'password-reset'
    } else {
      New-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires -Description 'Chunlv remote support account' | Out-Null
      $accountEvent = 'created'
    }
    $made = $true
  } catch {
    W ('用 PowerShell 建账号没成，改用 net 命令：' + $_.Exception.Message)
  }
  if (-not $made) {
    & $netExe user $adminUser $adminPass /add /passwordchg:no /expires:never 2>$null | Out-Null
    & $netExe user $adminUser $adminPass 2>$null | Out-Null
    $accountEvent = 'created-by-net'
  }
}
if (-not $alreadyAdmin) {
  & $netExe localgroup Administrators $adminUser /add 2>$null | Out-Null
}
try {
  New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -PropertyType DWord -Force | Out-Null
} catch { W ('注册表写入失败（不影响修复）：' + $_.Exception.Message) }
try { Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LimitBlankPasswordUse' -Value 0 -ErrorAction SilentlyContinue } catch { }
try { Set-Service -Name LanmanServer -StartupType Automatic -ErrorAction Stop; Start-Service -Name LanmanServer -ErrorAction SilentlyContinue } catch { W ('Server 服务没拉起来（不影响修复）：' + $_.Exception.Message) }
try { Set-NetFirewallRule -DisplayGroup 'File and Printer Sharing' -Enabled True -ErrorAction Stop } catch { W ('防火墙没放行文件共享（不影响修复）：' + $_.Exception.Message) }
$ip = ''
$mac = ''
try {
  # 先按「到云服务器的实际出口网卡」定位：装了 VMware / VirtualBox 的机器上会有一堆
  # 192.168.* 的虚拟网卡，按顺序挑第一个挑到的往往是虚拟网卡，回传上来的地址就不是
  # 这台机器真正在用的那个了（拿它去连必然连不上）。
  $route = @(Find-NetRoute -RemoteIPAddress ([System.Uri]$cloud).Host -ErrorAction Stop | Where-Object { $_.IPAddress -and ($_.IPAddress -notlike '*:*') } | Select-Object -First 1)
  if ($route.Count -gt 0) {
    $ip = $route[0].IPAddress
    $mac = (Get-NetAdapter -InterfaceIndex $route[0].InterfaceIndex -ErrorAction SilentlyContinue).MacAddress
  }
} catch { }
if (-not $ip) {
try {
  $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and ($_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*') } | Select-Object -First 1
  if (-not $addr) { $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1 }
  if ($addr) { $ip = $addr.IPAddress }
  $nic = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $ip } | Select-Object -First 1
  if ($nic) { $mac = (Get-NetAdapter -InterfaceIndex $nic.InterfaceIndex -ErrorAction SilentlyContinue).MacAddress }
  if (-not $mac) { $mac = (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).MacAddress }
} catch { }
}
$versionBefore = 'unknown'
$beforeExe = Join-Path (Resolve-InstallDir) $exeName
if (Test-Path -LiteralPath $beforeExe) {
  $pv = (Get-Item -LiteralPath $beforeExe).VersionInfo.ProductVersion
  if ($pv) { $versionBefore = $pv }
}
$onboardReported = $false
if ($adminPass) {
  try {
    # 中文必须自己转成 UTF-8 字节再发，同 Send-Diag：5.1 默认按 ANSI 发，中文会变「?」。
    $body = (@{
      hostname = (Host-Name)
      ip = $ip
      mac = $mac
      account = $adminUser
      password = $adminPass
      version = $versionBefore
      source = 'repair-companion'
    } | ConvertTo-Json -Compress)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $resp = Invoke-RestMethod -Uri ($cloud + '/api/agent/onboard-report') -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-onboard-token' = $onboardToken } -Body $bytes -TimeoutSec 60
    if ($resp.code -eq 200 -and $resp.data.saved) { $onboardReported = $true }
  } catch { W ('远程管理账号回传云端失败（不影响修复）：' + $_.Exception.Message) }
}
# 回传现场只带「账号有没有建好」，绝不带密码（诊断是明文落盘的）。
W ('远程管理：event=' + $accountEvent + ' ip=' + $ip + ' mac=' + $mac + ' 修复前版本=' + $versionBefore + ' 已回传=' + $onboardReported)
Send-Diag 'repair-onboard' ('accountEvent=' + $accountEvent + ' exists=' + $exists + ' alreadyAdmin=' + $alreadyAdmin + ' reported=' + $onboardReported + ' ip=' + $ip + ' mac=' + $mac + ' version=' + $versionBefore + ' ps=' + $PSVersionTable.PSVersion.ToString()) | Out-Null

$dir = Resolve-InstallDir
$targetExe = Join-Path $dir $exeName
W ('安装目录：' + $dir)

Write-Host ''
Write-Host '[2/7] 先停看门狗，再关客户端…' -ForegroundColor Cyan
# 顺序不能反：先杀客户端的话，看门狗会在这几秒里马上把它重新拉起来（它盯着 PID 看），
# 目录一直被占着，第 5 步「旧目录改名」就会失败（2026-09-24 在 3 台机上踩到）。
sc.exe stop SystemHelper | Out-Null
for ($i = 0; $i -lt 15; $i++) { if ((Get-Service SystemHelper -ErrorAction SilentlyContinue).Status -ne 'Running') { break }; Start-Sleep -Seconds 1 }
$killDirs = @($dir) + @('C:\Program Files\陪玩管理', 'C:\Program Files\@chunlvcompanion-electron', 'C:\Program Files\蠢驴电竞', 'C:\Program Files (x86)\陪玩管理', 'C:\Program Files (x86)\蠢驴电竞')
function Get-ClientProcs {
  # 名字被解压搞成乱码的客户端（????????.exe）按名字找不到，只能按 exe 路径找。
  $list = @()
  $list += Get-Process -Name $cn, '蠢驴电竞' -ErrorAction SilentlyContinue
  $list += Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $p = $_.ExecutablePath
    if (-not $p) { return $false }
    $hit = $false
    foreach ($d in $killDirs) { if ($p.StartsWith($d + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true } }
    return $hit
  } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  return @($list | Where-Object { $_ -ne $null } | Sort-Object Id -Unique)
}
for ($i = 0; $i -lt 4; $i++) {
  $victims = @(Get-ClientProcs)
  if ($victims.Count -eq 0) { break }
  $victims | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}
W ('看门狗已停，客户端进程剩余：' + @(Get-ClientProcs).Count)

Write-Host '[3/7] 下载最新客户端整包（约 128MB，请等一会儿）…' -ForegroundColor Cyan
$zip = Join-Path $env:TEMP 'chunlv-repair.zip'
$dl = $false
if ($env:CHUNLV_REPAIR_ZIP -and (Test-Path -LiteralPath $env:CHUNLV_REPAIR_ZIP)) {
  # 已经在别处下好了整包（断网重跑/内网分发）：直接用，不再重下 128MB。
  Copy-Item -LiteralPath $env:CHUNLV_REPAIR_ZIP -Destination $zip -Force
  $dl = ((Get-Item $zip).Length -gt 50000000)
  W ('使用本地整包：' + $env:CHUNLV_REPAIR_ZIP)
}
# 两条下载地址互为备份：限速接口偶尔超时/连接被掐时自动换直链，别让陪玩白等一场。
foreach ($u in @(($cloud + '/api/agent/download/latest'), ($cloud + '/uploads/chunlv-latest.zip'))) {
  if ($dl) { break }
  for ($i = 1; $i -le 2; $i++) {
    try {
      W ('下载整包：' + $u)
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 3600
      if ((Get-Item $zip).Length -gt 50000000) { $dl = $true; break }
      W ('下载到的文件不对（' + (Get-Item $zip).Length + ' 字节），换地址重试')
    } catch { W ('第 ' + $i + ' 次下载失败（' + $u + '）：' + $_.Exception.Message) }
    Start-Sleep -Seconds 3
  }
}
if (-not $dl) {
  W ('下载失败：请确认这台电脑能打开 ' + $cloud)
  sc.exe start SystemHelper | Out-Null
  Send-Diag 'repair-failed' '下载更新包失败' | Out-Null
  Write-Host '下载失败，没动本机任何文件。请把本窗口内容发给管理员。' -ForegroundColor Red
  Read-Host '按回车结束'
  exit 1
}
W ('已下载 ' + [math]::Round((Get-Item $zip).Length / 1MB, 1) + ' MB')
Write-Host '[4/7] 解压并校验（这一步失败就原样不动）…' -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP 'chunlv-repair-unpack'
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$inner = Join-Path $tmp 'win-unpacked'
$script:unpackHow = ''
$fresh = Unpack-Client $zip $tmp
if (-not $fresh) {
  W '解压出来的客户端不完整，中止修复（本机文件没动）'
  Send-Diag 'repair-failed' '解压校验失败（三种解压方式都没解出完整客户端）' | Out-Null
  Write-Host '更新包解不开或不完整，没动本机任何文件。请重跑一次，或把本窗口内容发给管理员。' -ForegroundColor Red
  Read-Host '按回车结束'
  exit 1
}
$newExe = Join-Path $inner $exeName
W ('解压并校验通过（' + $script:unpackHow + '）：' + (Get-Item -LiteralPath $newExe).Length + ' 字节')

Write-Host '[5/7] 换上新客户端（旧目录改名留证据，不删）…' -ForegroundColor Cyan
$bak = ''
$mode = 'rename'
if (Test-Path -LiteralPath $dir) {
  $bak = $dir + '.broken-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  $moved = $false
  if ($ForceOverwrite) {
    W '按要求（-ForceOverwrite）跳过「目录改名」，直接走覆盖方式'
  } else {
    for ($i = 1; $i -le 4; $i++) {
      try { Move-Item -LiteralPath $dir -Destination $bak -Force -ErrorAction Stop; $moved = $true; break }
      catch { W ('旧目录改名失败（第 ' + $i + ' 次）：' + $_.Exception.Message) }
      Start-Sleep -Seconds 5
    }
  }
  if ($moved) {
    W ('旧目录已改名备份：' + $bak)
  } else {
    # 有些机器上「整个目录」改不了名（系统 / 杀毒软件按住目录不放，但目录里的文件能读能写 ——
    # 2026-09-24 在 3 台机上实测：改名一律「访问被拒绝」，文件却读写自如）。
    # 这种情况退一步：把旧目录整份复制留底，再用新文件覆盖着铺进去。
    # 覆盖前先确认客户端 exe 写得动 —— 写不动就宁可不改，绝不铺成「半新半旧」。
    $writable = $false
    for ($t = 1; $t -le 18; $t++) {
      foreach ($e in @($targetExe, (Join-Path $dir '蠢驴电竞.exe'))) {
        if (Test-Path -LiteralPath $e) {
          try { $h = [IO.File]::Open($e, 'Open', 'Write', 'None'); $h.Close(); $writable = $true } catch { $writable = $false }
          break
        }
      }
      if ($writable) { break }
      if (($t % 3) -eq 0) { W ('等客户端 exe 松开…（' + $t + '/18）') }
      Start-Sleep -Seconds 5
    }
    if (-not $writable) {
      # 旧目录没换走就继续铺新文件，会铺成「半新半旧」—— 那正是这次事故的成因，宁可不改。
      W ('旧目录换不走（改名被拒、exe 也还写不动）：' + $dir)
      sc.exe start SystemHelper | Out-Null
      Send-Diag 'repair-failed' ('旧目录换不走：' + $dir) | Out-Null
      Write-Host '旧目录正被占用，本机文件没动。请重启一次这台电脑，再跑一遍修复。' -ForegroundColor Red
      Read-Host '按回车结束'
      exit 1
    }
    W '目录改不了名，改用「整目录覆盖」方式（先把旧目录复制一份留底）'
    Copy-Item -LiteralPath $dir -Destination $bak -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath (Join-Path $bak $exeName))) {
      W ('留底复制失败，中止（本机文件没动）：' + $bak)
      Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue
      sc.exe start SystemHelper | Out-Null
      Send-Diag 'repair-failed' '留底复制失败' | Out-Null
      Write-Host '留底没做成，本机文件没动。请重启一次这台电脑，再跑一遍修复。' -ForegroundColor Red
      Read-Host '按回车结束'
      exit 1
    }
    W ('旧目录已复制留底：' + $bak)
    $mode = 'overwrite'
  }
}
# 期望大小必须在「搬过去」之前量好：改名方式下 Move-Item 会把 $inner 里的 exe 一起搬走，
# 搬完再量就是 0，校验必然判成「大小不对」，白回滚一次、陪玩白等一场（2026-09-24 在马凝初那台实测）。
$newSize = 0
if (Test-Path -LiteralPath $newExe) { $newSize = (Get-Item -LiteralPath $newExe).Length }
if ($mode -eq 'rename') {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Move-Item -Path (Join-Path $inner '*') -Destination $dir -Force
} else {
  Copy-Item -Path (Join-Path $inner '*') -Destination $dir -Recurse -Force
}
$gotSize = 0
if (Test-Path -LiteralPath $targetExe) { $gotSize = (Get-Item -LiteralPath $targetExe).Length }
if (($gotSize -eq 0) -or ($gotSize -ne $newSize)) {
  W ('换新失败：客户端 exe 不在或大小不对（' + $gotSize + ' / 应为 ' + $newSize + '）')
  if ($bak -and (Test-Path -LiteralPath $bak)) {
    if ($mode -eq 'rename') {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $bak -Destination $dir -Force -ErrorAction SilentlyContinue
    } else {
      Copy-Item -Path (Join-Path $bak '*') -Destination $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    W '已把旧目录放回去，本机跟修复前一样'
  }
  sc.exe start SystemHelper | Out-Null
  Send-Diag 'repair-failed' ('换新失败 targetExe=' + $targetExe) | Out-Null
  Write-Host '修复失败，请把本窗口内容发给管理员。' -ForegroundColor Red
  Read-Host '按回车结束'
  exit 1
}
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

foreach ($old in @('C:\Program Files\@chunlvcompanion-electron', 'C:\Program Files\蠢驴电竞', 'C:\Program Files (x86)\陪玩管理', 'C:\Program Files (x86)\蠢驴电竞')) {
  if (($old -ne $dir) -and (Test-Path -LiteralPath $old)) {
    $cands = @((Join-Path $old $exeName), (Join-Path $old '蠢驴电竞.exe'))
    # 解压把中文名搞成乱码留下的「????????.exe」：文件名坏了谁也点不开，一起停用。
    Get-ChildItem -LiteralPath $old -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name.Contains([char]0xFFFD) -and $_.Length -gt 10000000) {
        W ('发现乱码名的客户端文件：' + $_.Name + '（' + $_.Length + ' 字节），一并停用')
        $cands += $_.FullName
      }
    }
    foreach ($x in $cands) {
      if (Test-Path -LiteralPath $x) {
        Move-Item -LiteralPath $x -Destination ($x + '.oldclient') -Force -ErrorAction SilentlyContinue
        W ('已停用旧客户端：' + $x)
      }
    }
  }
}

$cfg = Join-Path $dir 'resources\companion-config.json'
if (Test-Path -LiteralPath $cfg) {
  try {
    $j = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
    if (($j.PSObject.Properties.Name -contains 'serverUrl') -and ($j.serverUrl -ne $cloud)) {
      Copy-Item -LiteralPath $cfg ($cfg + '.bak') -Force
      $j.serverUrl = $cloud
      $j | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $cfg -Encoding UTF8
      W ('服务器地址已改成 ' + $cloud)
    }
  } catch { W ('配置没改（不影响）：' + $_.Exception.Message) }
}
W '换新完成'
Write-Host '[6/7] 装好看门狗（自动拉起客户端，坏了自己修）…' -ForegroundColor Cyan
New-Item -ItemType Directory -Path 'C:\Program Files\SystemHelper' -Force | Out-Null
$sh = 'C:\Program Files\SystemHelper\SystemHelper.exe'
try {
  Invoke-WebRequest -Uri ($cloud + '/uploads/SystemHelper.exe') -OutFile ($sh + '.new') -UseBasicParsing -TimeoutSec 600
  if ((Get-Item ($sh + '.new')).Length -gt 5000000) {
    Move-Item -LiteralPath ($sh + '.new') -Destination $sh -Force
    W '看门狗已更新'
  }
} catch { W ('看门狗下载失败（继续用本机已有的那份）：' + $_.Exception.Message) }
sc.exe delete SystemHelper | Out-Null
if (Test-Path -LiteralPath $sh) {
  & $sh install | Out-Null
  sc.exe start SystemHelper | Out-Null
  Start-Sleep -Seconds 5
  W ('SystemHelper 状态：' + (Get-Service SystemHelper -ErrorAction SilentlyContinue).Status)
}

Write-Host '[7/7] 重建桌面图标并启动客户端…' -ForegroundColor Cyan
Fix-Shortcut $targetExe
# 只有「有人登录的桌面会话」才自己拉起客户端。
# 如果是远程/服务方式在会话 0（SYSTEM）里跑的，直接 Start-Process 会开出一份
# 看不见的客户端（跑在 SYSTEM 账户下、没有登录态），白占内存、还可能和真正那份打架 ——
# 这种情况交给看门狗：它用 CreateProcessAsUser 把客户端拉进当前登录的桌面会话。
$selfSession = (Get-Process -Id $PID).SessionId
if ($selfSession -eq 0) {
  W '当前在会话 0（远程/服务方式）运行：不自己拉起，等看门狗把客户端拉进登录会话…'
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if ((Get-Process -Name $cn -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { break }
    Start-Sleep -Seconds 5
  }
} else {
  Start-Process -FilePath $targetExe -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 20
}
$running = (Get-Process -Name $cn -ErrorAction SilentlyContinue | Measure-Object).Count
W ('客户端进程数：' + $running)

$after = Collect-Diag
Send-Diag 'repair-after' ('dir=' + $dir + ' running=' + $running + "`n" + 'zip=' + $zip + "`n" + $after) | Out-Null

Write-Host ''
if ($running -gt 0) {
  Write-Host '修复完成：客户端已经起来了。' -ForegroundColor Green
  Write-Host '如果窗口没自动出现，双击桌面上的「陪玩管理」图标即可。'
} else {
  Write-Host '客户端还是没起来，但现场已经回传云端，管理员能看到原因。' -ForegroundColor Yellow
  Write-Host '请把本窗口内容截图发给管理员。'
}
Write-Host ('本机日志：' + $log)
Write-Host ''
if ($adminPass) {
  Write-Host ('远程管理账号：' + $adminUser) -ForegroundColor Yellow
  Write-Host ('远程管理密码：' + $adminPass) -ForegroundColor Yellow
  if ($onboardReported) {
    Write-Host '账号密码已自动回传云端，管理员不用问你。' -ForegroundColor Green
  } else {
    Write-Host '回传云端失败：请把上面这一行密码发给管理员。' -ForegroundColor Yellow
  }
} elseif ($accountEvent -eq 'kept') {
  Write-Host '这台电脑本来就配好了远程管理，密码没动。' -ForegroundColor Green
}
Write-Host ''
Read-Host '按回车结束'
