import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const grid = document.getElementById('grid');
const emptyMsg = document.getElementById('empty');
const statTilesEl = document.getElementById('statTiles');
const searchInput = document.getElementById('search');
const extFilter = document.getElementById('extFilter');
const tagFilter = document.getElementById('tagFilter');
const rescanBtn = document.getElementById('rescanBtn');
const folderTreeEl = document.getElementById('folderTree');
const categoryListEl = document.getElementById('categoryList');
const newCategoryInput = document.getElementById('newCategory');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const categoryOptionsEl = document.getElementById('categoryOptions');

let currentFile = null;
let activeFolder = ''; // '' = alle, '/' = nur root, sonst rel_path-Präfix
let activeCategory = ''; // '' = alle, sonst category id

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 ** 2).toFixed(1) + ' MB';
}

function fmtGb(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

async function loadStats() {
  const s = await fetch('/api/stats').then(r => r.json());
  statTilesEl.innerHTML = `
    <div class="stat-tile" style="--tile-color:var(--magenta)"><div class="num">${s.total}</div><div class="label">Dateien</div></div>
    <div class="stat-tile" style="--tile-color:var(--cyan)"><div class="num">${fmtGb(s.totalSizeBytes)}</div><div class="label">GB Bibliothek</div></div>
    <div class="stat-tile" style="--tile-color:var(--amber)"><div class="num">${s.categories}</div><div class="label">Kategorien</div></div>
  `;
  statTilesEl.title = s.byExt.map(e => `${e.ext.toUpperCase()}: ${e.c}`).join(' · ') + `\n${s.libraryPath}`;
}

async function loadTags() {
  const tags = await fetch('/api/tags').then(r => r.json());
  tagFilter.innerHTML = '<option value="">alle tags</option>' +
    tags.map(t => `<option value="${t}">${t}</option>`).join('');
}

// Ordner werden standardmäßig eingeklappt gerendert (bei tief verschachtelten Bibliotheken
// sonst komplett unübersichtlich) — nur die Vorfahren des gerade aktiven Ordners bleiben offen,
// alles andere klappt man per Klick auf das Pfeilchen selbst auf.
let expandedFolders = new Set();

function isAncestorOfActive(path) {
  if (path === '' || path === activeFolder) return true;
  return activeFolder.startsWith(path + '/');
}

function renderFolderNode(node) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = hasChildren && (expandedFolders.has(node._filterValue) || isAncestorOfActive(node._filterValue));

  const row = document.createElement('div');
  row.className = 'folder-row' + (activeFolder === node._filterValue ? ' active' : '');
  row.innerHTML = `
    <span class="folder-label">
      <span class="folder-caret" style="${hasChildren ? '' : 'visibility:hidden'}">${isExpanded ? '▾' : '▸'}</span>
      <span class="folder-name">${node.label}</span>
    </span>
    <span class="count">${node.count}</span>
  `;
  row.addEventListener('click', (e) => {
    if (hasChildren && e.target.classList.contains('folder-caret')) {
      if (expandedFolders.has(node._filterValue)) expandedFolders.delete(node._filterValue);
      else expandedFolders.add(node._filterValue);
      loadFolders();
      return;
    }
    activeFolder = node._filterValue;
    loadFiles();
    loadFolders();
  });

  const wrap = document.createElement('div');
  wrap.appendChild(row);

  if (isExpanded) {
    const childWrap = document.createElement('div');
    childWrap.className = 'folder-children';
    node.children.forEach(c => childWrap.appendChild(renderFolderNode(c)));
    wrap.appendChild(childWrap);
  }
  return wrap;
}

async function loadFolders() {
  const tree = await fetch('/api/folders').then(r => r.json());
  folderTreeEl.innerHTML = '';

  const allNode = { label: '◆ ALLE DATEIEN', count: tree.count, _filterValue: '', children: [] };
  folderTreeEl.appendChild(renderFolderNode(allNode, 0));

  // Dateien direkt im Wurzelordner (ohne Unterordner) als eigener Eintrag, nur falls vorhanden
  const rootFileCount = tree.count - tree.children.reduce((s, c) => s + c.count, 0);
  if (rootFileCount > 0) {
    const rootNode = { label: '— (ohne Ordner)', count: rootFileCount, _filterValue: '/', children: [] };
    folderTreeEl.appendChild(renderFolderNode(rootNode, 0));
  }

  function mapChildren(children) {
    return children.map(c => ({
      label: c.name,
      count: c.count,
      _filterValue: c.path,
      children: mapChildren(c.children),
    }));
  }
  mapChildren(tree.children).forEach(n => folderTreeEl.appendChild(renderFolderNode(n, 0)));
}

async function loadCategories() {
  const categories = await fetch('/api/categories').then(r => r.json());

  categoryListEl.innerHTML = '';
  const allRow = document.createElement('div');
  allRow.className = 'cat-row' + (activeCategory === '' ? ' active' : '');
  allRow.innerHTML = `<span class="cat-label">◆ ALLE</span>`;
  allRow.addEventListener('click', () => { activeCategory = ''; loadFiles(); loadCategories(); });
  categoryListEl.appendChild(allRow);

  if (!categories.length) {
    const empty = document.createElement('div');
    empty.className = 'cat-empty';
    empty.textContent = 'noch keine kategorien';
    categoryListEl.appendChild(empty);
  }

  for (const c of categories) {
    const row = document.createElement('div');
    row.className = 'cat-row' + (activeCategory === String(c.id) ? ' active' : '');
    row.innerHTML = `
      <span class="cat-label">${c.name}</span>
      <span class="count">${c.count}</span>
      <span class="cat-del" title="Kategorie löschen">×</span>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('cat-del')) return;
      activeCategory = activeCategory === String(c.id) ? '' : String(c.id);
      loadFiles();
      loadCategories();
    });
    row.querySelector('.cat-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Kategorie "${c.name}" wirklich löschen?`)) return;
      await fetch(`/api/categories/${c.id}`, { method: 'DELETE' });
      if (activeCategory === String(c.id)) activeCategory = '';
      loadFiles(); loadCategories();
    });
    categoryListEl.appendChild(row);
  }

  categoryOptionsEl.innerHTML = categories.map(c => `<option value="${c.name}">`).join('');
}

async function createCategory() {
  const name = newCategoryInput.value.trim();
  if (!name) return;
  await fetch('/api/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  newCategoryInput.value = '';
  loadCategories();
}
addCategoryBtn.addEventListener('click', createCategory);
newCategoryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createCategory(); });

function extIcon(ext) {
  return ext.toUpperCase();
}

