# Changelog

All notable changes to Winnow are recorded here. The scoring engine carries its own version
(`ENGINE_VERSION` in `src/core/score.ts`), shown in the on-page panel, so a grade can always be
traced to the logic that produced it.

## [0.5.0]

`ENGINE_VERSION` stays at `0.3.0`. **Scoring did not change in this release.** Nothing in this
release can change a grade — that is the central design constraint of the feature it adds.

### Added
- **Sponsorship, in Winnow's own windows only.** One sponsored message can appear in the toolbar
  popup and on the settings page.

  **No sponsor is configured in this release.** Every network in the registry ships
  `configured: false`, so the build carries no advertising host permission and makes no
  advertising request at all. EthicalAds has no publisher account yet; the direct-sponsor host is
  not deployed; PlayYield does not resolve as a service. A host permission granted "for later" is
  a permission granted, and this project has already shipped one to a domain owned by someone else
  (`api.winnow.app`). `docs/SPONSORSHIP.md` documents what must exist before each rail is switched
  on. It **never appears on an Amazon page** and never appears beside a
  grade. Settings → *Show sponsorship in Winnow's own windows* turns it off.

  The sponsor is told that a Winnow window opened, and nothing else. The request carries a schema
  version, which of the two windows is asking, and the formats that window can render. There is no
  field in it for a product, a page address, a search term, a grade or an identifier, and two
  installations therefore send byte-identical requests. Because the sponsor cannot learn which
  product you are viewing, **it cannot buy placement against a listing** — not as a matter of our
  restraint, but because the information never leaves your machine.

  Switching it off prevents the request rather than discarding the response. A request sent and
  then thrown away would still have told the sponsor that this installation exists.

  How that is kept true mechanically, rather than promised: `tests/ads-policy.test.ts` pins the
  request's key set so a field added later fails the suite; `tests/ads-containment.test.ts` reads
  the built bundles and proves no ad code and no network call reaches the content scripts;
  `build.mjs` puts ad hosts in `host_permissions` and never in `content_scripts[].matches`, so ad
  code cannot execute on a page. Every one of those checks is paired with a control proving it can
  fail.

- **Rotating sponsors for the self-hosted rail.** `site/sponsors.json` may hold a list, and
  Winnow picks one per render. That keeps the host a static file — no server, no request logs,
  nothing running — and it is the privacy-preserving choice too, since a server that rotated for
  us would have to observe every request to do it. An entry that fails validation is skipped
  rather than taking the rest of the file down with it.

- **`build.mjs --outdir=`.** Three test suites build the extension, and vitest runs them in
  parallel worker processes. They shared `dist/`, which `build.mjs` removes on its first line, so
  whichever suite lost the race read a half-written tree and failed with `EEXIST: mkdir
  dist/icons`. Each now builds somewhere private.

### Changed
- **The privacy policy, the README, the landing page, the popup footer and the settings page all
  said things that sponsorship makes false**, and all of them were rewritten rather than quietly
  adjusted. Specifically: "advertising" was removed from the list of things Winnow does not do,
  and "Winnow makes no money" / "Right now, we don't" / "no sponsored placements" are gone.

  The privacy policy said material changes to the money model would be "announced prominently,
  never altered quietly in this document", so it now carries a dated note naming the two statements
  that stopped being true. `tests/claims.test.ts` fails the build if any of them returns.

- **What did not change, and is now load-bearing:** no affiliate links, no referral tags, no
  merchant relationships, and no payment from any seller, brand, marketplace or advertiser to
  influence, alter, suppress or promote any grade. The same suite asserts that clause survives
  every future edit to the money section.

