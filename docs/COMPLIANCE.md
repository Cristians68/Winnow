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
| 1.4.3 Contrast (Minimum) | All foreground/surface pairs selected for ≥4.5:1 in both light and dark themes | Partial — computed by design, not yet machine-verified |
| 1.4.11 Non-text Contrast | Focus indicator and control borders meet 3:1 | Partial |
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

**Outstanding:** an automated axe-core pass and a real screen-reader run (NVDA + VoiceOver). Neither
can be done without loading the extension on a live page.

---

## 2. Data protection — GDPR / UK GDPR / CCPA

| Requirement | Position |
|---|---|
| Lawful basis | Default mode processes no personal data at all. Deep analysis processes pseudonymised **reviewer** identifiers under legitimate interest (Art. 6(1)(f)) — see PRIVACY.md for the balancing rationale |
| Data minimisation (Art. 5(1)(c)) | Title sent as a hash; reviewer ids HMAC-hashed before storage; review text stored only as phrase hashes; reviewer *display names* never leave the browser (enforced in code, covered by a test) |
| Purpose limitation | Corpus is used solely to detect review manipulation |
| Storage limitation (Art. 5(1)(e)) | Reviewer rows retained 24 months from last sighting; analysis cache expires after 6 hours |
| Integrity and confidentiality (Art. 5(1)(f)) | TLS in transit; HMAC at rest; no request logging; strict input allowlisting |
| Data subject rights | No user data exists to access or erase. Amazon reviewers may request removal of their hashed identifier |
| Automated decision-making (Art. 22) | Grades concern products, not people, and carry no legal or similarly significant effect on any individual. Reasoning is disclosed in-product |
| Records of processing (Art. 30) | This document plus PRIVACY.md |
| International transfers | **Outstanding** — depends on where the service is hosted. EU hosting is the simplest answer and is recommended before EU launch |
| CCPA "sale" of personal information | None occurs. No data is sold, shared or disclosed |

**Outstanding before EU launch:** choose hosting region, appoint an EU representative if required
under Art. 27, and publish the retention job (the 24-month deletion is documented policy but is not
yet implemented as a scheduled task).

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
| Minimum permissions | `storage` only, plus Amazon hosts and one API endpoint. `npm run package` **fails the build** if this drifts |
| No remote code | All code is bundled. Nothing is fetched and evaluated |
| Affiliate-link policy | Winnow injects no affiliate links and rewrites no links. This policy exists because of the 2024 Honey affiliate-hijacking scandal; Winnow is positioned as its opposite |
| Disclosure of data use | PRIVACY.md, linked from the listing, the popup and the options page |

---

## 5. Security posture

See [SECURITY.md](../SECURITY.md).

---

## Verification checklist before public launch

- [ ] axe-core automated accessibility pass on the injected panel
- [ ] Manual screen-reader pass (NVDA on Windows, VoiceOver on macOS)
- [ ] Automated colour-contrast verification of every token pair
- [ ] Hosting region chosen and documented; EU representative appointed if required
- [ ] Retention job implemented and scheduled (24-month reviewer expiry)
- [ ] `WINNOW_HASH_SALT` provisioned from a secret manager, never from source
- [ ] `WINNOW_ALLOWED_ORIGINS` pinned to the published extension id
- [ ] TLS termination configured; HSTS confirmed in production
- [ ] Penetration test of the `/v1/analyse` endpoint
