"""上传看门狗（SystemHelper.exe）到云端，供全网自更新下载。

上传前有一道硬闸门：文件里「构建号标记」必须只有一处、且后面紧跟数字。
2026-10-01 事故：源码里那半截「标记常量」排在真标记前面、后面不是数字，
老看门狗只认第一个标记，于是永远认为「云端那份没带构建号」，全网从来没自己升过级。
"""
import hashlib
import io
import sys

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "1.117.229.36"
USER = "ubuntu"
PASSWORD = "Pw123456!"
LOCAL = "apps/watchdog-service/SystemHelper.exe"
REMOTE = "/home/ubuntu/chunlv/uploads/SystemHelper.exe"
MARKER = b"CHUNLV_WATCHDOG_BUILD="

def check_old_parser_readable(data: bytes) -> int:
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
    if data[:2] != b"MZ":
        print("!! 拒绝上传：不是 PE 文件")
        return 1
    if not good or hits[0] != good[0]:
        print("!! 拒绝上传：构建号标记不是第一处或为空，老版本看门狗会读不到、升不上来 ->", hits)
        return 1
    print("构建号自检通过（老版本看门狗也能读懂）:", good[0], "标记处数:", len(hits))
    return 0


def main() -> int:
    data = open(LOCAL, "rb").read()
    print("local_size", len(data), "md5", hashlib.md5(data).hexdigest())
    if check_old_parser_readable(data) != 0:
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False, timeout=30)
    s = c.open_sftp()
    s.put(LOCAL, REMOTE + ".new")
    s.close()

    def run(cmd):
        _i, o, e = c.exec_command(cmd, timeout=180)
        return o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip()

    print(run("md5sum %s.new && sudo -n mv -f %s.new %s && md5sum %s && ls -la %s" % (REMOTE, REMOTE, REMOTE, REMOTE, REMOTE)))
    print(run("curl -s -o /dev/null -w '%{http_code} %{size_download}' http://127.0.0.1:3001/uploads/SystemHelper.exe"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
