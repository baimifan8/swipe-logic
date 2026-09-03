# Swipe Logic

Type what you're buying, get the card in your wallet that earns the most on it.

Everything is static: `index.html` plus a handful of scripts. `server.js` is an
optional zero-dependency Node server that serves those files and counts how many
people are using the app right now; `worker/index.js` is the same two endpoints
for Cloudflare, when you want a public link.

| File | What it holds |
| --- | --- |
| `cards.js` | Curated cards — earn rates, categories, matching keywords |
| `catalog-generated.js` | Cards pulled from an upstream API by `tools/import-cards.mjs` |
| `credits.js` | Recurring statement credits, hand-maintained |
| `credit-usage.js` | What you've spent of each credit this period (device-local) |
| `matcher.js` | Query → ranked cards, plus the credits that apply |

## Run it

```sh
node server.js                    # http://localhost:8080
PORT=3000 node server.js
SWIPE_TRACKER=off node server.js  # serve the app, no session counting
```

You can also drop the folder onto any static host (or open `index.html`
directly). Without `server.js` the app works exactly the same — the live
session counter simply hides itself, since nothing answers `/api/session`.

## Put it on a public link (Cloudflare Workers)

`wrangler.jsonc` deploys the app as a single Worker: static files plus the
session counter, on the free plan. Workers with static assets is where
Cloudflare points new projects — Pages is the older path.

```sh
npm install          # wrangler
npx wrangler login
npx wrangler deploy  # builds dist/ first, then deploys
```

That prints a `https://swipe-logic.<your-subdomain>.workers.dev` link, which is
the shareable URL. For a custom domain, add the domain to Cloudflare (registrar
or nameservers), then **Workers & Pages → swipe-logic → Settings → Domains &
Routes → Add custom domain**. HTTPS is issued automatically; the only cost is
the domain registration.

The counter runs on one SQLite-backed Durable Object, included on the Workers
free plan, so every visitor is counted against the same numbers no matter which
Cloudflare location serves them. `dist/` is a build artifact — gitignored, and
rebuilt by `npm run build` on every deploy.

Deploying does not retire `server.js`: both speak the same two endpoints, so the
app behaves identically self-hosted and deployed.

## Session tracker

The badge in the header shows how many people have the app open right now, and
its tooltip adds today's count and the all-time session total.

- The browser makes up a random id per tab session and sends it to
  `POST /api/session` every 30 seconds; a session counts as "here now" for 90
  seconds after its last heartbeat.
- The server stores nothing else: no IP addresses, no user agents, no queries,
  no wallet contents.
- Counts live in `data/stats.json` (override with `SWIPE_DATA_DIR`). That
  directory is gitignored and separate from the app files. Deployed, they live in
  the Worker's Durable Object instead — same numbers, same shape.
- `GET /api/stats` returns `{ active, today, allTime }` if you want to graph it.
- "Active" is held in memory. Restarting the server, or the Durable Object being
  evicted when idle, resets it to zero and it refills within one heartbeat;
  today's and the all-time counts are stored and survive.

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

## Importing cards instead of typing them

`tools/import-cards.mjs` pulls machine-readable earn rates from an upstream API
and writes `catalog-generated.js`, so the catalog can grow without hand-entering
every card.

```sh
npm run import:inspect   # print the raw upstream shape, change nothing
npm run import:cards     # fetch, map, write catalog-generated.js
node tools/import-cards.mjs --from-file saved.json   # map a saved response
```

It expects AwardWallet's Credit Card Bonus API, which is free — request a key at
<https://awardwallet.com/api/cc> and set `AWARDWALLET_API_USER` and
`AWARDWALLET_API_PASS` (or `AWARDWALLET_TOKEN`). Run `--inspect` once first: it
prints an upstream record verbatim so you can check the field names against the
mapping at the top of the script, and adjust in one place if they differ.
`AWARDWALLET_CARDS_URL` overrides the endpoint.

Rules the importer follows:

