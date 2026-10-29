# RiderFlag Folder Guide

Purpose

- A rider's country flag `<img>`. Renders nothing when the flag is missing or
  the asset 404s, instead of a broken-image icon (BUGS.md #5).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RiderFlag.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RiderFlag.tsx (no accompanying CSS module — sizing is via props)

Conventions

- Src is built from `import.meta.env.BASE_URL + "international/" + code + ".svg"`
  — never hardcode `/international/...` (breaks in prod, root CLAUDE.md "Static
  assets must go through BASE_URL").
- `alt` is intentionally empty — a broken flag must degrade to nothing, never
  to alt text, since it's decorative next to the rider's name.
- Only gb/il/it/us ship in `public/international/` — any other code silently
  renders nothing via the `onError` handler, this is expected, not a bug.

When To Update

- New flag assets added to `public/international/`
- Fallback/error behavior changes
