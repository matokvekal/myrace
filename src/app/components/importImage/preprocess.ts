/**
 * Image loading + OCR preprocessing (pure canvas, no dependencies).
 *
 * Preprocessing implemented: downscale, grayscale, percentile contrast
 * stretch. Deliberately NO hard binary threshold — Tesseract's internal
 * Otsu binarization handles unevenly lit phone photos better, and a global
 * threshold destroys thin Hebrew strokes (see docs/local-ocr.md).
 */

const MAX_DECODE_EDGE = 2500; // iOS Safari canvas-size safety cap
// Dense Hebrew print needs more pixels per glyph than Latin — 2400px on a
// full A4 page keeps small table fonts above Tesseract's usable size.
const MAX_OCR_EDGE = 2400;
// Screenshots are often ~1000px wide with ~10px glyphs, unreadable for
// Tesseract — upscale them toward the OCR edge (bounded: past ~3× there is
// no new detail, only blur).
const MAX_UPSCALE = 3;

function scaledSize(
   w: number,
   h: number,
   maxEdge: number,
   allowUpscale = false
): { w: number; h: number } {
   let scale = maxEdge / Math.max(w, h);
   scale = allowUpscale ? Math.min(scale, MAX_UPSCALE) : Math.min(scale, 1);
   return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function drawToCanvas(
   src: CanvasImageSource,
   srcW: number,
   srcH: number,
   maxEdge: number,
   allowUpscale = false
): HTMLCanvasElement {
   // Halve repeatedly before the final resize for better downscale quality
   let canvas = document.createElement('canvas');
   let w = srcW;
   let h = srcH;
   canvas.width = w;
   canvas.height = h;
   canvas.getContext('2d')!.drawImage(src, 0, 0, w, h);

   const target = scaledSize(srcW, srcH, maxEdge, allowUpscale);
   while (w / 2 >= target.w && h / 2 >= target.h) {
      const half = document.createElement('canvas');
      half.width = Math.round(w / 2);
      half.height = Math.round(h / 2);
      half.getContext('2d')!.drawImage(canvas, 0, 0, half.width, half.height);
      canvas = half;
      w = half.width;
      h = half.height;
   }
   if (w !== target.w || h !== target.h) {
      const final = document.createElement('canvas');
      final.width = target.w;
      final.height = target.h;
      const ctx = final.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, target.w, target.h);
      canvas = final;
   }
   return canvas;
}

/**
 * Decodes a picked/captured image file to a canvas of at most 2500px on the
 * longest edge. Uses createImageBitmap (applies EXIF orientation) with an
 * <img> fallback.
 */
export async function loadPickedImage(file: File): Promise<HTMLCanvasElement> {
   if (typeof createImageBitmap === 'function') {
      try {
         const bitmap = await createImageBitmap(file);
         const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height, MAX_DECODE_EDGE);
         bitmap.close();
         return canvas;
      } catch {
         // fall through to <img> decoding
      }
   }
   const url = URL.createObjectURL(file);
   try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
         const el = new Image();
         el.onload = () => resolve(el);
         el.onerror = () => reject(new Error('Failed to decode image'));
         el.src = url;
      });
      return drawToCanvas(img, img.naturalWidth, img.naturalHeight, MAX_DECODE_EDGE);
   } finally {
      URL.revokeObjectURL(url);
   }
}

/**
 * Detects vertical table ruling lines (start lists are usually ruled
 * tables): x positions where a contiguous dark run spans ≥25% of the image
 * height. Text never produces runs taller than a glyph, so this cleanly
 * separates even narrow adjacent columns that word-gap analysis merges.
 * Returns [] for unruled/skewed pages (caller falls back to gap analysis).
 */
export function detectVerticalRules(canvas: HTMLCanvasElement): number[] {
   const ctx = canvas.getContext('2d')!;
   const { width, height } = canvas;
   const pix = ctx.getImageData(0, 0, width, height).data;
   const minRun = height * 0.25;

   const lineXs: number[] = [];
   for (let x = 0; x < width; x++) {
      let run = 0;
      let longest = 0;
      for (let y = 0; y < height; y++) {
         if (pix[(y * width + x) * 4] < 96) {
            run++;
            if (run > longest) longest = run;
         } else {
            run = 0;
         }
      }
      if (longest >= minRun) lineXs.push(x);
   }

   // Collapse adjacent x's (line thickness) into one center per line
   const centers: number[] = [];
   for (let i = 0; i < lineXs.length; ) {
      let j = i;
      while (j + 1 < lineXs.length && lineXs[j + 1] - lineXs[j] <= 2) j++;
      centers.push((lineXs[i] + lineXs[j]) / 2);
      i = j + 1;
   }
   return centers;
}