### Fixed
- **The two documents a store reviewer reads were left out of that rewrite.**
  `docs/store-listing.md` becomes the public store page and the answers typed into the submission
  form, and `docs/host-permission-justification.txt` is pasted into the permission field. Both were
  last edited for 0.4.0. The listing still read "Right now, we don't" and "no sponsored
  placements"; both files still promised the extension "makes no network requests of any kind" and
  "has no server to send anything to"; and the `storage` justification still claimed "there is no
  code path in the extension capable of sending any of it anywhere", which the ad broker had
  falsified.

  This is the same failure as the copy the release did fix, in the one place where it is an
  attestation to Google and Mozilla rather than a sentence on a web page — and the listing's own
  note warns that "a disclosure that silently goes stale is worse than a broad one". It had now
  gone stale twice, the same way, which is why the fix is a test and not just an edit: both files
  are read by `tests/claims.test.ts`, so stale listing copy fails CI instead of a review.

  The data-usage disclosure was re-argued rather than re-ticked. It stays "none", but on the
  grounds that the request's pinned key set carries no user data — not on "no code path can send
  it", which is no longer true. It now names the two things to revisit before a live rail ships,
  including that a sponsor's server necessarily observes the connection itself: the IP address,
  and approximate location from it. That is the honest limit of "nothing leaves your machine".

  The pre-submission checklist gained the steps this release proved were missable, including
  rebuilding the archives from the exact commit being submitted — the `winnow-0.5.0-*.zip` files in
  the repo root were built three commits before HEAD, one of them a fix.

- **WCAG 1.4.3 on the new disclosure line.** It first used `#858e9c`, the 3:1 colour chosen during
  the earlier 1.4.11 pass for non-text contrast. This is body text and needs 4.5:1; it measured
  **3.20:1**. Now `#6b7280` (4.67:1) in light and `#9aa1ab` (6.26:1) in dark, both already in the
  palette.

## [0.4.0]

`ENGINE_VERSION` stays at `0.3.0`. **Scoring did not change in this release.** The engine version
exists so a grade traces to the logic that produced it; bumping it without a scoring change would
invalidate every remembered grade for nothing and make the number mean less.

### Added
- **Search results pages.** Products you have already opened now carry their grade beside them in
  the search grid. Products you have not are marked "not checked", and Winnow does not guess.
  A search card shows a star average and a rating count and no reviews at all; the only way to get
  the reviews would be to load those pages using your Amazon session, which risks your account.
  So the grid shows what was actually earned, and coverage builds as you browse. A sparse row of
  badges is the honest consequence of that refusal, not a defect.
- **A record of grades, on your device.** Up to 500 products for 90 days, erasable in one click from
  Options, disclosed in the privacy policy and on the options page in the same words. Nothing is
  sent anywhere; no code in Winnow can send it. Entries from a different engine version are ignored
  rather than shown, so a grade on a search card always traces to the logic that produced it.
- **Firefox.** Built from the same source as the Chrome package, with the same permissions, checked
  by the same guards — every packaging check now runs against both manifests rather than one.
- **Six more storefronts** — Brazil, Singapore, Türkiye, Ireland, Belgium and the UAE — with
  Portuguese, Turkish and Arabic month names, star nouns and date parsing, so they do not repeat the
  failure 0.3.0 fixed.
- **The permission list, pointed at rather than paraphrased.** The panel's self-check section and the
  options page name what Winnow requests and tell you to go read it yourself, in Chrome or Firefox.
  Categories are named; competing products are not.

### Changed
- **One list of storefronts instead of five.** They previously lived in the two manifest arrays, the
  packaging guard, a domain table in the parser, and the locale tables, with nothing keeping them in
  step. Adding a storefront now requires declaring the languages it serves, as a compile error rather
  than a convention.
- The store listing's `storage` justification described a state of affairs that stopped being true
  when the feedback log shipped and was further wrong once grades were remembered. It now says
  plainly that the cache is a record of pages you opened.

### Fixed
- **The packaging guard had a hole in it.** It tested an unanchored `/amazon\./`, which passes
  `amazon.evil.com` — verified before fixing. It now matches the registry exactly, and checks
  `content_scripts[].matches`, which nothing had ever checked.
- **`amazon.com.mx` was missing from the parser's language table**, so Mexican pages without a `lang`
  attribute reported no language and the wording check went quiet without saying so.
- **Turkish dotless `ı` (U+0131) survives Unicode decomposition**, so the star noun `yıldız` never
  matched and the rating histogram was unreadable on `amazon.com.tr`.
- **`\d` matches no Arabic-Indic digit.** Its seven unit tests all passed while the parser was still
  blind, because the number parsers read raw text and never called the folding function. Only a test
  driving a whole Arabic page caught it: 234 ratings read as none. `amazon.ae` was added only after
  that test passed.

