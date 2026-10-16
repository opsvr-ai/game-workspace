/**
 * 「把这台电脑换成另一种客户端」的服务端脚本（下发给客户端、由看门狗以 SYSTEM 权限执行）。
 *
 * 为什么要有它（老板 2026-10-17：「现在就换」）：
 *   孙可馨的 CS 账号一直是在**陪玩端程序**里登的 —— 界面是客服的，底层跑的是陪玩端的壳
 *   （看门狗按陪玩端守、跑陪玩的进程管控与录制、走陪玩端的更新通道），台账也只能按陪玩端记，
 *   于是「机器管理」里认不出她是客服。把她换成客服端，本来是「人到电脑跟前双击安装包」的活；
 *   这台机器在办公室局域网里、口令又是我们自己的，没道理等人。
 *
 * 换的时候必须一次做对四件事，少一件就会变成「装了没生效 / 装完反而两套都在跑」：
 *   ① 静默装目标端（NSIS `/S`）。装完**必须验证那个 exe 真的在**；不在就什么都不动 ——
 *      绝不能先卸旧的，否则一台电脑上两个客户端都没了。
 *   ② 让看门狗改认新身份（安装器里自带 `SystemHelper.exe install --client=xxx`）。
 *   ③ 退掉旧客户端：先杀进程 → 去掉开机自启（陪玩端是 Electron 的 openAtLogin，写在
 *      各用户 hive 的 Run 键里，SYSTEM 身份跑的时候 `HKCU` 是系统账户，必须扫 HKEY_USERS）
 *      → 最后静默跑旧端自己的卸载程序。
 *   ④ 把「记住的账号密码」搬过去：两个端都用 Electron safeStorage（Windows 上就是 DPAPI，
 *      同一台机器同一个用户能解开），明文都是 `{"username":…,"password":…}`，
 *      所以密文可以按原样搬 —— 换完不用让人重新登一次。
 *
 * 约定：正文用 String.raw，不要出现模板字符串的插值符号和反引号（跟 client-diag.ts 一样）。
 * 手工给一台机器换端时，把这段正文存成 .ps1 跑即可（`-ServerUrl` 不给就用默认云地址）。
 */
export const CLIENT_SWITCH_SCRIPT_VERSION = '2026-10-17.1';

export const CLIENT_SWITCH_PS = String.raw`# 蠢驴电竞 · 把这台电脑换成另一种客户端（服务端下发，看门狗 SYSTEM 权限执行）
# 只做「装目标端 → 验在不在 → 退旧端 → 搬账号密码」；不是管理员就直接放弃，不弹任何窗。
# 脚本版本: 2026-10-17.1
param(
  [string]$ServerUrl = '',
  [string]$Kind = 'cs'
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function W([string]$t) { Write-Output ('[换端] ' + [string]$t) }

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

if ($Kind -eq 'companion') {
  $label = '陪玩端'
  $url = $base + '/api/agent/download/latest'
  $targetExe = (Join-Path $pf '陪玩管理\陪玩管理.exe')
  $targetProcs = @('陪玩管理', '蠢驴电竞')
  $retireProcs = @('客服管理', '客服端')
  $retireDirs = @((Join-Path $pf '客服管理'), (Join-Path $pf '@chunlvcs-electron'), (Join-Path $local 'Programs\客服管理'))
  $oldUserData = 'cs-electron'
  $newUserData = 'companion-electron'
} else {
  $label = '客服端'
  $url = $base + '/api/agent/download/cs'
  $targetExe = (Join-Path $pf '客服管理\客服管理.exe')
  $targetProcs = @('客服管理', '客服端')
  $retireProcs = @('陪玩管理', '蠢驴电竞')
  $retireDirs = @((Join-Path $pf '陪玩管理'), (Join-Path $pf '@chunlvcompanion-electron'), (Join-Path $local 'Programs\陪玩管理'))
  $oldUserData = 'companion-electron'
  $newUserData = 'cs-electron'
}

if (-not $isAdmin) {
  W '不是管理员权限 —— 装不了（客户端那边会弹 UAC，而电脑跟前没人点）。这次不换，等看门狗上来再自动做。'
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
  exit 1
}
W ('下载完成 ' + [math]::Round((Get-Item -LiteralPath $setup).Length / 1MB, 1) + ' MB')

W '开始静默安装…'
try {
  $proc = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  W ('安装程序退出码 ' + $proc.ExitCode)
} catch {
  W ('安装失败: ' + $_.Exception.Message)
}
Start-Sleep -Seconds 6

if (-not (Test-Path -LiteralPath $targetExe)) {
  W ('[失败] 没找到 ' + $targetExe + ' → 保持原样，绝不动旧客户端')
  exit 2
}
W ('[成功] ' + $targetExe + ' 已就位')

W '开始退掉旧客户端…'
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

$removed = $false
foreach ($d in $retireDirs) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  $un = Get-ChildItem -LiteralPath $d -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $un) { continue }
  try {
    $u = Start-Process -FilePath $un.FullName -ArgumentList '/S' -PassThru -Wait
    W ('已静默卸载旧客户端: ' + $un.FullName + ' 退出码 ' + $u.ExitCode)
    $removed = $true
  } catch { W ('卸载旧客户端失败: ' + $_.Exception.Message) }
}
if (-not $removed) { W '没找到旧客户端的卸载程序（可能本来就没装）' }
Start-Sleep -Seconds 6
foreach ($n in $retireProcs) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($Kind -ne 'cs') {
  W '（换成陪玩端时账号密码没搬，那边需要重新登一次）'
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
      W ('已把记住的账号密码搬到客服端: ' + $u.Name)
    } catch { W ('搬账号密码失败: ' + $_.Exception.Message) }
  }
  if ($moved -eq 0) { W '旧端本地没存「记住的账号密码」，客服端首次要手动登一次' }
}

try { Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue } catch { }
W ('完成：这台电脑以后是' + $label)
`;

/** 直接下发正文（客户端自己会用 -File 跑，所以这里不做令牌替换）。 */
export function buildSwitchClientScript(): string {
  return CLIENT_SWITCH_PS;
}
