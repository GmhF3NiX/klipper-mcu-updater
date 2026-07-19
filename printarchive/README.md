# 3D-Print Archive

Selbstgeschriebene, self-hosted STL/3MF/OBJ-Bibliothek mit Cyberpunk-UI und Slicer-Uplink.
Backend: Node.js/Express + SQLite. Frontend: Vanilla JS + Three.js (3D-Vorschau direkt im Browser).

## Was die App tut

- Scannt rekursiv einen gemounteten Ordner nach `.stl`, `.3mf`, `.obj`
- Indexiert Dateiname, Größe, Pfad in einer lokalen SQLite-DB
- Extrahiert bei `.3mf`-Dateien das eingebettete Vorschaubild (falls vom Slicer gespeichert)
- Zeigt STL/OBJ/3MF live als 3D-Modell im Browser (drehen, zoomen)
- Tags, Suche, Filter nach Format/Tag
- "Download / An Slicer öffnen" liefert die Originaldatei mit korrektem MIME-Type,
  sodass sie vom Betriebssystem im als Standard registrierten Slicer geöffnet wird
- Rührt die Originaldateien nicht an — reiner Lesezugriff, außer du löschst/verschiebst selbst

**Kein** Moonraker/Klipper-Uplink, kein automatisches G-Code-Generieren. Wenn du das brauchst,
schau dir zusätzlich PrintStash an — das ist nicht das, was hier gebaut wurde.

## Lokal testen (ohne Docker)

```bash
npm install
LIBRARY_PATH=/pfad/zu/deinen/modellen CONFIG_DIR=./config npm start
# -> http://localhost:8420
```

## Deployment auf unRAID

### Variante A: docker-compose (empfohlen, z. B. über den "Compose Manager"-Plugin)

1. Diesen Ordner (mit `Dockerfile`, `server/`, `public/`, `docker-compose.yml`) auf den Server kopieren,
   z. B. nach `/mnt/user/appdata/printarchive/`.
2. In `docker-compose.yml` den Volume-Pfad `/mnt/user/3D-Drucke` auf deinen echten Share anpassen.
3. Im Ordner ausführen:
   ```bash
   docker compose up -d --build
   ```
4. Aufrufen unter `http://TOWER-IP:8420`.

### Variante B: reines Docker-CLI / manueller Container in unRAID

```bash
docker build -t printarchive /mnt/user/appdata/printarchive
docker run -d \
  --name printarchive \
  -e PUID=99 -e PGID=100 \
  -p 8420:8420 \
  -v /mnt/user/3D-Drucke:/library \
  -v /mnt/user/appdata/printarchive/config:/config \
  --restart unless-stopped \
  printarchive
```

In unRAID kannst du daraus auch bequem einen eigenen Container-Eintrag über
**Docker → Add Container** anlegen und die obigen Werte in die Felder eintragen
(Repository: `printarchive`, Netzwerk-Typ: bridge, Port 8420→8420, zwei Volume-Mappings
wie oben).

### Env-Variablen

| Variable | Default | Bedeutung |
|---|---|---|
| `LIBRARY_PATH` | `/library` | gemounteter Ordner mit deinen Modellen |
| `CONFIG_DIR` | `/config` | Ablage für SQLite-DB + Thumbnail-Cache |
| `PORT` | `8420` | interner Port |
| `PUID` / `PGID` | `99` / `100` | Nutzer, unter dem der Prozess läuft (unraid-Standard) |
| `RESCAN_INTERVAL_MINUTES` | `15` | automatischer Re-Scan der Bibliothek |

## Grenzen, die du kennen solltest

- **3MF-Vorschau im Browser**: Three.js' `3MFLoader` deckt die gängigen Slicer-Exporte ab,
  aber nicht jede 3MF-Variante (z. B. manche CAD-Exporte mit exotischen Erweiterungen).
  Fällt der Live-Viewer aus, funktioniert Download/Öffnen trotzdem.
- **Kein automatischer Druckerversand**: "An Slicer öffnen" nutzt den Datei-Download-Mechanismus
  des Browsers/Betriebssystems, keine direkte Prozesskopplung zum Slicer.
- **Kein Multi-User/Login**: Die App ist für den Betrieb im eigenen Netz gedacht, nicht fürs offene Internet.
  Falls Fernzugriff nötig ist: hinter Reverse-Proxy mit eigener Authentifizierung betreiben.
- Ich konnte den Docker-Build in meiner Umgebung nicht ausführen (kein Docker-Daemon verfügbar),
  habe Backend und Scanner aber direkt mit Node getestet (Scan, API-Routen, Tag-Verwaltung liefen
  fehlerfrei). Der erste `docker compose up --build` bei dir ist also der reale Erstbau — meld dich,
  falls dabei etwas hakt.
