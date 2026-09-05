# Security

## Reporting something

Open a [private security advisory](https://github.com/baimifan8/swipe-logic/security/advisories/new)
rather than a public issue. That keeps the details out of public view until
there's a fix.

There's no bounty, no SLA, and no guaranteed response time — this is a personal
project, not a staffed product. Report anyway if you find something real;
it'll be read.

## What this app actually handles

Worth knowing before you go looking, because the attack surface is smaller than
most web apps:

- **No accounts, no passwords, no sessions.** Nothing to log into.
- **No personal data on any server.** Your card list and credit-usage history
  live in your own browser's `localStorage` and are never transmitted. Nothing
  you search for leaves your device — matching runs entirely client-side.
- **No database of users.** The only thing the server ever recorded was an
  opaque random per-tab id for the live "here now" counter, with no IP
  addresses, user agents, or queries attached.
- **No payment handling, no card numbers.** The app knows *about* credit card
  reward programs. It never touches an actual card number, and there is nowhere
  to enter one.

## Known and accepted

- **The session counter accepts any made-up id.** Anyone reading this repo can
  see the endpoint takes an arbitrary string, so the count can be inflated by
  scripting fake heartbeats. It's a vanity number with nothing behind it and no
  access to anything; it was never worth defending.
- **Card data is unverified.** See [CONTRIBUTING.md](CONTRIBUTING.md). Wrong
  rates are a correctness problem, not a security one, but they're wrong often
  enough to say plainly.

## Dependencies

The app itself ships zero runtime dependencies — it's vanilla JavaScript with no
build step, and `server.js` uses only the Node standard library. The single
devDependency is `wrangler`, used to deploy. Dependabot watches it and the
GitHub Actions workflow.
