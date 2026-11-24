// Live 3D wallpaper scenes. Self-contained (imports only three) so they can be embedded
// into the standalone offline wallpaper/screensaver HTML export.
import * as THREE from 'three';

// ------------------------------------------------------------------ helpers
const NOISE = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.02; a *= 0.5; } return v; }
`;

/** Full-screen background quad that ignores the camera (always covers the screen at any aspect). */
function backdrop(frag) {
  const uniforms = { uTime: { value: 0 }, uOff: { value: new THREE.Vector2() }, uAspect: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: 'uniform float uTime; uniform vec2 uOff; uniform float uAspect; varying vec2 vUv;\n' + NOISE + frag,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.userData.tick = (t, input, aspect) => {
    uniforms.uTime.value = t;
    uniforms.uOff.value.set(input.x * 0.05, input.y * 0.05);
    uniforms.uAspect.value = aspect;
  };
  return mesh;
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

function bokehTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 40, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function studioLights(scene, { key = 1.6, rim = 1.2, hemi = 0.9 } = {}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2f55, hemi));
  const k = new THREE.DirectionalLight(0xfff2e6, key);
  k.position.set(2, 3, 4);
  scene.add(k);
  const r = new THREE.DirectionalLight(0xa8c4ff, rim);
  r.position.set(-3, 2, -3);
  scene.add(r);
}

// Responsive placement: column on portrait screens, row on landscape.
const place = ([x, y, z], aspect) => (aspect > 1 ? [y * 1.25, -x * 0.7, z] : [x, y, z]);

// ------------------------------------------------------------------ shared backdrops
const AURORA = /* glsl */ `
void main(){
  vec2 p = vUv; p.x *= uAspect; p += uOff;
  vec3 col = mix(vec3(0.01,0.015,0.05), vec3(0.05,0.02,0.11), vUv.y);
  float t = uTime * 0.05;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float band = fbm(vec2(p.x*1.1 + fi*3.1 + t*(1.0+fi*0.3), t*0.8 + fi));
    float y = 0.32 + 0.22*fi + (band - 0.5)*0.55;
    float d = vUv.y - y;
    float glow = exp(-d*d*55.0) * (0.55 + 0.7*fbm(vec2(p.x*7.0 + t*4.0, fi*5.0)));
    glow *= smoothstep(-0.25, 0.05, d) ;
    vec3 c = i == 0 ? vec3(0.1,1.0,0.65) : (i == 1 ? vec3(0.55,0.35,1.0) : vec3(1.0,0.35,0.65));
    col += c * glow * 0.5;
  }
  vec2 g = floor((p + uOff*2.0) * 140.0);
  float s = step(0.9965, hash(g)) * (0.4 + 0.6*sin(uTime*1.7 + hash(g+3.0)*40.0));
  col += vec3(s) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const SYNTH_SKY = /* glsl */ `
void main(){
  vec2 p = vUv; p.x *= uAspect;
  float h = vUv.y;
  vec3 top = vec3(0.04,0.01,0.12), mid = vec3(0.32,0.05,0.42), low = vec3(1.0,0.38,0.55);
  vec3 col = mix(low, mid, smoothstep(0.42, 0.62, h));
  col = mix(col, top, smoothstep(0.6, 1.0, h));
  vec2 g = floor((p + uOff) * 160.0);
  col += step(0.997, hash(g)) * smoothstep(0.55, 0.9, h) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

function addSynthWorld(scene) {
  const sky = backdrop(SYNTH_SKY);
  scene.add(sky);

  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 c = vUv - 0.5; float r = length(c);
        if (r > 0.5) discard;
        vec3 col = mix(vec3(1.0,0.2,0.55), vec3(1.0,0.86,0.3), smoothstep(0.0, 1.0, vUv.y));
        float y = vUv.y;
        float stripe = fract(y*14.0 + uTime*0.25);
        float th = smoothstep(0.55, 0.0, y) * 0.75;
        if (y < 0.55 && stripe < th) discard;
        float edge = smoothstep(0.5, 0.47, r);
        gl_FragColor = vec4(col, edge);
      }`,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), sunMat);
  sun.position.set(0, 7, -90);
  scene.add(sun);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4f9a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(70, 70, 1);
  halo.position.set(0, 7, -95);
  scene.add(halo);

  // Mountains: two jagged silhouette layers with neon ridge lines.
  const r = rng(7);
  for (const [z, hMax, col, line] of [[-70, 9, 0x1b0730, 0xff3df0], [-55, 5, 0x12041f, 0x45e3ff]]) {
    const pts = [];
    for (let x = -140; x <= 140; x += 6 + r() * 6) {
      const center = Math.abs(x) < 18 ? 0.25 : 1;
      pts.push(new THREE.Vector2(x, -1.5 + (r() * 0.7 + 0.3) * hMax * center));
    }
    const shape = new THREE.Shape();
    shape.moveTo(-140, -3);
    pts.forEach((p) => shape.lineTo(p.x, p.y));
    shape.lineTo(140, -3);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col }));
    m.position.z = z;
    scene.add(m);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, z + 0.1))), new THREE.LineBasicMaterial({ color: line }));
    scene.add(l);
  }

  const gridMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vW;
      float line(float v){ float w = fwidth(v); return 1.0 - smoothstep(0.0, w*1.6, abs(fract(v - 0.5) - 0.5)); }
      void main(){
        vec2 c = vec2(vW.x*0.5, vW.z*0.5 + uTime*1.6);
        float g = max(line(c.x), line(c.y));
        float dist = length(vW.xz);
        float fade = exp(-dist*0.018);
        vec3 lineCol = mix(vec3(0.27,0.89,1.0), vec3(1.0,0.24,0.94), smoothstep(10.0, 60.0, dist));
        vec3 col = vec3(0.03,0.0,0.07) + lineCol * g * fade * 1.4;
        col += vec3(1.0,0.3,0.6) * smoothstep(40.0, 90.0, dist) * 0.25;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, -1.5, -100);
  scene.add(grid);

  return (t, input, aspect) => {
    sky.userData.tick(t, input, aspect);
    sunMat.uniforms.uTime.value = t;
    gridMat.uniforms.uTime.value = t;
  };
}