export interface PreprocessOptions {
   /** Hard binary threshold (0-255). Off by default — see module comment. */
   threshold?: number;
   /** Local background flattening (highlighted cells, uneven light). Default on. */
   flatten?: boolean;
}

/**
 * Local background estimate: separable sliding-window MAXIMUM (grayscale
 * dilation) with an O(n) monotonic-deque per row/column. Ink is always
 * darker than its surroundings, so the windowed max ≈ the local background
 * level — a highlighted cell's fill, a shadow, or plain paper white.
 */
function localBackground(
   gray: Uint8ClampedArray,
   width: number,
   height: number,
   radius: number
): Uint8ClampedArray {
   const horizontal = new Uint8ClampedArray(gray.length);
   const out = new Uint8ClampedArray(gray.length);
   const deque = new Int32Array(Math.max(width, height) + 1);

   for (let y = 0; y < height; y++) {
      const off = y * width;
      let head = 0;
      let tail = 0;
      for (let x = 0; x < width + radius; x++) {
         if (x < width) {
            const v = gray[off + x];
            while (tail > head && gray[off + deque[tail - 1]] <= v) tail--;
            deque[tail++] = x;
         }
         const outX = x - radius;
         if (outX < 0) continue;
         while (deque[head] < outX - radius) head++;
         horizontal[off + outX] = gray[off + deque[head]];
      }
   }
   for (let x = 0; x < width; x++) {
      let head = 0;
      let tail = 0;
      for (let y = 0; y < height + radius; y++) {
         if (y < height) {
            const v = horizontal[y * width + x];
            while (tail > head && horizontal[deque[tail - 1] * width + x] <= v) tail--;
            deque[tail++] = y;
         }
         const outY = y - radius;
         if (outY < 0) continue;
         while (deque[head] < outY - radius) head++;
         out[outY * width + x] = horizontal[deque[head] * width + x];
      }
   }
   return out;
}

/** Grayscale + background flattening + contrast-stretched copy sized for OCR. */
export function preprocessForOCR(
   src: HTMLCanvasElement,
   options: PreprocessOptions = {}
): HTMLCanvasElement {
   const canvas = drawToCanvas(src, src.width, src.height, MAX_OCR_EDGE, true);
   const ctx = canvas.getContext('2d')!;
   const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
   const pix = imageData.data;
   const pixelCount = canvas.width * canvas.height;

   // Grayscale (luma)
   const gray = new Uint8ClampedArray(pixelCount);
   for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];
   }

   // Flatten the background: rescale every pixel against its local
   // background level. Start lists highlight cells with colored fills;
   // after a *global* stretch such a fill stays a mid-gray slab that
   // Tesseract's binarization turns solid black — the cell's text (and
   // often the neighboring lines' layout) is lost. Dividing by the local
   // max turns "dark text on colored fill" into dark text on white while
   // leaving ink and ruling lines dark. Window radius must exceed the
   // widest ink stroke but stay below cell height (~1/120 of the page).
   const histogram = new Uint32Array(256);
   if (options.flatten !== false) {
      const radius = Math.max(4, Math.round(Math.max(canvas.width, canvas.height) / 120));
      const background = localBackground(gray, canvas.width, canvas.height, radius);
      for (let i = 0; i < pixelCount; i++) {
         // Floor the divisor: inside large solid-dark areas (page borders,
         // photo edges) there is no background to normalize against.
         const value = (gray[i] * 255) / Math.max(background[i], 64);
         gray[i] = value > 255 ? 255 : value;
      }
   }
   for (let i = 0; i < pixelCount; i++) histogram[gray[i]]++;

   // Contrast stretch: remap the 2nd..98th percentile range to 0..255
   const lowCount = pixelCount * 0.02;
   const highCount = pixelCount * 0.98;
   let low = 0;
   let high = 255;
   let cumulative = 0;
   for (let v = 0; v < 256; v++) {
      cumulative += histogram[v];
      if (cumulative <= lowCount) low = v;
      if (cumulative < highCount) high = v;
   }
   const range = Math.max(1, high - low);

   const { threshold } = options;
   for (let i = 0; i < pixelCount; i++) {
      let value = ((gray[i] - low) * 255) / range;
      value = value < 0 ? 0 : value > 255 ? 255 : value;
      if (threshold !== undefined) value = value < threshold ? 0 : 255;
      const idx = i * 4;
      pix[idx] = pix[idx + 1] = pix[idx + 2] = value;
      pix[idx + 3] = 255;
   }

   ctx.putImageData(imageData, 0, 0);
   return canvas;
}
