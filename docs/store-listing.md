# Chrome Web Store listing

Copy and answers for the submission form. Keep this in sync with the manifest and PRIVACY.md —
Google cross-checks the declared practices against what the code actually does, and a mismatch is a
rejection.

---

## Name (75 char limit)

```
Winnow — Amazon Review Integrity
```

Must match `name` in `src/manifest.json` exactly — the store takes the listing name from the
manifest, so a mismatch here is just a stale doc.

"Amazon" is included for store search, where people type the marketplace rather than the problem.
This is descriptive use and is the same pattern established listings use (e.g. "Keepa - Amazon Price
Tracker"), but it is trademark-adjacent: the listing must never imply endorsement, and the site
footer carries an explicit non-affiliation disclaimer for the same reason.

## Short description (132 char limit)

```
See what Amazon's reviews actually say. Adjusted ratings and fake-review analysis, computed in your browser. No affiliate links.
```

*(126 characters)*

## Category

Shopping

## Detailed description

```
Winnow tells you what a product's reviews actually say.

It analyses the reviews on any Amazon product page and shows you an ADJUSTED RATING — the
rating the product would have if apparently manipulated reviews were removed — along with a
plain-English breakdown of exactly why.

Everything runs on your own device. Winnow makes no network requests, has no server, and has
no account.


WHAT IT CHECKS

• Rating distribution — genuine products keep a 1-star tail from damage and defects. Review
  campaigns can add 5-star reviews but cannot remove organic 1-star ones, so a near-perfect
  spread with no negative tail is a strong tell.
• Verified purchases — unverified reviews are down-weighted, more so at 5 stars.
• Review language — disclosed incentives ("free in exchange for my honest review"),
  template-farm boilerplate, and patterns consistent with AI-generated text.
• Duplicate text — reviews paraphrased from a shared template.
• Review timing — bursts of reviews landing together inside a months-long history.
• Review substance — 5-star ratings carrying six generic words and no specifics.
• Community response — featured reviews months old that nobody ever found helpful.


HOW WE MAKE MONEY

Right now, we don't. Winnow is free and there is nothing to buy. If that ever changes, it
will be you paying us — never a merchant.

Winnow carries no affiliate links, no referral tags, no sponsored placements and no merchant
relationships — permanently, as a binding commitment in our privacy policy. A tool that earns
a commission when you buy cannot credibly tell you not to buy.

The scoring engine is open source so you can verify no merchant is paying for a better grade.


WHAT WINNOW DOES NOT CLAIM

Every result is an estimate, not proof. Winnow cannot know that any individual review is fake.
It identifies patterns that manipulated reviews tend to produce, and it always tells you what
the judgement was based on and how confident it is.

Usually only 8–13 reviews are visible on a product page, and those are featured reviews — a
biased sample. Winnow shrinks its adjustment to account for that, and declines to state an
adjusted rating at all when too little of the sample looks trustworthy. "Couldn't read this
page" is never a verdict about the product.


PRIVACY

• No data leaves your browser. Ever.
• No analytics, telemetry or tracking of any kind.
• No account, no sign-up, no personal information.
• The only permission requested is "storage", used to remember your settings, the grades
  you marked as wrong, and the grades Winnow worked out — all on your device, all erasable
  from the options page, none of it transmittable by any code in Winnow.
• Winnow never crawls Amazon using your session — it reads only what your browser already
  rendered. Automated scraping through a logged-in session can put YOUR Amazon account at
  risk, and we will not do that to you.

Winnow requests one permission — storage — plus the Amazon storefronts it runs on. It
cannot read your logins, your passwords, or any site that is not Amazon. Don't take our
word for it: open chrome://extensions (or about:addons in Firefox), find Winnow, and read
the list. Every listing in this store shows what an extension requests. Compare before you
install anything that watches you shop, this included.

Open source: https://github.com/Cristians68/Winnow
```

---

## Single purpose description

```
Winnow has one purpose: to analyse the trustworthiness of customer reviews on Amazon product
pages and display an adjusted rating with an explanation. Every permission and every content
script exists to serve that single function.
```

## Permission justifications

### `storage`

```
Used to persist three things locally, all of them erasable from the options page:

1. User preferences: whether the on-page panel is shown, whether the breakdown starts
   expanded, and the theme.
2. Grades the user explicitly marked as too harsh or too lenient, so scoring can be
   corrected. The listing is identified by a one-way hash, not by ASIN, name or URL.
3. Grades Winnow has already computed, so the same grade can be shown beside that product
   on Amazon search pages. Each entry holds the ASIN, the grade, the score, the engine
   version and the date. This is a record of Amazon product pages the user has opened. It
   is capped at 500 entries, expires after 90 days, and is disclosed in the privacy policy
   and on the options page.

No data of any kind is transmitted. There is no code path in the extension capable of
sending any of it anywhere, which is verifiable in the public source.
```

Note for future edits: item 3 is browsing history in substance, and this justification says
so in those words on purpose. An earlier version of this text read "No user data, browsing
history, or product data is stored", which was true when written and became false the moment
the grade cache shipped. A disclosure that silently goes stale is worse than a broad one.

### Host permissions (`*://*.amazon.*/*`)

```
Winnow analyses reviews on Amazon product pages, so it needs to read the content of those pages
to function. The content script reads the already-rendered product rating, rating histogram and
visible reviews, scores them locally, and injects a results panel.

Access is limited to Amazon storefront domains only. Winnow requests no access to any other
site, does not use the "tabs" permission, and makes no network requests of any kind — the
extension has no server to send anything to.
```

### Optional host permissions (`http://localhost/*`, `http://127.0.0.1/*`)

```
Not requested at install, and not used by the published extension.

Winnow's analysis engine and its optional server component are open source. A developer running
that server on their own machine can point the extension at it from the options page, which is
the only situation in which this permission is requested — at that moment, by explicit user
action, via chrome.permissions.request.

The setting accepts loopback addresses only; any other address is rejected and never stored, and
the service worker independently refuses to send to a non-loopback endpoint. A normal install
never holds this permission and never contacts anything.
```

### Remote code

```
No. All code is bundled in the package. The extension loads no remote scripts and evaluates no
remotely-hosted code.
```

---

## Data usage disclosures

Tick **none** of the data collection categories. Then affirm:

This stays "none" after the 0.4.0 grade cache, and the reasoning should be checked rather
than assumed each release: Chrome's disclosure asks what the extension **collects**, which
it defines as transmitting off the user's device. Winnow stores a record of product pages
opened, but nothing leaves the browser and no code path can send it. If a hosted endpoint is
ever enabled, revisit this section first — it would move "Website content" from not-collected
to collected, and that answer is attested to Google.


- [x] I do not sell or transfer user data to third parties, outside of approved use cases
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

Privacy policy URL: link to the hosted copy of `PRIVACY.md`.

---

## Screenshots (1280×800)

1. **The panel on a clean product** — grade A, adjusted rating matching the displayed rating.
   Establishes that Winnow is not a fear-marketing tool and will tell you when reviews are fine.
2. **The panel on a manipulated product** — low grade, adjusted rating visibly below the
   displayed one with the `was 4.8` strikethrough. This is the money shot.
3. **The breakdown expanded** — per-signal rows with evidence lines, showing the reasoning is
   inspectable rather than a black box.
4. **The honesty state** — a low-confidence result showing the "estimate, not proof" basis line.
   Differentiates from competitors who project false certainty.
5. **The options page** — the "how we make money" pledge and the methodology notes.

Do not fabricate these. Capture them from real product pages once the parser is verified against
live Amazon.

---

## Pre-submission checklist

- [ ] Parser verified against live Amazon via `tools/selector-probe.js`
- [ ] Screenshots captured from real pages
- [ ] `PRIVACY.md` hosted at a public URL
- [ ] Repo public at the URL referenced in the UI footer, README and privacy policy
- [ ] `npm run package` passes its manifest guard
- [ ] Version bumped in `package.json` (the manifest inherits it at build time)
