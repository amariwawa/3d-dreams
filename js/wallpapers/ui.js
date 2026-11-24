import { SCENES, getScene } from 'wp-scenes';
import { WallpaperEngine } from 'wp-engine';
import { store, BUNDLE, money } from './store.js';
import { buildStandaloneHTML } from './export.js';
import { portrait } from '../shared.js';

const $ = (id) => document.getElementById(id);

const DEVICES = {
  iphone: { label: 'iPhone', w: 1290, h: 2796, frame: 'phone', video: [1080, 2340] },
  android: { label: 'Android', w: 1440, h: 3120, frame: 'phone', video: [1080, 2340] },
  mac: { label: 'Mac', w: 2880, h: 1800, frame: 'desktop', video: [1920, 1200] },
  windows: { label: 'Windows PC', w: 3840, h: 2160, frame: 'desktop', video: [1920, 1080] },
};

const GUIDES = {
  iphone: [
    ['Still', 'Save the PNG to Photos → <b>Settings › Wallpaper › Add New Wallpaper</b> → Photos. With <i>Your 3D Portrait</i>, iOS Depth Effect can tuck the clock behind your head.'],
    ['Live', 'iOS doesn’t let apps or websites install moving wallpapers directly. Convert the loop video to a Live Photo with a converter app, then set that as your wallpaper — it animates when you wake the phone.'],
    ['Interactive', 'Open the .html file in Safari → <b>Share › Add to Home Screen</b>. It opens full-screen and reacts to tilt like a window into 3D.'],
  ],
  android: [
    ['Still', 'Open the PNG in Photos → <b>⋮ › Use as wallpaper</b>.'],
    ['Live', 'Pick the MP4 in any video live-wallpaper app (several free ones on Google Play). It plays on your home and lock screen.'],
    ['Interactive', 'Open the .html file in Chrome → <b>⋮ › Add to Home screen</b>. Full-screen, reacts to tilt.'],
  ],
  mac: [
    ['Still', '<b>System Settings › Wallpaper › Add Photo</b>.'],
    ['Live wallpaper', 'Install <b>Plash</b> (free, Mac App Store) → Add Website → choose the .html file. The scene follows your mouse.'],
    ['Screensaver', 'Install <b>WebViewScreenSaver</b> (free, open source) → <b>System Settings › Screen Saver</b> → Options → add the .html file’s path.'],
  ],
  windows: [
    ['Still', 'Right-click the PNG → <b>Set as desktop background</b>.'],
    ['Live wallpaper', 'Install <b>Lively Wallpaper</b> (free, Microsoft Store) and drag in the .html (interactive) or .mp4.'],
    ['Screensaver', 'In Lively Wallpaper’s settings, turn on its screensaver option. It uses your current live wallpaper.'],
  ],
};

const ui = { scene: 'aurora', device: 'iphone', page: 'create', thumbs: {}, busy: null };
let engine = null;

// ------------------------------------------------------------------ router
function route() {
  const [, page = 'create', sub] = location.hash.split('/');
  ui.page = ['create', 'wallpapers', 'library'].includes(page) ? page : 'create';
  document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== `page-${ui.page}`));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === ui.page));
  window.dispatchEvent(new CustomEvent('pagechange', { detail: ui.page }));
  if (ui.page === 'wallpapers') {
    if (sub && getScene(sub)) ui.scene = sub;
    ensureEngine();
    loadScene();
    engine.start();
    renderGrid();
    makeThumbs();
  } else {
    engine?.stop();
  }
  if (ui.page === 'library') renderLibrary();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ preview
function ensureEngine() {
  if (engine) return;
  engine = new WallpaperEngine($('wpCanvas'));
  engine.pointerArea = $('wpScreen');
  engine.autoSize();
}

function personalData(def) {
  const d = portrait.data;
  if (!def.personal || !d) return null;
  return def.personal === 'relief' ? { relief: d.relief } : { voxel: d.voxel };
}

