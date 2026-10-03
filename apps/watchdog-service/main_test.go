package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// useTempSignalDir 把看门狗那几个状态文件挪到临时目录，别去动本机 C:\ProgramData\chunlv。
// 单测跑在开发机上，而这台机器本身就装着陪玩端（老板自己在用）：
// 这里直接把「真去杀客户端进程」这条路关掉，免得跑一次单测就把人家的客户端打断。
func init() { atomic.StoreInt32(&processKillDisabled, 1) }

func useTempSignalDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	updateSignalDir = dir
	updateSignalFile = filepath.Join(dir, "update.json")
	pendingUpdateFile = filepath.Join(dir, "pending-update.json")
	healthyFile = filepath.Join(dir, "client-healthy.json")
	blockedFile = filepath.Join(dir, "blocked-versions.json")
	preferredClientFile = filepath.Join(dir, "preferred-client.json")
	// 本机身份记录也要落到临时目录：测试绝不能去动 C:\ProgramData\chunlv 里的真文件。
	clientKindFile = filepath.Join(dir, "watchdog-client.txt")
	cloudStampFile = filepath.Join(dir, "watchdog-cloud.json")
	cloudSkipFile = filepath.Join(dir, "watchdog-no-selfupdate")
	cloudExeFile = filepath.Join(dir, "SystemHelper-cloud.exe")
	// 云端自更新的限流时钟也从零开始：测试里绝不去碰真的云端地址。
	atomic.StoreInt64(&lastCloudCheck, time.Now().UnixNano())
	// 远程任务的限流时钟同理：单测绝不去碰真服务器、也绝不真去执行任务。
	atomic.StoreInt64(&lastRemoteTick, time.Now().UnixNano())
	cachedMachineID = ""
	cachedMachineIDAt = 0
	// 测试里绝不去下整包、也绝不真去杀客户端。
	atomic.StoreInt64(&repairLastTry, time.Now().UnixNano())
	atomic.StoreInt64(&lastDiagMs, time.Now().UnixNano())
	return dir
}

