# Local OCR Import (Scan Start List)

## Overview
Imports riders from **photos of a printed start list** — fully offline, in the browser. Up to 6 photos are treated as pages of one list, straightened with a manual 4-point cropper, recognized with Tesseract (Hebrew + English), reconstructed into a table, cleaned/merged, and handed to the **existing CSV Mapping Wizard** at the Mapping step. Mapping, Preview, and Import are 100% shared with the CSV flow.

## Component Flow

```
Riders page ("Scan Start List" button)  or  UploadStep ("Scan Start List (photo)")
└── CSVImportWizard (initialMode="scan" / scanMode state)
    └── ImageCapture (batch manager, max 6 photos)
        ├── ImageCropper (4-point corner drag → perspective quad)
        ├── loadPickedImage → warpPerspective → preprocessForOCR   (per photo)
        └── runOcrBatch (OCRService)
            ├── createOCRProvider() → TesseractProvider (the ONLY tesseract code)
            ├── wordsToTable (TableParser — bboxes → rows/columns)
            └── mergePagesToParseResult (OCRMapper — clean, dedupe, merge)
                └── CSVParseResult → existing Mapping → Preview → Import
```

## Files

**Module (isolated):** `src/app/components/importImage/`
- `OCRProvider.ts` — engine abstraction (`OCRProvider` interface + `createOCRProvider()` factory)
- `TesseractProvider.ts` — tesseract.js implementation (only file that imports tesseract.js)
- `OCRService.ts` — `runOcrBatch(canvases, onProgress): Promise<CSVParseResult>` orchestrator
- `TableParser.ts` — word bounding boxes → `string[][]` (row clustering + column-gap detection)
- `OCRMapper.ts` — page merging, cell cleanup, header detection, dedupe → `CSVParseResult`
- `PerspectiveCorrection.ts` — pure-TS homography warp (no opencv)
- `preprocess.ts` — image decode (EXIF-safe), downscale, grayscale, contrast stretch
- `ImageCapture.tsx` / `ImageCropper.tsx` / `ScanDocumentButton.tsx` + CSS modules
- `types.ts` — `Quad`, `OCRWord`, `OCRPageResult`, `OCRProgress`, `CapturedPage`

**Assets (committed):** `public/ocr/` — vendored by `npm run ocr-assets` (`scripts/fetch-ocr-assets.mjs`)
- `worker.min.js`, `core/tesseract-core-{relaxedsimd|simd|plain}-lstm.wasm.js`, `lang/{heb,eng}.traineddata`

**Touched integration points:** `CSVImportWizard.tsx` (`initialMode` prop + `handleOcrParsed`), `UploadStep.tsx` (`onScanClick`), `Riders.tsx` (scan buttons), `public/sw.js` (precache).

## Engine Choice: tesseract.js (v7)

Chosen because it is the **only maintained, fully offline, in-browser (WASM) OCR engine with Hebrew support**. Alternatives evaluated:
- Cloud APIs (Google Vision, Azure, OpenAI) — ruled out: app must work with no connectivity.
- PaddleOCR / TrOCR via onnxruntime-web — no usable Hebrew models, much heavier integration.
- Scribe.js — tesseract fork, same underlying engine, smaller community.

Language data is **tessdata_fast** (`heb` 0.9 MB, `eng` 3.9 MB): ~4× smaller than tessdata_best with near-equal accuracy on clean printed text. To trade size for accuracy, download the same filenames from `tessdata_best` into `public/ocr/lang/` and bump the SW cache version.

## Offline Capability

- All engine assets are self-hosted under `public/ocr/` (same-origin) — **no CDN calls**.
- `public/sw.js` **precaches** them at service-worker install (`commissire-v2`, ~13 MB), so scanning works offline even if never used online first. Verified: with the network disabled, the app shell and all 5 OCR assets serve from cache.
- The worker picks a core by CPU feature detection: `relaxedsimd-lstm` (Chrome/Edge/Firefox), `simd-lstm` (Safari 16.4+) — both precached. The plain `lstm` fallback (pre-2021 browsers) is served same-origin and runtime-cached on first use.
- tesseract.js also caches loaded traineddata in IndexedDB, speeding up subsequent scans.

