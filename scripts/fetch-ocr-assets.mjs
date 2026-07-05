// Vendors tesseract.js OCR assets into public/ocr/ so OCR works fully
// offline (same-origin, precached by the service worker — see public/sw.js).
// Run: npm run ocr-assets   (re-run after upgrading tesseract.js, then bump
// CACHE_VERSION in public/sw.js and commit the resulting public/ocr/ tree)
import { copyFile, mkdir, readFile, writeFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OCR_DIR = join(ROOT, "public", "ocr");

// Single-file LSTM core builds (WASM embedded). The tesseract.js worker picks
// one at runtime by feature detection: relaxedsimd > simd > plain.
const CORE_FILES = [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
];

// tessdata_fast: much smaller than tessdata_best, near-equal accuracy on
// clean printed text. Swap URLs to tessdata_best for higher accuracy.
const LANGS = ["heb", "eng"];
const TESSDATA_URL = (lang) =>
  `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`;

await mkdir(join(OCR_DIR, "core"), { recursive: true });
await mkdir(join(OCR_DIR, "lang"), { recursive: true });

const copied = [];

const workerSrc = join(ROOT, "node_modules", "tesseract.js", "dist", "worker.min.js");
await copyFile(workerSrc, join(OCR_DIR, "worker.min.js"));
copied.push("worker.min.js");

for (const f of CORE_FILES) {
  await copyFile(
    join(ROOT, "node_modules", "tesseract.js-core", f),
    join(OCR_DIR, "core", f)
  );
  copied.push(`core/${f}`);
}

for (const lang of LANGS) {
  const dest = join(OCR_DIR, "lang", `${lang}.traineddata`);
  const exists = await stat(dest).then(() => true, () => false);
  if (exists) {
    copied.push(`lang/${lang}.traineddata (already present, skipped download)`);
    continue;
  }
  console.log(`Downloading ${TESSDATA_URL(lang)} ...`);
  const res = await fetch(TESSDATA_URL(lang));
  if (!res.ok) throw new Error(`Failed to download ${lang}.traineddata: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  copied.push(`lang/${lang}.traineddata`);
}

console.log("\npublic/ocr/ contents:");
for (const rel of copied) {
  const clean = rel.split(" ")[0];
  const { size } = await stat(join(OCR_DIR, clean));
  console.log(`  ${rel.padEnd(60)} ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log("\nDone. Commit public/ocr/ and keep public/sw.js APP_SHELL in sync.");
