// Builds a single, fully offline .html file that runs a live wallpaper full-screen.
// Works as: a phone "live window" (Safari/Chrome, gyro tilt), a macOS desktop wallpaper via Plash,
// a macOS screensaver via WebViewScreenSaver, and a Windows wallpaper/screensaver via Lively Wallpaper.
import { serialize } from 'wp-engine';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
let cache = null;

function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const dataURL = (src) => 'data:text/javascript;base64,' + b64utf8(src);

async function sources() {
  if (!cache) {
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('Could not fetch ' + u); return r.text(); });
    cache = Promise.all([get(THREE_URL), get(new URL('./scenes.js', import.meta.url)), get(new URL('./engine.js', import.meta.url))]);
  }
  return cache;
}

export async function buildStandaloneHTML({ sceneId, title, data = null }) {
  const [three, scenes, engine] = await sources();
  const importmap = JSON.stringify({ imports: { three: dataURL(three), 'wp-scenes': dataURL(scenes), 'wp-engine': dataURL(engine) } });
  const payload = JSON.stringify(data ? serialize(data) : null).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#000000">
<title>${title.replace(/</g, '&lt;')} · Live Wallpaper</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#000;cursor:none}
  canvas{display:block;width:100vw;height:100vh}
  #tap{position:fixed;inset:auto 0 8vh 0;margin:auto;width:max-content;padding:12px 18px;border-radius:999px;
    font:600 14px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.45);backdrop-filter:blur(10px);cursor:pointer}
</style>
<script type="importmap">${importmap}</script>
</head><body>
<canvas id="c"></canvas>
<div id="tap" hidden>Tap to enable tilt</div>
<script type="module">
import { WallpaperEngine, deserialize } from 'wp-engine';
const raw = ${payload};
const engine = new WallpaperEngine(document.getElementById('c'));
engine.fillWindow();
engine.load(${JSON.stringify(sceneId)}, raw ? deserialize(raw) : null);
engine.start();
const tap = document.getElementById('tap');
const needsAsk = window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function';
if (needsAsk) { tap.hidden = false; tap.onclick = async () => { await engine.enableMotion(); tap.hidden = true; }; }
else engine.enableMotion();
document.addEventListener('visibilitychange', () => document.hidden ? engine.stop() : engine.start());
</script>
</body></html>`;
  return new Blob([html], { type: 'text/html' });
}
