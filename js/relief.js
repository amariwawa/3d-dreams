import * as THREE from 'three';

/**
 * Builds a closed "bust" mesh: a textured front surface displaced by the height field,
 * and a gently domed back, both stitched together along the silhouette.
 */
export function buildRelief({ prep, height, texture, strength = 0.6, style = 'real', N = 256, backColor }) {
  const { S, mask, dome } = prep;
  const V = (N + 1) * (N + 1);
  const idx = (i, j) => j * (N + 1) + i;
  const sample = (arr, i, j) => {
    const x = Math.min(S - 1, Math.round((i / N) * (S - 1)));
    const y = Math.min(S - 1, Math.round((j / N) * (S - 1)));
    return arr[y * S + x];
  };

  const mv = new Float32Array(V), hv = new Float32Array(V), dv = new Float32Array(V);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = idx(i, j);
    mv[k] = sample(mask, i, j); hv[k] = sample(height, i, j); dv[k] = sample(dome, i, j);
  }

  // Keep triangles inside the person; mark vertices touching both kept & dropped triangles as boundary.
  const tris = [];
  const hasKept = new Uint8Array(V), hasDropped = new Uint8Array(V);
  const consider = (a, b, c) => {
    const keep = (mv[a] + mv[b] + mv[c]) / 3 > 0.5;
    const flag = keep ? hasKept : hasDropped;
    flag[a] = flag[b] = flag[c] = 1;
    if (keep) tris.push(a, b, c);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
    consider(a, c, b);
    consider(b, c, d);
  }

  // Compact vertices.
  const remap = new Int32Array(V).fill(-1);
  let count = 0;
  for (let k = 0; k < V; k++) if (hasKept[k]) remap[k] = count++;

  const pos = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = idx(i, j);
    const r = remap[k];
    if (r < 0) continue;
    const boundary = hasDropped[k] || i === 0 || j === 0 || i === N || j === N;
    const x = (i / N) * 2 - 1, y = 1 - (j / N) * 2;
    const zf = boundary ? 0 : hv[k] * strength;
    const zb = boundary ? 0 : -dv[k] * strength * 0.45;
    pos.set([x, y, zf], r * 3);
    pos.set([x, y, zb], (r + count) * 3);
    uv.set([i / N, 1 - j / N], r * 2);
    uv.set([i / N, 1 - j / N], (r + count) * 2);
  }

  const index = new Uint32Array(tris.length * 2);
  for (let t = 0; t < tris.length; t += 3) {
    const a = remap[tris[t]], b = remap[tris[t + 1]], c = remap[tris[t + 2]];
    index[t] = a; index[t + 1] = b; index[t + 2] = c;
    // back face: reversed winding
    const o = tris.length + t;
    index[o] = a + count; index[o + 1] = c + count; index[o + 2] = b + count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.addGroup(0, tris.length, 0);
  geo.addGroup(tris.length, tris.length, 1);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, makeMaterials(style, texture, backColor));
  mesh.name = 'pfp3d_bust';
  // Center depth so it rotates around its middle.
  mesh.position.z = -strength * 0.25;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function makeMaterials(style, texture, backColor) {
  const back = new THREE.MeshStandardMaterial({ color: backColor ?? 0x2a2230, roughness: 0.85 });
  let front;
  switch (style) {
    case 'figurine':
      front = new THREE.MeshPhysicalMaterial({
        map: texture.toy, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.8,
      });
      back.roughness = 0.4;
      break;
    case 'clay':
      front = new THREE.MeshStandardMaterial({ color: 0xd8b9a2, roughness: 0.92, envMapIntensity: 0.6 });
      back.color.set(0xc7a48d);
      break;
    case 'gold':
      front = new THREE.MeshStandardMaterial({ color: 0xffc85c, metalness: 1, roughness: 0.26, envMapIntensity: 1.3 });
      back.color.set(0xd9a640); back.metalness = 1; back.roughness = 0.35;
      break;
    default:
      front = new THREE.MeshStandardMaterial({
        map: texture.photo, roughness: 0.62, metalness: 0, envMapIntensity: 0.55,
      });
  }
  return [front, back];
}

/** Photo texture + a punchier "vinyl toy" variant. */
export function makeTextures(canvas) {
  const photo = new THREE.CanvasTexture(canvas);
  photo.colorSpace = THREE.SRGBColorSpace;
  photo.anisotropy = 8;

  const S = canvas.width;
  const toyCanvas = document.createElement('canvas');
  toyCanvas.width = toyCanvas.height = S;
  const ctx = toyCanvas.getContext('2d');
  ctx.filter = 'saturate(1.35) contrast(1.12) brightness(1.04) blur(0.6px)';
  ctx.drawImage(canvas, 0, 0);
  const toy = new THREE.CanvasTexture(toyCanvas);
  toy.colorSpace = THREE.SRGBColorSpace;
  toy.anisotropy = 8;
  return { photo, toy, dispose() { photo.dispose(); toy.dispose(); } };
}
