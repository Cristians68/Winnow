# Winnow Ad Revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Winnow a real advertising revenue rail that renders only in Winnow's own UI, can never see or influence a verdict, and keeps every claim the product makes about itself literally true.

**Architecture:** Ads are fetched exclusively by the service worker (already the codebase's single network boundary) and rendered by hand into the popup and options page. No remote script ever executes — Chrome MV3's default `script-src 'self'` makes that impossible anyway, so every network's JS tag is off the table and a JSON-fetch-plus-local-render adapter is the only workable shape. Ad hosts live in one registry that generates the manifest and is checked by the packaging guard, mirroring how `src/core/marketplaces.ts` already governs Amazon hosts. Providers sit behind an interface so a new network is an adapter plus a registry entry.

**Tech Stack:** TypeScript, esbuild 0.28, vitest 4, happy-dom, axe-core (dev only). No runtime dependencies — this stays true.

## Global Constraints

- **Zero runtime dependencies.** No npm package may be added to `dependencies`. Ad rendering is hand-written DOM.
- **Ads never appear on an Amazon page.** The content scripts (`dist/content/*`) must contain no ad code at all. This is grep-enforced with a control.
- **The ad request carries nothing about the page.** No ASIN, no URL, no product title, no grade, no trust score, no review text, no user identifier. The request body key set is a fixed allowlist.
- **No cookies, no credentials, no referrer.** Every ad fetch uses `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`.
- **Remote text is never HTML.** Creative fields are assigned with `textContent`; image and click URLs must be `https:` and on a registry host.
- **"Sponsored" is never optional.** If a creative renders, the label renders. Enforced in every state.
- **Ads fail silently.** A dead or slow ad server must never degrade the grade UI. Timeout 6s, render nothing on any error.
- **Ads are switchable off** via a settings toggle, and the toggle is honoured before any network call is made.
- **No host permission to a domain we do not control or have not verified.** `playyield.com` is a parked GoDaddy for-sale page and `playyield.{io,net,ai,co,org}` do not resolve — it gets an adapter, not a manifest entry.
- **`ENGINE_VERSION` does not change.** Scoring is untouched by this work.
- Every claim-bearing document must be updated in the same commit as the behaviour that falsifies it: `PRIVACY.md`, `src/popup/ui/popup.html` footer, `site/index.html`, `README.md`, `CHANGELOG.md`.

---

### Task 1: Ad host registry and types

**Files:**
- Create: `src/shared/ads/types.ts`
- Create: `src/shared/ads/registry.ts`
- Test: `tests/ads.test.ts`

**Interfaces:**
- Produces: `AdCreative`, `AdProvider`, `AdProviderId`, `AdRequest`, `AdSlot`; `AD_HOSTS`, `adMatchPatterns(): string[]`, `isKnownAdHost(pattern: string): boolean`, `isAllowedCreativeUrl(url: string): boolean`.

- [ ] **Step 1: Write the failing test** in `tests/ads.test.ts` asserting `adMatchPatterns()` returns only `https://` patterns, that `isKnownAdHost` rejects `https://ads.example.evil.com/*` while accepting a registry host, and that `isAllowedCreativeUrl` rejects `http:` and `javascript:` URLs and any non-registry host.
- [ ] **Step 2: Run `npx vitest run tests/ads.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `types.ts` and `registry.ts`. The registry exports exact match patterns; `isKnownAdHost` compares against the generated pattern list by exact string equality — never a substring or unanchored regex, which was exactly the v0.4 guard hole.
- [ ] **Step 4: Run `npx vitest run tests/ads.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: name the hosts ads may ever come from, in one place`

---

### Task 2: The request policy — what an ad is allowed to know

**Files:**
- Create: `src/shared/ads/policy.ts`
- Test: `tests/ads-policy.test.ts`

**Interfaces:**
- Consumes: `AdRequest`, `AdSlot` from Task 1.
- Produces: `buildAdRequest(slot: AdSlot): AdRequest`, `AD_REQUEST_KEYS: readonly string[]`.

- [ ] **Step 1: Write the failing test.** Build a request, serialise it, and assert the JSON contains none of a sentinel list — an ASIN, a product title, a grade letter, a trust score, an Amazon URL. Assert `Object.keys(buildAdRequest('popup')).sort()` equals `AD_REQUEST_KEYS`, so a field added later fails the test rather than leaking quietly.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** `buildAdRequest` returns only schema version, slot name, and accepted creative format. Nothing else may exist on the type.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: fix by construction what an ad request may contain`

---

### Task 3: Provider adapters (direct sponsor + generic network)

**Files:**
- Create: `src/shared/ads/providers.ts`
- Test: `tests/ads-providers.test.ts`

**Interfaces:**
- Consumes: `AdCreative`, `isAllowedCreativeUrl` (Task 1); `buildAdRequest` (Task 2).
- Produces: `normaliseCreative(raw: unknown): AdCreative | null`, `providerFor(id: AdProviderId): AdProvider | null`, `PROVIDERS`.

- [ ] **Step 1: Write the failing test.** Feed a hand-written response object and assert it normalises to an `AdCreative`. Then feed hostile responses: a `javascript:` click URL, an image on a non-registry host, a missing label, an over-long body. Assert each returns `null` rather than a partial creative — a partial parse is worse than no parse, a lesson this codebase learned twice.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** normalisation plus `providerFor`. The network adapter takes endpoint and field mapping as config so a new network needs no new file.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: normalise ad responses, and refuse the ones we cannot trust`

---

### Task 4: Service-worker ad broker — the only place ads touch the network

**Files:**
- Create: `src/background/ads.ts`
- Modify: `src/background/index.ts`
- Test: `tests/ads-background.test.ts`

**Interfaces:**
- Produces: message handler for `{ type: 'winnow:ad-request', slot }` replying `{ ok, creative }`.

- [ ] **Step 1: Write the failing test.** Stub `fetch`, send the message, assert: the request URL is a registry host; `credentials` is `omit`; `cache` is `no-store`; `referrerPolicy` is `no-referrer`; the body parses to exactly `AD_REQUEST_KEYS`. Then assert that with ads disabled **no fetch happens at all**, and that a rejected fetch, a 500, and a timeout each resolve to a null creative rather than throwing.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror the deep-analysis handler's shape: AbortController, 6s timeout, settings read before any network call.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: broker ad requests from the worker, or not at all`

---

### Task 5: Renderer and popup slot

**Files:**
- Create: `src/shared/ads/render.ts`
- Modify: `src/popup/index.ts`, `src/popup/ui/popup.html`
- Test: `tests/ads-render.test.ts`

**Interfaces:**
- Produces: `renderAd(host: HTMLElement, creative: AdCreative | null): void`, `mountAdSlot(host: HTMLElement, slot: AdSlot): Promise<void>`.

- [ ] **Step 1: Write the failing test.** Render a creative whose headline is an `img onerror` payload and assert the host contains zero `img` elements from that string while the literal text is present — proving `textContent`, not `innerHTML`. Assert a Sponsored label exists whenever any creative renders, and that a null creative leaves the host empty.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the renderer and mount it in the popup below the grade state.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: show a labelled sponsor slot in the popup`

---

### Task 6: Settings toggle and options UI

**Files:**
- Modify: `src/shared/settings.ts`, `src/options/index.ts`, `src/options/ui/options.html`
- Test: `tests/options.test.ts`

- [ ] **Step 1: Write the failing test** asserting the ads setting exists in `DEFAULT_SETTINGS`, that the options page renders a control bound to it, and that turning it off persists.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: let people turn sponsorship off`

---

### Task 7: The containment proof

**Files:**
- Test: `tests/ads-containment.test.ts`

- [ ] **Step 1: Write the failing test.** Build `dist/`, then assert `dist/content/index.js` and `dist/content/serp.js` contain no ad marker and no `fetch(`. **Include the control**: assert the same search over `dist/background/index.js` DOES find both, proving the assertion can fail rather than passing vacuously. This codebase has been bitten repeatedly by checks that could not fail.
- [ ] **Step 2: Run it.** Expected: FAIL until wired.
- [ ] **Step 3: Implement** the assertions.
- [ ] **Step 4: Run it.** Expected: PASS, including the control.
- [ ] **Step 5: Commit** `test: prove ads never reach the page Winnow analyses`

---

### Task 8: Manifest generation and packaging guard

**Files:**
- Modify: `build.mjs`, `package.mjs`
- Test: `tests/ads-packaging.test.ts`

- [ ] **Step 1: Write the failing test** asserting the generated manifest's `host_permissions` equals Amazon patterns plus exactly the ad registry patterns, and that content-script matches stay Amazon-only — an ad host must never become a content-script grant.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Extend the guard's allowlist to accept a known Amazon host or a known ad host — never by loosening the regex.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: generate and guard the ad host permission`

---

### Task 9: Tell the truth everywhere

**Files:**
- Modify: `PRIVACY.md`, `src/popup/ui/popup.html`, `site/index.html`, `README.md`, `CHANGELOG.md`
- Test: `tests/claims.test.ts`

**Why this is a task and not a chore:** `PRIVACY.md` lists "advertising" under *What Winnow does not do*, and the popup footer says Winnow "makes no money today". Shipping ads makes both false. The policy itself specifies the remedy — announced prominently, never altered quietly.

- [ ] **Step 1: Write the failing test.** Assert no shipped copy claims Winnow runs no advertising or makes no money, and assert the no-seller-payment clause is still present verbatim — that promise is unchanged and is now load-bearing.
- [ ] **Step 2: Run it.** Expected: FAIL on current copy.
- [ ] **Step 3: Rewrite the copy.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `docs: say plainly that Winnow carries ads, and what they cannot do`

---

### Task 10: Accessibility of the new UI

**Files:**
- Modify: `tests/axe.test.ts`

**Why:** v0.2.0 shipped a feedback section that rendered in *zero* audited states because the suites never passed `onFeedback`, while 290 tests stayed green. An optional-prop UI branch is untested by construction unless the state is added to the audit list.

- [ ] **Step 1: Add the ad-bearing state to the axe state list.**
- [ ] **Step 2: Run `npx vitest run tests/axe.test.ts`.**
- [ ] **Step 3: Fix any contrast or labelling violations.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `test: audit the sponsor slot like every other state`

---

### Task 11: Release

- [ ] **Step 1:** Bump `package.json` to `0.5.0`. CWS rejects re-uploading an existing version number.
- [ ] **Step 2:** `npm test` — all green.
- [ ] **Step 3:** `npm run typecheck` — clean.
- [ ] **Step 4:** `npm run package` — both zips.
- [ ] **Step 5:** Verify inside the zips, not just the build log.
- [ ] **Step 6: Commit** `Release 0.5.0`
