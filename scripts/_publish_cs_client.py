"""发布客服端（客服管理）到云端。

老板 2026-09-30 定调：客服端也要跟陪玩端一样「有看门狗 + 更新不弹授权」。
所以一次发布要同时送两样东西：

  1. 自动更新整包 chunlv-cs-latest.zip（win-unpacked 打包，里面带 SystemHelper.exe）
     —— 新客服端下载它，交给看门狗（系统权限）解压换装，全程不弹 UAC。
  2. 装机包 agent-cs-setup.exe（NSIS）—— 新电脑装机用；也是老客服端唯一的升级路
     （老客户端不认识 zip，只能让它装 NSIS，那一下要点 UAC）。

同时写三个 SystemConfig：
  cs.latest_version       版本号
  cs.latest_download_url  老客户端用：/api/agent/download/cs      （NSIS 安装包）
  cs.latest_zip_url       新客户端用：/api/agent/download/cs-zip  （整包 zip）

注意：老客服端只会拿 downloadUrl 去当 exe 跑，所以 downloadUrl 必须一直指向安装包，
千万别改成 zip，否则还在老版本的机器会「下载成功但装不上」。
"""
import hashlib
import io
import os
import re
import shutil
import sys
import tempfile
import zipfile

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
# 服务器口令不写死在代码里（2026-10-03 清理明文凭证）：
#   先设置环境变量再跑，例如 PowerShell:  $env:CHUNLV_SSH_PASS="<口令>"
PASSWORD = os.environ.get("CHUNLV_SSH_PASS", "")
if not PASSWORD:
    raise SystemExit('缺少服务器口令：先设置环境变量 CHUNLV_SSH_PASS（PowerShell: $env:CHUNLV_SSH_PASS="<口令>"）。'
                         '口令不再写死在脚本里（2026-10-03 清理明文凭证）。')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_RELEASE = os.path.join(ROOT, "apps", "cs-electron", "release")
LOCAL_UNPACKED = os.path.join(LOCAL_RELEASE, "win-unpacked")
SH = os.path.join(ROOT, "apps", "watchdog-service", "SystemHelper.exe")
REMOTE_SETUP = "/apps/server/game-workspace/uploads/agent-cs-setup.exe"
REMOTE_SETUP_CN = "/apps/server/game-workspace/uploads/客服管理-Setup.exe"
REMOTE_ZIP = "/apps/server/game-workspace/uploads/chunlv-cs-latest.zip"
# uploads/ 是 root 所有：SFTP（ubuntu 登录）写不进去。
# 统一「先传到 ubuntu 可写的 STAGE，再用 sudo 原子改名就位」——细节见 _deploy_server_cloud.py 顶部。
STAGE = "/home/ubuntu/chunlv-stage"


def staged(remote: str) -> str:
    return STAGE + "/" + os.path.basename(remote) + ".new"


def ensure_stage(c) -> None:
    _i, o, e = c.exec_command("mkdir -p " + STAGE + " && chmod 700 " + STAGE)
    o.read()
    e.read()
UPDATE_DOWNLOAD_URL = "/api/agent/download/cs"
UPDATE_ZIP_URL = "/api/agent/download/cs-zip"

if len(sys.argv) < 2:
    print("用法: python scripts/_publish_cs_client.py <版本号，例如 1.0.20260934>")
    sys.exit(1)
VERSION = sys.argv[1].strip()


def version_key(v):
    return [int(n) for n in re.findall(r"\d+", v or "")]


def run(c, cmd, timeout=900):
    _in, out, err = c.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    if o.strip():
        print(o.strip())
    if e.strip():
        print("ERR", e.strip())
    return o


def online_version(c):
    """读线上客服端版本：客户端只在「服务端版本 > 本机版本」时才更新，
    版本号漏改就会上传成功但一台机器都不升级（看起来像没发布）。"""
    cmd = (
        "echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql "
        "-U postgres -d chunlv -t -A -c \"SELECT value #>> '{}' FROM \\\"SystemConfig\\\" "
        "WHERE key='cs.latest_version';\""
    )
    _in, out, _err = c.exec_command(cmd, timeout=60)
    return out.read().decode("utf-8", "replace").strip()


