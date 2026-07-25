; Inno Setup Skript fuer PrintArchive (Windows-Standalone-Installer).
; Baut den Installer aus dem "dist"-Staging-Ordner, den build.ps1 vorher zusammenstellt.
; Kompilieren: ISCC.exe PrintArchive.iss  (oder build.ps1 macht das automatisch)

#define MyAppName "PrintArchive"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "GmhF3NiX"
#define MyAppExeName "PrintArchive.bat"

[Setup]
AppId={{9B6C2F3E-6E6E-4B3B-9B58-3D2C7B2A6F11}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=PrintArchive-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Reine Pro-Nutzer-Installation (kein UAC-Prompt noetig) - passt zu den userspezifischen Pfaden
; (Autostart-Verknuepfung, Desktop-Icon) und macht deren Aufloesung eindeutig, siehe Compiler-
; Warnung zu "userstartup" bei Admin-Installationen.
PrivilegesRequired=lowest

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "PrintArchive bei jedem Windows-Start automatisch starten"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Datenbank/Thumbnails/Bibliothek bleiben absichtlich erhalten (liegen unter %APPDATA%\PrintArchive
; bzw. Dokumente\PrintArchive) - nur das Installationsverzeichnis wird entfernt.
; printarchive-config.bat wird erst zur Laufzeit von CurStepChanged erzeugt, steht also nicht in
; [Files] - der Uninstaller wuesste sonst nichts davon und liesse den (dann nicht leeren)
; App-Ordner stehen.
Type: files; Name: "{app}\printarchive-config.bat"

[Code]
var
  SpoolmanChoicePage: TInputOptionWizardPage;
  SpoolmanServerPage: TInputQueryWizardPage;
  HaChoicePage: TInputOptionWizardPage;
  HaServerPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  SpoolmanChoicePage := CreateInputOptionPage(wpSelectTasks,
    'Spoolman', 'Nutzt du Spoolman fuer die Filament-Verwaltung?',
    'Wenn ja, wird PrintArchive beim ersten Start automatisch damit verbunden ' +
    '(Preis/kg und Restgewicht kommen dann direkt von dort). Spaeter jederzeit ' +
    'im Einstellungen-Menue der App aenderbar.',
    True, False);
  SpoolmanChoicePage.Add('Ja, ich nutze Spoolman');
  SpoolmanChoicePage.Add('Nein / spaeter selbst einrichten');
  SpoolmanChoicePage.SelectedValueIndex := 1;

  SpoolmanServerPage := CreateInputQueryPage(SpoolmanChoicePage.ID,
    'Spoolman-Server', 'Wo laeuft dein Spoolman?',
    'Trag die Adresse deines Spoolman-Servers ein.');
  SpoolmanServerPage.Add('IP-Adresse oder Hostname:', False);
  SpoolmanServerPage.Add('Port:', False);
  SpoolmanServerPage.Values[1] := '7912';

  HaChoicePage := CreateInputOptionPage(SpoolmanServerPage.ID,
    'Home Assistant', 'Nutzt du Home Assistant fuer Stromkosten-Tracking?',
    'Wenn ja, kann PrintArchive Stromverbrauch waehrend eines Drucks ueber einen ' +
    'Home-Assistant-Energiesensor abfragen. Zugriffs-Token traegst du danach in der ' +
    'App selbst ein (Einstellungen-Menue).',
    True, False);
  HaChoicePage.Add('Ja, ich nutze Home Assistant');
  HaChoicePage.Add('Nein / spaeter selbst einrichten');
  HaChoicePage.SelectedValueIndex := 1;

  HaServerPage := CreateInputQueryPage(HaChoicePage.ID,
    'Home-Assistant-Server', 'Wo laeuft dein Home Assistant?',
    'Trag die Adresse deiner Home-Assistant-Instanz ein.');
  HaServerPage.Add('IP-Adresse oder Hostname:', False);
  HaServerPage.Add('Port:', False);
  HaServerPage.Values[1] := '8123';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = SpoolmanServerPage.ID then
    Result := SpoolmanChoicePage.SelectedValueIndex <> 0;
  if PageID = HaServerPage.ID then
    Result := HaChoicePage.SelectedValueIndex <> 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath: String;
  Lines: TArrayOfString;
  N: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    N := 0;
    SetArrayLength(Lines, 4);
    Lines[N] := '@echo off'; N := N + 1;

    if (SpoolmanChoicePage.SelectedValueIndex = 0) and (Trim(SpoolmanServerPage.Values[0]) <> '') then
    begin
      Lines[N] := 'set SPOOLMAN_BASE_URL=http://' + Trim(SpoolmanServerPage.Values[0]) + ':' + Trim(SpoolmanServerPage.Values[1]);
      N := N + 1;
    end;

    if (HaChoicePage.SelectedValueIndex = 0) and (Trim(HaServerPage.Values[0]) <> '') then
    begin
      Lines[N] := 'set HA_BASE_URL=http://' + Trim(HaServerPage.Values[0]) + ':' + Trim(HaServerPage.Values[1]);
      N := N + 1;
    end;

    SetArrayLength(Lines, N);
    ConfigPath := ExpandConstant('{app}\printarchive-config.bat');
    SaveStringsToFile(ConfigPath, Lines, False);
  end;
end;
