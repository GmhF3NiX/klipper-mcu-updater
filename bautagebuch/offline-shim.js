/* Offline-Speicher für das Bautagebuch: bildet die claude.ai-Schnittstellen
   (db, assets, downloads, user) mit IndexedDB im Browser nach. */
(() => {
  const DB_NAME = 'bautagebuch-eg', VERSION = 1;
  const docs = new Map();          // "coll/id" -> {c, id, data}
  const blobs = new Map();         // id -> {type, url}
  const collSubs = new Set();      // {c, next}
  const docSubs = new Set();       // {key, next}
  let idb = null;

  const clone = v => JSON.parse(JSON.stringify(v));
  const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const meta = { fromCache: false, hasPendingWrites: false };
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data, metadata: meta });

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => { r.result.createObjectStore('docs'); r.result.createObjectStore('blobs'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = idb.transaction(store, mode); const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
  const all = store => new Promise((res, rej) => {
    const out = []; const r = idb.transaction(store).objectStore(store).openCursor();
    r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
    r.onerror = () => rej(r.error);
  });

  function querySnap(c) {
    const list = [...docs.values()].filter(d => d.c === c).sort((a, b) => a.id.localeCompare(b.id));
    const ds = list.map(d => snap(d.id, d.data));
    return { docs: ds, size: ds.length, empty: !ds.length, metadata: meta, docChanges: () => [] };
  }
  function notify(c, key) {
    queueMicrotask(() => {
      collSubs.forEach(s => { if (s.c === c) s.next(querySnap(c)); });
      docSubs.forEach(s => { if (s.key === key) { const d = docs.get(key); s.next(snap(key.split('/').pop(), d && d.data)); } });
    });
  }
  async function write(c, id, data) {
    const key = c + '/' + id;
    if (data === undefined) { docs.delete(key); await tx('docs', 'readwrite', s => s.delete(key)); }
    else { const v = { c, id, data: Object.freeze(clone(data)) }; docs.set(key, v); await tx('docs', 'readwrite', s => s.put({ c, id, data: v.data }, key)); }
    notify(c, key);
  }

  function docRef(c, id) {
    const key = c + '/' + id;
    return {
      id, path: key,
      get: async () => snap(id, docs.get(key) && docs.get(key).data),
      set: data => write(c, id, data),
      update: async data => {
        const cur = docs.get(key);
        if (!cur) throw { code: 'invalid_argument', message: 'Dokument existiert nicht' };
        await write(c, id, Object.assign(clone(cur.data), clone(data)));
      },
      delete: () => write(c, id, undefined),
      onSnapshot(next) {
        const s = { key, next }; docSubs.add(s);
        queueMicrotask(() => { const d = docs.get(key); next(snap(id, d && d.data)); });
        return () => docSubs.delete(s);
      },
      collection: sub => collRef(key + '/' + sub),
      acquire: async () => ({ acquired: true }),
    };
  }
  function collRef(c) {
    const q = {
      path: c,
      doc: id => docRef(c, id || rid()),
      add: async data => { const r = docRef(c, rid()); await r.set(data); return r; },
      where: () => q, orderBy: () => q, limit: () => q,
      get: async () => querySnap(c),
      onSnapshot(next) {
        const s = { c, next }; collSubs.add(s);
        queueMicrotask(() => next(querySnap(c)));
        return () => collSubs.delete(s);
      },
    };
    return q;
  }
  const db = {
    collection: collRef,
    doc: path => { const i = path.lastIndexOf('/'); return docRef(path.slice(0, i), path.slice(i + 1)); },
  };

  const assets = {
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || 'application/octet-stream';
      const id = hex32();
      await tx('blobs', 'readwrite', s => s.put({ type, blob }, id));
      const url = URL.createObjectURL(blob);
      blobs.set(id, { type, url });
      return { id, url, sizeBytes: blob.size, contentType: type };
    },
    async delete(id) {
      const had = blobs.has(id);
      if (had) URL.revokeObjectURL(blobs.get(id).url);
      blobs.delete(id); await tx('blobs', 'readwrite', s => s.delete(id));
      return { deleted: had };
    },
    async list() {
      return { assets: [...blobs.entries()].map(([id, b]) => ({ id, url: b.url, contentType: b.type, sizeBytes: 0, createdAt: '' })), usage: { files: blobs.size, bytes: 0, maxFiles: 1e9, maxBytes: 1e12 } };
    },
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: 'saved' };
    },
  };
  const user = { isOwner: () => true, canEdit: () => true, can: () => true, id: async () => 'offline', me: async () => ({ id: 'offline', name: '' }) };

  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  async function exportBackup() {
    const out = { app: 'bautagebuch-eg', version: 1, exported: new Date().toISOString(), docs: [], blobs: [] };
    docs.forEach(d => out.docs.push({ c: d.c, id: d.id, data: d.data }));
    for (const [id, v] of await all('blobs')) out.blobs.push({ id, type: v.type, data: await b64(v.blob) });
    const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await downloads.save({ filename: `Bautagebuch-Backup-${stamp}.json`, data: new Blob([JSON.stringify(out)], { type: 'application/json' }) });
    return true;
  }
  async function importBackup(file) {
    const j = JSON.parse(await file.text());
    if (!j || j.app !== 'bautagebuch-eg' || !Array.isArray(j.docs)) throw new Error('keine Bautagebuch-Sicherung');
    for (const b of j.blobs || []) {
      const bin = Uint8Array.from(atob(b.data), ch => ch.charCodeAt(0));
      const blob = new Blob([bin], { type: b.type });
      await tx('blobs', 'readwrite', s => s.put({ type: b.type, blob }, b.id));
      if (blobs.has(b.id)) URL.revokeObjectURL(blobs.get(b.id).url);
      blobs.set(b.id, { type: b.type, url: URL.createObjectURL(blob) });
    }
    for (const d of j.docs) await write(d.c, d.id, d.data);
    return j.docs.length;
  }

  const ready = (async () => {
    idb = await open();
    for (const [key, v] of await all('docs')) docs.set(key, { c: v.c, id: v.id, data: Object.freeze(v.data) });
    for (const [id, v] of await all('blobs')) blobs.set(id, { type: v.type, url: URL.createObjectURL(v.blob) });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  })();

  const caps = { db, assets, downloads, user };
  window.__offline = { blobUrl: id => (blobs.get(id) || {}).url || '', exportBackup, importBackup };
  window.claude = { use: async name => { try { await ready; } catch (e) { return null; } return caps[name] || null; } };
})();
