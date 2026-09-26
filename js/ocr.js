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

/**
 * Sportsbook apps are mostly dark mode with colored text. Tesseract reads black-on-white
 * best, so: upscale small phone shots, grayscale, invert dark backgrounds, stretch contrast.
 */
function prepare(bmp) {
  const w0 = bmp.width, h0 = bmp.height;
  const scale = w0 < 1100 ? Math.min(2.5, 1600 / w0) : w0 > 2400 ? 2400 / w0 : 1;
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    // Max channel keeps colored text (green odds, purple buttons) bright against dark UI.
    const v = Math.max(d[i], d[i + 1], d[i + 2]) * 0.6 + (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 0.4;
    gray[j] = v;
    sum += v;
  }
  const dark = sum / gray.length < 128;
  let lo = 255, hi = 0;
  for (let j = 0; j < gray.length; j += 7) {
    const v = dark ? 255 - gray[j] : gray[j];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = dark ? 255 - gray[j] : gray[j];
    v = ((v - lo) / range) * 255;
    v = v < 150 ? v * 0.6 : Math.min(255, v * 1.15); // push text darker, background whiter
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Read the text in an image file. onProgress(stage, fraction). */
export async function readImage(file, onProgress = () => {}) {
  onProgress("Loading reader", 0);
  const T = await loadLib();
  onProgress("Preparing image", 0.05);
  const canvas = prepare(await toBitmap(file));
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress("Reading slip", 0.3 + m.progress * 0.7);
      else if (/load|initializ/i.test(m.status)) onProgress("Loading reader", 0.05 + (m.progress || 0) * 0.25);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "4" });
    const { data } = await worker.recognize(canvas);
    return data.text || "";
  } finally {
    worker.terminate();
  }
}
