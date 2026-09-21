# Winnow Privacy Policy

**Last updated:** 26 July 2026
**Applies to:** the Winnow browser extension and the Winnow deep-analysis service, all versions.

---

## The short version

Winnow has no account, no analytics, and no tracking of any kind.

**The version you can install today makes no network requests whatsoever.** Grading happens entirely
on your own device, and the extension holds no permission to contact any server — only Amazon's own
pages, which your browser is loading anyway. You can verify that in `manifest.json`: outside Amazon
storefronts, the host permission list is empty.

Part 2 below describes **deep analysis**, an optional feature that would send information about a
*product listing* — never about you — and only when you click a button to ask for it. It is not
enabled in the published build: there is no service running, so the extension ships with no endpoint
and the button is hidden. The section is kept because the code is in the open repository and can be
run against your own local server, and because you should be able to read what a future version
would do before it does it. If that changes, this policy and the requested permissions change with
it, visibly.

---

## Part 1 — What happens on your device (the default)

When you open an Amazon product page, Winnow reads content your browser has **already rendered**:
the product's rating, the rating breakdown, and the reviews visible on the page.

That data is scored in memory, on your device, and produces the grade you see. It is not written to
disk, not transmitted, and not retained after you close the page.

**In this default mode Winnow makes no network requests whatsoever.** There is nothing to intercept
and nothing to log.

### What Winnow stores locally

**Your settings.** Whether the panel is enabled, whether the breakdown starts expanded, the theme,
and the developer endpoint if you set one.

**Grades you marked as wrong.** If you click "Too harsh" or "Too lenient" on the panel, Winnow saves
that answer so its scoring can be corrected later. Each entry holds the grade, the trust score, how
many reviews were visible, and which checks were driving the result — the last part being the only
thing that makes a wrong grade fixable rather than merely noted.

It does **not** hold the product's name, its URL, or its ASIN. The listing is identified by a
one-way hash, which is enough to tell two listings apart without writing your browsing history to
disk, and the entry is stamped with a date rather than a time for the same reason. The log is capped
at 200 entries, and you can export or delete all of it from Winnow's options page at any time.

**None of this is ever uploaded.** There is no "send feedback" button, and no code path that
transmits the log — deliberately, so this promise rests on the code rather than on our restraint.
If you want to send it in, you export the file and do it yourself.

**Grades you have already seen.** When you open an Amazon product page, Winnow stores the grade it
computed — the product's ASIN, the letter grade, the score, the engine version, and the date. This
exists so the same grade can be shown beside that product on Amazon search pages.

Be clear about what this is: **a record of products you have opened**, and unlike the feedback log
above, the ASIN is stored in the clear rather than hashed. That is a deliberate choice in the other
direction, and the reason is that hashing would buy nothing here. The record's whole job is to
recognise a specific ASIN on a search page, so anyone reading your local storage could undo a hash
by hashing candidate ASINs themselves — while you would lose the ability to open the file and see
exactly what Winnow kept. Storing it plainly and telling you plainly is the more honest of the two.

It holds at most 500 products, entries expire after 90 days, and Winnow's options page erases the
whole record in one click. It never leaves your device, and there is no code in Winnow capable of
transmitting it.

**Winnow does not and will not load Amazon pages in the background to grade products you have not
opened.** Doing so would mean using your logged-in Amazon session to crawl the site, which puts your
Amazon account at risk — see the section below, which is a permanent commitment. This is why search
pages show grades only for products you have already visited, and say "not checked" for the rest.
A sparse row of badges is the honest consequence of that refusal, not a defect.

All three live in your browser's extension storage and never leave your device. This is the only
reason Winnow requests the `storage` permission.

---

## Part 2 — Deep analysis (optional, and not enabled in the published build)

> **Status:** no hosted service exists yet, so the published extension has no endpoint compiled in,
> requests no permission to reach one, and hides the button. Everything below describes how the
> feature behaves when it is enabled — today that means running the open-source server yourself on
> `localhost` and pointing Options at it. Nothing here happens in the shipped build.

