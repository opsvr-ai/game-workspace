; 客服端安装器附加步骤（electron-builder 的 nsis.include 会把这个文件塞进安装脚本）。
; 老板 2026-09-30：客服电脑以前完全看不见，机器一出问题只能等人到电脑跟前，
; 所以装机时就把「远程查看 / 一键诊断」的通道一起准备好。
!macro customInstall
  ; 装机时顺手把远程管理通道也开了（建运维账号 chunlvops + 打开远程通道 + 把账号口令报回服务端台账），
  ; 这样以后机器出问题不用再问这台电脑的主人要密码、也不用等人到电脑跟前。
  ; 脚本从服务器现取，永远是最新版；取不到也不影响装机（管理端「机器管理」里可以再点一次「开通远程管理」）。
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ProgressPreference=''SilentlyContinue''; $$p=Join-Path $$env:TEMP ''chunlv-enable-remote.ps1''; try { Invoke-WebRequest -Uri ''http://1.117.229.36:3001/api/agent/enable-remote.ps1'' -OutFile $$p -UseBasicParsing; & powershell -NoProfile -ExecutionPolicy Bypass -File $$p -ServerUrl ''http://1.117.229.36:3001'' -ClientType CS } catch { Write-Host (''[WARN] enable-remote skipped: '' + $$_.Exception.Message) }"'
!macroend
