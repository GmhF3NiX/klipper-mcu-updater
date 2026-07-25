const fs = require('fs');
const path = require('path');
const db = require('./db');

// LIBRARY_PATH/CONFIG_DIR kommen von db.js (einzige Quelle der Wahrheit, siehe dort) statt hier
// nochmal berechnet zu werden — zwei unabhängige Kopien derselben Fallback-Logik liefen vorher
// leicht auseinander und sorgten für einen Bug (falscher Scan-Pfad unter Windows).
const LIBRARY_PATH = db.LIBRARY_PATH;
const CONFIG_DIR = db.CONFIG_DIR;
const THUMB_DIR = path.join(CONFIG_DIR, 'thumbnails');
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
// Erststart nativ unter Windows: Bibliotheksordner existiert noch nicht -> anlegen, statt dass
// der erste Scan einfach leer/mit Fehlermeldung durchläuft.
if (!fs.existsSync(LIBRARY_PATH)) fs.mkdirSync(LIBRARY_PATH, { recursive: true });

const EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);

function walk(dir, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Kann Ordner nicht lesen: ${dir}`, err.message);
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.has(ext)) results.push(full);
    }
  }
  return results;
}

// Ordnername für zusätzliche Wurzeln, unter dem ihre Dateien im Ordnerbaum erscheinen — damit ihr
// rel_path nicht mit der primären Bibliothek kollidiert (rel_path ist global UNIQUE). Die primäre
// Wurzel (LIBRARY_PATH) bleibt unpräfixiert, exakt wie vorher.
function labelToSegment(label) {
  return label.replace(/[/\\]+/g, '-').trim() || 'ordner';
}

function scanLibrary() {
  const started = Date.now();
  const roots = db.prepare(`SELECT * FROM library_roots ORDER BY id`).all();

  const foundRelPaths = new Set();
  let totalFound = 0;

  const upsert = db.prepare(`
    INSERT INTO files (rel_path, filename, ext, size_bytes, mtime, added_at, root_id, abs_path)
    VALUES (@rel_path, @filename, @ext, @size_bytes, @mtime, @added_at, @root_id, @abs_path)
    ON CONFLICT(rel_path) DO UPDATE SET
      size_bytes = excluded.size_bytes,
      mtime = excluded.mtime,
      root_id = excluded.root_id,
      abs_path = excluded.abs_path
    WHERE files.mtime != excluded.mtime OR files.size_bytes != excluded.size_bytes OR files.abs_path != excluded.abs_path
  `);

  const tx = db.transaction((root, paths) => {
    const isPrimary = root.path === LIBRARY_PATH;
    const segment = isPrimary ? null : labelToSegment(root.label);
    for (const absPath of paths) {
      const realRelPath = path.relative(root.path, absPath);
      const relPath = isPrimary ? realRelPath : path.join(segment, realRelPath);
      foundRelPaths.add(relPath);
      const stat = fs.statSync(absPath);
      const ext = path.extname(absPath).toLowerCase().slice(1);

      upsert.run({
        rel_path: relPath,
        filename: path.basename(absPath),
        ext,
        size_bytes: stat.size,
        mtime: Math.floor(stat.mtimeMs),
        added_at: Date.now(),
        root_id: root.id,
        abs_path: absPath,
      });

      // Eingebettete 3MF-Slicer-Vorschaubilder werden bewusst nicht mehr übernommen — der
      // Client rendert für jedes Format (STL/OBJ/3MF) sein eigenes Neon-Rot-Thumbnail (siehe
      // app.js maybeCaptureThumbnail), damit die Optik über die ganze Bibliothek einheitlich ist.
    }
  });

  for (const root of roots) {
    const found = walk(root.path);
    totalFound += found.length;
    tx(root, found);
  }

  // Remove DB entries whose underlying file has disappeared (or whose root was removed).
  const allRows = db.prepare(`SELECT id, rel_path FROM files`).all();
  const del = db.prepare(`DELETE FROM files WHERE id = ?`);
  const delTx = db.transaction(() => {
    for (const row of allRows) {
      if (!foundRelPaths.has(row.rel_path)) del.run(row.id);
    }
  });
  delTx();

  const durationMs = Date.now() - started;
  console.log(`Scan fertig: ${totalFound} Dateien in ${durationMs}ms (${roots.length} Wurzel(n))`);
  return { count: totalFound, durationMs };
}

module.exports = { scanLibrary, LIBRARY_PATH, THUMB_DIR };
