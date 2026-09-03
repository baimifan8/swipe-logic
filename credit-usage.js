// Per-period tracking of which statement credits you've already spent.
//
// A credit is only worth routing a purchase to while it still has room left, so
// the app has to know what you've used this month. That's per-person knowledge,
// so it lives in this browser's localStorage next to the wallet — never sent to
// the server, never part of a shared link.
//
// Storage is keyed by period, not by date: an entry recorded in 2026-09 stops
// matching the moment the calendar rolls into 2026-10, so credits reset on their
// own with no cron, no cleanup pass and no clock the app has to trust beyond the
// device's own. Stale entries are pruned on load.
//
//   { v: 1, entries: { "amex-gold::uber-cash": { period: "2026-09", cadence: "month", used: 10 } } }

const CreditUsage = (function () {
  'use strict';

  const KEY = 'swipe-logic-credit-usage-v1';
  const VERSION = 1;

  let state = { v: VERSION, entries: {} };

  const slug = (s) =>
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function creditKey(cardId, credit) {
    return `${cardId}::${slug(credit.label)}`;
  }

  // The period a credit currently sits in. Everything downstream compares these
  // strings — no date arithmetic at read time.
  function periodKey(cadence, date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-11
    switch (cadence) {
      case 'month': return `${y}-${String(m + 1).padStart(2, '0')}`;
      case 'quarter': return `${y}-Q${Math.floor(m / 3) + 1}`;
      case 'half': return `${y}-H${m < 6 ? 1 : 2}`;
      case 'year': return `${y}`;
      default: return `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  }

  // When the current period rolls over, i.e. when this credit comes back.
  function resetsOn(cadence, date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    switch (cadence) {
      case 'month': return new Date(y, m + 1, 1);
      case 'quarter': return new Date(y, (Math.floor(m / 3) + 1) * 3, 1);
      case 'half': return new Date(y, m < 6 ? 6 : 12, 1);
      case 'year': return new Date(y + 1, 0, 1);
      default: return new Date(y, m + 1, 1);
    }
  }

  function resetLabel(credit) {
    return resetsOn(credit.cadence).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Dollars available per period. Credits with a varying amount (a monthly
  // DoorDash promo) have no allowance — they can still be marked used, they just
  // can't show a remaining balance.
  function allowance(credit) {
    if (typeof credit.amount === 'number') return credit.amount;
    if (typeof credit.annual === 'number' && credit.cadence === 'year') return credit.annual;
    return null;
  }

  function load() {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      parsed = null; // unreadable or storage blocked — start clean rather than throw
    }
    const entries = {};
    if (parsed && parsed.entries && typeof parsed.entries === 'object') {
      for (const [k, entry] of Object.entries(parsed.entries)) {
        if (!entry || typeof entry !== 'object') continue;
        // Prune anything from a period that has already rolled over.
        if (entry.period !== periodKey(entry.cadence)) continue;
        entries[k] = {
          period: entry.period,
          cadence: entry.cadence,
          used: Number(entry.used) || 0,
        };
      }
    }
    state = { v: VERSION, entries };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* private mode or a full quota — tracking degrades to this session only */
    }
  }

  function used(cardId, credit) {
    const entry = state.entries[creditKey(cardId, credit)];
    if (!entry || entry.period !== periodKey(credit.cadence)) return 0;
    return entry.used;
  }

  function remaining(cardId, credit) {
    const total = allowance(credit);
    if (total === null) return null;
    return Math.max(0, total - used(cardId, credit));
  }

  // A credit with no known allowance counts as spent once it's marked at all.
  function isSpent(cardId, credit) {
    const total = allowance(credit);
    const u = used(cardId, credit);
    return total === null ? u > 0 : u >= total;
  }

  function setUsed(cardId, credit, dollars) {
    const key = creditKey(cardId, credit);
    const total = allowance(credit);
    let value = Number(dollars);
    if (!Number.isFinite(value) || value <= 0) {
      delete state.entries[key];
      save();
      return 0;
    }
    if (total !== null) value = Math.min(value, total);
    state.entries[key] = { period: periodKey(credit.cadence), cadence: credit.cadence, used: value };
    save();
    return value;
  }

  // Toggle used <-> unused. The whole allowance for credits that have one, and a
  // plain "yes I used it" flag for the ones that don't.
  function toggle(cardId, credit) {
    if (isSpent(cardId, credit)) return setUsed(cardId, credit, 0);
    return setUsed(cardId, credit, allowance(credit) ?? 1);
  }

  function clearAll() {
    state = { v: VERSION, entries: {} };
    save();
  }

  load();

  return {
    creditKey, periodKey, resetsOn, resetLabel, allowance,
    used, remaining, isSpent, setUsed, toggle, clearAll, reload: load,
  };
})();
