// Turns raw depth + person mask into a clean, sculpted height field.

/** Separable box blur, repeated `passes` times (≈ gaussian). Returns a new array. */
export function blur(src, S, r, passes = 3) {
  r = Math.max(0, Math.round(r));
  if (r === 0) return Float32Array.from(src);
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    // horizontal a -> b
    for (let y = 0; y < S; y++) {
      const row = y * S;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + Math.min(S - 1, Math.max(0, k))];
      for (let x = 0; x < S; x++) {
        b[row + x] = sum / w;
        const add = Math.min(S - 1, x + r + 1), sub = Math.max(0, x - r);
        sum += a[row + add] - a[row + sub];
      }
    }
    // vertical b -> a
    for (let x = 0; x < S; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[Math.min(S - 1, Math.max(0, k)) * S + x];
      for (let y = 0; y < S; y++) {
        a[y * S + x] = sum / w;
        const add = Math.min(S - 1, y + r + 1), sub = Math.max(0, y - r);
        sum += b[add * S + x] - b[sub * S + x];
      }
    }
  }
  return a;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pre-computes everything that doesn't depend on the user sliders. */
export function prepareField(S, depth, rawMask) {
  // Clean the mask: light blur removes speckle, then a soft threshold.
  const m1 = blur(rawMask, S, 1, 2);
  const mask = new Float32Array(S * S);
  for (let i = 0; i < mask.length; i++) mask[i] = clamp01((m1[i] - 0.35) / 0.3);

  // Normalize depth using robust percentiles inside the person only.
  const vals = [];
  for (let i = 0; i < S * S; i += 3) if (mask[i] > 0.5) vals.push(depth[i]);
  vals.sort((a, b) => a - b);
  const lo = vals.length ? vals[Math.floor(vals.length * 0.02)] : 0;
  const hi = vals.length ? vals[Math.floor(vals.length * 0.995)] : 1;
  const range = hi - lo || 1;
  const dn = new Float32Array(S * S);
  for (let i = 0; i < dn.length; i++) dn[i] = clamp01((depth[i] - lo) / range) * mask[i];

  // "Dome": an inflated version of the silhouette that gives the bust volume.
  const bBig = blur(mask, S, S / 11, 3);
  const dome = new Float32Array(S * S);
  for (let i = 0; i < dome.length; i++) dome[i] = Math.sqrt(clamp01((bBig[i] - 0.5) / 0.5));

  // Rounded silhouette edge so the surface curls toward the outline.
  const bSmall = blur(mask, S, S / 36, 3);
  const edge = new Float32Array(S * S);
  for (let i = 0; i < edge.length; i++) edge[i] = Math.sqrt(clamp01((bSmall[i] - 0.5) / 0.5));

  return { S, mask, dn, dome, edge };
}

/** Height field 0..~1 from the prepared data + user params. */
export function heightField(prep, { volume = 0.35, smooth = 2 } = {}) {
  const { S, dn, dome, edge } = prep;
  const d = smooth > 0 ? blur(dn, S, smooth, 2) : dn;
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) {
    h[i] = ((1 - volume) * d[i] + volume * dome[i]) * edge[i];
  }
  return h;
}

/** Visualise a float field into a canvas (for the pipeline previews). */
export function drawField(canvas, S, field, colorize = false) {
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = clamp01(field[i]);
    let r, g, b;
    if (colorize) {
      // magma-ish ramp
      r = 255 * clamp01(1.6 * v);
      g = 255 * clamp01(1.5 * v - 0.45);
      b = 255 * clamp01(v < 0.5 ? 0.25 + v : 1.4 - v * 1.2 + (v > 0.85 ? (v - 0.85) * 4 : 0));
    } else {
      r = g = b = v * 255;
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
