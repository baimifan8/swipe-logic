# Swipe Logic

Type what you're buying, get the card in your wallet that earns the most on it.

Everything is static: `index.html` plus three scripts. `server.js` is an optional
zero-dependency Node server that serves those files and counts how many people
are using the app right now.

## Run it

```sh
node server.js                    # http://localhost:8080
PORT=3000 node server.js
SWIPE_TRACKER=off node server.js  # serve the app, no session counting
```

You can also drop the folder onto any static host (or open `index.html`
directly). Without `server.js` the app works exactly the same — the live
session counter simply hides itself, since nothing answers `/api/session`.

## Session tracker

The badge in the header shows how many people have the app open right now, and
its tooltip adds today's count and the all-time session total.

- The browser makes up a random id per tab session and sends it to
  `POST /api/session` every 30 seconds; a session counts as "here now" for 90
  seconds after its last heartbeat.
- The server stores nothing else: no IP addresses, no user agents, no queries,
  no wallet contents.
- Counts live in `data/stats.json` (override with `SWIPE_DATA_DIR`). That
  directory is gitignored and separate from the app files.
- `GET /api/stats` returns `{ active, today, allTime }` if you want to graph it.

## Updating without losing anyone's cards

Wallets are never stored on the server. Each browser keeps its own in
`localStorage`, and what it saves is only a list of card ids plus the settings
that person changed by hand (a chosen bonus category, an NFCU tier). Card
rates, categories and notes are rehydrated from `cards.js` on every load.

So updating is just:

```sh
git pull
# restart node server.js if you're running it
```

- New and corrected card data reaches existing wallets on the next load.
- Selections, toggles and per-card settings survive, because nothing in the
  update path writes to or clears `localStorage`.
- A card id that disappears from the catalog is kept in storage rather than
  deleted, so it comes back if a later version restores it.
- `data/stats.json` is untouched by `git pull`, so the counters keep their
  history.
- The service worker fetches app files network-first, so an installed
  home-screen copy picks up the new version instead of serving a stale cache.

Old saved payloads (the pre-v2 format, which stored whole card objects) are
migrated automatically the first time they're loaded.

## Adding cards

Append an entry to one of the arrays in `cards.js` — `id`, `name`, `network`,
`issuer`, `color`, `unit` (`%` or `x`), `pointValue` (cents per point when
cashing out), `base`, and a `categories` list whose `keywords` drive matching.
Cards with a user-selectable bonus category (Bank of America, Venmo) set
`editableChoiceCategory` and a `categoryDefinitions` map instead.

Rates are transcribed from issuer terms and go stale — verify in the issuer's
app before a large purchase.
