# .github Folder Guide

Purpose

- CI/CD: GitHub Actions workflow that builds and deploys to GitHub Pages.

Read Order

1. ../AGENT.md
2. workflows/deploy.yml

No child folders beyond `workflows/` (a single `deploy.yml`, not separately
documented — see root CLAUDE.md "GitHub Pages deployment" pointer to
`docs/github-pages.md` for the full deploy story: custom domain, SPA routing).

When To Update

- CI trigger conditions, Node version, or deploy target change