function renderCard(f) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="thumb">
      ${f.thumbnail
        ? `<img src="/api/files/${f.id}/thumbnail" loading="lazy">`
        : `<span class="ext-badge">${extIcon(f.ext)}</span>`}
    </div>
    <div class="card-body">
      <div class="card-name">${f.filename}</div>
      <div class="card-meta"><span>${f.ext.toUpperCase()}</span><span>${fmtBytes(f.size_bytes)}</span></div>
      <div class="card-tags">${f.tags.map(t => `<span class="chip">${t}</span>`).join('')}</div>
    </div>
  `;
  el.addEventListener('click', () => openModal(f));
  return el;
}

async function loadFiles() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (extFilter.value) params.set('ext', extFilter.value);
  if (tagFilter.value) params.set('tag', tagFilter.value);
  if (activeFolder) params.set('folder', activeFolder);
  if (activeCategory) params.set('category', activeCategory);

  const files = await fetch('/api/files?' + params.toString()).then(r => r.json());
  grid.innerHTML = '';
  emptyMsg.style.display = files.length ? 'none' : 'block';
  for (const f of files) grid.appendChild(renderCard(f));
}

let debounceTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadFiles, 250);
});
extFilter.addEventListener('change', loadFiles);
tagFilter.addEventListener('change', loadFiles);

rescanBtn.addEventListener('click', async () => {
  rescanBtn.textContent = '… SCANNING';
  rescanBtn.disabled = true;
  await fetch('/api/rescan', { method: 'POST' });
  await Promise.all([loadFiles(), loadStats(), loadTags(), loadFolders(), loadCategories()]);
  rescanBtn.textContent = '↻ RESCAN';
  rescanBtn.disabled = false;
});

// ---------- weitere Bibliotheks-Ordner (zusätzliche Wurzeln unter /hostshares) ----------
const manageRootsBtn = document.getElementById('manageRootsBtn');
const rootsBackdrop = document.getElementById('rootsBackdrop');
const closeRootsBtn = document.getElementById('closeRoots');
const rootsListEl = document.getElementById('rootsList');
const nrLabelInput = document.getElementById('nrLabel');
const nrSubpathInput = document.getElementById('nrSubpath');
const createRootBtn = document.getElementById('createRootBtn');
const rootsStatus = document.getElementById('rootsStatus');

async function renderRootsList() {
  const roots = await fetch('/api/library-roots').then(r => r.json());
  rootsListEl.innerHTML = roots.map(r => `
    <div class="profile-row" data-id="${r.id}">
      <span>${r.isPrimary ? '◆ ' : ''}${r.label} — ${r.fileCount} Datei(en)<br>
        <span style="color:var(--dim); font-size:10px;">${r.path}</span></span>
      ${r.isPrimary ? '' : '<button class="pdel" title="Ordner entfernen (Dateien werden aus der Bibliothek entfernt, nicht gelöscht)">×</button>'}
    </div>
  `).join('');

  rootsListEl.querySelectorAll('.profile-row .pdel').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.profile-row');
      if (!confirm('Ordner aus der Bibliothek entfernen? Die Dateien auf der Platte bleiben unangetastet.')) return;
      await fetch(`/api/library-roots/${row.dataset.id}`, { method: 'DELETE' });
      await renderRootsList();
      await Promise.all([loadFiles(), loadStats(), loadFolders()]);
    });
  });
}

let runtimeInfo = null;

manageRootsBtn.addEventListener('click', async () => {
  rootsStatus.textContent = '';
  if (!runtimeInfo) {
    runtimeInfo = await fetch('/api/runtime-info').then(r => r.json()).catch(() => ({ sandboxed: true }));
    if (!runtimeInfo.sandboxed) {
      document.getElementById('nrSubpathLabel').textContent = 'VOLLSTÄNDIGER ORDNERPFAD';
      nrSubpathInput.placeholder = 'z.B. D:\\Modelle oder C:\\Users\\du\\Documents\\STL';
      document.getElementById('rootsHint').innerHTML =
        'Gib hier einen vollständigen Ordnerpfad auf diesem Rechner an. Der Ordner wird beim ' +
        'Hinzufügen sofort eingescannt und erscheint als eigener Top-Level-Ordner im Baum links.';
    }
  }
  await renderRootsList();
  rootsBackdrop.classList.add('open');
});
closeRootsBtn.addEventListener('click', () => rootsBackdrop.classList.remove('open'));
rootsBackdrop.addEventListener('click', (e) => { if (e.target === rootsBackdrop) rootsBackdrop.classList.remove('open'); });

createRootBtn.addEventListener('click', async () => {
  const label = nrLabelInput.value.trim();
  const subpath = nrSubpathInput.value.trim();
  if (!label || !subpath) {
    rootsStatus.textContent = '✗ Name und Pfad sind beide Pflichtfelder';
    rootsStatus.className = 'ha-status err';
    (!label ? nrLabelInput : nrSubpathInput).focus();
    return;
  }
  createRootBtn.disabled = true;
  rootsStatus.textContent = 'scanne…';
  rootsStatus.className = 'ha-status';
  const res = await fetch('/api/library-roots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, subpath }),
  });
  const data = await res.json();
  createRootBtn.disabled = false;
  if (res.ok) {
    rootsStatus.textContent = `✓ hinzugefügt — ${data.count} Dateien insgesamt`;
    rootsStatus.className = 'ha-status ok';
    nrLabelInput.value = '';
    nrSubpathInput.value = '';
    await renderRootsList();
    await Promise.all([loadFiles(), loadStats(), loadFolders()]);
  } else {
    const messages = {
      not_a_directory: 'Pfad existiert nicht oder ist kein Ordner (relativ zu /mnt/user)',
      path_outside_hostshares: 'Pfad liegt außerhalb von /mnt/user',
      path_already_added: 'Dieser Ordner ist schon in der Bibliothek',
      label_and_subpath_required: 'Name und Pfad ausfüllen',
    };
    rootsStatus.textContent = `✗ ${messages[data.error] || data.error}`;
    rootsStatus.className = 'ha-status err';
  }
});

// ---------- modal + 3D viewer ----------
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalMeta = document.getElementById('modalMeta');
const modalTags = document.getElementById('modalTags');
const closeModalBtn = document.getElementById('closeModal');
const downloadBtn = document.getElementById('downloadBtn');
const rawBtn = document.getElementById('rawBtn');
const newTagInput = document.getElementById('newTag');
const addTagBtn = document.getElementById('addTagBtn');
const viewerEl = document.getElementById('viewer');
const modalCategories = document.getElementById('modalCategories');
const newCategoryForFileInput = document.getElementById('newCategoryForFile');
const addCategoryForFileBtn = document.getElementById('addCategoryForFileBtn');

let renderer, scene, camera, controls, composer, animFrame, currentMesh;

function initViewer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060a);

  camera = new THREE.PerspectiveCamera(45, viewerEl.clientWidth / viewerEl.clientHeight, 0.1, 5000);
  camera.position.set(60, 60, 60);

  // preserveDrawingBuffer: ohne das liefert toDataURL() (für die Auto-Thumbnails weiter unten)
  // je nach Browser einen bereits geleerten/falschen Buffer statt des gerenderten Bildes.
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewerEl.innerHTML = '';
  viewerEl.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0x88ffff, 0x220022, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.3);
  dir.position.set(1, 1, 1);
  scene.add(dir);

  controls = new OrbitControls(camera, renderer.domElement);
  // Wie OrcaSlicer: kein Nachlaufen/Trägheit nach dem Loslassen, direktes 1:1-Drehen/Verschieben,
  // Links=Drehen, Rechts=Verschieben, Scrollrad=Zoom (letzteres ist OrbitControls-Standard).
  controls.enableDamping = false;
  controls.rotateSpeed = -1.3; // negativ = Drehrichtung umgekehrt (nach rechts ziehen dreht jetzt gegen den Uhrzeigersinn)
  controls.panSpeed = 1.2;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.zoomSpeed = 8; // Standard (1) fühlte sich beim Scrollen viel zu fein/langsam an, 3 reichte auch noch nicht

  // Echter Neon-Glow (Bloom) statt nur einer hellen Farbe — das Modell-Material ist emissiv
  // (siehe materialCyber), die helleren Pixel bluten hier über den Modell-Rand hinaus aus.
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(viewerEl.clientWidth, viewerEl.clientHeight), 0.4, 0.25, 0.55
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  animate();
}

function animate() {
  animFrame = requestAnimationFrame(animate);
  controls.update();
  composer.render();
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  // Ein leeres Box3 (kein Mesh mit Geometrie im Objekt gefunden — z.B. wenn ein Loader nichts
  // Sichtbares zurückgibt) hat min=+Infinity/max=-Infinity, was Größe/Center zu NaN/-Infinity
  // macht. Ohne Absicherung landet die Kamera dann auf einer ungültigen Position und man sieht
  // buchstäblich nichts, ohne jeden Hinweis warum. Fallback: Modell bleibt am Ursprung, Kamera
  // auf eine feste, sichtbare Distanz.
  if (!box.isEmpty() && Number.isFinite(box.min.x) && Number.isFinite(box.max.x)) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    object.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2;
    camera.position.set(dist, dist, dist);
  } else {
    console.warn('frameObject: keine sichtbare Geometrie gefunden, benutze Standard-Ansicht');
    camera.position.set(100, 100, 100);
  }
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

function clearMesh() {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }
}

// emissive sorgt dafür, dass das Material selbst "leuchtet" — zusammen mit dem Bloom-Pass in
// initViewer() ergibt das den Neon-Glow-Look statt nur einer hellen Farbe.
// side: DoubleSide als zusätzliche Absicherung gegen invertierte Wickelrichtung in manchen
// Dateien (die eigentliche Ursache für komplett schwarze 3MF-Renders war aber fehlende
// Normalen, siehe ensureNormals() unten).
const materialCyber = new THREE.MeshStandardMaterial({
  color: 0xf0575a, metalness: 0.15, roughness: 0.35, flatShading: false,
  emissive: 0xf0575a, emissiveIntensity: 0.35, side: THREE.DoubleSide,
});

// ThreeMFLoader liefert (anders als STLLoader/OBJLoader) Geometrie ohne "normal"-Attribut, da
// das 3MF-Format keine Normalen speichert. MeshStandardMaterial braucht sie für die Beleuchtung
// — ohne sie bleibt das Modell komplett schwarz/unsichtbar, obwohl Mesh und Kamera korrekt sind.
function ensureNormals(object) {
  object.traverse(child => {
    if (child.isMesh && child.geometry && !child.geometry.attributes.normal) {
      child.geometry.computeVertexNormals();
    }
  });
}

// STL/OBJ haben nie ein eingebettetes Vorschaubild (anders als 3MF, siehe scanner.js) — sobald
// der Viewer das Modell fertig gerahmt hat, schnappen wir uns stattdessen einen Screenshot des
// Canvas und speichern ihn serverseitig als Thumbnail. Läuft auch als Fallback für 3MF-Dateien,
// deren eingebettetes Preview-PNG sich nicht extrahieren ließ.
// Der Viewer-Canvas ist nicht quadratisch (volle Modal-Breite × 360px) — mittig auf ein
// Quadrat zuschneiden statt das per CSS object-fit:cover unkontrolliert verzerren/abschneiden
// zu lassen, damit das Objekt im Grid mittig und vollständig zu sehen ist.
function canvasToSquareDataUrl(canvas, outSize = 512) {
  const size = Math.min(canvas.width, canvas.height);
  const sx = (canvas.width - size) / 2;
  const sy = (canvas.height - size) / 2;
  const out = document.createElement('canvas');
  out.width = outSize;
  out.height = outSize;
  out.getContext('2d').drawImage(canvas, sx, sy, size, size, 0, 0, outSize, outSize);
  return out.toDataURL('image/png');
}

async function uploadThumbnail(fileId, dataUrl) {
  const res = await fetch(`/api/files/${fileId}/thumbnail`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  return res.ok;
}

function maybeCaptureThumbnail(f) {
  if (f.thumbnail) return;
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    if (currentFile?.id !== f.id) return; // Modal wurde inzwischen gewechselt/geschlossen
    composer.render(); // sicherstellen, dass der Buffer den aktuellen (Bloom-)Frame zeigt
    const dataUrl = canvasToSquareDataUrl(renderer.domElement);
    try {
      if (await uploadThumbnail(f.id, dataUrl)) {
        f.thumbnail = 'generated';
        loadFiles();
      }
    } catch {
      // beste Bemühung — kein Vorschaubild ist kein kritischer Fehler
    }
  }));
}

// ---------- Batch-Generierung für alle Dateien ohne Vorschaubild ----------
// Läuft in einem eigenen Offscreen-Renderer (unabhängig vom Modal-Viewer), damit man nicht
// jede der >1000 Dateien einzeln öffnen muss, nur um ein Thumbnail zu bekommen.
const genThumbsBtn = document.getElementById('genThumbsBtn');
const genThumbsStatus = document.getElementById('genThumbsStatus');
let batchScene, batchCamera, batchRenderer, batchComposer, batchRunning = false;

function initBatchRenderer() {
  batchScene = new THREE.Scene();
  batchScene.background = new THREE.Color(0x04060a);
  batchCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  batchRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  batchRenderer.setSize(320, 320);
  batchRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  batchScene.add(new THREE.HemisphereLight(0x88ffff, 0x220022, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.3);
  dir.position.set(1, 1, 1);
  batchScene.add(dir);

  // Gleicher Bloom-Look wie im Hauptviewer (initViewer), damit Batch-generierte Thumbnails
  // genauso neon-rot glühen wie beim manuellen Öffnen einer Datei.
  batchComposer = new EffectComposer(batchRenderer);
  batchComposer.addPass(new RenderPass(batchScene, batchCamera));
  batchComposer.addPass(new UnrealBloomPass(new THREE.Vector2(320, 320), 0.4, 0.25, 0.55));
  batchComposer.addPass(new OutputPass());
}

function loadObjectForBatch(f) {
  const url = `/api/files/${f.id}/raw`;
  return new Promise((resolve, reject) => {
    if (f.ext === 'stl') {
      new STLLoader().load(url, (geometry) => resolve(new THREE.Mesh(geometry, materialCyber)), undefined, reject);
    } else if (f.ext === 'obj') {
      new OBJLoader().load(url, (object) => {
        object.traverse(child => { if (child.isMesh) child.material = materialCyber; });
        resolve(object);
      }, undefined, reject);
    } else if (f.ext === '3mf') {
      new ThreeMFLoader().load(url, (object) => {
        ensureNormals(object);
        object.traverse(child => { if (child.isMesh) child.material = materialCyber; });
        resolve(object);
      }, undefined, reject);
    } else {
      reject(new Error('unsupported ext'));
    }
  });
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m !== materialCyber && m.dispose?.());
    else if (child.material && child.material !== materialCyber) child.material.dispose?.();
  });
  if (object.geometry) object.geometry.dispose();
}

async function generateOneThumbnail(f) {
  const object = await loadObjectForBatch(f);
  batchScene.add(object);

  const box = new THREE.Box3().setFromObject(object);
  // Gleiche Absicherung wie frameObject() im Live-Viewer: ein leeres Box3 (z.B. 3MF-Dateien ohne
  // echtes sichtbares Mesh, etwa reine Orca-Profil-Bundles mit .3mf-Endung) macht Größe/Center zu
  // NaN/-Infinity. Ohne diesen Check würde hier lautlos ein schwarzes Thumbnail hochgeladen statt
  // dass der Fehler sichtbar wird (zählt jetzt als "fehlgeschlagen" in der Statuszeile).
  if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    batchScene.remove(object);
    disposeObject(object);
    throw new Error('keine sichtbare Geometrie gefunden');
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);
  const dist = (Math.max(size.x, size.y, size.z) || 1) * 2;
  batchCamera.position.set(dist, dist, dist);
  batchCamera.lookAt(0, 0, 0);

  batchComposer.render();
  const dataUrl = batchRenderer.domElement.toDataURL('image/png');

  batchScene.remove(object);
  disposeObject(object);

  await uploadThumbnail(f.id, dataUrl);
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function runBatchThumbnails() {
  if (!batchRenderer) initBatchRenderer();
  const all = await fetch('/api/files').then(r => r.json());
  const missing = all.filter(f => !f.thumbnail);
  let done = 0, failed = 0;
  for (const f of missing) {
    if (!batchRunning) break; // per erneutem Klick (STOPPEN) abgebrochen
    genThumbsStatus.textContent = `${done}/${missing.length}…`;
    try {
      await generateOneThumbnail(f);
    } catch (err) {
      failed++;
      console.warn(`Thumbnail für "${f.filename}" fehlgeschlagen: ${err.message}`);
    }
    done++;
    // Alle paar Dateien die Kachel-Ansicht aktualisieren UND dem Browser zwei Frames Zeit geben,
    // Klicks/Scrollen zu verarbeiten — sonst wirkt die Seite bei großen Bibliotheken (1000+
    // Dateien, teils 80MB+ STLs) eingefroren, obwohl im Hintergrund weitergearbeitet wird.
    if (done % 5 === 0) {
      loadFiles();
      await nextFrame();
    }
  }
  genThumbsStatus.textContent = missing.length
    ? `${done}/${missing.length} fertig${failed ? ` (${failed} fehlgeschlagen)` : ''}`
    : 'alle vorhanden';
  genThumbsBtn.textContent = '🖼 VORSCHAUBILDER';
  batchRunning = false;
  loadFiles();
}

genThumbsBtn.addEventListener('click', () => {
  if (batchRunning) {
    batchRunning = false; // Schleife stoppt nach dem aktuell laufenden Modell
    return;
  }
  batchRunning = true;
  genThumbsBtn.textContent = '■ STOPPEN';
  runBatchThumbnails();
});

function loadMeshForFile(f) {
  clearMesh();
  const url = `/api/files/${f.id}/raw`;

  if (f.ext === 'stl') {
    new STLLoader().load(url, (geometry) => {
      const mesh = new THREE.Mesh(geometry, materialCyber);
      currentMesh = mesh;
      scene.add(mesh);
      frameObject(mesh);
      maybeCaptureThumbnail(f);
    }, undefined, (err) => console.error('STL laden fehlgeschlagen', err));
  } else if (f.ext === 'obj') {
    new OBJLoader().load(url, (object) => {
      object.traverse(child => { if (child.isMesh) child.material = materialCyber; });
      currentMesh = object;
      scene.add(object);
      frameObject(object);
      maybeCaptureThumbnail(f);
    }, undefined, (err) => console.error('OBJ laden fehlgeschlagen', err));
  } else if (f.ext === '3mf') {
    new ThreeMFLoader().load(url, (object) => {
      ensureNormals(object);
      let meshCount = 0;
      object.traverse(child => { if (child.isMesh) { child.material = materialCyber; meshCount++; } });
      console.log(`3MF geladen: ${meshCount} Mesh(es) in "${f.filename}"`);
      if (meshCount === 0) {
        console.warn('3MF enthält kein sichtbares Mesh laut ThreeMFLoader — Datei ggf. nur Metadaten/Presets, kein Modell');
      }
      currentMesh = object;
      scene.add(object);
      frameObject(object);
      maybeCaptureThumbnail(f);
    }, undefined, (err) => console.error('3MF laden fehlgeschlagen', err));
  }
}

function openModal(f) {
  currentFile = f;
  modalTitle.textContent = f.filename;
  modalMeta.innerHTML = `
    <span>FORMAT: <b>${f.ext.toUpperCase()}</b></span>
    <span>GRÖSSE: <b>${fmtBytes(f.size_bytes)}</b></span>
    <span>PFAD: <b>${f.rel_path}</b></span>
  `;
  downloadBtn.href = `/api/files/${f.id}/raw?download=1`;
  rawBtn.onclick = () => window.open(`/api/files/${f.id}/raw`, '_blank');

  const absoluteRawUrl = `${window.location.origin}/api/files/${f.id}/raw?download=1`;
  document.getElementById('orcaBtn').href = `orcaslicer://open?file=${encodeURIComponent(absoluteRawUrl)}`;

  renderTags(f.tags);
  renderCategories(f.categories);
  refreshJobs();
  refreshEstimateUI();

  modalBackdrop.classList.add('open');
  if (!renderer) initViewer();
  loadMeshForFile(f);
}

