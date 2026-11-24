// 8-bit engine: cell sampling, palettes, quantization with ordered dithering, sprite rendering.

const hex = (s) => s.trim().split(/\s+/).map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

export const PALETTES = {
  auto16: { name: 'Auto · 16 colors (closest to you)', auto: 16 },
  auto32: { name: 'Auto · 32 colors', auto: 32 },
  auto8: { name: 'Auto · 8 colors', auto: 8 },
  nes: {
    name: 'NES',
    colors: hex(`7C7C7C 0000FC 0000BC 4428BC 940084 A80020 A81000 881400 503000 007800 006800 005800 004058 000000
      BCBCBC 0078F8 0058F8 6844FC D800CC E40058 F83800 E45C10 AC7C00 00B800 00A800 00A844 008888
      F8F8F8 3CBCFC 6888FC 9878F8 F878F8 F85898 F87858 FCA044 F8B800 B8F818 58D854 58F898 00E8D8 787878
      FCFCFC A4E4FC B8B8F8 D8B8F8 F8B8F8 F8A4C0 F0D0B0 FCE0A8 F8D878 D8F878 B8F8B8 B8F8D8 00FCFC F8D8F8`),
  },
  pico8: {
    name: 'PICO-8',
    colors: hex('000000 1D2B53 7E2553 008751 AB5236 5F574F C2C3C7 FFF1E8 FF004D FFA300 FFEC27 00E436 29ADFF 83769C FF77A8 FFCCAA'),
  },
  c64: {
    name: 'Commodore 64',
    colors: hex('000000 FFFFFF 880000 AAFFEE CC44CC 00CC55 0000AA EEEE77 DD8855 664400 FF7777 333333 777777 AAFF66 0088FF BBBBBB'),
  },
  gameboy: { name: 'Game Boy', colors: hex('0F380F 306230 8BAC0F 9BBC0F') },
  mono: { name: '1-bit', colors: hex('111018 F2EFE6') },
};

/** Average color & coverage of each cell in a G×G grid over the S×S image. */
export function sampleCells(imageData, mask, S, G, field = null) {
  const rgb = new Float32Array(G * G * 3);
  const cover = new Float32Array(G * G);
  const fieldOut = field ? new Float32Array(G * G) : null;
  const data = imageData.data;
  for (let cy = 0; cy < G; cy++) {
    const y0 = Math.floor((cy * S) / G), y1 = Math.floor(((cy + 1) * S) / G);
    for (let cx = 0; cx < G; cx++) {
      const x0 = Math.floor((cx * S) / G), x1 = Math.floor(((cx + 1) * S) / G);
      let r = 0, g = 0, b = 0, wsum = 0, n = 0, f = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * S + x;
        const w = mask[i];
        n++;
        if (w < 0.05) continue;
        r += data[i * 4] * w; g += data[i * 4 + 1] * w; b += data[i * 4 + 2] * w; wsum += w;
        if (field) f += field[i] * w;
      }
      const c = cy * G + cx;
      cover[c] = wsum / n;
      if (wsum > 0) {
        rgb[c * 3] = r / wsum; rgb[c * 3 + 1] = g / wsum; rgb[c * 3 + 2] = b / wsum;
        if (field) fieldOut[c] = f / wsum;
      }
    }
  }
  return { G, rgb, cover, field: fieldOut };
}

