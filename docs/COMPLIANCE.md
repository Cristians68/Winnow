# Compliance

Where Winnow stands against the accessibility, data-protection and AI-transparency regimes that
apply to a consumer browser extension distributed in the US, UK and EU/EEA.

Status is stated honestly: `Met` means implemented and verifiable in code; `Partial` means
implemented but unverified against real conditions; `Outstanding` means not yet done.

---

## 1. Accessibility — WCAG 2.2 AA / ADA / EN 301 549

The European Accessibility Act applies to consumer-facing digital services in the EU, and EN 301 549
adopts WCAG 2.2 AA as its technical standard. US ADA case law converges on the same benchmark. So
WCAG 2.2 AA is the single target.

| Criterion | Implementation | Status |
|---|---|---|
| 1.1.1 Non-text Content | Grade badge is `role="img"` with a full text alternative ("Grade D of A to F. Many reviews look manipulated"); decorative star and spinner are `aria-hidden` | Met |
| 1.3.1 Info and Relationships | Panel is a `role="region"` landmark labelled by its heading; signals are a real `<ul>`; headings are genuine `<h2>` | Met |
| 1.4.1 Use of Color | Every status pill carries a text label (Clear / Caution / Flagged / No data). Colour is never the sole carrier of meaning | Met |
| 1.4.3 Contrast (Minimum) | All foreground/surface pairs ≥4.5:1 in both themes | **Met** — `tests/a11y.test.ts` parses the panel stylesheet and computes every pair, so a colour change that breaks WCAG fails CI |
| 1.4.11 Non-text Contrast | Focus indicator and control boundaries meet 3:1 | **Met** — `tests/a11y.test.ts` computes the focus ring against all three surfaces it can appear on, plus the toggle border and the deep-analysis button fill. Computing these found the toggle border at 1.52:1 (light) and 1.81:1 (dark); it was darkened to 3.31:1 and 3.75:1. The card border and footer divider are deliberately excluded as decorative separators — see the note in the test |
| 1.4.12 Text Spacing | No fixed heights on text containers; content reflows | Met |
| 2.1.1 Keyboard | Every control is a native `<button>` or `<a>`; no custom key handling to trap focus | Met |
| 2.4.3 Focus Order | DOM order matches visual order | Met |
| 2.4.7 Focus Visible | Explicit 3px `:focus-visible` outline with offset, overriding `all: initial` | Met |
| 2.4.11 Focus Not Obscured | Panel is inline in document flow, never overlaying or sticky | Met |
| 2.5.8 Target Size (Minimum) | All buttons ≥32px high, exceeding the 24×24 floor | Met |
| 3.1.1 Language of Page | `lang="en"` set on the panel, since it sits inside localised Amazon pages | Met |
| 3.2.2 On Input | Nothing auto-submits; deep analysis requires an explicit click | Met |
| 4.1.2 Name, Role, Value | `aria-expanded` + `aria-controls` on the disclosure; `aria-busy` while loading | Met |
| 4.1.3 Status Messages | Deep-analysis progress and results land in `role="status"` `aria-live="polite"` — announced without stealing focus | Met |
| 2.3.3 Animation from Interactions | `prefers-reduced-motion` removes entry animation and transitions | Met (AAA, done anyway) |

**Verified in CI:** 21 automated checks in `tests/a11y.test.ts` cover contrast, landmark structure,
text alternatives, disclosure wiring, live regions, target size, reduced motion and safe external links.

**Also verified in CI:** `tests/axe.test.ts` runs the axe-core rule set (WCAG 2.0/2.1/2.2 A and AA,
plus best-practice) across all 14 states the panel can be in — collapsed, expanded, light, dark,
each grade, insufficient-data, and all four deep-analysis states. Zero violations.

Two honest qualifications on that result:

- **axe catches roughly 30–50% of WCAG issues.** Passing is necessary, not sufficient. It finds
  missing names, broken relationships and invalid ARIA; it cannot judge whether the panel's wording
  makes sense when read aloud, or whether the reading order tells a coherent story.
- The panel renders inside a shadow root, so the suite explicitly proves axe crosses that boundary
  before trusting any clean result. Without that check, a tool unable to see into the shadow DOM
  would report zero violations on markup it never inspected — a passing build that verified nothing.

**Outstanding:** a real screen-reader run (NVDA + VoiceOver), which cannot be automated and which
the above does not substitute for.

---

## 2. Data protection — GDPR / UK GDPR / CCPA