function addBokeh(scene, { count = 140, colors = [0x7cf2ff, 0xff7ac8, 0xb08cff, 0xffd27a], zRange = [-16, 2], spread = [7, 10], seed = 3 } = {}) {
  const r = rng(seed);
  const soft = glowTexture(), ring = bokehTexture();
  const items = [];
  for (let i = 0; i < count; i++) {
    const isRing = r() < 0.25;
    const mat = new THREE.SpriteMaterial({
      map: isRing ? ring : soft,
      color: colors[Math.floor(r() * colors.length)],
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    const z = zRange[0] + r() * (zRange[1] - zRange[0]);
    const depthScale = 1 + (-z / 6);
    s.position.set((r() * 2 - 1) * spread[0] * depthScale, (r() * 2 - 1) * spread[1] * depthScale, z);
    const size = (0.15 + r() * r() * 1.6) * depthScale;
    s.scale.set(size, size, 1);
    s.userData = { speed: 0.05 + r() * 0.25, phase: r() * 10, base: 0.12 + r() * 0.5, h: spread[1] * depthScale };
    scene.add(s);
    items.push(s);
  }
  return (t, dt) => {
    for (const s of items) {
      const u = s.userData;
      s.position.y += u.speed * dt;
      if (s.position.y > u.h) s.position.y = -u.h;
      s.material.opacity = u.base * (0.6 + 0.4 * Math.sin(t * 0.8 + u.phase));
    }
  };
}

// ------------------------------------------------------------------ scenes
function aurora({ scene, env }) {
  const bg = backdrop(AURORA);
  scene.add(bg);
  scene.environment = env;
  studioLights(scene, { key: 2.2, rim: 1.5, hemi: 0.4 });

  const glass = new THREE.MeshPhysicalMaterial({
    transmission: 1, thickness: 1.2, roughness: 0.06, ior: 1.45, iridescence: 0.9, iridescenceIOR: 1.35,
    metalness: 0, envMapIntensity: 1.4, color: 0xffffff, specularIntensity: 1,
  });
  const defs = [
    [new THREE.TorusKnotGeometry(0.62, 0.22, 220, 36), [0.35, 1.0, 0]],
    [new THREE.IcosahedronGeometry(0.75, 0), [-0.75, -0.55, -1]],
    [new THREE.TorusGeometry(0.55, 0.2, 32, 96), [0.7, -2.0, 0.4]],
    [new THREE.OctahedronGeometry(0.5, 0), [-0.8, 2.5, -1.6]],
    [new THREE.SphereGeometry(0.42, 48, 32), [0.95, 2.9, -2.6]],
    [new THREE.CapsuleGeometry(0.28, 0.7, 8, 24), [-0.9, -2.7, -0.6]],
  ];
  const r = rng(11);
  const meshes = defs.map(([g, p]) => {
    const m = new THREE.Mesh(g, glass);
    m.userData = { p, spin: [r() - 0.5, r() - 0.5, r() - 0.5].map((v) => v * 0.6), phase: r() * 6 };
    scene.add(m);
    return m;
  });
  return {
    update({ t, dt, input, aspect }) {
      bg.userData.tick(t, input, aspect);
      for (const m of meshes) {
        const u = m.userData;
        const [x, y, z] = place(u.p, aspect);
        m.position.set(x, y + Math.sin(t * 0.5 + u.phase) * 0.15, z);
        m.rotation.x += u.spin[0] * dt;
        m.rotation.y += u.spin[1] * dt;
        m.rotation.z += u.spin[2] * dt;
      }
    },
  };
}

function neon({ scene }) {
  const tick = addSynthWorld(scene);
  return { update: ({ t, input, aspect }) => tick(t, input, aspect) };
}

function galaxy({ scene }) {
  const bg = backdrop(/* glsl */ `void main(){
    vec2 p = vUv; p.x *= uAspect; p += uOff;
    vec3 col = vec3(0.005,0.006,0.02);
    float n = fbm(p*2.5 + uTime*0.01);
    col += vec3(0.25,0.08,0.4) * pow(n, 3.0) * 0.6 + vec3(0.05,0.15,0.35) * pow(fbm(p*3.0+7.0), 4.0);
    vec2 g = floor(p*180.0); col += step(0.997, hash(g)) * 0.7;
    gl_FragColor = vec4(col, 1.0);
  }`);
  scene.add(bg);

  const count = 45000, R = 5, branches = 5, spin = 1.15;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const inner = new THREE.Color(0xffb36b), outer = new THREE.Color(0x5b6cff), pink = new THREE.Color(0xff5fa8);
  const r = rng(5), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const rad = Math.pow(r(), 1.6) * R;
    const ang = ((i % branches) / branches) * Math.PI * 2 + rad * spin;
    const rnd = () => Math.pow(r(), 3) * (r() < 0.5 ? 1 : -1) * 0.45 * (0.3 + rad * 0.3);
    pos[i * 3] = Math.cos(ang) * rad + rnd();
    pos[i * 3 + 1] = rnd() * 0.5;
    pos[i * 3 + 2] = Math.sin(ang) * rad + rnd();
    c.copy(inner).lerp(outer, rad / R);
    if (r() < 0.12) c.lerp(pink, 0.7);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.05, sizeAttenuation: true, vertexColors: true, map: glowTexture(), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc58a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  core.scale.set(3, 3, 1);
  const group = new THREE.Group();
  group.add(pts, core);
  group.rotation.x = 0.55;
  group.rotation.z = 0.25;
  scene.add(group);
  return {
    update({ t, input, aspect }) {
      bg.userData.tick(t, input, aspect);
      pts.rotation.y = t * 0.06;
    },
  };
}

function chrome({ scene }) {
  const bg = backdrop(/* glsl */ `void main(){
    vec2 p = vUv - 0.5; p.x *= uAspect; p += uOff;
    vec3 col = mix(vec3(0.02,0.01,0.05), vec3(0.09,0.04,0.16), vUv.y);
    col += vec3(0.6,0.25,1.0) * exp(-dot(p,p)*5.0) * 0.35;
    col += vec3(0.05) * fbm(p*4.0 + uTime*0.05);
    gl_FragColor = vec4(col, 1.0);
  }`);
  scene.add(bg);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uA: { value: new THREE.Color(1.0, 0.88, 0.96) },
      uB: { value: new THREE.Color(0.55, 0.35, 1.0) },
      uC: { value: new THREE.Color(0.02, 0.01, 0.06) },
    },
    vertexShader: /* glsl */ `uniform float uTime; varying vec3 vN; varying vec3 vView;
      float disp(vec3 p){ return 0.2*sin(p.x*2.1+uTime)*sin(p.y*2.4+uTime*1.3)*sin(p.z*1.9+uTime*0.8) + 0.07*sin(p.x*5.0+p.y*4.0+uTime*2.0); }
      vec3 displaced(vec3 p){ return p + normalize(p)*disp(p); }
      void main(){
        vec3 p = position; vec3 n = normalize(p);
        vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0)));
        vec3 b = cross(n, t);
        float e = 0.01;
        vec3 p0 = displaced(p), p1 = displaced(p + t*e), p2 = displaced(p + b*e);
        vec3 nn = normalize(cross(p1 - p0, p2 - p0));
        vec4 wp = modelMatrix*vec4(p0, 1.0);
        vN = normalize(mat3(modelMatrix)*nn);
        vView = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uA, uB, uC; varying vec3 vN; varying vec3 vView;
      void main(){
        vec3 n = normalize(vN); vec3 r = reflect(vView, n);
        float y = r.y*0.5 + 0.5;
        vec3 env = mix(uC, uB, smoothstep(0.2, 0.55, y));
        env = mix(env, uA, smoothstep(0.58, 0.95, y));
        env += vec3(1.0) * smoothstep(0.9, 0.96, abs(r.x*0.6 + r.y*0.8)) * 0.8;
        env += vec3(1.0) * pow(max(0.0, dot(r, normalize(vec3(-0.4,0.8,0.5)))), 50.0) * 1.6;
        float fres = pow(1.0 - max(0.0, dot(-vView, n)), 3.0);
        gl_FragColor = vec4(env + fres*uB*0.7, 1.0);
      }`,
  });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 64), mat);
  scene.add(blob);
  const minis = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 24), mat);
    m.scale.setScalar(0.18 + i * 0.07);
    scene.add(m);
    return m;
  });
  return {
    update({ t, input, aspect }) {
      bg.userData.tick(t, input, aspect);
      mat.uniforms.uTime.value = t * 0.8;
      blob.rotation.y = t * 0.15;
      minis.forEach((m, i) => {
        const a = t * (0.35 + i * 0.12) + i * 2.1;
        const rx = 1.9 + i * 0.35;
        m.position.set(Math.cos(a) * rx * (aspect > 1 ? 1.3 : 0.75), Math.sin(a * 0.7 + i) * 1.4, Math.sin(a) * rx);
      });
    },
  };
}

