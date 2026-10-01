$ErrorActionPreference = 'Continue'

# 80 多 MB 的安装包：PS 5.1 默认会画进度条，下载能慢好几倍，装机的人等不起。
$ProgressPreference = 'SilentlyContinue'

# 新电脑的一条龙：建 Windows 运维账号 chunlvops（管理员组 + 密码永不过期）→ 静默装陪玩端 → 打开客户端。
# 口令会写进本机留档；客户端装到最后一步自动跑的那次「开通远程管理」会沿用同一份，
# 所以窗口打印的、本机留档的、后台台账里的永远是同一个口令。
$cloud = 'http://1.117.229.36:3001'
$account = 'chunlvops'
$cn = '陪玩管理'

Write-Host ''
Write-Host '===== 蠢驴电竞 - 新电脑一键装机 =====' -ForegroundColor Cyan
Write-Host ('本机: ' + $env:COMPUTERNAME)
Write-Host ''

# ---- 1/3 运维账号 ----
Write-Host '[1/3] 建远程管理账号（口令自动生成）...'
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#'
$rand = New-Object System.Random
$password = -join (1..12 | ForEach-Object { $chars[$rand.Next($chars.Length)] })
# 2026-10-01 修：以前这几步都用 -ErrorAction SilentlyContinue，出错也照样往下走 ——
# 后果是「口令其实没设上，但留档 / 窗口打印 / 台账里都写着一个新口令」，三处一致地错。
# 现在改成出错就拦住：不写留档、不报台账，让人重来一次（别拿一个登不上的口令去做远程）。
$pwErr = ''
try {
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    if (-not $secure) { throw 'ConvertTo-SecureString 没返回结果' }
    if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name $account -Password $secure -PasswordNeverExpires $true -AccountNeverExpires -ErrorAction Stop
        Enable-LocalUser -Name $account -ErrorAction Stop
    } else {
        New-LocalUser -Name $account -Password $secure -PasswordNeverExpires -AccountNeverExpires -Description 'Chunlv remote support account' -ErrorAction Stop | Out-Null
    }
    if (-not (Get-LocalUser -Name $account -ErrorAction SilentlyContinue)) { throw '账号建好之后又查不到了' }
} catch {
    $pwErr = $_
}
if ($pwErr) {
    Write-Host ('[!] 运维账号没弄成：' + $pwErr.Exception.Message) -ForegroundColor Red
    Write-Host '    这次不写口令留档、也不报台账，免得留档里的口令其实登不上。' -ForegroundColor Yellow
    Write-Host '    请关掉这个窗口重新双击一次；还不行就把这个窗口截图发给管理员。' -ForegroundColor Yellow
    return
}
$inAdmins = $false
try { $inAdmins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -match $account } catch { }
if (-not $inAdmins) { Add-LocalGroupMember -Group 'Administrators' -Member $account -ErrorAction SilentlyContinue }
Write-Host ('     账号 ' + $account + ' 就绪')

# 口令留档。为什么必须写：客户端装到最后一步会自动跑一次「开通远程管理」，那个脚本发现没留档就自己另生成
# 一个口令、把账号密码重置掉 —— 于是窗口上打印给对方的密码当场作废（2026-09-04 ~ 10-01 的老毛病）。
$pwDir = Join-Path $env:ProgramData 'chunlv'
New-Item -ItemType Directory -Path $pwDir -Force -ErrorAction SilentlyContinue | Out-Null
$pwRecord = Join-Path $pwDir 'remote-account.txt'
$nl = [Environment]::NewLine
$pwInfo = 'account=' + $account + $nl + 'password=' + $password + $nl + 'createdAt=' + (Get-Date).ToString('s')
try {
    [System.IO.File]::WriteAllText($pwRecord, $pwInfo, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host ('     口令留档: ' + $pwRecord)
} catch {
    Write-Host ('     [WARN] 口令留档失败: ' + $_.Exception.Message) -ForegroundColor Yellow
}
Write-Host ''

# ---- 2/3 陪玩端 ----
Write-Host '[2/3] 下载并静默安装陪玩端（80 多 MB，慢一点是正常的）...'
$setup = Join-Path $env:TEMP ($cn + '-Setup.exe')
try {
    Invoke-WebRequest -Uri ($cloud + '/api/agent/download/exe') -OutFile $setup -UseBasicParsing
} catch {
    Write-Host ('[!] 安装包没下下来: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '    请确认这台电脑能上网，关掉这个窗口后重新双击一次。' -ForegroundColor Red
    Write-Host ('    （运维账号已经建好了：' + $account + ' / ' + $password + '）') -ForegroundColor Yellow
    return
}
Start-Process -FilePath $setup -ArgumentList '/S' -Wait

# ---- 3/3 打开客户端 ----
$exe = Join-Path (Join-Path $env:ProgramFiles $cn) ($cn + '.exe')
if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe
    Write-Host '[3/3] 客户端已装好并打开。'
} else {
    Write-Host ('[!] 装完没找到 ' + $exe) -ForegroundColor Red
    Write-Host '    安装可能没走完：把这个窗口截图发给管理员。' -ForegroundColor Red
}
Write-Host ''
Write-Host '装机完成。' -ForegroundColor Green
Write-Host ('  远程管理账号: ' + $account)
Write-Host ('  口令: ' + $password)
Write-Host '  口令也写在这台电脑的 C:\ProgramData\chunlv\remote-account.txt；'
Write-Host '  后台「设置中心 → 客户端与设备 → 机器管理」里看到的是同一份。'
Write-Host ''

# 下面这行是给 setup-pc.bat 用的：它靠这行确认「脚本整份都下下来了」（下到 wifi 登录页那种网页时不会有这行）。
# CHUNLV_SETUP_PC_END
