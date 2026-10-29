#!/usr/bin/env node
/**
 * Deployment hygiene for the GitHub Pages artifact.
 *
 * Everything under `public/` is copied verbatim into `dist/` by Vite, so a
 * stray `AGENT.md` or `NOTES.md` dropped in there ends up publicly served on
 * commissaire.us. This script is the guard.
 *
 *   node scripts/verify-dist.mjs --prune   (run by `npm run build`)
 *       Deletes anything matching the forbidden rules from dist/, loudly.
 *
 *   node scripts/verify-dist.mjs           (run by the deploy workflow)
 *       Read-only. Exits 1 if a forbidden file survived, so a bad artifact
 *       fails CI instead of being published.
 *
 * Files listed in ALWAYS_KEEP are never touched — they are what make Pages,
 * SPA routing and the PWA work (see docs/github-pages.md).
 */

import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

/** Deploy-critical files at the dist root — exempt from every rule below. */
const ALWAYS_KEEP = new Set([
  'index.html',
  '404.html', // SPA deep-link redirect
  'CNAME', // custom domain; Pages resets the domain if this is missing
  'manifest.json', // PWA
  'sw.js', // service worker
  'favicon.ico',
  '.nojekyll',
  'robots.txt',
]);

/** Path segments that must never appear in the published output. */
const FORBIDDEN_DIRS = new Set([
  'tests',
  'test',
  '__tests__',
  'e2e',
  'test-results',
  'playwright-report',
  'blob-report',
  'coverage',
  'docs',
  'scripts',
  'src',
  'node_modules',
  'supabase',
  '.github',
  '.claude',
  '.vscode',
  '.git',
  'agents',
  '.agents',
]);

/** Filename rules. Each is [label, test]. */
const FORBIDDEN_FILES = [
  ['markdown / documentation', (n) => /\.(md|markdown|mdx)$/i.test(n)],
  // AGENTS.md / CLAUDE.md are caught above; this covers the non-markdown forms.
  ['agent instructions', (n) => /^(agents?|claude)(-[\w-]+)?\.(txt|json|ya?ml|toml)$/i.test(n)],
  ['test or spec file', (n) => /\.(spec|test)\.[\w]+$/i.test(n)],
  ['source map', (n) => /\.map$/i.test(n)],
  // Also catches .d.ts.
  ['TypeScript source', (n) => /\.(ts|tsx|mts|cts)$/i.test(n)],
  ['build / tooling config', (n) => /^(tsconfig|package|package-lock|eslintrc|playwright\.config|vite\.config)/i.test(n)],
  ['environment file', (n) => /^\.env/i.test(n)],
  ['log / build metadata', (n) => /\.(log|tsbuildinfo)$/i.test(n)],
];

/** @returns {string|null} the reason this path is forbidden, or null if it is fine. */
function forbiddenReason(relPath) {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];

  if (parts.length === 1 && ALWAYS_KEEP.has(name)) return null;

  for (const dir of parts.slice(0, -1)) {
    if (FORBIDDEN_DIRS.has(dir.toLowerCase())) return `lives in a "${dir}/" folder`;
  }
  for (const [label, test] of FORBIDDEN_FILES) {
    if (test(name)) return label;
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(DIST, full).split(sep).join('/'));
  }
  return out;
}

const prune = process.argv.includes('--prune');

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`✖ dist/ not found at ${DIST} — run \`vite build\` first.`);
  process.exit(1);
}

const offenders = files
  .map((f) => ({ file: f, reason: forbiddenReason(f) }))
  .filter((r) => r.reason);

if (offenders.length === 0) {
  console.log(`✓ dist/ clean — ${files.length} files, no forbidden content.`);
  process.exit(0);
}

if (prune) {
  for (const { file, reason } of offenders) {
    rmSync(join(DIST, file), { force: true });
    console.log(`  removed dist/${file} (${reason})`);
  }
  console.log(`✓ pruned ${offenders.length} file(s) from dist/.`);
  process.exit(0);
}

console.error('✖ Forbidden files found in dist/ — refusing to deploy:\n');
for (const { file, reason } of offenders) {
  console.error(`  dist/${file}  →  ${reason}`);
}
console.error('\nMost likely cause: the file was added under public/, which Vite');
console.error('copies verbatim into dist/. Move it to docs/ instead.');
process.exit(1);
