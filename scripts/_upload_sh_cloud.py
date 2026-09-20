import paramiko, io, sys, hashlib
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
HOST="1.117.229.36"; USER="ubuntu"; PASSWORD="Pw123456!"
LOCAL=r"apps/watchdog-service/SystemHelper.exe"
REMOTE="/home/ubuntu/chunlv/uploads/SystemHelper.exe"
data=open(LOCAL,"rb").read()
print("local_size",len(data),"md5",hashlib.md5(data).hexdigest())
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PASSWORD,look_for_keys=False,allow_agent=False,timeout=30)
s=c.open_sftp(); s.put(LOCAL,REMOTE+".new"); s.close()
def run(cmd):
    _,o,e=c.exec_command(cmd,timeout=180)
    return o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip()
print(run("md5sum %s.new && sudo -n mv -f %s.new %s && md5sum %s && ls -la %s" % (REMOTE,REMOTE,REMOTE,REMOTE,REMOTE)))
print(run("curl -s -o /dev/null -w '%{http_code} %{size_download}' http://127.0.0.1:3001/uploads/SystemHelper.exe"))
c.close()