function pixelIsle({ scene }) {
  const bg = backdrop(/* glsl */ `void main(){
    float y = floor(vUv.y*14.0)/14.0;
    vec3 col = mix(vec3(1.0,0.78,0.6), vec3(0.36,0.62,1.0), smoothstep(0.1, 0.9, y));
    col = mix(col, vec3(0.2,0.35,0.85), smoothstep(0.8, 1.0, y));
    gl_FragColor = vec4(col, 1.0);
  }`);
  scene.add(bg);
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6a5a7a, 1.4));
  const sunL = new THREE.DirectionalLight(0xfff0d6, 2.2);
  sunL.position.set(4, 6, 5);
  scene.add(sunL);

  const r = rng(21);
  const R = 10;
  const blocks = [];
  const n2 = (x, z) => Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.48 - 0.4) + Math.sin((x + z) * 0.3) * 0.6;
  const colOf = { grass: 0x5cc44a, grass2: 0x4bb03d, sand: 0xf2d48a, dirt: 0x8a5a3b, stone: 0x6b6b7a, stone2: 0x575768, trunk: 0x7a4b2a, leaf: 0x2f9e44, leaf2: 0x3fbf55, flower: 0xff6fa8, water: 0x3fa9ff };
  const tops = [];
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, z) + n2(x, z) * 1.2;
    if (d > R) continue;
    const k = 1 - d / R;
    const h = Math.max(0, Math.round(k * 4 + n2(x * 1.3, z * 1.3) * 1.5));
    const bottom = -Math.round(k * 7 + r() * 1.5) - 1;
    for (let y = bottom; y <= h; y++) {
      let c;
      if (y === h) c = h <= 0 ? colOf.sand : (r() < 0.5 ? colOf.grass : colOf.grass2);
      else if (y >= h - 1) c = colOf.dirt;
      else c = r() < 0.5 ? colOf.stone : colOf.stone2;
      blocks.push([x, y, z, c]);
    }
    tops.push([x, h, z]);
  }
  // trees & flowers
  for (const [x, h, z] of tops) {
    if (h < 1) continue;
    const roll = r();
    if (roll < 0.035) {
      for (let y = 1; y <= 3; y++) blocks.push([x, h + y, z, colOf.trunk]);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 3; dy <= 4; dy++) {
        if (Math.abs(dx) + Math.abs(dz) === 2 && dy === 4) continue;
        blocks.push([x + dx, h + dy, z + dz, r() < 0.5 ? colOf.leaf : colOf.leaf2]);
      }
      blocks.push([x, h + 5, z, colOf.leaf2]);
    } else if (roll < 0.07) {
      blocks.push([x, h + 1, z, colOf.flower]);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), blocks.length);
  const m4 = new THREE.Matrix4(), color = new THREE.Color();
  blocks.forEach(([x, y, z, c], i) => {
    m4.makeTranslation(x, y, z);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, color.set(c));
  });
  const island = new THREE.Group();
  island.add(inst);

  // waterfall
  const wf = [];
  for (let y = -6; y <= 0; y++) wf.push([R - 2, y, 1]);
  const water = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: colOf.water, transparent: true, opacity: 0.85 }), wf.length);
  wf.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); water.setMatrixAt(i, m4); });
  island.add(water);
  island.scale.setScalar(0.2);
  scene.add(island);

  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x334466, emissiveIntensity: 0.3 });
  const clouds = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const nb = 4 + Math.floor(r() * 4);
    for (let j = 0; j < nb; j++) {
      const b = new THREE.Mesh(box, cloudMat);
      b.position.set(j * 0.9 - nb * 0.45, r() < 0.4 ? 0.8 : 0, r() * 0.8);
      b.scale.set(1, 0.8, 1);
      g.add(b);
    }
    g.scale.setScalar(0.22);
    g.userData = { y: 1.4 + r() * 2.4 - (i % 2) * 3.8, z: -1.5 - r() * 3, speed: 0.12 + r() * 0.15, x: r() * 8 - 4 };
    scene.add(g);
    clouds.push(g);
  }
  return {
    update({ t, dt, input, aspect }) {
      bg.userData.tick(t, input, aspect);
      island.rotation.y = t * 0.12;
      island.position.y = Math.sin(t * 0.8) * 0.08;
      for (const c of clouds) {
        const u = c.userData;
        u.x += u.speed * dt;
        if (u.x > 5) u.x = -5;
        c.position.set(u.x, u.y, u.z);
      }
    },
  };
}

