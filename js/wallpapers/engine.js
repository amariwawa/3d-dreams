// Runs a live wallpaper scene: tilt/gyro + pointer parallax, auto-drift, still & video capture.
// Used both inside the app and inside the exported standalone wallpaper HTML.
import * as THREE from 'three';
import { getScene } from 'wp-scenes';

function makeEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0d0c16);
  const geo = new THREE.PlaneGeometry(1, 1);
  const panel = (color, k, pos, scale) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(0xffffff, 5, [0, 6, 0], [7, 7, 1]);
  panel(0xff6ec7, 3.5, [-6, 1, 2], [3, 6, 1]);
  panel(0x6ecbff, 3.5, [6, 1, -2], [3, 6, 1]);
  panel(0xffffff, 2.5, [0, 1, 7], [5, 2, 1]);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

export class WallpaperEngine {
  constructor(canvas, { pixelRatio = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
    this.canvas = canvas;
    this.pixelRatio = pixelRatio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setPixelRatio(pixelRatio);
    this.env = makeEnv(this.renderer);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.input = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.lastUserInput = -1e9;
    this.t = 0;
    this.clock = new THREE.Clock();
    this.forceDrift = false;
    this.locked = false;
    this.def = null;
    this.inst = null;
    this.scene = null;

    this._onPointer = (e) => {
      const r = this.pointerArea ? this.pointerArea.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      this.target.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
      this.target.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1.2, 1.2);
      this.lastUserInput = performance.now();
    };
    window.addEventListener('pointermove', this._onPointer);
  }

  /** Make the canvas fill the window (used by the standalone export). */
  fillWindow() {
    const fit = () => this.setSize(innerWidth, innerHeight);
    addEventListener('resize', fit);
    fit();
  }

  /** Size the drawing buffer to the canvas' parent element and keep it in sync. */
  autoSize() {
    const ro = new ResizeObserver(() => {
      const el = this.canvas.parentElement;
      if (el.clientWidth && el.clientHeight) this.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(this.canvas.parentElement);
  }

  setSize(w, h) {
    if (this.locked) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.layout(w / h);
  }

  layout(aspect) {
    const cam = this.camera, d = this.def;
    cam.aspect = aspect;
    if (!d) return cam.updateProjectionMatrix();
    const c = d.camera;
    cam.fov = c.fov;
    this.camTarget = new THREE.Vector3(...c.target);
    const pos = new THREE.Vector3(...c.pos);
    if (d.fit) {
      const tan = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
      const dist = Math.max(d.fit.h / (2 * tan), d.fit.w / (2 * tan * aspect));
      pos.sub(this.camTarget).normalize().multiplyScalar(dist).add(this.camTarget);
    }
    this.camBase = pos;
    cam.updateProjectionMatrix();
  }

  load(id, data = null) {
    this.dispose();
    const def = getScene(id);
    if (!def) throw new Error('Unknown wallpaper: ' + id);
    this.def = def;
    this.scene = new THREE.Scene();
    this.inst = def.create({ THREE, scene: this.scene, camera: this.camera, renderer: this.renderer, env: this.env, data });
    this.t = 0;
    this.layout(this.w && this.h ? this.w / this.h : 9 / 19.5);
  }

  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { m.map?.dispose?.(); m.dispose(); });
    });
    this.scene = null;
    this.inst = null;
  }

  start() {
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this.frame(Math.min(0.05, this.clock.getDelta())));
  }
  stop() { this.renderer.setAnimationLoop(null); }

  frame(dt) {
    if (!this.inst) return;
    this.t += dt;
    const idle = performance.now() - this.lastUserInput > 2500;
    if (this.forceDrift || (idle && !this.gyroActive)) {
      this.target.x = Math.sin(this.t * 0.35) * 0.65;
      this.target.y = Math.sin(this.t * 0.23 + 1) * 0.35;
    }
    const k = 1 - Math.exp(-dt * 4);
    this.input.x += (this.target.x - this.input.x) * k;
    this.input.y += (this.target.y - this.input.y) * k;

    const p = this.def.camera.parallax ?? 1;
    const cam = this.camera;
    cam.position.copy(this.camBase);
    cam.position.x += this.input.x * p;
    cam.position.y += this.input.y * p * 0.6;
    cam.lookAt(this.camTarget);
    this.inst.update({ t: this.t, dt, input: this.input, aspect: cam.aspect, camera: cam });
    this.renderer.render(this.scene, cam);
  }

  /** Gyroscope parallax. Must be called from a user gesture on iOS. Returns true if enabled. */
  async enableMotion() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try { if ((await DOE.requestPermission()) !== 'granted') return false; } catch { return false; }
    }
    let base = null;
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      // slowly re-center to however the phone is being held
      base.b += (e.beta - base.b) * 0.004;
      base.g += (e.gamma - base.g) * 0.004;
      this.target.x = clamp((e.gamma - base.g) / 22);
      this.target.y = clamp(-(e.beta - base.b) / 22);
      this.gyroActive = true;
      this.lastUserInput = performance.now();
    });
    return true;
  }

  _withSize(w, h, fn) {
    this.locked = true;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.layout(w / h);
    return Promise.resolve(fn()).finally(() => {
      this.locked = false;
      if (this.w) this.setSize(this.w, this.h);
    });
  }

  /** PNG still at an exact resolution. */
  snapshot(w, h) {
    return this._withSize(w, h, async () => {
      this.frame(0);
      return await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    });
  }

  /** Looping video (auto-drift parallax so the depth is visible). Returns {blob, ext}. */
  record(w, h, seconds = 8, onProgress = () => {}) {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) return Promise.reject(new Error('Video recording is not supported in this browser.'));
    return this._withSize(w, h, async () => {
      this.forceDrift = true;
      const stream = this.canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.round(w * h * 30 * 0.12) });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      const t0 = performance.now();
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const f = (performance.now() - t0) / (seconds * 1000);
          onProgress(Math.min(1, f));
          if (f >= 1) { clearInterval(iv); resolve(); }
        }, 100);
      });
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      this.forceDrift = false;
      return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
    });
  }
}

// ---- (de)serialisation of typed arrays so personal scenes can be embedded in a standalone file
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function serialize(obj) {
  return JSON.stringify(obj, (k, v) =>
    ArrayBuffer.isView(v) ? { __ta: v.constructor.name, b64: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) } : v
  );
}
export function deserialize(json) {
  return JSON.parse(json, (k, v) => {
    if (v && v.__ta) {
      const bin = atob(v.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new globalThis[v.__ta](bytes.buffer);
    }
    return v;
  });
}
