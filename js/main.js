import { Viewer } from './viewer.js';
import { loadModels, detectFace, segmentPerson, estimateDepth } from './vision.js';
import { prepareField, heightField, drawField, blur } from './field.js';
import { buildRelief, makeTextures } from './relief.js';
import { buildVoxels } from './voxel.js';
import { PALETTES, sampleCells, resolvePalette, quantize, renderSprite } from './pixel.js';
import { portrait } from './shared.js';

const $ = (id) => document.getElementById(id);
const S = 512; // working resolution of the square crop

// ---------------------------------------------------------------- state
const state = {
  tab: 'relief',
  ready: false,
  crop: null, // canvas S×S, color-bled
  imageData: null,
  prep: null,
  textures: null,
  backColor: 0x2a2230,
  style: 'real',
  bg: 'insta',
  pixBg: 'gradient',
};

const viewer = new Viewer($('viewer'));

// ---------------------------------------------------------------- models
const statusEl = $('modelStatus');
const statusText = $('modelStatusText');
let modelProgressText = 'Loading AI models…';
const modelsPromise = loadModels((f, label) => {
  modelProgressText = label;
  statusText.textContent = label;
  if (!$('busy').hidden && !state.ready) $('busyText').textContent = label;
})
  .then(({ backend }) => {
    statusEl.classList.add('ready');
    statusText.textContent = `AI ready · ${backend === 'webgpu' ? 'GPU accelerated' : 'CPU mode'}`;
    return backend;
  })
  .catch((e) => {
    console.error(e);
    statusEl.classList.add('error');
    statusText.textContent = 'Could not load AI models — check your connection and reload';
    throw e;
  });

// ---------------------------------------------------------------- steps UI
function step(name, status, note) {
  const li = document.querySelector(`[data-step="${name}"]`);
  li.className = status;
  if (note) li.querySelector('small').textContent = note;
}
function resetSteps() {
  const defaults = {
    detect: 'Find your face (BlazeFace)',
    crop: 'Center a square, profile-picture crop',
    segment: 'Separate you from the background',
    depth: 'Depth Anything V2 neural net',
    build: 'Mesh, voxels & pixel art',
  };
  for (const [k, v] of Object.entries(defaults)) step(k, '', v);
}
function busy(text) {
  $('busy').hidden = !text;
  if (text) $('busyText').textContent = text;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------- input
const dz = $('dropzone');
const fileInput = $('fileInput');
dz.addEventListener('click', (e) => {
  if (e.target.closest('#cameraBtn')) return;
  fileInput.click();
});
fileInput.addEventListener('change', () => fileInput.files[0] && handleFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => {
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (f) handleFile(f);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) handleFile(item.getAsFile());
});

// camera
let camStream = null;
$('cameraBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } } });
    $('cameraVideo').srcObject = camStream;
    $('cameraBox').hidden = false;
  } catch (err) {
    alert('Could not open the camera: ' + err.message);
  }
});
function stopCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('cameraBox').hidden = true;
}
$('cameraCancel').addEventListener('click', stopCamera);
$('snapBtn').addEventListener('click', () => {
  const v = $('cameraVideo');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.scale(-1, 1); // keep the mirrored selfie the user saw
  ctx.drawImage(v, 0, 0);
  stopCamera();
  run(c);
});

async function handleFile(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    run(bmp);
  } catch {
    // fallback through <img> (handles some formats createImageBitmap rejects)
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { run(img); URL.revokeObjectURL(url); };
    img.onerror = () => alert("Sorry, this browser can't open that image. Try a JPG or PNG.");
    img.src = url;
  }
}

