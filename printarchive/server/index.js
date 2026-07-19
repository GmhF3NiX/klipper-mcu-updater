const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const { scanLibrary, LIBRARY_PATH, THUMB_DIR } = require('./scanner');

const PORT = process.env.PORT || 8420;
const app = express();
app.use(express.json());

// ---- static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- helpers ----
function fileWithTags(row) {
  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN file_tags ft ON ft.tag_id = t.id
    WHERE ft.file_id = ?
    ORDER BY t.name
  `).all(row.id).map(t => t.name);
  return { ...row, tags };
}

// ---- API ----
app.get('/api/stats', (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) c FROM files`).get().c;
  const byExt = db.prepare(`SELECT ext, COUNT(*) c FROM files GROUP BY ext`).all();
  res.json({ total, byExt, libraryPath: LIBRARY_PATH });
});

app.get('/api/files', (req, res) => {
  const { q, tag, ext, folder } = req.query;
  let sql = `SELECT DISTINCT f.* FROM files f`;
  const where = [];
  const params = {};

  if (tag) {
    sql += ` JOIN file_tags ft ON ft.file_id = f.id JOIN tags t ON t.id = ft.tag_id`;
    where.push(`t.name = @tag`);
    params.tag = tag;
  }
  if (q) {
    where.push(`f.filename LIKE @q`);
    params.q = `%${q}%`;
  }
  if (ext) {
    where.push(`f.ext = @ext`);
    params.ext = ext;
  }
  if (folder) {
    // folder === "" (root) matches files with no subdirectory in their rel_path
    if (folder === '/') {
      where.push(`instr(f.rel_path, '/') = 0`);
    } else {
      where.push(`(f.rel_path LIKE @folderExact OR f.rel_path LIKE @folderSub)`);
      params.folderExact = `${folder}/%`;
      params.folderSub = `${folder}/%/%`;
    }
  }
  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` ORDER BY f.added_at DESC`;

  const rows = db.prepare(sql).all(params);
  res.json(rows.map(fileWithTags));
});

// Kategorien = Ordnerstruktur des Bibliotheksordners. Kein separates Feld zu pflegen —
// leg im Bibliotheksordner einfach Unterordner an (z.B. "Vasen", "Mechanik/Zahnraeder"),
// die Sidebar bildet sie 1:1 nach.
app.get('/api/folders', (req, res) => {
  const rows = db.prepare(`SELECT rel_path FROM files`).all();
  const root = { name: '/', path: '', count: 0, children: {} };

  for (const { rel_path } of rows) {
    const parts = rel_path.split('/').slice(0, -1); // drop filename
    let node = root;
    node.count++;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!node.children[part]) {
        node.children[part] = { name: part, path: acc, count: 0, children: {} };
      }
      node = node.children[part];
      node.count++;
    }
  }

  function toArray(node) {
    return {
      name: node.name,
      path: node.path,
      count: node.count,
      children: Object.values(node.children).map(toArray).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  res.json(toArray(root));
});

app.get('/api/files/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(fileWithTags(row));
});

app.get('/api/files/:id/thumbnail', (req, res) => {
  const row = db.prepare(`SELECT thumbnail FROM files WHERE id = ?`).get(req.params.id);
  if (!row || !row.thumbnail) return res.status(404).end();
  res.sendFile(path.join(THUMB_DIR, row.thumbnail));
});

// Serves the raw mesh — used both by the in-browser 3D viewer and as a
// direct download so the file can be opened in a desktop slicer.
app.get('/api/files/:id/raw', (req, res) => {
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const absPath = path.join(LIBRARY_PATH, row.rel_path);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'file_missing_on_disk' });

  const download = req.query.download === '1';
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
  }
  res.sendFile(absPath);
});

app.post('/api/files/:id/tags', (req, res) => {
  const { tag } = req.body;
  if (!tag || !tag.trim()) return res.status(400).json({ error: 'tag_required' });
  const name = tag.trim().toLowerCase();

  db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(name);
  const tagRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name);
  db.prepare(`INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)`)
    .run(req.params.id, tagRow.id);

  res.json({ ok: true });
});

app.delete('/api/files/:id/tags/:tag', (req, res) => {
  const tagRow = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(req.params.tag.toLowerCase());
  if (tagRow) {
    db.prepare(`DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?`).run(req.params.id, tagRow.id);
  }
  res.json({ ok: true });
});

app.get('/api/tags', (req, res) => {
  res.json(db.prepare(`SELECT name FROM tags ORDER BY name`).all().map(t => t.name));
});

app.post('/api/rescan', (req, res) => {
  const result = scanLibrary();
  res.json({ ok: true, ...result });
});

// ---- startup ----
scanLibrary();
const RESCAN_INTERVAL_MS = Number(process.env.RESCAN_INTERVAL_MINUTES || 15) * 60 * 1000;
setInterval(scanLibrary, RESCAN_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`3D-Print Archive läuft auf Port ${PORT}, Bibliothek: ${LIBRARY_PATH}`);
});
