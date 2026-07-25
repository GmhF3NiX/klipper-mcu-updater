const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');
const db = require('./db');
const { scanLibrary, LIBRARY_PATH, THUMB_DIR } = require('./scanner');
const { getSetting, setSetting } = require('./settings');
const ha = require('./homeassistant');
const spoolman = require('./spoolman');
const { estimate } = require('./estimate');
const { hashFile } = require('./duplicates');

const PORT = process.env.PORT || 8420;
const app = express();
app.use(express.json({ limit: '5mb' })); // Thumbnail-Screenshots vom Client kommen als Base64-JSON

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
  const totalSizeBytes = db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) s FROM files`).get().s;
  const categories = db.prepare(`SELECT COUNT(*) c FROM categories`).get().c;
  res.json({ total, byExt, totalSizeBytes, categories, libraryPath: LIBRARY_PATH });
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
  const absPath = row.abs_path || path.join(LIBRARY_PATH, row.rel_path);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'file_missing_on_disk' });

  const download = req.query.download === '1';
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
  }
  res.sendFile(absPath);
});

// Client-seitig erzeugter Screenshot des 3D-Viewers (STL/OBJ haben kein eingebettetes
// Vorschaubild wie 3MF, siehe scanner.js) — wird als echtes Thumbnail übernommen.
app.post('/api/files/:id/thumbnail', (req, res) => {
  const row = db.prepare(`SELECT id FROM files WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const match = /^data:image\/png;base64,(.+)$/.exec(req.body.image || '');
  if (!match) return res.status(400).json({ error: 'invalid_image' });

  const outName = `${row.id}.png`;
  fs.writeFileSync(path.join(THUMB_DIR, outName), Buffer.from(match[1], 'base64'));
  db.prepare(`UPDATE files SET thumbnail = ? WHERE id = ?`).run(outName, row.id);
  res.json({ ok: true });
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

// ---- settings (Strompreis + Home-Assistant-Zugang + Spoolman) ----
app.get('/api/settings', (req, res) => {
  res.json({
    power_price_eur_per_kwh: getSetting('power_price_eur_per_kwh', '0.35'),
    ha_base_url: getSetting('ha_base_url', ''),
    ha_energy_entity_id: getSetting('ha_energy_entity_id', ''),
    ha_token_set: Boolean(getSetting('ha_token')),
    spoolman_base_url: getSetting('spoolman_base_url', ''),
  });
});

