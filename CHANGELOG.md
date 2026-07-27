# Changelog

All notable changes to Winnow are recorded here. The scoring engine carries its own version
(`ENGINE_VERSION` in `src/core/score.ts`), shown in the on-page panel, so a grade can always be
traced to the logic that produced it.

## [Unreleased]

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
