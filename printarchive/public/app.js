import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const grid = document.getElementById('grid');
const emptyMsg = document.getElementById('empty');
const statsEl = document.getElementById('stats');
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

async function loadStats() {
  const s = await fetch('/api/stats').then(r => r.json());
  const parts = s.byExt.map(e => `${e.ext.toUpperCase()}:<b>${e.c}</b>`).join('  ');
  statsEl.innerHTML = `${s.total} DATEIEN — ${parts}<br>${s.libraryPath}`;
}

async function loadTags() {
  const tags = await fetch('/api/tags').then(r => r.json());
  tagFilter.innerHTML = '<option value="">alle tags</option>' +
    tags.map(t => `<option value="${t}">${t}</option>`).join('');
}

function renderFolderNode(node, depth) {
  const row = document.createElement('div');
  row.className = 'folder-row' + (activeFolder === node._filterValue ? ' active' : '');
  row.innerHTML = `<span>${node.label}</span><span class="count">${node.count}</span>`;
  row.addEventListener('click', () => {
    activeFolder = node._filterValue;
    loadFiles();
    loadFolders();
  });

  const wrap = document.createElement('div');
  wrap.appendChild(row);

  if (node.children && node.children.length) {
    const childWrap = document.createElement('div');
    childWrap.className = 'folder-children';
    node.children.forEach(c => childWrap.appendChild(renderFolderNode(c, depth + 1)));
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

let renderer, scene, camera, controls, animFrame, currentMesh;

function initViewer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060a);

  camera = new THREE.PerspectiveCamera(45, viewerEl.clientWidth / viewerEl.clientHeight, 0.1, 5000);
  camera.position.set(60, 60, 60);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
  viewerEl.innerHTML = '';
  viewerEl.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0x88ffff, 0x220022, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 1, 1);
  scene.add(dir);

  const grid3d = new THREE.GridHelper(200, 20, 0xff2079, 0x131b2b);
  scene.add(grid3d);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  animate();
}

function animate() {
  animFrame = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2;
  camera.position.set(dist, dist, dist);
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

const materialCyber = new THREE.MeshStandardMaterial({
  color: 0x00fff2, metalness: 0.15, roughness: 0.35, flatShading: false,
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
    }, undefined, (err) => console.error('STL laden fehlgeschlagen', err));
  } else if (f.ext === 'obj') {
    new OBJLoader().load(url, (object) => {
      object.traverse(child => { if (child.isMesh) child.material = materialCyber; });
      currentMesh = object;
      scene.add(object);
      frameObject(object);
    }, undefined, (err) => console.error('OBJ laden fehlgeschlagen', err));
  } else if (f.ext === '3mf') {
    new ThreeMFLoader().load(url, (object) => {
      currentMesh = object;
      scene.add(object);
      frameObject(object);
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
}

// ---------- init ----------
(async function init() {
  await Promise.all([loadFiles(), loadStats(), loadTags(), loadFolders(), loadCategories()]);
})();