function renderTags(tags) {
  modalTags.innerHTML = tags.map(t =>
    `<span class="chip" data-tag="${t}" style="cursor:pointer">${t} ×</span>`
  ).join('');
  modalTags.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      await fetch(`/api/files/${currentFile.id}/tags/${encodeURIComponent(chip.dataset.tag)}`, { method: 'DELETE' });
      currentFile.tags = currentFile.tags.filter(t => t !== chip.dataset.tag);
      renderTags(currentFile.tags);
      loadFiles(); loadTags();
    });
  });
}

addTagBtn.addEventListener('click', async () => {
  const tag = newTagInput.value.trim();
  if (!tag || !currentFile) return;
  await fetch(`/api/files/${currentFile.id}/tags`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag }),
  });
  currentFile.tags = [...new Set([...currentFile.tags, tag.toLowerCase()])];
  renderTags(currentFile.tags);
  newTagInput.value = '';
  loadFiles(); loadTags();
});

function renderCategories(categories) {
  modalCategories.innerHTML = categories.map(c =>
    `<span class="chip" data-id="${c.id}" style="cursor:pointer">${c.name} ×</span>`
  ).join('');
  modalCategories.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      await fetch(`/api/files/${currentFile.id}/categories/${chip.dataset.id}`, { method: 'DELETE' });
      currentFile.categories = currentFile.categories.filter(c => String(c.id) !== chip.dataset.id);
      renderCategories(currentFile.categories);
      loadCategories();
    });
  });
}

