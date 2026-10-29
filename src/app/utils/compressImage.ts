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

/**
 * Decode a File into something canvas can draw, preferring createImageBitmap.
 * It decodes straight from the File (no giant data-URL round-trip), applies EXIF
 * orientation, and copes with more formats — which is what keeps a phone-camera
 * photo from failing to decode and cascading into a crash (BUGS.md #13).
 */
async function decodeToDrawable(
  file: File
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image"
      } as ImageBitmapOptions);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the <img> path below.
    }
  }
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  return { source: img, width: img.width, height: img.height };
}

/** Approximate the byte size of a base64 data URL without decoding it. */
function approxBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<string> {
  const { maxBytes = 180_000, maxDimension = 1600, mimeType = 'image/jpeg' } = opts;

  const { source, width: srcW, height: srcH } = await decodeToDrawable(file);

  let width = srcW;
  let height = srcH;
  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // No canvas — only safe to keep the raw bytes if they're already small,
    // otherwise storing a full-resolution photo is what bloats storage and can
    // crash rendering on low-memory devices (BUGS.md #13).
    if (file.size <= maxBytes) return readFileAsDataURL(file);
    throw new Error('Canvas unavailable and image too large to store raw');
  }

  const draw = (w: number, h: number) => {
    canvas.width = w;
    canvas.height = h;
    // White backdrop so transparent PNGs don't turn black under JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
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

  // A well-formed JPEG data URL always starts with this; anything else means
  // toDataURL failed (e.g. iOS returning "data:," for an oversized canvas).
  if (!out.startsWith('data:image/')) {
    throw new Error('Image encoding failed');
  }

  // Free the decoded bitmap if we made one.
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    source.close();
  }

  return out;
}