// cloudSelfUpdateCheck 是「能自己把自己换掉」的入口，越权一点就成灾：
// 这里钉死三条 —— 刚启动不乱来、本机被人工关掉要听话、正在装客户端更新时不许插队。
// 三个分支都在下载之前就返回，所以这条测试不会碰网络、更不会碰真服务本体。
func TestCloudSelfUpdateNeverFiresWithoutAClearGreenLight(t *testing.T) {
	dir := useTempSignalDir(t)

	// ① 刚启动（3 分钟内）：跳过。
	cloudSelfUpdateCheck()
	if _, err := os.Stat(cloudStampFile); err == nil {
		t.Fatal("刚启动就问云端了，应该先等 cloudFirstCheckDelay")
	}

	// ② 到点了，但本机放着「关掉自更新」的文件：必须听话。
	if err := os.WriteFile(cloudSkipFile, []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}
	atomic.StoreInt64(&lastCloudCheck, time.Now().Add(-2*cloudCheckInterval).UnixNano())
	cloudSelfUpdateCheck()
	if _, err := os.Stat(cloudExeFile); err == nil {
		t.Fatal("有 watchdog-no-selfupdate 时不该去下载新的看门狗")
	}

	// ③ 正在给客户端装更新（update.json 还在）：不许插队重启服务。
	_ = os.Remove(cloudSkipFile)
	if err := os.WriteFile(updateSignalFile, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	atomic.StoreInt64(&lastCloudCheck, time.Now().Add(-2*cloudCheckInterval).UnixNano())
	cloudSelfUpdateCheck()
	if _, err := os.Stat(cloudExeFile); err == nil {
		t.Fatal("装客户端更新期间不该动看门狗")
	}
	_ = os.Remove(updateSignalFile)

	// ④ 有一份更新还没验证完（pending-update.json）：同样不许插队。
	if err := os.WriteFile(pendingUpdateFile, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	atomic.StoreInt64(&lastCloudCheck, time.Now().Add(-2*cloudCheckInterval).UnixNano())
	cloudSelfUpdateCheck()
	if _, err := os.Stat(cloudExeFile); err == nil {
		t.Fatal("更新还没验证完，不该动看门狗")
	}
	_ = os.Remove(pendingUpdateFile)
	_ = dir
}

// writeFakePackage 造一个和真实更新包结构一致的 zip：win-unpacked/ 前缀 + 客户端 exe + resources/app.asar。
func writeFakePackage(t *testing.T, path string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	add := func(name string, size int, fill byte) {
		entry, err := w.Create("win-unpacked/" + name)
		if err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, size)
		for i := range buf {
			buf[i] = fill
		}
		if _, err := entry.Write(buf); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 12; i++ {
		add("data"+string(rune('a'+i))+".pak", 1024, byte(i))
	}
	add("locales/zh-CN.pak", 4096, 7)
	add("resources/app.asar", 2<<20, 9)
	add(clientExeNames[0], 11<<20, 5)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestExtractZipToRejectsMissingEntry(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "pkg.zip")
	writeFakePackage(t, zipPath)
	staging := filepath.Join(dir, "staging")
	if err := extractZipTo(zipPath, staging); err != nil {
		t.Fatalf("extract failed: %v", err)
	}
	if _, err := verifyStagingDir(staging); err != nil {
		t.Fatalf("staged dir should verify: %v", err)
	}
	// 半截包（只有一个文件）必须被判成不可用，而不是「装好了」。
	bad := filepath.Join(dir, "bad.zip")
	f, _ := os.Create(bad)
	w := zip.NewWriter(f)
	e, _ := w.Create("win-unpacked/a.txt")
	e.Write([]byte("x"))
	w.Close()
	f.Close()
	if _, err := verifyStagingDir(filepath.Join(dir, "nope")); err == nil {
		t.Fatal("verifyStagingDir should fail for a dir without a client exe")
	}
	if err := extractZipTo(bad, filepath.Join(dir, "staging2")); err == nil {
		t.Fatal("a package with a single file must not be accepted")
	}
}

func TestApplyUpdateAtomicSwapsAndKeepsBackup(t *testing.T) {
	sigDir := useTempSignalDir(t)
	zipPath := filepath.Join(sigDir, "update.zip")
	writeFakePackage(t, zipPath)

	root := t.TempDir()
	destDir := filepath.Join(root, "陪玩管理")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	oldExe := filepath.Join(destDir, clientExeNames[0])
	if err := os.WriteFile(oldExe, []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	exe, err := applyUpdateAtomic(destDir, zipPath, "9.9.9")
	if err != nil {
		t.Fatalf("applyUpdateAtomic failed: %v", err)
	}
	if filepath.Dir(exe) != destDir {
		t.Fatalf("new exe landed in wrong dir: %s", exe)
	}
	if _, err := os.Stat(filepath.Join(destDir, "resources", "app.asar")); err != nil {
		t.Fatalf("new install is incomplete: %v", err)
	}
	var p pendingUpdate
	if !readJSONFile(pendingUpdateFile, &p) {
		t.Fatal("pending-update.json not written")
	}
	if p.BackupDir == "" || p.Version != "9.9.9" {
		t.Fatalf("pending record wrong: %+v", p)
	}
	if data, err := os.ReadFile(filepath.Join(p.BackupDir, clientExeNames[0])); err != nil || string(data) != "OLD" {
		t.Fatalf("previous install was not kept as a backup: %v %q", err, string(data))
	}
	// 备份目录绝不能被 findClient 当成客户端目录，否则会去拉旧版。
	if !isSkippableDir(filepath.Base(p.BackupDir)) {
		t.Fatalf("backup dir %s must be skipped by findClient", p.BackupDir)
	}
}

func TestApplyUpdateAtomicKeepsInstallWhenPackageIsBroken(t *testing.T) {
	sigDir := useTempSignalDir(t)
	broken := filepath.Join(sigDir, "update.zip")
	if err := os.WriteFile(broken, []byte("this is not a zip"), 0644); err != nil {
		t.Fatal(err)
	}
	destDir := filepath.Join(t.TempDir(), "陪玩管理")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(destDir, "still-here.txt")
	if err := os.WriteFile(marker, []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := applyUpdateAtomic(destDir, broken, "9.9.9"); err == nil {
		t.Fatal("broken package must not be reported as a successful update")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("current install was touched although the update failed: %v", err)
	}
	if readJSONFile(pendingUpdateFile, &pendingUpdate{}) {
		t.Fatal("no pending record should exist when the update failed")
	}
}

func TestCheckUpdateHealthRollsBackAndBlocksVersion(t *testing.T) {
	sigDir := useTempSignalDir(t)
	zipPath := filepath.Join(sigDir, "update.zip")
	writeFakePackage(t, zipPath)

	destDir := filepath.Join(t.TempDir(), "陪玩管理")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	oldExe := filepath.Join(destDir, clientExeNames[0])
	if err := os.WriteFile(oldExe, []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := applyUpdateAtomic(destDir, zipPath, "9.9.9"); err != nil {
		t.Fatal(err)
	}

	// 第一次：本机还没见过健康标记 → 绝不乱回滚，只把时限往后挪。
	checkUpdateHealth()
	if _, err := os.Stat(filepath.Join(destDir, "resources", "app.asar")); err != nil {
		t.Fatal("must not roll back before the health mechanism is trusted")
	}

	// 机制可信之后（客户端自己写过标记），超时没等到标记 → 整目录回滚 + 拉黑这个版本。
	atomic.StoreInt32(&healthTrusted, 1)
	if err := os.WriteFile(healthyFile, []byte(`{"version":"9.9.9","exePath":"","at":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	var p pendingUpdate
	readJSONFile(pendingUpdateFile, &p)
	p.Deadline = time.Now().Add(-time.Minute).UnixMilli()
	if err := writeJSONFile(pendingUpdateFile, p); err != nil {
		t.Fatal(err)
	}
	checkUpdateHealth()

	if data, err := os.ReadFile(oldExe); err != nil || string(data) != "OLD" {
		t.Fatalf("previous client was not restored: %v %q", err, string(data))
	}
	if _, err := os.Stat(filepath.Join(destDir, "resources", "app.asar")); err == nil {
		t.Fatal("broken install is still in place after rollback")
	}
	if !isVersionBlocked("9.9.9") {
		t.Fatal("the version that broke this machine must be blocked")
	}
	if readJSONFile(pendingUpdateFile, &pendingUpdate{}) {
		t.Fatal("pending record must be cleared after a rollback")
	}
}

func TestCheckUpdateHealthAcceptsHealthyMarker(t *testing.T) {
	sigDir := useTempSignalDir(t)
	zipPath := filepath.Join(sigDir, "update.zip")
	writeFakePackage(t, zipPath)

	destDir := filepath.Join(t.TempDir(), "陪玩管理")
	if _, err := applyUpdateAtomic(destDir, zipPath, "9.9.9"); err != nil {
		t.Fatal(err)
	}
	var p pendingUpdate
	readJSONFile(pendingUpdateFile, &p)
	if err := writeJSONFile(healthyFile, clientHealth{
		Version: "9.9.9", ExePath: p.ExePath, At: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	checkUpdateHealth()
	if readJSONFile(pendingUpdateFile, &pendingUpdate{}) {
		t.Fatal("a healthy client must close the pending record")
	}
	if p.BackupDir != "" {
		if _, err := os.Stat(p.BackupDir); err == nil {
			t.Fatal("backup should be dropped once the new client proved healthy")
		}
	}
	if _, err := os.Stat(filepath.Join(destDir, "resources", "app.asar")); err != nil {
		t.Fatal("healthy install must stay in place")
	}
}

func TestBlockedVersionRoundTrip(t *testing.T) {
	useTempSignalDir(t)
	if isVersionBlocked("1.0.1") {
		t.Fatal("nothing should be blocked yet")
	}
	blockVersion("1.0.1", "unit test")
	if !isVersionBlocked("1.0.1") {
		t.Fatal("blocked version not remembered")
	}
	if isVersionBlocked("1.0.2") || isVersionBlocked("") {
		t.Fatal("only the exact bad version may be blocked")
	}
}

func TestIsSkippableDir(t *testing.T) {
	for _, name := range []string{".chunlv-new-20260923-221600", "陪玩管理.bak-20260923-221600", ".chunlv-broken-1"} {
		if !isSkippableDir(name) {
			t.Fatalf("%s must be skipped", name)
		}
	}
	for _, name := range []string{"陪玩管理", "蠢驴电竞", "@chunlvcompanion-electron"} {
		if isSkippableDir(name) {
			t.Fatalf("%s must not be skipped", name)
		}
	}
	if !strings.Contains(filepath.Join("a", "b.bak-1"), ".bak-") {
		t.Fatal("sanity")
	}
}

// 客服端上了看门狗之后，一台机器上可能同时留着陪玩端和客服端两份客户端
// （客服机常见：以前装过陪玩端没删干净）。看门狗必须先认「本机身份」，
// 否则客服机上的看门狗会去守陪玩端，甚至把客服端的更新包解压进陪玩端目录。
func TestClientKindDecidesWhoIsWatched(t *testing.T) {
	useTempSignalDir(t)

	// 没写过身份的老机器：保持原样，先认陪玩端
	if got := orderedClientExeNames()[0]; got != "陪玩管理.exe" {
		t.Fatalf("default must watch the companion client first, got %s", got)
	}
	if got := orderedSearchPaths()[0]; !strings.Contains(got, "陪玩管理.exe") {
		t.Fatalf("default path order must start with the companion, got %s", got)
	}

	// 客服机：先认客服端
	writeClientKind(clientKindCs)
	if got := orderedClientExeNames()[0]; got != csExeName {
		t.Fatalf("cs machine must watch %s first, got %s", csExeName, got)
	}
	if got := orderedSearchPaths()[0]; !strings.Contains(got, csExeName) {
		t.Fatalf("cs path order must start with the CS client, got %s", got)
	}
	// 兜底不能丢：身份写的是客服端、这台机器上却没装客服端时，还得能管回陪玩端
	if len(orderedSearchPaths()) != len(companionSearchPaths)+len(csSearchPaths) {
		t.Fatalf("both path lists must survive, got %d", len(orderedSearchPaths()))
	}
	if len(orderedClientExeNames()) != len(clientExeNames) {
		t.Fatal("both exe names must survive")
	}

	// 陪玩机显式写身份
	writeClientKind(clientKindCompanion)
	if got := orderedClientExeNames()[0]; got != "陪玩管理.exe" {
		t.Fatalf("companion machine must watch the companion client, got %s", got)
	}
}

func TestClientKindFromInstallArgs(t *testing.T) {
	useTempSignalDir(t)
	old := os.Args
	defer func() { os.Args = old }()
	os.Args = []string{"SystemHelper.exe", "install", "--client=cs"}
	writeClientKindFromArgs()
	if readClientKind() != clientKindCs {
		t.Fatalf("install --client=cs must be remembered, got %q", readClientKind())
	}
	os.Args = []string{"SystemHelper.exe", "install", "--client=陪玩端"}
	writeClientKindFromArgs()
	if readClientKind() != clientKindCs {
		t.Fatal("nonsense values must not overwrite the recorded kind")
	}
}

func TestIsCsClient(t *testing.T) {
	for _, p := range []string{
		`C:\Program Files\客服管理\客服管理.exe`,
		`C:\Program Files\@chunlvcs-electron\客服管理.exe`,
		`C:\Program Files\@chunlvcs-electron`,
		`C:\Program Files\客服管理`,
	} {
		if !isCsClient(p) {
			t.Fatalf("%s must be recognized as the CS client", p)
		}
	}
	for _, p := range []string{
		"",
		`C:\Program Files\陪玩管理\陪玩管理.exe`,
		`C:\Program Files\@chunlvcompanion-electron`,
		`C:\Program Files\蠢驴电竞`,
	} {
		if isCsClient(p) {
			t.Fatalf("%s must not be treated as the CS client", p)
		}
	}
	// 两种客户端的更新包绝不能混：装错会把别人的客户端换上来
	if cloudClientZipFor(csExeName) != cloudCsZipURL {
		t.Fatal("cs client must pull the CS package")
	}
	if cloudClientZipFor("陪玩管理.exe") != cloudCompanionZipURL {
		t.Fatal("companion client must pull the companion package")
	}
	if defaultClientDir(csExeName) != `C:\Program Files\客服管理` {
		t.Fatalf("cs default dir wrong: %s", defaultClientDir(csExeName))
	}
	if localUpdateZipName(csExeName) == localUpdateZipName("陪玩管理.exe") {
		t.Fatal("local package names must differ between the two clients")
	}
}

func TestAltInstallDirNaming(t *testing.T) {
	parent := t.TempDir()
	if got, want := altInstallDir(filepath.Join(parent, "陪玩管理"), "1.0.20260932"), filepath.Join(parent, "陪玩管理-v1.0.20260932"); got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	// 已经是并排装的那一份时，下一版必须还是同一层的兄弟目录，不能越套越深。
	if got, want := altInstallDir(filepath.Join(parent, "陪玩管理-v1.0.20260932"), "1.0.20260933"), filepath.Join(parent, "陪玩管理-v1.0.20260933"); got != want {
		t.Fatalf("side-by-side dir must not nest: got %s want %s", got, want)
	}
	// 版本号拿不到（老信号里可能没有）也得有个能用的目录名。
	if got := altInstallDir(filepath.Join(parent, "客服管理"), ""); !strings.HasPrefix(got, filepath.Join(parent, "客服管理-v")) {
		t.Fatalf("empty version should fall back to a timestamp: %s", got)
	}
	name := filepath.Base(altInstallDir(filepath.Join(parent, "陪玩管理"), "1.0.20260932"))
	if !isClientDirName(name) {
		t.Fatalf("%s must be recognized as one of our client dirs", name)
	}
	if isSkippableDir(name) {
		t.Fatalf("%s must not be skipped by findClient", name)
	}
}

// 2026-09-30：8 台陪玩机上「整个安装目录改名」永远被拒（Access is denied），
// 老流程卡在「把旧目录改名让位」这一步反复失败 → 客户端永远停在老版本（60930/60931）。
// 现在的兜底：装到旁边的「陪玩管理-v<版本>」目录 + preferred-client.json 指过去，
// 旧目录一个字节都不动 —— 而且这一步天然可回滚（删指针即可）。
func TestSideBySideInstallWhenInstallDirCannotBeMoved(t *testing.T) {
	useTempSignalDir(t)
	work := t.TempDir()
	zipPath := filepath.Join(work, "update.zip")
	writeFakePackage(t, zipPath)

	root := t.TempDir()
	destDir := filepath.Join(root, "陪玩管理")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	oldExe := filepath.Join(destDir, clientExeNames[0])
	if err := os.WriteFile(oldExe, []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	// 按住目录：一个不共享删除权限的目录句柄，正好复现那 8 台机器的现象
	//（目录改名被拒，目录里的文件照样能读能写）。
	hold, err := windows.CreateFile(
		windows.StringToUTF16Ptr(destDir),
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatalf("cannot open the install dir: %v", err)
	}
	defer windows.CloseHandle(hold)
	if err := os.Rename(destDir, destDir+".probe"); err == nil {
		_ = os.Rename(destDir+".probe", destDir)
		t.Skip("this machine allows renaming a dir while a handle is open — cannot reproduce the lock")
	}

	exe, err := applyUpdateAtomic(destDir, zipPath, "9.9.9")
	if err != nil {
		t.Fatalf("applyUpdateAtomic must fall back to a side-by-side install: %v", err)
	}
	alt := filepath.Dir(exe)
	if alt == destDir {
		t.Fatalf("expected a side-by-side install, got the original dir %s", alt)
	}
	if !strings.HasPrefix(filepath.Base(alt), "陪玩管理-v") {
		t.Fatalf("side-by-side dir name looks wrong: %s", alt)
	}
	if _, err := os.Stat(filepath.Join(alt, "resources", "app.asar")); err != nil {
		t.Fatalf("side-by-side install is incomplete: %v", err)
	}
	if data, err := os.ReadFile(oldExe); err != nil || string(data) != "OLD" {
		t.Fatalf("the locked install dir was modified: %v %q", err, string(data))
	}
	var pref preferredClient
	if !readJSONFile(preferredClientFile, &pref) || pref.ExePath != exe {
		t.Fatalf("preferred-client.json wrong: %+v", pref)
	}
	var p pendingUpdate
	if !readJSONFile(pendingUpdateFile, &p) {
		t.Fatal("pending-update.json not written")
	}
	if p.BackupDir != "" || p.PreviousDir != destDir || p.DestDir != alt {
		t.Fatalf("pending record wrong: %+v", p)
	}
	clientPath = ""
	if got := findClient(); got != exe {
		t.Fatalf("findClient should return the side-by-side copy, got %q", got)
	}
	if !rollbackUpdate(&p, "test") {
		t.Fatal("rollback of a side-by-side install should succeed")
	}
	if _, err := os.Stat(alt); err == nil {
		t.Fatalf("rolled-back copy should be gone: %s", alt)
	}
	// 指针摘掉之后就该重新落到「默认那份安装目录」（这里是测试机的真实搜索路径，
	// 所以只断言指针没了 —— 有指针就等于还认那份并排装的新客户端）。
	if preferredClientExe() != "" {
		t.Fatalf("preferred pointer must be cleared after rollback, got %s", preferredClientExe())
	}
	clientPath = ""
}

// 看门狗上报自己时，绝不能带 appVersion —— 服务端对「脚本来源」的上报会保留客户端报的
// 版本号，看门狗跟着混一个进去就会把「这台机器的客户端版本」写坏（老板看的就是那个）。
func TestWatchdogReportBodyKeepsClientVersionOut(t *testing.T) {
	useTempSignalDir(t)
	body := watchdogReportBody()
	if _, ok := body["appVersion"]; ok {
		t.Fatal("watchdog report must not carry appVersion")
	}
	if got := body["watchdogBuild"]; got != serviceBuildNumber {
		t.Fatalf("watchdogBuild should be %s, got %v", serviceBuildNumber, got)
	}
	if got := body["systemPoller"]; got != true {
		t.Fatalf("systemPoller must be true so the server lets the watchdog run tasks: %v", got)
	}
	if got := body["source"]; got != "watchdog" {
		t.Fatalf("source should be watchdog, got %v", got)
	}
	id, _ := body["machineId"].(string)
	if id == "" {
		t.Fatal("machineId must not be empty")
	}
	if strings.ToLower(id) != id || strings.ContainsAny(id, " _:\\/") {
		t.Fatalf("machineId should look like the client one (lowercase, no spaces): %q", id)
	}
}

// 领任务是限流的：5 秒一轮的主循环叫它，一分钟内只允许真去领一次。
func TestRemoteTaskTickIsRateLimited(t *testing.T) {
	useTempSignalDir(t)
	// useTempSignalDir 已经把 lastRemoteTick 设成「刚刚」，这一下必须是空转。
	before := atomic.LoadInt64(&lastRemoteTick)
	time.Sleep(5 * time.Millisecond)
	remoteTaskTick()
	if atomic.LoadInt64(&lastRemoteTick) != before {
		t.Fatal("remoteTaskTick must not fire inside the rate-limit window")
	}
	if atomic.LoadInt32(&remoteTaskBusy) != 0 {
		t.Fatal("rate-limited tick must not start a worker")
	}
}

// 虚拟网卡不参与「这台机器是谁」的计算，否则算出来的编号跟客户端对不上，任务就派丢了。
func TestIsVirtualAdapterSkipsVirtualNics(t *testing.T) {
	for _, name := range []string{"VMware Network Adapter VMnet8", "Hyper-V Virtual Ethernet Adapter", "vEthernet (Default Switch)", "Docker Npcap Loopback Adapter", "VirtualBox Host-Only"} {
		if !isVirtualAdapter(name) {
			t.Fatalf("%q should be treated as virtual", name)
		}
	}
	for _, name := range []string{"以太网", "Ethernet", "WLAN", "Realtek PCIe GbE Family Controller"} {
		if isVirtualAdapter(name) {
			t.Fatalf("%q should NOT be treated as virtual", name)
		}
	}
	if strings.Contains(localMachineID(), " ") {
		t.Fatalf("localMachineID must not contain spaces: %q", localMachineID())
	}
}

func TestParseBuildNumberSkipsTheMarkerConstantItself(t *testing.T) {
	// 真实二进制里，源码那份「标记常量」会排在真标记前面，后面跟的不是数字。
	data := []byte("\x00\x01CHUNLV_WATCHDOG_BUILD=\x00\x02\x03CHUNLV_WATCHDOG_BUILD=2026093007\x00tail")
	if got := parseBuildNumber(data); got != "2026093007" {
		t.Fatalf("解析到的构建号是 %q，期望 2026093007", got)
	}
}

func TestParseBuildNumberPicksTheLongestRun(t *testing.T) {
	data := []byte("CHUNLV_WATCHDOG_BUILD=7\x00CHUNLV_WATCHDOG_BUILD=2026093007")
	if got := parseBuildNumber(data); got != "2026093007" {
		t.Fatalf("解析到的构建号是 %q，期望 2026093007", got)
	}
}

func TestParseBuildNumberMissingMarker(t *testing.T) {
	if got := parseBuildNumber([]byte("nothing here")); got != "" {
		t.Fatalf("没有标记时应返回空串，实际 %q", got)
	}
	// 只有「标记常量」那半截、后面没数字时也要返回空串，不能瞎猜。
	if got := parseBuildNumber([]byte("CHUNLV_WATCHDOG_BUILD=;")); got != "" {
		t.Fatalf("标记后没有数字时应返回空串，实际 %q", got)
	}
}

// ---------------------------------------------------------------------------
// 2026-10-03：远程任务的四个**通用原语**（urlscript / fetch / send / usersession）。
//
// 为什么加这些：全站审计发现「逐台开通远程管理」这条路根本走不通 ——
//   · 13 台策略写了要重启才生效（网络登录令牌被降级，C$/RPC 全拒）
//   · 1 台 C$ 共享干脆不存在
//   · 8 台整段网段从运维机路由不到
// 而看门狗任务通道在**所有会上报的机器上都通**。所以远程控制的价值要收到看门狗这边：
// 传文件、取文件、跑脚本、进用户会话，都不再要求目标机开 C$/RPC/WinRM。
// ---------------------------------------------------------------------------

// 服务端字段名最容易在这里悄悄错位（两边是手写的 JSON），钉住。
func TestRemoteTaskPayloadCarriesNewPrimitiveFields(t *testing.T) {
	raw := `{"id":"t1","type":"ops","mode":"fetch","scriptUrl":"http://x/s.ps1","sha256":"AB",
	         "url":"http://x/a.ps1","localPath":"%TEMP%\\a.ps1","uploadUrl":"http://x/up",
	         "fileName":"n.log","backup":true,"args":["-X","1"],"command":"c","timeoutSec":120,"reason":"r"}`
	var task remoteTask
	if err := json.Unmarshal([]byte(raw), &task); err != nil {
		t.Fatal(err)
	}
	if task.Mode != "fetch" || task.URL != "http://x/a.ps1" || task.LocalPath == "" ||
		task.UploadURL != "http://x/up" || task.FileName != "n.log" || !task.Backup ||
		task.ScriptURL != "http://x/s.ps1" || task.SHA256 != "AB" {
		t.Fatalf("新字段没解析全: %+v", task)
	}
	if task.TimeoutSec != 120 || len(task.Args) != 2 || task.Command != "c" {
		t.Fatalf("老字段被改坏了: %+v", task)
	}
}

// fetch：下载 → 校验 → 替换。sha 不匹配时必须**什么都不改**（不留坏文件、不动原文件）。
func TestFetchModeWritesFileAndRejectsBadSHA(t *testing.T) {
	dir := useTempSignalDir(t)
	body := []byte("Write-Output 'hello 中文'\r\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	sum := fmt.Sprintf("%x", sha256.Sum256(body))

	dest := filepath.Join(dir, "fetched.ps1")
	out, code, err := runFetchMode(remoteTask{ID: "t1", Mode: "fetch", URL: srv.URL, LocalPath: dest, SHA256: sum})
	if err != nil || code != 0 {
		t.Fatalf("fetch 应该成功: err=%v code=%d out=%s", err, code, out)
	}
	got, _ := os.ReadFile(dest)
	if string(got) != string(body) {
		t.Fatalf("写入内容不对: %q", got)
	}
	if !strings.Contains(out, sum) {
		t.Fatalf("回执里应带 sha256: %s", out)
	}

	// 原文件已有内容 + sha 不匹配 -> 原文件必须原样保留，且不留 .dl/.part 残渣
	orig := []byte("原有内容")
	if err := os.WriteFile(dest, orig, 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runFetchMode(remoteTask{ID: "t2", Mode: "fetch", URL: srv.URL, LocalPath: dest, SHA256: strings.Repeat("0", 64)}); err == nil {
		t.Fatal("sha256 不匹配必须报错")
	}
	after, _ := os.ReadFile(dest)
	if string(after) != string(orig) {
		t.Fatalf("校验失败却改动了目标文件: %q", after)
	}
	if leftovers, _ := filepath.Glob(dest + ".*"); len(leftovers) != 0 {
		t.Fatalf("校验失败留下了残渣: %v", leftovers)
	}
	// 目标文件本来不存在时也一样：校验失败不能凭空造出一个文件
	missing := filepath.Join(dir, "never.ps1")
	if _, _, err := runFetchMode(remoteTask{ID: "t3", Mode: "fetch", URL: srv.URL, LocalPath: missing, SHA256: strings.Repeat("0", 64)}); err == nil {
		t.Fatal("sha256 不匹配必须报错")
	}
	if _, statErr := os.Stat(missing); statErr == nil {
		t.Fatal("校验失败还留了文件")
	}
}

// send：把机器上的文件回传服务端（替代 C$ 取文件）。
func TestSendModeUploadsBodyAndFileName(t *testing.T) {
	dir := useTempSignalDir(t)
	var got []byte
	var name, token string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = io.ReadAll(r.Body)
		name = r.Header.Get("x-chunlv-filename")
		token = r.Header.Get("x-onboard-token")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	src := filepath.Join(dir, "日志.log")
	if err := os.WriteFile(src, []byte("hello 日志"), 0644); err != nil {
		t.Fatal(err)
	}
	out, code, err := runSendMode(remoteTask{ID: "t4", Mode: "send", LocalPath: src, UploadURL: srv.URL, FileName: "日志.log"})
	if err != nil || code != 0 {
		t.Fatalf("send 应该成功: err=%v code=%d out=%s", err, code, out)
	}
	if string(got) != "hello 日志" {
		t.Fatalf("上传内容不对: %q", got)
	}
	if name != "日志.log" {
		t.Fatalf("文件名头不对: %q", name)
	}
	if token == "" {
		t.Fatal("必须带共享令牌")
	}
	// 文件不存在 -> 明确失败，不能静默成功
	if _, _, err := runSendMode(remoteTask{ID: "t5", Mode: "send", LocalPath: filepath.Join(dir, "无此文件"), UploadURL: srv.URL}); err == nil {
		t.Fatal("文件不存在必须报错")
	}
	// 服务端拒绝（非 200）-> 也要报错
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte("boom"))
	}))
	defer bad.Close()
	if _, _, err := runSendMode(remoteTask{ID: "t6", Mode: "send", LocalPath: src, UploadURL: bad.URL}); err == nil {
		t.Fatal("服务端 500 时必须报错")
	}
}

// downloadAnyFile 要能吃非 PE 文件（脚本/配置），而给 exe 用的 downloadFileTo 必须仍然只认 PE。
func TestDownloadAnyFileAcceptsNonPEButExePathStillRequiresIt(t *testing.T) {
	dir := useTempSignalDir(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("# 这是一个脚本，不是 PE"))
	}))
	defer srv.Close()

	if _, err := downloadAnyFile(srv.URL, filepath.Join(dir, "s.ps1")); err != nil {
		t.Fatalf("非 PE 文件应该能下: %v", err)
	}
	if err := downloadFileTo(srv.URL, filepath.Join(dir, "s.exe"), 1); err == nil {
		t.Fatal("downloadFileTo 必须仍然要求 PE 头（自更新那条路不能被放宽）")
	}
}

func TestEnsureUTF8BOMIsIdempotent(t *testing.T) {
	dir := useTempSignalDir(t)
	p := filepath.Join(dir, "a.ps1")
	if err := os.WriteFile(p, []byte("中文内容"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ensureUTF8BOM(p); err != nil {
		t.Fatal(err)
	}
	if err := ensureUTF8BOM(p); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(p)
	if !bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("缺 BOM：PS 5.1 会把中文按 GBK 解，脚本直接解析失败")
	}
	if bytes.Count(data, []byte{0xEF, 0xBB, 0xBF}) != 1 {
		t.Fatalf("BOM 只能有一个: %v", data)
	}
}

func TestUserSessionCommandRedirectsOutput(t *testing.T) {
	cmd := buildUserSessionCommand(`powershell -NoProfile -Command "1..3"`, `C:\tmp\o.log`)
	if !strings.Contains(cmd, "cmd.exe /c") || !strings.Contains(cmd, `C:\tmp\o.log`) || !strings.Contains(cmd, "2>&1") {
		t.Fatalf("命令行没把输出重定向好（跨会话只能靠文件取回输出）: %s", cmd)
	}
}

func TestExpandTaskPathExpandsEnv(t *testing.T) {
	t.Setenv("CHUNLV_TEST_VAR", `C:\x`)
	if got := expandTaskPath(`%CHUNLV_TEST_VAR%\y.ps1`); got != `C:\x\y.ps1` {
		t.Fatalf("环境变量没展开: %s", got)
	}
	if got := expandTaskPath("   "); got != "" {
		t.Fatalf("空路径应返回空串: %q", got)
	}
}

// 领任务节奏：远程操作体验全靠它。60 秒一轮实测太钝（一次操作要等一分钟），钉住别退化。
func TestRemoteTickCadenceSnappyEnoughForOps(t *testing.T) {
	if remoteTickEvery > 30*time.Second {
		t.Fatalf("领任务节奏 %s 太钝，远程操作会等太久", remoteTickEvery)
	}
	if remoteTaskMaxSec < 120 || remoteTaskMaxSec > 900 {
		t.Fatalf("单任务上限 %d 秒不合理", remoteTaskMaxSec)
	}
	if remoteFileMaxBytes < 8<<20 || remoteFileMaxBytes > 256<<20 {
		t.Fatalf("传文件上限 %d 不合理", remoteFileMaxBytes)
	}
}
