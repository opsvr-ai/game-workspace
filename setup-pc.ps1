$ErrorActionPreference = 'Stop'

# 生成随机长期密码
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#'
$rand = New-Object System.Random
$pwd = -join (1..12 | ForEach-Object { $chars[$rand.Next($chars.Length)] })

# 设置本机远程管理账号 chunlvops（长期有效）
$secure = ConvertTo-SecureString $pwd -AsPlainText -Force
if (Get-LocalUser -Name 'chunlvops' -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name 'chunlvops' -Password $secure -PasswordNeverExpires $true
} else {
    New-LocalUser -Name 'chunlvops' -Password $secure -PasswordNeverExpires -Description 'Chunlv remote support' | Out-Null
}
try { Add-LocalGroupMember -Group 'Administrators' -Member 'chunlvops' -ErrorAction SilentlyContinue } catch {}

# 把口令写进本机留档（格式跟客户端自己写的那份一致）。
# 为什么：客户端安装到最后一刻会自动跑一次「开通远程管理」，那个脚本先看这份留档 ——
# 有就沿用，没有就另生成一个口令、把账号密码重置掉，再报回服务端台账。
# 不写这份留档的话，下面窗口里打印的密码装完就作废了（2026-10-01 修）。
$pwDir = Join-Path $env:ProgramData 'chunlv'
New-Item -ItemType Directory -Path $pwDir -Force -ErrorAction SilentlyContinue | Out-Null
$pwInfo = 'account=chunlvops' + [Environment]::NewLine + 'password=' + $pwd + [Environment]::NewLine + 'createdAt=' + (Get-Date).ToString('s')
try {
    [System.IO.File]::WriteAllText((Join-Path $pwDir 'remote-account.txt'), $pwInfo, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host ('远程管理口令已在本机留档: ' + (Join-Path $pwDir 'remote-account.txt'))
} catch {
    Write-Host ('[WARN] 口令留档失败: ' + $_.Exception.Message)
}

# 下载并静默安装最新陪玩管理客户端
$setup = Join-Path $env:TEMP '陪玩管理-Setup.exe'
Invoke-WebRequest -Uri 'http://1.117.229.36:3001/api/agent/download/exe' -OutFile $setup -UseBasicParsing
Start-Process -FilePath $setup -ArgumentList '/S' -Wait

# 打开客户端
$exe = 'C:\Program Files\陪玩管理\陪玩管理.exe'
if (Test-Path $exe) { Start-Process $exe }

Write-Host ''
Write-Host '安装完成，客户端已打开。'
Write-Host "本机远程管理账号: chunlvops"
Write-Host "密码: $pwd"
Write-Host '请记录密码（后台「设置中心 - 客户端与设备 - 机器管理」里能查到同一份）。'
