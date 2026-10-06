"""重新打包并上传陪玩端「自动更新包」(chunlv-latest.zip)。

用途：改完看门狗（apps/watchdog-service）之后，除了上传 /uploads/SystemHelper.exe，
还必须把它一起塞进客户端更新包 —— 否则任何一台「重装客户端 / 从 zip 恢复」的电脑，
装完拿到的还是老看门狗（2026-09-20 踩过：装完继续每 5 秒杀一次客户端）。

做三件事：
  1. 把 apps/watchdog-service/SystemHelper.exe 复制到 release/win-unpacked/resources/
  2. 用 win-unpacked 重新打 chunlv-latest.zip（只重打包，不动版本号，不触发全网更新）
  3. 上传到云端 /uploads/chunlv-latest.zip 并校验（包内构建号 + 远端 md5 + HTTP 200）
"""
import hashlib
import io
import os
import re
import sys
import zipfile

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "apps", "companion-electron", "release", "win-unpacked")
ZIP = os.path.join(ROOT, "apps", "companion-electron", "release", "chunlv-latest.zip")
SH = os.path.join(ROOT, "apps", "watchdog-service", "SystemHelper.exe")
# 服务器口令不写死在代码里（2026-10-03 清理明文凭证）：
#   先设置环境变量再跑，例如 PowerShell:  $env:CHUNLV_SSH_PASS="<口令>"
HOST, USER = "1.117.229.36", "ubuntu"
PASSWORD = os.environ.get("CHUNLV_SSH_PASS", "")
if not PASSWORD:
    raise SystemExit(
        '缺少服务器口令：先设置环境变量 CHUNLV_SSH_PASS（PowerShell: $env:CHUNLV_SSH_PASS="<口令>"）。'
        '口令不再写死在脚本里（2026-10-03 清理明文凭证）。'
    )
# uploads/ 是 root 所有：SFTP（ubuntu 登录）写不进去，先落到 ubuntu 的临时路径再 sudo 改名
REMOTE = "/apps/server/game-workspace/uploads/chunlv-latest.zip"
TMP = "/home/ubuntu/chunlv-latest.zip.new"


MARKER = b"CHUNLV_WATCHDOG_BUILD="


def check_old_parser_readable(data: bytes) -> int:
    """老看门狗只认「第一个」标记：第一处后面必须紧跟数字，否则全网升不上来。

    2026-10-01 事故：源码里那半截「标记常量」排在真标记前面、后面不是数字，
    老看门狗于是认为云端那份没带构建号，从来不敢升级。这里把这条守死。
    """
    hits = []
    pos = 0
    while True:
        i = data.find(MARKER, pos)
        if i < 0:
            break
        s = i + len(MARKER)
        e = 0
        while s + e < len(data) and 48 <= data[s + e] <= 57:
            e += 1
        hits.append(data[s:s + e].decode("ascii", "replace"))
        pos = s
    good = [h for h in hits if h]
    if not good or hits[0] != good[0]:
        print("!! 包内看门狗构建号不是第一处或为空，老版本看门狗会读不到、升不上来 ->", hits)
        return 1
    print("包内看门狗构建号自检通过:", good[0])
    return 0


def main() -> int:
    if not os.path.exists(SH):
        print("缺少 apps/watchdog-service/SystemHelper.exe，先编译：cd apps/watchdog-service && go build -o SystemHelper.exe .")
        return 1
    dst = os.path.join(SRC, "resources", "SystemHelper.exe")
    import shutil

    shutil.copy2(SH, dst)
    print("已放入打包目录:", dst, os.path.getsize(dst), "bytes")

    print("重新打包 ...")
    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(SRC):
            for name in files:
                full = os.path.join(root, name)
                zf.write(full, "win-unpacked/" + os.path.relpath(full, SRC).replace("\\", "/"))
    print("zip:", ZIP, round(os.path.getsize(ZIP) / 1024 / 1024, 1), "MB")

    with zipfile.ZipFile(ZIP) as zf:
        data = zf.read("win-unpacked/resources/SystemHelper.exe")
    tags = re.findall(rb"CHUNLV_WATCHDOG_BUILD=[0-9.]+", data)
    print("包内看门狗:", len(data), "bytes md5", hashlib.md5(data).hexdigest(), tags)
    if not tags:
        print("!! 包内看门狗没有构建号标记，可能放进去的是老版本，停止上传")
        return 1
    if check_old_parser_readable(data) != 0:
        return 1

    print("上传云端 ...")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)
    sftp = c.open_sftp()
    sftp.put(ZIP, TMP)
    sftp.close()

    def run(cmd: str):
        _i, o, e = c.exec_command(cmd, timeout=300)
        return o.read().decode("utf-8", "replace").strip(), e.read().decode("utf-8", "replace").strip()

    print(run("md5sum %s && sudo -n mv -f %s %s && md5sum %s && ls -la %s" % (TMP, TMP, REMOTE, REMOTE, REMOTE)))
    print("本地 md5:", hashlib.md5(open(ZIP, "rb").read()).hexdigest())
    # 只取前 64KB 验「地址通、能下载」：整包 120 多兆，全下来得等好几分钟
    print(run("curl -s -o /dev/null -w 'download/latest -> %{http_code} %{size_download}\\n' --max-time 30 -r 0-65535 http://127.0.0.1:3001/api/agent/download/latest"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
