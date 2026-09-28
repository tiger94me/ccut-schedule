// 本地 OCR：动态加载 Tesseract.js（CDN），图片预处理（灰度 + 对比度拉伸）提升识别率

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let loadingPromise = null;

export function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload = () => globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('Tesseract 加载失败'));
    s.onerror = () => { loadingPromise = null; reject(new Error('Tesseract 脚本加载失败，请检查网络')); };
    document.head.appendChild(s);
  });
  return loadingPromise;
}

function loadImageViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

async function toDrawable(file) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fallback */ }
  }
  return loadImageViaImg(file);
}

/**
 * 图片预处理：缩放到 maxDim 以内 + 灰度 + 2%~98% 分位对比度拉伸
 * 返回 canvas
 */
export async function preprocessImage(file, maxDim = 1600) {
  const bitmap = await toDrawable(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - lo) * 255 / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 压缩图片用于存储（保留彩色，仅缩放 + JPEG 压缩）。返回 Blob。
 */
export async function compressForStorage(file, maxDim = 1280, quality = 0.8) {
  const bitmap = await toDrawable(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
}

// 兼容 tesseract.js v4/v5 的输出结构，收集行与字符
function extractLinesSymbols(data) {
  let lines = Array.isArray(data.lines) ? data.lines : [];
  let symbols = Array.isArray(data.symbols) ? data.symbols : [];
  if (!lines.length && Array.isArray(data.blocks)) {
    for (const b of data.blocks) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          lines.push(l);
          for (const w of l.words || []) {
            for (const s of w.symbols || []) symbols.push(s);
          }
        }
      }
    }
  }
  return {
    lines: lines.filter(l => l && l.text && l.bbox).map(l => ({ text: l.text, bbox: l.bbox })),
    symbols: symbols.filter(s => s && s.text && s.bbox).map(s => ({ text: s.text, bbox: s.bbox })),
  };
}

/**
 * 识别 canvas，返回 { text, lines, symbols }
 */
export async function ocrCanvas(canvas, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker('chi_sim', 1, {
    logger: m => {
      if (m && m.status === 'recognizing text' && onProgress) onProgress(Math.round((m.progress || 0) * 100));
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', ...extractLinesSymbols(data) };
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }
}

/**
 * 完整流程：文件 -> 预处理 -> OCR。返回 { text, lines, symbols }
 */
export async function ocrFile(file, onProgress) {
  const canvas = await preprocessImage(file);
  return ocrCanvas(canvas, onProgress);
}
