import * as THREE from 'three';

/**
 * "8-bit 3D": one voxel column per pixel cell, colored from the 8-bit palette,
 * height snapped to whole voxel steps from the depth field. Merged into one mesh (exports cleanly to GLB).
 */
export function buildVoxels({ cells, indices, pal, strength = 0.6 }) {
  const { G, field } = cells;
  const vs = 2 / G; // voxel size in world units (portrait spans -1..1)
  const levels = Math.max(2, Math.round(G * 0.32 * strength));
  const backZ = -vs * Math.max(2, Math.round(levels * 0.25));

  const linear = pal.map(([r, g, b]) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));

  let n = 0;
  for (let c = 0; c < G * G; c++) if (indices[c] >= 0) n++;

  const pos = new Float32Array(n * 24 * 3);
  const nor = new Float32Array(n * 24 * 3);
  const col = new Float32Array(n * 24 * 3);
  const idx = new Uint32Array(n * 36);
  let v = 0, t = 0;

  // faces: [normal, 4 corners as (sx,sy,sz) in {0,1}]
  const FACES = [
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 1.0],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], 0.6],
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 0.82],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.82],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 0.92],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.7],
  ];

  for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) {
    const c = cy * G + cx;
    const k = indices[c];
    if (k < 0) continue;
    const h = field ? field[c] : 0.5;
    const zTop = vs * (1 + Math.round(h * levels));
    const x0 = -1 + cx * vs, x1 = x0 + vs;
    const y1 = 1 - cy * vs, y0 = y1 - vs;
    const z0 = backZ, z1 = zTop;
    const base = linear[k];
    for (const [nrm, corners, shade] of FACES) {
      // baked shade on sides makes the voxel steps readable even in flat light
      const r = base.r * shade, g = base.g * shade, b = base.b * shade;
      for (const [sx, sy, sz] of corners) {
        pos[v * 3] = sx ? x1 : x0; pos[v * 3 + 1] = sy ? y1 : y0; pos[v * 3 + 2] = sz ? z1 : z0;
        nor.set(nrm, v * 3);
        col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b;
        v++;
      }
      const s = v - 4;
      idx[t++] = s; idx[t++] = s + 1; idx[t++] = s + 2;
      idx[t++] = s; idx[t++] = s + 2; idx[t++] = s + 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pfp3d_voxels';
  mesh.position.z = -(backZ + vs * levels * 0.5) * 0.5;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
