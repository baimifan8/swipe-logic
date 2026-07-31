(function () {
  'use strict';

  // ---------- State ----------
  // Persistence strategy: sandboxed previews block localStorage, so state lives
  // in memory + is mirrored into the URL hash (base64 JSON). Once installed to
  // homescreen / bookmarked, the hash round-trips and settings survive reloads.
  let cards = [];
  let enabled = {}; // id -> bool

  function loadStateFromHash() {
    try {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) return null;
      const json = decodeURIComponent(escape(atob(hash)));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function saveStateToHash() {
    try {
      const payload = JSON.stringify({ cards, enabled });
      const b64 = btoa(unescape(encodeURIComponent(payload)));
      history.replaceState(null, '', '#' + b64);
    } catch (e) {
      /* ignore quota / encoding issues */
    }
  }

  function init() {
    const saved = loadStateFromHash();
    if (saved && Array.isArray(saved.cards) && saved.cards.length) {
      cards = saved.cards;
      enabled = saved.enabled || {};
    } else {
      cards = cloneDefaults();
      enabled = {};
      cards.forEach((c) => (enabled[c.id] = true));
    }
    // ensure any newly-added default cards (future app updates) get an enabled flag
    cards.forEach((c) => {
      if (!(c.id in enabled)) enabled[c.id] = true;
    });
  }

  function activeCards() {
    return cards.filter((c) => enabled[c.id] !== false);
  }

  // ---------- DOM refs ----------
  const $query = document.getElementById('query');
  const $clear = document.getElementById('clearQuery');
  const $resultsWrap = document.getElementById('resultsWrap');
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
    $resultsWrap.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <p>Start typing a merchant, item, or category — like "Whole Foods" or "gas station" — and I'll tell you which card to pull out.</p>
      </div>`;
  }

  function renderNoCards() {
    $resultsWrap.innerHTML = `
      <div class="empty-state">
        <p>No cards enabled. Tap the settings icon above to turn on at least one card.</p>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderResults(query) {
    if (!query.trim()) return renderEmpty();
    const list = activeCards();
    if (!list.length) return renderNoCards();

    const ranked = rankCards(query, list);
    if (!ranked.length) return renderEmpty();

    const html = ranked.map((r, i) => {
      const { card, match, effectivePercent: eff } = r;
      const isBest = i === 0;
      const rateDisplay = card.unit === '%' ? pct(match.rate) : `${match.rate}x`;
      const fallbackTag = match.isBase
        ? `<div class="result-fallback-tag">No specific category matched — showing base rate</div>`
        : '';
      const switchHint = match.switchSuggestion
        ? `<div class="switch-hint">Switch your BofA choice category to <strong>${escapeHtml(match.switchSuggestion.switchTargetLabel)}</strong> to earn ${pct(match.switchSuggestion.rate)} here instead.</div>`
        : '';
      return `
        <article class="result-card ${isBest ? 'best' : ''}">
          <div class="result-top">
            <div class="result-identity">
              <div class="card-swatch" style="background:${card.color}"></div>
              <div>
                <div class="result-name">${escapeHtml(card.name)}</div>
                <div class="result-network">${escapeHtml(card.network)}</div>
              </div>
            </div>
            <div class="result-rate">
              <div class="rate-number">${rateDisplay}</div>
              <div class="rate-unit">${unitLabel(card, match)}</div>
            </div>
          </div>
          ${fallbackTag}
          <div class="result-category">
            <span class="cat-label">${escapeHtml(match.label)}</span>
            ${match.cap ? `<span class="cat-cap">Cap: ${escapeHtml(match.cap)}</span>` : ''}
          </div>
          ${switchHint}
          ${card.notes && isBest ? `<div class="result-note">${escapeHtml(card.notes)}</div>` : ''}
        </article>`;
    }).join('');

    $resultsWrap.innerHTML = `<div class="results">${html}</div>`;
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
    renderResults(v);
  }

  // ---------- Settings sheet ----------
  function openSheet() {
    renderCardSettings();
    $sheetOverlay.classList.add('open');
    $sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $sheetOverlay.classList.remove('open');
    $sheet.classList.remove('open');
    document.body.style.overflow = '';
    saveStateToHash();
    onQueryChange();
  }

  function choiceCategoryLabel(key, defs) {
    return defs[key] ? defs[key].label : key;
  }

  function renderCardSettings() {
    $cardSettingsList.innerHTML = cards.map((card) => {
      const isOn = enabled[card.id] !== false;
      const choiceSelect = card.editableChoiceCategory ? `
        <div class="field-row">
          <label for="choice-${card.id}">3% choice category (assumes it's set to match your purchase)</label>
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
          <div class="settings-card-head">
            <div class="name"><span class="swatch-mini" style="background:${card.color}"></span>${escapeHtml(card.name)}</div>
            <button class="toggle-visibility" data-toggle="${card.id}" aria-label="${isOn ? 'Disable' : 'Enable'} ${escapeHtml(card.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                ${isOn
                  ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>'
                  : '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a21.4 21.4 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>'}
              </svg>
            </button>
          </div>
          ${choiceSelect}
          ${nfcuTierSelect}
        </div>`;
    }).join('');

    // wire toggle buttons
    $cardSettingsList.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-toggle');
        enabled[id] = enabled[id] === false ? true : false;
        renderCardSettings();
      });
    });
    // wire BofA choice category selects
    $cardSettingsList.querySelectorAll('.choice-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-card');
        const card = cards.find((c) => c.id === id);
        if (card) card.choiceCategory = sel.value;
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
        }
      });
    });
  }

  // ---------- Events ----------
  $query.addEventListener('input', onQueryChange);
  $clear.addEventListener('click', () => {
    $query.value = '';
    onQueryChange();
    $query.focus();
  });
  $openSettings.addEventListener('click', openSheet);
  $closeSettings.addEventListener('click', closeSheet);
  $doneSettings.addEventListener('click', closeSheet);
  $sheetOverlay.addEventListener('click', closeSheet);
  $resetDefaults.addEventListener('click', () => {
    cards = cloneDefaults();
    enabled = {};
    cards.forEach((c) => (enabled[c.id] = true));
    renderCardSettings();
  });
  $dismissInstallHint.addEventListener('click', () => {
    $installHint.classList.add('dismissed');
  });

  // ---------- Boot ----------
  init();
  renderChips();
  renderEmpty();

  // Register a minimal service worker for installability + offline shell (best-effort; ignore failures)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
