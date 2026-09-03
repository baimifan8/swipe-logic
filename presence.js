// Live session counter. Talks to the optional self-hosted server (server.js);
// when the app is served as plain static files there is no /api/session
// endpoint, so the badge stays hidden and polling stops after the first miss.
(function () {
  'use strict';

  // 15s, not 30: this doubles as how quickly the badge notices someone else
  // arriving or leaving, and at 30 the number sat still long enough to look
  // broken. Requests scale with actual use — this is a look-something-up app,
  // not one people leave open — so a session costs a handful of beats.
  const HEARTBEAT_MS = 15 * 1000;
  const SID_KEY = 'swipe-logic-sid';
  const $badge = document.getElementById('presence');
  if (!$badge) return;

  function sessionId() {
    try {
      let id = sessionStorage.getItem(SID_KEY);
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
          .replace(/[^A-Za-z0-9_-]/g, '');
        sessionStorage.setItem(SID_KEY, id);
      }
      return id;
    } catch (e) {
      return String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    }
  }

  const id = sessionId();
  let timer = null;

  function render(stats) {
    const people = stats.active === 1 ? 'person' : 'people';
    $badge.innerHTML =
      '<span class="presence-dot" aria-hidden="true"></span>' +
      `<span>${stats.active} here now</span>`;
    $badge.title = `${stats.active} ${people} using this right now · ${stats.today} today · ${stats.allTime} sessions all time`;
    $badge.hidden = false;
  }

  function stop() {
    $badge.hidden = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function beat() {
    try {
      const res = await fetch('./api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return stop();
      render(await res.json());
    } catch (e) {
      stop();
    }
  }

  beat();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') beat();
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timer) beat();
  });
})();
