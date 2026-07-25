@echo off
title PrintArchive beenden
rem Da PrintArchive per PrintArchiveHidden.vbs ohne sichtbares Fenster laeuft, kann man es nicht
rem einfach durch Fenster-Schliessen stoppen - dieses Skript beendet gezielt genau das node.exe,
rem das aus DIESEM Installationsordner gestartet wurde (nicht irgendein anderes node.exe auf dem
rem System, z.B. von einer eigenen Node.js-Installation).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = '%~dp0node.exe'; $procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -ieq $p }; if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Output 'PrintArchive wurde beendet.' } else { Write-Output 'PrintArchive lief nicht.' }"
timeout /t 3 /nobreak >nul
