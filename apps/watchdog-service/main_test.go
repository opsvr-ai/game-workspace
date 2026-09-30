package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// useTempSignalDir 把看门狗那几个状态文件挪到临时目录，别去动本机 C:\ProgramData\chunlv。
func useTempSignalDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	updateSignalDir = dir
	updateSignalFile = filepath.Join(dir, "update.json")
	pendingUpdateFile = filepath.Join(dir, "pending-update.json")
	healthyFile = filepath.Join(dir, "client-healthy.json")
	blockedFile = filepath.Join(dir, "blocked-versions.json")
	// 本机身份记录也要落到临时目录：测试绝不能去动 C:\ProgramData\chunlv 里的真文件。
	clientKindFile = filepath.Join(dir, "watchdog-client.txt")
	// 测试里绝不去下整包、也绝不真去杀客户端。
	atomic.StoreInt64(&repairLastTry, time.Now().UnixNano())
	atomic.StoreInt64(&lastDiagMs, time.Now().UnixNano())
	return dir
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
