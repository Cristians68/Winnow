# Winnow

**What the reviews actually say.**

Winnow analyses the integrity of Amazon reviews and shows you an adjusted rating — the
rating a product would have if apparently manipulated reviews were removed.

Grading runs entirely in your browser and makes no network requests at all. **The published build
makes none whatsoever** — it holds no host permission outside Amazon's own pages, so it cannot
contact a server even in principle.

An optional feature, deep analysis, compares a product against a corpus held by a server. No hosted
service exists yet, so it ships disabled: no endpoint is compiled in and the button is hidden. The
server lives in `server/` and you can run it locally today and point Options at it. Enabling it in a
release would mean adding a host permission, which is visible in the manifest and in the install
prompt before anything is sent.

It takes no affiliate money, in any mode.

---

## How we make money

Today: we don't. Winnow is free, there is nothing to buy, and no money changes hands.

When that changes, the rule is: **you pay us, nobody else does.**

That sentence is the whole product. Winnow exists because the alternatives failed this test:

- **Honey** lost roughly 8 million Chrome users after a December 2024 investigation showed it was
  overwriting creators' affiliate links, and remains in class-action litigation.
- **RateBud**, the most-recommended Fakespot replacement, ships an undisclosed Amazon Associates
  tag on its "Buy Now" button.

A tool that earns a commission when you buy cannot credibly tell you not to buy. So Winnow carries
no affiliate links, no sponsored placements, and no merchant relationships of any kind — not as a
current policy, but as a permanent commitment written into the privacy policy.

The scoring engine in [`src/core`](src/core) is open source specifically so you can verify that no
merchant is paying for a better grade.

---

## Why a browser extension

Amazon closed the door on server-side analysis in 2026:

- `/product-reviews/` returns "Page Not Found" without valid session cookies (May 2026)
- Full review bodies are no longer exposed in the public HTML of review pages
- Logged-out visitors see roughly 8–13 featured reviews per product

Every remaining competitor is a server-side scraper, which is why their scores are so flat — a
model starved of data outputs the same number for everything.

An extension runs inside the page you are already looking at, so it sees what those scrapers no
longer can.

## What Winnow will never do

**Winnow will never crawl Amazon using your session.** Amazon's terms prohibit automated data
mining, and aggressive scraping through a logged-in session risks *your* account, not ours.

So the analysis reads only the DOM your browser already rendered for a page you chose to visit.
Zero additional requests. Zero incremental risk to your account. We would rather ship a shallower
free tier than get someone's Amazon account suspended.

---

## Methodology

Winnow assigns each visible review a **suspicion score** from 0 to 1, then uses the distribution of
those scores to adjust the product's rating and assign a grade.

### Per-review signals

| Signal | What it looks for |
|---|---|
| **Verified purchases** | Unverified reviews are down-weighted, more so at 5 stars. A verified badge never *boosts* a review; it only protects it. |
| **Review language** | Disclosed incentives ("free in exchange for my honest review"), template-farm boilerplate, and a conservative generated-text heuristic. |
| **Duplicate text** | Character-trigram similarity across the sample. Review farms paraphrase from templates, so character shingles catch what word matching misses. |
| **Review timing** | Tight clusters of reviews inside a sample that otherwise spans months. |
| **Review substance** | Extreme ratings carrying almost no content and no specifics. |
| **Community response** | Featured reviews that are months old and have never been marked helpful. |

### Product-level signals

| Signal | What it looks for |
|---|---|
| **Rating distribution** | Genuine products are J-shaped, with a persistent 1-star tail from damage and defects. Campaigns add 5-star reviews but cannot remove organic 1-star ones, so a very high 5-star share with a near-absent negative tail is the clearest histogram-level tell. |

### The adjusted rating

If share `s` of reviews look manipulated, and manipulated reviews sit at roughly 5 stars, then:

```
displayed = s·5 + (1−s)·genuine
genuine   = (displayed − 5s) / (1 − s)
```