app.post('/api/settings', (req, res) => {
  const { power_price_eur_per_kwh, ha_base_url, ha_energy_entity_id, ha_token, spoolman_base_url } = req.body;
  if (power_price_eur_per_kwh !== undefined) setSetting('power_price_eur_per_kwh', String(power_price_eur_per_kwh));
  if (ha_base_url !== undefined) setSetting('ha_base_url', String(ha_base_url).trim());
  if (ha_energy_entity_id !== undefined) setSetting('ha_energy_entity_id', String(ha_energy_entity_id).trim());
  // Token nur überschreiben, wenn tatsächlich ein neuer eingegeben wurde —
  // sonst bliebe das Feld beim Speichern anderer Settings sonst leer.
  if (ha_token) setSetting('ha_token', String(ha_token).trim());
  if (spoolman_base_url !== undefined) setSetting('spoolman_base_url', String(spoolman_base_url).trim());
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

// ---- Spoolman (Spulen-Auswahl + automatischer Preis/kg, siehe /api/print-jobs/:id/material) ----
app.get('/api/settings/test-spoolman', async (req, res) => {
  const baseUrl = getSetting('spoolman_base_url');
  if (!baseUrl) return res.json({ ok: false, error: 'spoolman_not_configured' });
  try {
    const spools = await spoolman.fetchSpools(baseUrl);
    res.json({ ok: true, count: spools.length });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/spoolman/spools', async (req, res) => {
  const baseUrl = getSetting('spoolman_base_url');
  if (!baseUrl) return res.json([]);
  try {
    res.json(await spoolman.fetchSpools(baseUrl));
  } catch (err) {
    res.status(502).json({ error: err.message });
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

app.post('/api/print-jobs/:id/material', async (req, res) => {
  const grams = req.body.filament_grams !== '' && req.body.filament_grams != null ? Number(req.body.filament_grams) : null;
  let pricePerKg = req.body.filament_price_per_kg !== '' && req.body.filament_price_per_kg != null ? Number(req.body.filament_price_per_kg) : null;
  const spoolId = req.body.spool_id !== '' && req.body.spool_id != null ? Number(req.body.spool_id) : null;

  let filamentError = null;
  if (spoolId != null) {
    const baseUrl = getSetting('spoolman_base_url');
    if (!baseUrl) {
      filamentError = 'spoolman_not_configured';
    } else {
      try {
        // Preis/kg immer frisch von Spoolman holen statt dem, was das UI zuletzt anzeigte —
        // Spulenpreise/-zuordnungen können sich zwischen Öffnen und Speichern geändert haben.
        const spool = await spoolman.fetchOneSpool(baseUrl, spoolId);
        if (spool.price_per_kg != null) pricePerKg = spool.price_per_kg;
        if (grams != null) await spoolman.useSpool(baseUrl, spoolId, grams);
      } catch (err) {
        filamentError = err.message;
      }
    }
  }

  const filamentCost = (grams != null && pricePerKg != null) ? (grams / 1000) * pricePerKg : null;

  db.prepare(`
    UPDATE print_jobs SET filament_grams = ?, filament_price_per_kg = ?, filament_cost = ?, spoolman_spool_id = ?, filament_error = ?
    WHERE id = ?
  `).run(grams, pricePerKg, filamentCost, spoolId, filamentError, req.params.id);

  res.json(db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id));
});

app.delete('/api/print-jobs/:id', (req, res) => {
  db.prepare(`DELETE FROM print_jobs WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---- Druckprofile (für die Kosten-VOR-Schätzung per Faustformel) ----
app.get('/api/cost-profiles', (req, res) => {
  res.json(db.prepare(`SELECT * FROM cost_profiles ORDER BY name`).all());
});

app.post('/api/cost-profiles', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });

  const info = db.prepare(`
    INSERT INTO cost_profiles
      (name, layer_height_mm, infill_percent, wall_count, nozzle_diameter_mm, top_bottom_layers,
       print_speed_mm_s, speed_overhead_factor, printer_power_watts, filament_density_g_cm3,
       filament_price_eur_per_kg, created_at)
    VALUES (@name, @layer_height_mm, @infill_percent, @wall_count, @nozzle_diameter_mm, @top_bottom_layers,
       @print_speed_mm_s, @speed_overhead_factor, @printer_power_watts, @filament_density_g_cm3,
       @filament_price_eur_per_kg, @created_at)
  `).run({
    name,
    layer_height_mm: Number(req.body.layer_height_mm) || 0.2,
    infill_percent: Number(req.body.infill_percent) || 15,
    wall_count: Number(req.body.wall_count) || 3,
    nozzle_diameter_mm: Number(req.body.nozzle_diameter_mm) || 0.4,
    top_bottom_layers: Number(req.body.top_bottom_layers) || 4,
    print_speed_mm_s: Number(req.body.print_speed_mm_s) || 60,
    speed_overhead_factor: Number(req.body.speed_overhead_factor) || 1.3,
    printer_power_watts: Number(req.body.printer_power_watts) || 150,
    filament_density_g_cm3: Number(req.body.filament_density_g_cm3) || 1.24,
    filament_price_eur_per_kg: Number(req.body.filament_price_eur_per_kg) || 25,
    created_at: Date.now(),
  });
  res.json(db.prepare(`SELECT * FROM cost_profiles WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/cost-profiles/:id', (req, res) => {
  db.prepare(`DELETE FROM cost_profiles WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---- Kosten-VOR-Schätzung pro Datei (Faustformel aus Modellgeometrie + Profil, kein Slicing) ----
app.get('/api/files/:id/estimate', (req, res) => {
  res.json(db.prepare(`SELECT * FROM file_estimates WHERE file_id = ?`).get(req.params.id) || null);
});

app.post('/api/files/:id/estimate', async (req, res) => {
  const file = db.prepare(`SELECT id FROM files WHERE id = ?`).get(req.params.id);
  if (!file) return res.status(404).json({ error: 'not_found' });

  const { volumeMm3, surfaceAreaMm2, bboxX, bboxY, profileId, spoolId } = req.body;
  if (!volumeMm3 || !surfaceAreaMm2) return res.status(400).json({ error: 'geometry_required' });

  const profile = (profileId && db.prepare(`SELECT * FROM cost_profiles WHERE id = ?`).get(profileId))
    || db.prepare(`SELECT * FROM cost_profiles ORDER BY id LIMIT 1`).get();
  if (!profile) return res.status(400).json({ error: 'no_profile' });

  let densityGCm3 = profile.filament_density_g_cm3;
  let priceEurPerKg = profile.filament_price_eur_per_kg;

  if (spoolId) {
    const baseUrl = getSetting('spoolman_base_url');
    if (baseUrl) {
      try {
        const spool = await spoolman.fetchOneSpool(baseUrl, spoolId);
        if (spool.density_g_cm3 != null) densityGCm3 = spool.density_g_cm3;
        if (spool.price_per_kg != null) priceEurPerKg = spool.price_per_kg;
      } catch {
        // Spoolman gerade nicht erreichbar -> auf Profil-Werte zurückfallen, Schätzung trotzdem liefern
      }
    }
  }

  const powerPrice = parseFloat(getSetting('power_price_eur_per_kwh', '0.35')) || 0;
  const result = estimate({
    volumeMm3, surfaceAreaMm2, bboxX: bboxX || 0, bboxY: bboxY || 0,
    profile, densityGCm3, priceEurPerKg, powerPriceEurPerKwh: powerPrice,
  });

  db.prepare(`
    INSERT INTO file_estimates (file_id, profile_id, spool_id, filament_grams, print_minutes, filament_cost, energy_cost, total_cost, updated_at)
    VALUES (@file_id, @profile_id, @spool_id, @filament_grams, @print_minutes, @filament_cost, @energy_cost, @total_cost, @updated_at)
    ON CONFLICT(file_id) DO UPDATE SET
      profile_id = excluded.profile_id, spool_id = excluded.spool_id, filament_grams = excluded.filament_grams,
      print_minutes = excluded.print_minutes, filament_cost = excluded.filament_cost, energy_cost = excluded.energy_cost,
      total_cost = excluded.total_cost, updated_at = excluded.updated_at
  `).run({
    file_id: req.params.id, profile_id: profile.id, spool_id: spoolId || null,
    filament_grams: result.filamentGrams, print_minutes: result.printMinutes,
    filament_cost: result.filamentCost, energy_cost: result.energyCost, total_cost: result.totalCost,
    updated_at: Date.now(),
  });

  res.json(db.prepare(`SELECT * FROM file_estimates WHERE file_id = ?`).get(req.params.id));
});

// ---- weitere Bibliotheks-Wurzeln ----
// Im Docker-Container (immer Linux) darf nur unter dem read-only /hostshares-Mount
// hinzugefügt werden, weil der Container sonst gar keinen anderen Host-Pfad sehen kann.
// Nativ installiert (z.B. Windows) gibt es diese Sandbox nicht — dort ist jeder existierende
// Ordner direkt erreichbar, subpath ist dann schon der vollständige Pfad.
const HOSTSHARES_PATH = process.env.HOSTSHARES_PATH || '/hostshares';
const IS_SANDBOXED = process.platform !== 'win32';

app.get('/api/runtime-info', (req, res) => {
  res.json({ sandboxed: IS_SANDBOXED, platform: process.platform });
});

// ---- Server-seitiger Ordner-Browser fürs "+ ORDNER"-Modal ----
// Ein natives Windows-Dateiauswahlfenster im Browser gibt es aus Sicherheitsgründen nicht (und
// würde bei Docker/Fernzugriff ohnehin den falschen Rechner durchsuchen) - stattdessen läuft die
// Ordnerauswahl serverseitig, exakt auf der Maschine, wo der Pfad später auch gescannt wird.
function listWindowsDrives() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const drive = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(drive)) drives.push(drive); } catch { /* Laufwerk nicht bereit */ }
  }
  return drives;
}

app.get('/api/browse-folders', (req, res) => {
  let reqPath = (req.query.path || '').trim();

  if (!reqPath) {
    if (!IS_SANDBOXED) {
      return res.json({ path: '', parent: null, folders: [], drives: listWindowsDrives() });
    }
    reqPath = HOSTSHARES_PATH;
  }

  const resolved = path.resolve(reqPath);
  const base = path.resolve(HOSTSHARES_PATH);
  if (IS_SANDBOXED && resolved !== base && !resolved.startsWith(base + path.sep)) {
    return res.status(400).json({ error: 'path_outside_hostshares' });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'not_a_directory' });
  }

  let folders = [];
  try {
    folders = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => { try { return e.isDirectory(); } catch { return false; } })
      .map(e => e.name)
      .filter(name => !name.startsWith('$'))
      .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  } catch { /* z.B. keine Leserechte - einfach leere Liste zeigen */ }

  const isWinRoot = !IS_SANDBOXED && path.parse(resolved).root === resolved;
  let parent = null;
  if (IS_SANDBOXED) {
    parent = resolved === base ? null : path.dirname(resolved);
  } else {
    parent = isWinRoot ? '' : path.dirname(resolved);
  }

  res.json({ path: resolved, parent, folders, drives: null });
});

app.get('/api/library-roots', (req, res) => {
  const roots = db.prepare(`SELECT * FROM library_roots ORDER BY id`).all();
  const counts = db.prepare(`SELECT root_id, COUNT(*) c FROM files GROUP BY root_id`).all();
  const countByRoot = Object.fromEntries(counts.map(c => [c.root_id, c.c]));
  res.json(roots.map(r => ({
    ...r,
    isPrimary: r.path === LIBRARY_PATH,
    fileCount: countByRoot[r.id] || 0,
  })));
});

app.post('/api/library-roots', (req, res) => {
  const label = (req.body.label || '').trim();
  const subpath = (req.body.subpath || '').trim();
  if (!label || !subpath) return res.status(400).json({ error: 'label_and_subpath_required' });

  let resolved;
  if (IS_SANDBOXED) {
    resolved = path.resolve(HOSTSHARES_PATH, subpath);
    if (!resolved.startsWith(path.resolve(HOSTSHARES_PATH) + path.sep)) {
      return res.status(400).json({ error: 'path_outside_hostshares' });
    }
  } else {
    resolved = path.resolve(subpath);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'not_a_directory' });
  }

  try {
    const info = db.prepare(`INSERT INTO library_roots (path, label, added_at) VALUES (?, ?, ?)`)
      .run(resolved, label, Date.now());
    const scanResult = scanLibrary();
    res.json({ ok: true, root: db.prepare(`SELECT * FROM library_roots WHERE id = ?`).get(info.lastInsertRowid), ...scanResult });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'path_already_added' });
    throw err;
  }
});

app.delete('/api/library-roots/:id', (req, res) => {
  const root = db.prepare(`SELECT * FROM library_roots WHERE id = ?`).get(req.params.id);
  if (!root) return res.status(404).json({ error: 'not_found' });
  if (root.path === LIBRARY_PATH) return res.status(400).json({ error: 'cannot_delete_primary_root' });

  db.prepare(`DELETE FROM files WHERE root_id = ?`).run(root.id);
  db.prepare(`DELETE FROM library_roots WHERE id = ?`).run(root.id);
  res.json({ ok: true });
});

// ---- Statistik-Dashboard (aus den bereits erfassten print_jobs) ----
app.get('/api/dashboard-stats', (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) prints,
      COALESCE(SUM(COALESCE(energy_cost,0) + COALESCE(filament_cost,0)), 0) as total_cost,
      COALESCE(SUM(filament_grams), 0) as total_grams,
      COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at ELSE 0 END), 0) as total_ms
    FROM print_jobs WHERE status = 'done'
  `).get();

  const monthlyRaw = db.prepare(`
    SELECT strftime('%Y-%m', started_at / 1000, 'unixepoch') as month,
      COALESCE(SUM(COALESCE(energy_cost,0) + COALESCE(filament_cost,0)), 0) as cost
    FROM print_jobs WHERE status = 'done'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();
  const monthly = monthlyRaw.reverse();

  const topCategories = db.prepare(`
    SELECT c.name, COUNT(*) c
    FROM print_jobs pj
    JOIN file_categories fc ON fc.file_id = pj.file_id
    JOIN categories c ON c.id = fc.category_id
    WHERE pj.status = 'done'
    GROUP BY c.id ORDER BY c DESC LIMIT 8
  `).all();

  const topFiles = db.prepare(`
    SELECT f.id, f.filename, COUNT(*) c
    FROM print_jobs pj JOIN files f ON f.id = pj.file_id
    WHERE pj.status = 'done'
    GROUP BY pj.file_id ORDER BY c DESC LIMIT 8
  `).all();

  res.json({ totals, monthly, topCategories, topFiles });
});

// ---- Duplikat-Erkennung (SHA-256 pro Datei, nur auf Anfrage — App liest/ändert sonst nichts) ----
let hashScanState = { running: false, done: 0, total: 0 };

app.post('/api/duplicates/scan', (req, res) => {
  if (hashScanState.running) return res.json({ ok: true, alreadyRunning: true, ...hashScanState });

  const pending = db.prepare(`SELECT id, abs_path FROM files WHERE content_hash IS NULL`).all();
  hashScanState = { running: true, done: 0, total: pending.length };
  res.json({ ok: true, total: pending.length });

  (async () => {
    const setHash = db.prepare(`UPDATE files SET content_hash = ? WHERE id = ?`);
    for (const f of pending) {
      try {
        setHash.run(await hashFile(f.abs_path), f.id);
      } catch (err) {
        console.warn(`Hash fehlgeschlagen für ${f.abs_path}: ${err.message}`);
      }
      hashScanState.done++;
    }
    hashScanState.running = false;
  })();
});

app.get('/api/duplicates/scan-status', (req, res) => {
  res.json(hashScanState);
});

app.get('/api/duplicates', (req, res) => {
  const groups = db.prepare(`
    SELECT content_hash, COUNT(*) c FROM files
    WHERE content_hash IS NOT NULL GROUP BY content_hash HAVING c > 1
  `).all();
  const getFiles = db.prepare(`SELECT id, filename, rel_path, size_bytes FROM files WHERE content_hash = ? ORDER BY filename`);
  res.json(groups.map(g => ({ hash: g.content_hash, files: getFiles.all(g.content_hash) })));
});

// Öffnet den Datei-Explorer mit der Datei markiert - macht nur Sinn, wenn Server und Browser auf
// derselben Maschine laufen (native Windows-Installation), nicht bei Docker/Fernzugriff, wo der
// Server einen ganz anderen Rechner meint als den, vor dem der Nutzer sitzt.
app.post('/api/files/:id/reveal', (req, res) => {
  if (IS_SANDBOXED) return res.status(400).json({ error: 'not_supported' });

  const row = db.prepare(`SELECT abs_path, rel_path FROM files WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const absPath = row.abs_path || path.join(LIBRARY_PATH, row.rel_path);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'file_missing_on_disk' });

  // explorer.exe liefert auch bei Erfolg oft einen Exit-Code != 0 zurück (bekannte Windows-
  // Eigenheit) - der Callback-Fehler ist deshalb kein verlässliches Erfolgssignal, wird ignoriert.
  execFile('explorer.exe', [`/select,${absPath}`], () => {});
  res.json({ ok: true });
});

app.post('/api/rescan', (req, res) => {
  const result = scanLibrary();
  res.json({ ok: true, ...result });
});

// ---- startup ----
// Einmalige Vorbelegung aus dem Windows-Installer (siehe windows-installer/PrintArchive.iss):
// dort eingegebene Spoolman-/Home-Assistant-Adressen kommen als Env-Vars vom Launcher-Batch.
// Nur setzen, wenn noch kein Wert in der DB steht — überschreibt also nie spätere Änderungen
// über das ⚙-Einstellungen-Modal.
if (process.env.SPOOLMAN_BASE_URL && !getSetting('spoolman_base_url')) {
  setSetting('spoolman_base_url', process.env.SPOOLMAN_BASE_URL);
}
if (process.env.HA_BASE_URL && !getSetting('ha_base_url')) {
  setSetting('ha_base_url', process.env.HA_BASE_URL);
}

scanLibrary();
const RESCAN_INTERVAL_MS = Number(process.env.RESCAN_INTERVAL_MINUTES || 15) * 60 * 1000;
setInterval(scanLibrary, RESCAN_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`3D-Print Archive läuft auf Port ${PORT}, Bibliothek: ${LIBRARY_PATH}`);
});
