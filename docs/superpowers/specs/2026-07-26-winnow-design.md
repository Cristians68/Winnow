# Winnow — Design Spec

**Date:** 2026-07-26
**Status:** Approved, in build
**Tagline:** *What the reviews actually say.*

---

## 1. Problem

Fakespot (10M users) was shut down by Mozilla on 2025-07-01. ReviewMeta went dark in early 2026.
Ten million people lost review-integrity tooling and nobody has re-consolidated them.

Simultaneously the problem worsened:
- AI-generated fake reviews **nearly doubled as a share of fake reviews in one year**
- **74%** of AI-written reviews are 5-star vs **59%** of genuine reviews
- **95%** of consumers read reviews before buying

The surviving alternatives are weak or compromised:
- **RateBud** — undisclosed Amazon Associates tag on its "Buy Now" button, astroturfed Reddit
  promotion, and returns a near-constant ~82/100 for most products (a starved-model signature)
- **SureVett** — credible solo 2026 launch, no scale
- **FakeFind** — shallow pass/fail

Adjacent trust collapse: **Honey lost ~8M Chrome users** after the Dec 2024 affiliate-hijacking
exposé and remains in active class-action litigation. Google rewrote Chrome Web Store policy in
2025 specifically to stop that behaviour.

Category demand data (Exstats, 2026): Chrome **Shopping** is the category where demand outruns
supply — installs **+37.4%** over 90 days vs supply growth **+26.3%**, across 6,359 extensions with
a **median of 14 users** and nearly half carrying no ratings.

## 2. The structural insight

Amazon closed the door on server-side scrapers in 2026:

- As of **May 2026**, `/product-reviews/` returns "Page Not Found" without valid session cookies
- Amazon **stopped exposing full review bodies** in public HTML of dedicated review pages;
  "many older pagination tricks broke industry-wide"
- Unauthenticated visitors see only **~8–13 featured reviews** per product

Every surviving competitor is a server-side scraper. This is why they are all shallow — RateBud's
constant ~82 score is what a model outputs when starved of data.

**A browser extension runs inside the user's own logged-in session.** It can see what no
server-side scraper can reach. Fakespot was built when server scraping worked, so it was a website
with an extension bolted on. That architecture is now obsolete.

**Compounding moat:** each user's browser legitimately renders review data. Anonymised and pooled by
ASIN, this builds a corpus no competitor can buy. More users → better corpus → better scores.

## 3. Non-negotiable constraint: never risk the user's Amazon account

Amazon's ToS prohibits data-mining/bots. Aggressive scraping through a logged-in session risks
**the user's** account. Design rules, binding:

1. **Never** background-crawl using a user's session.
2. Free tier reads **only the DOM Amazon already rendered** for a page the user chose to visit —
   zero additional network requests, zero incremental risk.
3. Deep analysis is **explicitly user-initiated**, hard-capped page count, human-paced with jitter,
   and states exactly what it is doing before it does it.
4. The server never receives session cookies, user identity, or account data — only anonymised
   review features keyed to a public ASIN.

Shipping slightly less depth is preferable to suspending a customer's Amazon account.

## 4. Architecture

```
CONTENT SCRIPT (user's browser)
  1. Detect ASIN
  2. Parse rendered DOM — no extra requests
       rating histogram · review count · dates · verified badges
       · helpful votes · review text
  3. Local scoring engine (pure TS, ~0ms)
       → GRADE SHOWN INSTANTLY, FREE, ALWAYS
                    │
                    │  anonymised features keyed by ASIN
                    │  (no cookies, no identity, no PII)
                    ▼
SERVER (cached per ASIN, not per user)
  · Corpus aggregation across users
  · AI-generated-text detection
  · Cross-product reviewer-network graph
  · Rating-history tracking (review-hijack detection)
  → PAID: the "why" behind the grade
```

Consequences: the free grade costs nothing to serve because it never touches the server. Compute
scales with *products*, not users; popular ASINs cache hot. If the server dies, the free tier is
unaffected.

## 5. Scoring engine

Per-review suspicion scoring (ReviewMeta's approach — exclude and explain), plus product-level
signals that cannot be attributed to individual reviews.

### Per-review signals
| Signal | Rationale |
|---|---|
| Unverified purchase | Verified badge does not *boost*; it only prevents devaluation |
| Template / incentivised phrasing | "received free in exchange for honest review" family |
| AI-generated text markers (local heuristic) | Low lexical diversity, uniform sentence length, no specifics |
| Near-duplicate text | Trigram Jaccard similarity clustering across the sample |
| Extreme rating + thin text | 5★ or 1★ with negligible content |
| Burst membership | Review falls inside an anomalous temporal cluster |
| Zero helpful votes despite age | Genuine reviews accrue votes over time |

### Product-level signals
| Signal | Rationale |
|---|---|
| Histogram shape | Natural products are J-shaped; manipulation spikes 5★ and hollows 2–4★ |
| Ratings-vs-reviews mismatch | Large divergence between rating count and written-review count |
| Sample confidence | Explicit function of how many reviews were actually visible |

### Output
- **Letter grade A–F**
- **Adjusted star rating** — the rating recomputed with suspicious reviews down-weighted.
  The single most decision-useful number on the page.
- **Per-signal breakdown** with plain-English detail and evidence.
- **Confidence indicator** driven by sample size, stated honestly
  ("based on the 11 reviews visible on this page").

ReviewMeta's genuine advantage over Fakespot was showing *which* reviews it excluded and why;
Fakespot was criticised for opacity. Winnow shows its work. Both dead tools stated their output was
an estimate, not proof — Winnow says so visibly. Overclaiming certainty is how a trust product dies.

## 6. Trust architecture (this is the product)

1. **Zero affiliate links, permanently** — written into the privacy policy as a binding commitment.
2. **Open-source scoring engine** — anyone can verify the grade isn't for sale. Competitors can copy
   the algorithm; they cannot copy the corpus.
3. **Published, versioned methodology** with changelog.
4. **Minimum permissions**, justified line by line in the store listing.
5. **No browsing data collected.** Server sees ASINs and review features, never who asked.
6. **Public "how we make money" page:** you pay us, nobody else does.

## 7. Monetisation

- **Free forever:** full grade, adjusted rating, per-signal breakdown. Never withheld or blurred.
- **Paid (~$3–4/mo):** flagged review samples, reviewer-network map, rating history / hijack
  detection, deep analysis on demand, alternative-product suggestions.

The answer is never held hostage. Slower conversion, far stronger word-of-mouth in a category where
"it wouldn't tell me unless I paid" is a fatal review theme.

## 8. v1 scope

Amazon only, done exceptionally. Expansion (Walmart, Etsy) only after depth is genuinely good —
shallow-everywhere is the specific failure of every current alternative.

**In scope for v1:** MV3 extension, DOM parser, local scoring engine with tests, on-page badge +
detail panel, popup, options, methodology page.
**Out of scope for v1:** server tier, payments, accounts, non-Amazon marketplaces.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Amazon DOM churn breaks parsing | Multi-selector fallback chains; parser degrades to partial data rather than failing; explicit "couldn't read this page" state |
| Amazon ToS / user account risk | Section 3 constraints; no background crawling ever |
| Small visible sample → weak signal | Report confidence honestly rather than fabricating precision |
| Google ships native review analysis | Corpus + open-source trust position are not replicable by a default feature |
| Pressure to take affiliate money | Constitutional commitment in policy + open source; the reason to exist |