## [0.3.0]

Engine version moves to `0.3.0`: this release changes what several checks report and, on non-English
storefronts, what they are able to see at all.

The theme is one failure repeated in four places — **Winnow reporting its own blind spots as findings
about a listing**. That is the exact mistake the product exists to name, and it was shipping.

### Fixed
- **Non-English storefronts were being analysed as though they were English.** The manifest matches
  fourteen Amazon domains and eleven of them do not serve English.
  - The word tokenizer matched `[a-z0-9']+`, so a Japanese review tokenised to **zero words** — and
    the review-substance check renders a zero word count as *"5-star rating with no written review"*.
    That sentence was printed to users about a paragraph of text sitting on the screen, and it pushed
    real listings toward a worse grade. German was mangled rather than erased: *"für die Qualität"*
    became `f`, `r`, `die`, `qualit`, `t`. Words are now matched in any script, and scripts written
    without spaces (Japanese, Chinese, Thai) are segmented properly.
  - **The wording check now says when it cannot run.** Incentive-disclosure detection is made of
    specific phrases; run against a language it has no list for it matched nothing and reported *"No
    incentive disclosures, boilerplate or generated-text patterns found"* — a clean bill of health
    from a check that never looked, and indistinguishable from a real one. Phrase lists were added
    for German, French, Spanish and Italian; every other language now reports the check as skipped.
    The generated-text heuristic stays English-only, because its thresholds were tuned on English
    prose and porting them untested would be a guess dressed as a measurement.
  - **Review dates** are read in every storefront language. French and Japanese dates never parsed,
    which silently switched off the review-timing and community-response checks on those domains.
  - **The rating histogram** required the literal word "star", making it unreadable — and the
    rating-distribution check permanently blind — on eleven of the fourteen storefronts.
  - Bare numeric dates such as `03/06/2026` are now **refused** rather than passed to `Date.parse`,
    which silently picks the American reading. A wrongly ordered sample would cost the timing check
    its honesty; an undated review only costs one signal.
- **A grade built on the rating breakdown alone no longer talks about reviews.** Every product page
  renders its histogram before the review module loads, and on a high-volume listing that histogram
  is enough to produce a grade with no reviews behind it. The panel was announcing that grade as
  *"Reviews look genuine"*, *"Nothing flagged across 0 visible reviews"*, *"Every check came back
  clear"* and an *Adjusted rating* identical to Amazon's own — directly above six rows reading *"No
  reviews were readable on this page"*. The grade is defensible; the words were not. That state now
  names itself in the panel, the popup and the verdict, and the adjusted rating is withheld rather
  than restated.
- **The panel could freeze on a page it could read.** The change detector counted
  `[data-hook="review"]` nodes — one entry in the five-deep fallback chain the parser tries — so on
  any layout served through a different entry it never noticed reviews arriving. It is now derived
  from the parser's own output and cannot drift out of step with it.
- **The panel could fail to appear at all.** The 400 ms settle timer was a plain trailing debounce,
  and Amazon pages mutate continuously, so every carousel tick reset it. There is now a two-second
  deadline.
- **Re-rendering no longer discards what the user was doing.** An opened breakdown stayed open, a
  recorded disagreement keeps its acknowledgement, and keyboard focus is returned to the control it
  was on — previously it was lost entirely, dropping a keyboard or screen-reader user back to the top
  of a very long page with no announcement.
- Exporting the feedback log revoked its object URL in the same task that started the download, which
  can cancel it.

Found by running the packaged build against a live listing (a camera lens, 234 ratings, 76% five-star
with a healthy 4% one-star tail — graded A at 96/100, correctly):

- **The summary reported the flattering count and not the other one.** It read *"1 of 13 visible
  reviews discounted."* and stopped, while three separate checks had flagged reviews between them.
  Nothing said was false, and a shopper who opened the breakdown found several times more than the
  headline had prepared them for. This is the 0.2.0 *"nothing flagged"* defect mirrored — understating
  is not the safe direction just because it is the flattering one. Both counts are now always
  reported, in the panel and in the verdict.