function bokeh({ scene }) {
  const bg = backdrop(/* glsl */ `void main(){
    vec2 p = vUv; p.x *= uAspect; p += uOff;
    vec3 col = mix(vec3(0.01,0.03,0.06), vec3(0.02,0.11,0.16), vUv.y);
    col += vec3(0.4,0.1,0.5) * pow(fbm(p*1.6 + uTime*0.02), 3.0) * 0.5;
    gl_FragColor = vec4(col, 1.0);
  }`);
  scene.add(bg);
  const tick = addBokeh(scene, { count: 170 });
  return { update({ t, dt, input, aspect }) { bg.userData.tick(t, input, aspect); tick(t, dt); } };
}

// --- personal (built from the user's 3D portrait) ---
function portraitMaterials(data) {
  const back = new THREE.MeshStandardMaterial({ color: data.backColor ?? 0x2a2230, roughness: 0.85 });
  let tex = null;
  if (data.texture) {
    tex = new THREE.TextureLoader().load(data.texture);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }
  let front;
  switch (data.style) {
    case 'figurine': front = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12 }); break;
    case 'clay': front = new THREE.MeshStandardMaterial({ color: 0xd8b9a2, roughness: 0.92 }); back.color.set(0xc7a48d); break;
    case 'gold': front = new THREE.MeshStandardMaterial({ color: 0xffc85c, metalness: 1, roughness: 0.26 }); back.color.set(0xd9a640); back.metalness = 1; break;
    default: front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, envMapIntensity: 0.55 });
  }
  return [front, back];
}