addCategoryForFileBtn.addEventListener('click', async () => {
  const name = newCategoryForFileInput.value.trim();
  if (!name || !currentFile) return;
  const { category } = await fetch(`/api/files/${currentFile.id}/categories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }).then(r => r.json());
  if (!currentFile.categories.some(c => c.id === category.id)) {
    currentFile.categories = [...currentFile.categories, category];
  }
  renderCategories(currentFile.categories);
  newCategoryForFileInput.value = '';
  loadCategories();
});

closeModalBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });

function closeModal() {
  modalBackdrop.classList.remove('open');
  stopRunningTimer();
}

// ---------- Druck-Kosten (Start/Stop-Timer -> Stromkosten via Home Assistant) ----------
const startPrintBtn = document.getElementById('startPrintBtn');
const stopPrintBtn = document.getElementById('stopPrintBtn');
const runningHint = document.getElementById('runningHint');
const jobListEl = document.getElementById('jobList');

let runningJob = null;
let spoolsCache = null; // vom Server geladene Spoolman-Spulen, einmal pro Session-Öffnung geholt

async function loadSpools() {
  if (spoolsCache) return spoolsCache;
  try {
    spoolsCache = await fetch('/api/spoolman/spools').then(r => r.json());
  } catch {
    spoolsCache = [];
  }
  return spoolsCache;
}

function spoolOptionsHtml(spools, selectedId) {
  const options = spools.map(s => {
    const weight = s.remaining_weight != null ? ` (${Math.round(s.remaining_weight)}g übrig)` : '';
    const selected = String(s.id) === String(selectedId) ? 'selected' : '';
    return `<option value="${s.id}" ${selected}>${s.label}${weight}</option>`;
  }).join('');
  return `<option value="">manuell</option>${options}`;
}
let runningTimerId = null;

function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function fmtEur(n) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function stopRunningTimer() {
  if (runningTimerId) { clearInterval(runningTimerId); runningTimerId = null; }
}

function updateRunningHint() {
  if (!runningJob) return;
  runningHint.textContent = `⏱ läuft seit ${fmtDuration(Date.now() - runningJob.started_at)}`;
}

function setTimerUI() {
  const isRunning = Boolean(runningJob);
  startPrintBtn.style.display = isRunning ? 'none' : '';
  stopPrintBtn.style.display = isRunning ? '' : 'none';
  runningHint.style.display = isRunning ? '' : 'none';
  stopRunningTimer();
  if (isRunning) {
    updateRunningHint();
    runningTimerId = setInterval(updateRunningHint, 30000);
  }
}

function jobErrorLabel(err) {
  if (err === 'ha_not_configured') return 'Home Assistant nicht konfiguriert (⚙ Einstellungen)';
  if (err === 'ha_no_data') return 'keine Energiedaten für diesen Zeitraum gefunden';
  if (err === 'ha_counter_reset') return 'Energiezähler ist zwischendurch zurückgesprungen';
  if (String(err || '').startsWith('ha_http_')) return `Home Assistant antwortete mit ${err.replace('ha_http_', 'HTTP ')}`;
  if (String(err || '').startsWith('ha_unreachable')) return 'Home Assistant nicht erreichbar (URL prüfen)';
  if (err === 'spoolman_not_configured') return 'Spoolman nicht konfiguriert (⚙ Einstellungen)';
  if (String(err || '').startsWith('spoolman_http_')) return `Spoolman antwortete mit ${err.replace('spoolman_http_', 'HTTP ')}`;
  if (String(err || '').startsWith('spoolman_unreachable')) return 'Spoolman nicht erreichbar (URL prüfen)';
  return err || 'unbekannter Fehler';
}

async function renderJobs(jobs) {
  jobListEl.innerHTML = '';
  const finished = jobs.filter(j => j.status !== 'running');
  if (!finished.length) {
    const empty = document.createElement('div');
    empty.className = 'cat-empty';
    empty.textContent = 'noch keine abgeschlossenen Drucke erfasst';
    jobListEl.appendChild(empty);
    return;
  }

  const spools = await loadSpools();

  for (const job of finished) {
    const row = document.createElement('div');
    row.className = 'job-row';

    const total = (job.energy_cost || 0) + (job.filament_cost || 0);
    row.innerHTML = `
      <div class="job-top">
        <span>${fmtDateTime(job.started_at)} · ${fmtDuration(job.ended_at - job.started_at)}</span>
        <button class="job-del" title="Eintrag löschen">×</button>
      </div>
      <div>
        ${job.energy_error
          ? `<span class="job-error">Strom: ${jobErrorLabel(job.energy_error)}</span>`
          : `<span>Strom: ${job.energy_kwh.toFixed(3)} kWh → <span class="job-cost">${fmtEur(job.energy_cost)}</span></span>`}
      </div>
      <div class="job-material" style="margin-top:8px;">
        <select class="job-spool">${spoolOptionsHtml(spools, job.spoolman_spool_id)}</select>
        <input type="text" inputmode="decimal" class="job-grams" placeholder="Gramm" value="${job.filament_grams ?? ''}">
        <input type="text" inputmode="decimal" class="job-price" placeholder="€/kg" value="${job.filament_price_per_kg ?? ''}">
        <button class="job-save-material" type="button">SPEICHERN</button>
        ${job.filament_cost != null ? `<span>→ <span class="job-cost">${fmtEur(job.filament_cost)}</span></span>` : ''}
      </div>
      ${job.filament_error ? `<div class="job-error">Filament: ${jobErrorLabel(job.filament_error)}</div>` : ''}
      ${(job.energy_cost != null || job.filament_cost != null)
        ? `<div class="job-total">GESAMT: ${fmtEur(total)}</div>` : ''}
    `;

    const priceInput = row.querySelector('.job-price');
    const spoolSelect = row.querySelector('.job-spool');

    // Spule gewählt -> Preis/kg kommt von Spoolman, Feld nur noch zur Anzeige.
    // "manuell" -> Preisfeld wieder frei editierbar.
    function syncPriceField() {
      const spool = spools.find(s => String(s.id) === spoolSelect.value);
      if (spool && spool.price_per_kg != null) {
        priceInput.value = spool.price_per_kg.toFixed(2);
        priceInput.disabled = true;
      } else {
        priceInput.disabled = false;
      }
    }
    spoolSelect.addEventListener('change', syncPriceField);
    syncPriceField();

    row.querySelector('.job-del').addEventListener('click', async () => {
      await fetch(`/api/print-jobs/${job.id}`, { method: 'DELETE' });
      refreshJobs();
    });

    row.querySelector('.job-save-material').addEventListener('click', async () => {
      const grams = row.querySelector('.job-grams').value.trim();
      const price = priceInput.value.trim();
      const spoolId = spoolSelect.value;
      await fetch(`/api/print-jobs/${job.id}/material`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filament_grams: grams, filament_price_per_kg: price, spool_id: spoolId }),
      });
      spoolsCache = null; // Restgewicht hat sich durch die Buchung geändert -> neu laden
      refreshJobs();
    });

    jobListEl.appendChild(row);
  }
}

async function refreshJobs() {
  if (!currentFile) return;
  const jobs = await fetch(`/api/files/${currentFile.id}/print-jobs`).then(r => r.json());
  runningJob = jobs.find(j => j.status === 'running') || null;
  setTimerUI();
  renderJobs(jobs);
}

startPrintBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  const res = await fetch(`/api/files/${currentFile.id}/print-jobs/start`, { method: 'POST' });
  if (res.ok) refreshJobs();
});

stopPrintBtn.addEventListener('click', async () => {
  if (!runningJob) return;
  stopPrintBtn.disabled = true;
  stopPrintBtn.textContent = '… WIRD AUSGEWERTET';
  await fetch(`/api/print-jobs/${runningJob.id}/stop`, { method: 'POST' });
  stopPrintBtn.disabled = false;
  stopPrintBtn.textContent = '■ DRUCK BEENDEN';
  refreshJobs();
});

// ---------- Kosten-VOR-Schätzung (Faustformel aus Modellgeometrie + Druckprofil, kein Slicing) ----------
const estimateProfileEl = document.getElementById('estimateProfile');
const estimateSpoolEl = document.getElementById('estimateSpool');
const runEstimateBtn = document.getElementById('runEstimateBtn');
const estimateResultEl = document.getElementById('estimateResult');
const manageProfilesBtn = document.getElementById('manageProfilesBtn');
const profilesBackdrop = document.getElementById('profilesBackdrop');
const closeProfilesBtn = document.getElementById('closeProfiles');
const profilesListEl = document.getElementById('profilesList');
const createProfileBtn = document.getElementById('createProfileBtn');

let costProfiles = [];

async function loadCostProfiles() {
  costProfiles = await fetch('/api/cost-profiles').then(r => r.json());
  const selected = estimateProfileEl.value;
  estimateProfileEl.innerHTML = costProfiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  if (selected && costProfiles.some(p => String(p.id) === selected)) estimateProfileEl.value = selected;
}

function fmtMinutes(min) {
  if (min == null) return '–';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function renderEstimateResult(est) {
  if (!est) {
    estimateResultEl.innerHTML = `<div class="cat-empty">noch keine Berechnung für diese Datei</div>`;
    return;
  }
  estimateResultEl.innerHTML = `
    <div class="estimate-result">
      <div class="stat"><span class="v">${est.filament_grams.toFixed(1)} g</span><span class="l">Filament</span></div>
      <div class="stat"><span class="v">${fmtMinutes(est.print_minutes)}</span><span class="l">Druckzeit (ca.)</span></div>
      <div class="stat"><span class="v">${fmtEur(est.filament_cost)}</span><span class="l">Materialkosten</span></div>
      <div class="stat"><span class="v">${fmtEur(est.energy_cost)}</span><span class="l">Stromkosten</span></div>
      <div class="stat total"><span class="v">${fmtEur(est.total_cost)}</span><span class="l">Gesamt</span></div>
    </div>
  `;
}

async function refreshEstimateUI() {
  if (!currentFile) return;
  await loadCostProfiles();
  const spools = await loadSpools();
  estimateSpoolEl.innerHTML = spoolOptionsHtml(spools, '');
  const est = await fetch(`/api/files/${currentFile.id}/estimate`).then(r => r.json());
  if (est) {
    if (costProfiles.some(p => p.id === est.profile_id)) estimateProfileEl.value = est.profile_id;
    if (est.spool_id) estimateSpoolEl.value = est.spool_id;
  }
  renderEstimateResult(est);
}

// Modellgeometrie (Volumen/Oberfläche) aus der bereits im Viewer geladenen Mesh berechnen —
// Signed-Tetrahedron-Methode fürs Volumen, Dreiecksflächen-Summe für die Oberfläche. Arbeitet
// mit matrixWorld, damit die von frameObject() vorgenommene Zentrierung mit einfließt.
function computeMeshStats(object) {
  let volumeMm3 = 0;
  let surfaceAreaMm2 = 0;
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const geom = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(child.matrixWorld);
      volumeMm3 += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
      surfaceAreaMm2 += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
    }
  });
  return { volumeMm3: Math.abs(volumeMm3), surfaceAreaMm2 };
}

runEstimateBtn.addEventListener('click', async () => {
  if (!currentFile || !currentMesh) return;
  runEstimateBtn.disabled = true;
  runEstimateBtn.textContent = '… BERECHNE';
  try {
    const { volumeMm3, surfaceAreaMm2 } = computeMeshStats(currentMesh);
    const box = new THREE.Box3().setFromObject(currentMesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const est = await fetch(`/api/files/${currentFile.id}/estimate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        volumeMm3, surfaceAreaMm2, bboxX: size.x, bboxY: size.y,
        profileId: estimateProfileEl.value || null,
        spoolId: estimateSpoolEl.value || null,
      }),
    }).then(r => r.json());
    renderEstimateResult(est);
  } finally {
    runEstimateBtn.disabled = false;
    runEstimateBtn.textContent = '▶ KOSTEN BERECHNEN';
  }
});

