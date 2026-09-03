#!/usr/bin/env node
// Import earn rates from an upstream card-data API into catalog-generated.js.
//
//   node tools/import-cards.mjs --inspect        # print the raw upstream shape, change nothing
//   node tools/import-cards.mjs                  # fetch, map, write catalog-generated.js
//   node tools/import-cards.mjs --from-file raw.json   # map a saved response (no network)
//
// Credentials (AwardWallet's Credit Card Bonus API is free; request a key at
// https://awardwallet.com/api/cc):
//   AWARDWALLET_API_USER / AWARDWALLET_API_PASS   -> sent as "user:pass"
//   AWARDWALLET_TOKEN                             -> sent verbatim
// both in the X-Authentication header. Override the endpoint with
// AWARDWALLET_CARDS_URL if the documented path differs from the default below.
//
// Design notes
// - The importer never edits cards.js. Curated cards win by id; imports only add.
// - It never touches credits.js either: statement credits aren't in the upstream
//   feed and stay hand-maintained.
// - Upstream category names are matched to this app's category vocabulary, which
//   is *read out of cards.js* — the curated catalog teaches the importer which
//   keywords a "Dining" or "Gas" category should match on.
// - tools/overrides.json is applied last, so a bad upstream record can be fixed
//   or dropped without editing generated output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'catalog-generated.js');
const OVERRIDES_FILE = path.join(ROOT, 'tools', 'overrides.json');
const DEFAULT_URL = process.env.AWARDWALLET_CARDS_URL || 'https://awardwallet.com/api/cc/v1/cards';

const args = process.argv.slice(2);
const INSPECT = args.includes('--inspect');
const fromFileIdx = args.indexOf('--from-file');
const FROM_FILE = fromFileIdx > -1 ? args[fromFileIdx + 1] : null;

// ---------- helpers ----------
const pick = (obj, ...names) => {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
};

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