- **"1 of the 13 visible reviews *were* discounted."** The verb now agrees with the count.
- **Missing helpful votes no longer flag a low-traffic listing.** The check needed only 200 ratings
  before it would treat "nobody voted on this" as odd. On a 234-rating listing almost nothing gets
  voted on, so the absence of votes carried no information and the panel showed a caution badge
  anyway. The floor is now 1,000. The check's premise — that Amazon features reviews partly by
  helpfulness — only holds where voting actually happens, and crying wolf on ordinary listings is the
  failure that destroys trust in a tool like this fastest.
- **The breakdown said "Removing this check on its own would not change the grade" seven times.**
  Seven identical copies of the same non-answer is noise wearing the costume of transparency. The line
  is now shown only where a check actually flagged something, or where the answer is yes.
- **The panel no longer runs text the full width of a wide monitor.** Amazon's review section spans
  the whole column, which stretched the verdict paragraph past 200 characters a line.

### Added
- **"What you can check yourself"** — a collapsed checklist in the panel, offered in every state
  including the ones where Winnow has nothing to say. It opens by stating plainly what Winnow cannot
  see (the seller, the price, where it ships from, whether the product is any good) and then hands
  over six checks that cover the rest, each doable in under a minute on the page already open.

  This exists because the person most exposed to a bad listing is the one least likely to know what
  the panel means. A first-time buyer reads *"Reviews look genuine"* as *"this is safe to buy"*,
  which is neither what it says nor what it can mean. The answer is not a wider claim — it is saying
  where the claim stops.

  **On dropshipped and rebadged listings specifically:** Winnow does not detect them and this release
  does not pretend to. Nothing in review text reliably separates a generic product resold under a new
  brand from an ordinary one, and a detector built on that guess would put an accusation on screen
  with nothing behind it. What is honest is describing the pattern from the outside so a shopper can
  recognise it — the same photos under several unfamiliar brands, reviews describing a different
  product, a new listing that already has hundreds of five-star ratings. The middle one the engine
  already has a real signal for; the checklist covers the others.
- **Plain-English glosses under each number.** "Adjusted rating", "Trust score" and "Confidence" are
  obvious to whoever built them and opaque to a first-time buyer, so each now carries a one-line
  explanation in words that need no translation.

### Changed
- **The panel no longer calls a review "discounted".** That is the engine's word for a review it
  stopped counting — and on a shopping site it is also the word for money off, a few inches from a
  real price. It now says "set aside", which cannot be misread.
- `optional_host_permissions` now covers `https://localhost` and `https://127.0.0.1`, which the dev
  endpoint validator already accepted. Still loopback-only, still optional, still absent from a
  normal install.

### Testing
- Two new suites: `tests/i18n.test.ts` and `tests/lifecycle.test.ts`. Both were mutation-checked —
  each fix was reverted in turn and the corresponding tests confirmed to go red — because a test that
  passes against the broken code measures nothing.
- A German corpus fixture (`tests/corpus/synthetic-de-padded-listing.html`) drives the whole
  localisation through the real parser and engine: column-layout German histogram, German dates,
  German incentive disclosures. The two English cases are byte-identical to before.
- The rating-breakdown-only panel state was added to the axe audit list at the same time as the state
  itself. A UI branch that is not in that list is untested by construction.

## [0.2.0]

Engine version moves to `0.2.0` alongside the extension. The panel prints the engine version so a
grade can be traced to the logic that produced it, and this release changes how a grade is reached —
leaving it at `0.1.0` would make results from the old and new scoring indistinguishable.

### Added
- **Per-signal contributions.** Every check now reports what the grade would have been without it,
  computed by re-running the engine with that check switched off, and the panel shows it in the
  breakdown. Deliberately not a weight or a percentage: the discounted-share cap can override the
  weighted score outright, and its corroboration gate makes each check's effect depend on which
  other checks fired, so a share-of-total bar would confidently misdescribe how the grade was
  actually reached. Leave-one-out is the only honest measurement here, and it is also what makes a
  rejected grade diagnosable rather than merely noted.
