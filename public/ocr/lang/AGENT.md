# OCR Lang Folder Guide

Purpose

- Tesseract trained-data language packs: `eng.traineddata`, `heb.traineddata`
  (tessdata_fast — chosen for size over tessdata_best, near-equal accuracy).

Read Order

1. ../../../AGENT.md
2. ../AGENT.md

No child folders.

Conventions

- Vendored by `scripts/fetch-ocr-assets.mjs` — do not hand-edit or hand-add
  files here. Adding a new language means updating that script's fetch list,
  not dropping a file in directly.
