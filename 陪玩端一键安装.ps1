$ErrorActionPreference = 'Continue'
$cloud = 'http://1.117.229.36:3001'
$onboardToken = 'c4f1a2e7d9b8435fa6e10c7d2b9f8e34'
$adminUser = 'chunlvops'
$cn = '陪玩管理'
# installer.nsh 把安装目录写死成「蠢驴电竞」，而 exe 名是「陪玩管理」。旧脚本只看
# C:\Program Files\陪玩管理，结果版本号报 unknown、桌面也没有快捷方式。这里两个都试。
$appDir = ''
$appExe = ''
function Resolve-AppExe {
  $cands = @(
    (Join-Path $env:ProgramFiles '蠢驴电竞'),
    (Join-Path ${env:ProgramFiles(x86)} '蠢驴电竞'),
    'C:\Program Files\蠢驴电竞',
    ('C:\Program Files\' + $cn)
  )
  foreach ($d in $cands) {
    if (-not $d) { continue }
    $exe = Join-Path $d ($cn + '.exe')
    if (Test-Path -LiteralPath $exe) { $script:appDir = $d; $script:appExe = $exe; return $true }
  }
  return $false
}
Resolve-AppExe | Out-Null

# ---- 自动生成一组长期密码：大小写+数字+符号，且不含 @ 和 : 以免远程工具解析出错 ----
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
$rand = New-Object System.Random
$adminPass = 'Chunlv!' + (-join (1..6 | ForEach-Object { $chars[$rand.Next($chars.Length)] })) + $rand.Next(10)

Write-Host ''
Write-Host '===== 蠢驴电竞 陪玩端一键安装 =====' -ForegroundColor Cyan
Write-Host ('本机: ' + $env:COMPUTERNAME)
Write-Host ''

Write-Host '[1/8] 配置远程管理账号（自动生成密码）...'
$sec = ConvertTo-SecureString $adminPass -AsPlainText -Force
$accountReady = $false
try {
  if (Get-LocalUser -Name $adminUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires $true
    Write-Host ('      账号 ' + $adminUser + ' 已存在，密码已换成新生成的')
  } else {
    New-LocalUser -Name $adminUser -Password $sec -PasswordNeverExpires -Description 'Chunlv remote support account' | Out-Null
    Write-Host ('      已创建账号 ' + $adminUser)
  }
  $accountReady = $true
} catch { }
if (-not $accountReady) {
  net.exe user $adminUser $adminPass /add /passwordchg:no /expires:never | Out-Null
  Write-Host ('      已用 net 命令创建账号 ' + $adminUser)
}
net.exe localgroup Administrators $adminUser /add 2>$null | Out-Null
Write-Host '      密码已自动生成，稍后会一并回传到云端，管理员可随时查看'

Write-Host '[2/8] 打开远程管理通道...'
$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
New-ItemProperty -Path $key -Name 'LocalAccountTokenFilterPolicy' -Value 1 -PropertyType DWord -Force | Out-Null
Set-ItemProperty -Path $key -Name 'LimitBlankPasswordUse' -Value 0 -ErrorAction SilentlyContinue
Set-Service -Name LanmanServer -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name LanmanServer -ErrorAction SilentlyContinue
Set-NetFirewallRule -DisplayGroup 'File and Printer Sharing' -Enabled True -ErrorAction SilentlyContinue
Write-Host '      完成'

Write-Host '[3/8] 下载最新陪玩端安装包（约 92MB，请稍等）...'
$setup = Join-Path $env:TEMP 'chunlv-companion-setup.exe'
$ok = $false
for ($i = 1; $i -le 3; $i++) {
  try {
    Invoke-WebRequest -Uri ($cloud + '/api/agent/download/exe') -OutFile $setup -UseBasicParsing -TimeoutSec 1800
    if ((Get-Item $setup).Length -gt 50000000) { $ok = $true; break }
  } catch { Write-Host ('      第 ' + $i + ' 次下载失败: ' + $_.Exception.Message) }
  Start-Sleep -Seconds 3
}
if (-not $ok) {
  Write-Host '      安装包下载失败：请确认这台电脑能打开 http://1.117.229.36:3001' -ForegroundColor Red
  Write-Host ('      本机远程管理账号: ' + $adminUser + ' / ' + $adminPass) -ForegroundColor Yellow
  return
}
Write-Host ('      已下载 ' + [math]::Round((Get-Item $setup).Length / 1MB, 1) + ' MB')

Write-Host '[4/8] 关闭正在运行的旧客户端...'
sc.exe stop SystemHelper | Out-Null
Get-Process -Name ($cn + '.exe'), 'electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host '      完成'

Write-Host '[5/8] 静默安装（1-3 分钟，请不要关窗口）...'
$p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
Write-Host ('      安装程序退出码: ' + $p.ExitCode)
Start-Sleep -Seconds 3
# 安装目录要等安装器落盘，最多等 60 秒再确认一次
for ($t = 1; $t -le 30; $t++) {
  if (Resolve-AppExe) { break }
  Start-Sleep -Seconds 2
}
if ($appExe) { Write-Host ('      客户端位置: ' + $appExe) } else { Write-Host '      还没找到客户端 exe，继续尝试启动' -ForegroundColor Yellow }

Write-Host '[6/8] 检查看门狗服务（负责掉线自动拉起客户端）...'
$sh = 'C:\Program Files\SystemHelper\SystemHelper.exe'
if (-not (Test-Path -LiteralPath $sh)) {
  try {
    New-Item -ItemType Directory -Path 'C:\Program Files\SystemHelper' -Force | Out-Null
    Invoke-WebRequest -Uri ($cloud + '/uploads/SystemHelper.exe') -OutFile $sh -UseBasicParsing -TimeoutSec 600
    & $sh install | Out-Null
  } catch { Write-Host ('      看门狗安装失败: ' + $_.Exception.Message) }
}
sc.exe start SystemHelper | Out-Null
Start-Sleep -Seconds 3
Write-Host ('      SystemHelper 状态: ' + (Get-Service SystemHelper -ErrorAction SilentlyContinue).Status)

Write-Host '[7/8] 建桌面快捷方式并启动客户端...'
$desktops = @('C:\Users\Public\Desktop')
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name -ne 'Public') { $desktops += (Join-Path $_.FullName 'Desktop') }
}
if (Test-Path -LiteralPath $appExe) {
  foreach ($d in $desktops) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    try {
      $w = New-Object -ComObject WScript.Shell
      $s = $w.CreateShortcut((Join-Path $d ($cn + '.lnk')))
      $s.TargetPath = $appExe
      $s.WorkingDirectory = $appDir
      $s.IconLocation = ($appExe + ',0')
      $s.Description = $cn
      $s.Save()
    } catch { }
  }
  Start-Process -FilePath $appExe
  Write-Host '      客户端已启动'
} else {
  Write-Host '      找不到客户端程序，安装可能没成功' -ForegroundColor Red
}

