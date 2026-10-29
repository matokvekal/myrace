# Public Assets Guide

Purpose

- Static assets shipped as-is in production builds.

Rules

- Reference assets through import.meta.env.BASE_URL in app code.
- Keep OCR worker/core/lang files in sync with scripts/ and runtime expectations.
- Preserve BOM in example.csv when editing for Excel Hebrew compatibility.

Contains

- PWA manifest/service worker
- Import templates (example.csv, start-list-template.xlsx)
- Dictionaries and locale data in data/
- OCR runtime files in ocr/

When To Update

- Asset path changes
- New locale/dictionary keys
- Import template schema changes
