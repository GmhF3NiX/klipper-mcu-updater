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
`);

module.exports = db;
