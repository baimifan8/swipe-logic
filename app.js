(function () {
  'use strict';

  // Captured here because document.currentScript is only valid while this file
  // is executing synchronously — by the time anything renders, it's null.
  const THIS_SCRIPT = document.currentScript;

  // ---------- State ----------
  // Persistence strategy: each device/browser keeps its own wallet.
  //  1. A shared link with a URL hash (base64 JSON) always wins on first load —
  //     this lets someone send a specific wallet snapshot to another device.
  //  2. Otherwise, this browser's own localStorage is used, so reopening the
  //     plain link later remembers this device's cards automatically.
  //  3. If neither exists (first-ever visit, no shared link), the wallet starts
  //     completely empty — nobody inherits anyone else's default cards.
  //
  // What gets stored is only a reference per card — its catalog id plus any
  // setting the owner changed by hand. The card's rates, categories and notes
  // are rehydrated from CARD_CATALOG on every load, so updating this app with
  // new or corrected card data reaches existing wallets instead of leaving
  // people on a stale snapshot, and no update path ever has to clear storage.
  // v1 payloads (whole card objects) are migrated in place on first load.
  const STORAGE_KEY = 'swipe-logic-wallet-v1';
  const SCHEMA_VERSION = 2;
  const CATALOG_BY_ID = Object.fromEntries(CARD_CATALOG.map((c) => [c.id, c]));
  let cards = [];
  let enabled = {}; // id -> bool
  let orphanRefs = []; // saved cards whose id is not in this build's catalog — kept so a later build can restore them
  let $addCardSearch = null; // live reference to the add-card search input, re-queried each render
  let addCardSearchTerm = ''; // persisted across re-renders so typing survives DOM rebuilds
  let addCardIssuerFilter = ''; // '' = all issuers; otherwise an exact issuer string from CARD_CATALOG

  function cardToRef(card) {
    const template = CATALOG_BY_ID[card.id];
    const ref = { id: card.id };
    if (template && card.choiceCategory && card.choiceCategory !== template.choiceCategory) {
      ref.choiceCategory = card.choiceCategory;
    }
    if (template && template.base && card.base && card.base.rate !== template.base.rate) {
      ref.baseRate = card.base.rate;
    }
    return ref;
  }

  function refToCard(ref) {
    const template = CATALOG_BY_ID[ref.id];
    if (!template) return null;
    const card = JSON.parse(JSON.stringify(template));
    const options = card.choiceCategoryOptions || [];
    if (ref.choiceCategory && options.includes(ref.choiceCategory)) {
      card.choiceCategory = ref.choiceCategory;
    }
    if (typeof ref.baseRate === 'number' && card.base) {
      card.base.rate = ref.baseRate;
    }
    return card;
  }

  // Accepts both the current ref format and v1 payloads that stored whole card objects.
  function toRefs(savedCards) {
    return savedCards
      .filter((c) => c && typeof c.id === 'string')
      .map((c) => {
        if (c.categories || c.base || c.name) return cardToRef(c); // v1 snapshot
        return c;
      });
  }

  function decodePayload(str) {
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(str))));
      return parsed && Array.isArray(parsed.cards) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function loadStateFromHash() {
    const hash = window.location.hash.replace(/^#/, '');
    return hash ? decodePayload(hash) : null;
  }

  function loadStateFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.cards) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function currentPayload() {
    return { v: SCHEMA_VERSION, cards: cards.map(cardToRef).concat(orphanRefs), enabled };
  }

  function saveState() {
    const json = JSON.stringify(currentPayload());
    try {
      history.replaceState(null, '', '#' + btoa(unescape(encodeURIComponent(json))));
    } catch (e) {
      /* ignore quota / encoding issues */
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      /* localStorage unavailable (private browsing, quota, etc.) — hash still works */
    }
  }

  function init() {
    const fromHash = loadStateFromHash();
    const saved = fromHash || loadStateFromStorage();
    if (!saved) return;

    const refs = toRefs(saved.cards);
    enabled = saved.enabled || {};
    cards = [];
    orphanRefs = [];
    refs.forEach((ref) => {
      const card = refToCard(ref);
      if (card) cards.push(card);
      else orphanRefs.push(ref);
    });
    // ensure any pre-existing cards without an enabled flag default to visible
    cards.forEach((c) => {
      if (!(c.id in enabled)) enabled[c.id] = true;
    });
    // Rewrite storage in the current schema right away: migrates v1 payloads and,
    // when the wallet came from a shared link, mirrors it onto this device so a
    // plain reload later keeps the same cards.
    saveState();
  }

  // The build stamp in the footer. It reads this script's own ?v=, which
  // `npm run release` bumps, so what's on screen is necessarily the build that's
  // actually loaded rather than a number someone remembered to update.
  function renderVersion() {
    const $version = document.getElementById('appVersion');
    if (!$version) return;
    let v = '';
    try {
      v = new URL(THIS_SCRIPT.src).searchParams.get('v') || '';
    } catch (e) {
      v = ''; // opened straight off the filesystem, or no query string
    }
    if (!v) return;
    $version.textContent = `v${v}`;
    $version.hidden = false;
  }

  function activeCards() {
    return cards.filter((c) => enabled[c.id] !== false);
  }

  // ---------- DOM refs ----------
  const $query = document.getElementById('query');
  const $clear = document.getElementById('clearQuery');
  const $send = document.getElementById('submitQuery');
  const $resultsWrap = document.getElementById('resultsWrap');
  const $amount = document.getElementById('amount');
  const $chips = document.getElementById('chips');
  const $openSettings = document.getElementById('openSettings');
  const $closeSettings = document.getElementById('closeSettings');
  const $doneSettings = document.getElementById('doneSettings');
  const $sheetOverlay = document.getElementById('sheetOverlay');
  const $sheet = document.getElementById('settingsSheet');
  const $cardSettingsList = document.getElementById('cardSettingsList');
  const $resetDefaults = document.getElementById('resetDefaults');
  const $installHint = document.getElementById('installHint');
  const $dismissInstallHint = document.getElementById('dismissInstallHint');

  const EXAMPLE_CHIPS = ['Whole Foods', 'Delta flight', 'Hilton hotel', 'Netflix', 'Gas station', 'Amazon order', 'Uber ride', 'CVS'];

  // ---------- Rendering: results ----------
  function pct(n) {
    // trim trailing .0
    const r = Math.round(n * 100) / 100;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(2).replace(/0$/, '')) + '%';
  }

  function unitLabel(card, match) {
    if (card.unit === '%') return 'cash back';
    return `pts/$ · ~${pct(match.rate * card.pointValue)} value`;
  }

  function renderEmpty() {
    if (!cards.length) return renderNoCards();
    $resultsWrap.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <p>Start typing a merchant, item, or category — like "Whole Foods" or "gas station" — and I'll tell you which card to pull out.</p>
      </div>`;
  }

  function renderNoCards() {
    const hasDisabledCards = cards.length > 0;
    $resultsWrap.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="6" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>
        </svg>
        <p>${hasDisabledCards
          ? 'No cards enabled. Tap the settings icon above to turn on at least one card.'
          : 'Your wallet is empty on this device. Tap the settings icon above to add the cards you actually carry.'}</p>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ANSWER_MARK = `
    <svg class="answer-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2c.5 0 .9.4.9.9v5.3l3.4-3.4a.9.9 0 1 1 1.3 1.3l-3.4 3.4h5.3a.9.9 0 0 1 0 1.8h-5.3l3.4 3.4a.9.9 0 1 1-1.3 1.3l-3.4-3.4v5.3a.9.9 0 0 1-1.8 0v-5.3l-3.4 3.4a.9.9 0 0 1-1.3-1.3l3.4-3.4H4.5a.9.9 0 0 1 0-1.8h5.3L6.4 6.3a.9.9 0 0 1 1.3-1.3l3.4 3.4V3.1c0-.5.4-.9.9-.9z"/>
    </svg>`;

  const CADENCE_LABEL = { month: 'a month', quarter: 'a quarter', half: 'twice a year', year: 'a year' };

  function money(n) {
    return `$${n.toFixed(2)}`;
  }

  // The optional purchase amount. Anything unparseable reads as "not given",
  // which puts ranking back on rates alone rather than guessing a number.
  function currentAmount() {
    const raw = ($amount.value || '').trim();
    // A negative reads as "not a purchase amount" rather than being stripped down
    // to its digits — silently costing "-5" into a $5 calculation would be worse
    // than ignoring it.
    if (!raw || raw.includes('-')) return null;
    const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // "$10 a month" when the per-period amount is known, otherwise the annual total.
  function creditAmount(credit) {
    if (typeof credit.amount === 'number') return `$${credit.amount} ${CADENCE_LABEL[credit.cadence] || ''}`.trim();
    if (typeof credit.annual === 'number') return `$${credit.annual} a year`;
    return 'Statement credit';
  }

  // "$10 left of $10 · resets Oct 1", or a plain reset note when the credit has
  // no fixed amount to count down.
  function creditStatus(cardId, credit) {
    const total = CreditUsage.allowance(credit);
    const left = CreditUsage.remaining(cardId, credit);
    const resets = CreditUsage.resetLabel(credit);
    if (total === null) {
      return CreditUsage.isSpent(cardId, credit) ? `Used · resets ${resets}` : `Resets ${resets}`;
    }
    if (left === 0) return `Used up · resets ${resets}`;
    if (left < total) return `$${left} left of $${total} · resets ${resets}`;
    return `Unused · resets ${resets}`;
  }

  function creditsBlock(cardId, credits, showNotes) {
    if (!credits || !credits.length) return '';
    const rows = credits.map((c) => {
      const spent = CreditUsage.isSpent(cardId, c);
      return `
      <div class="credit-row ${spent ? 'spent' : ''}">
        <span class="credit-amount">${escapeHtml(creditAmount(c))}</span>
        <span class="credit-label">${escapeHtml(c.label)}${c.enroll ? '<span class="credit-enroll" title="Does nothing until you enroll in the issuer app">enroll</span>' : ''}</span>
        <button type="button" class="credit-toggle" data-credit-card="${escapeHtml(cardId)}" data-credit-label="${escapeHtml(c.label)}" aria-pressed="${spent}">${spent ? 'Mark unused' : 'Mark used'}</button>
        <span class="credit-status">${escapeHtml(creditStatus(cardId, c))}</span>
        ${showNotes && c.note ? `<span class="credit-note">${escapeHtml(c.note)}</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="result-credits">${rows}</div>`;
  }

  // Find a credit object back from the data attributes on a rendered row.
  function findCredit(cardId, label) {
    const card = CATALOG_BY_ID[cardId];
    return card && card.credits ? card.credits.find((c) => c.label === label) : null;
  }

  function answerLine(ranked) {
    const top = ranked[0];
    const { card, match } = top;
    const rate = card.unit === '%' ? pct(match.rate) : `${match.rate}x`;
    const name = `<strong>${escapeHtml(card.name)}</strong>`;
    const rateHtml = `<span class="answer-rate">${rate}</span>`;
    const body = match.isBase
      ? `Nothing in your wallet has a bonus category for that — ${name} is the best of the flat rates at ${rateHtml}.`
      : `Use your ${name} — ${rateHtml} on ${escapeHtml(match.label.replace(/\s*\(.*\)\s*$/, ''))}.`;

    // A credit can outweigh the rate on a small purchase, so it goes in the
    // headline: on the winning card if it has one, otherwise on whichever card
    // in the wallet does. Credits already spent this period are left out — the
    // whole point of tracking them is to stop being told about money that's gone.
    let creditHtml = '';
    if (top.liveCredits.length) {
      const c = top.liveCredits[0];
      const left = CreditUsage.remaining(top.card.id, c);
      const amount = left !== null && left < CreditUsage.allowance(c) ? `$${left} left of its` : 'its';
      creditHtml = `<p class="answer-credit">Stacks with ${amount} <strong>${escapeHtml(creditAmount(c))} ${escapeHtml(c.label)}</strong>${c.enroll ? ' (enroll first)' : ''}.</p>`;
    } else if (!top.value) {
      // Without an amount this is a genuine "you might be leaving money on the
      // table" nudge. With one, the ranking has already weighed that credit in
      // dollars and put this card on top anyway, so repeating the nudge would
      // contradict the math directly below it.
      const other = ranked.slice(1).find((r) => r.liveCredits.length);
      if (other) {
        const c = other.liveCredits[0];
        const left = CreditUsage.remaining(other.card.id, c);
        const amount = left !== null ? `$${left}` : 'a';
        creditHtml = `<p class="answer-credit">Your <strong>${escapeHtml(other.card.short || other.card.name)}</strong> still has ${escapeHtml(amount)} of its ${escapeHtml(c.label)} — on a small purchase that beats the rate difference.</p>`;
      }
    }
    // With an amount, say what the choice is actually worth — this is the line
    // that justifies a credit outranking a better multiplier.
    let valueHtml = '';
    if (top.value) {
      const amount = currentAmount();
      const parts = [];
      if (top.value.credits > 0) parts.push(`${money(top.value.credits)} of credit`);
      parts.push(`${money(top.value.rewards)} in ${card.unit === '%' ? 'cash back' : 'points'}`);
      const runnerUp = ranked[1];
      const edge = runnerUp ? top.value.total - runnerUp.value.total : 0;
      const versus = runnerUp && edge > 0.005
        ? ` — ${money(edge)} more than your ${escapeHtml(runnerUp.card.short || runnerUp.card.name)}`
        : '';
      valueHtml = `<p class="answer-value">On ${money(amount)}: <strong>${money(top.value.total)} back</strong> (${parts.join(' + ')})${versus}.</p>`;
    }

    return `<div class="answer">${ANSWER_MARK}<div><p class="answer-text">${body}</p>${creditHtml}${valueHtml}</div></div>`;
  }

  function renderResults(query) {
    if (!query.trim()) return renderEmpty();
    const list = activeCards();
    if (!list.length) return renderNoCards();

    const ranked = rankCards(query, list, {
      isCreditLive: (card, credit) => !CreditUsage.isSpent(card.id, credit),
      creditRemaining: (card, credit) => CreditUsage.remaining(card.id, credit),
      amount: currentAmount(),
    });
    if (!ranked.length) return renderEmpty();

    const html = ranked.map((r, i) => {
      const { card, match, effectivePercent: eff } = r;
      const isBest = i === 0;
      const rateDisplay = card.unit === '%' ? pct(match.rate) : `${match.rate}x`;
      const fallbackTag = match.isBase
        ? `<div class="result-fallback-tag">No specific category matched — showing base rate</div>`
        : '';
      const switchHint = match.switchSuggestion
        ? `<div class="switch-hint">Switch your ${escapeHtml(card.short || card.name)} choice category to <strong>${escapeHtml(match.switchSuggestion.switchTargetLabel)}</strong> to earn ${pct(match.switchSuggestion.rate)} here instead.</div>`
        : '';
      return `
        <article class="result-card ${isBest ? 'best' : ''}">
          <div class="result-top">
            <div class="result-identity">
              <div class="card-swatch" style="background:${card.color}"></div>
              <div>
                <div class="result-name">${escapeHtml(card.name)}${card.businessCard ? '<span class="badge-business">Business</span>' : ''}</div>
                <div class="result-network">${escapeHtml(card.network)}</div>
              </div>
            </div>
            <div class="result-rate">
              <div class="rate-number">${rateDisplay}</div>
              <div class="rate-unit">${unitLabel(card, match)}</div>
              ${r.value ? `<div class="rate-value" title="${r.value.credits > 0 ? `${money(r.value.credits)} credit + ${money(r.value.rewards)} earned` : 'Rewards on this purchase'}">${money(r.value.total)} back</div>` : ''}
            </div>
          </div>
          ${fallbackTag}
          <div class="result-category">
            <span class="cat-label">${escapeHtml(match.label)}</span>
            ${match.cap ? `<span class="cat-cap">Cap: ${escapeHtml(match.cap)}</span>` : ''}
          </div>
          ${creditsBlock(card.id, r.credits, isBest)}
          ${switchHint}
          ${card.notes && isBest ? `<div class="result-note">${escapeHtml(card.notes)}</div>` : ''}
        </article>`;
    }).join('');

    $resultsWrap.innerHTML = `${answerLine(ranked)}<div class="results">${html}</div>`;
  }

  function renderChips() {
    $chips.innerHTML = EXAMPLE_CHIPS.map((c) => `<button class="chip" role="listitem" type="button">${escapeHtml(c)}</button>`).join('');
    $chips.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        $query.value = btn.textContent;
        onQueryChange();
        $query.focus();
      });
    });
  }

  function onQueryChange() {
    const v = $query.value;
    $clear.classList.toggle('visible', v.length > 0);
    $send.disabled = v.trim().length === 0;
    renderResults(v);
  }

  // ---------- Settings sheet ----------
  function openSheet() {
    addCardSearchTerm = '';
    renderCardSettings();
    $sheetOverlay.classList.add('open');
    $sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $sheetOverlay.classList.remove('open');
    $sheet.classList.remove('open');
    document.body.style.overflow = '';
    saveState();
    onQueryChange();
  }

  function choiceCategoryLabel(key, defs) {
    return defs[key] ? defs[key].label : key;
  }

  function renderCardSettings() {
    // Capture focus state of the add-card search input before we blow away the DOM.
    const prevInput = document.getElementById('addCardSearch');
    const wasSearchFocused = !!prevInput && document.activeElement === prevInput;
    const caretPos = wasSearchFocused ? prevInput.selectionStart : 0;

    const walletHtml = cards.map((card) => {
      const isOn = enabled[card.id] !== false;
      const choiceSelect = card.editableChoiceCategory ? `
        <div class="field-row">
          <label for="choice-${card.id}">Bonus category (assumes it's set to match your purchase)</label>
          <select id="choice-${card.id}" data-card="${card.id}" class="choice-select">
            ${card.choiceCategoryOptions.map((k) => `<option value="${k}" ${card.choiceCategory === k ? 'selected' : ''}>${escapeHtml(choiceCategoryLabel(k, card.categoryDefinitions))}</option>`).join('')}
          </select>
        </div>` : '';

      const nfcuTierSelect = card.id === 'nfcu' ? `
        <div class="field-row">
          <label for="nfcu-tier">Your NFCU tier</label>
          <select id="nfcu-tier" data-card="${card.id}" class="nfcu-tier-select">
            <option value="1.5" ${card.base.rate === 1.5 ? 'selected' : ''}>cashRewards — 1.5% flat</option>
            <option value="2" ${card.base.rate === 2 ? 'selected' : ''}>cashRewards Plus — 2% flat</option>
          </select>
        </div>` : '';

      return `
        <div class="settings-card ${isOn ? '' : 'disabled'}" data-card-block="${card.id}">
          <button type="button" class="settings-card-head" data-toggle="${card.id}" role="switch" aria-checked="${isOn}" aria-label="${escapeHtml(card.name)}, ${isOn ? 'included in results' : 'hidden from results'}">
            <div class="name"><span class="swatch-mini" style="background:${card.color}"></span>${escapeHtml(card.name)}${card.businessCard ? '<span class="badge-business">Business</span>' : ''}</div>
            <span class="toggle-visibility" aria-hidden="true"></span>
          </button>
          ${choiceSelect}
          ${nfcuTierSelect}
          <button type="button" class="remove-card-btn" data-remove="${card.id}" aria-label="Remove ${escapeHtml(card.name)} from your wallet">Remove card</button>
        </div>`;
    }).join('');

    // Credits panel: every credit in the wallet with what's left of it this
    // period. This is the "what am I leaving on the table" view, and the place
    // to log a partial amount — the result cards only do the fast used/unused tap.
    const CADENCE_ORDER = { month: 0, quarter: 1, half: 2, year: 3 };
    const creditRows = [];
    for (const card of cards) {
      for (const credit of card.credits || []) creditRows.push({ card, credit });
    }
    creditRows.sort((a, b) =>
      (CADENCE_ORDER[a.credit.cadence] ?? 9) - (CADENCE_ORDER[b.credit.cadence] ?? 9) ||
      a.card.name.localeCompare(b.card.name));

    let creditsSectionHtml = '';
    if (creditRows.length) {
      let leftSum = 0;
      let totalSum = 0;
      for (const { card, credit } of creditRows) {
        const total = CreditUsage.allowance(credit);
        if (total !== null) {
          totalSum += total;
          leftSum += CreditUsage.remaining(card.id, credit);
        }
      }
      const rowsHtml = creditRows.map(({ card, credit }) => {
        const total = CreditUsage.allowance(credit);
        const usedNow = CreditUsage.used(card.id, credit);
        const spent = CreditUsage.isSpent(card.id, credit);
        const control = total === null
          ? `<button type="button" class="credit-manage-toggle" data-credit-card="${escapeHtml(card.id)}" data-credit-label="${escapeHtml(credit.label)}" aria-pressed="${spent}">${spent ? 'Mark unused' : 'Mark used'}</button>`
          : `<label class="credit-manage-input">
               <span>Used</span>
               <input type="number" inputmode="decimal" min="0" max="${total}" step="1" value="${usedNow}"
                      data-credit-card="${escapeHtml(card.id)}" data-credit-label="${escapeHtml(credit.label)}"
                      aria-label="Dollars used of ${escapeHtml(card.name)} ${escapeHtml(credit.label)}" />
               <span>of $${total}</span>
             </label>`;
        return `
          <div class="credit-manage-row ${spent ? 'spent' : ''}">
            <div class="credit-manage-head">
              <span class="swatch-mini" style="background:${card.color}"></span>
              <span class="credit-manage-name">${escapeHtml(card.short || card.name)} · ${escapeHtml(credit.label)}</span>
            </div>
            <div class="credit-manage-meta">${escapeHtml(creditAmount(credit))} · ${escapeHtml(creditStatus(card.id, credit))}</div>
            <div class="credit-manage-controls">${control}</div>
          </div>`;
      }).join('');

      creditsSectionHtml = `
        <div class="credits-section">
          <h3 class="settings-subhead">Credits (${totalSum ? `$${leftSum} of $${totalSum} left this period` : creditRows.length})</h3>
          <p class="credits-blurb">Tracked on this device only, and each one resets itself when its period rolls over.</p>
          ${rowsHtml}
        </div>`;
    }

    const walletIds = new Set(cards.map((c) => c.id));
    const addableCatalog = CARD_CATALOG.filter((c) => !walletIds.has(c.id));
    const issuers = [...new Set(addableCatalog.map((c) => c.issuer).filter(Boolean))].sort();
    const query = normalizeAddSearch(addCardSearchTerm);
    const hasFilter = !!query || !!addCardIssuerFilter;

    let filteredAddable = addableCatalog;
    if (addCardIssuerFilter) {
      filteredAddable = filteredAddable.filter((c) => c.issuer === addCardIssuerFilter);
    }
    if (query) {
      filteredAddable = filteredAddable.filter((c) =>
        c.name.toLowerCase().includes(query) ||
        c.network.toLowerCase().includes(query) ||
        (c.issuer || '').toLowerCase().includes(query)
      );
    }

    let addListHtml;
    if (!hasFilter) {
      addListHtml = `<p class="add-empty">Search by name, network, or pick an issuer above to browse cards.</p>`;
    } else if (filteredAddable.length) {
      addListHtml = filteredAddable.map((card) => `
          <button type="button" class="add-card-row" data-add="${card.id}">
            <span class="name"><span class="swatch-mini" style="background:${card.color}"></span>${escapeHtml(card.name)}${card.businessCard ? '<span class="badge-business">Business</span>' : ''}${card.cobranded ? '<span class="badge-cobrand">Co-brand</span>' : ''}</span>
            <span class="add-icon" aria-hidden="true">+</span>
          </button>`).join('');
    } else {
      addListHtml = `<p class="add-empty">${cards.length ? 'No matching cards — try a different search or issuer.' : 'No cards left to add.'}</p>`;
    }

    const issuerOptionsHtml = issuers.map((iss) => `<option value="${escapeHtml(iss)}" ${addCardIssuerFilter === iss ? 'selected' : ''}>${escapeHtml(iss)}</option>`).join('');

    $cardSettingsList.innerHTML = `
      <div class="wallet-section">
        <h3 class="settings-subhead">In your wallet (${cards.length})</h3>
        ${cards.length ? walletHtml : '<p class="add-empty">No cards yet — add one below.</p>'}
      </div>
      ${creditsSectionHtml}
      <div class="add-card-section">
        <h3 class="settings-subhead">Add a card</h3>
        <div class="add-card-controls">
          <input type="text" id="addCardSearch" class="add-card-search" placeholder="Search by card name…" value="${escapeHtml(addCardSearchTerm)}" />
          <select id="addCardIssuer" class="add-card-issuer-select" aria-label="Filter by issuer">
            <option value="">All issuers</option>
            ${issuerOptionsHtml}
          </select>
        </div>
        <div class="add-card-list">${addListHtml}</div>
      </div>`;

    // Credits panel: log a partial amount, or flip the ones with no fixed amount.
    $cardSettingsList.querySelectorAll('.credit-manage-input input').forEach((input) => {
      input.addEventListener('change', () => {
        const credit = findCredit(input.getAttribute('data-credit-card'), input.getAttribute('data-credit-label'));
        if (!credit) return;
        CreditUsage.setUsed(input.getAttribute('data-credit-card'), credit, input.value);
        renderCardSettings();
      });
    });
    $cardSettingsList.querySelectorAll('.credit-manage-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cardId = btn.getAttribute('data-credit-card');
        const credit = findCredit(cardId, btn.getAttribute('data-credit-label'));
        if (!credit) return;
        CreditUsage.toggle(cardId, credit);
        renderCardSettings();
      });
    });

    $addCardSearch = document.getElementById('addCardSearch');
    const $addCardIssuer = document.getElementById('addCardIssuer');
    if ($addCardIssuer) {
      $addCardIssuer.addEventListener('change', (e) => {
        addCardIssuerFilter = e.target.value;
        renderCardSettings();
      });
    }

    // wire toggle rows (whole row is tappable, not just a small icon)
    $cardSettingsList.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-toggle');
        enabled[id] = enabled[id] === false ? true : false;
        saveState();
        renderCardSettings();
      });
    });
    // wire remove buttons
    $cardSettingsList.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-remove');
        cards = cards.filter((c) => c.id !== id);
        delete enabled[id];
        saveState();
        renderCardSettings();
      });
    });
    // wire add buttons
    $cardSettingsList.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-add');
        const card = refToCard({ id });
        if (card && !cards.some((c) => c.id === id)) {
          cards.push(card);
          enabled[id] = true;
          saveState();
          renderCardSettings();
        }
      });
    });
    // wire add-card search — preserve focus + cursor position across re-renders
    if ($addCardSearch) {
      if (wasSearchFocused) {
        $addCardSearch.focus();
        $addCardSearch.setSelectionRange(caretPos, caretPos);
      }
      $addCardSearch.addEventListener('input', (e) => {
        addCardSearchTerm = e.target.value;
        renderCardSettings();
      });
    }
    // wire BofA/Discover/Flex/Cash+ choice category selects
    $cardSettingsList.querySelectorAll('.choice-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-card');
        const card = cards.find((c) => c.id === id);
        if (card) {
          card.choiceCategory = sel.value;
          saveState();
        }
      });
    });
    // wire NFCU tier select
    $cardSettingsList.querySelectorAll('.nfcu-tier-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-card');
        const card = cards.find((c) => c.id === id);
        if (card) {
          const rate = parseFloat(sel.value);
          card.base.rate = rate;
          saveState();
        }
      });
    });
  }

  function normalizeAddSearch(v) {
    return (v || '').toLowerCase().trim();
  }

  // ---------- Events ----------
  $query.addEventListener('input', onQueryChange);
  $amount.addEventListener('input', onQueryChange);
  // Credit rows are rebuilt on every keystroke, so the handler lives on the
  // container rather than on each button.
  $resultsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.credit-toggle');
    if (!btn) return;
    const cardId = btn.getAttribute('data-credit-card');
    const credit = findCredit(cardId, btn.getAttribute('data-credit-label'));
    if (!credit) return;
    CreditUsage.toggle(cardId, credit);
    renderResults($query.value);
  });
  $clear.addEventListener('click', () => {
    $query.value = '';
    onQueryChange();
    $query.focus();
  });
  // On phones the answer sits below the keyboard — dismiss it and jump to the result.
  $send.addEventListener('click', () => {
    $query.blur();
    $resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$send.disabled) $send.click();
  });
  $openSettings.addEventListener('click', openSheet);
  $closeSettings.addEventListener('click', closeSheet);
  $doneSettings.addEventListener('click', closeSheet);
  $sheetOverlay.addEventListener('click', closeSheet);
  $resetDefaults.addEventListener('click', () => {
    if (!cards.length) return;
    const ok = window.confirm('Remove all cards from your wallet on this device?');
    if (!ok) return;
    cards = [];
    enabled = {};
    orphanRefs = [];
    saveState();
    renderCardSettings();
  });
  $dismissInstallHint.addEventListener('click', () => {
    $installHint.classList.add('dismissed');
  });

  // ---------- Boot ----------
  init();
  renderVersion();
  renderChips();
  renderEmpty();

  // Register a minimal service worker for installability + offline shell (best-effort; ignore failures)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
