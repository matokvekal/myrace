# Scripts Folder Guide

Purpose

- Node/`.mjs` build- and asset-maintenance scripts, run via `npm run <script>`
  (not part of the app runtime bundle).

Read Order

1. ../AGENT.md
2. The script relevant to your task (see summary below)

Immediate Children Summary

- No child folders.
- Top-level files:
  - compress-images.mjs (one-shot: compresses large images in-place under
    `src/app/assets/{images,appIcons,icons}` and `public/images`; requires
    `sharp` as a dev dependency; comment marks it "run once, then delete" —
    it's still present, treat as a maintenance tool not dead code)
  - fetch-ocr-assets.mjs (`npm run ocr-assets` — vendors tesseract.js core/lang
    files into `public/ocr/` for fully offline OCR; re-run after upgrading
    tesseract.js, then bump `CACHE_VERSION` in `public/sw.js` and commit the
    resulting `public/ocr/` tree)
  - gen-images-manifest.mjs (`npm run gen-images` — scans `public/images/` and
    writes `public/images/manifest.json`)
  - sync-playwright-inventory.mjs (runs `playwright test --list`, regenerates
    TEST.md's `<!-- PLAYWRIGHT-INVENTORY:START/END -->` block; part of
    `npm run test:sync`, see root TEST.md)

Conventions

- These are dev-time/CI tooling only — never imported from `src/`.
- `fetch-ocr-assets.mjs` output must stay in sync with what
  `components/importImage/TesseractProvider.ts` expects at
  `public/ocr/core`/`public/ocr/lang`; if you change one, check the other.
- `sync-playwright-inventory.mjs` writes into TEST.md between fixed markers —
  don't hand-edit the generated block, re-run the script instead.

When To Update

- Asset pipeline changes (new image targets, new OCR files to vendor)
- Test inventory generation format changes