## Browser Compatibility
Any browser with WebAssembly SIMD (Chrome/Edge 91+, Firefox 89+, Safari 16.4+). Older browsers fall back to the non-SIMD core (slower). iOS Safari canvas-size limits are respected: photos are decoded to ≤ 2500 px and OCR'd at ≤ 2000 px on the longest edge.

## Hebrew + English Support
- The scan screen has a **"List language" dropdown**: Hebrew only / English only / Hebrew + English. Reliable automatic language detection isn't available for mixed tables, and the combined model measurably hurts Hebrew (Tesseract tries Latin interpretations of Hebrew glyphs) — so **single-language lists should be scanned with that language only**. This is the documented tradeoff.
- The shipped default is `heb+eng` (`DEFAULT_OCR_LANGUAGES` in `importImage/types.ts`); the user's last choice is remembered in localStorage (`ocrLanguages`) and becomes their default.
- A `user_defined_dpi = 300` hint is set (canvases carry no DPI; without it Tesseract guesses, often badly for dense Hebrew print), and pages are OCR'd at up to 2400 px so small Hebrew table fonts stay above Tesseract's usable glyph size.
- **RTL handling:** Tesseract returns bounding boxes in image (visual) coordinates. Within each table cell, words are re-ordered right-to-left when the cell is Hebrew-dominant, so multi-word Hebrew values ("הפועל תל אביב") come out in logical order. Column order itself doesn't matter — the Mapping step matches headers by *name*.
- Verified end-to-end with a mixed Hebrew/English table (Hebrew headers, Hebrew + English rider rows).

## Image Preprocessing (implemented)
1. **Decode + rescale** — `createImageBitmap` (applies EXIF rotation) with `<img>` fallback; stepped halving down to ≤ 2400 px for OCR — and **upscaling (≤ 3×) for small images**: screenshots are often ~1000 px wide with ~10 px glyphs, unreadable for Tesseract until enlarged. (This was the single biggest accuracy factor on real inputs.)
2. **Manual 4-point crop + perspective warp** — user drags corners; a pure-TS homography (8×8 DLT + Gaussian elimination, bilinear inverse mapping) straightens the page. ~0.5–1 s per photo.
3. **Grayscale** (luma weights) and **contrast stretch** (2nd–98th percentile remap).
4. **No hard binary threshold** — Tesseract's internal Otsu binarization beats a naive global threshold on unevenly lit phone photos, and hard thresholding destroys thin Hebrew strokes. (`preprocessForOCR` has an opt-in `threshold` option if ever needed.)

Auto document detection / auto-crop was deliberately **not** implemented — it would require opencv.js (~8 MB more WASM) for marginal benefit over the manual cropper.

