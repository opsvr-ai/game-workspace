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
      [void]$sb.AppendLine(('  {0} -> {1} (target exists={2})' -f $_.FullName, $t, (Test-Path -LiteralPath $t -ErrorAction SilentlyContinue)))
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

Write-Host ''
Write-Host '===== 蠢驴电竞 · 陪玩端一键修复 =====' -ForegroundColor Cyan
Write-Host ('本机：' + (Host-Name) + '   时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
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

$dir = Resolve-InstallDir
$targetExe = Join-Path $dir $exeName
W ('安装目录：' + $dir)

Write-Host ''
Write-Host '[1/6] 关掉正在运行的客户端和看门狗服务…' -ForegroundColor Cyan
Get-Process -Name '陪玩管理', '蠢驴电竞' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
sc.exe stop SystemHelper | Out-Null
for ($i = 0; $i -lt 15; $i++) { if ((Get-Service SystemHelper -ErrorAction SilentlyContinue).Status -ne 'Running') { break }; Start-Sleep -Seconds 1 }
W '已完成'

Write-Host '[2/6] 下载最新客户端整包（约 128MB，请等一会儿）…' -ForegroundColor Cyan
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
Write-Host '[3/6] 解压并校验（这一步失败就原样不动）…' -ForegroundColor Cyan
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

Write-Host '[4/6] 换上新客户端（旧目录改名留证据，不删）…' -ForegroundColor Cyan
$bak = ''
if (Test-Path -LiteralPath $dir) {
  $bak = $dir + '.broken-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Move-Item -LiteralPath $dir -Destination $bak -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $dir) {
    # 旧目录没换走就继续铺新文件，会铺成「半新半旧」—— 那正是这次事故的成因，宁可不改。
    W ('旧目录换不走（多半被占用或被杀毒软件锁着）：' + $dir)
    sc.exe start SystemHelper | Out-Null
    Send-Diag 'repair-failed' ('旧目录换不走：' + $dir) | Out-Null
    Write-Host '旧目录正被占用，本机文件没动。请重启一次这台电脑，再跑一遍修复。' -ForegroundColor Red
    Read-Host '按回车结束'
    exit 1
  }
  W ('旧目录已改名备份：' + $bak)
}
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Move-Item -Path (Join-Path $inner '*') -Destination $dir -Force
if (-not (Test-Path -LiteralPath $targetExe)) {
  W '换新失败：目标目录里没有客户端 exe'
  if ($bak -and (Test-Path -LiteralPath $bak)) {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $bak -Destination $dir -Force -ErrorAction SilentlyContinue
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
Write-Host '[5/6] 装好看门狗（自动拉起客户端，坏了自己修）…' -ForegroundColor Cyan
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

Write-Host '[6/6] 重建桌面图标并启动客户端…' -ForegroundColor Cyan
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
Read-Host '按回车结束'