async function renderProfilesList() {
  await loadCostProfiles();
  profilesListEl.innerHTML = costProfiles.map(p => `
    <div class="profile-row" data-id="${p.id}">
      <span>${p.name} — ${p.layer_height_mm}mm / ${p.infill_percent}% / ${p.wall_count} Wände / ${p.printer_power_watts}W</span>
      <button class="pdel" title="Profil löschen">×</button>
    </div>
  `).join('') || `<div class="cat-empty">keine Profile — leg unten eins an</div>`;

  profilesListEl.querySelectorAll('.profile-row .pdel').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.profile-row');
      if (costProfiles.length <= 1) { alert('Mindestens ein Profil muss bestehen bleiben.'); return; }
      if (!confirm('Profil wirklich löschen?')) return;
      await fetch(`/api/cost-profiles/${row.dataset.id}`, { method: 'DELETE' });
      await renderProfilesList();
    });
  });
}

manageProfilesBtn.addEventListener('click', async () => {
  await renderProfilesList();
  profilesBackdrop.classList.add('open');
});
closeProfilesBtn.addEventListener('click', () => profilesBackdrop.classList.remove('open'));
profilesBackdrop.addEventListener('click', (e) => { if (e.target === profilesBackdrop) profilesBackdrop.classList.remove('open'); });

