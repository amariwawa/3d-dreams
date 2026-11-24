// AI models: face detection + person segmentation (MediaPipe) and monocular depth (Depth Anything V2).
// Everything runs locally in the browser; model weights are fetched from public CDNs once and cached.

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

let faceDetector = null;
let segmenter = null;
let depthPipe = null;

async function createWithFallback(factory, opts) {
  try {
    return await factory({ ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    console.warn('GPU delegate failed, using CPU', e);
    return await factory({ ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
  }
}

/** Load all models. onProgress(fraction 0..1, label) */
export async function loadModels(onProgress = () => {}) {
  const mp = await import(`${MP_URL}/vision_bundle.mjs`);
  const fileset = await mp.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);

  const mpReady = (async () => {
    faceDetector = await createWithFallback(
      (o) => mp.FaceDetector.createFromOptions(fileset, o),
      { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 }
    );
    segmenter = await createWithFallback(
      (o) => mp.ImageSegmenter.createFromOptions(fileset, o),
      { baseOptions: { modelAssetPath: SEG_MODEL }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false }
    );
  })();

  const depthReady = (async () => {
    const { pipeline, env } = await import(TRANSFORMERS_URL);
    env.allowLocalModels = false;
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let loaded = 0, total = 0;
        for (const [l, t] of files.values()) { loaded += l; total += t; }
        onProgress(loaded / total, `Downloading depth model… ${Math.round((loaded / total) * 100)}%`);
      }
    };
    const hasWebGPU = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
    if (hasWebGPU) {
      try {
        // fp16 = half the download (~50 MB) and faster on GPU; fall back to fp32 if the GPU lacks fp16.
        const fp16 = (await navigator.gpu.requestAdapter())?.features.has('shader-f16');
        depthPipe = await pipeline('depth-estimation', DEPTH_MODEL, { device: 'webgpu', dtype: fp16 ? 'fp16' : 'fp32', progress_callback });
        await warmUp();
        return 'webgpu';
      } catch (e) {
        console.warn('WebGPU depth failed, falling back to WASM', e);
      }
    }
    depthPipe = await pipeline('depth-estimation', DEPTH_MODEL, { device: 'wasm', dtype: 'q8', progress_callback });
    await warmUp();
    return 'wasm';
  })();

  const [, backend] = await Promise.all([mpReady, depthReady]);
  return { backend };
}

/** Run once on a tiny image so GPU shaders compile while the user is still choosing a photo. */
async function warmUp() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, 64, 64);
  try { await depthPipe(c.toDataURL()); } catch (e) { console.warn('warm-up failed', e); }
}

/** Returns the most prominent face box {x,y,w,h} in pixels, or null. */
export function detectFace(source) {
  if (!faceDetector) return null;
  const res = faceDetector.detect(source);
  if (!res.detections.length) return null;
  let best = null, bestArea = 0;
  for (const d of res.detections) {
    const b = d.boundingBox;
    const area = b.width * b.height;
    if (area > bestArea) { bestArea = area; best = { x: b.originX, y: b.originY, w: b.width, h: b.height }; }
  }
  return best;
}

/** Person mask (Float32 0..1, size w*h) for a canvas. */
export function segmentPerson(canvas) {
  const res = segmenter.segment(canvas);
  const masks = res.confidenceMasks;
  // selfie_multiclass: 0 = background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others
  const bg = masks[0].getAsFloat32Array();
  const out = new Float32Array(bg.length);
  for (let i = 0; i < bg.length; i++) out[i] = 1 - bg[i];
  for (const m of masks) m.close();
  return out;
}

/** Relative depth (Float32 0..1, higher = closer to the camera), resampled to the canvas size. */
export async function estimateDepth(canvas) {
  const S = canvas.width;
  const url = canvas.toDataURL('image/png');
  const result = await depthPipe(url);
  const out = Array.isArray(result) ? result[0] : result;

  // Prefer the raw float tensor (smoother than the 8-bit preview image).
  const t = out.predicted_depth;
  if (t && t.data && t.dims && t.dims.length >= 2) {
    const H = t.dims[t.dims.length - 2], W = t.dims[t.dims.length - 1];
    const src = t.data;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < W * H; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    const d = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      const fy = Math.min(H - 1, Math.max(0, ((y + 0.5) * H) / S - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < S; x++) {
        const fx = Math.min(W - 1, Math.max(0, ((x + 0.5) * W) / S - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
        const a = src[y0 * W + x0], b = src[y0 * W + x1], c = src[y1 * W + x0], e = src[y1 * W + x1];
        const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
        d[y * S + x] = (v - mn) / range;
      }
    }
    return d;
  }

  const depthImg = out.depth; // RawImage, grayscale
  const c = depthImg.toCanvas();
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = S;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const d = new Float32Array(S * S);
  for (let i = 0; i < d.length; i++) d[i] = data[i * 4] / 255;
  return d;
}
