// Default card lineup — Kevin's wallet, seeded from issuer public terms (checked July 31, 2026).
// Each card has categories: array of {key, label, rate, unit: 'x'|'%', note?, cap?}
// `keywords` are used for fuzzy matching against the free-text query.
// `base` is the fallback/everything-else rate for that card.

const DEFAULT_CARDS = [
  {
    id: 'csp',
    name: 'Chase Sapphire Preferred',
    short: 'CSP',
    network: 'Visa',
    color: '#0f3fae',
    unit: 'x',
    pointValue: 1.0, // cents per point, cash-out value
    base: { rate: 1, label: 'Everything else' },
    categories: [
      { key: 'chase-travel', rate: 5, label: 'Travel via Chase Travel', keywords: ['chase travel', 'flight booked through chase', 'hotel booked through chase'] },
      { key: 'dining', rate: 3, label: 'Dining, takeout & delivery', keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'takeout', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'food delivery', 'coffee', 'cafe', 'bar', 'brewery', 'starbucks'] },
      { key: 'gas-ev', rate: 3, label: 'Gas & EV charging', keywords: ['gas', 'gas station', 'fuel', 'ev charging', 'chargepoint', 'electric vehicle charging'] },
      { key: 'streaming', rate: 3, label: 'Select streaming services', keywords: ['netflix', 'hulu', 'disney+', 'disney plus', 'espn+', 'spotify', 'apple music', 'apple tv', 'streaming'] },
      { key: 'online-grocery', rate: 3, label: 'Online groceries (excl. Target/Walmart/wholesale)', keywords: ['instacart', 'online grocery', 'grocery delivery'] },
      { key: 'vacation-rental', rate: 3, label: 'Vacation homes (Airbnb, Vrbo)', keywords: ['airbnb', 'vrbo', 'vacation rental', 'vacation home'] },
      { key: 'other-travel', rate: 2, label: 'Other travel (airfare, hotel, rideshare, etc.)', keywords: ['flight', 'airfare', 'airline', 'airline ticket', 'plane ticket', 'book a flight', 'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'spirit airlines', 'alaska airlines', 'hotel', 'motel', 'rideshare', 'uber ride', 'lyft', 'taxi', 'train', 'amtrak', 'parking', 'rental car', 'car rental', 'cruise', 'travel'] },
    ],
    notes: 'Points worth 1¢ cash back, up to ~1.5–1.25x via Chase Travel portal, more via airline/hotel transfer partners.',
  },
  {
    id: 'amex-gold',
    name: 'Amex Gold',
    short: 'Gold',
    network: 'Amex',
    color: '#caa04c',
    unit: 'x',
    pointValue: 1.0,
    base: { rate: 1, label: 'Everything else' },
    categories: [
      { key: 'dining', rate: 4, label: 'Restaurants worldwide (+takeout/delivery in US)', cap: '$50,000/yr', keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'takeout', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'food delivery', 'bar', 'brewery'] },
      { key: 'grocery', rate: 4, label: 'U.S. supermarkets', cap: '$25,000/yr', keywords: ['grocery', 'groceries', 'supermarket', 'whole foods', 'trader joe', 'stop & shop', 'stop and shop', 'shaws'] },
      { key: 'hotel', rate: 5, label: 'Prepaid hotels via Amex Travel', keywords: ['amex travel hotel', 'prepaid hotel'] },
      { key: 'flight', rate: 3, label: 'Flights (direct or Amex Travel)', keywords: ['flight', 'airfare', 'airline', 'airline ticket', 'plane ticket', 'book a flight', 'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'spirit airlines', 'alaska airlines'] },
      { key: 'car-cruise', rate: 2, label: 'Prepaid car rentals / cruises via Amex Travel', keywords: ['cruise'] },
    ],
    notes: '4x dining/groceries is the strongest of any card in the wallet — default to this for food spend.',
  },
  {
    id: 'hilton-aspire',
    name: 'Amex Hilton Honors Aspire',
    short: 'Hilton Aspire',
    network: 'Amex',
    color: '#5b3a99',
    unit: 'x',
    pointValue: 0.5, // Hilton points redeem around 0.5¢/pt for standard rooms
    base: { rate: 3, label: 'Everything else' },
    categories: [
      { key: 'hilton', rate: 14, label: 'Hilton hotels & resorts (direct)', keywords: ['hilton', 'hampton inn', 'doubletree', 'embassy suites', 'waldorf astoria', 'conrad hotel', 'homewood suites', 'tru by hilton', 'canopy'] },
      { key: 'flight-direct', rate: 7, label: 'Flights (direct with airline or AmexTravel.com)', keywords: ['flight', 'airfare', 'airline', 'airline ticket', 'plane ticket', 'book a flight', 'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'spirit airlines', 'alaska airlines'] },
      { key: 'car-rental', rate: 7, label: 'Car rentals (direct with select companies)', keywords: ['car rental', 'rental car', 'hertz', 'avis', 'enterprise rent'] },
      { key: 'dining', rate: 7, label: 'U.S. restaurants (incl. takeout/delivery)', keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'takeout', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'food delivery', 'bar', 'brewery', 'coffee', 'cafe', 'starbucks'] },
    ],
    notes: 'Best card in the wallet for any Hilton stay — 14x plus Diamond status perks. $550 annual fee already sunk, so lean on it for travel/dining too.',
  },
  {
    id: 'bce',
    name: 'Amex Blue Cash Everyday',
    short: 'Blue Cash Everyday',
    network: 'Amex',
    color: '#1f6fb2',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 1, label: 'Everything else' },
    categories: [
      { key: 'grocery', rate: 3, label: 'U.S. supermarkets', cap: '$6,000/yr', keywords: ['grocery', 'groceries', 'supermarket', 'whole foods', 'trader joe', 'stop & shop', 'stop and shop', 'shaws'] },
      { key: 'gas', rate: 3, label: 'U.S. gas stations', cap: '$6,000/yr', keywords: ['gas', 'gas station', 'fuel', 'exxon', 'mobil', 'shell', 'chevron', 'bp', 'sunoco'] },
      { key: 'online-retail', rate: 3, label: 'U.S. online retail', cap: '$6,000/yr', keywords: ['amazon', 'online shopping', 'online retail', 'ebay', 'etsy', 'online order', 'website purchase', 'target.com', 'walmart.com'] },
    ],
    notes: 'Best backup for Amazon/online retail since it has no annual fee and stacks with Amex Offers.',
  },
  {
    id: 'cfu',
    name: 'Chase Freedom Unlimited',
    short: 'CFU',
    network: 'Visa',
    color: '#0a5ec9',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 1.5, label: 'Everything else' },
    categories: [
      { key: 'chase-travel', rate: 5, label: 'Travel via Chase Travel', keywords: ['chase travel', 'flight booked through chase', 'hotel booked through chase'] },
      { key: 'dining', rate: 3, label: 'Dining, incl. takeout & delivery', keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'takeout', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'food delivery', 'bar', 'coffee', 'cafe', 'starbucks'] },
      { key: 'drugstore', rate: 3, label: 'Drugstores', keywords: ['cvs', 'walgreens', 'rite aid', 'drugstore', 'pharmacy'] },
    ],
    notes: 'Reliable 1.5% floor beats most cards\' base rate — good default when nothing else applies.',
  },
  {
    id: 'boa-ccr',
    name: 'Bank of America Customized Cash Rewards',
    short: 'BofA CCR',
    network: 'Visa/Mastercard',
    color: '#c8102e',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 1, label: 'Everything else' },
    editableChoiceCategory: true, // 3% category is user-selectable
    choiceCategoryOptions: ['online-shopping', 'gas-ev', 'dining', 'travel', 'drugstore', 'home-improvement'],
    choiceCategory: 'online-shopping', // default selection — user can change in settings
    categoryDefinitions: {
      'online-shopping': { label: 'Online shopping (incl. streaming, cable, phone)', keywords: ['amazon', 'online shopping', 'online retail', 'ebay', 'etsy', 'online order', 'streaming', 'netflix', 'hulu', 'phone bill', 'cable bill', 'internet bill', 'target.com', 'walmart.com'] },
      'gas-ev': { label: 'Gas & EV charging', keywords: ['gas', 'gas station', 'fuel', 'ev charging', 'chargepoint'] },
      'dining': { label: 'Dining', keywords: ['restaurant', 'dining', 'dinner', 'lunch', 'takeout', 'doordash', 'ubereats', 'grubhub', 'bar', 'coffee', 'cafe'] },
      'travel': { label: 'Travel', keywords: ['flight', 'airfare', 'airline', 'airline ticket', 'plane ticket', 'book a flight', 'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'hotel', 'rideshare', 'uber ride', 'lyft', 'taxi', 'train', 'parking', 'rental car', 'travel'] },
      'drugstore': { label: 'Drug stores & pharmacy', keywords: ['cvs', 'walgreens', 'rite aid', 'drugstore', 'pharmacy'] },
      'home-improvement': { label: 'Home improvement & furnishings', keywords: ['home depot', 'lowes', 'furniture', 'ikea', 'wayfair', 'hardware store', 'home improvement'] },
    },
    grocery: { rate: 2, label: 'Grocery stores & wholesale clubs', keywords: ['grocery', 'groceries', 'supermarket', 'whole foods', 'trader joe', 'costco', 'bjs', "bj's", 'sams club', "sam's club", 'wholesale club', 'stop & shop', 'stop and shop', 'shaws'] },
    choiceRate: 3,
    cap: '$2,500/quarter combined (choice + grocery)',
    notes: 'Choice category can be changed once a month in the BofA app — edit it here to match. 2% grocery/wholesale club is automatic regardless of choice.',
  },
  {
    id: 'nfcu',
    name: 'Navy Federal cashRewards',
    short: 'NFCU',
    network: 'Visa',
    color: '#003b5c',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 1.5, label: 'Everything, no categories' },
    categories: [],
    notes: 'Flat rate, no categories to track. Assumes standard cashRewards (1.5%) — bump to 2% below if you have cashRewards Plus.',
  },
  {
    id: 'fidelity-visa',
    name: 'Fidelity Rewards Visa Signature',
    short: 'Fidelity Visa',
    network: 'Visa',
    color: '#0a8a4a',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 2, label: 'Everything, no categories (when redeemed to Fidelity account)' },
    categories: [],
    notes: 'Flat 2% on everything, deposited straight into your Fidelity account — perfect for subscriptions & Roth funding. Only earns 2% if redeemed into an eligible Fidelity account (1% otherwise).',
  },
  {
    id: 'apple-card',
    name: 'Apple Card',
    short: 'Apple Card',
    network: 'Mastercard',
    color: '#3a3a3c',
    unit: '%',
    pointValue: 1.0,
    base: { rate: 1, label: 'Physical card swipe (Apple Pay not used)' },
    categories: [
      { key: 'apple', rate: 3, label: 'Apple purchases (Apple Store, apple.com, App Store)', keywords: ['apple store', 'iphone', 'ipad', 'macbook', 'mac', 'apple watch', 'airpods', 'app store', 'apple music', 'apple tv', 'icloud', 'apple purchase'] },
      { key: 'partner-3', rate: 3, label: 'Partner merchants via Apple Pay (Ace Hardware, Uber, Walgreens, Nike, Exxon/Mobil, Panera, T-Mobile, Duane Reade, Booking.com, Hertz)', keywords: ['ace hardware', 'uber ride', 'uber eats', 'walgreens', 'nike', 'exxon', 'mobil', 'panera', 't-mobile', 'duane reade', 'booking.com', 'hertz'] },
      { key: 'apple-pay-other', rate: 2, label: 'Any other purchase paid via Apple Pay', keywords: [] },
    ],
    notes: 'Only earns the listed rate when paid with Apple Pay — physical card taps/swipes drop to 1%. This tool assumes Apple Pay is used unless it is a partner-3% merchant paid by physical card.',
  },
];

// Deep clone helper
function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CARDS));
}
