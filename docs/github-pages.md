# GitHub Pages Deployment

## Architecture

The app is a static Vite + React SPA. On every push to `main`, a GitHub
Actions workflow (`.github/workflows/deploy.yml`) builds the app and
publishes `dist/` to GitHub Pages using the official Pages deployment
actions (`actions/upload-pages-artifact` + `actions/deploy-pages`) — no
`gh-pages` branch or third-party action involved.

```
push to main
  → build job: npm ci → npm run build → upload dist/ as a Pages artifact
  → deploy job: actions/deploy-pages publishes the artifact
  → served at https://commissaire.us (and https://<user>.github.io/<repo>/,
    though asset paths are only correct for the custom domain — see below)
```

The site is served from the **custom domain `commissaire.us` at the root
path**. `vite.config.ts` sets `base: '/'` to match. `public/CNAME`
(containing `commissaire.us`) is copied into every build's `dist/` root,
so the custom domain setting survives every automated deploy — GitHub
Pages resets it if the CNAME file is ever missing from the published
output.

## GitHub Pages settings (one-time, in the repo's web UI)

Settings → Pages:
- **Source**: "GitHub Actions" (not "Deploy from a branch" — the old
  `gh-pages` branch is no longer used for deployment and can be deleted
  once this workflow is confirmed working)
- **Custom domain**: `commissaire.us` (GitHub will verify the CNAME file
  in the deployed output matches; also check "Enforce HTTPS" once the
  certificate is issued)

## Required DNS records

At your DNS provider for `commissaire.us`:

| Type | Host | Value |
|---|---|---|
| A | @ | `185.199.108.153` |
| A | @ | `185.199.109.153` |
| A | @ | `185.199.110.153` |
| A | @ | `185.199.111.153` |

(If you also want `www.commissaire.us` to work, add a `CNAME` record for
`www` pointing to `<user>.github.io`, and list both domains — GitHub only
supports one canonical custom domain in Pages settings, so `www` would
need to be configured as a redirect at the DNS/registrar level.)

DNS propagation can take up to 24-48 hours; until it does, GitHub Pages
will show a "not properly configured" warning in Settings → Pages.

## How automatic deployment works

1. Push (or merge) to `main`.
2. The `build` job checks out the repo, sets up Node 20 (with npm cache),
   runs `npm ci` then `npm run build` (`tsc && vite build`), and uploads
   `dist/` as a Pages artifact.
3. The `deploy` job publishes that artifact via `actions/deploy-pages`.
4. GitHub Pages serves the new build at `https://commissaire.us` within
   a minute or two of the workflow finishing.

You can also trigger a deploy manually from the Actions tab
(`workflow_dispatch` is enabled) without needing a new commit.

## SPA routing on GitHub Pages

GitHub Pages only serves static files — there's no server-side rewrite to
send every path to `index.html`, so a hard refresh or a direct link to a
client-side route (e.g. `/main`, `/race/123/heat/1`) would normally 404.

This is fixed with the standard [spa-github-pages](https://github.com/rafgraph/spa-github-pages)
trick:
- `public/404.html` catches the 404, re-encodes the requested path into a
  query string, and redirects to `/`.
- A small inline script in `index.html`'s `<head>` decodes that query
  string back into a real path via `history.replaceState` **before**
  React Router mounts, so the app boots on the correct route.

`BrowserRouter` in `src/main.tsx` uses `basename={import.meta.env.BASE_URL}`,
which resolves to `/` for this deployment (matching `vite.config.ts`'s
`base: '/'`), so router paths line up with the served URLs.

## Troubleshooting failed deployments

- **Workflow fails at `npm ci`**: usually a `package-lock.json` out of
  sync with `package.json` — regenerate it locally with `npm install` and
  commit the updated lockfile.
- **Workflow fails at `npm run build`**: this runs `tsc` first, so a type
  error fails the whole build. Run `npm run build` locally to reproduce.
- **Deploy job fails / "Pages site not found"**: Settings → Pages →
  Source must be set to "GitHub Actions", not "Deploy from a branch".
- **Site serves a blank page / broken asset paths**: check `vite.config.ts`'s
  `base` — it must be `'/'` for the custom-domain-at-root setup used
  here. If someone reverts it to `/commissaire-race/` (the old GitHub
  Pages project-page path), every asset URL breaks on the custom domain.
- **Custom domain shows GitHub's default 404 / "not configured"**: confirm
  `public/CNAME` contains exactly `commissaire.us` (no `https://`, no
  trailing path) and that it actually made it into `dist/CNAME` after a
  build — GitHub Pages re-derives the custom domain from the file it
  finds in the published output, not just the Settings UI.
- **Refreshing `/main` or any deep link 404s**: confirms `public/404.html`
  didn't get published — check the Pages artifact includes it (it's a
  plain file in `public/`, so `vite build` always copies it into `dist/`).