// Upstream ids rarely match ours ("nordstrom-visa" vs "nordstrom-visa-signature"),
// so dedupe on the name too — otherwise a refresh quietly adds a second, worse
// copy of a card that's already curated.
const normalizeName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(credit card|card|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const namesCollide = (a, b) => {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.split(' ').length >= 3 && longer.includes(shorter);
};

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

function die(msg) {
  console.error(`[import-cards] ${msg}`);
  process.exit(1);
}

// ---------- the app's own category vocabulary, read from cards.js ----------
// cards.js is plain top-level `const` declarations, so evaluating it in a
// function scope hands back the catalog without a parser or a build step.
function loadCuratedCatalog() {
  const src = fs.readFileSync(path.join(ROOT, 'cards.js'), 'utf8');
  const fn = new Function(`${src}\nreturn { CARD_CATALOG, STARTER_CARD_IDS };`);
  return fn();
}

// canonical key -> every keyword the curated cards use for it
function buildCategoryVocabulary(catalog) {
  const vocab = new Map();
  const add = (key, keywords) => {
    if (!key || !keywords) return;
    const set = vocab.get(key) || new Set();
    for (const k of keywords) set.add(k);
    vocab.set(key, set);
  };
  for (const card of catalog) {
    for (const cat of card.categories || []) add(cat.key, cat.keywords);
    for (const cat of card.always || []) add(cat.key, cat.keywords);
    for (const [key, def] of Object.entries(card.categoryDefinitions || {})) add(key, def.keywords);
    if (card.grocery) add('grocery', card.grocery.keywords);
  }
  return vocab;
}

// Upstream category names are prose ("Restaurants", "Gas Stations"). Map them
// onto our keys by looking for our key's own words in the name, then fall back
// to a synonym table for the ones that don't match by spelling alone.
const SYNONYMS = {
  dining: ['restaurant', 'dining', 'food', 'takeout', 'delivery', 'meal'],
  grocery: ['grocery', 'supermarket', 'groceries'],
  gas: ['gas', 'fuel', 'gasoline', 'ev charging'],
  'gas-ev': ['gas & ev', 'gas and ev'],
  travel: ['travel'],
  flight: ['airfare', 'flight', 'airline', 'air travel'],
  hotel: ['hotel', 'lodging', 'accommodation'],
  transit: ['transit', 'commut', 'subway', 'rideshare', 'rail'],
  streaming: ['streaming'],
  drugstore: ['drugstore', 'pharmacy'],
  entertainment: ['entertainment'],
  online: ['online retail', 'online shopping', 'online purchases'],
  wholesale: ['wholesale', 'warehouse club'],
  department: ['department store'],
  utilities: ['utility', 'utilities', 'internet', 'phone', 'cable'],
  office: ['office supply', 'office store'],
  advertising: ['advertising', 'ad spend'],
  shipping: ['shipping'],
  'home-improvement': ['home improvement', 'hardware'],
  amazon: ['amazon'],
  transitfare: [],
};

function matchCategoryKey(name, vocab) {
  const n = String(name).toLowerCase();
  for (const key of vocab.keys()) {
    const words = key.split('-').filter((w) => w.length > 2);
    if (words.length && words.every((w) => n.includes(w))) return key;
  }
  for (const [key, hints] of Object.entries(SYNONYMS)) {
    if (hints.some((h) => n.includes(h))) return vocab.has(key) ? key : null;
  }
  return null;
}

// Keywords for a generated category: our curated vocabulary when we recognize
// the category, plus the upstream name and any named merchants, so a search for
// a specific store still hits even when the category itself is unfamiliar.
function keywordsFor(name, key, merchants, vocab) {
  const out = new Set();
  const n = String(name).toLowerCase().trim();
  if (n && n.length > 2) out.add(n);
  if (key && vocab.has(key)) for (const k of vocab.get(key)) out.add(k);
  for (const m of merchants || []) {
    const label = String(pick(m, 'name', 'merchant', 'merchantName') || m).toLowerCase().trim();
    if (label && label.length > 2) out.add(label);
  }
  return [...out];
}

// ---------- upstream fetch ----------
async function fetchUpstream() {
  if (FROM_FILE) return JSON.parse(fs.readFileSync(FROM_FILE, 'utf8'));

  const token =
    process.env.AWARDWALLET_TOKEN ||
    (process.env.AWARDWALLET_API_USER && process.env.AWARDWALLET_API_PASS
      ? `${process.env.AWARDWALLET_API_USER}:${process.env.AWARDWALLET_API_PASS}`
      : null);
  if (!token) {
    die(
      'no credentials. Set AWARDWALLET_TOKEN, or AWARDWALLET_API_USER + AWARDWALLET_API_PASS.\n' +
        '            Request a free key at https://awardwallet.com/api/cc, or pass --from-file <saved.json>.'
    );
  }

  const res = await fetch(DEFAULT_URL, { headers: { 'X-Authentication': token, Accept: 'application/json' } });
  if (!res.ok) {
    die(`upstream returned ${res.status} ${res.statusText} for ${DEFAULT_URL}\n` +
        '            If the path is wrong, set AWARDWALLET_CARDS_URL to the one in their docs.');
  }
  return res.json();
}

// Upstream payloads wrap the list differently depending on the endpoint.
function extractCards(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['cards', 'data', 'results', 'items']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

// ---------- mapping ----------
function mapCard(raw, vocab) {
  const name = pick(raw, 'name', 'cardName', 'displayName', 'title');
  if (!name) return null;

  const id = slug(pick(raw, 'id', 'cardKey', 'key', 'slug') || name);
  const isCashBack = /cash/i.test(String(pick(raw, 'currency', 'rewardType', 'pointsType', 'type') || ''));
  const unit = isCashBack ? '%' : 'x';

  const rawCategories = pick(raw, 'earningCategories', 'spendBonusCategory', 'categories', 'bonusCategories') || [];
  const rawMerchants = pick(raw, 'earningMerchants', 'merchants') || [];

  const categories = [];
  for (const cat of rawCategories) {
    const label = pick(cat, 'name', 'category', 'spendBonusCategoryName', 'categoryName', 'label');
    const rate = num(pick(cat, 'rate', 'earnMultiplier', 'multiplier', 'earnRate', 'points', 'value'));
    if (!label || !rate) continue;
    const key = matchCategoryKey(label, vocab);
    const merchants = rawMerchants.filter(
      (m) => String(pick(m, 'category', 'categoryName') || '').toLowerCase() === String(label).toLowerCase()
    );
    categories.push({
      key: key || slug(label),
      rate,
      label: String(label),
      keywords: keywordsFor(label, key, merchants, vocab),
      ...(pick(cat, 'cap', 'spendLimit', 'limit') ? { cap: String(pick(cat, 'cap', 'spendLimit', 'limit')) } : {}),
    });
  }

  // Merchant-level bonuses with no matching category become their own entry —
  // this is what makes "Uber Eats" or "Whole Foods" resolve on an imported card.
  for (const m of rawMerchants) {
    const label = pick(m, 'name', 'merchant', 'merchantName');
    const rate = num(pick(m, 'rate', 'earnMultiplier', 'multiplier', 'earnRate'));
    if (!label || !rate) continue;
    if (categories.some((c) => c.keywords.includes(String(label).toLowerCase()))) continue;
    categories.push({ key: slug(label), rate, label: String(label), keywords: [String(label).toLowerCase()] });
  }

  const baseRate = num(pick(raw, 'baseRate', 'baseEarnRate', 'everythingElse', 'defaultRate')) ?? 1;

  return {
    id,
    name: String(name),
    network: String(pick(raw, 'network', 'cardNetwork') || 'Credit card'),
    issuer: String(pick(raw, 'issuer', 'bank', 'issuerName') || 'Unknown issuer'),
    color: '#8a8f98', // neutral swatch; curated cards carry the brand color
    unit,
    pointValue: unit === '%' ? 1.0 : 1.0,
    base: { rate: baseRate, label: 'Everything else' },
    categories,
    businessCard: /business/i.test(String(name)),
    source: 'imported',
    ...(pick(raw, 'annualFee', 'fee') !== undefined ? { annualFee: num(pick(raw, 'annualFee', 'fee')) } : {}),
  };
}

function applyOverrides(cards) {
  if (!fs.existsSync(OVERRIDES_FILE)) return cards;
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  const skip = new Set(overrides.skipIds || []);
  return cards
    .filter((c) => !skip.has(c.id))
    .map((c) => (overrides.cards && overrides.cards[c.id] ? { ...c, ...overrides.cards[c.id] } : c));
}

// ---------- main ----------
const payload = await fetchUpstream();
const rawCards = extractCards(payload);

if (INSPECT) {
  console.log(`[import-cards] ${rawCards.length} records from ${FROM_FILE || DEFAULT_URL}`);
  console.log('[import-cards] first record verbatim — check these field names against the mapping above:\n');
  console.log(JSON.stringify(rawCards[0] ?? payload, null, 2).slice(0, 4000));
  process.exit(0);
}

if (!rawCards.length) die('upstream returned no cards. Run with --inspect to see the raw payload.');

const { CARD_CATALOG } = loadCuratedCatalog();
const vocab = buildCategoryVocabulary(CARD_CATALOG);
const curatedIds = new Set(CARD_CATALOG.map((c) => c.id));
const curatedNames = CARD_CATALOG.map((c) => normalizeName(c.name));

const mapped = rawCards.map((r) => mapCard(r, vocab)).filter(Boolean);
const withCategories = mapped.filter((c) => c.categories.length > 0);
const isCurated = (card) =>
  curatedIds.has(card.id) || curatedNames.some((n) => namesCollide(n, normalizeName(card.name)));
const fresh = applyOverrides(withCategories.filter((c) => !isCurated(c)));
fresh.sort((a, b) => a.name.localeCompare(b.name));

const header = fs.readFileSync(OUT_FILE, 'utf8').split('const GENERATED_CARDS')[0];
const meta = {
  source: FROM_FILE || DEFAULT_URL,
  generatedAt: new Date().toISOString().slice(0, 10),
  count: fresh.length,
};
const body =
  `const GENERATED_CARDS = ${JSON.stringify(fresh, null, 2)};\n` +
  `const GENERATED_META = ${JSON.stringify(meta)};\n\n` +
  `if (typeof CARD_CATALOG !== 'undefined' && GENERATED_CARDS.length) {\n` +
  `  const curated = new Set(CARD_CATALOG.map((c) => c.id));\n` +
  `  for (const card of GENERATED_CARDS) {\n` +
  `    if (!curated.has(card.id)) CARD_CATALOG.push(card);\n` +
  `  }\n` +
  `}\n`;
fs.writeFileSync(OUT_FILE, header + body);

console.log(`[import-cards] upstream records:      ${rawCards.length}`);
console.log(`[import-cards] mapped with categories: ${withCategories.length}`);
console.log(`[import-cards] already curated (kept): ${withCategories.length - fresh.length}`);
console.log(`[import-cards] written to catalog-generated.js: ${fresh.length}`);
