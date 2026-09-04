# Swipe Logic

Type what you're buying, get the card in your wallet that earns the most on it.
Static app + optional Node server (`server.js`) for self-hosting, deployed to
Cloudflare Workers at swipe-logic.com. See `README.md` for the full file-by-file
breakdown, the release process (`npm run release` / `npm run check`), and how
the card catalog and credit tracking work.

## Keep the wiki's changelog current

`wiki.html` (served at `/wiki`) is the plain-language explanation of the app —
the audience is the person using it, not a developer. Its `#updates` section
(`<ul class="wiki-timeline">`) is a changelog written in that same voice, and it
goes stale silently: nothing in the build fails if it's wrong, so it has to be
kept honest by habit, not by tooling.

**Whenever a change ships to `master` that changes what the app does or how it
behaves** — a fix, a new feature, something a user would notice — add an entry
to that timeline in the same PR. Skip it for anything with no user-visible
effect: internal refactors, tooling, docs, dependency bumps.

One entry:

```html
<li>
  <div class="ver-row"><span class="ver">v1.7</span><span class="status">current</span></div>
  <h3>Short, concrete headline</h3>
  <p>One or two plain-language sentences: what changed, why it matters to
     someone using the app. Not "refactored X" — "the counter now updates
     within seconds instead of every 30."</p>
</li>
```

Rules for that entry:

- **New entries go at the top.** The list is read newest-first; it's a real
  chronological sequence, which is the only reason it's allowed to look like one.
- **Move the `current` badge.** Remove `<span class="status">current</span>`
  from whatever was previously the top entry — only the newest one carries it.
- **The version number must match what's actually live.** Read `VERSION` in
  `sw.js` *after* running `npm run release` for this change, and convert it to
  the dotted form the footer shows: `v14` → `v1.4`, `v20` → `v2.0` (integer
  `n` → `v${Math.floor(n/10)}.${n%10}`, same math as `renderVersion()` in
  `app.js`). Nothing checks this automatically — `tools/bump-version.mjs` only
  verifies files referenced from `index.html`'s own `<script>`/`<link>` tags,
  and `wiki.html` isn't one of them. A stale number here is invisible until
  someone compares it to the footer by hand.
- **Voice matches the existing entries**, not the commit message or the PR
  title: short, concrete, plain language, no jargon, written for whoever's
  using the app. "Fixed a Durable Object eviction bug" is a commit message;
  "the live counter now stays accurate" is a changelog entry.

If in doubt whether something's user-visible enough to log, err toward
skipping it — a changelog that logs everything stops being read as a changelog.
