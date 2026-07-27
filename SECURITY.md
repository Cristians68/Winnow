# Security

## Reporting a vulnerability

Open a security advisory at <https://github.com/Cristians68/Winnow/security/advisories> rather than a
public issue. We aim to acknowledge within 72 hours.

If you find a way to make Winnow transmit anything about a *user* rather than a *product listing*,
treat it as critical and report it immediately — that is the guarantee the whole product rests on.

---

## Threat model

Winnow's unusual property is that it has **almost nothing worth stealing**. There are no accounts,
no passwords, no payment details, no personal data and no browsing history. That is a deliberate
security design, not an accident of scope: the most reliable way to protect data is not to hold it.

What remains worth defending:

| Asset | Threat | Mitigation |
|---|---|---|
| The user's Amazon account | Winnow triggering anti-bot enforcement against them | No automated requests to Amazon, ever. Only already-rendered DOM is read |
| The claim "we send nothing about you" | A code change silently widening the payload | Server **rejects** unknown fields; client builds payloads field by field; both covered by tests |
| The corpus | Poisoning to launder a manipulated product | Per-ASIN caching, rate limiting, content-derived review keys. See "Known gaps" |
| Reviewer identifiers | Disclosure of who reviewed what | HMAC-hashed with a server-side secret before storage; raw values never written |
| The extension itself | Supply-chain compromise | Zero runtime dependencies. Four dev dependencies, none shipped |

---

## Extension

- **Minimum permissions.** `storage` only, plus Amazon hosts and one API endpoint. `npm run package`
  fails the build if this drifts.
- **No remote code.** Everything is bundled; nothing is fetched and evaluated. No `eval`, no
  `innerHTML` — all DOM is built with `createElement`/`textContent`, so review text cannot inject
  markup into the panel.
- **Shadow DOM isolation** in `mode: 'open'` — chosen over `closed` because it offers no real
  security benefit against page script while making the panel inspectable and auditable.
- **Network access lives in one file.** Only the service worker can fetch, and only to a single
  pinned endpoint, with `credentials: 'omit'`, `cache: 'no-store'` and `referrerPolicy: 'no-referrer'`.
- **No ambient authority.** The content script holds no network capability at all.

## Server

- **Strict input allowlisting.** Every field is validated by type, range and format; unknown fields
  are rejected rather than ignored. Body size capped before parsing.
- **Parameterised SQL everywhere.** No string interpolation reaches a query.
- **Locked-down CORS.** Only `chrome-extension://` / `moz-extension://` origins, with constant-time
  comparison when specific ids are pinned via `WINNOW_ALLOWED_ORIGINS`. Web origins are refused.
- **Rate limiting.** 60 requests per minute per hashed address, in memory, discarded on a timer.
- **Security headers.** `nosniff`, `DENY` framing, `no-referrer`, restrictive CSP, HSTS, `no-store`.
- **No request logging.** Not addresses, not ASINs, not bodies. Errors log a message only — never
  request content.
- **No detail leakage.** Validation errors describe the caller's own payload; everything else
  returns an opaque 500.
- **Timeouts.** 10s headers, 20s request, bounding slow-loris exposure.

### Deployment requirements

- `WINNOW_HASH_SALT` **must** be set from a secret manager. Without it a random per-process salt is
  generated, which is safe but makes the corpus non-portable across restarts — deliberately chosen
  over a guessable default.
- `WINNOW_ALLOWED_ORIGINS` should pin the published extension id once known.
- `WINNOW_TRUST_PROXY=1` only behind a proxy that overwrites `X-Forwarded-For`. Otherwise the header
  is ignored and rate limiting cannot be trivially evaded by spoofing it.
- Terminate TLS at the edge. HSTS is sent, so the service must never be served over plaintext.

---

## Known gaps

Stated plainly rather than omitted.

1. **Corpus poisoning.** A determined attacker could submit fabricated observations to make a
   product look clean, or to make a competitor look manipulated. The sharpest version is framing:
   submitting a rival's genuine review text under other ASINs until it looks like a farm template.

   Defences in place: rate limiting, per-ASIN caching, and **time-based corroboration** — a phrase
   contributes nothing to any other product's score until it has been observed on at least two
   separate calendar days (`MIN_CORROBORATION` in `server/src/db.ts`), and any single phrase/product
   pair counts at most once per day. A burst of fabricated submissions, however large, therefore
   scores zero: verified at four ASINs × 50 submissions in one day → spread 0.

   What this does **not** solve: because clients cannot be identified — that is the privacy
   guarantee — "independent" is approximated by elapsed time, so an attacker willing to spread the
   same submissions across two days pays little. Cross-submission agreement checks, trusting a claim
   only when genuinely independent clients corroborate it, remain the intended fix and are not built.
2. **The endpoint is unauthenticated.** Appropriate while the service is free, but it means anyone
   can contribute to the corpus. This is the same problem as (1).
3. **`node:sqlite` is an experimental Node API.** Its interface may change. Acceptable for a corpus
   that can be rebuilt from client contributions; revisit before it holds anything irreplaceable.
4. **Corpus poisoning remains the main open risk** — see (1). Everything else below is now closed.

Closed since first writing: dependency auditing runs weekly in CI, and the 24-month retention policy
is implemented in `Corpus.pruneExpired()` rather than merely documented.