function loadScene() {
  const def = getScene(ui.scene);
  engine.load(ui.scene, personalData(def));
  $('lockedScene').hidden = !(def.personal && !portrait.data);
  renderDetail();
  document.querySelectorAll('.wp-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === ui.scene));
}

function setDevice(d) {
  ui.device = d;
  const dev = DEVICES[d];
  const frame = $('deviceFrame');
  frame.className = `device ${dev.frame} ${d}`;
  frame.style.setProperty('--ar', `${dev.w} / ${dev.h}`);
  $('menubar').hidden = d !== 'mac';
  $('taskbar').hidden = d !== 'windows';
  $('lockOverlay').hidden = dev.frame !== 'phone';
  $('stageHint').textContent = dev.frame === 'phone'
    ? 'Move your mouse over the screen (or tap "Enable tilt" on a phone) — the scene shifts with real depth.'
    : 'Move your mouse — the scene follows it with real depth, just like on your desktop.';
  renderDetail();
}

function tickClock() {
  const now = new Date();
  $('lockTime').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');
  $('lockDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('menuClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
setInterval(tickClock, 15000);
tickClock();

// ------------------------------------------------------------------ detail panel
function renderDetail() {
  const def = getScene(ui.scene);
  const dev = DEVICES[ui.device];
  const owned = store.isOwned(def.id);
  const needsPortrait = def.personal && !portrait.data;
  const el = $('wpDetail');
  el.innerHTML = `
    <div class="tags">${def.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
    <h2>${def.name}</h2>
    <p class="muted">${def.tagline}</p>
    ${owned
      ? `<div class="owned-pill">✓ Owned</div>`
      : `<div class="price">${money(def.price)} <small>one-time · all devices</small></div>
         <div class="buy-row">
           <button class="btn primary" data-act="buy">Buy now</button>
           <button class="btn" data-act="cart" ${store.inCart(def.id) || store.inCart(BUNDLE.id) ? 'disabled' : ''}>${store.inCart(def.id) || store.inCart(BUNDLE.id) ? 'In cart' : 'Add to cart'}</button>
         </div>`}
    <h4>Downloads for ${dev.label} <small>${dev.w}×${dev.h}</small></h4>
    ${needsPortrait ? `<p class="warn-note">Make your 3D portrait on the Create page first.</p>` : ''}
    <div class="dl-list ${owned && !needsPortrait ? '' : 'locked'}">
      ${dlRow('still', '🖼', 'Still image', `PNG · ${dev.w}×${dev.h}`)}
      ${dlRow('video', '🎞', 'Live loop video', `MP4/WebM · ${dev.video[0]}×${dev.video[1]} · 8 s`)}
      ${dlRow('html', '✦', dev.frame === 'phone' ? 'Interactive tilt wallpaper' : 'Interactive wallpaper + screensaver', 'Single .html file · works offline')}
    </div>
    ${owned ? '' : `<p class="fineprint">Buy once and download every format for every device.</p>`}
    <details class="guide" ${owned ? 'open' : ''}>
      <summary>How to set it up on ${dev.label}</summary>
      <ol>${GUIDES[ui.device].map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join('')}</ol>
    </details>`;
  el.querySelector('[data-act="buy"]')?.addEventListener('click', () => openCheckout([def.id]));
  el.querySelector('[data-act="cart"]')?.addEventListener('click', () => { store.add(def.id); toast(`${def.name} added to cart`); });
  el.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => download(b.dataset.dl, b)));
}

function dlRow(kind, icon, title, sub) {
  return `<button class="dl-row" data-dl="${kind}"><span class="dl-ic">${icon}</span><span><b>${title}</b><small>${sub}</small></span><span class="dl-go">↓</span></button>`;
}

async function download(kind, btn) {
  const def = getScene(ui.scene);
  if (!store.isOwned(def.id)) return openCheckout([def.id]);
  if (def.personal && !portrait.data) return toast('Create your 3D portrait first');
  if (ui.busy) return;
  const dev = DEVICES[ui.device];
  const label = btn.querySelector('small');
  const orig = label.textContent;
  ui.busy = kind;
  btn.classList.add('working');
  const name = `${def.id}-${ui.device}`;
  try {
    if (kind === 'still') {
      label.textContent = 'Rendering…';
      save(await engine.snapshot(dev.w, dev.h), `${name}.png`);
    } else if (kind === 'video') {
      const { blob, ext } = await engine.record(dev.video[0], dev.video[1], 8, (f) => (label.textContent = `Recording… ${Math.round(f * 100)}%`));
      save(blob, `${name}.${ext}`);
    } else {
      label.textContent = 'Packaging…';
      save(await buildStandaloneHTML({ sceneId: def.id, title: def.name, data: personalData(def) }), `${def.id}-live-wallpaper.html`);
    }
    toast('Downloaded ✓');
  } catch (e) {
    console.error(e);
    toast('Download failed: ' + e.message);
  } finally {
    label.textContent = orig;
    btn.classList.remove('working');
    ui.busy = null;
  }
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------------ grid & thumbnails
function card(def, { lib = false } = {}) {
  const owned = store.isOwned(def.id);
  const thumb = ui.thumbs[def.id];
  return `<button class="wp-card ${def.id === ui.scene && !lib ? 'selected' : ''}" data-id="${def.id}">
    <div class="thumb">${thumb ? `<img src="${thumb}" alt="">` : '<div class="thumb-ph"></div>'}${def.personal ? '<span class="personal">YOU</span>' : ''}</div>
    <div class="meta"><b>${def.name}</b><span class="${owned ? 'own' : ''}">${owned ? 'Owned' : money(def.price)}</span></div>
  </button>`;
}

function renderGrid() {
  $('wpGrid').innerHTML = SCENES.map((d) => card(d)).join('');
  $('wpGrid').querySelectorAll('.wp-card').forEach((c) => c.addEventListener('click', () => {
    location.hash = `#/wallpapers/${c.dataset.id}`;
  }));
  const allOwned = store.owned.has(BUNDLE.id);
  const sum = SCENES.reduce((s, d) => s + d.price, 0);
  $('bundleCard').innerHTML = `
    <div><h3>${BUNDLE.name}</h3><p class="muted">${BUNDLE.tagline} ${SCENES.length} wallpapers worth ${money(sum)}.</p></div>
    ${allOwned ? '<div class="owned-pill">✓ Owned</div>' : `<div class="bundle-buy"><span class="price">${money(BUNDLE.price)}</span><button class="btn primary" id="bundleBuy">Get everything</button></div>`}`;
  $('bundleBuy')?.addEventListener('click', () => openCheckout([BUNDLE.id]));
}

function renderLibrary() {
  const owned = store.ownedScenes();
  $('libEmpty').hidden = owned.length > 0;
  $('libGrid').innerHTML = owned.map((d) => card(d, { lib: true })).join('');
  $('libGrid').querySelectorAll('.wp-card').forEach((c) => c.addEventListener('click', () => (location.hash = `#/wallpapers/${c.dataset.id}`)));
  makeThumbs();
}

let thumbsRunning = false;
async function makeThumbs(force = []) {
  force.forEach((id) => delete ui.thumbs[id]);
  const todo = SCENES.filter((d) => !ui.thumbs[d.id] && (!d.personal || portrait.data));
  if (!todo.length || thumbsRunning) return;
  thumbsRunning = true;
  const canvas = document.createElement('canvas');
  const th = new WallpaperEngine(canvas, { pixelRatio: 1 });
  th.setSize(270, 480);
  for (const def of todo) {
    th.load(def.id, personalData(def));
    th.setSize(270, 480);
    th.t = 3.2;
    th.frame(0.016);
    ui.thumbs[def.id] = canvas.toDataURL('image/jpeg', 0.82);
    document.querySelectorAll(`.wp-card[data-id="${def.id}"] .thumb`).forEach((t) => {
      t.querySelector('.thumb-ph, img')?.remove();
      t.insertAdjacentHTML('afterbegin', `<img src="${ui.thumbs[def.id]}" alt="">`);
    });
    await new Promise((r) => setTimeout(r, 30));
  }
  th.dispose();
  th.renderer.dispose();
  th.renderer.forceContextLoss();
  thumbsRunning = false;
}

// ------------------------------------------------------------------ cart & checkout
function renderCart() {
  const n = store.cart.length;
  $('cartCount').hidden = !n;
  $('cartCount').textContent = n;
  $('cartItems').innerHTML = n
    ? store.cart.map((id) => {
        const p = store.product(id);
        return `<div class="cart-item"><img src="${ui.thumbs[id] || ''}" alt="" ${ui.thumbs[id] ? '' : 'hidden'}><div><b>${p.name}</b><small>${money(p.price)}</small></div><button class="icon-btn" data-rm="${id}" aria-label="Remove">✕</button></div>`;
      }).join('')
    : '<p class="muted center">Your cart is empty.</p>';
  $('cartItems').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => store.remove(b.dataset.rm)));
  $('cartTotal').textContent = money(store.total());
  $('checkoutBtn').disabled = !n;
}

