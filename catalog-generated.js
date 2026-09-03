// GENERATED FILE — do not edit by hand.
//
// Written by `node tools/import-cards.mjs`, which pulls machine-readable earn
// rates from an upstream card-data API and maps them into this app's schema.
// Committed empty so the app still loads before the first import runs.
//
// Curated entries in cards.js always win: a generated card is only appended if
// its id isn't already in the catalog. That way hand-tuned keywords, notes and
// caps survive every refresh, and the import only ever *adds* coverage.
const GENERATED_CARDS = [];
const GENERATED_META = { source: null, generatedAt: null, count: 0 };

if (typeof CARD_CATALOG !== 'undefined' && GENERATED_CARDS.length) {
  const curated = new Set(CARD_CATALOG.map((c) => c.id));
  for (const card of GENERATED_CARDS) {
    if (!curated.has(card.id)) CARD_CATALOG.push(card);
  }
}