Write-Host '[8/8] 把本机信息回传到云端...'
$ip = ''
$mac = ''
try {
  $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and ($_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*') } | Select-Object -First 1
  if (-not $addr) { $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1 }
  if ($addr) { $ip = $addr.IPAddress }
  $nic = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $ip } | Select-Object -First 1
  if ($nic) { $mac = (Get-NetAdapter -InterfaceIndex $nic.InterfaceIndex -ErrorAction SilentlyContinue).MacAddress }
  if (-not $mac) { $mac = (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).MacAddress }
} catch { }

$clientVersion = ''
if (Test-Path -LiteralPath $appExe) { $clientVersion = (Get-Item -LiteralPath $appExe).VersionInfo.ProductVersion }
if (-not $clientVersion) { $clientVersion = 'unknown' }

$reported = $false
try {
  $body = @{
    hostname = $env:COMPUTERNAME
    ip = $ip
    mac = $mac
    account = $adminUser
    password = $adminPass
    version = $clientVersion
    source = 'install-companion'
  } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri ($cloud + '/api/agent/onboard-report') -Method Post -ContentType 'application/json' -Headers @{ 'x-onboard-token' = $onboardToken } -Body $body -TimeoutSec 60
  if ($resp.code -eq 200 -and $resp.data.saved) { $reported = $true }
} catch { }

Write-Host ''
Write-Host '===== 本机信息 =====' -ForegroundColor Green
Write-Host ('主机名: ' + $env:COMPUTERNAME)
Write-Host ('IP: ' + $ip)
Write-Host ('MAC: ' + $mac)
Write-Host ('客户端版本: ' + $clientVersion)
Write-Host ('远程管理账号: ' + $adminUser)
Write-Host ('远程管理密码: ' + $adminPass) -ForegroundColor Yellow
if ($reported) {
  Write-Host '账号密码已自动回传到云端，管理员不用你提供。' -ForegroundColor Green
} else {
  Write-Host '回传云端失败（不影响使用），请把上面这一行密码发给管理员。' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '全部完成。' -ForegroundColor Green
