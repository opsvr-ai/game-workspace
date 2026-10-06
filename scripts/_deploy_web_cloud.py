import os
import paramiko, io, sys, os, tarfile, tempfile

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
LOCAL_DIST = r"E:\source_code\game-workspace\apps\web\dist"
# 2026-10-06 起服务端（含它托管的网页）都归 root：/apps/server/game-workspace，
# 细节见 _deploy_server_cloud.py 顶部说明（ubuntu + 免密 sudo 落地）
REMOTE_DIR = "/apps/server/game-workspace/apps/server/web-dist"
TMP_TGZ = "/home/ubuntu/chunlv-web-dist.tar.gz"


def make_tgz():
    fd, local_tgz = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    try:
        with tarfile.open(local_tgz, "w:gz") as tar:
            for root, _dirs, files in os.walk(LOCAL_DIST):
                for name in files:
                    full = os.path.join(root, name)
                    arc = os.path.relpath(full, LOCAL_DIST).replace("\\", "/")
                    tar.add(full, arcname=arc)
        return local_tgz
    except Exception:
        if os.path.exists(local_tgz):
            os.remove(local_tgz)
        raise


def main():
    local_tgz = make_tgz()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)

    sftp = c.open_sftp()
    sftp.put(local_tgz, TMP_TGZ)
    sftp.close()
    os.remove(local_tgz)

    cmd = (
        f"sudo -n bash -c 'rm -rf {REMOTE_DIR}/* && "
        f"mkdir -p {REMOTE_DIR} && "
        f"tar -xzf {TMP_TGZ} -C {REMOTE_DIR}' && "
        f"ls -la {REMOTE_DIR} && "
        f"curl -s -o /dev/null -w 'web=%{{http_code}}\\n' http://127.0.0.1:3001/ && "
        f"echo WEB_DEPLOY_OK"
    )
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    if out:
        print(out)
    if err:
        print("STDERR:", err)
    print("RC", rc)
    c.close()


if __name__ == "__main__":
    main()
