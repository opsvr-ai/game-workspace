/**
 * 「把这台电脑换成另一种客户端」的服务端脚本（下发给客户端、由看门狗以 SYSTEM 权限执行）。
 *
 * 为什么要有它（老板 2026-10-17：「现在就换」）：
 *   孙可馨的 CS 账号一直是在**陪玩端程序**里登的 —— 界面是客服的，底层跑的是陪玩端的壳
 *   （看门狗按陪玩端守、跑陪玩的进程管控与录制、走陪玩端的更新通道），台账也只能按陪玩端记，
 *   于是「机器管理」里认不出她是客服。把她换成客服端，本来是「人到电脑跟前双击安装包」的活；
 *   这台机器在办公室局域网里、口令又是我们自己的，没道理等人。
 *
 * 装机包自己已经做掉一半（两个端的 `build/installer.nsh`，2026-10-17 逐条核对过）：
 *   * `customInit`：先 `sc stop SystemHelper`（否则看门狗会不停把客户端拉起来、文件换不了）、
 *     杀掉本端进程、清掉包名老目录；
 *   * `customInstall`：重新注册看门狗 `SystemHelper.exe install --client=cs|companion`
 *     （**看门狗认哪一端，全靠这一步**）、`sc start SystemHelper`、再跑一遍
 *     `enable-remote.ps1 -ClientType CS|COMPANION`（顺手把新类型回报给服务端台账）。
 * 所以脚本要补的是它**没做**的那半：验目标端真的落地了、把旧端彻底退掉（进程 / 开机自启 /
 * 快捷方式 / 旧目录 / 控制面板残留）、再把「记住的账号密码」搬过去。
 *
 * 换的时候必须一次做对，少一件就会变成「装了没生效 / 装完反而两套都在跑」：
 *   ① 静默装目标端（NSIS `/S`）。装完**必须验证那个 exe 真的在**；不在就什么都不动 ——
 *      绝不能先删旧的，否则一台电脑上两个客户端都没了。
 *   ② 退掉旧端。⚠️ **故意不跑旧端自己的卸载程序**：旧端（陪玩管理）的 `customInit` 会
 *      `sc delete SystemHelper` —— 刚装好的新端正靠这个共享服务活着，一卸载就把新端的看门狗拆了。
 *      那套清理动作（删安装目录 + 删注册表残留）我们自己按同样范围做，但**不碰共享的看门狗服务**。
 *      （范围一致：「陪玩管理」安装包自己退自己时删的就是 `$PROGRAMFILES64\陪玩管理`。）
 *   ③ 把「记住的账号密码」搬过去：两个端都用 Electron safeStorage（Windows 上就是 DPAPI，
 *      同一台机器同一个用户能解开），明文都是 `{"username":…,"password":…}`，
 *      所以密文可以按原样搬 —— 换完不用让人重新登一次。
 *      陪玩端存在 `config.json` 的 `savedCredentials`，客服端读 `credentials.json`；
 *      **目前只做「换成客服端」这个方向**，反方向（客服端→陪玩端）陪玩端要写 JSON 存储，
 *      风险比收益大，暂时留着让人重新登一次。
 *
 * 约定：正文用 String.raw，不要出现模板字符串的插值符号和反引号（跟 client-diag.ts 一样）。
 * 手工给一台机器换端时，把这段正文存成 .ps1 跑即可（`-ServerUrl` 不给就用默认云地址）。
 */
export const CLIENT_SWITCH_SCRIPT_VERSION = '2026-10-17.3';