def install_watchdog_into_package():
    """把最新的 SystemHelper.exe 放进打包目录。

    少了它，客服机上装出来的看门狗是老的（或者压根没有），
    「静默更新」这套就又退回去要人点 UAC 了。
    """
    if not os.path.exists(SH):
        print("中止：缺少 apps/watchdog-service/SystemHelper.exe，先编译：cd apps/watchdog-service && go build -o SystemHelper.exe .")
        sys.exit(1)
    if not os.path.isdir(LOCAL_UNPACKED):
        print("中止：没找到 " + LOCAL_UNPACKED + "，先跑 npx electron-builder")
        sys.exit(1)
    dst = os.path.join(LOCAL_UNPACKED, "resources", "SystemHelper.exe")
    shutil.copy2(SH, dst)
    data = open(dst, "rb").read()
    tags = re.findall(rb"CHUNLV_WATCHDOG_BUILD=[0-9.]+", data)
    print("已放入打包目录:", dst, len(data), "bytes", tags)
    if not tags:
        print("中止：SystemHelper.exe 里没有构建号标记，可能放错文件了")
        sys.exit(1)


def make_zip():
    fd, local_zip = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(local_zip, "w", zipfile.ZIP_DEFLATED) as z:
            for root, _dirs, files in os.walk(LOCAL_UNPACKED):
                for name in files:
                    full = os.path.join(root, name)
                    rel = os.path.relpath(full, LOCAL_UNPACKED).replace("\\", "/")
                    z.write(full, arcname="win-unpacked/" + rel)
        return local_zip
    except Exception:
        if os.path.exists(local_zip):
            os.remove(local_zip)
        raise


def main():
    install_watchdog_into_package()

    name = "客服管理 Setup " + VERSION + ".exe"
    local_setup = os.path.join(LOCAL_RELEASE, name)
    if not os.path.exists(local_setup):
        print("中止：没找到装机包 " + local_setup + "，先跑 npx electron-builder")
        sys.exit(1)
    size_mb = round(os.path.getsize(local_setup) / 1024 / 1024, 1)

    local_zip = make_zip()
    zip_mb = round(os.path.getsize(local_zip) / 1024 / 1024, 1)

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)

    old = online_version(c)
    if version_key(VERSION) <= version_key(old):
        print("中止：要发的版本 " + VERSION + " 不大于线上 " + old + "，客服端不会更新，白传几十 MB。")
        c.close()
        os.remove(local_zip)
        sys.exit(1)
    print("线上客服端当前 " + old + " -> 本次发布 " + VERSION
          + "（装机包 " + str(size_mb) + "MB，更新整包 " + str(zip_mb) + "MB）")

    ensure_stage(c)
    sftp = c.open_sftp()
    # 先传临时文件，再原子改名，避免客服端正好在下载时拿到半个包
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN):
        sftp.put(local_setup, staged(remote))
    sftp.put(local_zip, staged(REMOTE_ZIP))
    sftp.close()
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN, REMOTE_ZIP):
        run(c, "sudo -n mv -f '" + staged(remote) + "' '" + remote + "' && sudo -n md5sum '" + remote + "' && sudo -n ls -l '" + remote + "'")
    os.remove(local_zip)

    sql = (
        "INSERT INTO \"SystemConfig\" (id, key, value) VALUES "
        "(gen_random_uuid(), 'cs.latest_version', to_jsonb('" + VERSION + "'::text)), "
        "(gen_random_uuid(), 'cs.latest_download_url', to_jsonb('" + UPDATE_DOWNLOAD_URL + "'::text)), "
        "(gen_random_uuid(), 'cs.latest_zip_url', to_jsonb('" + UPDATE_ZIP_URL + "'::text)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
    )
    fd, local_sql = tempfile.mkstemp(suffix=".sql")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(sql + "\n")
    sftp = c.open_sftp()
    sftp.put(local_sql, "/home/ubuntu/set_cs_version.sql")
    sftp.close()
    os.remove(local_sql)

    run(c, "echo " + PASSWORD + " | sudo -S -p '' docker cp /home/ubuntu/set_cs_version.sql chunlv-postgres:/tmp/set_cs_version.sql")
    run(c, "echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -f /tmp/set_cs_version.sql")
    run(c, "echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -t -c \"SELECT key,value FROM \\\"SystemConfig\\\" WHERE key IN ('cs.latest_version','cs.latest_download_url','cs.latest_zip_url') ORDER BY key;\"")

    # 发布后自检：接口必须真的能吐出版本号 + 两个下载地址，包也得下得动
    run(c, "curl -s http://127.0.0.1:3001/api/agent/cs-version")
    # 只取前 64KB 验「地址通、能下载」：整包上百兆，全下来得等好几分钟。
    run(c, "curl -s -o /dev/null -w 'download/cs -> %{http_code} %{size_download} bytes\\n' --max-time 30 -r 0-65535 http://127.0.0.1:3001/api/agent/download/cs")
    run(c, "curl -s -o /dev/null -w 'download/cs-zip -> %{http_code} %{size_download} bytes\\n' --max-time 30 -r 0-65535 http://127.0.0.1:3001/api/agent/download/cs-zip")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
