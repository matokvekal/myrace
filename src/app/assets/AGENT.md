# Assets Folder Guide

Purpose

- Bundled static assets imported from `src/` code (icons, app icons, splash/
  hero images) — distinct from `public/`, which is served as-is and referenced
  via `import.meta.env.BASE_URL` at runtime instead of an ES import.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. appIcons/AGENT.md, icons/AGENT.md, images/AGENT.md

Immediate Children Summary

- Folders:
  - appIcons (PWA/app icon images — defaultApp.png, trophy.png)
  - icons (small UI icon PNGs, referenced via `constants/Icons.ts`)
  - images (larger hero/splash JPG/PNG images, referenced via `constants/Images.ts`)
- No top-level files of its own.

Conventions

- These files are imported as ES modules (`import icon from "./assets/icons/x.png"`)
  and go through Vite's bundler — not the `BASE_URL` runtime-path pattern used
  for `public/`. Don't move a file here without updating its importer, and
  don't move a `public/` asset here without switching its reference style.
- `scripts/compress-images.mjs` targets these subfolders — keep new large
  images reasonably sized, or expect them to get swept up by that script.

When To Update

- New icon/image asset added or an existing one is renamed/removed (update all
  importers)
