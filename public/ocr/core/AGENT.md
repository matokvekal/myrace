# OCR Core Folder Guide

Purpose

- Single-file WASM LSTM tesseract.js core builds: plain, SIMD, and relaxed-SIMD
  variants. The worker picks one at runtime by feature detection
  (relaxedsimd > simd > plain).

Read Order

1. ../../../AGENT.md
2. ../AGENT.md

No child folders.

Conventions

- Vendored by `scripts/fetch-ocr-assets.mjs` — do not hand-edit or hand-add
  files here.
