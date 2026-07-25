# PrintArchive Windows-Installer

Baut `PrintArchive-Setup.exe` — einen eigenständigen Windows-Installer, der Node.js bündelt
(kein separates Node-Setup beim Endnutzer nötig).

## Voraussetzungen zum Bauen

- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install JRSoftware.InnoSetup`)
- Eine portable Node.js-Windows-Version (empfohlen: 22 LTS, x64) als `node.exe` in diesem Ordner
  — Download: https://nodejs.org/dist/ (z. B. `node-v22.20.0-win-x64.zip`, daraus nur `node.exe`
  hier ablegen)
- `node_modules` im übergeordneten `printarchive/`-Ordner muss mit **exakt derselben**
  `node.exe`-Version installiert sein (ABI-Kompatibilität für `better-sqlite3`s natives Binary):

  ```powershell
  cd ..
  $env:PATH = "<Pfad zur portablen node-v22.20.0-win-x64>;" + $env:PATH
  npm install --omit=dev
  ```

  Mit dem System-Node (`node --version` zeigt oft eine neuere/andere Version) gibt es meist keine
  vorgebauten `better-sqlite3`-Binaries und der Build bricht ohne installierte Visual-Studio-Build-Tools ab.

## Bauen

```powershell
.\build.ps1
```

Ergebnis: `output\PrintArchive-Setup.exe`

## Was der Installer macht

- Installiert nach `%ProgramFiles%\PrintArchive` (App + gebündeltes Node.js)
- Start-Menü- und optionales Desktop-Icon, startet `PrintArchive.bat`
- Die App selbst legt beim ersten Start an:
  - Datenbank/Thumbnails: `%APPDATA%\PrintArchive`
  - Standard-Bibliotheksordner: `Dokumente\PrintArchive\Bibliothek`
  - Weitere Ordner lassen sich danach in der App über "➕ ORDNER" hinzufügen (unter Windows per
    vollständigem Pfad, keine Sandbox wie im Docker-Setup)
- Schließen des Server-Fensters beendet PrintArchive; ein erneuter Start über das Icon reicht danach.