function openDrawer(open) {
  $('cartDrawer').classList.toggle('open', open);
  $('scrim').hidden = !open;
}
$('cartBtn').addEventListener('click', () => openDrawer(true));
$('cartClose').addEventListener('click', () => openDrawer(false));
$('scrim').addEventListener('click', () => openDrawer(false));
$('checkoutBtn').addEventListener('click', () => { openDrawer(false); openCheckout(store.cart); });

let pending = [];
function openCheckout(ids) {
  pending = [...ids];
  const total = pending.reduce((s, id) => s + store.product(id).price, 0);
  $('checkoutSummary').innerHTML = `<ul class="sum">${pending.map((id) => `<li><span>${store.product(id).name}</span><b>${money(store.product(id).price)}</b></li>`).join('')}</ul>
    <div class="total"><span>Total</span><b>${money(total)}</b></div>`;
  $('checkoutModal').hidden = false;
}
$('payCancel').addEventListener('click', () => ($('checkoutModal').hidden = true));
$('payBtn').addEventListener('click', async () => {
  const b = $('payBtn');
  b.disabled = true;
  b.textContent = 'Processing…';
  await store.checkout(pending);
  b.disabled = false;
  b.textContent = 'Simulate payment';
  $('checkoutModal').hidden = true;
  toast('Purchase complete — downloads unlocked ✓');
});

$('resetDemoBtn').addEventListener('click', () => { store.resetDemo(); toast('Demo purchases cleared'); });

store.on(() => {
  renderCart();
  if (ui.page === 'wallpapers') { renderDetail(); renderGrid(); }
  if (ui.page === 'library') renderLibrary();
});

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 300); }, 2600);
}

// ------------------------------------------------------------------ controls
$('deviceSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('deviceSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  setDevice(b.dataset.v);
});
$('motionBtn').addEventListener('click', async () => {
  ensureEngine();
  const ok = await engine.enableMotion();
  const touch = matchMedia('(pointer: coarse)').matches;
  toast(ok && touch ? 'Tilt enabled — move your phone' : 'Tilt works on phones; on a computer, just move your mouse');
});
$('fsBtn').addEventListener('click', () => $('wpScreen').requestFullscreen?.());
$('overlayChk').addEventListener('change', (e) => $('deviceFrame').classList.toggle('no-overlay', !e.target.checked));

portrait.on(() => {
  makeThumbs(['portrait', 'portrait-8bit']);
  if (ui.page === 'wallpapers' && getScene(ui.scene).personal) loadScene();
});

setDevice('iphone');
renderCart();
route();
