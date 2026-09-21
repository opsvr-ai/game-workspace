import paramiko, io, sys, os, re, zipfile, tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_UNPACKED = r"E:\source_code\game-workspace\apps\companion-electron\release\win-unpacked"
REMOTE_ZIP = "/home/ubuntu/chunlv/uploads/chunlv-latest.zip"
REMOTE_ZIP_TMP = REMOTE_ZIP + ".new"
LOCAL_RELEASE = r"E:\source_code\game-workspace\apps\companion-electron\release"
REMOTE_SETUP = "/home/ubuntu/chunlv/uploads/agent-setup.exe"
REMOTE_SETUP_CN = "/home/ubuntu/chunlv/uploads/陪玩管理-Setup.exe"
# 自动更新包必须走服务端限速接口：直链 /uploads/xxx.zip 是全速下发，
# 一台机器下载就会把办公室那条网占满，别的陪玩接口请求超时（看起来像掉线）。
UPDATE_DOWNLOAD_URL = "/api/agent/download/latest"
if len(sys.argv) < 2:
    print("用法: python scripts/_publish_client.py <版本号，例如 1.0.20260925>")
    sys.exit(1)
VERSION = sys.argv[1].strip()


def version_key(v):
    return [int(n) for n in re.findall(r"\d+", v or "")]


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


def upload_setup(c):
    """装机包（NSIS 安装器）必须跟自动更新包一起发。

    新电脑走 /api/agent/download/exe 拿安装包，而它读的就是 uploads/agent-setup.exe。
    2026-09-21 踩过：只发了更新包没换装机包，结果新装的机器一上来就是旧版本。
    """
    name = f"陪玩管理 Setup {VERSION}.exe"
    local = os.path.join(LOCAL_RELEASE, name)
    if not os.path.exists(local):
        print(f"!! 未找到装机包 {name}，装机包保持原样（先跑 electron-builder --win）")
        return
    sftp = c.open_sftp()
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN):
        sftp.put(local, remote + ".new")
    sftp.close()
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN):
        _in, out, err = c.exec_command(f"mv -f '{remote}.new' '{remote}' && md5sum '{remote}'")
        print(out.read().decode("utf-8", "replace").strip())
        e = err.read().decode("utf-8", "replace").strip()
        if e:
            print("ERR", e)
    print("uploaded setup installer:", name)


def online_version(c):
    """读线上当前版本：客户端只在「服务端版本 > 本机版本」时才更新，
    版本号漏改就会上传成功但一台机器都不升级（看起来像没发布）。"""
    cmd = (
        "echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql "
        "-U postgres -d chunlv -t -A -c \"SELECT value #>> '{}' FROM \\\"SystemConfig\\\" "
        "WHERE key='agent.latest_version';\""
    )
    _in, out, _err = c.exec_command(cmd, timeout=60)
    return out.read().decode("utf-8", "replace").strip()


def main():
    local_zip = make_zip()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)

    old = online_version(c)
    if version_key(VERSION) <= version_key(old):
        print(f"中止：要发的版本 {VERSION} 不大于线上 {old}，客户端不会更新，白传 128MB。")
        c.close()
        os.remove(local_zip)
        sys.exit(1)
    print(f"线上当前 {old} -> 本次发布 {VERSION}")

    sftp = c.open_sftp()
    # 先传到临时文件，再原子改名，避免陪玩端正好在下载时拿到半个包
    sftp.put(local_zip, REMOTE_ZIP_TMP)
    sftp.close()
    # 用 shell 的 mv -f 改名（SFTP rename 在目标已存在时会失败）
    _in, out, err = c.exec_command(f"mv -f {REMOTE_ZIP_TMP} {REMOTE_ZIP} && md5sum {REMOTE_ZIP}")
    print(out.read().decode("utf-8", "replace").strip())
    if err.read().decode("utf-8", "replace").strip():
        print("ERR", err)
    os.remove(local_zip)
    print("uploaded", REMOTE_ZIP)

    upload_setup(c)

    sql = (
        "INSERT INTO \"SystemConfig\" (id, key, value) VALUES "
        "(gen_random_uuid(), 'agent.latest_version', to_jsonb('" + VERSION + "'::text)), "
        "(gen_random_uuid(), 'agent.latest_download_url', to_jsonb('" + UPDATE_DOWNLOAD_URL + "'::text)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
    )
    fd, local_sql = tempfile.mkstemp(suffix=".sql")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(sql + "\n")
    sftp = c.open_sftp()
    sftp.put(local_sql, "/home/ubuntu/set_client_version.sql")
    sftp.close()
    os.remove(local_sql)

    def run(cmd):
        _in, out, err = c.exec_command(cmd, timeout=120)
        o = out.read().decode("utf-8", "replace")
        e = err.read().decode("utf-8", "replace")
        if o:
            print(o)
        if e:
            print("ERR", e)

    run(f"echo {PASSWORD} | sudo -S -p '' docker cp /home/ubuntu/set_client_version.sql chunlv-postgres:/tmp/set_client_version.sql")
    run(f"echo {PASSWORD} | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -f /tmp/set_client_version.sql")
    run("echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -t -c \"SELECT key,value FROM \\\"SystemConfig\\\" WHERE key IN ('agent.latest_version','agent.latest_download_url') ORDER BY key;\"")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
