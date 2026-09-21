import paramiko, io, sys, tempfile, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
VERSION = sys.argv[1] if len(sys.argv) > 1 else "v522"

sql = (
    "INSERT INTO \"SystemConfig\" (id, key, value) "
    "VALUES (gen_random_uuid(), 'web.frontend_version', to_jsonb('" + VERSION + "'::text)) "
    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=30)

def run(cmd):
    _in, out, err = c.exec_command(cmd, timeout=60)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    rc = out.channel.recv_exit_status()
    if o:
        print(o)
    if e:
        print("ERR", e)
    return rc

# Write SQL file locally, upload it, docker cp into container, then psql -f.
fd, local_sql = tempfile.mkstemp(suffix=".sql")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(sql + "\n")
sftp = c.open_sftp()
sftp.put(local_sql, "/home/ubuntu/set_web_version.sql")
sftp.close()
os.remove(local_sql)

run(f"echo {PASSWORD} | sudo -S -p '' docker cp /home/ubuntu/set_web_version.sql chunlv-postgres:/tmp/set_web_version.sql")
run(f"echo {PASSWORD} | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -f /tmp/set_web_version.sql")
run("echo " + PASSWORD + " | sudo -S -p '' docker exec chunlv-postgres psql -U postgres -d chunlv -t -c \"SELECT key,value FROM \\\"SystemConfig\\\" WHERE key='web.frontend_version';\"")
c.close()
print("done")
