$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '请以管理员身份运行。' -ForegroundColor Red
  Start-Sleep -Seconds 5
  exit 1
}

$adminUser = 'chunlvops'
$adminPass = 'ChunlvOps2026x9'

# 1. 创建专用本地管理员账号
$exists = Get-LocalUser -Name $adminUser -ErrorAction SilentlyContinue
if (-not $exists) {
  $secure = ConvertTo-SecureString $adminPass -AsPlainText -Force
  New-LocalUser -Name $adminUser -Password $secure -PasswordNeverExpires -Description 'Chunlv remote support account' | Out-Null
  Write-Host "已创建账号: $adminUser" -ForegroundColor Green
} else {
  $secure = ConvertTo-SecureString $adminPass -AsPlainText -Force
  Set-LocalUser -Name $adminUser -Password $secure -PasswordNeverExpires:$true
  Write-Host "账号已存在，密码已更新: $adminUser" -ForegroundColor Green
}

try {
  Add-LocalGroupMember -Group 'Administrators' -Member $adminUser -ErrorAction Stop
  Write-Host '已加入 Administrators 组' -ForegroundColor Green
} catch {
  if ($_.Exception.Message -notmatch 'already exists|已存在') {
    Write-Host "加入管理员组失败: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# 2. 允许非内置管理员远程连接（psexec/WinRM 需要）
New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -PropertyType DWord -Force | Out-Null
Write-Host '已开启远程管理账号令牌策略' -ForegroundColor Green

# 3. 启动并设置 Server 服务为自动运行，确保 SMB 管理通道可用
Set-Service -Name LanmanServer -StartupType Automatic
Start-Service -Name LanmanServer -ErrorAction SilentlyContinue

# 4. 打开文件和打印机共享防火墙，供 psexec 连接
try {
  Set-NetFirewallRule -DisplayGroup 'File and Printer Sharing' -Enabled True -ErrorAction SilentlyContinue
  Write-Host '已开放文件与打印机共享端口' -ForegroundColor Green
} catch {
  Write-Host '防火墙规则设置失败，但可能已允许。' -ForegroundColor Yellow
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*'
} | Select-Object -First 1).IPAddress

Write-Host ''
Write-Host '远程管理准备完成。' -ForegroundColor Cyan
Write-Host "本机 IP: $ip" -ForegroundColor Cyan
Write-Host "管理账号: $adminUser" -ForegroundColor Cyan
Read-Host '按回车键退出'