- **Curated wins.** A card already in `cards.js` is skipped — matched by id *and*
  by normalized name, so "Nordstrom Visa" doesn't get added next to
  "Nordstrom Visa Signature Credit Card". Hand-tuned keywords, caps, colors and
  notes are never overwritten.
- **It only adds.** Everything it writes lands in `catalog-generated.js`; nothing
  else in the repo is touched.
- **Category names get real keywords.** The importer reads the curated catalog's
  own vocabulary, so an imported "Restaurants" category inherits the same
  keyword list dining categories already use. Merchant-level bonuses become their
  own entries, which is what makes a specific store resolve on an imported card.
- **`tools/overrides.json`** is applied last: `skipIds` drops a bad upstream
  record, `cards.<id>` merges corrections over a generated one.

`.github/workflows/refresh-cards.yml` runs this monthly and opens a PR with the
diff. It needs `AWARDWALLET_API_USER` / `AWARDWALLET_API_PASS` as repository
secrets, and skips cleanly if they're missing. Nothing auto-merges — card data is
the whole product, so a human reads the diff.

## Statement credits

`credits.js` holds the other half of an answer: the recurring credits that make a
card the right swipe even when its multiplier isn't the highest. Search
"uber eats" with an Amex Gold in the wallet and the answer is 4x *plus* the
$10/month Uber Cash.

```js
'amex-gold': [
  { label: 'Uber Cash', amount: 10, cadence: 'month', annual: 120,
    enroll: true, keywords: ['uber', 'uber eats'], note: '…' },
]
```

`cadence` is `month`, `quarter`, `half` or `year`; omit `amount` when it varies
and give `annual` instead; `enroll: true` renders the badge that says the credit
does nothing until you enroll in the issuer app.

Without a purchase amount, credits don't reorder results by rate — there's no
honest way to weigh "$10 credit" against "4x points" in the abstract. A credit
with room left breaks a tie between two cards at the same rate, and one sitting
on a losing card is surfaced under the answer as a nudge.

### The amount field

Type an amount next to the search box and the ranking switches to dollars, which
is the only basis on which a credit and a multiplier can actually be compared.

```
"dunkin", no amount → Venture X (2x) wins on rate; Gold's $7 credit is a footnote
"dunkin", $8        → Gold wins: $7.08 back ($7.00 credit + $0.08) vs $0.16
"dunkin", $1000     → Venture X wins again: $20.00 vs $17.00
```

The math: rewards accrue on the full charge — a statement credit posts
separately and doesn't reduce the earning charge — so the two add rather than
compete. Credits are capped at the purchase amount and at what's left of each one
this period, and a credit whose size varies contributes nothing rather than an
invented number. Marking a credit used drops it straight out of the dollar math.

Leaving the field empty (or typing something that isn't a positive number) puts
ranking back on rates alone rather than guessing.

### Tracking what you've spent

`credit-usage.js` tracks how much of each credit is gone this period, so the app
stops recommending money you've already used.

- On a result card, **Mark used** flips a credit to spent: it greys out, and the
  answer stops mentioning it.
- In the settings sheet, the **Credits** panel lists every credit in the wallet
  with what's left of it, headed by the total still on the table this period.
  Log a partial amount there ($120 of a $300 travel credit) and the answer says
  "$180 left of its $300 a year Annual travel credit". Amounts clamp to the
  allowance; a credit with no fixed amount gets a plain used/unused toggle.
- Storage is keyed by *period*, not date: an entry recorded in `2026-09` simply
  stops matching once the calendar turns over, so credits reset themselves with
  no scheduled job and no clock to trust beyond the device's own. Stale entries
  are pruned on load.

Usage lives in this browser's `localStorage`, like the wallet — never sent to the
server, and deliberately **not** included in a shared wallet link, since what you
spent is yours and not part of a card list you hand someone.

This file is maintained by hand and the importer never touches it: no free feed
publishes credits, and they change on issuer whim. The seeded numbers were
checked September 3, 2026. Re-check them when a card's annual fee changes, which
is usually when the credits get reshuffled too.
