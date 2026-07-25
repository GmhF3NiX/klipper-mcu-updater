# Baut den PrintArchive-Windows-Installer:
# 1. Staging-Ordner "dist" zusammenstellen (node.exe + server/ + public/ + node_modules + Launcher)
# 2. Mit Inno Setup (ISCC.exe) zu PrintArchive-Setup.exe kompilieren
#
# Voraussetzung: node_modules im uebergeordneten Ordner wurde bereits mit der GLEICHEN
# node.exe-Version installiert, die hier als $NodeExe angegeben ist (ABI-Kompatibilitaet von
# better-sqlite3s natives Binary) - siehe README.md in diesem Ordner.

param(
  [string]$NodeExe = "$PSScriptRoot\node.exe"
)

$Root = Split-Path $PSScriptRoot -Parent
$Dist = "$PSScriptRoot\dist"

if (-not (Test-Path $NodeExe)) {
  Write-Error "node.exe nicht gefunden unter $NodeExe - siehe README.md (portable Node-Version dort ablegen)."
  exit 1
}

Write-Output "Raeume dist/ auf ..."
Remove-Item $Dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

Write-Output "Kopiere App-Dateien ..."
Copy-Item "$Root\server" "$Dist\server" -Recurse
Copy-Item "$Root\public" "$Dist\public" -Recurse
Copy-Item "$Root\node_modules" "$Dist\node_modules" -Recurse
Copy-Item "$Root\package.json" "$Dist\package.json"
Copy-Item $NodeExe "$Dist\node.exe"
Copy-Item "$PSScriptRoot\PrintArchive.bat" "$Dist\PrintArchive.bat"
Copy-Item "$PSScriptRoot\PrintArchiveHidden.vbs" "$Dist\PrintArchiveHidden.vbs"
Copy-Item "$PSScriptRoot\StopPrintArchive.bat" "$Dist\StopPrintArchive.bat"

Write-Output "Kompiliere Installer ..."
$Iscc = (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue).Source
if (-not $Iscc) {
  foreach ($candidate in @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )) {
    if (Test-Path $candidate) { $Iscc = $candidate; break }
  }
}
if (-not $Iscc) {
  Write-Error "ISCC.exe nicht gefunden - Inno Setup installiert?"
  exit 1
}
& $Iscc "$PSScriptRoot\PrintArchive.iss"

Write-Output "Fertig - Installer liegt unter windows-installer\output\PrintArchive-Setup.exe"
