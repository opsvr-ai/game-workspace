!include "MUI2.nsh"

Name "SystemHelper Service"
OutFile "SystemHelper-Setup.exe"
InstallDir "$PROGRAMFILES64\SystemHelper"
RequestExecutionLevel admin
Unicode true

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  ; ── Clean up any previous installation ──
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000
  nsExec::ExecToLog 'sc delete SystemHelper'
  Sleep 1000

  ; ── Remove old binary ──
  Delete "$INSTDIR\SystemHelper.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  ; ── Install new version ──
  SetOutPath "$INSTDIR"
  File "SystemHelper.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; ── Register and start service ──
  nsExec::ExecToLog '"$INSTDIR\SystemHelper.exe" install'
  nsExec::ExecToLog 'sc start SystemHelper'
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'sc stop SystemHelper'
  Sleep 2000
  nsExec::ExecToLog 'sc delete SystemHelper'
  Sleep 1000

  Delete "$INSTDIR\SystemHelper.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
