# Docs Cloud Folder Guide

Purpose

- Numbered doc set for cloud sync / per-race roles (Supabase). Start at
  `0-START.md`, which indexes the rest in reading order.

Read Order

1. ../../AGENT.md
2. ../AGENT.md
3. 0-START.md (index — read this first, it points into the rest)

No child folders. Files: 0-START.md, 1-overview.md, 2-setup-supabase.md,
3-testing.md, 4-architecture.md, 5-security.md, 6-database.md,
7-production-checklist.md, 8-roadmap.md, 9-stage2-summary.md.

When To Update

- Cloud sync architecture, schema, security model, or rollout status changes —
  keep in sync with the implementation in `src/app/services/cloud/` and
  `src/app/components/cloud/`.
