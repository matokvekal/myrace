# Legal Folder Guide

Purpose

- `TermsGate`: the startup gate that blocks the app until the user accepts the
  Terms & Conditions. Rendered from `App.tsx`. Content and acceptance logic
  live elsewhere — see Conventions.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. TermsGate.tsx
4. ../../legal/AGENT.md (terms.ts content, termsAcceptance.ts persistence)

Immediate Children Summary

- No child folders.
- Top-level files:
  - TermsGate.tsx
  - termsGate.module.css

Conventions

- Do NOT edit terms copy here — the ONLY file to edit for terms content is
  `src/app/legal/terms.ts` (a DRAFT, not lawyer-reviewed). This component only
  renders/gates.
- Acceptance is persisted + versioned in `src/app/legal/termsAcceptance.ts`;
  bumping `TERMS_VERSION` there re-prompts everyone — don't add a second
  acceptance mechanism here.
- The `/terms` route (in `src/app/terms/`) shows the full text outside the gate.

When To Update

- Gate UX (blocking behavior, re-prompt trigger) changes — content changes go
  in `src/app/legal/terms.ts` instead
