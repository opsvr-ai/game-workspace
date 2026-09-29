import paramiko, io, sys, os, tarfile, tempfile, hashlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_DIST = r"E:\source_code\game-workspace\apps\server\dist"
REMOTE_DIR = "/home/ubuntu/chunlv/apps/server/dist"
TMP_TGZ = "/home/ubuntu/chunlv-server-dist.tar.gz"
# 服务端 dist 里 `require('@chunlv/shared')` 是走 apps/server/node_modules/@chunlv/shared
# 软链到 packages/shared 的 —— 所以 **shared 的 dist 也必须一起传**。
# 2026-09-29 就这么翻过一次车：新加的 PoolScope 只在本地 dist 里，线上还是 9/19 的旧
# shared，`PoolScope.ONLINE_FIRST` 直接 undefined，发单接口 500。
# 以后加 / 改 shared 的东西（枚举、类型）只要改了这里的指纹就会重新推 + 重启。
LOCAL_SHARED_DIST = r"E:\source_code\game-workspace\packages\shared\dist"
REMOTE_SHARED_DIR = "/home/ubuntu/chunlv/packages/shared/dist"
TMP_SHARED_TGZ = "/home/ubuntu/chunlv-shared-dist.tar.gz"
LOCAL_SCHEMA = r"E:\source_code\game-workspace\apps\server\prisma\schema.prisma"
REMOTE_SCHEMA = "/home/ubuntu/chunlv/apps/server/prisma/schema.prisma"
REMOTE_SCHEMA_HASH = "/home/ubuntu/chunlv/apps/server/prisma/.schema-hash"


def dist_hash():
    """内容指纹：只要 dist 内容没变，就不用重启服务端（每次重启都会把所有客户端抖一次）。
    server dist + shared dist 一起算：shared 变了同样要重新推、重新生成/重启。"""
    h = hashlib.sha256()
    for base, tag in ((LOCAL_DIST, "server"), (LOCAL_SHARED_DIST, "shared")):
        if not os.path.isdir(base):
            raise SystemExit(f"{tag} dist 不存在（{base}）—— 先在本地 pnpm build 再部署")
        for root, dirs, files in os.walk(base):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(root, name)
                arc = os.path.relpath(full, base).replace("\\", "/")
                h.update(f"{tag}/{arc}".encode("utf-8"))
                with open(full, "rb") as f:
                    h.update(f.read())
    return h.hexdigest()


def make_tgz(src_dir):
    fd, local_tgz = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    try:
        with tarfile.open(local_tgz, "w:gz") as tar:
            for root, _dirs, files in os.walk(src_dir):
                for name in files:
                    full = os.path.join(root, name)
                    arc = os.path.relpath(full, src_dir).replace("\\", "/")
                    tar.add(full, arcname=arc)
        return local_tgz
    except Exception:
        if os.path.exists(local_tgz):
            os.remove(local_tgz)
        raise


def schema_hash():
    """schema.prisma 的指纹：变了就必须重新生成 Prisma 客户端，否则线上会报
    「Unknown field xxx for select statement」——2026-09-26 加 User.resignedAt 时就这么翻过一次车。"""
    with open(LOCAL_SCHEMA, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    local_tgz = make_tgz(LOCAL_DIST)
    local_shared_tgz = make_tgz(LOCAL_SHARED_DIST)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)
    sftp = c.open_sftp()
    sftp.put(local_tgz, TMP_TGZ)
    sftp.put(local_shared_tgz, TMP_SHARED_TGZ)
    sftp.close()
    os.remove(local_tgz)
    os.remove(local_shared_tgz)

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
    local_schema_hash = schema_hash()
    skip = False
    if not force:
        rc, remote_hash = run_raw(f"cat {REMOTE_DIR}/.deploy-hash 2>/dev/null || true")
        rc, remote_schema_hash = run_raw(f"cat {REMOTE_SCHEMA_HASH} 2>/dev/null || true")
        if remote_hash.strip() == local_hash and remote_schema_hash.strip() == local_schema_hash:
            skip = True
    if skip:
        c.close()
        print(f"dist 内容没变（{local_hash[:12]}），跳过重启，不动正在连着的客户端")
        print("done")
        return

    run(f"rm -rf {REMOTE_DIR}/* && mkdir -p {REMOTE_DIR} && tar -xzf {TMP_TGZ} -C {REMOTE_DIR}")
    run(f"echo {local_hash} > {REMOTE_DIR}/.deploy-hash")
    # shared 包（@chunlv/shared）的 dist：server dist 是软链到 packages/shared 的，必须一起换
    run(f"rm -rf {REMOTE_SHARED_DIR}/* && mkdir -p {REMOTE_SHARED_DIR} && tar -xzf {TMP_SHARED_TGZ} -C {REMOTE_SHARED_DIR}")
    print("shared dist 已同步")

    # schema 变了要单独同步 + 重新生成客户端（Prisma 客户端是构建产物，不在 dist 里）
    rc, remote_schema_hash_now = run_raw(f"cat {REMOTE_SCHEMA_HASH} 2>/dev/null || true")
    if force or remote_schema_hash_now.strip() != local_schema_hash:
        sftp = c.open_sftp()
        sftp.put(LOCAL_SCHEMA, REMOTE_SCHEMA)
        sftp.close()
        gen_rc = run("cd /home/ubuntu/chunlv/apps/server && ./node_modules/.bin/prisma generate 2>&1 | tail -3")
        if gen_rc != 0:
            c.close()
            raise SystemExit("prisma generate 失败，已中止部署（不重启，避免线上带着旧客户端跑）")
        run(f"echo {local_schema_hash} > {REMOTE_SCHEMA_HASH}")
        print(f"schema 已同步并重新生成 Prisma 客户端（{local_schema_hash[:12]}）")

    run("pm2 restart chunlv-server --update-env")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
