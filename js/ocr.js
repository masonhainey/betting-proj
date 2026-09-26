// In-browser OCR for bet-slip screenshots. Tesseract.js is loaded from jsDelivr only the
// first time someone drops an image (~2 MB script + ~10 MB English data, then cached by
// the browser). Nothing leaves the device except those library downloads.

const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let loading = null;

function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR library failed to start")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't download the OCR library — check your connection"));
    };
    document.head.append(s);
  });
  return loading;
}

async function toBitmap(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function scaled(bmp) {
  const w0 = bmp.width, h0 = bmp.height;
  // Tesseract likes ~30px tall text. Phone screenshots (1080–1290px wide) are close;
  // small crops get upscaled, huge desktop captures get shrunk.
  const scale = w0 < 1000 ? Math.min(3, 1800 / w0) : w0 > 2600 ? 2600 / w0 : 1;
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  return { c, ctx, w, h };
}

function grayOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    // Max channel keeps colored text (green odds, purple buttons) bright against dark UI.
    g[j] = Math.max(d[i], d[i + 1], d[i + 2]) * 0.6 + (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 0.4;
  }
  return g;
}

function paint(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0, i = 0; j < w * h; j++, i += 4) {
    const v = fn(j);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Pass A: whole-image grayscale, inverted if the app is in dark mode, contrast-stretched. */
function globalClean(bmp) {
  const { c, ctx, w, h } = scaled(bmp);
  const g = grayOf(ctx, w, h);
  let sum = 0;
  for (let j = 0; j < g.length; j++) sum += g[j];
  const dark = sum / g.length < 128;
  let lo = 255, hi = 0;
  for (let j = 0; j < g.length; j += 7) {
    const v = dark ? 255 - g[j] : g[j];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.max(1, hi - lo);
  paint(ctx, w, h, (j) => {
    let v = (((dark ? 255 - g[j] : g[j]) - lo) / range) * 255;
    return v < 150 ? v * 0.6 : Math.min(255, v * 1.15);
  });
  return c;
}

/**
 * Pass B: local (adaptive) threshold. Slips mix dark backgrounds with lighter cards,
 * pills and buttons, so one global threshold loses text. Each pixel is compared with
 * the average of its neighborhood; the neighborhood's own brightness says whether text
 * there is light-on-dark or dark-on-light. Output is always black text on white.
 */
function adaptiveClean(bmp) {
  const { c, ctx, w, h } = scaled(bmp);
  const g = grayOf(ctx, w, h);
  const S = new Float64Array((w + 1) * (h + 1)); // integral image
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(10, Math.round(Math.min(w, h) / 36));
  const T = 22;
  paint(ctx, w, h, (j) => {
    const x = j % w, y = (j / w) | 0;
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const n = (x1 - x0) * (y1 - y0);
    const m = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / n;
    const v = g[j];
    const text = m < 128 ? v > m + T : v < m - T;
    return text ? 0 : 255;
  });
  return c;
}

/**
 * Read the text in an image file. Runs the adaptive pass first; if that doesn't produce
 * a complete-looking slip, runs the global pass too and keeps whichever reads better.
 * `judge(text)` → { score, complete } comes from the slip parser.
 */
export async function readImage(file, onProgress = () => {}, judge = () => ({ score: 0, complete: false })) {
  onProgress("Loading reader", 0);
  const T = await loadLib();
  onProgress("Preparing image", 0.05);
  const bmp = await toBitmap(file);
  let pass = 0;
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(pass ? "Double-checking" : "Reading slip", 0.3 + (pass * 0.35) + m.progress * 0.35);
      else if (/load|initializ/i.test(m.status)) onProgress("Loading reader", 0.05 + (m.progress || 0) * 0.25);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "4", user_defined_dpi: "300" });
    const a = (await worker.recognize(adaptiveClean(bmp))).data.text || "";
    const ja = judge(a);
    if (ja.complete) return a;
    pass = 1;
    const b = (await worker.recognize(globalClean(bmp))).data.text || "";
    const jb = judge(b);
    return jb.score > ja.score ? b : a;
  } finally {
    worker.terminate();
    bmp.close?.();
  }
}
