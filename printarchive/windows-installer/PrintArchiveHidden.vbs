' Startet PrintArchive.bat komplett unsichtbar (Fensterstil 0) - fuer Desktop-Icon, Startmenue
' und Autostart, damit kein Konsolenfenster aufploppt. Zum manuellen Debuggen/Log-mitlesen kann
' PrintArchive.bat weiterhin direkt gestartet werden, das zeigt dann wie bisher das Fenster.
Dim objShell, strDir
Set objShell = CreateObject("WScript.Shell")
strDir = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
objShell.CurrentDirectory = strDir
objShell.Run """" & strDir & "PrintArchive.bat""", 0, False
