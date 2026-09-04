#!/usr/bin/env node
// Self-hosted server for Swipe Logic: serves the static app and counts how many
// people are using it right now. No dependencies, no database, no accounts.
//
//   node server.js                 # http://localhost:8080
//   PORT=3000 node server.js
//   SWIPE_TRACKER=off node server.js   # serve the app, skip session counting
//
// The tracker only ever sees an opaque random id the browser makes up for the
// current tab session — no IP addresses, no user agents, no purchase queries,
// and nothing that identifies a person. Counts live in SWIPE_DATA_DIR
// (./data by default), which is separate from the app files, so pulling a new
// version of the app never touches them. Wallets are not stored here at all:
// they stay in each browser's own localStorage.

'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.SWIPE_DATA_DIR || path.join(ROOT, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const TRACKER_ENABLED = String(process.env.SWIPE_TRACKER || 'on').toLowerCase() !== 'off';

const ACTIVE_WINDOW_MS = 90 * 1000; // a session counts as "here now" for 90s after its last heartbeat
const SAVE_DEBOUNCE_MS = 10 * 1000;
const MAX_BODY_BYTES = 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------- session counts ----------
const lastSeen = new Map(); // session id -> timestamp (memory only)
let stats = { day: today(), todayIds: [], allTime: 0 };
let todayIds = new Set();
let saveTimer = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadStats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    stats = {
      day: typeof parsed.day === 'string' ? parsed.day : today(),
      todayIds: Array.isArray(parsed.todayIds) ? parsed.todayIds : [],
      allTime: Number(parsed.allTime) || 0,
    };
    todayIds = new Set(stats.todayIds);
  } catch (e) {
    /* first run, or an unreadable file — start fresh rather than crash */
  }
  rollDay();
}

function rollDay() {
  const d = today();
  if (stats.day !== d) {
    stats.day = d;
    todayIds = new Set();
    scheduleSave();
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStats();
  }, SAVE_DEBOUNCE_MS);
  if (saveTimer.unref) saveTimer.unref();
}

async function saveStats() {
  const payload = JSON.stringify({ day: stats.day, todayIds: [...todayIds], allTime: stats.allTime });
  const tmp = STATS_FILE + '.tmp';
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(tmp, payload);
    await fsp.rename(tmp, STATS_FILE);
  } catch (e) {
    console.error('[swipe-logic] could not write stats:', e.message);
  }
}

function recordHeartbeat(id) {
  rollDay();
  lastSeen.set(id, Date.now());
  if (!todayIds.has(id)) {
    todayIds.add(id);
    stats.allTime += 1;
    scheduleSave();
  }
}

function currentStats() {
  rollDay();
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [id, seen] of lastSeen) {
    if (seen < cutoff) lastSeen.delete(id);
  }
  return { active: lastSeen.size, today: todayIds.size, allTime: stats.allTime };
}

// ---------- http ----------
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (!TRACKER_ENABLED) return sendJson(res, 404, { error: 'tracker disabled' });

  if (pathname === '/api/stats' && req.method === 'GET') {
    return sendJson(res, 200, currentStats());
  }
  if (pathname === '/api/session' && req.method === 'POST') {
    let id = '';
    try {
      id = String(JSON.parse(await readBody(req)).id || '');
    } catch (e) {
      return sendJson(res, 400, { error: 'expected {"id": "..."}' });
    }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return sendJson(res, 400, { error: 'invalid id' });
    recordHeartbeat(id);
    return sendJson(res, 200, currentStats());
  }
  return sendJson(res, 404, { error: 'not found' });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  // Clean URLs for extension-less paths (/wiki -> wiki.html), matching how
  // Cloudflare's static-asset serving resolves the same URL in production —
  // local dev and the deployed site should agree on what a link points to.
  if (!path.extname(rel) && fs.existsSync(path.join(ROOT, rel + '.html'))) {
    rel += '.html';
  }
  const filePath = path.join(ROOT, path.normalize(rel));
  if (!filePath.startsWith(ROOT + path.sep) || filePath.startsWith(DATA_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // The app shell must not be cached by the browser, or an update would sit
    // behind a stale copy; hashed-forever assets aren't used here.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res).on('error', () => res.end());
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(() => sendJson(res, 500, { error: 'server error' }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

if (TRACKER_ENABLED) loadStats();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    saveStats().finally(() => process.exit(0));
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[swipe-logic] serving ${ROOT} on http://localhost:${PORT}`);
  console.log(`[swipe-logic] session tracker ${TRACKER_ENABLED ? `on (counts in ${STATS_FILE})` : 'off'}`);
});
