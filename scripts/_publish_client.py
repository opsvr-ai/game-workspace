import paramiko, io, sys, os, zipfile, tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL_UNPACKED = r"E:\source_code\game-workspace\apps\companion-electron\release\win-unpacked"
REMOTE_ZIP = "/home/ubuntu/chunlv/uploads/chunlv-latest.zip"
REMOTE_ZIP_TMP = REMOTE_ZIP + ".new"
VERSION = sys.argv[1] if len(sys.argv) > 1 else "1.0.20260875"


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
    local_zip = make_zip()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=60)

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

    sql = (
        "INSERT INTO \"SystemConfig\" (id, key, value) VALUES "
        "(gen_random_uuid(), 'agent.latest_version', to_jsonb('" + VERSION + "'::text)), "
        "(gen_random_uuid(), 'agent.latest_download_url', to_jsonb('/uploads/chunlv-latest.zip'::text)) "
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
