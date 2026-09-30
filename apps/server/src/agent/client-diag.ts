/**
 * 客户端「一键诊断」脚本正文（服务端下发给目标电脑、由客户端执行）。
 *
 * 为什么放在服务端：客服端 / 陪玩端分别装在不同机器上，脚本改一次要重发两个安装包、
 * 还得等所有机器慢慢升级 —— 那又变成「查一次故障等一天」。放服务端以后，改完脚本部署
 * 一次服务端，所有机器下一次拉任务就是新版诊断，不用重装客户端。
 *
 * 约定：正文用 String.raw 保存，不要出现模板字符串的插值符号和反引号。
 * 手工给一台机器取证用的副本在 scripts/客户端诊断.ps1，两处改动要同步。
 */
export const CLIENT_DIAG_SCRIPT_VERSION = '2026-09-30.1';

export const CLIENT_DIAG_PS = String.raw`# 蠢驴电竞 · 客户端一键诊断（服务端下发，只读采集，不改任何设置）
# 由「机器管理」页面点「一键诊断」时下发到目标电脑执行，报告回传服务器。
# 说明：同一份正文也内嵌在服务端 src/agent/client-diag.ts 里下发；
#       手工给一台机器取证时，直接双击 scripts/客户端诊断.bat 即可。
param(
  [string]$OutFile = '',
  [string]$ServerUrl = '',
  [string]$TaskId = '',
  [string]$Reason = '',
  [switch]$Upload
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$L = New-Object System.Collections.Generic.List[string]
function W([string]$t) { $L.Add([string]$t) }
function H([string]$t) { $L.Add(''); $L.Add('===== ' + $t + ' =====') }
function FL([string]$m) {
  if (-not $m) { return '' }
  $i = $m.IndexOf([Environment]::NewLine)
  if ($i -lt 0) { return $m }
  return $m.Substring(0, $i)
}
function Try2([scriptblock]$block) {
  try { & $block } catch { W ('  [!] 这一段没取到: ' + $_.Exception.Message) }
}

W ('诊断时间: ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ('任务编号: ' + $TaskId)
W ('诊断原因: ' + $Reason)
W ('脚本版本: 2026-09-30.1')

H '一、这台电脑'
Try2 {
  W ('计算机名: ' + $env:COMPUTERNAME)
  W ('当前登录用户: ' + $env:USERDOMAIN + '\' + $env:USERNAME)
  $os = Get-CimInstance Win32_OperatingSystem
  if ($os) {
    W ('系统版本: ' + $os.Caption + ' (Build ' + $os.Version + ')')
    W ('开机时间: ' + $os.LastBootUpTime)
    W ('已连续运行: ' + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) + ' 小时')
  }
  $csm = Get-CimInstance Win32_ComputerSystem
  if ($csm) {
    W ('厂商/型号: ' + $csm.Manufacturer + ' / ' + $csm.Model)
    W ('物理内存: ' + [math]::Round($csm.TotalPhysicalMemory / 1GB, 1) + ' GB')
    W ('域/工作组: ' + $csm.Domain)
  }
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  if ($cpu) { W ('CPU: ' + $cpu.Name) }
}

H '二、磁盘空间'
Try2 {
  Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    W ('  ' + $_.DeviceID + ' 可用 ' + [math]::Round($_.FreeSpace / 1GB, 1) + ' GB / 共 ' + [math]::Round($_.Size / 1GB, 1) + ' GB')
  }
}

H '三、网络'
Try2 {
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | ForEach-Object {
    W ('  地址 ' + $_.InterfaceAlias + ' = ' + $_.IPAddress + '/' + $_.PrefixLength)
  }
  Get-NetAdapter | ForEach-Object {
    W ('  网卡 ' + $_.Name + ' [' + $_.Status + '] MAC=' + $_.MacAddress + ' 速率=' + $_.LinkSpeed)
  }
  $gw = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1
  if ($gw) { W ('  默认网关: ' + $gw.NextHop + ' (网卡 ' + $gw.InterfaceAlias + ')') }
  $dns = @()
  Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object {
    if ($_.ServerAddresses) { $dns += ($_.InterfaceAlias + '=' + ($_.ServerAddresses -join '/')) }
  }
  W ('  DNS: ' + ($dns -join ' ; '))
}

H '四、能不能连上服务器'
Try2 {
  if ($ServerUrl) {
    W ('  服务器地址: ' + $ServerUrl)
    $uri = $null
    try { $uri = [System.Uri]$ServerUrl } catch { }
    if ($uri) {
      $srvHost = $uri.Host
      $srvPort = $uri.Port
      $ping = Test-Connection -ComputerName $srvHost -Count 2 -Quiet
      W ('  ping ' + $srvHost + ' : ' + $(if ($ping) { '通' } else { '不通' }))
      $tcp = Test-NetConnection -ComputerName $srvHost -Port $srvPort -InformationLevel Quiet -WarningAction SilentlyContinue
      W ('  TCP ' + $srvHost + ':' + $srvPort + ' : ' + $(if ($tcp) { '通' } else { '不通' }))
      try {
        $r = Invoke-WebRequest -Uri ($ServerUrl.TrimEnd('/') + '/api/agent/frontend-version') -UseBasicParsing -TimeoutSec 10
        W ('  接口自测 /api/agent/frontend-version : HTTP ' + $r.StatusCode)
      } catch {
        W ('  接口自测失败: ' + $_.Exception.Message)
      }
    }
  } else {
    W '  (本次没带服务器地址，跳过)'
  }
}

H '五、客户端进程 / 服务'
Try2 {
  foreach ($n in @('客服管理', '陪玩管理', 'electron', 'SystemHelper', 'node')) {
    $procs = Get-Process -Name $n -ErrorAction SilentlyContinue
    if ($procs) {
      foreach ($p in $procs) {
        W ('  进程 ' + $p.ProcessName + '  PID=' + $p.Id + ' 内存=' + [math]::Round($p.WorkingSet64 / 1MB, 0) + 'MB 启动=' + $p.StartTime)
      }
    } else {
      W ('  进程 ' + $n + ' : 没在跑')
    }
  }
  foreach ($s in @('SystemHelper', 'LanmanServer', 'TermService', 'WinRM', 'Winmgmt', 'EventLog')) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) { W ('  服务 ' + $svc.Name + ' : ' + $svc.Status + ' / ' + $svc.StartType) }
    else { W ('  服务 ' + $s + ' : 不存在') }
  }
}

H '六、安装目录与版本'
Try2 {
  $dirs = @(
    ($env:ProgramFiles + '\客服管理'),
    ($env:ProgramFiles + '\陪玩管理'),
    ($env:ProgramFiles + '\SystemHelper'),
    ($env:LOCALAPPDATA + '\Programs\客服管理'),
    ($env:LOCALAPPDATA + '\Programs\陪玩管理'),
    ($env:ProgramFiles + '\蠢驴电竞')
  )
  foreach ($d in $dirs) {
    if (Test-Path -LiteralPath $d) {
      W ('  目录存在: ' + $d)
      Get-ChildItem -LiteralPath $d -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 8 | ForEach-Object {
        W ('    ' + $_.Name + '  ' + [math]::Round($_.Length / 1MB, 1) + 'MB  ' + $_.LastWriteTime)
      }
      $pj = Join-Path $d 'resources\app\package.json'
      if (Test-Path -LiteralPath $pj) {
        W ('    版本(package.json): ' + (Get-Content -LiteralPath $pj -Raw | ConvertFrom-Json).version)
      }
    } else {
      W ('  目录不存在: ' + $d)
    }
  }
  $unins = @()
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    Get-ChildItem -Path $k -ErrorAction SilentlyContinue | ForEach-Object {
      $it = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
      if ($it -and $it.DisplayName -and ($it.DisplayName -match '客服|陪玩|蠢驴|chunlv')) {
        $unins += ('    ' + $it.DisplayName + ' ' + $it.DisplayVersion + ' -> ' + $it.InstallLocation)
      }
    }
  }
  if ($unins.Count -gt 0) { W '  注册表里的安装记录:'; $unins | ForEach-Object { W $_ } }
}

H '七、客户端日志（末尾 120 行）'
Try2 {
  $logDirs = @(
    ($env:APPDATA + '\客服管理'),
    ($env:APPDATA + '\陪玩管理'),
    ($env:LOCALAPPDATA + '\陪玩管理'),
    ($env:LOCALAPPDATA + '\客服管理')
  )
  foreach ($d in $logDirs) {
    if (-not (Test-Path -LiteralPath $d)) { W ('  目录不存在: ' + $d); continue }
    $files = Get-ChildItem -LiteralPath $d -Include '*.log' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    if (-not $files) { W ('  ' + $d + ' : 没有 .log 文件'); continue }
    foreach ($f in $files) {
      W ('  ---- ' + $f.FullName + ' (' + $f.Length + ' 字节, 最后修改 ' + $f.LastWriteTime + ') ----')
      Get-Content -LiteralPath $f.FullName -Tail 120 -Encoding UTF8 | ForEach-Object { W ('    ' + $_) }
    }
  }
}

H '八、系统日志里的报错（最近 24 小时）'
Try2 {
  $evts = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1, 2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 30 -ErrorAction SilentlyContinue
  if ($evts) {
    foreach ($e in $evts) {
      W ('  [' + $e.TimeCreated + '] ' + $e.ProviderName + ' #' + $e.Id + ' : ' + (FL $e.Message))
    }
  } else { W '  System 日志最近 24 小时没有错误/严重事件' }
  $appEvts = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1, 2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 20 -ErrorAction SilentlyContinue
  if ($appEvts) {
    W '  -- Application 日志 --'
    foreach ($e in $appEvts) {
      W ('  [' + $e.TimeCreated + '] ' + $e.ProviderName + ' #' + $e.Id + ' : ' + (FL $e.Message))
    }
  }
}

H '九、蓝屏 / 异常关机记录'
Try2 {
  $crash = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 1001, 6008, 6005, 6006 } -MaxEvents 15 -ErrorAction SilentlyContinue
  if ($crash) {
    foreach ($e in $crash) {
      W ('  [' + $e.TimeCreated + '] #' + $e.Id + ' ' + $e.ProviderName + ' : ' + (FL $e.Message))
    }
  } else { W '  没有查到异常关机/蓝屏记录' }
  $dumps = Get-ChildItem -LiteralPath ($env:SystemRoot + '\Minidump') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
  if ($dumps) {
    W '  内存转储文件:'
    foreach ($d in $dumps) { W ('    ' + $d.Name + ' ' + [math]::Round($d.Length / 1MB, 1) + 'MB ' + $d.LastWriteTime) }
  }
}

H '十、远程管理账号'
Try2 {
  $u = Get-LocalUser -Name 'chunlvops' -ErrorAction SilentlyContinue
  if ($u) {
    W ('  账号 chunlvops: 已启用=' + $u.Enabled + ' 密码永不过期标志=' + $u.PasswordExpires + ' 密码上次设置=' + $u.PasswordLastSet)
  } else {
    W '  账号 chunlvops: 不存在（这台机器还没开远程管理）'
  }
  $grp = Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
  W ('  管理员组成员: ' + ($grp -join ' ; '))
  $lat = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -ErrorAction SilentlyContinue).LocalAccountTokenFilterPolicy
  W ('  LocalAccountTokenFilterPolicy: ' + $lat)
  W ('  RDP 是否被禁用(fDenyTSConnections, 1=禁用): ' + ((Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -ErrorAction SilentlyContinue).fDenyTSConnections))
}

H '十一、代理 / VPN / 加速器迹象'
Try2 {
  $proxies = Get-Process | Where-Object { $_.ProcessName -match 'v2ray|clash|verge|sing-box|ssr|trojan|proxy|accel|netch|nekoray' } | Select-Object -First 10
  if ($proxies) { foreach ($p in $proxies) { W ('  进程 ' + $p.ProcessName + ' PID=' + $p.Id) } } else { W '  没有发现代理/VPN 进程' }
  $ie = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($ie) {
    W ('  系统代理开关 ProxyEnable=' + $ie.ProxyEnable + ' ProxyServer=' + $ie.ProxyServer)
    W ('  自动配置脚本 AutoConfigURL=' + $ie.AutoConfigURL)
  }
  W '  --- winhttp ---'
  $wh = (netsh winhttp show proxy) 2>&1
  $wh | ForEach-Object { W ('  ' + $_) }
}

H '十二、当前网络连接'
Try2 {
  Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object {
    W ('  ' + $_.LocalAddress + ':' + $_.LocalPort + ' -> ' + $_.RemoteAddress + ':' + $_.RemotePort + ' pid=' + $_.OwningProcess)
  }
}

H '诊断结束'
W ('报告共 ' + $L.Count + ' 行')

$text = ($L -join [Environment]::NewLine)

if ($OutFile) {
  [System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($true)))
  Write-Host ('报告已写入: ' + $OutFile)
}

if ($Upload -and $ServerUrl) {
  try {
    $body = @{ hostname = $env:COMPUTERNAME; source = 'client-diag'; lines = $text; version = '2026-09-30.1' } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri ($ServerUrl.TrimEnd('/') + '/api/agent/diag-report') -Method Post -Body $body -ContentType 'application/json' -Headers @{ 'x-onboard-token' = '%%TOKEN%%' } -TimeoutSec 60 | Out-Null
    Write-Host '报告已回传服务器'
  } catch {
    Write-Host ('回传失败: ' + $_.Exception.Message)
  }
}

if (-not $OutFile) { $text }

`;

/** 下发前把脚本里的回传令牌换成真实值。 */
export function buildClientDiagScript(token: string): string {
  return CLIENT_DIAG_PS.split('%%TOKEN%%').join(token);
}