const profileStatus = document.getElementById('profileStatus');

createProfileBtn.addEventListener('click', async () => {
  const nameInput = document.getElementById('npName');
  const name = nameInput.value.trim();
  if (!name) {
    profileStatus.textContent = '✗ Name ist ein Pflichtfeld';
    profileStatus.className = 'ha-status err';
    nameInput.focus();
    return;
  }
  profileStatus.textContent = 'lege an…';
  profileStatus.className = 'ha-status';
  const res = await fetch('/api/cost-profiles', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      layer_height_mm: document.getElementById('npLayerHeight').value,
      infill_percent: document.getElementById('npInfill').value,
      wall_count: document.getElementById('npWalls').value,
      nozzle_diameter_mm: document.getElementById('npNozzle').value,
      top_bottom_layers: document.getElementById('npTopBottom').value,
      print_speed_mm_s: document.getElementById('npSpeed').value,
      speed_overhead_factor: document.getElementById('npOverhead').value,
      printer_power_watts: document.getElementById('npPower').value,
      filament_density_g_cm3: document.getElementById('npDensity').value,
      filament_price_eur_per_kg: document.getElementById('npPrice').value,
    }),
  });
  if (res.ok) {
    profileStatus.textContent = `✓ "${name}" angelegt`;
    profileStatus.className = 'ha-status ok';
    nameInput.value = '';
    await renderProfilesList();
  } else {
    const err = await res.json().catch(() => ({}));
    profileStatus.textContent = `✗ ${err.error || 'Anlegen fehlgeschlagen'}`;
    profileStatus.className = 'ha-status err';
  }
});

