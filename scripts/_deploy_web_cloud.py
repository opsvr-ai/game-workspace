import paramiko, io, sys, os, tarfile, tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_DIST = r"E:\source_code\game-workspace\apps\web\dist"
REMOTE_DIR = "/home/ubuntu/chunlv/apps/server/web-dist"
TMP_TGZ = "/tmp/chunlv-web-dist.tar.gz"


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
        f"rm -rf {REMOTE_DIR}/* && "
        f"mkdir -p {REMOTE_DIR} && "
        f"tar -xzf {TMP_TGZ} -C {REMOTE_DIR} && "
        f"ls -la {REMOTE_DIR} && echo WEB_DEPLOY_OK"
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
