# Sponsorship: how Winnow earns

Winnow carries one sponsored message in its own two windows — the toolbar popup and the settings
page. It never appears on an Amazon page and never appears beside a grade.

**The slot ships dark.** Every network in `src/shared/ads/registry.ts` has `configured: false`, so
the build grants no advertising host permission and makes no ad request. That is deliberate: a
host permission to a domain nobody verified is the one mistake this project has already made in a
released build (`api.winnow.app`, which belonged to someone else). Turning a rail on is three
lines, documented below, and each one requires something real to exist first.

---

## The rule that governs all of this

**Money must never be able to reach a verdict.**

That is why the request carries a schema version, the slot name, and the formats the slot can
render — and nothing else. The sponsor is not told which product you are viewing, so it cannot buy
placement against a listing. Not because we decline to sell that, but because the information
never leaves the machine.

If you ever find yourself wanting to send the ASIN "just for relevance", stop. That single change
turns Winnow into the thing it was built to expose, and no amount of disclosure repairs it.

Enforced by `tests/ads-policy.test.ts` (the request key set is pinned) and
`tests/ads-containment.test.ts` (no ad code or network call reaches the content scripts, with
controls proving the checks can fail).

---

## Rail 1 — Direct sponsors (start here)

Sell the slot yourself. No third party, no account to be approved for, no revenue share, and a
far better rate than programmatic pays a tool this size. A niche developer-adjacent audience is
worth more to the right sponsor than a CPM auction will ever pay for it.

**What you need:** a static JSON file on a domain **you actually own**.

1. Deploy `site/` to a Vercel project under your own account:
   ```
   cd site && npx vercel --prod
   ```
   Note the URL it gives you. Do **not** assume `winnow.vercel.app` — that is an unrelated AI
   writing product owned by somebody else. Verify with `npx vercel project ls` that the project is
   in your account before using its domain anywhere.

2. Edit `site/sponsors.json` — it already exists with one example entry:
   ```json
   [
     {
       "headline": "Your sponsor's one-line pitch",
       "body": "One sentence of supporting copy.",
       "advertiser": "Sponsor Name",
       "clickUrl": "https://<your-domain>/go/sponsor-name",
       "imageUrl": null,
       "viewUrl": null
     }
   ]
   ```
   A **list** rotates: Winnow picks one per slot render, client-side. That keeps the host a static
   file — no server, no request logs, nothing running — and it is also the privacy-preserving
   choice, since a server that rotated for us would have to observe every request to do it. An
   entry that fails validation is skipped rather than taking the file down with it.

   `clickUrl` and `imageUrl` must be on the **same origin** as the manifest — see
   `isAllowedCreativeUrl`. Use a redirect path on your own domain (`/go/...`) so you can measure
   clicks and swap destinations without shipping an extension update, which is the difference
   between selling a sponsorship and selling a hardcoded link.

   Rotation happens per render, so a sponsor paying for a share of impressions gets roughly that
   share. If you sell unequal shares, repeat an entry — two copies of a sponsor is two thirds of
   a three-entry file. There is deliberately no weight field: a number that silently changes what
   an advertiser paid for is worth less than a list you can read.

3. In `src/shared/ads/registry.ts`, on the `direct` entry: set `origin` to your deployed domain
   and `configured: true`.

4. `npm test && npm run package`. The packaging guard will fail loudly if the manifest and the
   registry disagree.

**Pricing anchor:** a flat monthly rate, quoted against active installs, is easier to sell and to
honour than CPM at this scale. Whatever you quote, quote real numbers — the Chrome Web Store
dashboard is the source, not an estimate.

---

## Rail 2 — EthicalAds (when installs justify it)

Privacy-first by construction: no cookies, no cross-site tracking, no user profile. It is the only
widely available network whose data model does not contradict this extension's privacy policy,
which is why it is the one adapter here that is real.

**What is already known, from probing it:**

- `server.ethicalads.io` resolves and answers (Cloudflare-fronted). It is a real service.
- It returns **HTTP 403 to non-browser clients**, so you cannot explore the API with `curl`.
- Its documented client issues a **GET with query parameters** (`publisher`, `ad_types`,
  `div_id`), not a POST with a JSON body. The registry entry reflects this.
- It **will not serve without a publisher account id**.

**Turning it on:**

1. Apply at <https://www.ethicalads.io/publishers/>. Approval is manual and they do turn people
   down; a listing with a handful of installs may not qualify yet.
2. Put the publisher id in the `ethical` entry's `params.publisher`.
3. Set `configured: true` **in the same commit**. `tests/ads.test.ts` fails a network that is
   configured with an empty required parameter, precisely so a half-finished switch-on cannot ship.
4. Confirm the live response field names against `normaliseCreative` in
   `src/shared/ads/providers.ts`. If they differ, map them there — do not loosen the validation.
   A creative that fails validation renders nothing, which looks exactly like "no ad available",
   so a field-name mismatch is silent. Check the slot actually fills before believing it works.

Expect the Chrome Web Store to re-review: the build gains its first non-Amazon host permission.
The justification text belongs in `docs/host-permission-justification.txt` (that field caps at
1000 characters and truncates silently — it has bitten this project before).

---

## Rail 3 — PlayYield

An adapter exists; the network does not, as far as anything reachable shows. `playyield.com`
serves a GoDaddy for-sale parking page, and `playyield.io/.net/.ai/.co/.org` do not resolve. It is
kept in the registry with `configured: false` so wiring a real endpoint is a registry edit rather
than a redesign — but it gets no host permission until there is something real to point at.

If you have a working endpoint for it, the only things needed are the origin, the path, the
transport, and a look at the response shape against `normaliseCreative`.

---

## The part that actually determines revenue

Revenue is installs × rate, and the rate work is now done. **The installs are not.**

`winnow-0.5.0-chrome.zip` and `winnow-0.5.0-firefox.zip` are built and verified, and neither has
been uploaded — nor was 0.4.0. An extension that is not in a store earns nothing regardless of how
good its ad plumbing is, and a competitor with the same pitch (SureVett) reached ~500 users on an
SEO content engine while this sat at an install count too low for the store to display.

No ad network will approve a publisher with no traffic, either. So the order is: upload, then
build installs, then apply to a network — not the reverse.
