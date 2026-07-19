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
`);

module.exports = db;
