// Matching engine: takes a free-text query + card list, returns ranked results
// with effective cash-back % per card so cards with different units (x points vs %)
// can be compared apples-to-apples.

const STOPWORDS = new Set(['a', 'an', 'the', 'at', 'via', 'for', 'to', 'on', 'in', 'of', 'and', 'or', 'my', 'booked', 'through', 'with', 'direct', 'select']);

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s&'+-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function significantTokens(tokens) {
  return tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Score how well a query matches a keyword list. Returns 0 if no confident match.
function keywordScore(query, keywords) {
  if (!keywords || !keywords.length) return 0;
  let best = 0;
  const qTokens = query.split(' ');
  for (const kw of keywords) {
    const k = normalize(kw);
    if (!k) continue;
    if (query === k) { best = Math.max(best, 100); continue; }
    // Substring match: only trust it if the keyword phrase has 2+ significant words,
    // or is a single distinctive word (length > 3) — avoids generic short-word false positives.
    const kTokens = k.split(' ');
    const kSig = significantTokens(kTokens);
    if (query.includes(k) && (kTokens.length >= 2 || k.length > 3)) {
      best = Math.max(best, 80 + Math.min(k.length, 20));
      continue;
    }
    // Token overlap: require ALL significant keyword tokens to be present in the query
    // (not just any one), so generic words like "hotel" alone can't trigger a match
    // for a multi-word keyword phrase like "hotel booked through chase".
    if (kSig.length > 0) {
      const allPresent = kSig.every((t) => qTokens.includes(t));
      if (allPresent) {
        best = Math.max(best, 40 + kSig.length * 10);
      }
    }
  }
  return best;
}

// Compute effective cash-back percentage for a card's rate, unit, and point value.
function effectivePercent(rate, unit, pointValue) {
  if (unit === '%') return rate;
  // unit === 'x' -> points per dollar * cents-per-point value = cents back per dollar = %
  return rate * pointValue;
}

