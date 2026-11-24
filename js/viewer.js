import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const BACKGROUNDS = {
  insta: ['#feda75', '#fa7e1e', '#d62976', '#962fbf', '#4f5bd5'],
  midnight: ['#2b1d4a', '#140f26', '#07060d'],
  studio: ['#f4f1ec', '#d9d4cc', '#b9b3aa'],
  mint: ['#d9fff1', '#8fe3cf', '#3aa6a0'],
};

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.homePos = new THREE.Vector3(0, 0.05, 4.6);
    this.camera.position.copy(this.homePos);

    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 2.4, maxDistance: 9, rotateSpeed: 0.8 });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50406a, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.6);
    key.position.set(1.6, 2.2, 3.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8c8ff, 1.4);
    rim.position.set(-2.5, 1.5, -2.5);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd6e8, 0.5);
    fill.position.set(-2.5, -0.5, 2);
    this.scene.add(fill);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.content = null;

    this.sway = true;
    this.swaySpeed = 0.9; // rad/s of the phase
    this.swayAmp = 0.42;
    this.phase = 0;
    this.clock = new THREE.Clock();
    this.bgKind = 'insta';
    this.setBackground('insta');

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement);
    this.resize();
    renderer.setAnimationLoop(() => this.tick());
  }

  pause() { this.renderer.setAnimationLoop(null); }
  resume() { this.clock.getDelta(); this.renderer.setAnimationLoop(() => this.tick()); }

  resize() {
    if (this.locked) return;
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.sway) {
      this.phase += dt * this.swaySpeed;
      this.pivot.rotation.y = Math.sin(this.phase) * this.swayAmp;
      this.pivot.rotation.x = Math.cos(this.phase) * 0.05;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setContent(obj) {
    if (this.content) {
      this.pivot.remove(this.content);
      this.content.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => m.dispose());
      });
    }
    this.content = obj;
    if (obj) this.pivot.add(obj);
  }

  setBackground(kind) {
    this.bgKind = kind;
    if (this.scene.background && this.scene.background.isTexture) this.scene.background.dispose();
    const stops = BACKGROUNDS[kind];
    if (!stops) { this.scene.background = null; return; }
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 512, 512, 0);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    // soft spotlight behind the head
    const r = ctx.createRadialGradient(256, 210, 10, 256, 230, 330);
    r.addColorStop(0, 'rgba(255,255,255,0.28)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
  }

  resetView() {
    this.camera.position.copy(this.homePos);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Render a square frame at `size` px and return a PNG blob. */
  async snapshot(size = 1080) {
    this.withSize(size, () => this.renderer.render(this.scene, this.camera));
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    this.restoreSize();
    return blob;
  }

  withSize(size, fn) {
    this.locked = true;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    if (fn) fn();
  }

  restoreSize() {
    this.locked = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize();
  }

  async exportGLB() {
    const exporter = new GLTFExporter();
    const root = this.content.clone();
    root.rotation.set(0, 0, 0);
    const buf = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
    return new Blob([buf], { type: 'model/gltf-binary' });
  }

  /** Records one full sway loop as a video. Returns {blob, ext}. */
  async recordLoop(size = 1080) {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('Video recording is not supported in this browser.');
    const prevSway = this.sway;
    this.sway = true;
    this.phase = 0;
    this.resetView();
    this.withSize(size);
    const stream = this.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start();
    const seconds = (Math.PI * 2) / this.swaySpeed; // one full sway = seamless loop
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    this.restoreSize();
    this.sway = prevSway;
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
}