// ---------- Einstellungen (Strompreis + Home Assistant) ----------
const settingsBtn = document.getElementById('settingsBtn');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const closeSettingsBtn = document.getElementById('closeSettings');
const setPowerPrice = document.getElementById('setPowerPrice');
const setHaUrl = document.getElementById('setHaUrl');
const setHaToken = document.getElementById('setHaToken');
const setHaEntity = document.getElementById('setHaEntity');
const setSpoolmanUrl = document.getElementById('setSpoolmanUrl');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const testHaBtn = document.getElementById('testHaBtn');
const haStatus = document.getElementById('haStatus');
const testSpoolmanBtn = document.getElementById('testSpoolmanBtn');
const spoolmanStatus = document.getElementById('spoolmanStatus');

async function openSettings() {
  const s = await fetch('/api/settings').then(r => r.json());
  setPowerPrice.value = s.power_price_eur_per_kwh;
  setHaUrl.value = s.ha_base_url;
  setHaEntity.value = s.ha_energy_entity_id;
  setHaToken.value = '';
  setHaToken.placeholder = s.ha_token_set ? '•••• (gespeichert — leer lassen zum Beibehalten)' : 'wird beim Speichern nicht angezeigt';
  setSpoolmanUrl.value = s.spoolman_base_url;
  haStatus.textContent = '';
  haStatus.className = 'ha-status';
  spoolmanStatus.textContent = '';
  spoolmanStatus.className = 'ha-status';
  settingsBackdrop.classList.add('open');
}

settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', () => settingsBackdrop.classList.remove('open'));
settingsBackdrop.addEventListener('click', (e) => { if (e.target === settingsBackdrop) settingsBackdrop.classList.remove('open'); });

// ---------- Spulen-Live-Übersicht (eigenes Modal, immer frisch von Spoolman, kein Cache) ----------
const spoolsBtn = document.getElementById('spoolsBtn');
const spoolsBackdrop = document.getElementById('spoolsBackdrop');
const closeSpoolsBtn = document.getElementById('closeSpools');
const spoolsTableEl = document.getElementById('spoolsTable');
const spoolsModalStatus = document.getElementById('spoolsModalStatus');
const refreshSpoolsBtn = document.getElementById('refreshSpoolsBtn');

