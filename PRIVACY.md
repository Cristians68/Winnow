# Winnow Privacy Policy

**Last updated:** 26 July 2026
**Applies to:** the Winnow browser extension and the Winnow deep-analysis service, all versions.

---

## The short version

Winnow has no account, no analytics, and no tracking of any kind.

Grading happens entirely on your own device and involves no network access at all. One optional
feature — **deep analysis** — sends information about the *product listing* to our service, and only
when you click a button to ask for it. It never sends information about you.

---

## Part 1 — What happens on your device (the default)

When you open an Amazon product page, Winnow reads content your browser has **already rendered**:
the product's rating, the rating breakdown, and the reviews visible on the page.

That data is scored in memory, on your device, and produces the grade you see. It is not written to
disk, not transmitted, and not retained after you close the page.

**In this default mode Winnow makes no network requests whatsoever.** There is nothing to intercept
and nothing to log.

### What Winnow stores locally

Exactly two settings — whether the panel is enabled, and whether the breakdown starts expanded. They
live in your browser's extension storage and never leave your device. This is the only reason
Winnow requests the `storage` permission.

---

## Part 2 — Deep analysis (optional, and only when you ask)

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
- Run analytics, telemetry, crash reporting, advertising or fingerprinting
- Set cookies
- Read any site other than the Amazon domains listed in its manifest and its own API endpoint
- Ask for personal information

Winnow requests no `tabs` permission and no broad host access. You can verify this in the manifest
before installing.

## Winnow will never crawl Amazon using your session

Winnow never makes automated requests to Amazon. It reads only what your browser already loaded for
a page you chose to visit.

This is permanent. Amazon's terms prohibit automated data mining, and scraping through a logged-in
session puts **your** Amazon account at risk of suspension. Winnow accepts a shallower analysis
rather than exposing you to that. No future version will crawl your session.

## How we make money

**You pay us. Nobody else does.**

Winnow carries no affiliate links, no referral tags, no sponsored placements, no commissions and no
merchant relationships. Winnow does not and will not accept payment, in any form, from any seller,
brand, marketplace or advertiser to influence, alter, suppress or promote any rating, grade or
result it produces.

This is a binding commitment, not a description of current practice. A tool that earns a commission
when you buy cannot credibly tell you not to buy.

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

## Contact

<https://github.com/winnow-app/winnow/issues>
