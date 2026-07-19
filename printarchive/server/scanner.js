const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const db = require('./db');

const LIBRARY_PATH = process.env.LIBRARY_PATH || '/library';
const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const THUMB_DIR = path.join(CONFIG_DIR, 'thumbnails');
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

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

// Tries to pull an embedded preview image out of a .3mf (which is a zip container).
// Slicers commonly store it at Metadata/thumbnail.png or Metadata/plate_*.png.
function extractThumbnail3mf(absPath, fileId) {
  try {
    const zip = new AdmZip(absPath);
    const entries = zip.getEntries();
    const candidate =
      entries.find(e => /metadata\/thumbnail.*\.png$/i.test(e.entryName)) ||
      entries.find(e => /plate_1\.png$/i.test(e.entryName)) ||
      entries.find(e => /\.png$/i.test(e.entryName));
    if (!candidate) return null;
    const outName = `${fileId}.png`;
    const outPath = path.join(THUMB_DIR, outName);
    fs.writeFileSync(outPath, candidate.getData());
    return outName;
  } catch (err) {
    console.warn(`Thumbnail-Extraktion fehlgeschlagen für ${absPath}: ${err.message}`);
    return null;
  }
}

function scanLibrary() {
  const started = Date.now();
  const found = walk(LIBRARY_PATH);
  const foundRelPaths = new Set();

  const upsert = db.prepare(`
    INSERT INTO files (rel_path, filename, ext, size_bytes, mtime, added_at)
    VALUES (@rel_path, @filename, @ext, @size_bytes, @mtime, @added_at)
    ON CONFLICT(rel_path) DO UPDATE SET
      size_bytes = excluded.size_bytes,
      mtime = excluded.mtime
    WHERE files.mtime != excluded.mtime OR files.size_bytes != excluded.size_bytes
  `);

  const getId = db.prepare(`SELECT id, thumbnail FROM files WHERE rel_path = ?`);

  const tx = db.transaction((paths) => {
    for (const absPath of paths) {
      const relPath = path.relative(LIBRARY_PATH, absPath);
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
      });

      const row = getId.get(relPath);
      if (row && ext === '3mf' && !row.thumbnail) {
        const thumb = extractThumbnail3mf(absPath, row.id);
        if (thumb) {
          db.prepare(`UPDATE files SET thumbnail = ? WHERE id = ?`).run(thumb, row.id);
        }
      }
    }
  });
  tx(found);

  // Remove DB entries whose underlying file has disappeared.
  const allRows = db.prepare(`SELECT id, rel_path FROM files`).all();
  const del = db.prepare(`DELETE FROM files WHERE id = ?`);
  const delTx = db.transaction(() => {
    for (const row of allRows) {
      if (!foundRelPaths.has(row.rel_path)) del.run(row.id);
    }
  });
  delTx();

  const durationMs = Date.now() - started;
  console.log(`Scan fertig: ${found.length} Dateien in ${durationMs}ms (Bibliothek: ${LIBRARY_PATH})`);
  return { count: found.length, durationMs };
}

module.exports = { scanLibrary, LIBRARY_PATH, THUMB_DIR };
