# PFP·3D

Upload a photo of yourself → get a **3D model**, an **8-bit 3D (voxel)** version and an **8-bit pixel-art** version, ready to use as a profile picture. Then turn it — or one of the built-in scenes — into a **live 3D wallpaper** for iPhone, Android, macOS and Windows. Everything runs in the browser; the photo never leaves your device.

Pages: **Create** (photo → 3D / 8-bit) · **Live Wallpapers** (store with device previews) · **Library** (purchased items).

## Run

```bash
npm start          # or: python3 -m http.server 4321
```

Open http://localhost:4321. The first run downloads the AI models (~100 MB, cached afterwards). Chrome/Edge with WebGPU is fastest; other browsers fall back to CPU (WASM).

## How it works

| Step | What happens | File |
|---|---|---|
| 1. Face detection | MediaPipe BlazeFace finds the largest face | `js/vision.js` |
| 2. Auto-frame | Square head-and-shoulders crop centered on the face (512×512) | `js/main.js` → `frame()` |
| 3. Cut-out | MediaPipe selfie multiclass segmentation → person mask; edge colors are "bled" inward so there are no background halos | `js/vision.js`, `bleedColors()` |
| 4. Depth | Depth Anything V2 (small) via transformers.js — relative depth, normalised with robust percentiles inside the person | `js/vision.js`, `js/field.js` |
| 5. Sculpt | Height = depth blended with an "inflated" silhouette (volume), rounded at the outline. Front surface is textured with your photo; a domed back closes the bust | `js/field.js`, `js/relief.js` |
| 8-bit | Grid sampling → palette (auto median-cut, NES, PICO-8, C64, Game Boy, 1-bit) → Bayer dithering + outline. Voxels use the same cells with depth snapped to whole voxel steps | `js/pixel.js`, `js/voxel.js` |

## Downloads

- **PNG 1080×1080** of the current 3D view (any background, or transparent)
- **.glb** 3D file (opens in Blender, Windows 3D Viewer, macOS Quick Look via Reality Converter, three.js, etc.)
- **Spin video** — a seamless 7-second loop (MP4 where supported, otherwise WebM)
- **8-bit PNG** with crisp, integer-scaled pixels

## Live wallpapers

8 tilt/mouse-reactive scenes (`js/wallpapers/scenes.js`), including two built from your own portrait. Each can be downloaded per device as:

- **Still** PNG at native resolution (iPhone 1290×2796, Android 1440×3120, Mac 2880×1800, Windows 3840×2160)
- **Loop video** (MP4/WebM) — Android video live wallpapers, iOS Live Photo converters, Lively Wallpaper
- **Interactive .html** — one self-contained offline file (three.js inlined). Gyro parallax on phones; mouse parallax on desktop. Use with Plash / WebViewScreenSaver (macOS) or Lively Wallpaper (Windows)

**Payments are in demo mode** (`js/wallpapers/store.js` → `checkout()` simulates success). To go live, have `checkout()` call a backend endpoint that creates a Stripe Checkout Session, and gate downloads on a server-verified purchase.

## Notes / limits

This is monocular depth from a single photo, so it's a high-relief "bust" rather than a full 360° head — the back is a smooth dome. Front-facing, evenly lit photos work best.