- **A frozen page corpus** (`tests/corpus/`, `npm run corpus:freeze`). Whole pages run through the
  parser *and* the engine, compared against a recorded result. The existing calibration suite builds
  snapshots by hand and so never exercises a selector — a change that broke parsing entirely could
  leave it green. Ships with two synthetic fixtures and a DevTools capture tool
  (`tools/capture-corpus.js`) that rebuilds a page from only the parser-relevant elements rather
  than filtering a copy, so account markup and session tokens cannot survive by being overlooked.
  The suite pins the clock to each capture's timestamp, since `helpfulness` measures review age
  against `Date.now()` and the fixtures would otherwise change grade as they aged.
  **This catches our drift and cannot catch Amazon's** — that remains the runtime coverage check's job.
- **A local feedback log.** "Too harsh" / "Too lenient" on the panel records the grade and the
  per-signal contributions to `chrome.storage.local`, capped at 200 entries, identified by a hash of
  the ASIN and stamped with a date rather than a time. Never transmitted, and there is no code path
  that could: exporting is a manual download from the options page. A server-side version would have
  been more useful and would have broken the no-telemetry promise this product is sold on.

### Changed
- **A featured-review sample can no longer reach full confidence.** Sample confidence saturated at
  1.0 around 25 reviews, which asserts that a large enough sample of *Amazon's chosen* reviews is a
  complete read on the review base. Size and representativeness are different things and only the
  first improves with count — the featured-selection bias does not shrink at n=25, and Amazon can
  change that selection without this code changing. Featured samples are now capped at 0.75;
  `/product-reviews/` listing pages, which are not hand-picked per product, keep the full range.
  In practice this makes the adjusted rating meaningfully less assertive on large product-page
  samples. Snapshots now carry `sampleSource` to record which kind of page they came from.

### Fixed
- **Cross-product template reuse could not fire in normal use.** Phrase corroboration was tracked
  per phrase/product *pair*, which required the same product to be deep-analysed on two separate
  calendar days before its text counted toward anything. Organic traffic rarely does that — most
  products are analysed once, ever — so the strongest signal in the system was effectively dark in
  precisely the case it exists for: one template across many products, each seen once. A farm
  template on five unrelated products measured a spread of zero and reported "no templated text
  detected". Corroboration is now tracked per phrase across the whole corpus, so a phrase counts
  once it has been seen on two separate days anywhere. The anti-poisoning floor is unchanged: a
  single-day burst still scores zero, however many products or submissions it involves, and any one
  phrase/product pair still counts at most once per day. Regression tests cover both directions.
- The retention sweep now drops phrase day-records alongside the phrases they corroborate, so a
  pruned phrase cannot return already-corroborated.

- **The reviewer-id salt could be lost silently.** Reviewer ids are HMAC-hashed, and a missing
  `WINNOW_HASH_SALT` falls back to a random per-process salt. If a deploy restarted without it, or
  it was rotated, every stored reviewer hash became unmatchable and the reviewer-network signal
  reported "no unusual overlap" about a corpus it could no longer read — indistinguishable from a
  clean product. The corpus now stores a fingerprint of the salt (never the salt) and compares it at
  boot: unset warns, changed errors and names how many reviewer hashes were orphaned.
- **Non-text contrast had never been computed.** The breakdown toggle's border sat at 1.52:1 (light)
  and 1.81:1 (dark) against a 3:1 requirement; darkened to 3.31:1 and 3.75:1. WCAG 1.4.11 moves from
  Partial to Met.

### Added — verification
- `tools/deep-smoke.mjs` — end-to-end smoke test running the real extension request builder over
  real HTTP through the real sanitiser and corpus. Covers the seam the unit suites stub out, and
  asserts the privacy guarantees against the actual serialised wire format. `npm run smoke`.
- **Signal liveness suites** for all ten signals — each must flag a maximally adversarial input and
  stay silent on an ordinary one. A signal that cannot fire is indistinguishable from a signal that
  found nothing, which is the difference the whole product rests on. A new signal without a liveness
  case fails the build.
- **Service-worker tests.** The worker is the only code that touches a network and had none. Covers
  that the developer endpoint cannot point anywhere but loopback, that no cookies or credentials or
  referrer are sent, and that errors do not leak response bodies.
- **Popup, options and content-script suites**, including the deep-analysis click driven end to end
  through a real product page, real parser, real engine and real shadow-root panel.
