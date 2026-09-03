#!/usr/bin/env node
// Keep the cache version in sync across the three places that have to agree,
// and catch the drift that happens when a new script file is added.
//
//   node tools/bump-version.mjs           # bump to the next version everywhere
//   node tools/bump-version.mjs v20       # set an explicit version
//   node tools/bump-version.mjs --check   # verify only, change nothing (exit 1 on drift)
//
// The three places:
//   sw.js               VERSION, and the ASSETS list it precaches for offline use
//   index.html          the ?v= on every script tag
//   tools/build-assets.mjs  the FILES list copied into dist/ for deployment
//
// Forgetting the version bump is mostly harmless — the service worker fetches
// network-first, so online users still get new files — but the precached offline
// copy goes stale. Forgetting to *list* a new file is worse: it silently 404s on
// a deployed build while working fine locally, which is exactly what --check is
// here to prevent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW = path.join(ROOT, 'sw.js');
const INDEX = path.join(ROOT, 'index.html');
const BUILD = path.join(ROOT, 'tools', 'build-assets.mjs');

const read = (p) => fs.readFileSync(p, 'utf8');
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const explicit = args.find((a) => /^v?\d+$/.test(a));

let problems = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  problems += 1;
};

// ---------- read current state ----------
const swSrc = read(SW);
const indexSrc = read(INDEX);
const buildSrc = read(BUILD);

const swVersionMatch = swSrc.match(/const VERSION = '(v\d+)';/);
if (!swVersionMatch) {
  console.error("[bump-version] couldn't find `const VERSION = 'vN';` in sw.js");
  process.exit(1);
}
const currentVersion = swVersionMatch[1];
const currentNumber = Number(currentVersion.slice(1));

// Files the page actually loads, and the ?v= each one carries.
const scriptTags = [...indexSrc.matchAll(/<script src="\.\/([^"?]+)(?:\?v=(\d+))?"/g)]
  .map((m) => ({ file: m[1], version: m[2] }));
const styleTags = [...indexSrc.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+)"/g)]
  .map((m) => ({ file: m[1], version: null }));
const pageFiles = [...scriptTags, ...styleTags];

// Files listed for offline precaching and for the deployed build.
const swAssets = new Set(
  [...swSrc.matchAll(/['"`]\.\/([^'"`?]+)/g)].map((m) => m[1]).filter(Boolean)
);
const buildFilesMatch = buildSrc.match(/const FILES = \[([\s\S]*?)\];/);
const buildFiles = new Set(
  buildFilesMatch ? [...buildFilesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
);

// ---------- check ----------
console.log(`[bump-version] current version: ${currentVersion}`);

for (const { file, version } of scriptTags) {
  if (version !== String(currentNumber)) {
    fail(`index.html loads ${file} with ?v=${version ?? '(none)'}, but sw.js is ${currentVersion}`);
  }
}
for (const { file } of pageFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`index.html loads ${file}, which does not exist`);
  if (!swAssets.has(file)) fail(`${file} is loaded by index.html but missing from the ASSETS list in sw.js (won't work offline)`);
  if (!buildFiles.has(file)) fail(`${file} is loaded by index.html but missing from FILES in tools/build-assets.mjs (would 404 when deployed)`);
}

if (problems) {
  console.error(`\n[bump-version] ${problems} problem${problems === 1 ? '' : 's'} found.`);
  if (CHECK_ONLY) process.exit(1);
  console.error('[bump-version] fix the listing problems above before releasing.\n');
  // A version bump can't repair a missing file listing, so stop rather than
  // paper over it with a fresh version number.
  process.exit(1);
}

console.log(`  ✓ ${pageFiles.length} files listed consistently in index.html, sw.js and build-assets.mjs`);

if (CHECK_ONLY) {
  console.log('[bump-version] check only — nothing changed.');
  process.exit(0);
}

// ---------- bump ----------
const nextNumber = explicit ? Number(explicit.replace(/^v/, '')) : currentNumber + 1;
if (nextNumber === currentNumber) {
  console.log(`[bump-version] already at v${nextNumber} — nothing to do.`);
  process.exit(0);
}
const nextVersion = `v${nextNumber}`;

fs.writeFileSync(SW, swSrc.replace(`const VERSION = '${currentVersion}';`, `const VERSION = '${nextVersion}';`));
fs.writeFileSync(INDEX, indexSrc.replaceAll(`?v=${currentNumber}"`, `?v=${nextNumber}"`));

console.log(`[bump-version] ${currentVersion} -> ${nextVersion} in sw.js and index.html`);
console.log('[bump-version] commit these, then deploy.');
