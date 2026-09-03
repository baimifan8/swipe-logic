// Statement credits, kept separate from cards.js on purpose.
//
// cards.js holds *earn rates* — the multipliers a card pays on a purchase.
// This file holds the other half of the answer: the recurring credits that make
// a card the right swipe even when its multiplier isn't the highest. Ordering
// $18 of Uber Eats on an Amex Gold is 4x plus a $10 monthly credit; no rate on
// any other card in the wallet comes close.
//
// The split matters for updates: the catalog importer (tools/import-cards.mjs)
// rewrites machine-readable earn rates, and never touches this file. Credits
// change on issuer whim and are maintained by hand here.
//
// Shape, per card id:
//   { label, amount, cadence, annual, keywords, note, enroll }
//     amount   — dollars per cadence period; omit when the amount varies
//     cadence  — 'month' | 'quarter' | 'half' | 'year'
//     annual   — total dollars per calendar year (used for the tooltip)
//     keywords — matched against the query, same rules as category keywords
//     enroll   — true when the credit does nothing until you enroll in the app
//
// Terms checked September 3, 2026. Issuers change these constantly — treat the
// numbers as a prompt to look, not as gospel.

const CARD_CREDITS = {
  'amex-gold': [
    {
      label: 'Uber Cash',
      amount: 10,
      cadence: 'month',
      annual: 120,
      enroll: true,
      keywords: ['uber', 'uber eats', 'ubereats', 'uber ride', 'uber one'],
      note: 'U.S. Uber rides or Uber Eats orders. Add the card to your Uber account first; unused months do not roll over.',
    },
    {
      label: 'Dining credit',
      amount: 10,
      cadence: 'month',
      annual: 120,
      enroll: true,
      keywords: ['grubhub', 'five guys', 'cheesecake factory', 'buffalo wild wings', 'wonder'],
      note: 'Grubhub, Five Guys, The Cheesecake Factory, Buffalo Wild Wings and Wonder. Enrollment required.',
    },
    {
      label: "Dunkin' credit",
      amount: 7,
      cadence: 'month',
      annual: 84,
      enroll: true,
      keywords: ['dunkin', 'dunkin donuts', 'dunkin doughnuts'],
      note: "U.S. Dunkin' locations, on purchases of $7 or more. Enrollment required.",
    },
    {
      label: 'Resy credit',
      amount: 50,
      cadence: 'half',
      annual: 100,
      enroll: true,
      keywords: ['resy', 'resy restaurant'],
      note: 'Qualifying U.S. Resy restaurants — $50 January–June and $50 July–December. Enrollment required.',
    },
  ],

  'amex-platinum': [
    {
      label: 'Uber Cash',
      amount: 15,
      cadence: 'month',
      annual: 200,
      enroll: true,
      keywords: ['uber', 'uber eats', 'ubereats', 'uber ride', 'uber one'],
      note: '$15 a month plus a $20 bonus in December. U.S. rides and Uber Eats.',
    },
    {
      label: 'Digital entertainment credit',
      amount: 25,
      cadence: 'month',
      annual: 300,
      enroll: true,
      keywords: ['new york times', 'nytimes', 'peacock', 'disney+', 'disney plus', 'hulu', 'espn+', 'wall street journal', 'audible', 'siriusxm'],
      note: 'Select digital subscriptions only — check the current partner list in the Amex app before counting on it.',
    },
    {
      label: 'Resy credit',
      cadence: 'year',
      annual: 400,
      enroll: true,
      keywords: ['resy', 'resy restaurant'],
      note: 'Qualifying U.S. Resy restaurants. Paid out in periods — confirm the current split in the Amex app.',
    },
    {
      label: 'Hotel credit',
      cadence: 'year',
      annual: 600,
      keywords: ['fine hotels', 'fine hotels and resorts', 'the hotel collection', 'amex travel hotel', 'prepaid hotel'],
      note: 'Prepaid Fine Hotels + Resorts and The Hotel Collection bookings through Amex Travel (two-night minimum on THC).',
    },
  ],

  csr: [
    {
      label: 'Annual travel credit',
      cadence: 'year',
      annual: 300,
      keywords: ['flight', 'airfare', 'airline', 'hotel', 'rental car', 'car rental', 'train', 'amtrak', 'parking', 'toll', 'rideshare', 'uber ride', 'lyft', 'taxi', 'travel'],
      note: 'Applies automatically to the first $300 of travel purchases each cardmember year — no enrollment, no portal requirement.',
    },
    {
      label: 'Exclusive Tables dining credit',
      amount: 150,
      cadence: 'half',
      annual: 300,
      enroll: true,
      keywords: ['exclusive tables', 'sapphire reserve restaurant', 'opentable'],
      note: 'Only at restaurants in the Sapphire Reserve Exclusive Tables program — $150 January–June, $150 July–December.',
    },
    {
      label: 'The Edit hotel credit',
      cadence: 'year',
      annual: 500,
      keywords: ['the edit', 'chase travel hotel', 'hotel booked through chase'],
      note: 'Hotels booked through The Edit by Chase Travel, up to $250 per stay, two-night minimum.',
    },
    {
      label: 'DoorDash credits',
      cadence: 'month',
      keywords: ['doordash', 'dashpass', 'food delivery'],
      note: 'Monthly DoorDash promo credits plus complimentary DashPass. Amounts vary — check the offer in the Chase app.',
    },
  ],

  csp: [
    {
      label: 'Hotel credit',
      cadence: 'year',
      annual: 50,
      keywords: ['hotel booked through chase', 'chase travel hotel', 'hotel'],
      note: 'Applies to the first $50 of hotel stays booked through Chase Travel each cardmember year.',
    },
  ],

  'venture-x': [
    {
      label: 'Capital One Travel credit',
      cadence: 'year',
      annual: 300,
      keywords: ['capital one travel', 'flight', 'airfare', 'hotel', 'rental car', 'car rental'],
      note: 'Only on bookings made through the Capital One Travel portal.',
    },
  ],

  'venture-x-business': [
    {
      label: 'Capital One Travel credit',
      cadence: 'year',
      annual: 300,
      keywords: ['capital one travel', 'flight', 'airfare', 'hotel', 'rental car', 'car rental'],
      note: 'Only on bookings made through the Capital One Travel portal.',
    },
  ],

  'hilton-aspire': [
    {
      label: 'Hilton resort credit',
      amount: 200,
      cadence: 'half',
      annual: 400,
      keywords: ['hilton', 'hilton resort', 'waldorf', 'conrad', 'resort'],
      note: 'Resort-classified Hilton properties only — room rate, dining, spa and parking on property. $200 January–June, $200 July–December.',
    },
  ],

  'marriott-bonvoy-brilliant': [
    {
      label: 'Dining credit',
      amount: 25,
      cadence: 'month',
      annual: 300,
      keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'takeout'],
      note: 'Restaurants worldwide, including takeout and delivery in the U.S.',
    },
  ],
};

// Attach credits to the catalog once, at load. Kept here rather than in app.js
// so a card's credits travel with the catalog entry the wallet rehydrates from.
if (typeof CARD_CATALOG !== 'undefined') {
  for (const card of CARD_CATALOG) {
    const credits = CARD_CREDITS[card.id];
    if (credits && credits.length) card.credits = credits;
  }
}
