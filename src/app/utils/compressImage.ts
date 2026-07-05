/**
 * Compress a user-picked image into a small JPEG data URL so custom race
 * covers don't bloat IndexedDB. Downscales oversized images and steps the
 * JPEG quality (and, if needed, the dimensions) down until the result fits
 * under `maxBytes` — targeting the ~100–200 KB range.
 */

interface CompressOptions {
  /** Target maximum output size in bytes. Default ~180 KB. */
  maxBytes?: number;
  /** Longest edge in pixels before we start downscaling. Default 1600. */
  maxDimension?: number;
  /** Output MIME type. Default image/jpeg. */
  mimeType?: string;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Approximate the byte size of a base64 data URL without decoding it. */
function approxBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<string> {
  const { maxBytes = 180_000, maxDimension = 1600, mimeType = 'image/jpeg' } = opts;

  const original = await readFileAsDataURL(file);
  const img = await loadImage(original);

  // Already small enough and not oversized — keep as-is (preserves PNG/GIF).
  if (file.size <= maxBytes && Math.max(img.width, img.height) <= maxDimension) {
    return original;
  }

  let width = img.width;
  let height = img.height;
  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return original; // Canvas unavailable — fall back to raw.

  const draw = (w: number, h: number) => {
    canvas.width = w;
    canvas.height = h;
    // White backdrop so transparent PNGs don't turn black under JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
  };

  draw(width, height);

  // Step 1: reduce quality.
  let quality = 0.85;
  let out = canvas.toDataURL(mimeType, quality);
  while (approxBytes(out) > maxBytes && quality > 0.4) {
    quality -= 0.1;
    out = canvas.toDataURL(mimeType, quality);
  }

  // Step 2: if still too big, shrink dimensions in 20% steps.
  while (approxBytes(out) > maxBytes && Math.max(canvas.width, canvas.height) > 640) {
    draw(Math.round(canvas.width * 0.8), Math.round(canvas.height * 0.8));
    out = canvas.toDataURL(mimeType, quality);
  }

  // Never return something bigger than the original.
  return approxBytes(out) < approxBytes(original) ? out : original;
}
