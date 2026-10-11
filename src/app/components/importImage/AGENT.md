# ImportImage Folder Guide

Purpose

- Offline photo/OCR start-list import: capture or crop a photo of a printed
  start list, run it through tesseract.js locally, parse the recognized table
  into rows. See `docs/local-ocr.md` for the full pipeline before changing this
  folder.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. ../../../../../docs/local-ocr.md (pipeline doc)
4. ImageCapture.tsx (entry point) -> ImageCropper.tsx -> PerspectiveCorrection.ts
   -> preprocess.ts -> TesseractProvider.ts -> TableParser.ts -> OCRMapper.ts

Immediate Children Summary

- No child folders.
- Top-level files:
  - ImageCapture.tsx + imageCapture.module.css (camera/file capture entry point)
  - ImageCropper.tsx + imageCropper.module.css (crop before OCR)
  - ScanDocumentButton.tsx + scanDocumentButton.module.css (trigger button)
  - PerspectiveCorrection.ts (deskew/perspective-correct the captured image)
  - preprocess.ts (image cleanup before OCR — contrast/threshold, etc.)
  - OCRProvider.ts (provider interface), TesseractProvider.ts (offline
    tesseract.js implementation), OCRService.ts (service wrapper)
  - TableParser.ts (turns raw OCR text into row/column table structure)
  - OCRMapper.ts (maps parsed table cells to rider fields, reusing the CSV
    dictionary system)
  - types.ts

Conventions

- Fully offline — tesseract.js runs locally using `public/ocr/core` (wasm) and
  `public/ocr/lang` (eng/heb trained data); do not introduce a network OCR call.
- `ImageCapture` is lazy-loaded (`lazy(ImageCapture)`) — keep tesseract's import
  behind that lazy boundary, never import it eagerly (root CLAUDE.md
  "Bundle / code-splitting").
- `OCRMapper.ts` should reuse the same field dictionary/mapping approach as
  `components/csv/` rather than maintaining a separate keyword list.

When To Update

- OCR pipeline steps (capture/crop/correct/preprocess/parse/map) change
- tesseract asset paths or language pack set changes
