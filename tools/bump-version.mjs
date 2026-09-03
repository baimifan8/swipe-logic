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

// Two classes of problem, which want different treatment on a bump:
//   drift    — index.html and sw.js name different versions. A bump repairs this
//              by definition, since it rewrites both to the same new number.
//   listing  — a file nothing lists. No version number can fix that, so a bump
//              must refuse rather than paper over it with a fresh number.
let drift = 0;
let listing = 0;
const failDrift = (msg) => {
  console.error(`  ✗ ${msg}`);
  drift += 1;
};
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  listing += 1;
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
    failDrift(`index.html loads ${file} with ?v=${version ?? '(none)'}, but sw.js is ${currentVersion}`);
  }
}
for (const { file } of pageFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`index.html loads ${file}, which does not exist`);
  if (!swAssets.has(file)) fail(`${file} is loaded by index.html but missing from the ASSETS list in sw.js (won't work offline)`);
  if (!buildFiles.has(file)) fail(`${file} is loaded by index.html but missing from FILES in tools/build-assets.mjs (would 404 when deployed)`);
}

const problems = drift + listing;
if (CHECK_ONLY) {
  if (problems) {
    console.error(`\n[bump-version] ${problems} problem${problems === 1 ? '' : 's'} found.`);
    process.exit(1);
  }
  console.log(`  ✓ ${pageFiles.length} files listed consistently in index.html, sw.js and build-assets.mjs`);
  console.log('[bump-version] check only — nothing changed.');
  process.exit(0);
}

if (listing) {
  console.error(`\n[bump-version] ${listing} file${listing === 1 ? '' : 's'} not listed everywhere.`);
  console.error('[bump-version] a new version number cannot fix that — list the file, then release.\n');
  process.exit(1);
}
if (drift) {
  console.log(`  → repairing ${drift} version mismatch${drift === 1 ? '' : 'es'} as part of this bump`);
} else {
  console.log(`  ✓ ${pageFiles.length} files listed consistently in index.html, sw.js and build-assets.mjs`);
}

// ---------- bump ----------
const nextNumber = explicit ? Number(explicit.replace(/^v/, '')) : currentNumber + 1;
// "Already at this version" is only nothing-to-do when the files agree. With
// drift outstanding, rewriting them to the same number is the repair.
if (nextNumber === currentNumber && !drift) {
  console.log(`[bump-version] already at v${nextNumber} — nothing to do.`);
  process.exit(0);
}
const nextVersion = `v${nextNumber}`;

fs.writeFileSync(SW, swSrc.replace(`const VERSION = '${currentVersion}';`, `const VERSION = '${nextVersion}';`));
// Rewrite every ?v= regardless of what it currently says, so a bump also
// repairs tags that had drifted to some other number.
fs.writeFileSync(INDEX, indexSrc.replace(/\?v=\d+"/g, `?v=${nextNumber}"`));

console.log(`[bump-version] ${currentVersion} -> ${nextVersion} in sw.js and index.html`);
console.log('[bump-version] commit these, then deploy.');
