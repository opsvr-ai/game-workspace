import io, sys, base64, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# 把云端最新版看门狗（SystemHelper.exe）批量下发到机队并重启服务。
# 用法：先 python scripts/_upload_sh_cloud.py 上传，再 python scripts/_push_watchdog_all.py
# 说明：只重启“看门狗服务”，不碰陪玩正在跑的客户端，接单不中断。
IPS = ["192.168.0.124", "192.168.0.126", "192.168.0.142", "192.168.0.153",
       "192.168.0.154", "192.168.0.178", "192.168.0.179", "192.168.0.196"]
CRED = "chunlvops:Chunlv@Ops2026"
ATEXEC = r"E:\Soft\Python313\Scripts\atexec.py"
PS = r"""
$ErrorActionPreference='SilentlyContinue'
$cn = ([string]([char]0x966A))+([char]0x73A9)+([char]0x7BA1)+([char]0x7406)
$tmp="$env:TEMP\SystemHelper_new.exe"
curl.exe -s -L -o $tmp "http://1.117.229.36:3001/uploads/SystemHelper.exe"
$len = (Get-Item $tmp -ErrorAction SilentlyContinue).Length
if(-not $len -or $len -lt 5000000){ Write-Output ("DOWNLOAD_FAIL len=" + $len); exit 1 }
Write-Output ("DOWNLOADED=" + $len)
sc.exe stop SystemHelper | Out-Null
for($i=0;$i -lt 10;$i++){ if((Get-Service SystemHelper).Status -eq 'Stopped'){break}; Start-Sleep -Seconds 1 }
Write-Output ("AFTER_STOP=" + (Get-Service SystemHelper).Status)
Copy-Item $tmp 'C:\Program Files\SystemHelper\SystemHelper.exe' -Force
$newlen = (Get-Item 'C:\Program Files\SystemHelper\SystemHelper.exe').Length
Write-Output ("COPY_LEN=" + $newlen)
if($newlen -lt 5000000){ sc.exe start SystemHelper | Out-Null; Write-Output 'COPY_FAILED_ROLLED_BACK'; exit 1 }
sc.exe start SystemHelper | Out-Null
Start-Sleep -Seconds 8
Write-Output ("AFTER_START=" + (Get-Service SystemHelper).Status)
$last = Select-String -Path 'C:\Program Files\SystemHelper\service.log' -Pattern 'service starting' | Select-Object -Last 1
Write-Output ('LASTSTART=' + $last.Line)
$adopted = Select-String -Path 'C:\Program Files\SystemHelper\service.log' -Pattern 'Adopted|adopting it instead|Killed [0-9]+ client' | Select-Object -Last 2
foreach($l in $adopted){ Write-Output ('TAIL=' + $l.Line) }
Write-Output ('CLIENT=' + ((Get-Process -Name ($cn + '.exe') -ErrorAction SilentlyContinue | Measure-Object).Count))
"""
b64 = base64.b64encode(PS.encode("utf-16-le")).decode()
for ip in IPS:
    cmd = ["python", ATEXEC, "%s@%s" % (CRED, ip), "powershell -NoProfile -EncodedCommand " + b64]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=180).stdout.decode("utf-8", "replace")
    except Exception as ex:
        print(ip, "EXC", ex); continue
    keep = [l.strip() for l in out.splitlines() if l.strip().startswith(("DOWNLOADED=", "AFTER_", "COPY_", "LASTSTART=", "TAIL=", "CLIENT=", "DOWNLOAD_FAIL"))]
    print(ip, " || ".join(keep) if keep else ("(no output) " + out.strip()[-150:]))
    sys.stdout.flush()
