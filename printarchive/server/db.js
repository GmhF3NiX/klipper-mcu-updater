const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

const db = new Database(path.join(CONFIG_DIR, 'archive.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  ext TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  thumbnail TEXT,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS file_tags (
  file_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (file_id, tag_id),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS file_categories (
  file_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (file_id, category_id),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Ein Eintrag pro Druckversuch einer Datei. Start/Stop wird manuell im UI
-- ausgelöst; der Stromverbrauch für das Zeitfenster kommt von einem
-- Home-Assistant-Energiesensor (z.B. Zigbee-Steckdose am Drucker).
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  energy_kwh REAL,
  energy_cost REAL,
  energy_error TEXT,
  filament_grams REAL,
  filament_price_per_kg REAL,
  filament_cost REAL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- Druckprofile für die Kosten-VOR-Schätzung (Faustformel aus Modellgeometrie, kein echtes
-- Slicing). Mehrere Profile möglich (z.B. "Voron 0.4 PLA schnell", "Rapid PETG fein").
CREATE TABLE IF NOT EXISTS cost_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  layer_height_mm REAL NOT NULL DEFAULT 0.2,
  infill_percent REAL NOT NULL DEFAULT 15,
  wall_count INTEGER NOT NULL DEFAULT 3,
  nozzle_diameter_mm REAL NOT NULL DEFAULT 0.4,
  top_bottom_layers INTEGER NOT NULL DEFAULT 4,
  print_speed_mm_s REAL NOT NULL DEFAULT 60,
  speed_overhead_factor REAL NOT NULL DEFAULT 1.3,
  printer_power_watts REAL NOT NULL DEFAULT 150,
  filament_density_g_cm3 REAL NOT NULL DEFAULT 1.24,
  filament_price_eur_per_kg REAL NOT NULL DEFAULT 25,
  created_at INTEGER NOT NULL
);

-- Zuletzt berechnete Schätzung pro Datei (wird beim erneuten "KOSTEN BERECHNEN" überschrieben,
-- keine Historie wie print_jobs — das ist eine Vorab-Schätzung, kein tatsächlicher Druck).
CREATE TABLE IF NOT EXISTS file_estimates (
  file_id INTEGER PRIMARY KEY,
  profile_id INTEGER,
  spool_id INTEGER,
  filament_grams REAL,
  print_minutes REAL,
  filament_cost REAL,
  energy_cost REAL,
  total_cost REAL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES cost_profiles(id) ON DELETE SET NULL
);

-- Bibliotheks-Wurzeln: standardmäßig nur LIBRARY_PATH (das feste Docker-Volume /library), über
-- die UI lassen sich weitere Ordner unter dem read-only /hostshares-Mount hinzufügen, ohne den
-- Container neu bauen zu müssen. scanner.js läuft über alle Zeilen hier.
CREATE TABLE IF NOT EXISTS library_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
`);

const LIBRARY_PATH = process.env.LIBRARY_PATH || '/library';
let defaultRoot = db.prepare(`SELECT * FROM library_roots WHERE path = ?`).get(LIBRARY_PATH);
if (!defaultRoot) {
  const info = db.prepare(`INSERT INTO library_roots (path, label, added_at) VALUES (?, 'Bibliothek', ?)`)
    .run(LIBRARY_PATH, Date.now());
  defaultRoot = { id: info.lastInsertRowid };
}

if (db.prepare(`SELECT COUNT(*) c FROM cost_profiles`).get().c === 0) {
  db.prepare(`
    INSERT INTO cost_profiles
      (name, layer_height_mm, infill_percent, wall_count, nozzle_diameter_mm, top_bottom_layers,
       print_speed_mm_s, speed_overhead_factor, printer_power_watts, filament_density_g_cm3,
       filament_price_eur_per_kg, created_at)
    VALUES ('Standard', 0.2, 15, 3, 0.4, 4, 60, 1.3, 150, 1.24, 25, ?)
  `).run(Date.now());
}

// Nachträglich ergänzte Spalten für die Spoolman-Anbindung (bestehende DBs haben
// die Tabelle schon ohne sie angelegt — better-sqlite3 kennt kein
// "ADD COLUMN IF NOT EXISTS", daher der manuelle Check).
const printJobColumns = db.prepare(`PRAGMA table_info(print_jobs)`).all().map(c => c.name);
if (!printJobColumns.includes('spoolman_spool_id')) {
  db.exec(`ALTER TABLE print_jobs ADD COLUMN spoolman_spool_id INTEGER`);
}
if (!printJobColumns.includes('filament_error')) {
  db.exec(`ALTER TABLE print_jobs ADD COLUMN filament_error TEXT`);
}

// Nachträglich ergänzte Spalten für mehrere Bibliotheks-Wurzeln (siehe library_roots oben).
// rel_path bleibt wie bisher UNIQUE und pfadartig für die Ordner-Baum-Anzeige — scanner.js
// stellt sicher, dass zusätzliche Wurzeln über ihr Label einen eigenen Top-Level-Ordner bekommen,
// damit es keine Kollisionen mit der primären Bibliothek gibt. abs_path ist der echte Pfad im
// Container für /raw und Thumbnail-Extraktion, unabhängig davon, unter welcher Wurzel die Datei liegt.
const filesColumns = db.prepare(`PRAGMA table_info(files)`).all().map(c => c.name);
if (!filesColumns.includes('root_id')) {
  db.exec(`ALTER TABLE files ADD COLUMN root_id INTEGER`);
}
if (!filesColumns.includes('abs_path')) {
  db.exec(`ALTER TABLE files ADD COLUMN abs_path TEXT`);
}
const legacyRows = db.prepare(`SELECT id, rel_path FROM files WHERE root_id IS NULL OR abs_path IS NULL`).all();
if (legacyRows.length) {
  const fixLegacy = db.prepare(`UPDATE files SET root_id = ?, abs_path = ? WHERE id = ?`);
  const tx = db.transaction((rows) => {
    for (const row of rows) fixLegacy.run(defaultRoot.id, path.join(LIBRARY_PATH, row.rel_path), row.id);
  });
  tx(legacyRows);
}

module.exports = db;
