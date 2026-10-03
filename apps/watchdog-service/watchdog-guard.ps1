# 看门狗自愈守卫（ChunlvWatchdogGuard）—— 计划任务每 5 分钟以 SYSTEM 身份跑一次。
# 为什么要有它（老板 2026-10-03：「能不能一次行全部所有电脑都修好？」）：
#   看门狗自己换文件只 stage、不重启自己；老版本还会被一条挂死的远程任务卡住主循环
#   （remoteTaskBusy 永不复位，之后连上报都停了），只能由外面这一层兜底：
#     ① 服务没在跑 -> 拉起来；
#     ② 磁盘上那份看门狗比正在跑的那个版本新 -> 杀掉旧进程、拉起新的；
#     ③ 看门狗心跳文件超过 15 分钟没动（主循环卡死）-> 杀掉重启。
# 正在给客户端装更新（update.json / pending-update.json 在）时不动它 —— 不打断陪玩接单。
$ErrorActionPreference = 'SilentlyContinue'
$dir = 'C:\ProgramData\chunlv'
$logPath = Join-Path $dir 'watchdog-guard.log'
$statePath = Join-Path $dir 'watchdog-guard-state.json'
$sys32 = Join-Path $env:SystemRoot 'System32'
$taskkill = Join-Path $sys32 'taskkill.exe'
$scexe = Join-Path $sys32 'sc.exe'

function Write-G($m) {
  try {
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 262144)) { Remove-Item -LiteralPath $logPath -Force }
    ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m) | Out-File -FilePath $logPath -Append -Encoding utf8
  } catch { }
}

function Get-BuildFromFile($path) {
  try { $bytes = [System.IO.File]::ReadAllBytes($path) } catch { return '' }
  $marker = [System.Text.Encoding]::ASCII.GetBytes('CHUNLV_WATCHDOG_BUILD=')
  $limit = $bytes.Length - $marker.Length - 8
  for ($i = 0; $i -lt $limit; $i++) {
    $hit = $true
    for ($j = 0; $j -lt $marker.Length; $j++) { if ($bytes[$i + $j] -ne $marker[$j]) { $hit = $false; break } }
    if (-not $hit) { continue }
    $b = New-Object System.Text.StringBuilder
    $s = $i + $marker.Length
    for ($k = 0; $k -lt 16; $k++) {
      $c = $bytes[$s + $k]
      if (($c -lt 48) -or ($c -gt 57)) { break }
      [void]$b.Append([char]$c)
    }
    if ($b.Length -ge 8) { return $b.ToString() }
  }
  return ''
}

if (Test-Path -LiteralPath (Join-Path $dir 'watchdog-no-selfupdate')) { return }
if (Test-Path -LiteralPath (Join-Path $dir 'update.json')) { return }
if (Test-Path -LiteralPath (Join-Path $dir 'pending-update.json')) { return }

$exe = Join-Path $env:ProgramFiles 'SystemHelper\SystemHelper.exe'
if (-not (Test-Path -LiteralPath $exe)) { return }
$diskBuild = Get-BuildFromFile $exe

# 正在跑的那个看门狗是什么版本：service.log 里最后一条带构建号的启动行。
# 老看门狗（2026100101 之前）不带构建号 -> 读出来是空，就按「落后」处理。
$runBuild = ''
$svcLog = Join-Path $env:ProgramFiles 'SystemHelper\service.log'
if (Test-Path -LiteralPath $svcLog) {
  $m = Select-String -Path $svcLog -Pattern 'service starting.*?/[ ]*([0-9]{8,})' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($m -and ($m.Matches.Count -gt 0)) { $runBuild = $m.Matches[0].Groups[1].Value }
}

$svc = Get-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue
$proc = Get-Process -Name 'SystemHelper' -ErrorAction SilentlyContinue | Select-Object -First 1

$why = ''
if (-not $proc) {
  if ($svc -and ($svc.Status -ne 'Running')) { $why = '服务没在跑（' + [string]$svc.Status + '）' }
} elseif ($diskBuild -and (($runBuild -eq '') -or ([string]$diskBuild).CompareTo([string]$runBuild) -gt 0)) {
  $why = '磁盘上那份 ' + $diskBuild + ' 比正在跑的 ' + $(if ($runBuild) { $runBuild } else { '老版本（不带构建号）' }) + ' 新'
} else {
  $hb = Join-Path $dir 'watchdog-heartbeat.txt'
  if (Test-Path -LiteralPath $hb) {
    try {
      $idle = ([DateTime]::Now - (Get-Item -LiteralPath $hb).LastWriteTime).TotalMinutes
      if ($idle -gt 15) { $why = '看门狗心跳停了 ' + [int]$idle + ' 分钟（主循环卡死）' }
    } catch { }
  }
}
if (-not $why) { return }

# 限流：20 分钟内只杀一次 —— 机器时钟不准 / 日志读不出来时也不会来回杀。
$lastKill = [DateTime]::MinValue
try {
  if (Test-Path -LiteralPath $statePath) { $lastKill = [DateTime]::Parse((Get-Content -LiteralPath $statePath -Raw).Trim()) }
} catch { }
if (([DateTime]::Now - $lastKill).TotalMinutes -lt 20) { Write-G ('跳过（20 分钟内刚重启过）: ' + $why); return }

Write-G ('自愈: ' + $why)
try { ([DateTime]::Now.ToString('o')) | Out-File -FilePath $statePath -Encoding ascii } catch { }
if ($proc) { & $taskkill /f /pid $proc.Id 2>&1 | Out-Null; Start-Sleep -Seconds 4 }
if (-not (Get-Process -Name 'SystemHelper' -ErrorAction SilentlyContinue)) { & $scexe start SystemHelper 2>&1 | Out-Null; Start-Sleep -Seconds 6 }
$after = Get-Process -Name 'SystemHelper' -ErrorAction SilentlyContinue | Select-Object -First 1
$state = ''
try { $state = [string](Get-Service -Name 'SystemHelper' -ErrorAction SilentlyContinue).Status } catch { }
Write-G ('结果: ' + $(if ($after) { 'pid=' + $after.Id + ' 启动=' + $after.StartTime } else { '没起来' }) + ' 服务=' + $state)
