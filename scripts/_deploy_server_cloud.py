import paramiko, io, sys, os, tarfile, tempfile, hashlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_DIST = r"E:\source_code\game-workspace\apps\server\dist"
REMOTE_DIR = "/home/ubuntu/chunlv/apps/server/dist"
TMP_TGZ = "/home/ubuntu/chunlv-server-dist.tar.gz"


def dist_hash():
    """内容指纹：只要 dist 内容没变，就不用重启服务端（每次重启都会把所有客户端抖一次）。"""
    h = hashlib.sha256()
    for root, dirs, files in os.walk(LOCAL_DIST):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            arc = os.path.relpath(full, LOCAL_DIST).replace("\\", "/")
            h.update(arc.encode("utf-8"))
            with open(full, "rb") as f:
                h.update(f.read())
    return h.hexdigest()


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

    def run_raw(cmd):
        _in, out, err = c.exec_command(cmd, timeout=180)
        return out.channel.recv_exit_status(), out.read().decode("utf-8", "replace")

    def run(cmd):
        _in, out, err = c.exec_command(cmd, timeout=180)
        o = out.read().decode("utf-8", "replace")
        e = err.read().decode("utf-8", "replace")
        rc = out.channel.recv_exit_status()
        if o:
            print(o)
        if e:
            print("STDERR:", e)
        return rc

    force = "--force" in sys.argv
    local_hash = dist_hash()
    skip = False
    if not force:
        rc, remote_hash = run_raw(f"cat {REMOTE_DIR}/.deploy-hash 2>/dev/null || true")
        if remote_hash.strip() == local_hash:
            skip = True
    if skip:
        c.close()
        print(f"dist 内容没变（{local_hash[:12]}），跳过重启，不动正在连着的客户端")
        print("done")
        return

    run(f"rm -rf {REMOTE_DIR}/* && mkdir -p {REMOTE_DIR} && tar -xzf {TMP_TGZ} -C {REMOTE_DIR}")
    run(f"echo {local_hash} > {REMOTE_DIR}/.deploy-hash")
    run("pm2 restart chunlv-server --update-env")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