| Requirement | Position |
|---|---|
| Lawful basis | Default mode processes no personal data at all. Deep analysis processes pseudonymised **reviewer** identifiers under legitimate interest (Art. 6(1)(f)) — see PRIVACY.md for the balancing rationale |
| Data minimisation (Art. 5(1)(c)) | Title sent as a hash; reviewer ids HMAC-hashed before storage; review text stored only as phrase hashes; reviewer *display names* never leave the browser (enforced in code, covered by a test) |
| Purpose limitation | Corpus is used solely to detect review manipulation |
| Storage limitation (Art. 5(1)(e)) | **Implemented** — `Corpus.pruneExpired()` deletes reviewer rows 24 months after last sighting, runs at boot and daily, covered by tests |
| Integrity and confidentiality (Art. 5(1)(f)) | TLS in transit; HMAC at rest; no request logging; strict input allowlisting |
| Data subject rights | No user data exists to access or erase. Amazon reviewers may request removal of their hashed identifier |
| Automated decision-making (Art. 22) | Grades concern products, not people, and carry no legal or similarly significant effect on any individual. Reasoning is disclosed in-product |
| Records of processing (Art. 30) | This document plus PRIVACY.md |
| International transfers | **Outstanding** — depends on where the service is hosted. EU hosting is the simplest answer and is recommended before EU launch |
| CCPA "sale" of personal information | None occurs. No data is sold, shared or disclosed |

**Outstanding before EU launch:** choose a hosting region and appoint an EU representative if
required under Art. 27. The retention job is implemented and scheduled.

---

## 3. EU AI Act

Winnow's generated-text detection is a statistical classifier, which brings it within scope as an
AI system even though it uses no machine-learning model.

| Aspect | Position |
|---|---|
| Risk classification | **Minimal risk.** Not in any Annex III high-risk category — it evaluates product reviews, not people's access to employment, credit, education or services |
| Art. 50 transparency | The panel states plainly that results are estimates rather than proof, names each signal, and shows the evidence behind it. Confidence is displayed rather than hidden |
| Prohibited practices (Art. 5) | None. No biometric categorisation, emotion inference, social scoring or manipulative technique |
| Accuracy and contestability | Every flagged review shows why it was flagged, so a user can disagree with the reasoning directly. The detector is deliberately calibrated to under-flag: a false accusation against a genuine reviewer damages trust far more than a missed fake |

---

## 4. Chrome Web Store policy

| Requirement | Position |
|---|---|
| Single purpose | Review-integrity analysis on Amazon product pages. Nothing else ships |
| Minimum permissions | `storage` only, plus Amazon storefronts. **No other host permission at all** — the published build reaches no server, so it asks for nothing it does not use. Loopback is an *optional* permission, requested at the moment a developer configures a local endpoint. `npm run package` **fails the build** if any of this drifts |
| No remote code | All code is bundled. Nothing is fetched and evaluated |
| Affiliate-link policy | Winnow injects no affiliate links and rewrites no links. This policy exists because of the 2024 Honey affiliate-hijacking scandal; Winnow is positioned as its opposite |
| Disclosure of data use | PRIVACY.md, linked from the listing, the popup and the options page |

---

## 5. Security posture

See [SECURITY.md](../SECURITY.md).

---

## Verification checklist before public launch

- [x] **Repository made public** — the panel, popup, options page and privacy policy all state the
      engine is open source "so you can check". While the repo is private that claim is false, and a
      trust product cannot ship a false claim about its own verifiability.
      Done: <https://github.com/Cristians68/Winnow>
- [x] **No host permission the build does not use.** The published build reaches no server, so the
      hosted endpoint and its host permission were removed rather than shipped unused and pointing at
      a domain this project does not own
- [ ] Manual screen-reader pass (NVDA on Windows, VoiceOver on macOS)
- [ ] One known-manipulated listing checked end to end, to confirm the thresholds match reality
      rather than only the fixtures

### Not required for the local-only launch

The published extension has no server, so none of the following gate a Chrome Web Store submission.
They become required the moment deep analysis is enabled — at which point the privacy policy, the
manifest and this checklist all change together.

- [ ] Hosting region chosen and documented; EU representative appointed if required
- [ ] `WINNOW_HASH_SALT` provisioned from a secret manager, never from source — and **kept stable
      across deploys**. The server warns at boot when it is unset and errors when it has changed
      under an existing corpus, but nothing can recover reviewer hashes computed under a lost salt
- [ ] `WINNOW_ALLOWED_ORIGINS` pinned to the published extension id
- [ ] TLS termination configured; HSTS confirmed in production
- [ ] Penetration test of the `/v1/analyse` endpoint
- [ ] A domain that this project actually owns, for the API and the landing site
