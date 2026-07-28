# Changelog

All notable changes to Winnow are recorded here. The scoring engine carries its own version
(`ENGINE_VERSION` in `src/core/score.ts`), shown in the on-page panel, so a grade can always be
traced to the logic that produced it.

## [Unreleased]

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