## Table Reconstruction & Cleanup
- **Rows:** words clustered by y-center distance to the row's *mean* center (≤ 0.6 × median word height); outlier-height words (border artifacts) are filtered first. (An expanding min/max envelope must not be used — one tall garbage word chains every following row into one.)
- **Columns, ruled tables (primary):** vertical table border lines are detected in the image (contiguous dark runs ≥ 25% of page height) and used directly as column boundaries — the only reliable way to separate narrow adjacent numeric columns (rank/points/bib).
- **Columns, unruled fallback:** page-global x-coverage histogram; gaps with near-zero coverage (≤ 20% noise tolerance, so title lines don't erase gaps) wider than ~1.2 × median char width become separators; per-row gap splitting as last resort.
- **Header detection:** the top-6 row that names the most *distinct* rider fields (fuzzy match against `FIELD_KEYWORDS`, with length guards — short keywords like ע"ר matched title words before). Best-scoring row wins, not first-hit.
- **Merge (multi-photo):** rows appended in photo order. Each page is anchored on its (repeated) header row — title lines above it are dropped on every page. Also dropped: repeated header rows (positional fuzzy match ≥ 75% *or* ≥ 3 distinct near-exact field-keyword cells), page numbers, empty/symbol-only noise rows, duplicate rows from overlapping shots (normalized-key match, or same bib + ≥ 85% similarity).
- **Cell cleanup:** whitespace collapse, OCR-debris characters stripped (incl. table-border `|`/`[` glyphs), digit-confusion fixes in number-dominant cells (`O→0`, `l/I/|→1`, `B→8`), and **reversed-Hebrew repair** — Tesseract sometimes emits Hebrew in visual order; a Hebrew word *starting* with a final-form letter (םןץףך) is reversed back to logical order.
- Output: `CSVParseResult` with `detection: { encoding: 'OCR', delimiter: 'OCR', headerRow: 0 }`.

## Accuracy Expectations & Performance
- **Good:** clean printed lists, screenshots (Excel/PDF), flat scans — expect ~90%+ correct cells; treat the Preview step as the correction checkpoint ("90% then fix in preview", not perfect).
- **Weak:** handwriting (unsupported), low light, glare, very small fonts, table ruling lines touching glyphs (can merge columns).
- **Digits:** LSTM digit recognition is strong but not perfect — a bib was once read `101 → 11` even on a clean synthetic image. **Always check bib numbers in Preview.**
- **Language-mode tradeoff (measured):** Hebrew-only mode reads Hebrew *letters* best, but the `heb` traineddata is noticeably weaker on *digits* than mixed mode (synthetic test: heb-only read bibs 101/102/104 as 11/12/144, while mixed got 102/104 right). If bib numbers degrade in Hebrew-only mode, switch back to עברית + English.
- **Speed:** ~0.5–1.5 s per page on desktop (measured 0.7–0.9 s for 2 pages), roughly 5–15 s per page on mid-range phones. First scan is slower (engine + language load); later scans reuse the IDB cache.
- **Memory:** pages are OCR'd sequentially on one worker; photos are kept as ≤ 2500 px JPEGs and re-decoded at scan time, keeping the 6-photo batch mobile-safe.

## Known Limitations
- **Tested on two real races** (10-page Hebrew METAR list, 5-page SEVEV list, both ~1000 px screenshots): headers detected, bib/points columns accurate, titles/repeated headers removed. Residual defects at that resolution: ~5–10% of rows arrive with two riders merged (Tesseract fuses vertically adjacent short cells), Hebrew glyph confusions in small fonts (אפרוחים → אפהחים), and glued words in name cells — all fixable in the Preview step. Higher-resolution photos reduce all three.
- Mixed Hebrew+English inside a *single cell* may come out in odd word order (per-cell dominant-script reordering covers the common case).
- Cells that vertically straddle two printed rows can land in the wrong row on skewed photos — use the cropper.
- Multi-line cells (wrapped text) become separate rows and are usually filtered as noise.
- The plain-LSTM fallback core is not precached; ancient (pre-SIMD) browsers need one online scan first.

## How to Replace the OCR Engine
The app only ever touches the `OCRProvider` interface:
```ts
interface OCRProvider {
  init(onProgress?): Promise<void>;
  recognize(image: HTMLCanvasElement, onProgress?): Promise<OCRPageResult>; // word boxes
  dispose(): Promise<void>;
}
```
1. Implement the interface in a new file (e.g. `PaddleProvider.ts`) returning word-level `{ text, confidence, bbox }`.
2. Point `createOCRProvider()` in `OCRProvider.ts` at it.
3. Vendor the new engine's assets under `public/ocr/` (extend `scripts/fetch-ocr-assets.mjs`), update the `APP_SHELL` list in `public/sw.js`, and bump `CACHE_VERSION`.

Nothing else changes — table parsing, merging, UI, and the wizard are engine-agnostic.

## Upgrading tesseract.js
After `npm update tesseract.js`: run `npm run ocr-assets`, commit the refreshed `public/ocr/`, verify the core filenames in `public/sw.js` still match, and bump `CACHE_VERSION`.
