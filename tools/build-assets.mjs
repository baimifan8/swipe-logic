#!/usr/bin/env node
// Collect the browser-facing files into dist/ for `wrangler deploy`.
//
// The repo root doubles as the document root when you run server.js locally,
// which is convenient but means it also holds server.js, wrangler.jsonc and
// tools/. Cloudflare serves an assets directory wholesale, so the deploy gets a
// copy containing only what a browser should be able to fetch.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// wrangler runs this before every deploy, which makes it the right place to
// catch a file that index.html loads but nothing lists — that failure is
// invisible locally and a 404 in production. Spawned rather than imported so it
// works the same however wrangler invokes this script.
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'bump-version.mjs'), '--check'], {
    stdio: 'inherit',
  });
} catch {
  // The check already printed exactly what's wrong; a Node stack trace on top
  // of it would only bury the message.
  console.error('[build-assets] aborted — fix the problems above, then build again.');
  process.exit(1);
}

const FILES = [
  'index.html',
  'base.css',
  'style.css',
  'cards.js',
  'catalog-generated.js',
  'credits.js',
  'credit-usage.js',
  'matcher.js',
  'app.js',
  'presence.js',
  'sw.js',
  'manifest.webmanifest',
];

// Static assets are versioned by the ?v= query string in index.html, so the
// files themselves must not be cached hard — an update has to be able to land.
const HEADERS = `/*
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=86400
`;

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) {
    console.error(`[build-assets] missing ${file} — the deploy would 404 on it`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DIST, file));
  copied += 1;
}

const assetsDir = path.join(ROOT, 'assets');
if (fs.existsSync(assetsDir)) {
  fs.cpSync(assetsDir, path.join(DIST, 'assets'), { recursive: true });
  copied += fs.readdirSync(assetsDir).length;
}

fs.writeFileSync(path.join(DIST, '_headers'), HEADERS);
console.log(`[build-assets] ${copied} files -> dist/`);
