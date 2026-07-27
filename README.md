# Winnow

**What the reviews actually say.**

Winnow analyses the integrity of Amazon reviews and shows you an adjusted rating — the
rating a product would have if apparently manipulated reviews were removed.

It runs entirely in your browser. It makes no network requests. It takes no affiliate money.

---

## How we make money

You pay us. Nobody else does.

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
npm test          # 51 tests covering the engine and the parser
npm run typecheck
npm run build     # → dist/
```

Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**.

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
src/background/  service worker (near-empty by design)
```

`src/core` is deliberately dependency-free and side-effect-free. It is the part that must be
independently verifiable, so it is the part with no way to phone home.

## Licence

MIT.