function geometryFrom(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  if (g.uv) geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  if (g.color) geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  (g.groups || []).forEach(([s, c, m]) => geo.addGroup(s, c, m));
  if (!g.normal) geo.computeVertexNormals();
  return geo;
}

function portrait({ scene, env, data }) {
  const bg = backdrop(AURORA);
  scene.add(bg);
  scene.environment = env;
  studioLights(scene, { key: 1.8, rim: 1.8, hemi: 1.0 });
  const tick = addBokeh(scene, { count: 70, zRange: [-14, -2], seed: 9 });
  const holder = new THREE.Group();
  scene.add(holder);
  if (data?.relief) {
    const mesh = new THREE.Mesh(geometryFrom(data.relief), portraitMaterials(data.relief));
    mesh.position.z = -0.15;
    holder.add(mesh);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9a6bff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(5, 5, 1);
  glow.position.z = -1.5;
  scene.add(glow);
  return {
    update({ t, dt, input, aspect }) {
      bg.userData.tick(t, input, aspect);
      tick(t, dt);
      // the bust turns to "look" toward your tilt
      holder.rotation.y = input.x * 0.55 + Math.sin(t * 0.35) * 0.08;
      holder.rotation.x = -input.y * 0.25;
      holder.position.y = Math.sin(t * 0.9) * 0.05;
    },
  };
}

function portraitVoxel({ scene, data }) {
  const tick = addSynthWorld(scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x552266, 1.3));
  const k = new THREE.DirectionalLight(0xffe0f0, 1.8);
  k.position.set(2, 3, 4);
  scene.add(k);
  const rim = new THREE.DirectionalLight(0x45e3ff, 2.2);
  rim.position.set(-3, 1, -2);
  scene.add(rim);
  const holder = new THREE.Group();
  scene.add(holder);
  if (data?.voxel) {
    const mesh = new THREE.Mesh(geometryFrom(data.voxel), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    mesh.position.z = -0.2;
    holder.add(mesh);
  }
  holder.position.y = 0.4;
  return {
    update({ t, input, aspect }) {
      tick(t, input, aspect);
      holder.rotation.y = input.x * 0.6 + Math.sin(t * 0.4) * 0.1;
      holder.rotation.x = -input.y * 0.2;
      holder.position.y = 0.4 + Math.sin(t * 1.2) * 0.06;
    },
  };
}

// ------------------------------------------------------------------ catalog
// camera: position/target/fov; fit: world-space box that must stay visible at any aspect; parallax: how far tilt moves the camera
export const SCENES = [
  { id: 'portrait', name: 'Your 3D Portrait', tagline: 'Your own 3D bust floating in northern lights. It turns to follow your tilt.', price: 4.99, tags: ['Personal', 'Tilt-reactive'], personal: 'relief', camera: { pos: [0, 0.1, 6], target: [0, 0, 0], fov: 35, parallax: 0.7 }, fit: { w: 2.05, h: 3.2 }, create: portrait },
  { id: 'portrait-8bit', name: 'Your 8-bit Self', tagline: 'Your voxel avatar hovering over an endless neon horizon.', price: 4.99, tags: ['Personal', '8-bit'], personal: 'voxel', camera: { pos: [0, 0.6, 7], target: [0, 0.6, 0], fov: 38, parallax: 0.9 }, fit: { w: 2.15, h: 3.4 }, create: portraitVoxel },
  { id: 'aurora', name: 'Aurora Glass', tagline: 'Iridescent glass sculptures drifting through moving northern lights.', price: 2.99, tags: ['Glass', 'Calm'], camera: { pos: [0, 0, 7], target: [0, 0, 0], fov: 40, parallax: 1.0 }, fit: { w: 2.6, h: 6.4 }, create: aurora },
  { id: 'neon', name: 'Neon Horizon', tagline: 'Endless retro grid racing toward a striped sunset.', price: 1.99, tags: ['Retro', 'Motion'], camera: { pos: [0, 0.4, 10], target: [0, 1.6, -30], fov: 50, parallax: 1.4 }, create: neon },
  { id: 'galaxy', name: 'Spiral Bloom', tagline: '45,000 stars slowly turning in a living spiral galaxy.', price: 2.99, tags: ['Space', 'Calm'], camera: { pos: [0, 1.2, 8], target: [0, 0, 0], fov: 45, parallax: 1.2 }, fit: { w: 5.2, h: 5 }, create: galaxy },
  { id: 'chrome', name: 'Liquid Chrome', tagline: 'A molten mirror blob with orbiting droplets.', price: 2.49, tags: ['Abstract', 'Chrome'], camera: { pos: [0, 0, 6], target: [0, 0, 0], fov: 40, parallax: 0.9 }, fit: { w: 3.2, h: 4.2 }, create: chrome },
  { id: 'pixelisle', name: 'Pixel Isle', tagline: 'A tiny floating voxel island with a waterfall and drifting clouds.', price: 1.99, tags: ['8-bit', 'Cozy'], camera: { pos: [0, 1.6, 8], target: [0, 0, 0], fov: 40, parallax: 1.0 }, fit: { w: 4.6, h: 4.2 }, create: pixelIsle },
  { id: 'bokeh', name: 'Bokeh Drift', tagline: 'Soft lights at many depths — the strongest "window into another world" effect.', price: 1.49, tags: ['Depth', 'Minimal'], camera: { pos: [0, 0, 6], target: [0, 0, 0], fov: 45, parallax: 1.8 }, create: bokeh },
];

export const getScene = (id) => SCENES.find((s) => s.id === id);
