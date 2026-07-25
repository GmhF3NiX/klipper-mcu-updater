@echo off
title PrintArchive Server - dieses Fenster schliessen beendet den Server
cd /d "%~dp0"

rem Voller Pfad noetig: manche Windows-Systeme (Sicherheits-Haertung, z.B. Firmenrechner) setzen
rem NoDefaultCurrentDirectoryInExePath, wodurch cmd.exe einen Datei-/Skriptnamen ohne Pfad NICHT
rem mehr im aktuellen Ordner findet, selbst nach "cd /d" - bare "call config.bat" wuerde dort
rem lautlos fehlschlagen (keine Fehlermeldung, das Skript wird einfach uebersprungen).
if exist "%~dp0printarchive-config.bat" call "%~dp0printarchive-config.bat"

echo Starte PrintArchive ...
echo Bibliothek/Einstellungen liegen in %%APPDATA%%\PrintArchive und deinen Dokumenten.
echo.

start /min "" cmd /c "timeout /t 2 /nobreak >nul && start "" http://localhost:8420"

rem Ausdruecklich das mitgelieferte node.exe per vollem Pfad aufrufen statt "node.exe" ohne
rem Pfad zu schreiben - sonst kann bei Systemen mit eigener Node-Installation (andere Version)
rem versehentlich die falsche node.exe gefunden werden, was better-sqlite3s natives Binary
rem (NODE_MODULE_VERSION-Mismatch) sofort zum Absturz bringt.
"%~dp0node.exe" "%~dp0server\index.js"
pause
