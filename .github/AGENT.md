# .github Folder Guide

Purpose

- CI/CD: GitHub Actions. Production branch: `main`.

Read Order

1. ../AGENT.md
2. workflows/ci.yml: quality gates on every PR (app + server + deploy gate)
3. workflows/deploy.yml: on push to `main`, deploys what changed, each deploy
   approved by hand (environments `production` for the API, `github-pages`
   for the app)
4. workflows/backend-rollback.yml: manual API status / rollback
5. ../docs/server/deployment.md: server layout, deploy gate, secrets, rollback;
   `docs/github-pages.md`: custom domain, SPA routing

When To Update

- CI trigger conditions, Node version, or deploy target change
- Never run database migrations from a workflow; never print secrets
