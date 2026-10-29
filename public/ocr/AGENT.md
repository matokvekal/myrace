# Public OCR Folder Guide

Purpose

- Vendored tesseract.js runtime assets, served same-origin so
  `components/importImage/` OCR works fully offline. Populated/updated by
  `scripts/fetch-ocr-assets.mjs` — do not hand-edit these files.

Read Order

1. ../../AGENT.md
2. ../AGENT.md
3. core/AGENT.md, lang/AGENT.md

Immediate Children Summary

- Folders:
  - core (WASM LSTM core builds: plain / simd / relaxedsimd, feature-detected
    at runtime)
  - lang (trained-data language packs: eng, heb)
- Top-level files:
  - worker.min.js (the tesseract.js worker script)

Conventions

- Re-run `npm run ocr-assets` to refresh this tree after upgrading
  tesseract.js, then bump `CACHE_VERSION` in `public/sw.js` and commit the
  result — never edit files under here by hand.
- These are precached by the service worker for offline use — adding/removing
  a file here needs a matching service-worker cache-list update.

When To Update

- tesseract.js version upgrade
- Additional OCR language pack added/removed
