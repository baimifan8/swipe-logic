(function () {
  'use strict';

  // ---------- State ----------
  // Persistence strategy: each device/browser keeps its own wallet.
  //  1. A shared link with a URL hash (base64 JSON) always wins on first load —
  //     this lets someone send a specific wallet snapshot to another device.
  //  2. Otherwise, this browser's own localStorage is used, so reopening the
  //     plain link later remembers this device's cards automatically.
  //  3. If neither exists (first-ever visit, no shared link), the wallet starts
  //     completely empty — nobody inherits anyone else's default cards.
  const STORAGE_KEY = 'swipe-logic-wallet-v1';
  let cards = [];
  let enabled = {}; // id -> bool
  let $addCardSearch = null; // live reference to the add-card search input, re-queried each render
  let addCardSearchTerm = ''; // persisted across re-renders so typing survives DOM rebuilds

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

  function loadStateFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    const payload = { cards, enabled };
    try {
      const json = JSON.stringify(payload);
      const b64 = btoa(unescape(encodeURIComponent(json)));
      history.replaceState(null, '', '#' + b64);
    } catch (e) {
      /* ignore quota / encoding issues */
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      /* localStorage unavailable (private browsing, quota, etc.) — hash still works */
    }
  }

  function init() {
    const fromHash = loadStateFromHash();
    const fromStorage = loadStateFromStorage();
    const saved = (fromHash && Array.isArray(fromHash.cards)) ? fromHash : fromStorage;
    if (saved && Array.isArray(saved.cards)) {
      cards = saved.cards;
      enabled = saved.enabled || {};
    } else {
      cards = [];
      enabled = {};
    }
    // ensure any pre-existing cards without an enabled flag default to visible
    cards.forEach((c) => {
      if (!(c.id in enabled)) enabled[c.id] = true;
    });
    // if we loaded from a shared link's hash, mirror it into this device's
    // own storage right away so a plain reload later keeps the same wallet
    if (saved === fromHash && fromHash) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards, enabled }));
      } catch (e) {
        /* ignore */
      }
    }
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

    const walletIds = new Set(cards.map((c) => c.id));
    const addableCatalog = CARD_CATALOG.filter((c) => !walletIds.has(c.id));
    const query = normalizeAddSearch(addCardSearchTerm);
    const filteredAddable = query
      ? addableCatalog.filter((c) => c.name.toLowerCase().includes(query) || c.network.toLowerCase().includes(query))
      : addableCatalog;

    const addListHtml = filteredAddable.length
      ? filteredAddable.map((card) => `
          <button type="button" class="add-card-row" data-add="${card.id}">
            <span class="name"><span class="swatch-mini" style="background:${card.color}"></span>${escapeHtml(card.name)}${card.businessCard ? '<span class="badge-business">Business</span>' : ''}</span>
            <span class="add-icon" aria-hidden="true">+</span>
          </button>`).join('')
      : `<p class="add-empty">${cards.length ? 'No matching cards — try a different search.' : 'No cards left to add.'}</p>`;

    $cardSettingsList.innerHTML = `
      <div class="wallet-section">
        <h3 class="settings-subhead">In your wallet (${cards.length})</h3>
        ${cards.length ? walletHtml : '<p class="add-empty">No cards yet — add one below.</p>'}
      </div>
      <div class="add-card-section">
        <h3 class="settings-subhead">Add a card</h3>
        <input type="text" id="addCardSearch" class="add-card-search" placeholder="Search by card name or network…" value="${escapeHtml(addCardSearchTerm)}" />
        <div class="add-card-list">${addListHtml}</div>
      </div>`;

    $addCardSearch = document.getElementById('addCardSearch');

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
        const template = CARD_CATALOG.find((c) => c.id === id);
        if (template && !cards.some((c) => c.id === id)) {
          cards.push(JSON.parse(JSON.stringify(template)));
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
    if (!cards.length) return;
    const ok = window.confirm('Remove all cards from your wallet on this device?');
    if (!ok) return;
    cards = [];
    enabled = {};
    saveState();
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
