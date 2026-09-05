# Contributing

Short version: **fork it, don't send patches here.**

This repository is published so people can read the code, learn from it, and
build their own version. It is not run as a collaborative project, and pull
requests aren't being accepted — not out of hostility, there's just nobody
staffed to review them.

## What you're welcome to do

- Fork it and take it in whatever direction you want.
- Copy the parts that are useful — the matching logic in `matcher.js`, the
  credit-period tracking in `credit-usage.js`, the card schema in `cards.js`.
- Run your own copy, hosted or local (`node server.js`, or deploy the Worker).

The [AGPL-3.0 license](LICENSE) governs all of that. The practical summary: do
what you like, but if you run a modified version as a public service, publish
your changes too. That's the only string attached.

## Card data is not verified

Every rate, category and credit amount in `cards.js` and `credits.js` was
written by hand from published issuer terms on the dates noted at the top of
those files. It has not been checked against a live source, it goes stale
quickly, and it certainly contains errors. If you fork this, re-verify anything
you plan to rely on. Don't treat it as a dataset.

## Security issues

See [SECURITY.md](SECURITY.md).