That estimate is then **shrunk toward the displayed rating** in proportion to how little of the
review base we actually saw. This matters: we typically observe 8–13 *featured* reviews out of
thousands, and featured reviews are a biased sample. Presenting an unshrunk number from that sample
would be exactly the false precision Winnow exists to call out.

When almost nothing in the sample looks trustworthy, Winnow **declines to state an adjusted
rating** rather than inventing one.

### What Winnow does not claim

This is an estimate, not proof. Winnow cannot know that any individual review is fake — it can only
identify patterns that manipulated reviews tend to produce. Every result states what it was based on
and how confident it is, and a low-confidence result is labelled as such rather than dressed up.

A grade of "couldn't read this page" is not a verdict about the product.

---

## Development

```bash
npm install
npm test          # 249 tests: engine, parser, panel, popup, options, worker, a11y
npm run typecheck
npm run build     # → dist/
```

Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**.

The server is a separate package with its own suite:

```bash
cd server && npm install && npm test   # 55 tests covering the corpus signals
```

### End-to-end check of deep analysis

The suites above stub the network. To exercise the real path — the extension's request builder, over
HTTP, through the real sanitiser and corpus — run the server and point the smoke test at it:

```bash
cd server && WINNOW_DB=/tmp/smoke.db npm start   # in one terminal
npm run smoke                                    # in another
```

Use a scratch database: the smoke test writes real observations. It asserts the privacy guarantees
against the actual serialised payload, not against the code that builds it.

### Verifying the parser against live Amazon

Amazon serves a bot-check interstitial to automated sessions, so the parser cannot be validated by
a headless run — it has to be checked against markup a real person actually loaded.

Open an Amazon product page in normal browsing, scroll the reviews into view, and paste
[`tools/selector-probe.js`](tools/selector-probe.js) into the DevTools console. It reports which
selector chain currently satisfies each field and which have gone stale. Anything showing ❌ is a
selector that needs updating in `src/content/parse.ts`.

Do this after any Amazon layout change, or when a product's analysis looks obviously wrong.

### Layout

```
src/core/        pure scoring engine — no DOM, no network, no chrome APIs
src/content/     Amazon DOM parser + on-page UI (shadow DOM)
src/popup/       toolbar popup
src/options/     settings + the public trust statement
src/background/  service worker — the only file permitted to touch the network
src/shared/      settings and the deep-analysis client contract
server/          deep-analysis service (corpus-backed signals)
```

`src/core` is deliberately dependency-free and side-effect-free. It is the part that must be
independently verifiable, so it is the part with no way to phone home. Note that the **grade is
always computed locally**, even after deep analysis: the server contributes evidence, never a
verdict, so the scoring logic stays in the open-source engine rather than behind an API nobody can
audit.

### The deep-analysis server

```bash
cd server
npm install
npm test
WINNOW_HASH_SALT=<secret> npm start   # :8787
```

Zero runtime dependencies — Node's built-in SQLite and HTTP server only. It computes the three
signals a single page cannot support:

- **Cross-product template reuse** — phrasing appearing on many unrelated products, the signature of
  a review farm working from a script. This is the strongest signal in the system and is purely a
  function of corpus size.
- **Reviewer networks** — accounts whose review histories overlap far beyond chance.
- **Review hijacking** — listings that swapped product while keeping their accumulated reviews.

Results are cached per ASIN, so cost scales with products analysed rather than with users.

Read [SECURITY.md](SECURITY.md) before deploying it — `WINNOW_HASH_SALT` and
`WINNOW_ALLOWED_ORIGINS` both need setting, and the known gaps are listed honestly.

## Accessibility, privacy and compliance

- [PRIVACY.md](PRIVACY.md) — what is and isn't sent, in both modes
- [SECURITY.md](SECURITY.md) — threat model, hardening, and known gaps
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) — WCAG 2.2 AA / ADA / EN 301 549, GDPR, EU AI Act, and
  Chrome Web Store policy, with each item marked Met, Partial or Outstanding

The UI targets WCAG 2.2 AA: landmark regions, text alternatives for the grade, status never carried
by colour alone, full keyboard operation with visible focus, live regions for async results, and
`prefers-reduced-motion` support.

## Licence

MIT.