export const CLIENT_SWITCH_PS = String.raw`# 蠢驴电竞 · 把这台电脑换成另一种客户端（服务端下发，看门狗 SYSTEM 权限执行）
# 只做「装目标端 → 验在不在 → 退旧端 → 搬账号密码」；不是管理员就直接放弃，不弹任何窗。
# 脚本版本: 2026-10-17.3
param(
  [string]$ServerUrl = '',
  [string]$Kind = 'cs',
  [string]$TaskId = '',
  [string]$Token = ''
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$script:Log = New-Object System.Collections.ArrayList
function W([string]$t) {
  $line = '[换端] ' + [string]$t
  Write-Output $line
  [void]$script:Log.Add($line)
}

$isAdmin = $false
$who = ''
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $who = $id.Name
  $isAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { }
W ('执行身份: ' + $who + ' 管理员=' + $isAdmin)

$pf = $env:ProgramFiles
$local = $env:LOCALAPPDATA
$base = [string]$ServerUrl
if ($base) { $base = $base.TrimEnd('/') }
if (-not $base) { $base = 'http://1.117.229.36:3001' }

# ⚠️ 结果必须由**脚本自己**回传：装机包中途会 sc stop/sc delete 看门狗 ——
#    看门狗一死，它那条「跑完任务再回报」的路就断了，任务在服务端会一直挂着「执行中」。
#    自己 POST 一次，管理端的任务记录里就能看到这次换端到底成没成。
function Report([int]$code) {
  if (-not $TaskId) { return }
  if (-not $Token) { return }
  try {
    # 服务端是按 status 判定这条任务成没成的（看门狗也是传 ok / failed），别只传 exitCode。
    $st = 'failed'
    if ($code -eq 0) { $st = 'ok' }
    $payload = (@{
      taskId = $TaskId
      status = $st
      lines = ([string]::Join([Environment]::NewLine, $script:Log.ToArray()))
      exitCode = $code
      error = ''
      hostname = $env:COMPUTERNAME
    } | ConvertTo-Json -Compress)
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $req = [Net.WebRequest]::Create($base + '/api/agent/machine-task-result')
    $req.Method = 'POST'
    $req.ContentType = 'application/json; charset=utf-8'
    $req.Headers.Add('x-onboard-token', $Token)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    $resp.Close()
  } catch { }
}

if ($Kind -eq 'companion') {
  $label = '陪玩端'
  $url = $base + '/api/agent/download/exe'
  $targetDir = (Join-Path $pf '陪玩管理')
  $targetExe = (Join-Path $targetDir '陪玩管理.exe')
  $retireProcs = @('客服管理', '客服端')
  $retireNames = @('客服管理', '客服端', '@chunlvcs-electron')
  $retireDirs = @(
    (Join-Path $pf '客服管理'),
    (Join-Path $pf '@chunlvcs-electron'),
    (Join-Path $local 'Programs\客服管理'),
    (Join-Path $local 'Programs\@chunlvcs-electron')
  )
  $oldUserData = 'cs-electron'
  $newUserData = 'companion-electron'
} else {
  $label = '客服端'
  $url = $base + '/api/agent/download/cs'
  $targetDir = (Join-Path $pf '客服管理')
  $targetExe = (Join-Path $targetDir '客服管理.exe')
  $retireProcs = @('陪玩管理', '蠢驴电竞')
  $retireNames = @('陪玩管理', '蠢驴电竞', '@chunlvcompanion-electron')
  $retireDirs = @(
    (Join-Path $pf '陪玩管理'),
    (Join-Path $pf '蠢驴电竞'),
    (Join-Path $pf '@chunlvcompanion-electron'),
    (Join-Path $local 'Programs\陪玩管理'),
    (Join-Path $local 'Programs\蠢驴电竞'),
    (Join-Path $local 'Programs\@chunlvcompanion-electron')
  )
  $oldUserData = 'companion-electron'
  $newUserData = 'cs-electron'
}

if (-not $isAdmin) {
  W '不是管理员权限 —— 装不了（客户端那边会弹 UAC，而电脑跟前没人点）。这次不换，等看门狗上来再自动做。'
  Report 3
  exit 3
}

W ('要装的是 ' + $label + '，安装包地址 ' + $url)
$setup = Join-Path $env:TEMP 'chunlv-switch-setup.exe'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'chunlv-switch/1')
  $wc.DownloadFile($url, $setup)
  $wc.Dispose()
} catch {
  W ('下载失败: ' + $_.Exception.Message)
  Report 1
  exit 1
}
$setupSize = 0
try { $setupSize = [math]::Round((Get-Item -LiteralPath $setup).Length / 1MB, 1) } catch { }
W ('下载完成 ' + $setupSize + ' MB')

W '开始静默安装（装机包会自己把看门狗改成认这一端、并回报新类型）…'
try {
  $proc = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  W ('安装程序退出码 ' + $proc.ExitCode)
} catch {
  W ('安装失败: ' + $_.Exception.Message)
}
Start-Sleep -Seconds 8

# ② 验在不在：只认「目标端真的落地了」才动旧端。exe 名字按 productName 猜，猜不中就退一步在目录里找。
$found = ''
if (Test-Path -LiteralPath $targetExe) {
  $found = $targetExe
} elseif (Test-Path -LiteralPath $targetDir) {
  $cand = Get-ChildItem -LiteralPath $targetDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.exe' -and $_.Name -notlike 'Uninstall*' } |
    Sort-Object Length -Descending | Select-Object -First 1
  if ($cand) { $found = $cand.FullName }
}
if (-not $found) {
  W ('[失败] 没找到 ' + $targetExe + ' → 保持原样，绝不动旧客户端')
  try { Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue } catch { }
  Report 2
  exit 2
}
W ('[成功] ' + $found + ' 已就位')

# ③ 退旧端：先杀进程 → 去开机自启 → 删快捷方式 → 删旧目录 → 清「应用列表」残留。
#    全程不跑旧端自己的卸载程序 —— 那会 sc delete SystemHelper，把刚装好的新端的看门狗一起拆了。
W ('开始退掉旧客户端（' + $retireNames[0] + '）…')
foreach ($n in $retireProcs) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3
foreach ($n in $retireProcs) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$runKeys = @('Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run')
Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue | ForEach-Object {
  $runKeys += ('Registry::' + $_.Name + '\Software\Microsoft\Windows\CurrentVersion\Run')
}
foreach ($k in $runKeys) {
  $item = Get-Item -Path $k -ErrorAction SilentlyContinue
  if (-not $item) { continue }
  foreach ($p in @($item.Property)) {
    if (-not $p) { continue }
    $val = ''
    try { $val = [string](Get-ItemProperty -Path $k -Name $p -ErrorAction SilentlyContinue).$p } catch { }
    foreach ($n in $retireProcs) {
      if ($val -like ('*' + $n + '*')) {
        Remove-ItemProperty -Path $k -Name $p -ErrorAction SilentlyContinue
        W ('已取消旧客户端的开机自启: ' + $p)
      }
    }
  }
}

$shortcutDirs = @()
# ⚠️ 别直接用 $env:PUBLIC —— 实测它可能是空的（空值会让 Join-Path 直接报错、公共桌面整段被跳过），
#    从 SystemDrive 兜一个，两个端都在的话也照收。
$publicRoot = [string]$env:PUBLIC
if (-not $publicRoot) { $publicRoot = (Join-Path $env:SystemDrive 'Users\Public') }
$shortcutDirs += (Join-Path $publicRoot 'Desktop')
$programDataRoot = [string]$env:ProgramData
if (-not $programDataRoot) { $programDataRoot = (Join-Path $env:SystemDrive 'ProgramData') }
$shortcutDirs += (Join-Path $programDataRoot 'Microsoft\Windows\Start Menu\Programs')
foreach ($u in (Get-ChildItem -LiteralPath (Join-Path $env:SystemDrive 'Users') -Directory -ErrorAction SilentlyContinue)) {
  $shortcutDirs += (Join-Path $u.FullName 'Desktop')
  $shortcutDirs += (Join-Path $u.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs')
}
$shell = $null
try { $shell = New-Object -ComObject WScript.Shell } catch { }
foreach ($d in $shortcutDirs) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  $links = @(Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.lnk' })
  foreach ($lnk in $links) {
    $t = ''
    if ($shell) { try { $t = [string]$shell.CreateShortcut($lnk.FullName).TargetPath } catch { } }
    if (-not $t) { continue }
    $hit = $false
    foreach ($n in $retireNames) { if ($t -like ('*' + $n + '*')) { $hit = $true; break } }
    if ($hit) {
      try { Remove-Item -LiteralPath $lnk.FullName -Force -ErrorAction Stop; W ('已删掉旧客户端的快捷方式: ' + $lnk.FullName) } catch { }
    }
  }
}

foreach ($d in $retireDirs) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  try {
    Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop
    W ('已删除旧客户端目录: ' + $d)
  } catch {
    W ('删旧客户端目录失败（不影响新端）: ' + $d + ' —— ' + $_.Exception.Message)
  }
}

# 每用户目录：脚本以 SYSTEM 身份跑时 $env:LOCALAPPDATA 指向系统账户那份，
# 用户自己装到本用户目录里的旧端得按用户挨个找。
foreach ($u in (Get-ChildItem -LiteralPath (Join-Path $env:SystemDrive 'Users') -Directory -ErrorAction SilentlyContinue)) {
  foreach ($n in $retireNames) {
    $d = Join-Path (Join-Path $u.FullName 'AppData\Local\Programs') $n
    if (-not (Test-Path -LiteralPath $d)) { continue }
    try {
      Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop
      W ('已删除旧客户端目录: ' + $d)
    } catch {
      W ('删旧客户端目录失败（不影响新端）: ' + $d + ' —— ' + $_.Exception.Message)
    }
  }
}

foreach ($root in @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)) {
  if (-not (Test-Path $root)) { continue }
  foreach ($k in @(Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
    $dn = ''
    try { $dn = [string](Get-ItemProperty -Path $k.PSPath -Name DisplayName -ErrorAction SilentlyContinue).DisplayName } catch { }
    if (-not $dn) { continue }
    $hit = $false
    foreach ($n in $retireNames) { if ($dn -like ($n + '*')) { $hit = $true } }
    if ($hit) {
      Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction SilentlyContinue
      W ('已清掉旧客户端在「应用列表」里的残留: ' + $dn)
    }
  }
}

foreach ($n in $retireProcs) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ④ 搬「记住的账号密码」
if ($Kind -ne 'cs') {
  W '（换成陪玩端时账号密码没搬：陪玩端把账号存在自己的 config.json 里，那边需要重新登一次）'
} else {
  $moved = 0
  $usersRoot = Join-Path $env:SystemDrive 'Users'
  foreach ($u in (Get-ChildItem -LiteralPath $usersRoot -Directory -ErrorAction SilentlyContinue)) {
    $roaming = Join-Path (Join-Path $u.FullName 'AppData\Roaming') '@chunlv'
    if (-not (Test-Path -LiteralPath $roaming)) { continue }
    $oldCfg = Join-Path $roaming ($oldUserData + '\config.json')
    $oldCred = Join-Path $roaming ($oldUserData + '\credentials.json')
    $blob = ''
    try {
      if (Test-Path -LiteralPath $oldCfg) {
        $j = Get-Content -LiteralPath $oldCfg -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.savedCredentials) { $blob = [string]$j.savedCredentials }
      } elseif (Test-Path -LiteralPath $oldCred) {
        $blob = (Get-Content -LiteralPath $oldCred -Raw -Encoding UTF8).Trim()
      }
    } catch { }
    if (-not $blob) { continue }
    $dir = Join-Path $roaming $newUserData
    try {
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      [IO.File]::WriteAllText((Join-Path $dir 'credentials.json'), $blob, (New-Object Text.UTF8Encoding($false)))
      $moved = $moved + 1
      W ('已把记住的账号密码搬过来: ' + $u.Name)
    } catch { W ('搬账号密码失败: ' + $_.Exception.Message) }
  }
  if ($moved -eq 0) { W '旧端本地没存「记住的账号密码」，新端首次要手动登一次' }
}

try { Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue } catch { }
W ('完成：这台电脑以后是' + $label)
Report 0
`;

/** 直接下发正文（客户端自己会用 -File 跑，所以这里不做令牌替换）。 */
export function buildSwitchClientScript(): string {
  return CLIENT_SWITCH_PS;
}