Some checks are impossible from a single page. Whether a review's phrasing appears on forty other
products, whether a group of reviewers move together across listings, whether this listing used to
sell something else entirely — these require comparing against many products over time.

That comparison runs on our server. **It only ever runs when you click "Run deep analysis".**

### What is sent

- The product's ASIN (its public Amazon identifier)
- Its displayed rating, total rating count and rating breakdown
- A **hash** of the product title (never the title itself)
- The reviews visible on the page: rating, date, verified-purchase status, helpful-vote count, and
  review text — all of it public content already published on Amazon
- Amazon's **public reviewer profile identifier** for those reviews, where shown

### What is never sent

- Any identifier for you: no account, no user id, no device id, no session token, no cookie
- Your Amazon session, login state, order history, addresses or payment details
- Your browsing history, searches, or any page other than the product you asked about
- Your name, email or IP address in any stored form

The server **rejects** any request containing a field it does not expect, rather than ignoring it.
If a future version of the extension were ever changed to send something extra, the request would
fail rather than quietly succeed. This is enforced in code and covered by tests.

### What the server stores

- Hashes of review phrases — enough to detect the same text reused across products, not enough to
  reconstruct the review
- Reviewer profile identifiers, **HMAC-hashed with a server-side secret** before storage. The raw
  Amazon identifier is never written to disk
- Ratings, dates, verified flags and vote counts
- A history of the product's rating and title hash over time, so listing swaps become visible
- A cached result per product

Every row describes a **public product listing**. No row describes a Winnow user.

### What is deliberately not logged

We do not keep request logs. Not IP addresses, not which products were requested, not request
bodies. A log linking an address to a product would recreate exactly the browsing history this
policy says we do not hold.

Rate limiting necessarily observes the network address of an incoming request. It is hashed, held in
memory only, never written to disk, never associated with the content of the request, and discarded
within a minute.

### Legal basis and your rights (GDPR / UK GDPR)

Winnow does not hold personal data about its users, so there is nothing about you to access, export,
correct or erase — and no way for us to identify you in order to do so.

Hashed reviewer identifiers relate to **Amazon reviewers**, not to Winnow users, and are
pseudonymised at rest. We process them under legitimate interest (Art. 6(1)(f)): detecting
coordinated review fraud is squarely in the interest of consumers reading those reviews, uses the
minimum data capable of achieving it, and has no effect on the reviewer's rights beyond appearing in
an aggregate statistic. Reviewer data is retained for **24 months** from last sighting and then
deleted.

If you are an Amazon reviewer and want your hashed identifier removed from the corpus, contact us
and we will delete it.

---

## What Winnow does not do, in any mode

- Sell, rent or share data with third parties
- Run analytics, telemetry, crash reporting or fingerprinting
- Set cookies
- Send anything about the product you are viewing to an advertiser
- Read any site other than the Amazon domains listed in its manifest, its own API endpoint, and
  the sponsorship host named below
- Ask for personal information

