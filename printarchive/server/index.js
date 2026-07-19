const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const { scanLibrary, LIBRARY_PATH, THUMB_DIR } = require('./scanner');
const { getSetting, setSetting } = require('./settings');
const ha = require('./homeassistant');

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
  const categories = db.prepare(`
    SELECT c.id, c.name FROM categories c
    JOIN file_categories fc ON fc.category_id = c.id
    WHERE fc.file_id = ?
    ORDER BY c.name
  `).all(row.id);
  return { ...row, tags, categories };
}

// ---- API ----
app.get('/api/stats', (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) c FROM files`).get().c;
  const byExt = db.prepare(`SELECT ext, COUNT(*) c FROM files GROUP BY ext`).all();
  res.json({ total, byExt, libraryPath: LIBRARY_PATH });
});

app.get('/api/files', (req, res) => {
  const { q, tag, ext, folder, category } = req.query;
  let sql = `SELECT DISTINCT f.* FROM files f`;
  const where = [];
  const params = {};

  if (tag) {
    sql += ` JOIN file_tags ft ON ft.file_id = f.id JOIN tags t ON t.id = ft.tag_id`;
    where.push(`t.name = @tag`);
    params.tag = tag;
  }
  if (category) {
    sql += ` JOIN file_categories fc ON fc.file_id = f.id`;
    where.push(`fc.category_id = @category`);
    params.category = category;
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

// Ordner-Baum = Ordnerstruktur des Bibliotheksordners. Kein separates Feld zu pflegen —
// leg im Bibliotheksordner einfach Unterordner an (z.B. "Vasen", "Mechanik/Zahnraeder"),
// die Sidebar bildet sie 1:1 nach. Für frei anlegbare Kategorien siehe /api/categories.
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

// ---- user-defined categories (sidebar, independent of folder structure) ----
app.get('/api/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, COUNT(fc.file_id) count
    FROM categories c
    LEFT JOIN file_categories fc ON fc.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all();
  res.json(rows);
});

app.post('/api/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });

  db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`).run(name);
  const row = db.prepare(`SELECT id, name FROM categories WHERE name = ?`).get(name);
  res.json(row);
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare(`DELETE FROM file_categories WHERE category_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/files/:id/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });

  db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`).run(name);
  const cat = db.prepare(`SELECT id, name FROM categories WHERE name = ?`).get(name);
  db.prepare(`INSERT OR IGNORE INTO file_categories (file_id, category_id) VALUES (?, ?)`)
    .run(req.params.id, cat.id);

  res.json({ ok: true, category: cat });
});

app.delete('/api/files/:id/categories/:categoryId', (req, res) => {
  db.prepare(`DELETE FROM file_categories WHERE file_id = ? AND category_id = ?`)
    .run(req.params.id, req.params.categoryId);
  res.json({ ok: true });
});

// ---- settings (Strompreis + Home-Assistant-Zugang) ----
app.get('/api/settings', (req, res) => {
  res.json({
    power_price_eur_per_kwh: getSetting('power_price_eur_per_kwh', '0.35'),
    ha_base_url: getSetting('ha_base_url', ''),
    ha_energy_entity_id: getSetting('ha_energy_entity_id', ''),
    ha_token_set: Boolean(getSetting('ha_token')),
  });
});

app.post('/api/settings', (req, res) => {
  const { power_price_eur_per_kwh, ha_base_url, ha_energy_entity_id, ha_token } = req.body;
  if (power_price_eur_per_kwh !== undefined) setSetting('power_price_eur_per_kwh', String(power_price_eur_per_kwh));
  if (ha_base_url !== undefined) setSetting('ha_base_url', String(ha_base_url).trim());
  if (ha_energy_entity_id !== undefined) setSetting('ha_energy_entity_id', String(ha_energy_entity_id).trim());
  // Token nur überschreiben, wenn tatsächlich ein neuer eingegeben wurde —
  // sonst bliebe das Feld beim Speichern anderer Settings sonst leer.
  if (ha_token) setSetting('ha_token', String(ha_token).trim());
  res.json({ ok: true });
});

app.get('/api/settings/test-ha', async (req, res) => {
  const baseUrl = getSetting('ha_base_url');
  const token = getSetting('ha_token');
  const entityId = getSetting('ha_energy_entity_id');
  if (!baseUrl || !token || !entityId) {
    return res.json({ ok: false, error: 'ha_not_configured' });
  }
  try {
    const state = await ha.fetchCurrentState(baseUrl, token, entityId);
    res.json({ ok: true, state: state.state, unit: state.attributes?.unit_of_measurement || '' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ---- print jobs (Start/Stop-Timer -> Stromkosten via Home Assistant, Filamentkosten manuell) ----
app.get('/api/files/:id/print-jobs', (req, res) => {
  const rows = db.prepare(`SELECT * FROM print_jobs WHERE file_id = ? ORDER BY started_at DESC`).all(req.params.id);
  res.json(rows);
});

app.post('/api/files/:id/print-jobs/start', (req, res) => {
  const running = db.prepare(`SELECT id FROM print_jobs WHERE file_id = ? AND status = 'running'`).get(req.params.id);
  if (running) return res.status(409).json({ error: 'already_running', jobId: running.id });

  const info = db.prepare(`INSERT INTO print_jobs (file_id, started_at, status) VALUES (?, ?, 'running')`)
    .run(req.params.id, Date.now());
  res.json(db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(info.lastInsertRowid));
});

app.post('/api/print-jobs/:id/stop', async (req, res) => {
  const job = db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });

  const endedAt = Date.now();
  const price = parseFloat(getSetting('power_price_eur_per_kwh', '0.35')) || 0;
  const baseUrl = getSetting('ha_base_url');
  const token = getSetting('ha_token');
  const entityId = getSetting('ha_energy_entity_id');

  let energyKwh = null, energyCost = null, energyError = null;
  if (!baseUrl || !token || !entityId) {
    energyError = 'ha_not_configured';
  } else {
    try {
      energyKwh = await ha.fetchEnergyDelta(baseUrl, token, entityId, job.started_at, endedAt);
      energyCost = energyKwh * price;
    } catch (err) {
      energyError = err.message;
    }
  }

  db.prepare(`
    UPDATE print_jobs SET ended_at = ?, status = 'done', energy_kwh = ?, energy_cost = ?, energy_error = ?
    WHERE id = ?
  `).run(endedAt, energyKwh, energyCost, energyError, req.params.id);

  res.json(db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id));
});

app.post('/api/print-jobs/:id/material', (req, res) => {
  const grams = req.body.filament_grams !== '' && req.body.filament_grams != null ? Number(req.body.filament_grams) : null;
  const pricePerKg = req.body.filament_price_per_kg !== '' && req.body.filament_price_per_kg != null ? Number(req.body.filament_price_per_kg) : null;
  const filamentCost = (grams != null && pricePerKg != null) ? (grams / 1000) * pricePerKg : null;

  db.prepare(`
    UPDATE print_jobs SET filament_grams = ?, filament_price_per_kg = ?, filament_cost = ?
    WHERE id = ?
  `).run(grams, pricePerKg, filamentCost, req.params.id);

  res.json(db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id));
});

app.delete('/api/print-jobs/:id', (req, res) => {
  db.prepare(`DELETE FROM print_jobs WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
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
