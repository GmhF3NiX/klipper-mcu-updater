# Bautagebuch EG

Bautagebuch für den Umbau unseres Zweifamilienhauses zum Einfamilienhaus, Bereich Erdgeschoss.
Hier stehen alle Infos an einem Ort: Funktionen, Versionen, Datenaufbau und der Plan für die Anbindung an die eigene MariaDB auf Unraid.

---

## Inhalt

1. [Versionen und Dateien](#1-versionen-und-dateien)
2. [Funktionen im Überblick](#2-funktionen-im-überblick)
3. [Offline-Version benutzen](#3-offline-version-benutzen)
4. [Online-Version auf claude.ai](#4-online-version-auf-claudeai)
5. [Datenaufbau](#5-datenaufbau)
6. [Geplant: Material über die eigene MariaDB auf Unraid](#6-geplant-material-über-die-eigene-mariadb-auf-unraid)
7. [Offene Punkte](#7-offene-punkte)
8. [Für Entwickler](#8-für-entwickler)

---

## 1. Versionen und Dateien

| Datei | Wofür |
|---|---|
| `bautagebuch-offline.html` | **Eigenständige Datei** zum Öffnen im Browser. Speichert alles lokal im Browser, mit Backup und Import. Diese Datei kann man weitergeben. |
| `bautagebuch.html` | Quelltext der Online-Version auf claude.ai. Allein geöffnet zeigt sie keine Daten. |
| `vorschau-material.html` | Reine Ansicht des geplanten Material-Bereichs mit **Beispieldaten**, ohne Datenbank. |
| `offline-shim.js` | Speicher-Schicht der Offline-Version (IndexedDB im Browser). |
| `build-offline.py` | Erzeugt `bautagebuch-offline.html` aus `bautagebuch.html` und `offline-shim.js`. |

**Links (privat, nur für den Besitzer sichtbar, solange nicht geteilt):**

- Online-Version: https://claude.ai/artifact/6o7TxDf2PGbAse6ZRrrJsS
- Material-Vorschau: https://claude.ai/artifact/Mw46wo2jy5pycFPCARuRKd

**Quellcode:** Repo `GmhF3NiX/klipper-mcu-updater`, Branch `claude/renovierungs-tagebuch-kpttb4`, Ordner `bautagebuch/`.

Die Online- und die Offline-Version haben **getrennte Speicher**. Daten werden zwischen ihnen nicht automatisch abgeglichen.

---

## 2. Funktionen im Überblick

Die Seite ist im Cyberpunk-Look wie das PrintArchive gestaltet und funktioniert am PC und am Handy.

### Übersicht
- Ausgaben gesamt, Budget mit Restbetrag und Balken, unbezahlte Bestellungen
- Eigenleistung in Stunden (aus dem Tagebuch)
- Lohnanteil aus Handwerkerrechnungen nach **§ 35a EStG**, steuerlich absetzbar
- Kosten nach Kategorie und nach Raum
- Offene Aufgaben (direkt abhakbar), nächste Termine, letzte Tagebucheinträge, offene Bestellungen

### Notizen
- Schnelleingabe: **Aufgabe**, **Idee** oder **Notiz** wählen, tippen, **Enter**. Umschalt+Enter macht eine neue Zeile.
- Optional einem Raum zuordnen
- Aufgaben abhaken; erledigte lassen sich mit Datum wieder einblenden
- ★ markiert etwas als wichtig: steht oben, roter Rand
- Aus einer Idee mit „→ Aufgabe“ eine Aufgabe machen
- Filter nach Art und Raum

### Termine
- Monatskalender ab Montag mit Kalenderwoche, Navigation ‹ › und „Heute“
- Arten: Handwerker, Lieferung, Entsorgung/Container, Abnahme/Behörde, Eigenleistung, Sonstiges
- Ein Termin hat Datum, Uhrzeit von–bis (leer bedeutet ganztägig), Raum, verknüpften Kontakt, Notiz und „erledigt“
- Tage mit Tagebucheintrag sind markiert (✎)
- Liste der anstehenden Termine
- **Export als `.ics`** (einzeln oder alle) für den Handykalender. Ein Import, keine Synchronisierung.

### Tagebuch
- Einträge mit Datum, Raum, Stunden, Beschreibung, verbrauchtem Material, Fotos und Links
- Nach Tagen gruppiert

### Belege & Kosten (Ablage)
- Kassenbons, Rechnungen und Bestellbestätigungen als **Foto oder PDF**. Fotos werden vor dem Speichern verkleinert.
- Händler, Bezeichnung, Raum, Kategorie, Status, Betrag brutto, Lohnanteil § 35a, Link zur Bestellung, Notiz, Kontakt
  - Kategorien: Material, Werkzeug & Leihgeräte, Handwerker, Entsorgung, Sonstiges
  - Status: Bestellt, Geliefert, Bezahlt
- **Positionen** mit Artikel, Menge, Einheit und Preis. Ohne Betrag wird die Summe der Positionen genommen.
- Filter nach Raum, Kategorie und Status
- **CSV-Export** für Excel, mit Semikolon getrennt

### Räume & Aufmaß
- Länge × Breite × Höhe, dazu Öffnungen (Türen und Fenster)
- Automatisch berechnet: Bodenfläche, Umfang (Sockelleiste), Wandfläche brutto und netto, Raumvolumen, Kosten des Raums
- Aufmaß-Positionen, z. B. „Schalterdosen gestemmt – 12 Stk“ oder „Schlitze – 18 lfm“
- **Materialverbrauch pro Raum** aus den Belegpositionen
- **Drehbares 3D-Raummodell** als Neon-Drahtgitter, mit Öffnungen
- Link zum Fusion-Modell und weitere Links

### Installation
- Pro Raum mehrere **Pläne**: Grundriss, Skizze oder **Wandfoto vor dem Verputzen**
- Punkte direkt auf dem Plan setzen: Steckdose, Schalter, Lichtauslass, Elektroleitung/Abzweigdose, Netzwerk/TV, Wasser kalt/warm, Abwasser, Heizung, Sonstiges
- Je Punkt: Wand, Höhe ab Fußboden, Abstand und von wo gemessen, Notiz (Querschnitt, Sicherung …), **Fotos**
- Zoom, Filter nach Art, Punkte verschieben
- Hinweis auf die Installationszonen nach **DIN 18015-3**

### Kontakte
- Name, Firma, Gewerk, Bewertung, Telefon, Mobil, E-Mail, Web, Adresse, Notiz
- Nummern antippen oder kopieren
- Nächster Termin und Summe der Belege je Kontakt
- Termin direkt mit dem Kontakt anlegen

---

## 3. Offline-Version benutzen

1. `bautagebuch-offline.html` **am PC oder Laptop** in Chrome, Edge oder Firefox öffnen (Doppelklick).
2. Immer **dieselbe Datei am selben Ort** im **selben Browser** öffnen. Sonst erscheint eine leere Seite.
3. Alle Daten inklusive Fotos liegen im Browser (IndexedDB).

### Backup
- Unter **„Projekt & Budget“ → „Backup speichern“** entsteht eine `.json`-Datei mit allen Daten und Fotos.
- **„Backup laden“** fügt die Daten hinzu: gleiche Einträge werden aktualisiert, nichts wird gelöscht.
- Damit lassen sich Daten auf ein anderes Gerät übertragen oder zwei Geräte zusammenführen, z. B. das Backup der Frau einlesen.
- **Regelmäßig sichern.** Wird der Browser-Speicher gelöscht, sind die Daten weg.

### Einschränkungen
- **Handy:** Das iPhone zeigt eine HTML-Datei aus Mail oder WhatsApp nur als Vorschau an, ohne dass etwas gespeichert wird. Android ist je nach App ähnlich. Für das Handy die Datei besser über einen Webserver bereitstellen, z. B. auf dem Unraid.
- Ohne Internet fehlen nur die Schriftarten, dann erscheinen Ersatzschriften.
- Keine automatische Synchronisierung zwischen Geräten.

---

## 4. Online-Version auf claude.ai

- Daten liegen im Speicher der Seite auf claude.ai, Fotos und Belege in deren Dateiablage.
- **Teilen:** Seite öffnen → **Teilen** → E-Mail eintragen → Rolle **Editor**, damit auch Fotos hochgeladen werden können. Mit „Contributor“ gehen nur Einträge, Termine und Notizen.
- Die Person braucht ein eigenes claude.ai-Konto. Seiten mit eigenem Speicher lassen sich nicht öffentlich freigeben.
- Alle Änderungen sind sofort bei allen sichtbar.

---

## 5. Datenaufbau

Alle Bereiche speichern JSON-Dokumente. Diese Übersicht ist auch die Grundlage für die Zuordnung zu Tabellen in der MariaDB.

| Bereich (Sammlung) | Felder |
|---|---|
| `meta/projekt` | `name`, `subtitle`, `budget` |
| `rooms` | `name`, `L`, `W`, `H` (m), `openings[]` {`name`, `n`, `w`, `h`}, `positions[]` {`text`, `qty`, `unit`}, `model` (Fusion-Link), `links[]` {`label`, `url`}, `notes`, `order`, `plans[]` {`id`, `name`, `type`} |
| `entries` (Tagebuch) | `date`, `roomId`, `title`, `text`, `hours`, `material`, `files[]`, `links[]`, `createdAt`, `updatedAt` |
| `costs` (Belege) | `date`, `vendor`, `title`, `roomId`, `category`, `status`, `amount`, `labor`, `items[]` {`name`, `qty`, `unit`, `price`}, `files[]`, `link`, `note`, `contactId`, `createdAt`, `updatedAt` |
| `install` (Installationspunkte) | `roomId`, `kind`, `date`, `title`, `wall`, `height` (cm), `offset` (cm), `offsetRef`, `note`, `planId`, `x`, `y` (% auf dem Plan), `files[]`, `createdAt`, `updatedAt` |
| `events` (Termine) | `title`, `date`, `time`, `timeEnd`, `kind`, `roomId`, `contactId`, `note`, `done`, `createdAt`, `updatedAt` |
| `contacts` | `name`, `company`, `trade`, `rating` (0–5), `phone`, `mobile`, `email`, `web`, `address`, `note`, `createdAt`, `updatedAt` |
| `notes` | `text`, `type` (`todo` / `idee` / `notiz`), `roomId`, `done`, `doneAt`, `prio`, `createdAt` |

- `files[]` ist überall gleich aufgebaut: {`id`, `name`, `type`}. `id` verweist auf die gespeicherte Datei.
- Datumsangaben im Format `JJJJ-MM-TT`, Zeitstempel in Millisekunden.
- Beträge in Euro brutto, Mengen als Zahl.

---

## 6. Geplant: Material über die eigene MariaDB auf Unraid

**Stand:** nur vorbereitet, noch nicht gebaut. Es gibt eine fertige MariaDB/MySQL auf dem Unraid, in die das Material eingetragen werden soll, ähnlich wie im Trassen-Planer.

### Vorschau
`vorschau-material.html` zeigt, wie der neue Reiter **Material** aussehen würde (Beispieldaten):

- Verbindungsleiste: verbunden, MariaDB-Host, Datenbank, Tabelle, letzte Synchronisierung
- Kennzahlen: Materialwert, bestellt aber nicht geliefert, Anteil verbaut, fehlende Artikel
- Tabelle mit Artikel, Kategorie, Raum, **Bedarf, bestellt, verbaut, Rest**, Fortschrittsbalken, Einzelpreis, Summe, Status
- Filter nach Raum, Kategorie und Status, Suche
- Material erfassen: Suche im Artikelstamm der DB, Menge, Einheit, Raum, Status, Verknüpfung zum Beleg

### Datenfluss
1. **Beleg:** Kassenbon fotografieren, Positionen eintragen oder aus dem Artikelstamm wählen.
2. **Deine DB:** Jede Position wird als Zeile in die Materialtabelle geschrieben, mit Raum und Status.
3. **Bedarf:** kommt aus Aufmaß und Installationsplan, z. B. Umfang für Sockelleisten oder Anzahl der Dosen.
4. **Übersicht:** Bedarf, bestellt, geliefert und verbaut pro Raum, dazu was fehlt und was es kostet.

### Geplanter technischer Aufbau
- Eigener Docker-Container „Bautagebuch“ mit Unraid-Vorlage, im Stil vom PrintArchive (Node.js/Express).
- Verbindung zur vorhandenen MariaDB über Host, Port, Benutzer, Passwort und Datenbank. **Diese Angaben trägt man in der Unraid-Vorlage ein, nicht im Code und nicht im Chat.**
- Am besten einen eigenen DB-Benutzer anlegen, der nur diese Datenbank lesen und schreiben darf.
- Fotos und Belege landen in einem Ordner unter `appdata`.
- Live-Abgleich zwischen mehreren Geräten.
- Import der bisherigen Daten aus der Online- und der Offline-Version.

---

## 7. Offene Punkte

Damit das Material in die vorhandene Datenbank geschrieben werden kann, wird die **Tabellenstruktur** gebraucht. Im MariaDB-Container (Konsole, Adminer oder phpMyAdmin) ausführen und die Ausgabe schicken:

```sql
SHOW TABLES;
SHOW CREATE TABLE <material_tabelle>;
SELECT * FROM <material_tabelle> LIMIT 5;
```

Wenn das Material mit weiteren Tabellen verknüpft ist (Kategorien, Lieferanten, Projekte/Trassen), auch dafür `SHOW CREATE TABLE`.

**Außerdem zu klären:**
- Wie ein Eintrag zu einem Projekt oder Raum gehört. Soll z. B. „Umbau EG“ bzw. „Wohnzimmer“ als eigenes Projekt angelegt werden?
- Host und Port der Datenbank (IP vom Unraid, meist `3306`)
- Wie der Trassen-Planer aussieht: Screenshot oder Code. Er war in keinem der Repos zu finden.

**Weitere Ideen, noch nicht umgesetzt:**
- Leitungsverläufe im Installationsplan als Linie zeichnen statt nur als Punkte

---

## 8. Für Entwickler

Offline-Version nach Änderungen an `bautagebuch.html` neu bauen:

```bash
python3 bautagebuch/build-offline.py
```

- Die Seite nutzt `window.claude.use(...)` für Speicher (`db`), Dateien (`assets`), Downloads (`downloads`) und Benutzer (`user`).
- Online stellt claude.ai diese Schnittstellen bereit, offline übernimmt `offline-shim.js` dasselbe mit IndexedDB.
- Für die Unraid-Version ersetzt später ein Server-Shim die Schnittstelle durch Aufrufe an die eigene API.
- Dateien werden über `blobUrl(id)` angezeigt: online `/_blob/<id>`, offline als Object-URL.