Winnow shows one sponsored message inside its own two windows, described in full under
[Sponsorship](#sponsorship) below, including what the sponsor is and is not told.

Winnow requests no `tabs` permission and no broad host access. Outside Amazon it can reach
exactly one host, `winnow-reviews.vercel.app`, and only to fetch the sponsored message described
below. You can verify this in the manifest
before installing.

## Winnow will never crawl Amazon using your session

Winnow never makes automated requests to Amazon. It reads only what your browser already loaded for
a page you chose to visit.

This is permanent. Amazon's terms prohibit automated data mining, and scraping through a logged-in
session puts **your** Amazon account at risk of suspension. Winnow accepts a shallower analysis
rather than exposing you to that. No future version will crawl your session.

## Sponsorship

**Winnow shows one sponsored message, in its own two windows only.**

It appears in the toolbar popup and on the settings page. It **never appears on an
Amazon page**, never appears beside a grade, and never appears in the analysis panel. You can
switch it off in Settings, and nothing else about Winnow changes when you do.

**As of version 0.5.0 the sponsorship slot is live.** The only sponsorship host the extension
can contact is `winnow-reviews.vercel.app`, which we run — it serves a static file, not a
third-party ad network. That host is named in the extension's permissions, so you can see it
before installing rather than discover it afterwards.

### What the sponsor is told

That a Winnow window was opened. Nothing else.

The request contains three values: a schema version, which of the two windows is asking, and the
creative formats that window can display. There is no field in it that could carry anything else —
not the product, not the page address, not your search terms, not the grade, not a trust score, not
a review, and not an identifier of any kind. Two different people opening the same window send
byte-identical requests, so nothing inside the request distinguishes you from anyone else.

It is sent with no cookies, no credentials and no referrer.

Because the sponsor is never told which product you are viewing, **a sponsor cannot buy placement
against a particular product, listing or seller** — not as a matter of our restraint, but because
the information needed to do it never leaves your machine.

### What a sponsor can see anyway

The connection itself. Any request shows the server receiving it an IP address, and approximate
location follows from that.

This is a property of making a request at all, rather than of what Winnow puts inside one. The
body still says nothing about you or about what you are looking at, so a sponsor cannot ask "who
is looking at this product" — the request never carried a product to ask about. But "nothing
leaves your machine" stops being true the moment a request is made, and this is where it stops,
so it is written here rather than left for someone to discover.

It is also the reason [switching it off](#switching-it-off) prevents the request instead of
discarding the response. A request sent from your address and then thrown away would already
have shown that address to the sponsor.

### What the sponsor can do to a grade

Nothing. Grades are computed locally, before any sponsorship request is made, by an open-source
engine you can read. The sponsored message is fetched by the extension's background worker and
drawn into Winnow's own window; no part of it reaches the scoring code, and no part of the scoring
code is reachable from it.

### Switching it off

Settings → *Show sponsorship in Winnow's own windows*. Turning it off stops the request being made
at all. It does not merely hide the result — a request sent and then discarded would still have
told the sponsor that this installation exists, which is the thing you are asking us not to do.

### What has not changed

**You pay us, or a sponsor who cannot see your screen does. No merchant does.**

Winnow carries no affiliate links, no referral tags, no commissions and no merchant relationships.
Winnow does not and will not accept payment, in any form, from any seller, brand, marketplace or
advertiser to influence, alter, suppress or promote any rating, grade or result it produces.

This is a binding commitment, not a description of current practice. A tool that earns a commission
when you buy cannot credibly tell you not to buy — which is precisely why the money comes from a
slot that cannot see what you are buying.

The scoring engine is open source so that this claim can be verified rather than merely trusted.

## Automated decision-making

Winnow's grades are produced by statistical analysis, not by human review. They are estimates about
*products*, not decisions about people, and they have no legal or similarly significant effect on
anyone within the meaning of GDPR Art. 22. The reasoning behind every grade is shown in the panel so
you can judge it yourself, and Winnow states plainly when its confidence is low.

## Children

Winnow is not directed at children and collects no data from anyone, including children under 13.

## Changes to this policy

Material changes will be noted in the extension's changelog and reflected in the date above. If the
no-affiliate commitment above ever changes, it will be announced prominently before taking effect,
never altered quietly in this document.

**Changed in 0.5.0:** Winnow now shows one sponsored message in its own two windows, described
under [Sponsorship](#sponsorship), and requests one new host permission — `winnow-reviews.vercel.app`,
which we run — to fetch it. Earlier versions of this document listed advertising among the
things Winnow does not do, and said Winnow made no money. Both statements were true when written
and are no longer, so both were removed rather than reworded. The no-affiliate and no-merchant-
payment commitments are unchanged.

## Contact

<https://github.com/Cristians68/Winnow/issues>