- **axe-core audit** across all 14 panel states (WCAG 2.0/2.1/2.2 A and AA plus best-practice), with
  an explicit proof that axe crosses the shadow boundary before any clean result is trusted.
- Non-text contrast is now computed in CI alongside text contrast.

### Changed
- Dev toolchain moved to Vitest 4 and esbuild 0.28, clearing five advisories (one critical) that
  were failing CI's `npm audit` gate on both packages. Nothing shipped was ever affected —
  `npm audit --omit=dev` was already clean.

### Added — deep-analysis server
- `server/` — zero-dependency deep-analysis service on Node's built-in SQLite and HTTP server,
  computing the three signals a single page cannot support: cross-product template reuse, reviewer
  networks, and review hijacking via rating/title history. Results cached per ASIN so cost scales
  with products rather than users.
- Deep analysis in the extension, behind an explicit user click. The grade is still computed
  locally — the server contributes evidence, never a verdict.
- Strict request sanitisation that **rejects** unknown fields rather than ignoring them, so a client
  that ever started sending user identity would fail loudly. Reviewer ids are HMAC-hashed before
  storage; product titles are sent only as hashes; reviewer display names never leave the browser.
- Security hardening: locked-down CORS (extension origins only, constant-time when pinned), rate
  limiting on hashed addresses held in memory only, security headers, body-size caps, parameterised
  SQL, request timeouts, and deliberately no request logging.

### Added — accessibility and compliance
- WCAG 2.2 AA pass on the panel: landmark region, text alternative for the grade, status never
  carried by colour alone, keyboard operation with a visible focus indicator, ≥24px targets,
  `aria-expanded`/`aria-controls`/`aria-busy`, a `role="status"` live region for async results, and
  `prefers-reduced-motion` support.
- `SECURITY.md` — threat model, hardening, deployment requirements, and known gaps stated plainly.
- `docs/COMPLIANCE.md` — WCAG 2.2 AA / ADA / EN 301 549, GDPR, EU AI Act and Chrome Web Store
  policy, each marked Met, Partial or Outstanding.
- UI polish: entry animation, loading state with spinner, refined type and colour scales.

### Changed
- **`PRIVACY.md` rewritten.** It previously claimed Winnow makes no network requests, full stop.
  Deep analysis makes that untrue, so the policy now separates the default local-only mode from the
  optional service and enumerates exactly what is and isn't sent.
- Packaging guard extended to allow the single API endpoint while still failing on any other host.

### Added
- Options page, doubling as the public statement of data handling, the no-affiliate commitment,
  and the limits of what Winnow claims.
- `tools/selector-probe.js` — pasteable DevTools diagnostic reporting which parser selector chains
  still match on a live Amazon page.
- `npm run package` — builds and zips for the Chrome Web Store, aborting if the manifest gains an
  unexpected permission or a non-Amazon host.
- `PRIVACY.md`, `LICENSE` (MIT), and Chrome Web Store listing copy with permission justifications.

### Fixed
- `alwaysExpand` was defined in settings but never read; the panel always rendered collapsed.
- Winnow no longer renders on Amazon's bot-check interstitials. Those pages keep the `/dp/<ASIN>`
  URL while serving no product content, so the ASIN parsed successfully and a "couldn't read this
  page" panel was mounted on top of a captcha wall.

## [0.1.0] — 2026-07-26

Initial build.

### Added
- Local-first scoring engine (`src/core`), pure and dependency-free so it can be independently
  audited. Six per-review signals — verified purchase, review language including incentive
  disclosures and generated-text patterns, trigram near-duplicate detection, temporal bursts,
  content substance, and helpful-vote absence — plus a product-level rating-distribution signal
  keyed on the 1-star tail that campaigns can add to but cannot remove.
- Adjusted rating estimation, back-solved from the estimated manipulation share and shrunk toward
  the displayed rating by sample confidence. Returns no figure at all, rather than a fabricated
  one, when too little of the sample looks trustworthy.
- Amazon DOM parser with per-field fallback chains, degrading to partial data instead of failing.
- Shadow-DOM on-page panel, toolbar popup, and service worker.
- 51 tests across the engine and parser.
