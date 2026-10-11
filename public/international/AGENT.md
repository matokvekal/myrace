# International Folder Guide

Purpose

- Country-flag SVGs for `<RiderFlag>` (`race/components/riderFlag/RiderFlag.tsx`).
  Only gb, il, it, us currently ship — any other rider flag code renders
  nothing (by design, not a bug).

Read Order

1. ../../AGENT.md
2. ../AGENT.md

No child folders.

Conventions

- Referenced as `${import.meta.env.BASE_URL}international/${code}.svg` — never
  a hardcoded `/international/...` path (this exact bug previously broke all
  rider flags in production, root CLAUDE.md "Static assets must go through
  BASE_URL").
- Filenames must be lowercase two-letter codes matching `rider.flag` values.
