// One-shot image compression script — run once, then delete.
// Compresses large images in src/app/assets and public/images in-place.
// Requires: npm install --save-dev sharp
import sharp from "sharp";
import { readdir, stat, rename } from "fs/promises";
import { join, extname, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const TARGETS = [
  { dir: join(ROOT, "src/app/assets/images"), maxKB: 120, jpgQ: 72, pngQ: 75 },
  { dir: join(ROOT, "src/app/assets/appIcons"), maxKB: 60,  jpgQ: 80, pngQ: 75 },
  { dir: join(ROOT, "src/app/assets/icons"),   maxKB: 20,  jpgQ: 80, pngQ: 80 },
  { dir: join(ROOT, "public/images"),           maxKB: 120, jpgQ: 75, pngQ: 75 },
];

async function compressFile(filePath, maxKB, jpgQ, pngQ) {
  const ext  = extname(filePath).toLowerCase();
  const info = await stat(filePath);
  const kb   = info.size / 1024;

  // Skip already small files and GIFs (sharp doesn't animate)
  if (kb <= maxKB || ext === ".gif" || ext === ".svg") {
    console.log(`  skip  ${basename(filePath)} (${kb.toFixed(0)} KB)`);
    return;
  }

  const tmp = filePath + ".tmp";
  try {
    const s = sharp(filePath);
    const meta = await s.metadata();

    // Scale down if very large (> 1800px wide)
    const resize = meta.width > 1800 ? { width: 1600, withoutEnlargement: true } : null;

    if (ext === ".jpg" || ext === ".jpeg") {
      await (resize ? s.resize(resize) : s)
        .jpeg({ quality: jpgQ, mozjpeg: true })
        .toFile(tmp);
    } else if (ext === ".png") {
      await (resize ? s.resize(resize) : s)
        .png({ quality: pngQ, compressionLevel: 9, palette: true })
        .toFile(tmp);
    } else if (ext === ".webp") {
      await (resize ? s.resize(resize) : s)
        .webp({ quality: jpgQ })
        .toFile(tmp);
    } else {
      console.log(`  skip  ${basename(filePath)} (unsupported type)`);
      return;
    }

    const newInfo = await stat(tmp);
    const newKb   = newInfo.size / 1024;

    if (newKb < kb) {
      await rename(tmp, filePath);
      console.log(`  ✓ ${basename(filePath)}: ${kb.toFixed(0)} KB → ${newKb.toFixed(0)} KB  (-${((1 - newKb/kb)*100).toFixed(0)}%)`);
    } else {
      // Compression made it larger — keep original
      const { unlink } = await import("fs/promises");
      await unlink(tmp);
      console.log(`  kept  ${basename(filePath)} (compression gave no benefit)`);
    }
  } catch (e) {
    console.error(`  ERROR ${basename(filePath)}: ${e.message}`);
    try { const { unlink } = await import("fs/promises"); await unlink(tmp); } catch {}
  }
}

for (const target of TARGETS) {
  let files;
  try {
    files = await readdir(target.dir);
  } catch {
    console.log(`\n[skip] ${target.dir} — not found`);
    continue;
  }

  console.log(`\n[${target.dir.replace(ROOT, ".")}]`);
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) continue;
    await compressFile(join(target.dir, f), target.maxKB, target.jpgQ, target.pngQ);
  }
}

console.log("\nDone.");
