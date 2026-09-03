// Cloudflare Worker: serves the app's static files and answers the session
// counter's heartbeats. This is the deployed twin of server.js — same two
// endpoints, same 90-second active window, same "we only ever see an opaque
// per-tab id" promise.
//
//   /api/session  POST {"id": "..."}  -> { active, today, allTime }
//   /api/stats    GET                 -> { active, today, allTime }
//   everything else                   -> static assets (the ASSETS binding)
//
// Counts live in one Durable Object, so every visitor is counted against the
// same numbers no matter which Cloudflare location serves them. Wallets are
// never sent here: they stay in each browser's localStorage.

const ACTIVE_WINDOW_MS = 90 * 1000;
const MAX_TRACKED_IDS = 50000; // a day's unique ids; past this we still count, we just stop storing them
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const today = () => new Date().toISOString().slice(0, 10);

export class SessionCounter {
  constructor(state) {
    this.state = state;
    this.lastSeen = new Map(); // session id -> ms timestamp, memory only
    this.day = today();
    this.todayIds = new Set();
    this.allTime = 0;
    // Storage reads are async; block requests until the counters are loaded so
    // a heartbeat can't be answered with zeros right after the object wakes.
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get('stats');
      if (saved) {
        this.day = typeof saved.day === 'string' ? saved.day : today();
        this.todayIds = new Set(Array.isArray(saved.todayIds) ? saved.todayIds : []);
        this.allTime = Number(saved.allTime) || 0;
        // Who is currently here has to be stored, not just held in memory: a
        // Durable Object is evicted once it goes idle, and with traffic this
        // sparse the gap between two heartbeats is often enough to evict it. An
        // in-memory map meant every heartbeat woke a blank object and answered
        // "1 person here" — the count looked frozen no matter who else was on.
        if (Array.isArray(saved.seen)) this.lastSeen = new Map(saved.seen);
      }
      this.rollDay();
    });
  }

  rollDay() {
    const d = today();
    if (this.day !== d) {
      this.day = d;
      this.todayIds = new Set();
      return true;
    }
    return false;
  }

  save() {
    return this.state.storage.put('stats', {
      day: this.day,
      todayIds: [...this.todayIds],
      allTime: this.allTime,
      // Pruned in counts(), so this only ever holds sessions inside the active
      // window — it can't grow without bound.
      seen: [...this.lastSeen],
    });
  }

  counts() {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    for (const [id, seen] of this.lastSeen) {
      if (seen < cutoff) this.lastSeen.delete(id);
    }
    return { active: this.lastSeen.size, today: this.todayIds.size, allTime: this.allTime };
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/stats' && request.method === 'GET') {
      const rolled = this.rollDay();
      if (rolled) await this.save();
      return json(this.counts());
    }

    if (pathname === '/api/session' && request.method === 'POST') {
      let id = '';
      try {
        const body = await request.json();
        id = String(body?.id || '');
      } catch {
        return json({ error: 'expected {"id": "..."}' }, 400);
      }
      if (!ID_PATTERN.test(id)) return json({ error: 'invalid id' }, 400);

      this.rollDay();
      this.lastSeen.set(id, Date.now());
      if (!this.todayIds.has(id)) {
        if (this.todayIds.size < MAX_TRACKED_IDS) this.todayIds.add(id);
        this.allTime += 1;
      }
      // counts() prunes expired sessions, so it runs before the write and the
      // stored map stays the same size as the answer we just gave.
      const stats = this.counts();
      await this.save();
      return json(stats);
    }

    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      if (!env.SESSIONS) return json({ error: 'tracker disabled' }, 404);
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName('global'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
