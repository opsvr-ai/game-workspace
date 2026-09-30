# 蠢驴电竞 · 一键开通远程管理（客服端 / 陪玩端通用）
# 作用：在这台电脑上开一个专属运维账号 + 打开远程管理通道，并把结果回传到服务器。
# 三种用法：
#   ① 客户端下发（机器管理页点「一键开通远程管理」）：服务端把本脚本写进任务，客户端以管理员身份执行
#   ② 客服/老板手工双击：scripts/开通远程管理.bat（会自己弹 UAC 提权）
#   ③ 装机脚本内嵌：安装包安装完自动跑一次
param(
  [string]$ServerUrl = '',
  [string]$ClientType = '',
  [string]$HostnameOverride = '',
  [switch]$NoUpload
)

$ErrorActionPreference = 'Continue'
$account = 'chunlvops'
$out = New-Object System.Collections.Generic.List[string]
function W([string]$t) { $out.Add([string]$t); Write-Host $t }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
W ('是不是管理员: ' + $isAdmin)
if (-not $isAdmin) {
  W '[!] 没有管理员权限，账号建不了。请用「以管理员身份运行」重开一次。'
  exit 1
  exit 1
}

# 1) 生成一个每台机器都不一样的高强度密码（不再用所有人同一个口令）
$chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
$rand = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$buf = New-Object byte[] 1
$pwChars = @()
for ($i = 0; $i -lt 14; $i++) {
  $rand.GetBytes($buf)
  $pwChars += $chars[($buf[0] % $chars.Length)]
}
$password = 'Chunlv!' + (-join $pwChars)

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

# 6) 回传服务器（这样管理端不用问任何人就能拿到口令）
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
