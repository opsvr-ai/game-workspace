import paramiko, io, sys, os, re, tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_RELEASE = r"E:\source_code\game-workspace\apps\cs-electron\release"
REMOTE_SETUP = "/home/ubuntu/chunlv/uploads/agent-cs-setup.exe"
REMOTE_SETUP_CN = "/home/ubuntu/chunlv/uploads/客服管理-Setup.exe"
# 客服端自动更新走服务端接口，不直接给 /uploads 直链。
UPDATE_DOWNLOAD_URL = "/api/agent/download/cs"

if len(sys.argv) < 2:
    print("用法: python scripts/_publish_cs_client.py <版本号，例如 1.0.20260927>")
    sys.exit(1)
VERSION = sys.argv[1].strip()


def version_key(v):
    return [int(n) for n in re.findall(r"\d+", v or "")]


def run(c, cmd, timeout=180):
    _in, out, err = c.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    if o.strip():
        print(o.strip())
    if e.strip():
        print("ERR", e.strip())


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


def main():
    name = f"客服管理 Setup {VERSION}.exe"
    local = os.path.join(LOCAL_RELEASE, name)
    if not os.path.exists(local):
        print(f"中止：没找到装机包 {local}，先跑 npx electron-builder")
        sys.exit(1)
    size_mb = round(os.path.getsize(local) / 1024 / 1024, 1)

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)

    old = online_version(c)
    if version_key(VERSION) <= version_key(old):
        print(f"中止：要发的版本 {VERSION} 不大于线上 {old}，客服端不会更新，白传 77MB。")
        c.close()
        sys.exit(1)
    print(f"线上客服端当前 {old} -> 本次发布 {VERSION}（装机包 {size_mb}MB）")

    sftp = c.open_sftp()
    # 先传临时文件，再原子改名，避免客服端正好在下载时拿到半个包
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN):
        sftp.put(local, remote + ".new")
    sftp.close()
    for remote in (REMOTE_SETUP, REMOTE_SETUP_CN):
        run(c, f"mv -f '{remote}.new' '{remote}' && md5sum '{remote}' && ls -l '{remote}'")

    sql = (
        "INSERT INTO \"SystemConfig\" (id, key, value) VALUES "
        "(gen_random_uuid(), 'cs.latest_version', to_jsonb('" + VERSION + "'::text)), "
        "(gen_random_uuid(), 'cs.latest_download_url', to_jsonb('" + UPDATE_DOWNLOAD_URL + "'::text)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
    )
    fd, local_sql = tempfile.mkstemp(suffix=".sql")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(sql + "\n")
    sftp = c.open_sftp()
    sftp.put(local_sql, "/home/ubuntu/set_cs_version.sql")
    sftp.close()
    os.remove(local_sql)

    run(c, f"echo {PASSWORD} | sudo -S -p '' docker cp /home/ubuntu/set_cs_version.sql chunlv-postgres:/tmp/set_cs_version.sql")
    run(c, f"echo {PASSWORD} | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -f /tmp/set_cs_version.sql")
    run(c, "echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -t -c \"SELECT key,value FROM \\\"SystemConfig\\\" WHERE key IN ('cs.latest_version','cs.latest_download_url') ORDER BY key;\"")
    c.close()
    print("done")


if __name__ == "__main__":
    main()
