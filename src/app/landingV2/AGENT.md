# LandingV2 Folder Guide

Purpose

- An alternate landing-page experience/variant (route not necessarily `/` —
  check `App.tsx`'s routing before assuming this is the live landing page).

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. page.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - page.tsx (hero section with a live-screenshot image, headline, CHIPS
    tagline list: "One tap = one lap", "Live standings", "Works offline")
  - landingV2.module.css

Conventions

- Screenshot/asset references go through `import.meta.env.BASE_URL`
  (`${import.meta.env.BASE_URL}images/Capture.PNG`) — follow that pattern for
  any new asset added here (root CLAUDE.md "Static assets must go through
  BASE_URL").
- If this page shares the "night-stage arcade" design system, check
  `components/arcade/` and `styles/arcade.css` before adding parallel styling.

When To Update

- Landing copy/hero content changes
- If this variant is promoted to (or removed from) the live `/` route