async function loadSpoolsLive() {
  spoolsModalStatus.textContent = 'lädt…';
  spoolsModalStatus.className = 'ha-status';
  try {
    const res = await fetch('/api/spoolman/spools');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spools = await res.json();
    if (!spools.length) {
      spoolsTableEl.innerHTML = `<div class="cat-empty">keine Spulen gefunden (oder Spoolman nicht konfiguriert — siehe ⚙ Einstellungen)</div>`;
    } else {
      spoolsTableEl.innerHTML = spools.map(s => {
        const pct = (s.initial_weight && s.remaining_weight != null)
          ? Math.max(0, Math.min(100, (s.remaining_weight / s.initial_weight) * 100)) : null;
        return `
          <div class="spool-row">
            <span class="spool-swatch" style="background:${s.color_hex ? '#' + s.color_hex : 'var(--grid)'}"></span>
            <span class="spool-name">${s.label}${s.material ? ` <span class="material">// ${s.material}</span>` : ''}</span>
            <span>
              <div class="spool-remaining-bar">${pct != null ? `<div style="width:${pct}%"></div>` : ''}</div>
              <div class="spool-remaining-text">${s.remaining_weight != null ? Math.round(s.remaining_weight) + 'g' : '?'}${s.initial_weight ? ' / ' + Math.round(s.initial_weight) + 'g' : ''}</div>
            </span>
            <span class="spool-price">${s.price_per_kg != null ? fmtEur(s.price_per_kg) + '/kg' : '–'}</span>
          </div>
        `;
      }).join('');
    }
    spoolsModalStatus.textContent = `✓ ${spools.length} Spule(n) — ${new Date().toLocaleTimeString('de-DE')}`;
    spoolsModalStatus.className = 'ha-status ok';
  } catch (err) {
    spoolsTableEl.innerHTML = '';
    spoolsModalStatus.textContent = `✗ ${err.message}`;
    spoolsModalStatus.className = 'ha-status err';
  }
}

spoolsBtn.addEventListener('click', () => {
  spoolsBackdrop.classList.add('open');
  loadSpoolsLive();
});
closeSpoolsBtn.addEventListener('click', () => spoolsBackdrop.classList.remove('open'));
spoolsBackdrop.addEventListener('click', (e) => { if (e.target === spoolsBackdrop) spoolsBackdrop.classList.remove('open'); });
refreshSpoolsBtn.addEventListener('click', loadSpoolsLive);

// ---------- Statistik-Dashboard (aus den erfassten Druck-Kosten-Einträgen) ----------
const dashboardBtn = document.getElementById('dashboardBtn');
const dashboardBackdrop = document.getElementById('dashboardBackdrop');
const closeDashboardBtn = document.getElementById('closeDashboard');
const dashTilesEl = document.getElementById('dashTiles');
const dashChartEl = document.getElementById('dashChart');
const dashTopCategoriesEl = document.getElementById('dashTopCategories');
const dashTopFilesEl = document.getElementById('dashTopFiles');

async function loadDashboard() {
  const d = await fetch('/api/dashboard-stats').then(r => r.json());

  dashTilesEl.innerHTML = `
    <div class="stat-tile" style="--tile-color:var(--magenta)"><div class="num">${d.totals.prints}</div><div class="label">Drucke</div></div>
    <div class="stat-tile" style="--tile-color:var(--cyan)"><div class="num">${fmtEur(d.totals.total_cost)}</div><div class="label">Gesamtkosten</div></div>
    <div class="stat-tile" style="--tile-color:var(--amber)"><div class="num">${(d.totals.total_grams / 1000).toFixed(2)} kg</div><div class="label">Filament</div></div>
    <div class="stat-tile" style="--tile-color:var(--cyan)"><div class="num">${fmtDuration(d.totals.total_ms)}</div><div class="label">Druckzeit</div></div>
  `;

  const maxCost = Math.max(...d.monthly.map(m => m.cost), 0.01);
  dashChartEl.innerHTML = d.monthly.length
    ? d.monthly.map(m => `
        <div class="dash-bar-col">
          <span class="dash-bar-val">${m.cost > 0 ? fmtEur(m.cost) : ''}</span>
          <div class="dash-bar" style="height:${Math.max((m.cost / maxCost) * 100, 1)}%" title="${m.month}: ${fmtEur(m.cost)}"></div>
          <span class="dash-bar-label">${m.month.slice(5)}</span>
        </div>
      `).join('')
    : `<div class="cat-empty">noch keine Daten</div>`;

  dashTopCategoriesEl.innerHTML = d.topCategories.length
    ? d.topCategories.map(c => `<div class="dash-top-row"><span class="name">${c.name}</span><span class="c">${c.c}×</span></div>`).join('')
    : `<div class="cat-empty">noch keine Daten</div>`;

  dashTopFilesEl.innerHTML = d.topFiles.length
    ? d.topFiles.map(f => `<div class="dash-top-row"><span class="name">${f.filename}</span><span class="c">${f.c}×</span></div>`).join('')
    : `<div class="cat-empty">noch keine Daten</div>`;
}

dashboardBtn.addEventListener('click', () => {
  dashboardBackdrop.classList.add('open');
  loadDashboard();
});
closeDashboardBtn.addEventListener('click', () => dashboardBackdrop.classList.remove('open'));
dashboardBackdrop.addEventListener('click', (e) => { if (e.target === dashboardBackdrop) dashboardBackdrop.classList.remove('open'); });

// ---------- Duplikat-Erkennung (SHA-256, nur Anzeige — löscht nichts) ----------
const duplicatesBtn = document.getElementById('duplicatesBtn');
const duplicatesBackdrop = document.getElementById('duplicatesBackdrop');
const closeDuplicatesBtn = document.getElementById('closeDuplicates');
const startDupScanBtn = document.getElementById('startDupScanBtn');
const dupStatusEl = document.getElementById('dupStatus');
const dupGroupsEl = document.getElementById('dupGroups');
const dupProgressBar = document.getElementById('dupProgressBar');
const dupProgressFill = document.getElementById('dupProgressFill');
let dupPollTimer = null;

async function renderDuplicateGroups() {
  const groups = await fetch('/api/duplicates').then(r => r.json());
  dupGroupsEl.innerHTML = groups.length
    ? groups.map(g => `
        <div class="dup-group">
          <div class="dup-group-head">${g.files.length} IDENTISCHE DATEIEN</div>
          ${g.files.map(f => `
            <div class="dup-file-row">
              <span class="path">${f.rel_path}</span>
              <span class="size">${fmtBytes(f.size_bytes)}</span>
            </div>
          `).join('')}
        </div>
      `).join('')
    : `<div class="cat-empty">keine Duplikate gefunden</div>`;
}

async function pollDupScanStatus() {
  const s = await fetch('/api/duplicates/scan-status').then(r => r.json());
  if (s.total > 0) {
    dupStatusEl.textContent = `hashe … ${s.done}/${s.total}`;
    dupStatusEl.className = 'ha-status';
    dupProgressFill.style.width = `${Math.min((s.done / s.total) * 100, 100)}%`;
  }
  if (!s.running) {
    clearInterval(dupPollTimer);
    dupPollTimer = null;
    dupProgressBar.style.display = 'none';
    startDupScanBtn.disabled = false;
    startDupScanBtn.textContent = '🔍 SCAN STARTEN';
    dupStatusEl.textContent = '✓ fertig';
    dupStatusEl.className = 'ha-status ok';
    await renderDuplicateGroups();
  }
}

duplicatesBtn.addEventListener('click', async () => {
  duplicatesBackdrop.classList.add('open');
  dupStatusEl.textContent = '';
  await renderDuplicateGroups();
});
closeDuplicatesBtn.addEventListener('click', () => duplicatesBackdrop.classList.remove('open'));
duplicatesBackdrop.addEventListener('click', (e) => { if (e.target === duplicatesBackdrop) duplicatesBackdrop.classList.remove('open'); });

startDupScanBtn.addEventListener('click', async () => {
  startDupScanBtn.disabled = true;
  startDupScanBtn.textContent = '… SCANNT';
  const res = await fetch('/api/duplicates/scan', { method: 'POST' }).then(r => r.json());
  if (res.total === 0) {
    startDupScanBtn.disabled = false;
    startDupScanBtn.textContent = '🔍 SCAN STARTEN';
    dupStatusEl.textContent = '✓ alle Dateien bereits gehasht';
    dupStatusEl.className = 'ha-status ok';
    await renderDuplicateGroups();
    return;
  }
  dupProgressFill.style.width = '0%';
  dupProgressBar.style.display = 'block';
  dupPollTimer = setInterval(pollDupScanStatus, 2000);
});

saveSettingsBtn.addEventListener('click', async () => {
  const body = {
    power_price_eur_per_kwh: setPowerPrice.value.trim(),
    ha_base_url: setHaUrl.value.trim(),
    ha_energy_entity_id: setHaEntity.value.trim(),
    spoolman_base_url: setSpoolmanUrl.value.trim(),
  };
  if (setHaToken.value.trim()) body.ha_token = setHaToken.value.trim();
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  spoolsCache = null; // URL hat sich evtl. geändert -> nächste Job-Ansicht neu laden
  settingsBackdrop.classList.remove('open');
});

testHaBtn.addEventListener('click', async () => {
  haStatus.textContent = 'prüfe…';
  haStatus.className = 'ha-status';
  const result = await fetch('/api/settings/test-ha').then(r => r.json());
  if (result.ok) {
    haStatus.textContent = `✓ verbunden — aktueller Wert: ${result.state} ${result.unit}`;
    haStatus.className = 'ha-status ok';
  } else {
    haStatus.textContent = `✗ ${jobErrorLabel(result.error)}`;
    haStatus.className = 'ha-status err';
  }
});

testSpoolmanBtn.addEventListener('click', async () => {
  spoolmanStatus.textContent = 'prüfe…';
  spoolmanStatus.className = 'ha-status';
  const result = await fetch('/api/settings/test-spoolman').then(r => r.json());
  if (result.ok) {
    spoolmanStatus.textContent = `✓ verbunden — ${result.count} Spule(n) gefunden`;
    spoolmanStatus.className = 'ha-status ok';
  } else {
    spoolmanStatus.textContent = `✗ ${jobErrorLabel(result.error)}`;
    spoolmanStatus.className = 'ha-status err';
  }
});

// ---------- init ----------
(async function init() {
  await Promise.all([loadFiles(), loadStats(), loadTags(), loadFolders(), loadCategories()]);
})();