// ---------------------------------------------------------------- pipeline
let runId = 0;
async function run(source) {
  const id = ++runId;
  state.ready = false;
  setDownloads(false);
  resetSteps();
  $('placeholder').hidden = true;
  $('cropRow').hidden = true;

  // Normalise input to a canvas (max 1600 px on the long side).
  const sw = source.width || source.videoWidth, sh = source.height || source.videoHeight;
  const k = Math.min(1, 1600 / Math.max(sw, sh));
  const work = document.createElement('canvas');
  work.width = Math.round(sw * k); work.height = Math.round(sh * k);
  work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);

  const display = $('sourceCanvas');
  display.width = work.width; display.height = work.height;
  const dctx = display.getContext('2d');
  dctx.drawImage(work, 0, 0);
  $('dzEmpty').hidden = true;
  $('dzPreview').hidden = false;

  try {
    busy(state.ready ? 'Loading AI models…' : modelProgressText);
    await modelsPromise;
    if (id !== runId) return;

    // 1. face detection
    step('detect', 'active');
    busy('Detecting your face…');
    await nextFrame();
    const face = detectFace(work);
    if (face) {
      step('detect', 'done', `Face found · ${Math.round(face.w)}×${Math.round(face.h)} px`);
      dctx.lineWidth = Math.max(3, work.width / 250);
      dctx.strokeStyle = '#3ddc97';
      dctx.setLineDash([dctx.lineWidth * 4, dctx.lineWidth * 2]);
      dctx.strokeRect(face.x, face.y, face.w, face.h);
    } else {
      step('detect', 'warn', 'No face found — using center crop');
    }

    // 2. framing
    step('crop', 'active');
    const crop = frame(work, face);
    step('crop', 'done', face ? 'Head & shoulders, centered on your face' : 'Centered square crop');

    // 3. segmentation
    step('segment', 'active');
    busy('Cutting you out of the background…');
    await nextFrame();
    let mask = cleanMask(segmentPerson(crop), crop.valid, crop.faceCenter);
    let cover = 0;
    for (let i = 0; i < mask.length; i++) cover += mask[i];
    cover /= mask.length;
    if (cover < 0.03) {
      mask = new Float32Array(S * S).fill(1);
      step('segment', 'warn', "Couldn't find a person — using the whole image");
    } else {
      step('segment', 'done', `Subject covers ${Math.round(cover * 100)}% of the frame`);
    }
    if (id !== runId) return;

    // 4. depth
    step('depth', 'active');
    busy('Estimating depth with a neural network…');
    await nextFrame();
    const t0 = performance.now();
    const depth = await estimateDepth(crop);
    if (id !== runId) return;
    step('depth', 'done', `Depth map in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    // 5. build
    step('build', 'active');
    busy('Sculpting your 3D model…');
    await nextFrame();
    const prep = prepareField(S, depth, mask);
    bleedColors(crop, prep.mask);
    state.crop = crop;
    state.imageData = crop.getContext('2d').getImageData(0, 0, S, S);
    state.prep = prep;
    state.textures?.dispose();
    state.textures = makeTextures(crop);
    state.backColor = estimateBackColor(state.imageData, prep.mask);

    // previews
    const cc = $('cropCanvas');
    cc.width = cc.height = S;
    cc.getContext('2d').drawImage(crop, 0, 0);
    drawField($('maskCanvas'), S, prep.mask);
    drawField($('depthCanvas'), S, heightField(prep, params()), true);
    $('cropRow').hidden = false;

    state.ready = true;
    refresh();
    step('build', 'done', 'Ready — rotate it, restyle it, download it');
    portrait.set(makePortraitData());
    busy(null);
    setDownloads(true);
    $('dragHint').hidden = state.tab === 'pixel';
  } catch (err) {
    console.error(err);
    const active = document.querySelector('.steps li.active');
    if (active) step(active.dataset.step, 'fail', err.message?.slice(0, 90) || 'Failed');
    busy(null);
    $('placeholder').hidden = false;
    $('placeholder').querySelector('p').textContent = 'Something went wrong — try another photo.';
  }
}

/** Square crop around the face: head + shoulders like a profile picture. */
function frame(src, face) {
  const W = src.width, H = src.height;
  let side, cx, cy;
  if (face) {
    side = Math.max(face.w, face.h) * 2.8;
    cx = face.x + face.w / 2;
    cy = face.y + face.h * 0.66;
  } else {
    side = Math.min(W, H);
    cx = W / 2;
    cy = H * 0.45;
  }
  // Keep the face centred even if the square runs past the photo's edges (e.g. hair touching the
  // top of the photo): the overflow is padded instead of shifting/clamping the crop, so heads stay round.
  side = Math.min(side, Math.max(W, H) * 1.15);
  let x = cx - side / 2, y = cy - side / 2;
  // only shift sideways/down if that avoids padding without moving the face much
  if (x < 0 && x + side <= W) x = Math.min(0, W - side);
  if (x + side > W && x >= 0) x = Math.max(0, W - side);
  if (y + side > H && y > 0) y = Math.max(0, H - side);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#7f7f7f';
  ctx.fillRect(0, 0, S, S);
  ctx.imageSmoothingQuality = 'high';
  const k = S / side;
  ctx.drawImage(src, 0, 0, W, H, -x * k, -y * k, W * k, H * k);
  // where the real photo sits inside the crop (the rest is padding)
  c.valid = { x0: Math.max(0, -x * k), y0: Math.max(0, -y * k), x1: Math.min(S, (W - x) * k), y1: Math.min(S, (H - y) * k) };
  c.faceCenter = face ? { x: (face.x + face.w / 2 - x) * k, y: (face.y + face.h / 2 - y) * k } : { x: S / 2, y: S / 2 };
  return c;
}

/** Drop padding and stray blobs: keep only the connected region that contains the face. */
function cleanMask(mask, valid, center) {
  const m = mask;
  const pad = 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (x < valid.x0 + pad || x >= valid.x1 - pad || y < valid.y0 + pad || y >= valid.y1 - pad) m[y * S + x] = 0;
  }
  // flood fill from the face center (or nearest solid pixel) over mask > 0.5
  let seed = -1;
  const cx = Math.round(center.x), cy = Math.round(center.y);
  for (let r = 0; r < S / 4 && seed < 0; r += 2) {
    for (let a = 0; a < 16 && seed < 0; a++) {
      const x = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.round(cy + Math.sin((a / 16) * Math.PI * 2) * r);
      if (x >= 0 && y >= 0 && x < S && y < S && m[y * S + x] > 0.5) seed = y * S + x;
    }
  }
  if (seed < 0) return m;
  const keep = new Uint8Array(S * S);
  const stack = [seed];
  keep[seed] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % S, y = (i / S) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1]) {
      if (j >= 0 && !keep[j] && m[j] > 0.5) { keep[j] = 1; stack.push(j); }
    }
  }
  // keep soft edges next to the kept region, remove everything else
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (keep[i]) continue;
    const near = (x > 0 && keep[i - 1]) || (x < S - 1 && keep[i + 1]) || (y > 0 && keep[i - S]) || (y < S - 1 && keep[i + S]);
    if (!near) m[i] = 0;
  }
  return m;
}

/** Replace background-ish colors near the silhouette with the subject's own colors (no halos). */
function bleedColors(canvas, mask) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const ch = [0, 1, 2].map((c) => {
    const a = new Float32Array(S * S);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + c] * mask[i];
    return a;
  });
  // multi-scale push-pull: small radius first, larger radius fills the rest
  let fill = [null, null, null];
  let wsum = null;
  for (const r of [3, 10, 30]) {
    const w = blur(mask, S, r, 2);
    const cs = ch.map((a) => blur(a, S, r, 2));
    if (!wsum) { wsum = w; fill = cs; continue; }
    for (let i = 0; i < w.length; i++) {
      if (wsum[i] < 0.02 && w[i] > wsum[i]) {
        wsum[i] = w[i];
        for (let c = 0; c < 3; c++) fill[c][i] = cs[c][i];
      }
    }
  }
  for (let i = 0; i < S * S; i++) {
    const m = mask[i];
    if (m > 0.97 || wsum[i] < 1e-4) continue;
    for (let c = 0; c < 3; c++) {
      const bled = fill[c][i] / wsum[i];
      d[i * 4 + c] = d[i * 4 + c] * m + bled * (1 - m);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Back of the bust: a darker take on the hair / top-of-head color. */
function estimateBackColor(img, mask) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < S * 0.3; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (mask[i] < 0.9) continue;
    r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2]; n++;
  }
  if (!n) return 0x2a2230;
  const f = 0.55 / n;
  return (Math.round(r * f) << 16) | (Math.round(g * f) << 8) | Math.round(b * f);
}

// ---------------------------------------------------------------- rendering per tab
function params() {
  return { volume: +$('volumeRange').value, smooth: +$('smoothRange').value };
}

function refresh() {
  if (!state.ready) return;
  if (state.tab === 'relief') {
    const height = heightField(state.prep, params());
    viewer.setContent(buildRelief({
      prep: state.prep, height, texture: state.textures, strength: +$('depthRange').value,
      style: state.style, backColor: state.backColor,
    }));
  } else if (state.tab === 'voxel') {
    const height = heightField(state.prep, { volume: +$('volumeRange').value, smooth: 3 });
    const G = +$('voxRange').value;
    const cells = sampleCells(state.imageData, state.prep.mask, S, G, height);
    const pal = resolvePalette($('voxPalette').value, cells);
    const indices = quantize(cells, pal, { dither: false });
    viewer.setContent(buildVoxels({ cells, indices, pal, strength: +$('voxDepthRange').value }));
  } else {
    const G = +$('pixRange').value;
    const cells = sampleCells(state.imageData, state.prep.mask, S, G);
    const pal = resolvePalette($('pixPalette').value, cells);
    const indices = quantize(cells, pal, { dither: $('ditherChk').checked, outline: $('outlineChk').checked });
    renderSprite($('pixelCanvas'), indices, pal, G, { bg: state.pixBg });
  }
}

let refreshTimer = 0;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 60); };

// ---------------------------------------------------------------- controls
for (const [sel, key] of [['voxPalette', 'auto16'], ['pixPalette', 'auto16']]) {
  const el = $(sel);
  for (const [k, p] of Object.entries(PALETTES)) el.add(new Option(p.name, k, k === key, k === key));
  el.addEventListener('change', refreshSoon);
}

const bindRange = (id, outId, fmt = (v) => v) => {
  const el = $(id), out = $(outId);
  el.addEventListener('input', () => { out.textContent = fmt(+el.value); refreshSoon(); });
};
bindRange('depthRange', 'depthOut', (v) => v.toFixed(2));
bindRange('volumeRange', 'volumeOut', (v) => v.toFixed(2));
bindRange('smoothRange', 'smoothOut');
bindRange('voxRange', 'voxOut');
bindRange('voxDepthRange', 'voxDepthOut', (v) => v.toFixed(2));
bindRange('pixRange', 'pixOut');
$('ditherChk').addEventListener('change', refreshSoon);
$('outlineChk').addEventListener('change', refreshSoon);

function bindSeg(id, onPick) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  });
}
bindSeg('styleSeg', (v) => { state.style = v; refresh(); });
bindSeg('bgSeg', (v) => { state.bg = v; viewer.setBackground(v); });
bindSeg('pixBgSeg', (v) => { state.pixBg = v; refresh(); });

$('swayChk').addEventListener('change', (e) => { viewer.sway = e.target.checked; if (!viewer.sway) viewer.pivot.rotation.set(0, 0, 0); });
$('resetViewBtn').addEventListener('click', () => viewer.resetView());
$('circleToggle').addEventListener('change', (e) => $('stageInner').classList.toggle('circle', e.target.checked));
$('stageInner').classList.toggle('circle', $('circleToggle').checked);

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.controls').forEach((c) => (c.hidden = !c.dataset.for.split(' ').includes(state.tab)));
    const is3D = state.tab !== 'pixel';
    $('viewer').hidden = !is3D;
    $('pixelCanvas').hidden = is3D;
    $('dragHint').hidden = !is3D || !state.ready;
    $('dlGlb').hidden = !is3D;
    $('dlVideo').hidden = !is3D;
    $('dlPngLabel').textContent = is3D ? 'Download PNG (1080×1080)' : 'Download 8-bit PNG';
    if (is3D) viewer.resize();
    refresh();
  })
);

// ---------------------------------------------------------------- downloads
function setDownloads(on) {
  ['dlPng', 'dlGlb', 'dlVideo', 'toWallpaper'].forEach((id) => ($(id).disabled = !on));
}
function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = () => ({ relief: `pfp-3d-${state.style}`, voxel: 'pfp-8bit-3d', pixel: 'pfp-8bit' })[state.tab];

$('dlPng').addEventListener('click', async () => {
  if (state.tab === 'pixel') {
    $('pixelCanvas').toBlob((b) => save(b, `${baseName()}.png`), 'image/png');
  } else {
    save(await viewer.snapshot(1080), `${baseName()}.png`);
  }
});
$('dlGlb').addEventListener('click', async () => {
  try {
    save(await viewer.exportGLB(), `${baseName()}.glb`);
  } catch (e) {
    console.error(e);
    alert('Export failed: ' + e.message);
  }
});
$('dlVideo').addEventListener('click', async () => {
  const btn = $('dlVideo');
  btn.disabled = true;
  btn.classList.add('recording');
  btn.textContent = 'Recording…';
  try {
    const { blob, ext } = await viewer.recordLoop(1080);
    save(blob, `${baseName()}.${ext}`);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.classList.remove('recording');
    btn.textContent = 'Spin video';
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- hand-off to live wallpapers
/** Geometry + texture of the current portrait, as plain typed arrays (embeddable in exports). */
function makePortraitData() {
  const grab = (group, withUV) => {
    const mesh = group.children[0], geo = mesh.geometry;
    const position = Float32Array.from(geo.attributes.position.array);
    for (let i = 2; i < position.length; i += 3) position[i] += mesh.position.z; // bake centering offset
    const out = {
      position,
      normal: Float32Array.from(geo.attributes.normal.array),
      index: Uint32Array.from(geo.index.array),
      groups: geo.groups.map((g) => [g.start, g.count, g.materialIndex]),
    };
    if (withUV) out.uv = Float32Array.from(geo.attributes.uv.array);
    if (geo.attributes.color) out.color = Float32Array.from(geo.attributes.color.array);
    geo.dispose();
    [].concat(mesh.material).forEach((m) => m.dispose());
    return out;
  };
  const height = heightField(state.prep, params());
  const relief = grab(buildRelief({
    prep: state.prep, height, texture: state.textures, strength: +$('depthRange').value,
    style: state.style, backColor: state.backColor, N: 192,
  }), true);
  Object.assign(relief, { texture: state.crop.toDataURL('image/jpeg', 0.9), style: state.style, backColor: state.backColor });

  const vh = heightField(state.prep, { volume: +$('volumeRange').value, smooth: 3 });
  const cells = sampleCells(state.imageData, state.prep.mask, S, +$('voxRange').value, vh);
  const pal = resolvePalette($('voxPalette').value, cells);
  const voxel = grab(buildVoxels({ cells, indices: quantize(cells, pal, { dither: false }), pal, strength: +$('voxDepthRange').value }), false);
  return { relief, voxel, thumb: state.crop.toDataURL('image/jpeg', 0.7) };
}

$('toWallpaper').addEventListener('click', () => {
  portrait.set(makePortraitData()); // capture the latest style & slider tweaks
  location.hash = state.tab === 'relief' ? '#/wallpapers/portrait' : '#/wallpapers/portrait-8bit';
});

window.addEventListener('pagechange', (e) => (e.detail === 'create' ? viewer.resume() : viewer.pause()));