// Given one card and a query, find its best matching category and effective rate.
function bestCategoryForCard(card, query) {
  let matches = [];

  if (card.editableChoiceCategory) {
    // BofA-style: an optional fixed "grocery" bonus, plus a user-configurable choice category.
    if (card.grocery) {
      const groceryScore = keywordScore(query, card.grocery.keywords);
      if (groceryScore > 0) {
        matches.push({
          score: groceryScore,
          rate: card.grocery.rate,
          label: card.grocery.label,
          unit: card.unit,
          cap: card.cap,
        });
      }
    }
    // Optional always-on categories that apply regardless of the chosen rotating/choice category
    // (e.g. Chase Freedom Flex's permanent 5% Chase Travel / 3% dining / 3% drugstore).
    if (card.always && card.always.length) {
      for (const cat of card.always) {
        const s = keywordScore(query, cat.keywords);
        if (s > 0) {
          matches.push({ score: s, rate: cat.rate, label: cat.label, unit: card.unit, cap: cat.cap });
        }
      }
    }
    const chosenDef = card.categoryDefinitions[card.choiceCategory];
    if (chosenDef) {
      const choiceScore = keywordScore(query, chosenDef.keywords);
      if (choiceScore > 0) {
        matches.push({
          score: choiceScore,
          rate: card.choiceRate,
          label: `${chosenDef.label} (your selected ${card.choiceRate}${card.unit} category)`,
          unit: card.unit,
          cap: card.cap,
        });
      }
    }
    // Also check unselected choice categories to surface "you could switch" info
    for (const [key, def] of Object.entries(card.categoryDefinitions)) {
      if (key === card.choiceCategory) continue;
      const s = keywordScore(query, def.keywords);
      if (s > 0) {
        matches.push({
          score: s * 0.99, // slightly below an active match, still informative
          rate: card.choiceRate,
          label: `${def.label} (switch your ${card.choiceRate}${card.unit} choice category to unlock)`,
          unit: card.unit,
          cap: card.cap,
          requiresSwitch: true,
          switchTargetKey: key,
          switchTargetLabel: def.label,
        });
      }
    }
  } else {
    for (const cat of card.categories || []) {
      const s = keywordScore(query, cat.keywords);
      if (s > 0) {
        matches.push({ score: s, rate: cat.rate, label: cat.label, unit: card.unit, cap: cat.cap });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches[0];

  if (top && !top.requiresSwitch) {
    return { ...top, isBase: false };
  }

  // No confident category match (or only a "requires switch" match) -> fall back to base rate,
  // but still surface the switch suggestion if one exists.
  const switchSuggestion = matches.find((m) => m.requiresSwitch);
  return {
    score: top ? top.score : 0,
    rate: card.base.rate,
    label: card.base.label,
    unit: card.unit,
    isBase: true,
    switchSuggestion,
  };
}

// Recurring statement credits (credits.js) that apply to this purchase, best match first.
// Credits are reported alongside the rate rather than folded into it: a $10/month
// Uber credit is worth more than any multiplier on a small order, but only until
// it's spent, and only this app's user knows whether they've used it yet.
function matchingCredits(card, query) {
  if (!card.credits || !card.credits.length) return [];
  return card.credits
    .map((credit) => ({ credit, score: keywordScore(query, credit.keywords) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.credit);
}

// What this purchase is actually worth on one card, in dollars. Only computable
// with an amount: a $10 credit beats 4x points on an $18 order and loses badly on
// a $500 one, and nothing but the amount separates those two cases.
//
// Rewards accrue on the full charge — a statement credit posts separately and
// doesn't reduce the earning charge — so the two add rather than compete. Credits
// are capped at the purchase amount (you can't extract $50 of credit from a $18
// order) and at what's left of each one this period. A credit whose size varies
// contributes nothing here rather than an invented number; it still gets listed.
function purchaseValue(amount, effPct, liveCredits, remainingOf) {
  const rewards = (amount * effPct) / 100;
  let credits = 0;
  for (const credit of liveCredits) {
    const left = remainingOf(credit);
    if (typeof left !== 'number') continue;
    credits += Math.min(left, amount - credits);
    if (credits >= amount) break;
  }
  credits = Math.max(0, Math.min(credits, amount));
  return { rewards, credits, total: rewards + credits };
}

// Options:
//   isCreditLive(card, credit)     exclude credits already spent this period
//   creditRemaining(card, credit)  dollars left of one, or null when it varies
//   amount                         purchase amount; switches ranking to dollars
// All optional — the matcher stays usable on its own.
function rankCards(query, cards, options) {
  const q = normalize(query);
  if (!q) return [];
  const opts = options || {};
  const live = typeof opts.isCreditLive === 'function' ? opts.isCreditLive : () => true;
  const remaining = typeof opts.creditRemaining === 'function' ? opts.creditRemaining : () => null;
  const amount = Number(opts.amount) > 0 ? Number(opts.amount) : null;

  const results = cards.map((card) => {
    const match = bestCategoryForCard(card, q);
    const effPct = effectivePercent(match.rate, match.unit, card.pointValue);
    const credits = matchingCredits(card, q);
    const liveCredits = credits.filter((c) => live(card, c));
    return {
      card,
      match,
      effectivePercent: effPct,
      confidence: match.isBase ? 0 : match.score,
      credits,
      liveCredits,
      value: amount ? purchaseValue(amount, effPct, liveCredits, (c) => remaining(card, c)) : null,
    };
  });

  results.sort((a, b) => {
    // With an amount, total dollars back is the whole question — a credit can
    // legitimately beat a better multiplier, which is what the amount is for.
    if (amount) {
      if (Math.abs(b.value.total - a.value.total) > 0.005) return b.value.total - a.value.total;
    }
    if (Math.abs(b.effectivePercent - a.effectivePercent) > 0.01) {
      return b.effectivePercent - a.effectivePercent;
    }
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Same rate and same confidence: the card with an unspent credit wins. A
    // credit already used this period breaks nothing — it isn't there to win.
    return (b.liveCredits.length ? 1 : 0) - (a.liveCredits.length ? 1 : 0);
  });

  return results;
}