/** Boost saturation/contrast a touch — pixel art reads better punchy. */
function punch(rgb, cover) {
  const out = Float32Array.from(rgb);
  for (let c = 0; c < cover.length; c++) {
    if (cover[c] < 0.5) continue;
    let r = out[c * 3], g = out[c * 3 + 1], b = out[c * 3 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * 1.08; g = l + (g - l) * 1.08; b = l + (b - l) * 1.08;
    r = (r - 128) * 1.05 + 128; g = (g - 128) * 1.05 + 128; b = (b - 128) * 1.05 + 128;
    out[c * 3] = Math.max(0, Math.min(255, r));
    out[c * 3 + 1] = Math.max(0, Math.min(255, g));
    out[c * 3 + 2] = Math.max(0, Math.min(255, b));
  }
  return out;
}

/** Median-cut palette from covered cells. */
function medianCut(rgb, cover, K) {
  const pts = [];
  for (let c = 0; c < cover.length; c++) if (cover[c] >= 0.5) pts.push([rgb[c * 3], rgb[c * 3 + 1], rgb[c * 3 + 2]]);
  if (!pts.length) return [[0, 0, 0], [255, 255, 255]];
  let boxes = [pts];
  while (boxes.length < K) {
    let bi = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255, mx = 0;
        for (const p of box) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch]; }
        const range = (mx - mn) * (ch === 1 ? 1.2 : 1);
        if (range > bestRange) { bestRange = range; bi = i; bestCh = ch; }
      }
    });
    if (bi < 0 || bestRange < 2) break;
    const box = boxes[bi].sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    const s = [0, 0, 0];
    for (const p of box) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map((v) => Math.round(v / box.length));
  });
}

export function resolvePalette(key, cells) {
  const p = PALETTES[key] ?? PALETTES.auto16;
  if (p.auto) return medianCut(punch(cells.rgb, cells.cover), cells.cover, p.auto);
  return p.colors;
}

function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const rm = (r + p[0]) / 2;
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Returns Int16Array of palette indices per cell (-1 = empty). */
export function quantize(cells, pal, { dither = true, outline = false } = {}) {
  const { G, cover } = cells;
  const rgb = punch(cells.rgb, cover);
  const out = new Int16Array(G * G).fill(-1);
  const spread = dither ? Math.min(70, 220 / Math.cbrt(pal.length)) * 0.5 : 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const c = y * G + x;
    if (cover[c] < 0.5) continue;
    const t = dither ? ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * spread : 0;
    out[c] = nearest(pal, rgb[c * 3] + t, rgb[c * 3 + 1] + t, rgb[c * 3 + 2] + t);
  }
  if (outline) {
    let dark = 0, dl = Infinity;
    pal.forEach((p, i) => { const l = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; if (l < dl) { dl = l; dark = i; } });
    const filled = (x, y) => x >= 0 && y >= 0 && x < G && y < G && out[y * G + x] >= 0;
    const edges = [];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (!filled(x, y)) continue;
      // outer outline only (ignore the bottom frame edge so the bust sits on the frame)
      const open = (!filled(x - 1, y) && x > 0) || (!filled(x + 1, y) && x < G - 1) || (!filled(x, y - 1) && y > 0) || (!filled(x, y + 1) && y < G - 1);
      if (open) edges.push(y * G + x);
    }
    for (const c of edges) out[c] = dark;
  }
  return out;
}

const SUNSET = [[254, 218, 117], [250, 126, 30], [214, 41, 118], [150, 47, 191], [79, 91, 213]];

function bgColor(kind, x, y, G) {
  if (kind === 'solid') return [26, 28, 44];
  // banded retro sunset
  const bands = 7;
  const t = Math.floor(((y + 0.5) / G) * bands) / (bands - 1);
  const f = t * (SUNSET.length - 1);
  const i = Math.min(SUNSET.length - 2, Math.floor(f)), u = f - i;
  return SUNSET[i].map((v, k) => Math.round(v + (SUNSET[i + 1][k] - v) * u));
}

/** Draws the sprite to `canvas` with crisp, integer-scaled pixels (~1024px). */
export function renderSprite(canvas, indices, pal, G, { bg = 'gradient', target = 1080 } = {}) {
  const scale = Math.max(1, Math.round(target / G));
  canvas.width = canvas.height = G * scale;
  const small = document.createElement('canvas');
  small.width = small.height = G;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(G, G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const c = y * G + x, k = indices[c];
    let col, a = 255;
    if (k >= 0) col = pal[k];
    else if (bg === 'none') { col = [0, 0, 0]; a = 0; }
    else col = bgColor(bg, x, y, G);
    img.data.set([col[0], col[1], col[2], a], c * 4);
  }
  sctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}
