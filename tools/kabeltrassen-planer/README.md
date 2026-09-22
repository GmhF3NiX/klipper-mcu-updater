# Kabeltrassen-Planer

Ein Werkzeug für die Kabelverlegung bei Zugrestaurierungen (AFZ, Kameras, WLAN &hellip;):
Zugplan hochladen, Maßstab kalibrieren, Kabelwege im Plan einzeichnen und daraus
automatisch eine Kabelliste (CSV, Excel-kompatibel) erzeugen.

## Nutzung

Die Datei `index.html` ist ein eigenständiges Werkzeug ohne Installation und ohne
Internetverbindung nutzbar (bis auf den Google-Font-Ladeversuch, der bei fehlendem
Internet einfach auf die Systemschrift zurückfällt):

1. `index.html` per Doppelklick im Browser öffnen (Chrome/Edge/Firefox), oder auf
   einen internen Webserver legen.
2. **Plan laden** &ndash; Foto oder Scan des Wagenplans (PNG/JPG) hochladen.
3. **Maßstab setzen** &ndash; zwei Punkte mit bekanntem realen Abstand anklicken
   (z.&nbsp;B. Wagenlänge) und die Distanz in Metern eintragen.
4. **+ Neues Kabel** &ndash; Geräteposition (Start, z.&nbsp;B. AFZ/Kamera/WLAN-AP)
   und Zielpunkt (z.&nbsp;B. Schaltschrank/Verteiler) anklicken, Gerätetyp,
   Kabeltyp und Reservezuschlag (Standard 15&nbsp;%) eintragen.
5. **CSV exportieren** &ndash; erzeugt die Kabelliste (Nr., Von, Nach, Kabeltyp,
   Länge direkt/inkl. Reserve, Bemerkung) als `;`-getrennte CSV-Datei für Excel.
6. **Projekt speichern/laden** &ndash; sichert Plan, Maßstab und Kabelliste als
   JSON-Datei, um später weiterzuarbeiten oder das Projekt zu teilen.

Alle Berechnungen (Kabellängen) basieren auf der Luftlinie zwischen den beiden
angeklickten Punkten multipliziert mit dem Maßstab, zzgl. des eingestellten
Reservezuschlags. Für tatsächliche Kabelwege (z.&nbsp;B. um Ecken, durch Kanäle)
den Reservezuschlag entsprechend höher ansetzen oder die Bemerkung nutzen.

## Hinweise

- PDF-Pläne vorher als PNG/JPG exportieren oder einen Screenshot verwenden.
- Der Browser merkt sich den zuletzt bearbeiteten Stand automatisch (lokaler
  Zwischenspeicher des Browsers) &ndash; für eine dauerhafte Sicherung trotzdem
  regelmäßig **Projekt speichern** nutzen.
- Es werden keine Daten irgendwohin übertragen; alles läuft lokal im Browser.
