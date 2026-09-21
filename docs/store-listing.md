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
Fake review checker for Amazon. See the adjusted rating without the manipulated reviews. No affiliate links, ever.
```

*(114 characters. Measured, not estimated — the first draft of this line was
written as "133 characters" and was actually 135, which the field would have
truncated in silence. Count before pasting.)*

Longer alternate, still inside the limit:

```
Fake review checker for Amazon. See the adjusted rating without manipulated reviews. Runs in your browser. No affiliate links.
```

*(126 characters)*

**Why it leads with "fake review checker".** That is the phrase people type into
store search. The previous line opened with "See what Amazon's reviews actually
say" — good copy, and invisible to anyone searching, because it contains none of
the words being searched for.

**Why no competitor name here.** "Fakespot alternative" is the highest-intent
query in this category, and it belongs on the website, where it is factual
commentary. In a store Google polices, putting another product's trademark in
your listing is a needless rejection risk. Win that query with the site, and let
the site link here.

## Category

Shopping

## Detailed description

```
Winnow shows you the rating a product would have without its fake reviews.

Open any Amazon product page and Winnow scores the reviews already on it, then shows an
ADJUSTED RATING — what the stars would say if the manipulated reviews were removed — with a
plain-English breakdown of exactly which checks fired and why.

It also tells you when it cannot tell. Amazon usually shows 8-13 reviews per page, and those
are featured reviews, so the sample is small and biased. When too little of it is trustworthy,
Winnow reports no adjusted rating rather than inventing a confident number. A checker that
returns a reassuring score for everything is not detecting anything.

Everything that produces a grade runs on your own device. Winnow has no account, and the
analysis makes no network requests — it reads the page your browser already rendered and
scores it there.


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

Sponsorship, in Winnow's own two windows only: the toolbar popup and the settings page.

The message is fetched from winnow-reviews.vercel.app, which we run — a static file, not a
third-party ad network. That host is the only non-Amazon permission this extension requests.

A sponsored message never appears on an Amazon page, never appears beside a grade, and never
appears in the analysis panel. It is labelled, and Settings turns it off.

What the sponsor is told: that a Winnow window opened. The request carries a schema version,
which of the two windows is asking, and the formats that window can draw — not the product,
not the page address, not your search terms, not the grade, and no identifier of any kind.
Because the sponsor is never told what you are looking at, a sponsor cannot buy placement
against a product, a listing or a seller: the information needed to do it never leaves your
machine.

What that buys nobody: Winnow carries no affiliate links, no referral tags, no commissions and
no merchant relationships, and does not and will not accept payment, in any form, from any
seller, brand, marketplace or advertiser to influence, alter, suppress or promote any rating,
grade or result it produces. That is a binding commitment in our privacy policy. A tool that
earns a commission when you buy cannot credibly tell you not to buy.

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

• Nothing about you and nothing about what you view leaves your browser.
• No analytics, telemetry or tracking of any kind.
• No account, no sign-up, no personal information.
• The only permission requested is "storage", used to remember your settings, the grades
  you marked as wrong, and the grades Winnow worked out — all on your device, all erasable
  from the options page, and none of it is ever put into a network request.
• Winnow never crawls Amazon using your session — it reads only what your browser already
  rendered. Automated scraping through a logged-in session can put YOUR Amazon account at
  risk, and we will not do that to you.

Winnow requests one permission — storage — plus the Amazon storefronts it runs on and
one host of ours, winnow-reviews.vercel.app, which it contacts only to fetch the sponsored
message. It cannot read your logins, your passwords, or any other site. Don't take our
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

None of it is transmitted. Nothing in Winnow reads these stored values into a network
request, which is verifiable in the public source.

Winnow does contain one network path, and this is not it: when a sponsor is configured, the
background worker fetches a sponsored message for Winnow's own popup and settings page. That
request is assembled from a fixed set of keys — a schema version, which of the two windows
asked, and the formats it can draw — and carries none of the values above, no page address
and no identifier. It is fetched from winnow-reviews.vercel.app, a static file on a host we
operate, which is the build's only non-Amazon host permission.
```

Note for future edits: item 3 is browsing history in substance, and this justification says
so in those words on purpose. An earlier version of this text read "No user data, browsing
history, or product data is stored", which was true when written and became false the moment
the grade cache shipped. A disclosure that silently goes stale is worse than a broad one.

It went stale a second time, the same way: this file still said the extension was incapable
of sending anything anywhere after 0.5.0 added the sponsorship path, because that release
rewrote every user-facing surface and not the two documents a reviewer reads. Both are now
read by `tests/claims.test.ts`, so the next release cannot leave them behind quietly.

### Host permissions (`*://*.amazon.*/*`)

```
Winnow analyses reviews on Amazon product pages, so it needs to read the content of those pages
to function. The content script reads the already-rendered product rating, rating histogram and
visible reviews, scores them locally, and injects a results panel.

Access is limited to Amazon storefront domains only. Winnow requests no access to any other
site and does not use the "tabs" permission. The content script makes no network requests at
all, so nothing read from an Amazon page is sent anywhere — which the test suite proves
against the built bundle rather than asserting in prose.

This permission has nothing to do with sponsorship. A sponsored message is fetched by the
background worker from winnow-reviews.vercel.app, drawn only in Winnow's own popup and
settings page, and never appears on an Amazon page. That host is requested separately and is
the build's only non-Amazon host permission.
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
opened, and nothing reads it into a request.

**Checked again for 0.5.0 sponsorship. It stays "none" — but the reasoning changed.** There
is now a network path in the extension, so "no code path can send it" is no longer the
argument. The argument is the request's contents: a sponsorship request carries a schema
version, a window name and a format list, and `tests/ads-policy.test.ts` pins that key set so
a field added later fails the suite rather than leaking quietly. None of it is user data, so
nothing is collected.

**The rail is live as of 0.5.0**, so item 1 below is no longer hypothetical. It has been
applied to every surface rather than noted for later:

1. A live sponsorship rail means the host serving it observes the connection itself — the IP
   address, and approximate location from it. That is not one of Chrome's collection
   categories and is not something Winnow transmits, but it is the honest limit of "nothing
   leaves your machine". PRIVACY.md carries a "What a sponsor can see anyway" section saying
   exactly that, and no surface claims the request cannot be used to recognise you.
2. A hosted deep-analysis endpoint — anything beyond the loopback developer setup — would
   move "Website content" from not-collected to collected. That answer is attested to Google.

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
5. **The options page** — the "How we make money" section, which now states the sponsorship
   position and shows its off switch, plus the methodology notes.

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
- [ ] `npm test` green — `tests/claims.test.ts` reads this file, so stale copy here fails CI
- [ ] Zips rebuilt from the exact commit being submitted. The 0.5.0 archives in the repo root
      were built before three later commits, one of them a fix, and an archive that is merely
      *near* the tag is the kind of thing nobody notices until a bug report fails to reproduce
- [ ] Money section re-read against `activeNetworks()` in `src/shared/ads/registry.ts`. The
      direct rail is live, so this file must not claim otherwise — `tests/claims.test.ts` fails
      the build in whichever direction is wrong, but the wording still needs a human read
- [ ] Generated `dist/manifest.json` inspected: `host_permissions` should hold the 20 Amazon
      patterns plus exactly `https://winnow-reviews.vercel.app/*`, and `content_scripts[].matches`
      must stay Amazon-only — an ad host there would mean code running on the ad host
