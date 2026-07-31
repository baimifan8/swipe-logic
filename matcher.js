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
    // BofA-style: grocery is fixed, choice category is user-configurable
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
    const chosenDef = card.categoryDefinitions[card.choiceCategory];
    if (chosenDef) {
      const choiceScore = keywordScore(query, chosenDef.keywords);
      if (choiceScore > 0) {
        matches.push({
          score: choiceScore,
          rate: card.choiceRate,
          label: `${chosenDef.label} (your selected 3% category)`,
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
          label: `${def.label} (switch your 3% choice category to unlock)`,
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

function rankCards(query, cards) {
  const q = normalize(query);
  if (!q) return [];

  const results = cards.map((card) => {
    const match = bestCategoryForCard(card, q);
    const effPct = effectivePercent(match.rate, match.unit, card.pointValue);
    return {
      card,
      match,
      effectivePercent: effPct,
      confidence: match.isBase ? 0 : match.score,
    };
  });

  // Sort: prefer highest effective %, but break ties by confidence (specific category match wins over base)
  results.sort((a, b) => {
    if (Math.abs(b.effectivePercent - a.effectivePercent) > 0.01) {
      return b.effectivePercent - a.effectivePercent;
    }
    return b.confidence - a.confidence;
  });

  return results;
}
